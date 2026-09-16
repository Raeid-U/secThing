import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  assessReadiness,
  capabilities,
  connectDatabase,
  loadConfig,
  type PlatformConfig,
} from "@secthing/platform";

export function buildServer(config: PlatformConfig = loadConfig()) {
  const app = Fastify({ logger: true });
  const sql = connectDatabase(config.databaseUrl);
  app.register(cors, { origin: true });
  app.addHook("onClose", async () => sql.end({ timeout: 5 }));

  const companyRequest = z.object({
    ticker: z.string().trim().min(1).max(16).transform((ticker) => ticker.toUpperCase()),
    startDate: z.string().date().refine((date) => date <= new Date().toISOString().slice(0, 10), "Start date cannot be in the future."),
  });

  app.get("/health", async () => ({ status: "ok" as const }));
  app.get("/ready", async (_request, reply) => {
    const readiness = await assessReadiness(config);
    if (readiness.status !== "ready") return reply.code(503).send(readiness);
    return readiness;
  });
  app.get("/api/v1/system/capabilities", async () => capabilities(config));

  app.post("/api/v1/companies", async (request, reply) => {
    if (!config.secUserAgent) return reply.code(503).send({ error: "SEC ingestion is unavailable until SEC_USER_AGENT includes a contact email." });
    const parsed = companyRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Ticker and an ISO start date are required.", details: parsed.error.flatten() });
    const { ticker, startDate } = parsed.data;
    const existing = await sql<{ id: number; cik: number; earliest_requested_filing_date: string | null }[]>`
      SELECT companies.id, companies.cik, companies.earliest_requested_filing_date
      FROM companies
      JOIN company_ticker_aliases ON company_ticker_aliases.company_id = companies.id
      WHERE company_ticker_aliases.ticker = ${ticker}
      LIMIT 1
    `;
    const company = existing[0];
    const shouldExpand = Boolean(company && (!company.earliest_requested_filing_date || startDate < company.earliest_requested_filing_date));
    if (company && !shouldExpand) {
      const latestJob = await sql<{ id: number; status: string; progress: unknown }[]>`
        SELECT id, status, progress FROM jobs WHERE company_id = ${company.id} ORDER BY id DESC LIMIT 1
      `;
      return { outcome: "existing" as const, companyId: company.id, cik: company.cik, job: latestJob[0] ?? null, message: `${ticker} already exists; the selected range is already covered.` };
    }
    const job = await sql<{ id: number }[]>`
      INSERT INTO jobs (job_type, company_id, requested_ticker, requested_start_date, status, progress)
      VALUES ('company_metadata_ingestion', ${company?.id ?? null}, ${ticker}, ${startDate}, 'pending', ${sql.json({ identity: company ? "complete" : "queued", metadata: "queued", filings: { discovered: 0, total: 0 } })})
      RETURNING id
    `;
    await sql`
      INSERT INTO work_items (job_id, work_type, company_id, input)
      VALUES (${job[0].id}, ${company ? 'fetch_metadata' : 'resolve_company'}, ${company?.id ?? null}, ${sql.json(company ? { startDate } : { ticker, startDate })})
    `;
    return reply.code(202).send({ outcome: company ? "refresh_queued" : "created", jobId: job[0].id, companyId: company?.id ?? null, message: company ? `Expanding ${ticker} to the requested earlier date.` : `Resolving ${ticker} through the official SEC mapping.` });
  });

  app.get("/api/v1/companies", async () => {
    return sql`
      SELECT companies.id, companies.cik, companies.legal_name, companies.exchange, companies.earliest_requested_filing_date, companies.latest_requested_filing_date,
        COALESCE(array_agg(company_ticker_aliases.ticker ORDER BY company_ticker_aliases.ticker) FILTER (WHERE company_ticker_aliases.ticker IS NOT NULL), '{}') AS tickers,
        (SELECT jobs.status FROM jobs WHERE jobs.company_id = companies.id ORDER BY jobs.id DESC LIMIT 1) AS ingestion_status,
        (SELECT jobs.progress FROM jobs WHERE jobs.company_id = companies.id ORDER BY jobs.id DESC LIMIT 1) AS progress
      FROM companies
      LEFT JOIN company_ticker_aliases ON company_ticker_aliases.company_id = companies.id
      GROUP BY companies.id
      ORDER BY companies.legal_name
    `;
  });

  app.get("/api/v1/companies/:companyId", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { companyId?: string }).companyId);
    if (!id.success) return reply.code(400).send({ error: "Company id must be a positive integer." });
    const companies = await sql`
      SELECT id, cik, legal_name, exchange, sic, sic_description, entity_type, fiscal_year_end, state_of_incorporation, state_of_incorporation_description,
        business_address, mailing_address, phone, former_names, earliest_requested_filing_date, latest_requested_filing_date
      FROM companies WHERE id = ${id.data}
    `;
    if (!companies[0]) return reply.code(404).send({ error: "Company not found." });
    const [filings, jobs] = await Promise.all([
      sql`SELECT id, accession_number, form_type, filing_date, report_date, primary_document, is_supported, filing_status FROM filings WHERE company_id = ${id.data} ORDER BY filing_date DESC`,
      sql`SELECT id, status, progress, last_error, created_at, updated_at FROM jobs WHERE company_id = ${id.data} ORDER BY id DESC LIMIT 10`,
    ]);
    return { company: companies[0], filings, jobs };
  });

  app.get("/api/v1/jobs/:jobId", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { jobId?: string }).jobId);
    if (!id.success) return reply.code(400).send({ error: "Job id must be a positive integer." });
    const jobs = await sql`SELECT id, company_id, requested_ticker, requested_start_date, status, progress, last_error, created_at, updated_at FROM jobs WHERE id = ${id.data}`;
    if (!jobs[0]) return reply.code(404).send({ error: "Job not found." });
    const workItems = await sql`SELECT id, work_type, status, attempt_count, error_code, error_message, updated_at FROM work_items WHERE job_id = ${id.data} ORDER BY id`;
    return { job: jobs[0], workItems };
  });
  return app;
}
