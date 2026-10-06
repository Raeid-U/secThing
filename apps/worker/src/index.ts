import { createHash, randomUUID } from "node:crypto";
import { connectDatabase, assessWorkerReadiness, FilingParser, filingParserVersion, isSupportedMvpForm, loadConfig, SecClient, type CompanySubmission } from "@secthing/platform";
import type { Sql } from "postgres";

const config = loadConfig();
const readiness = await assessWorkerReadiness(config);
if (readiness.status !== "ready") {
  console.error(JSON.stringify({ event: "worker.not_ready", ...readiness }));
  process.exit(1);
}

console.info(JSON.stringify({ event: "worker.ready", checks: readiness.checks }));
const sql = connectDatabase(config.databaseUrl);
const workerId = `worker-${randomUUID()}`;
const sec = new SecClient({ dataDir: config.dataDir, userAgent: config.secUserAgent, rateLimitPerSecond: config.secRateLimitPerSecond });
const parser = new FilingParser();

type WorkItem = { id: number; job_id: number; work_type: "resolve_company" | "fetch_metadata" | "acquire_filing_source" | "parse_filing_source"; company_id: number | null; filing_id: number | null; document_id: number | null; attempt_count: number; input: { ticker?: string; startDate?: string } };
type Company = { id: number; cik: number };
type SourceFiling = { id: number; cik: number; accession_number: string; form_type: string; primary_document: string | null };
type ParseDocument = { id: number; filing_id: number; form_type: string; local_path: string; content_type: string | null; content_hash: string };

async function storeResponse(response: { url: string; status: number; contentType: string | null; bodyPath: string; contentHash: string }) {
  await sql`
    INSERT INTO sec_responses (url, response_status, content_type, body_path, content_hash)
    VALUES (${response.url}, ${response.status}, ${response.contentType}, ${response.bodyPath}, ${response.contentHash})
    ON CONFLICT (url, content_hash) WHERE content_hash IS NOT NULL DO NOTHING
  `;
}

async function claimWork(): Promise<WorkItem | undefined> {
  const claimed = await sql<WorkItem[]>`
    UPDATE work_items
    SET status = 'running', lease_owner = ${workerId}, lease_expires_at = now() + interval '5 minutes', attempt_count = attempt_count + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM work_items
      WHERE status = 'pending' AND next_run_at <= now()
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, job_id, work_type, company_id, filing_id, document_id, attempt_count, input
  `;
  return claimed[0];
}

async function upsertCompany(cik: number, name: string, ticker: string): Promise<{ company: Company; existed: boolean }> {
  const prior = await sql<Company[]>`SELECT id, cik FROM companies WHERE cik = ${cik}`;
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
  if (!ticker || !startDate) throw new Error("Resolve work item is missing ticker or start date.");
  const { match, response } = await sec.resolveTicker(ticker);
  await storeResponse(response);
  const { company, existed } = await upsertCompany(match.cik, match.title, match.ticker);
  await sql`UPDATE jobs SET company_id = ${company.id}, status = 'running', progress = ${sql.json({ identity: "complete", metadata: "queued", filings: { discovered: 0, total: 0 }, existingCompany: existed })}, updated_at = now() WHERE id = ${item.job_id}`;
  await sql`
    INSERT INTO work_items (job_id, work_type, company_id, input)
    VALUES (${item.job_id}, 'fetch_metadata', ${company.id}, ${sql.json({ startDate })})
  `;
}

