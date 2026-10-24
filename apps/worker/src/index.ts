import type { TransactionSql } from "postgres";
import { randomUUID } from "node:crypto";
import {
  Retrieval,
  WorkQueue,
  LeaseLostError,
  type ClaimedWork,
  backfillSearchIndex,
  chunkDocument,
  parseFilingSource,
  connectDatabase,
  assessWorkerReadiness,
  filingParserVersion,
  filingArchiveDirectoryUrl,
  isSupportedMvpForm,
  loadConfig,
  SecClient,
  type CompanySubmission,
} from "@secthing/platform";

const config = loadConfig();
const readiness = await assessWorkerReadiness(config);
if (readiness.status !== "ready") {
  console.error(JSON.stringify({ event: "worker.not_ready", ...readiness }));
  process.exit(1);
}

console.info(
  JSON.stringify({ event: "worker.ready", checks: readiness.checks }),
);
const sql = connectDatabase(config.databaseUrl);
const workerId = `worker-${randomUUID()}`;
const sec = new SecClient({
  dataDir: config.dataDir,
  userAgent: config.secUserAgent,
  rateLimitPerSecond: config.secRateLimitPerSecond,
});
const retrieval = new Retrieval(sql, config);

type WorkItem = ClaimedWork;
const queue = new WorkQueue(sql, workerId);
type Company = { id: number; cik: number };
type SourceFiling = {
  id: number;
  cik: number;
  accession_number: string;
  form_type: string;
  primary_document: string | null;
};

async function storeResponse(sql: TransactionSql, response: {
  url: string;
  status: number;
  contentType: string | null;
  bodyPath: string;
  contentHash: string;
}) {
  await sql`
    INSERT INTO sec_responses (url, response_status, content_type, body_path, content_hash)
    VALUES (${response.url}, ${response.status}, ${response.contentType}, ${response.bodyPath}, ${response.contentHash})
    ON CONFLICT (url, content_hash) WHERE content_hash IS NOT NULL DO NOTHING
  `;
}

async function upsertCompany(
  sql: TransactionSql,
  cik: number,
  name: string,
  ticker: string,
): Promise<{ company: Company; existed: boolean }> {
  const prior = await sql<
    Company[]
  >`SELECT id, cik FROM companies WHERE cik = ${cik}`;
  const rows = await sql<Company[]>`
    INSERT INTO companies (cik, legal_name, identity_source, identity_fetched_at)
    VALUES (${cik}, ${name}, 'sec_ticker_mapping', now())
    ON CONFLICT (cik) DO UPDATE SET legal_name = EXCLUDED.legal_name, identity_source = EXCLUDED.identity_source, identity_fetched_at = now(), updated_at = now()
    RETURNING id, cik
  `;
  const company = rows[0];
  await sql`
    INSERT INTO company_ticker_aliases (company_id, ticker, source)
    VALUES (${company.id}, ${ticker}, 'sec_ticker_mapping')
    ON CONFLICT (company_id, ticker) DO UPDATE SET is_current = true, updated_at = now()
  `;
  return { company, existed: prior.length > 0 };
}

async function resolveCompany(item: WorkItem): Promise<void> {
  const ticker = item.input.ticker;
  const startDate = item.input.startDate;
  if (!ticker || !startDate)
    throw new Error("Resolve work item is missing ticker or start date.");
  const { match, response } = await sec.resolveTicker(ticker);
  await queue.transaction(item, async (sql) => {
    await storeResponse(sql, response);
    if (item.work_type === "resolve_company_preview") {
      const prior = await sql<Company[]>`SELECT id, cik FROM companies WHERE cik = ${match.cik}`;
      await sql`UPDATE jobs SET company_id = ${prior[0]?.id ?? null}, status = 'complete',
        progress = ${sql.json({ identity: "complete", company: { id: prior[0]?.id ?? null, cik: match.cik, name: match.title, ticker: match.ticker, existed: prior.length > 0 } })},
        updated_at = now() WHERE id = ${item.job_id}`;
      return;
    }
    const { company, existed } = await upsertCompany(sql, match.cik, match.title, match.ticker);
    await sql`UPDATE jobs SET company_id = ${company.id}, status = 'running', progress = ${sql.json({ identity: "complete", metadata: "queued", filings: { discovered: 0, total: 0 }, existingCompany: existed })}, updated_at = now() WHERE id = ${item.job_id}`;
    await sql`
      INSERT INTO work_items (job_id, work_type, company_id, input)
      VALUES (${item.job_id}, 'fetch_metadata', ${company.id}, ${sql.json({ startDate })})
    `;
  });
}

