import type { Sql, TransactionSql } from "postgres";

export type ClaimedWork = {
  id: number;
  job_id: number;
  work_type: "resolve_company" | "resolve_company_preview" | "fetch_metadata" | "fetch_companyfacts" | "acquire_filing_source" | "parse_filing_source" | "chunk_document" | "embed_document";
  company_id: number | null;
  filing_id: number | null;
  document_id: number | null;
  attempt_count: number;
  input: { ticker?: string; startDate?: string; profileKey?: string };
};

export class LeaseLostError extends Error {
  constructor() { super("Work lease is no longer owned by this attempt."); }
}

export async function excludeTerminalDocument(tx: TransactionSql, item: Pick<ClaimedWork, "work_type" | "filing_id" | "document_id" | "attempt_count">, message: string) {
  if (item.document_id) {
    await tx`UPDATE filing_documents SET status = 'excluded', stage = 'excluded', attempt_count = ${item.attempt_count},
      excluded_at = now(), exclusion_reason = ${message}, retryable = true, last_error = ${message}, updated_at = now()
      WHERE id = ${item.document_id}`;
  } else if (item.work_type === "acquire_filing_source" && item.filing_id) {
    await tx`INSERT INTO filing_documents (filing_id, document_name, document_type, sec_url, status, stage, attempt_count,
      excluded_at, exclusion_reason, retryable, last_error)
      SELECT id, '__manifest__', 'manifest_failure',
        'https://www.sec.gov/Archives/edgar/data/' || cik::text || '/' || replace(accession_number, '-', '') || '/index.json',
        'excluded', 'excluded', ${item.attempt_count}, now(), ${message}, true, ${message}
      FROM filings WHERE id = ${item.filing_id}
      ON CONFLICT (filing_id, document_name) DO UPDATE SET status = 'excluded', stage = 'excluded',
        attempt_count = EXCLUDED.attempt_count, excluded_at = now(), exclusion_reason = EXCLUDED.exclusion_reason,
        retryable = true, last_error = EXCLUDED.last_error, updated_at = now()`;
  }
}

/** Fences persisted stage results with the same row used for lease recovery. */
export class WorkQueue {
  constructor(private sql: Sql, private owner: string, private leaseSeconds = 300) {}

  async claim(): Promise<ClaimedWork | undefined> {
    const rows = await this.sql<ClaimedWork[]>`
      UPDATE work_items SET status = 'running', lease_owner = ${this.owner},
        lease_expires_at = now() + ${this.leaseSeconds} * interval '1 second',
        attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = (SELECT id FROM work_items WHERE status = 'pending' AND next_run_at <= now()
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, job_id, work_type, company_id, filing_id, document_id, attempt_count, input
    `;
    return rows[0];
  }

  async assertOwnership(tx: TransactionSql, item: ClaimedWork): Promise<void> {
    const rows = await tx`SELECT id FROM work_items
      WHERE id = ${item.id} AND status = 'running' AND lease_owner = ${this.owner}
        AND attempt_count = ${item.attempt_count} AND lease_expires_at > clock_timestamp()
      FOR UPDATE`;
    if (!rows.length) throw new LeaseLostError();
  }

  async transaction<T>(item: ClaimedWork, persist: (tx: TransactionSql) => Promise<T>) {
    return this.sql.begin(async (tx) => {
      await this.assertOwnership(tx, item);
      return persist(tx);
    });
  }

  async renew(item: ClaimedWork): Promise<boolean> {
    const rows = await this.sql`UPDATE work_items
      SET lease_expires_at = clock_timestamp() + ${this.leaseSeconds} * interval '1 second', updated_at = now()
      WHERE id = ${item.id} AND status = 'running' AND lease_owner = ${this.owner}
        AND attempt_count = ${item.attempt_count} AND lease_expires_at > clock_timestamp()
      RETURNING id`;
    return rows.length > 0;
  }

  async recoverExpired() {
    return this.sql.begin(async (tx) => {
      const rows = await tx<(ClaimedWork & { status: string })[]>`
        UPDATE work_items SET status = CASE WHEN attempt_count < 3 THEN 'pending' ELSE 'failed' END,
          lease_owner = null, lease_expires_at = null, next_run_at = now(),
          error_code = 'lease_expired', error_message = 'Worker lease expired before completion.', updated_at = now()
        WHERE id IN (SELECT id FROM work_items WHERE status = 'running' AND lease_expires_at <= clock_timestamp()
          ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100)
        RETURNING id, job_id, work_type, company_id, filing_id, document_id, attempt_count, input, status
      `;
      for (const row of rows) {
        await tx`UPDATE jobs SET status = CASE WHEN EXISTS (
            SELECT 1 FROM work_items WHERE job_id = ${row.job_id} AND status IN ('pending', 'running')
          ) THEN 'running' ELSE 'partial' END,
          last_error = 'Worker lease expired before completion.', updated_at = now() WHERE id = ${row.job_id}`;
        if (row.status === "failed") await excludeTerminalDocument(tx, row, "Worker lease expired before completion.");
      }
      return rows;
    });
  }
}
