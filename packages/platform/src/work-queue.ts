import type { Sql, TransactionSql } from "postgres";

export type ClaimedWork = {
  id: number;
  job_id: number;
  work_type: "resolve_company" | "resolve_company_preview" | "fetch_metadata" | "acquire_filing_source" | "parse_filing_source" | "chunk_document" | "embed_document";
  company_id: number | null;
  filing_id: number | null;
  document_id: number | null;
  attempt_count: number;
  input: { ticker?: string; startDate?: string; profileKey?: string };
};

export class LeaseLostError extends Error {
  constructor() { super("Work lease is no longer owned by this attempt."); }
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
      const rows = await tx<{ id: number; job_id: number; status: string }[]>`
        UPDATE work_items SET status = CASE WHEN attempt_count < 3 THEN 'pending' ELSE 'failed' END,
          lease_owner = null, lease_expires_at = null, next_run_at = now(),
          error_code = 'lease_expired', error_message = 'Worker lease expired before completion.', updated_at = now()
        WHERE id IN (SELECT id FROM work_items WHERE status = 'running' AND lease_expires_at <= clock_timestamp()
          ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100)
        RETURNING id, job_id, status
      `;
      for (const row of rows) {
        await tx`UPDATE jobs SET status = CASE WHEN EXISTS (
            SELECT 1 FROM work_items WHERE job_id = ${row.job_id} AND status IN ('pending', 'running')
          ) THEN 'running' ELSE 'partial' END,
          last_error = 'Worker lease expired before completion.', updated_at = now() WHERE id = ${row.job_id}`;
      }
      return rows;
    });
  }
}