async function persistSubmission(
  sql: TransactionSql,
  company: Company,
  submission: CompanySubmission,
  startDate: string,
): Promise<{ discovered: number; total: number }> {
  const today = new Date().toISOString().slice(0, 10);
  for (const response of submission.cachedResponses)
    await storeResponse(sql, response);
  await sql`
    UPDATE companies
    SET legal_name = ${submission.name}, sic = ${submission.sic ?? null}, sic_description = ${submission.sicDescription ?? null}, entity_type = ${submission.entityType ?? null},
        fiscal_year_end = ${submission.fiscalYearEnd ?? null}, state_of_incorporation = ${submission.stateOfIncorporation ?? null},
        state_of_incorporation_description = ${submission.stateOfIncorporationDescription ?? null}, business_address = ${submission.businessAddress ? sql.json(submission.businessAddress) : null},
        mailing_address = ${submission.mailingAddress ? sql.json(submission.mailingAddress) : null}, phone = ${submission.businessAddress?.phone ?? null}, former_names = ${sql.json(submission.formerNames)},
        identity_source = 'sec_submissions', identity_fetched_at = now(),
        earliest_requested_filing_date = CASE WHEN earliest_requested_filing_date IS NULL OR earliest_requested_filing_date > ${startDate}::date THEN ${startDate}::date ELSE earliest_requested_filing_date END,
        latest_requested_filing_date = CASE WHEN latest_requested_filing_date IS NULL OR latest_requested_filing_date < ${today}::date THEN ${today}::date ELSE latest_requested_filing_date END,
        updated_at = now()
    WHERE id = ${company.id}
  `;
  for (const [index, ticker] of submission.tickers.entries()) {
    await sql`
      INSERT INTO company_ticker_aliases (company_id, ticker, exchange, source)
      VALUES (${company.id}, ${ticker}, ${submission.exchanges[index] ?? null}, 'sec_submissions')
      ON CONFLICT (company_id, ticker) DO UPDATE SET exchange = EXCLUDED.exchange, is_current = true, updated_at = now()
    `;
  }
  await sql`UPDATE companies SET exchange = COALESCE(${submission.exchanges[0] ?? null}, exchange), updated_at = now() WHERE id = ${company.id}`;
  const relevant = submission.filings.filter(
    (filing) => filing.filingDate >= startDate && filing.filingDate <= today,
  );
  for (const filing of relevant) {
    await sql`
      INSERT INTO filings (company_id, cik, accession_number, form_type, filing_date, report_date, primary_document, items, is_xbrl, is_inline_xbrl, is_supported)
      VALUES (${company.id}, ${company.cik}, ${filing.accessionNumber}, ${filing.form}, ${filing.filingDate}, ${filing.reportDate ?? null}, ${filing.primaryDocument ?? null}, ${filing.items ?? null}, ${filing.isXbrl ?? null}, ${filing.isInlineXbrl ?? null}, ${isSupportedMvpForm(filing.form)})
      ON CONFLICT (cik, accession_number) DO UPDATE SET
        form_type = EXCLUDED.form_type, filing_date = EXCLUDED.filing_date, report_date = EXCLUDED.report_date,
        primary_document = EXCLUDED.primary_document, items = EXCLUDED.items, is_xbrl = EXCLUDED.is_xbrl,
        is_inline_xbrl = EXCLUDED.is_inline_xbrl, is_supported = EXCLUDED.is_supported, updated_at = now()
    `;
  }
  const total = await sql<
    { count: number }[]
  >`SELECT count(*)::integer AS count FROM filings WHERE company_id = ${company.id}`;
  return { discovered: relevant.length, total: total[0].count };
}

async function fetchMetadata(item: WorkItem): Promise<void> {
  if (!item.company_id)
    throw new Error("Metadata work item is missing a company.");
  const startDate = item.input.startDate;
  if (!startDate)
    throw new Error("Metadata work item is missing a start date.");
  const companies = await sql<
    Company[]
  >`SELECT id, cik FROM companies WHERE id = ${item.company_id}`;
  const company = companies[0];
  if (!company) throw new Error("Company no longer exists.");
  const submission = await sec.fetchCompanySubmission(company.cik);
  await queue.transaction(item, async (sql) => {
    const counts = await persistSubmission(sql, company, submission, startDate);
    const queued = await queueSourceAcquisition(sql, item.job_id, company.id);
    await sql`
      UPDATE jobs
      SET status = ${queued > 0 ? "running" : "complete"},
          progress = ${sql.json({ identity: "complete", metadata: "complete", filings: { discovered: counts.discovered, total: counts.total }, sourceAcquisition: { status: queued > 0 ? "queued" : "not_applicable", queued, complete: 0, failed: 0 }, parsing: "not_started", chunking: "not_started" })},
          updated_at = now()
      WHERE id = ${item.job_id}
    `;
  });
}

