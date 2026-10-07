import cors from "@fastify/cors";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  assessReadiness,
  capabilities,
  chunkingProfileVersion,
  connectDatabase,
  inspectAiRuntime,
  loadConfig,
  type PlatformConfig,
  verifyAiChat,
} from "@secthing/platform";

function isoDate(value: string | Date | null): string | undefined {
  if (value === null) return undefined;
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

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
  app.get("/api/v1/system/ai/status", async () => inspectAiRuntime(config));
  app.post("/api/v1/system/ai/verify", async (_request, reply) => {
    const status = await inspectAiRuntime(config);
    if (status.status === "disabled") return reply.code(409).send({ error: "AI is disabled. Set AI_MODE to local or external before verification." });
    if (!status.chat.available) return reply.code(409).send({ error: "The configured chat model is unavailable.", status });
    try {
      const response = await verifyAiChat(config);
      return { status: "verified" as const, model: response.model, response: response.content, totalDurationNs: response.totalDurationNs ?? null };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "AI verification failed." });
    }
  });

  app.post("/api/v1/companies", async (request, reply) => {
    if (!config.secUserAgent) return reply.code(503).send({ error: "SEC ingestion is unavailable until SEC_USER_AGENT includes a contact email." });
    const parsed = companyRequest.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Ticker and an ISO start date are required.", details: parsed.error.flatten() });
    const { ticker, startDate } = parsed.data;
    const existing = await sql<{ id: number; cik: number; earliest_requested_filing_date: string | Date | null }[]>`
      SELECT companies.id, companies.cik, companies.earliest_requested_filing_date
      FROM companies
      JOIN company_ticker_aliases ON company_ticker_aliases.company_id = companies.id
      WHERE company_ticker_aliases.ticker = ${ticker}
      LIMIT 1
    `;
    const company = existing[0];
    const earliestRequestedDate = company ? isoDate(company.earliest_requested_filing_date) : undefined;
    const shouldExpand = Boolean(company && (!earliestRequestedDate || startDate < earliestRequestedDate));
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
      sql`SELECT filings.id, accession_number, form_type, filing_date, report_date, primary_document, is_supported, filing_status,
        (SELECT status FROM filing_documents WHERE filing_documents.filing_id = filings.id ORDER BY id DESC LIMIT 1) AS source_status
        , (SELECT normalized_documents.status FROM normalized_documents JOIN filing_documents ON filing_documents.id = normalized_documents.document_id WHERE filing_documents.filing_id = filings.id ORDER BY normalized_documents.id DESC LIMIT 1) AS parse_status
        FROM filings WHERE company_id = ${id.data} ORDER BY filing_date DESC`,
      sql`SELECT id, status, progress, last_error, created_at, updated_at FROM jobs WHERE company_id = ${id.data} ORDER BY id DESC LIMIT 10`,
    ]);
    return { company: companies[0], filings, jobs };
  });

  app.get("/api/v1/companies/:companyId/search", async (request, reply) => {
    const params = z.object({ companyId: z.coerce.number().int().positive() }).safeParse(request.params);
    const query = z.object({
      q: z.string().trim().min(2).max(500),
      formType: z.string().trim().min(1).max(32).optional(),
      sectionType: z.string().trim().min(1).max(64).optional(),
      filedAfter: z.string().date().optional(),
      filedBefore: z.string().date().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).safeParse(request.query);
    if (!params.success) return reply.code(400).send({ error: "Company id must be a positive integer." });
    if (!query.success) return reply.code(400).send({ error: "A search query of at least two characters and valid filters are required.", details: query.error.flatten() });
    if (query.data.filedAfter && query.data.filedBefore && query.data.filedAfter > query.data.filedBefore) {
      return reply.code(400).send({ error: "filedAfter cannot be later than filedBefore." });
    }
    const company = await sql<{ id: number }[]>`SELECT id FROM companies WHERE id = ${params.data.companyId}`;
    if (!company[0]) return reply.code(404).send({ error: "Company not found." });
    const results = await sql`
      SELECT chunks.id AS chunk_id, chunks.filing_id, chunks.document_id, chunks.section_id, chunks.source_span_id,
        chunks.start_offset, chunks.end_offset, chunks.token_estimate, chunks.chunk_profile,
        filings.form_type, filings.filing_date, filings.report_date, filings.accession_number,
        filing_documents.document_name, filing_sections.section_type, filing_sections.section_label,
        ts_rank_cd(chunks.search_vector, websearch_to_tsquery('english', ${query.data.q})) AS rank,
        ts_headline('english', chunks.chunk_text, websearch_to_tsquery('english', ${query.data.q}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=42, MinWords=18, MaxFragments=2, FragmentDelimiter= … ') AS snippet
      FROM chunks
      JOIN filings ON filings.id = chunks.filing_id
      JOIN filing_documents ON filing_documents.id = chunks.document_id
      JOIN filing_sections ON filing_sections.id = chunks.section_id
      WHERE chunks.company_id = ${params.data.companyId}
        AND chunks.chunk_profile_version = ${chunkingProfileVersion}
        AND chunks.search_vector @@ websearch_to_tsquery('english', ${query.data.q})
        AND (${query.data.formType ?? null}::text IS NULL OR filings.form_type = ${query.data.formType ?? null})
        AND (${query.data.sectionType ?? null}::text IS NULL OR filing_sections.section_type = ${query.data.sectionType ?? null})
        AND (${query.data.filedAfter ?? null}::date IS NULL OR filings.filing_date >= ${query.data.filedAfter ?? null}::date)
        AND (${query.data.filedBefore ?? null}::date IS NULL OR filings.filing_date <= ${query.data.filedBefore ?? null}::date)
      ORDER BY rank DESC, filings.filing_date DESC, chunks.id
      LIMIT ${query.data.limit}
    `;
    return { query: query.data.q, mode: "full_text" as const, results };
  });

  app.post("/api/v1/filings/:filingId/source/acquire", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { filingId?: string }).filingId);
    if (!id.success) return reply.code(400).send({ error: "Filing id must be a positive integer." });
    const filings = await sql<{ id: number; company_id: number; is_supported: boolean }[]>`
      SELECT id, company_id, is_supported FROM filings WHERE id = ${id.data}
    `;
    const filing = filings[0];
    if (!filing) return reply.code(404).send({ error: "Filing not found." });
    if (!filing.is_supported) return reply.code(409).send({ error: "Source acquisition is currently limited to supported MVP filing forms." });
    const active = await sql<{ id: number }[]>`
      SELECT id FROM work_items
      WHERE filing_id = ${filing.id} AND work_type = 'acquire_filing_source' AND status IN ('pending', 'running')
      LIMIT 1
    `;
    if (active[0]) return reply.code(409).send({ error: "Source acquisition is already queued for this filing." });
    const jobs = await sql<{ id: number }[]>`
      INSERT INTO jobs (job_type, company_id, status, progress)
      VALUES ('filing_source_acquisition', ${filing.company_id}, 'running', ${sql.json({ sourceAcquisition: { status: 'queued', queued: 1, complete: 0, failed: 0 } })})
      RETURNING id
    `;
    await sql`
      INSERT INTO work_items (job_id, work_type, company_id, filing_id, input)
      VALUES (${jobs[0].id}, 'acquire_filing_source', ${filing.company_id}, ${filing.id}, '{}'::jsonb)
    `;
    return reply.code(202).send({ jobId: jobs[0].id, message: "Primary SEC source acquisition queued." });
  });

  app.post("/api/v1/filings/:filingId/parse", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { filingId?: string }).filingId);
    if (!id.success) return reply.code(400).send({ error: "Filing id must be a positive integer." });
    const documents = await sql<{ id: number; filing_id: number; company_id: number }[]>`
      SELECT filing_documents.id, filing_documents.filing_id, filings.company_id
      FROM filing_documents JOIN filings ON filings.id = filing_documents.filing_id
      WHERE filing_documents.filing_id = ${id.data} AND filing_documents.status = 'downloaded'
      ORDER BY filing_documents.id DESC LIMIT 1
    `;
    const document = documents[0];
    if (!document) return reply.code(409).send({ error: "A preserved primary source is required before parsing." });
    const active = await sql<{ id: number }[]>`
      SELECT id FROM work_items
      WHERE document_id = ${document.id} AND work_type = 'parse_filing_source' AND status IN ('pending', 'running')
      LIMIT 1
    `;
    if (active[0]) return reply.code(409).send({ error: "Parsing is already queued for this source." });
    const jobs = await sql<{ id: number }[]>`
      INSERT INTO jobs (job_type, company_id, status, progress)
      VALUES ('filing_parsing', ${document.company_id}, 'running', ${sql.json({ parsing: { status: 'queued', queued: 1, complete: 0, failed: 0 } })})
      RETURNING id
    `;
    await sql`
      INSERT INTO work_items (job_id, work_type, company_id, filing_id, document_id, input)
      VALUES (${jobs[0].id}, 'parse_filing_source', ${document.company_id}, ${document.filing_id}, ${document.id}, '{}'::jsonb)
    `;
    return reply.code(202).send({ jobId: jobs[0].id, message: "Deterministic filing parsing queued." });
  });

  app.post("/api/v1/filings/:filingId/chunk", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { filingId?: string }).filingId);
    if (!id.success) return reply.code(400).send({ error: "Filing id must be a positive integer." });
    const documents = await sql<{ document_id: number; company_id: number; normalized_document_id: number; text_hash: string }[]>`
      SELECT filing_documents.id AS document_id, filings.company_id, normalized_documents.id AS normalized_document_id, normalized_documents.text_hash
      FROM normalized_documents
      JOIN filing_documents ON filing_documents.id = normalized_documents.document_id
      JOIN filings ON filings.id = filing_documents.filing_id
      WHERE filings.id = ${id.data} AND normalized_documents.status = 'parsed'
      ORDER BY normalized_documents.id DESC LIMIT 1
    `;
    const document = documents[0];
    if (!document) return reply.code(409).send({ error: "A parsed filing is required before chunking." });
    const active = await sql<{ id: number }[]>`
      SELECT id FROM work_items
      WHERE document_id = ${document.document_id} AND work_type = 'chunk_document' AND status IN ('pending', 'running')
      LIMIT 1
    `;
    if (active[0]) return reply.code(409).send({ error: "Chunking is already queued for this filing." });
    const existing = await sql<{ id: number }[]>`
      SELECT id FROM chunks
      WHERE normalized_document_id = ${document.normalized_document_id}
        AND normalized_text_hash = ${document.text_hash}
        AND chunk_profile_version = ${chunkingProfileVersion}
      LIMIT 1
    `;
    if (existing[0]) return reply.code(409).send({ error: "This parsed filing is already indexed with the current chunking profile." });
    const jobs = await sql<{ id: number }[]>`
      INSERT INTO jobs (job_type, company_id, status, progress)
      VALUES ('filing_chunking', ${document.company_id}, 'running', ${sql.json({ chunking: { status: 'queued', queued: 1, complete: 0, failed: 0 } })})
      RETURNING id
    `;
    await sql`
      INSERT INTO work_items (job_id, work_type, company_id, filing_id, document_id, input)
      VALUES (${jobs[0].id}, 'chunk_document', ${document.company_id}, ${id.data}, ${document.document_id}, '{}'::jsonb)
    `;
    return reply.code(202).send({ jobId: jobs[0].id, message: "Search indexing queued for the parsed filing." });
  });

  app.get("/api/v1/filings/:filingId/parsed", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { filingId?: string }).filingId);
    if (!id.success) return reply.code(400).send({ error: "Filing id must be a positive integer." });
    const documents = await sql<{ document_id: number; normalized_document_id: number; normalized_text_path: string; text_hash: string; warnings: string[]; form_type: string; accession_number: string }[]>`
      SELECT filing_documents.id AS document_id, normalized_documents.id AS normalized_document_id,
        normalized_documents.normalized_text_path, normalized_documents.text_hash, normalized_documents.warnings,
        filings.form_type, filings.accession_number
      FROM normalized_documents
      JOIN filing_documents ON filing_documents.id = normalized_documents.document_id
      JOIN filings ON filings.id = filing_documents.filing_id
      WHERE filings.id = ${id.data} AND normalized_documents.status = 'parsed'
      ORDER BY normalized_documents.id DESC LIMIT 1
    `;
    const document = documents[0];
    if (!document) return reply.code(409).send({ error: "A parsed filing is not available yet." });
    try {
      const text = await readFile(document.normalized_text_path, "utf8");
      const sections = await sql`
        SELECT filing_sections.id, section_type, section_label, confidence_status, source_spans.start_offset, source_spans.end_offset
        FROM filing_sections JOIN source_spans ON source_spans.id = filing_sections.source_span_id
        WHERE filing_sections.document_id = ${document.document_id}
        ORDER BY source_spans.start_offset
      `;
      return { filing: { id: id.data, formType: document.form_type, accessionNumber: document.accession_number }, document: { id: document.document_id, normalizedDocumentId: document.normalized_document_id, textHash: document.text_hash, warnings: document.warnings }, sections, text };
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? `The parsed filing text could not be read: ${error.message}` : "The parsed filing text could not be read." });
    }
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