async function persistSubmission(company: Company, submission: CompanySubmission, startDate: string): Promise<{ discovered: number; total: number }> {
  const today = new Date().toISOString().slice(0, 10);
  for (const response of submission.cachedResponses) await storeResponse(response);
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
  const relevant = submission.filings.filter((filing) => filing.filingDate >= startDate && filing.filingDate <= today);
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
  const total = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM filings WHERE company_id = ${company.id}`;
  return { discovered: relevant.length, total: total[0].count };
}

async function fetchMetadata(item: WorkItem): Promise<void> {
  if (!item.company_id) throw new Error("Metadata work item is missing a company.");
  const startDate = item.input.startDate;
  if (!startDate) throw new Error("Metadata work item is missing a start date.");
  const companies = await sql<Company[]>`SELECT id, cik FROM companies WHERE id = ${item.company_id}`;
  const company = companies[0];
  if (!company) throw new Error("Company no longer exists.");
  const submission = await sec.fetchCompanySubmission(company.cik);
  const counts = await persistSubmission(company, submission, startDate);
  const queued = await queueSourceAcquisition(item.job_id, company.id);
  await sql`
    UPDATE jobs
    SET status = ${queued > 0 ? "running" : "complete"},
        progress = ${sql.json({ identity: "complete", metadata: "complete", filings: { discovered: counts.discovered, total: counts.total }, sourceAcquisition: { status: queued > 0 ? "queued" : "not_applicable", queued, complete: 0, failed: 0 }, parsing: "not_started", chunking: "not_started" })},
        updated_at = now()
    WHERE id = ${item.job_id}
  `;
}

async function queueSourceAcquisition(jobId: number, companyId: number): Promise<number> {
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
  if (!item.filing_id) throw new Error("Source-acquisition work item is missing a filing.");
  const filings = await sql<SourceFiling[]>`
    SELECT id, cik, accession_number, form_type, primary_document
    FROM filings WHERE id = ${item.filing_id}
  `;
  const filing = filings[0];
  if (!filing) throw new Error("Filing no longer exists.");
  const document = await sec.acquirePrimaryFiling({
    cik: filing.cik,
    accessionNumber: filing.accession_number,
    formType: filing.form_type,
    primaryDocument: filing.primary_document ?? undefined,
  });
  await storeResponse(document.indexResponse);
  const documents = await sql<{ id: number }[]>`
    INSERT INTO filing_documents (filing_id, document_name, document_type, sec_url, local_path, content_type, content_hash, byte_size, status, fetched_at)
    VALUES (${filing.id}, ${document.documentName}, ${document.documentType}, ${document.url}, ${document.bodyPath}, ${document.contentType}, ${document.contentHash}, ${document.byteSize}, 'downloaded', now())
    ON CONFLICT (filing_id, document_name) DO UPDATE SET
      document_type = EXCLUDED.document_type, sec_url = EXCLUDED.sec_url, local_path = EXCLUDED.local_path,
      content_type = EXCLUDED.content_type, content_hash = EXCLUDED.content_hash, byte_size = EXCLUDED.byte_size,
      status = 'downloaded', last_error = NULL, fetched_at = now(), updated_at = now()
    RETURNING id
  `;
  await sql`UPDATE filings SET filing_status = 'source_acquired', updated_at = now() WHERE id = ${filing.id}`;
  await queueParsing(item.job_id, item.company_id, filing.id, documents[0].id);
}

async function queueParsing(jobId: number, companyId: number | null, filingId: number, documentId: number): Promise<void> {
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

async function parseFilingSource(item: WorkItem): Promise<void> {
  if (!item.document_id || !item.filing_id) throw new Error("Parse work item is missing a document or filing.");
  const documents = await sql<ParseDocument[]>`
    SELECT filing_documents.id, filing_documents.filing_id, filings.form_type, filing_documents.local_path,
      filing_documents.content_type, filing_documents.content_hash
    FROM filing_documents JOIN filings ON filings.id = filing_documents.filing_id
    WHERE filing_documents.id = ${item.document_id}
  `;
  const document = documents[0];
  if (!document?.local_path || !document.content_hash) throw new Error("Downloaded filing source is missing its local path or content hash.");
  const parsed = await parser.parse({ sourcePath: document.local_path, contentType: document.content_type, formType: document.form_type, dataDir: config.dataDir });
  await sql.begin(async (transaction) => {
    const normalized = await transaction<{ id: number }[]>`
      INSERT INTO normalized_documents (document_id, parser_version, source_content_hash, normalized_text_path, text_hash, text_length, status, warnings)
      VALUES (${document.id}, ${filingParserVersion}, ${document.content_hash}, ${parsed.normalizedTextPath}, ${parsed.textHash}, ${parsed.textLength}, 'parsed', ${transaction.json(parsed.warnings)})
      ON CONFLICT (document_id, parser_version) DO UPDATE SET
        source_content_hash = EXCLUDED.source_content_hash, normalized_text_path = EXCLUDED.normalized_text_path,
        text_hash = EXCLUDED.text_hash, text_length = EXCLUDED.text_length, status = 'parsed', warnings = EXCLUDED.warnings,
        parsed_at = now(), updated_at = now()
      RETURNING id
    `;
    const normalizedDocumentId = normalized[0].id;
    await transaction`DELETE FROM filing_sections WHERE document_id = ${document.id}`;
    await transaction`DELETE FROM source_spans WHERE normalized_document_id = ${normalizedDocumentId}`;
    const fullSpan = await transaction<{ id: number }[]>`
      INSERT INTO source_spans (normalized_document_id, start_offset, end_offset, span_text_hash, span_kind)
      VALUES (${normalizedDocumentId}, 0, ${parsed.textLength}, ${parsed.textHash}, 'document') RETURNING id
    `;
    if (parsed.sections.length === 0) {
      await transaction`
        INSERT INTO filing_sections (filing_id, document_id, section_type, section_label, source_span_id, confidence_status)
        VALUES (${document.filing_id}, ${document.id}, 'unknown', 'Full document', ${fullSpan[0].id}, 'not_found')
      `;
    } else {
      for (const section of parsed.sections) {
        const span = await transaction<{ id: number }[]>`
          INSERT INTO source_spans (normalized_document_id, start_offset, end_offset, span_text_hash, span_kind)
          VALUES (${normalizedDocumentId}, ${section.startOffset}, ${section.endOffset}, ${createHash("sha256").update(parsed.text.slice(section.startOffset, section.endOffset)).digest("hex")}, 'section')
          RETURNING id
        `;
        await transaction`
          INSERT INTO filing_sections (filing_id, document_id, section_type, section_label, source_span_id, confidence_status)
          VALUES (${document.filing_id}, ${document.id}, ${section.sectionType}, ${section.label}, ${span[0].id}, ${section.confidenceStatus})
        `;
      }
    }
  });
  await sql`UPDATE filings SET filing_status = 'parsed', updated_at = now() WHERE id = ${document.filing_id}`;
}

async function refreshPipelineProgress(jobId: number): Promise<void> {
  const rows = await sql<{ source_queued: number; source_complete: number; source_failed: number; parse_queued: number; parse_complete: number; parse_failed: number }[]>`
    SELECT
      count(*) FILTER (WHERE work_type = 'acquire_filing_source' AND status IN ('pending', 'running'))::integer AS source_queued,
      count(*) FILTER (WHERE work_type = 'acquire_filing_source' AND status = 'complete')::integer AS source_complete,
      count(*) FILTER (WHERE work_type = 'acquire_filing_source' AND status = 'failed')::integer AS source_failed,
      count(*) FILTER (WHERE work_type = 'parse_filing_source' AND status IN ('pending', 'running'))::integer AS parse_queued,
      count(*) FILTER (WHERE work_type = 'parse_filing_source' AND status = 'complete')::integer AS parse_complete,
      count(*) FILTER (WHERE work_type = 'parse_filing_source' AND status = 'failed')::integer AS parse_failed
    FROM work_items WHERE job_id = ${jobId}
  `;
  const progress = rows[0];
  const failed = progress.source_failed + progress.parse_failed;
  const queued = progress.source_queued + progress.parse_queued;
  const status = failed > 0 ? 'partial' : queued > 0 ? 'running' : 'complete';
  await sql`
    UPDATE jobs
    SET status = ${status},
        progress = progress || ${sql.json({
          sourceAcquisition: { status: progress.source_failed > 0 ? 'partial' : progress.source_queued > 0 ? 'running' : 'complete', queued: progress.source_queued, complete: progress.source_complete, failed: progress.source_failed },
          parsing: { status: progress.parse_failed > 0 ? 'partial' : progress.parse_queued > 0 ? 'running' : 'complete', queued: progress.parse_queued, complete: progress.parse_complete, failed: progress.parse_failed },
        })},
        updated_at = now()
    WHERE id = ${jobId}
  `;
}

async function completeWork(item: WorkItem): Promise<void> {
  await sql`UPDATE work_items SET status = 'complete', lease_owner = null, lease_expires_at = null, updated_at = now() WHERE id = ${item.id}`;
}

async function failWork(item: WorkItem, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown worker failure.";
  const retry = item.attempt_count < 3;
  await sql`
    UPDATE work_items
    SET status = ${retry ? 'pending' : 'failed'}, next_run_at = now() + interval '30 seconds', lease_owner = null, lease_expires_at = null,
        error_code = ${item.work_type === 'acquire_filing_source' ? 'source_acquisition_failed' : item.work_type === 'parse_filing_source' ? 'filing_parse_failed' : 'sec_ingestion_failed'}, error_message = ${message}, updated_at = now()
    WHERE id = ${item.id}
  `;
  await sql`UPDATE jobs SET status = ${retry ? 'running' : 'partial'}, last_error = ${message}, updated_at = now() WHERE id = ${item.job_id}`;
  console.error(JSON.stringify({ event: "worker.work_failed", workItemId: item.id, jobId: item.job_id, message }));
}

await sql`UPDATE work_items SET status = 'pending', lease_owner = null, lease_expires_at = null, updated_at = now() WHERE status = 'running' AND lease_expires_at < now()`;

let polling = false;
const idleLoop = setInterval(() => {
  if (polling) return;
  polling = true;
  void (async () => {
    const item = await claimWork();
    if (!item) return;
    try {
      if (item.work_type === "resolve_company") await resolveCompany(item);
      else if (item.work_type === "fetch_metadata") await fetchMetadata(item);
      else if (item.work_type === "acquire_filing_source") await acquireFilingSource(item);
      else await parseFilingSource(item);
      await completeWork(item);
      if (item.work_type === "acquire_filing_source" || item.work_type === "parse_filing_source") await refreshPipelineProgress(item.job_id);
      console.info(JSON.stringify({ event: "worker.work_complete", workItemId: item.id, jobId: item.job_id, workType: item.work_type }));
    } catch (error) {
      console.error(JSON.stringify({ event: "worker.work_exception", workItemId: item.id, jobId: item.job_id, workType: item.work_type, stack: error instanceof Error ? error.stack : undefined }));
      await failWork(item, error);
      if (item.work_type === "acquire_filing_source" || item.work_type === "parse_filing_source") await refreshPipelineProgress(item.job_id);
    }
  })().catch((error: unknown) => console.error(JSON.stringify({ event: "worker.poll_failed", message: error instanceof Error ? error.message : "Unknown poll failure." }))).finally(() => { polling = false; });
}, 500);
const stop = () => {
  clearInterval(idleLoop);
  void sql.end({ timeout: 5 }).finally(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