async function queueSourceAcquisition(
  sql: TransactionSql,
  jobId: number,
  companyId: number,
): Promise<number> {
  const queued = await sql<{ id: number }[]>`
    INSERT INTO work_items (job_id, work_type, company_id, filing_id, input)
    SELECT ${jobId}, 'acquire_filing_source', filings.company_id, filings.id, '{}'::jsonb
    FROM filings
    WHERE filings.company_id = ${companyId}
      AND filings.is_supported = true
      AND NOT EXISTS (
        SELECT 1 FROM filing_documents
        WHERE filing_documents.filing_id = filings.id
          AND filing_documents.status = 'downloaded'
      )
      AND NOT EXISTS (
        SELECT 1 FROM work_items
        WHERE work_items.job_id = ${jobId}
          AND work_items.work_type = 'acquire_filing_source'
          AND work_items.filing_id = filings.id
      )
    RETURNING id
  `;
  return queued.length;
}

async function acquireFilingSource(item: WorkItem): Promise<void> {
  if (!item.filing_id)
    throw new Error("Source-acquisition work item is missing a filing.");
  const filings = await sql<SourceFiling[]>`
    SELECT id, cik, accession_number, form_type, primary_document
    FROM filings WHERE id = ${item.filing_id}
  `;
  const filing = filings[0];
  if (!filing) throw new Error("Filing no longer exists.");
  const acquisition = await sec.acquireFilingDocuments({
    cik: filing.cik,
    accessionNumber: filing.accession_number,
    formType: filing.form_type,
    primaryDocument: filing.primary_document ?? undefined,
  });
  await queue.transaction(item, async (sql) => {
    await storeResponse(sql, acquisition.indexResponse);
    const downloaded = new Map(acquisition.documents.map((document) => [document.documentName, document]));
    const parseIds: number[] = [];
    for (const entry of acquisition.manifest) {
      const document = downloaded.get(entry.documentName);
      const url = `${filingArchiveDirectoryUrl(filing.cik, filing.accession_number)}/${encodeURIComponent(entry.documentName)}`;
      const documents = await sql<{ id: number }[]>`
        INSERT INTO filing_documents (filing_id, document_name, document_type, sec_url, local_path, content_type, content_hash, byte_size,
          status, stage, excluded_at, exclusion_reason, retryable, fetched_at)
        VALUES (${filing.id}, ${entry.documentName}, ${entry.classification}, ${url}, ${document?.bodyPath ?? null},
          ${document?.contentType ?? null}, ${document?.contentHash ?? null}, ${document?.byteSize ?? entry.byteSize ?? null},
          ${entry.included ? "downloaded" : "excluded"}, ${entry.included ? "downloaded" : "excluded"},
          ${entry.included ? null : new Date()}, ${entry.exclusionReason ?? null}, ${entry.included}, ${entry.included ? new Date() : null})
        ON CONFLICT (filing_id, document_name) DO UPDATE SET
          document_type = EXCLUDED.document_type, sec_url = EXCLUDED.sec_url, local_path = EXCLUDED.local_path,
          content_type = EXCLUDED.content_type, content_hash = EXCLUDED.content_hash, byte_size = EXCLUDED.byte_size,
          status = EXCLUDED.status, stage = EXCLUDED.stage, excluded_at = EXCLUDED.excluded_at,
          exclusion_reason = EXCLUDED.exclusion_reason, retryable = EXCLUDED.retryable,
          last_error = NULL, fetched_at = EXCLUDED.fetched_at, updated_at = now()
        RETURNING id
      `;
      if (entry.included) parseIds.push(documents[0].id);
    }
    await sql`UPDATE filings SET filing_status = 'source_acquired', updated_at = now() WHERE id = ${filing.id}`;
    for (const documentId of parseIds) await queueParsing(sql, item.job_id, item.company_id, filing.id, documentId);
  });
}

