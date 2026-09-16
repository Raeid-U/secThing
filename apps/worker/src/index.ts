import { randomUUID } from "node:crypto";
import { connectDatabase, assessWorkerReadiness, isSupportedMvpForm, loadConfig, SecClient, type CompanySubmission } from "@secthing/platform";
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

type WorkItem = { id: number; job_id: number; work_type: "resolve_company" | "fetch_metadata"; company_id: number | null; attempt_count: number; input: { ticker?: string; startDate?: string } };
type Company = { id: number; cik: number };

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
    RETURNING id, job_id, work_type, company_id, attempt_count, input
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
  await sql`UPDATE jobs SET status = 'complete', progress = ${sql.json({ identity: "complete", metadata: "complete", filings: { discovered: counts.discovered, total: counts.total }, sourceAcquisition: "not_started", parsing: "not_started", chunking: "not_started" })}, updated_at = now() WHERE id = ${item.job_id}`;
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
        error_code = 'sec_ingestion_failed', error_message = ${message}, updated_at = now()
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
      else await fetchMetadata(item);
      await completeWork(item);
      console.info(JSON.stringify({ event: "worker.work_complete", workItemId: item.id, jobId: item.job_id, workType: item.work_type }));
    } catch (error) {
      console.error(JSON.stringify({ event: "worker.work_exception", workItemId: item.id, jobId: item.job_id, workType: item.work_type, stack: error instanceof Error ? error.stack : undefined }));
      await failWork(item, error);
    }
  })().catch((error: unknown) => console.error(JSON.stringify({ event: "worker.poll_failed", message: error instanceof Error ? error.message : "Unknown poll failure." }))).finally(() => { polling = false; });
}, 500);
const stop = () => {
  clearInterval(idleLoop);
  void sql.end({ timeout: 5 }).finally(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
