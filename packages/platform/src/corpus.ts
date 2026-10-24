import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import type { PlatformConfig } from "./config.js";
import { embeddingSettings, Retrieval } from "./retrieval.js";
import { chunkingProfileVersion } from "./chunking.js";
import { filingParserVersion } from "./filing-parser.js";

export class CorpusCatalog {
  constructor(private sql: Sql, private config: PlatformConfig, private retrieval = new Retrieval(sql, config)) {}

  async status(companyId: number) {
    const [documents, coverage, facts, embeddings] = await Promise.all([
      this.sql<{ stage: string; count: number }[]>`
        SELECT stage, count(*)::integer AS count FROM filing_documents d
        JOIN filings f ON f.id = d.filing_id WHERE f.company_id = ${companyId} GROUP BY stage ORDER BY stage`,
      this.sql<{ earliest: string | null; latest: string | null; supported: number; missing_manifests: number; acquisition_failures: number }[]>`
        SELECT min(filing_date)::text AS earliest, max(filing_date)::text AS latest,
          count(*) FILTER (WHERE is_supported)::integer AS supported,
          count(*) FILTER (WHERE is_supported AND NOT EXISTS (SELECT 1 FROM filing_documents d WHERE d.filing_id = filings.id))::integer AS missing_manifests,
          count(*) FILTER (WHERE is_supported AND EXISTS (SELECT 1 FROM work_items w WHERE w.filing_id = filings.id AND w.work_type = 'acquire_filing_source' AND w.status = 'failed'))::integer AS acquisition_failures
        FROM filings WHERE company_id = ${companyId}`,
      this.sql<{ complete: boolean }[]>`SELECT EXISTS (SELECT 1 FROM companyfacts_sources WHERE company_id = ${companyId} AND status = 'complete') AS complete`,
      this.retrieval.status(companyId),
    ]);
    const excluded = await this.sql`
      SELECT d.id, d.filing_id, d.document_name, d.document_type, d.exclusion_reason, d.attempt_count, d.retryable,
        f.accession_number, f.form_type, f.filing_date
      FROM filing_documents d JOIN filings f ON f.id = d.filing_id
      WHERE f.company_id = ${companyId} AND d.stage = 'excluded' ORDER BY f.filing_date DESC, d.id`;
    const failures = await this.sql`
      SELECT w.id, w.filing_id, w.document_id, w.work_type, w.attempt_count, w.error_code, w.error_message
      FROM work_items w WHERE w.company_id = ${companyId} AND w.status = 'failed' ORDER BY w.updated_at DESC`;
    const stageCounts = Object.fromEntries(documents.map((row) => [row.stage, row.count]));
    const terminalDocuments = (stageCounts.embedded ?? 0) + (stageCounts.excluded ?? 0);
    const documentTotal = documents.reduce((sum, row) => sum + row.count, 0);
    const embeddingComplete = !embeddings.configured || embeddings.chunks === embeddings.embedded;
    const operational = coverage[0].supported > 0 && coverage[0].missing_manifests === 0 && coverage[0].acquisition_failures === 0 &&
      documentTotal > 0 && terminalDocuments === documentTotal && facts[0].complete && embeddingComplete;
    return {
      readiness: operational ? (excluded.length ? "ready_with_exclusions" : "ready") : "processing",
      stageCounts, activeVersions: { parser: filingParserVersion, chunking: chunkingProfileVersion, embeddingProfile: embeddingSettings(this.config)?.key ?? null },
      coverage: { earliestFilingDate: coverage[0].earliest, latestFilingDate: coverage[0].latest, supportedFilings: coverage[0].supported, missingManifests: coverage[0].missing_manifests },
      structuredFactsComplete: facts[0].complete, embeddings, exclusions: excluded, failures,
    };
  }

  async embeddingEstimate(companyId: number) {
    const settings = embeddingSettings(this.config);
    if (!settings) return null;
    const rows = await this.sql<{ documents: number; tokens: number; fingerprint: string }[]>`
      SELECT count(DISTINCT c.document_id)::integer AS documents, COALESCE(sum(c.token_estimate), 0)::bigint AS tokens,
        md5(string_agg(c.id::text || ':' || c.chunk_hash, ',' ORDER BY c.id)) AS fingerprint
      FROM chunks c JOIN normalized_documents n ON n.id = c.normalized_document_id
      WHERE c.company_id = ${companyId} AND n.status = 'parsed'`;
    return { profileKey: settings.key, documentCount: rows[0].documents, tokenEstimate: Number(rows[0].tokens), corpusFingerprint: rows[0].fingerprint ?? createHash("sha256").update("").digest("hex") };
  }

  async approveEmbeddings(companyId: number, fingerprint: string, profileKey: string) {
    const estimate = await this.embeddingEstimate(companyId);
    if (!estimate || estimate.corpusFingerprint !== fingerprint || estimate.profileKey !== profileKey) return null;
    await this.sql`INSERT INTO embedding_approvals (company_id, profile_key, corpus_fingerprint, document_count, token_estimate, approved_at)
      VALUES (${companyId}, ${profileKey}, ${fingerprint}, ${estimate.documentCount}, ${estimate.tokenEstimate}, now())
      ON CONFLICT (company_id, profile_key, corpus_fingerprint) DO UPDATE SET approved_at = now()`;
    return estimate;
  }

  async retry(companyId: number, documentIds?: number[]) {
    const documents = await this.sql<{ id: number; filing_id: number; local_path: string | null; content_hash: string | null }[]>`
      SELECT d.id, d.filing_id, d.local_path, d.content_hash FROM filing_documents d JOIN filings f ON f.id = d.filing_id
      WHERE f.company_id = ${companyId} AND d.retryable = true AND d.stage = 'excluded'
        AND (${documentIds?.length ? documentIds : null}::bigint[] IS NULL OR d.id = ANY(${documentIds?.length ? documentIds : []}::bigint[]))`;
    if (!documents.length) return { queued: 0 };
    const jobs = await this.sql<{ id: number }[]>`INSERT INTO jobs (job_type, company_id, status, progress) VALUES ('corpus_retry', ${companyId}, 'running', '{"retry":"queued"}') RETURNING id`;
    for (const document of documents) {
      await this.sql`UPDATE filing_documents SET stage = ${document.local_path && document.content_hash ? "downloaded" : "discovered"}, status = ${document.local_path && document.content_hash ? "downloaded" : "discovered"}, excluded_at = NULL, exclusion_reason = NULL, attempt_count = 0, updated_at = now() WHERE id = ${document.id}`;
      await this.sql`INSERT INTO work_items (job_id, work_type, company_id, filing_id, document_id, input)
        VALUES (${jobs[0].id}, ${document.local_path && document.content_hash ? "parse_filing_source" : "acquire_filing_source"}, ${companyId}, ${document.filing_id}, ${document.local_path && document.content_hash ? document.id : null}, '{}'::jsonb)`;
    }
    return { queued: documents.length, jobId: jobs[0].id };
  }
}