async function queueParsing(
  sql: TransactionSql,
  jobId: number,
  companyId: number | null,
  filingId: number,
  documentId: number,
): Promise<void> {
  await sql`
    INSERT INTO work_items (job_id, work_type, company_id, filing_id, document_id, input)
    SELECT ${jobId}, 'parse_filing_source', ${companyId}, ${filingId}, ${documentId}, '{}'::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM normalized_documents
      JOIN filing_documents ON filing_documents.id = normalized_documents.document_id
      WHERE normalized_documents.document_id = ${documentId}
        AND normalized_documents.parser_version = ${filingParserVersion}
        AND normalized_documents.status = 'parsed'
        AND normalized_documents.source_content_hash = filing_documents.content_hash
    )
      AND NOT EXISTS (
        SELECT 1 FROM work_items
        WHERE work_items.job_id = ${jobId}
          AND work_items.work_type = 'parse_filing_source'
          AND work_items.document_id = ${documentId}
      )
  `;
}

async function refreshPipelineProgress(jobId: number): Promise<void> {
  const rows = await sql<
    {
      source_queued: number;
      source_complete: number;
      source_failed: number;
      parse_queued: number;
      parse_complete: number;
      parse_failed: number;
      chunk_queued: number;
      chunk_complete: number;
      chunk_failed: number;
    }[]
  >`
    SELECT
      count(*) FILTER (WHERE work_type = 'acquire_filing_source' AND status IN ('pending', 'running'))::integer AS source_queued,
      count(*) FILTER (WHERE work_type = 'acquire_filing_source' AND status = 'complete')::integer AS source_complete,
      count(*) FILTER (WHERE work_type = 'acquire_filing_source' AND status = 'failed')::integer AS source_failed,
      count(*) FILTER (WHERE work_type = 'parse_filing_source' AND status IN ('pending', 'running'))::integer AS parse_queued,
      count(*) FILTER (WHERE work_type = 'parse_filing_source' AND status = 'complete')::integer AS parse_complete,
      count(*) FILTER (WHERE work_type = 'parse_filing_source' AND status = 'failed')::integer AS parse_failed
      , count(*) FILTER (WHERE work_type = 'chunk_document' AND status IN ('pending', 'running'))::integer AS chunk_queued
      , count(*) FILTER (WHERE work_type = 'chunk_document' AND status = 'complete')::integer AS chunk_complete
      , count(*) FILTER (WHERE work_type = 'chunk_document' AND status = 'failed')::integer AS chunk_failed
    FROM work_items WHERE job_id = ${jobId}
  `;
  const progress = rows[0];
  const failed =
    progress.source_failed + progress.parse_failed + progress.chunk_failed;
  const queued =
    progress.source_queued + progress.parse_queued + progress.chunk_queued;
  const status = queued > 0 ? "running" : failed > 0 ? "partial" : "complete";
  await sql`
    UPDATE jobs
    SET status = ${status},
        progress = progress || ${sql.json({
          sourceAcquisition: {
            status:
              progress.source_failed > 0
                ? "partial"
                : progress.source_queued > 0
                  ? "running"
                  : "complete",
            queued: progress.source_queued,
            complete: progress.source_complete,
            failed: progress.source_failed,
          },
          parsing: {
            status:
              progress.parse_failed > 0
                ? "partial"
                : progress.parse_queued > 0
                  ? "running"
                  : "complete",
            queued: progress.parse_queued,
            complete: progress.parse_complete,
            failed: progress.parse_failed,
          },
          chunking: {
            status:
              progress.chunk_failed > 0
                ? "partial"
                : progress.chunk_queued > 0
                  ? "running"
                  : "complete",
            queued: progress.chunk_queued,
            complete: progress.chunk_complete,
            failed: progress.chunk_failed,
          },
        })},
        updated_at = now()
    WHERE id = ${jobId}
  `;
}

async function completeWork(item: WorkItem): Promise<void> {
  await queue.transaction(item, async (sql) => {
    await sql`UPDATE work_items SET status = 'complete', lease_owner = null, lease_expires_at = null, updated_at = now() WHERE id = ${item.id}`;
    if (item.work_type === "embed_document") {
      await sql`UPDATE jobs SET status = 'complete', progress = '{"embeddings":"complete"}', updated_at = now() WHERE id = ${item.job_id}`;
    }
  });
}

