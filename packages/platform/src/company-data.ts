import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Sql, TransactionSql } from "postgres";
import type { PlatformConfig } from "./config.js";

export type DeletionSummary = {
  companyId: number;
  companyDeleted: boolean;
  filingsDeleted: number;
  documentsDeleted: number;
  jobsDeleted: number;
  financialFactsDeleted: number;
  filesDeleted: number;
  fileCleanupFailures: number;
};

type CompanyRecord = { id: number; cik: number; legal_name: string };

/** Owns destructive company-data lifecycle rules and filesystem reference safety. */
export class CompanyDataLifecycle {
  constructor(private sql: Sql, private config: PlatformConfig) {}

  async company(companyId: number): Promise<CompanyRecord | null> {
    const rows = await this.sql<CompanyRecord[]>`SELECT id, cik, legal_name FROM companies WHERE id = ${companyId}`;
    return rows[0] ?? null;
  }

  async deleteCorpus(companyId: number): Promise<DeletionSummary | null> {
    return this.deleteScope(companyId, false);
  }

  async deleteCompany(companyId: number): Promise<DeletionSummary | null> {
    return this.deleteScope(companyId, true);
  }

  private async deleteScope(companyId: number, deleteCompany: boolean): Promise<DeletionSummary | null> {
    const result = await this.sql.begin(async (tx) => {
      const company = (await tx<CompanyRecord[]>`SELECT id, cik, legal_name FROM companies WHERE id = ${companyId} FOR UPDATE`)[0];
      if (!company) return null;
      const paths = await tx<{ path: string }[]>`
        SELECT d.local_path AS path FROM filing_documents d JOIN filings f ON f.id = d.filing_id
          WHERE f.company_id = ${companyId} AND d.local_path IS NOT NULL
        UNION SELECT n.normalized_text_path FROM normalized_documents n JOIN filing_documents d ON d.id = n.document_id
          JOIN filings f ON f.id = d.filing_id WHERE f.company_id = ${companyId}
        UNION SELECT body_path FROM companyfacts_sources WHERE company_id = ${companyId}`;
      const counts = (await tx<{ filings: number; documents: number; jobs: number; facts: number }[]>`
        SELECT (SELECT count(*)::integer FROM filings WHERE company_id = ${companyId}) AS filings,
          (SELECT count(*)::integer FROM filing_documents d JOIN filings f ON f.id = d.filing_id WHERE f.company_id = ${companyId}) AS documents,
          (SELECT count(*)::integer FROM jobs WHERE company_id = ${companyId}) AS jobs,
          (SELECT count(*)::integer FROM financial_facts WHERE company_id = ${companyId}) AS facts`)[0];

      await tx`DELETE FROM jobs WHERE company_id = ${companyId}`;
      await tx`DELETE FROM financial_facts WHERE company_id = ${companyId}`;
      await tx`DELETE FROM companyfacts_sources WHERE company_id = ${companyId}`;
      await tx`DELETE FROM embedding_approvals WHERE company_id = ${companyId}`;
      await tx`DELETE FROM model_runs WHERE company_id = ${companyId}`;
      await tx`DELETE FROM filings WHERE company_id = ${companyId}`;
      if (deleteCompany) await tx`DELETE FROM companies WHERE id = ${companyId}`;
      else await tx`UPDATE companies SET earliest_requested_filing_date = NULL, latest_requested_filing_date = NULL,
        requested_lookback = NULL, updated_at = now() WHERE id = ${companyId}`;

      const pathValues = paths.map((entry) => entry.path);
      if (pathValues.length) await tx`DELETE FROM sec_responses s WHERE s.body_path = ANY(${pathValues}::text[])
        AND NOT EXISTS (SELECT 1 FROM filing_documents d WHERE d.local_path = s.body_path)
        AND NOT EXISTS (SELECT 1 FROM normalized_documents n WHERE n.normalized_text_path = s.body_path)
        AND NOT EXISTS (SELECT 1 FROM companyfacts_sources c WHERE c.body_path = s.body_path)`;
      return { paths: pathValues, counts };
    });
    if (!result) return null;
    const cleanup = await this.removeUnreferencedFiles(result.paths);
    return { companyId, companyDeleted: deleteCompany, filingsDeleted: result.counts.filings,
      documentsDeleted: result.counts.documents, jobsDeleted: result.counts.jobs,
      financialFactsDeleted: result.counts.facts, filesDeleted: cleanup.deleted, fileCleanupFailures: cleanup.failed };
  }

  private async removeUnreferencedFiles(paths: string[]) {
    const dataRoot = resolve(this.config.dataDir);
    let deleted = 0, failed = 0;
    for (const path of new Set(paths)) {
      const absolute = resolve(path);
      if (absolute !== dataRoot && !absolute.startsWith(`${dataRoot}${sep}`)) continue;
      const referenced = (await this.sql<{ exists: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM filing_documents WHERE local_path = ${path}
        UNION ALL SELECT 1 FROM normalized_documents WHERE normalized_text_path = ${path}
        UNION ALL SELECT 1 FROM companyfacts_sources WHERE body_path = ${path}
        UNION ALL SELECT 1 FROM sec_responses WHERE body_path = ${path}) AS exists`)[0].exists;
      if (referenced) continue;
      try { await unlink(absolute); deleted += 1; }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) failed += 1;
      }
    }
    return { deleted, failed };
  }
}