async function failWork(item: WorkItem, error: unknown): Promise<void> {
  const message =
    error instanceof Error ? error.message : "Unknown worker failure.";
  const retry = item.attempt_count < 3;
  await queue.transaction(item, async (sql) => {
    await sql`
      UPDATE work_items
      SET status = ${retry ? "pending" : "failed"}, next_run_at = now() + interval '30 seconds', lease_owner = null, lease_expires_at = null,
          error_code = ${item.work_type === "embed_document" ? "embedding_failed" : item.work_type === "acquire_filing_source" ? "source_acquisition_failed" : item.work_type === "parse_filing_source" ? "filing_parse_failed" : item.work_type === "chunk_document" ? "filing_chunking_failed" : "sec_ingestion_failed"}, error_message = ${message}, updated_at = now()
      WHERE id = ${item.id}
    `;
    await sql`UPDATE jobs SET status = ${retry ? "running" : "partial"}, last_error = ${message}, updated_at = now() WHERE id = ${item.job_id}`;
  });
  console.error(
    JSON.stringify({
      event: "worker.work_failed",
      workItemId: item.id,
      jobId: item.job_id,
      message,
    }),
  );
}

await queue.recoverExpired();

const backfill = await backfillSearchIndex(sql);
console.info(JSON.stringify({ event: "worker.search_backfill", ...backfill }));
await retrieval.queue();

let polling = false;
let lastEmbeddingScan = Date.now();
const idleLoop = setInterval(() => {
  if (polling) return;
  polling = true;
  void (async () => {
    const item = await queue.claim();
    if (!item) {
      if (Date.now() - lastEmbeddingScan > 30_000) {
        lastEmbeddingScan = Date.now();
        await retrieval.queue();
      }
      return;
    }
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void queue.renew(item).catch((error: unknown) => {
        console.error(JSON.stringify({ event: "worker.heartbeat_failed", workItemId: item.id, message: String(error) }));
      }).finally(() => { renewing = false; });
    }, 30_000);
    const assertOwnership = (tx: TransactionSql) => queue.assertOwnership(tx, item);
    try {
      if (
        item.work_type === "resolve_company" ||
        item.work_type === "resolve_company_preview"
      )
        await resolveCompany(item);
      else if (item.work_type === "fetch_metadata") await fetchMetadata(item);
      else if (item.work_type === "acquire_filing_source")
        await acquireFilingSource(item);
      else if (item.work_type === "parse_filing_source")
        await parseFilingSource(sql, config, item, assertOwnership);
      else if (item.work_type === "chunk_document") {
        await chunkDocument(sql, item, assertOwnership);
      } else {
        await retrieval.embedDocument(item.document_id!, item.input.profileKey, assertOwnership);
      }
      await completeWork(item);
      if (item.work_type === "chunk_document") await retrieval.queue(item.company_id ?? undefined);
      if (
        item.work_type === "acquire_filing_source" ||
        item.work_type === "parse_filing_source" ||
        item.work_type === "chunk_document"
      )
        await refreshPipelineProgress(item.job_id);
      console.info(
        JSON.stringify({
          event: "worker.work_complete",
          workItemId: item.id,
          jobId: item.job_id,
          workType: item.work_type,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "worker.work_exception",
          workItemId: item.id,
          jobId: item.job_id,
          workType: item.work_type,
          stack: error instanceof Error ? error.stack : undefined,
        }),
      );
      if (!(error instanceof LeaseLostError)) {
        await failWork(item, error).catch((failure: unknown) => {
          if (!(failure instanceof LeaseLostError)) throw failure;
        });
      }
      if (
        item.work_type === "acquire_filing_source" ||
        item.work_type === "parse_filing_source" ||
        item.work_type === "chunk_document"
      )
        await refreshPipelineProgress(item.job_id);
    } finally {
      clearInterval(heartbeat);
    }
  })()
    .catch((error: unknown) =>
      console.error(
        JSON.stringify({
          event: "worker.poll_failed",
          message:
            error instanceof Error ? error.message : "Unknown poll failure.",
        }),
      ),
    )
    .finally(() => {
      polling = false;
    });
}, 500);
let recovering = false;
const recoveryLoop = setInterval(() => {
  if (recovering) return;
  recovering = true;
  void queue.recoverExpired().catch((error: unknown) => {
    console.error(JSON.stringify({ event: "worker.recovery_failed", message: String(error) }));
  }).finally(() => { recovering = false; });
}, 10_000);
const stop = () => {
  clearInterval(idleLoop);
  clearInterval(recoveryLoop);
  void sql.end({ timeout: 5 }).finally(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
