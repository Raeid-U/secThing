import cors from "@fastify/cors";
import sanitizeHtml from "sanitize-html";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  Retrieval,
  CorpusCatalog,
  GroundedAnswer,
  chunkingProfileVersion,
  assessReadiness,
  backfillSearchIndex,
  capabilities,
  filingParserVersion,
  connectDatabase,
  inspectAiRuntime,
  loadConfig,
  type PlatformConfig,
  verifyAiChat,
  type ChatProvider,
  type EmbeddingProvider,
} from "@secthing/platform";

function isoDate(value: string | Date | null): string | undefined {
  if (value === null) return undefined;
  return typeof value === "string"
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
}

export function buildServer(config: PlatformConfig = loadConfig(), providers: { chat?: ChatProvider; embeddings?: EmbeddingProvider } = {}) {
  const app = Fastify({ logger: true });
  const sql = connectDatabase(config.databaseUrl);
  const retrieval = new Retrieval(sql, config, providers.embeddings);
  const corpus = new CorpusCatalog(sql, config, retrieval);
  const groundedAnswer = new GroundedAnswer(sql, config, providers.chat, retrieval);
  app.register(cors, { origin: true });
  app.addHook("onClose", async () => sql.end({ timeout: 5 }));

  const companyRequest = z.object({
    refresh: z.boolean().default(false),
    lookback: z.enum(["3", "5", "10", "20", "50", "all", "custom"]).optional(),
    confirmedCik: z.coerce.number().int().positive().optional(),
    ticker: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .transform((ticker) => ticker.toUpperCase()),
    startDate: z
      .string()
      .date()
      .refine(
        (date) => date <= new Date().toISOString().slice(0, 10),
        "Start date cannot be in the future.",
      ),
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
    if (status.status === "disabled")
      return reply
        .code(409)
        .send({
          error:
            "AI is disabled. Set AI_MODE to local or external before verification.",
        });
    if (!status.chat.available)
      return reply
        .code(409)
        .send({ error: "The configured chat model is unavailable.", status });
    try {
      const response = await verifyAiChat(config);
      return {
        status: "verified" as const,
        model: response.model,
        response: response.content,
        totalDurationNs: response.totalDurationNs ?? null,
      };
    } catch (error) {
      return reply
        .code(502)
        .send({
          error:
            error instanceof Error ? error.message : "AI verification failed.",
        });
    }
  });

  app.post("/api/v1/companies/resolve", async (request, reply) => {
    if (!config.secUserAgent)
      return reply
        .code(503)
        .send({
          error: "Configure SEC_USER_AGENT before looking up companies.",
        });
    const parsed = z
      .object({
        ticker: z
          .string()
          .trim()
          .min(1)
          .max(16)
          .transform((v) => v.toUpperCase()),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Enter a valid ticker." });
    const existing =
      await sql`SELECT c.id, c.cik, c.legal_name AS name, a.ticker, c.exchange, c.earliest_requested_filing_date
      FROM companies c JOIN company_ticker_aliases a ON a.company_id = c.id WHERE a.ticker = ${parsed.data.ticker} LIMIT 1`;
    if (existing[0]) return { company: { ...existing[0], existed: true } };
    const result = await sql.begin(async (tx) => {
      const jobs =
        await tx`INSERT INTO jobs (job_type, requested_ticker, status)
        VALUES ('company_identity_preview', ${parsed.data.ticker}, 'pending') RETURNING id`;
      await tx`INSERT INTO work_items (job_id, work_type, input)
        VALUES (${jobs[0].id}, 'resolve_company_preview', ${tx.json({ ticker: parsed.data.ticker, startDate: new Date().toISOString().slice(0, 10) })})`;
      return jobs[0].id;
    });
    return reply.code(202).send({ jobId: result });
  });

  app.post("/api/v1/companies", async (request, reply) => {
    if (!config.secUserAgent)
      return reply
        .code(503)
        .send({
          error:
            "SEC ingestion is unavailable until SEC_USER_AGENT includes a contact email.",
        });
    const parsed = companyRequest.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({
          error: "Ticker and an ISO start date are required.",
          details: parsed.error.flatten(),
        });
    const { ticker, startDate, refresh, lookback, confirmedCik } = parsed.data;
    const existing = await sql<
      {
        id: number;
        cik: number;
        earliest_requested_filing_date: string | Date | null;
      }[]
    >`
      SELECT companies.id, companies.cik, companies.earliest_requested_filing_date
      FROM companies
      JOIN company_ticker_aliases ON company_ticker_aliases.company_id = companies.id
      WHERE company_ticker_aliases.ticker = ${ticker}
      LIMIT 1
    `;
    let company = existing[0];
    if (!company && confirmedCik) {
      const resolved = await sql<{ progress: { company: { name: string; cik: number } } }[]>`
        SELECT progress FROM jobs WHERE job_type = 'company_identity_preview' AND status = 'complete'
          AND requested_ticker = ${ticker} AND progress->'company'->>'cik' = ${String(confirmedCik)}
          AND updated_at > now() - interval '24 hours' ORDER BY id DESC LIMIT 1
      `;
      if (!resolved[0]) return reply.code(409).send({ error: "Resolve the company again before confirming its identity." });
      company = await sql.begin(async (tx) => {
        const rows = await tx<{ id: number; cik: number; earliest_requested_filing_date: string | Date | null }[]>`
          INSERT INTO companies (cik, legal_name, identity_source, identity_fetched_at)
          VALUES (${confirmedCik}, ${resolved[0].progress.company.name}, 'sec_ticker_mapping', now())
          ON CONFLICT (cik) DO UPDATE SET updated_at = now()
          RETURNING id, cik, earliest_requested_filing_date
        `;
        await tx`INSERT INTO company_ticker_aliases (company_id, ticker, source)
          VALUES (${rows[0].id}, ${ticker}, 'sec_ticker_mapping') ON CONFLICT (company_id, ticker) DO NOTHING`;
        return rows[0];
      });
    }
    const earliestRequestedDate = company
      ? isoDate(company.earliest_requested_filing_date)
      : undefined;
    const shouldExpand = Boolean(
      company && (!earliestRequestedDate || startDate < earliestRequestedDate),
    );
    if (confirmedCik && (!company || Number(company.cik) !== confirmedCik))
      return reply
        .code(409)
        .send({
          error:
            "Company identity changed. Resolve the ticker again before starting.",
        });
    if (company && lookback)
      await sql`UPDATE companies SET requested_lookback = ${lookback} WHERE id = ${company.id}`;
    if (company && !shouldExpand && !refresh) {
      const latestJob = await sql<
        { id: number; status: string; progress: unknown }[]
      >`
        SELECT id, status, progress FROM jobs WHERE company_id = ${company.id} ORDER BY id DESC LIMIT 1
      `;
      return {
        outcome: "existing" as const,
        companyId: company.id,
        cik: company.cik,
        job: latestJob[0] ?? null,
        message: `${ticker} already exists; the selected range is already covered.`,
      };
    }
    const job = await sql<{ id: number }[]>`
      INSERT INTO jobs (job_type, company_id, requested_ticker, requested_start_date, status, progress)
      VALUES ('company_metadata_ingestion', ${company?.id ?? null}, ${ticker}, ${startDate}, 'pending', ${sql.json({ identity: company ? "complete" : "queued", metadata: "queued", filings: { discovered: 0, total: 0 } })})
      RETURNING id
    `;
    await sql`
      INSERT INTO work_items (job_id, work_type, company_id, input)
      VALUES (${job[0].id}, ${company ? "fetch_metadata" : "resolve_company"}, ${company?.id ?? null}, ${sql.json(company ? { startDate } : { ticker, startDate })})
    `;
    return reply
      .code(202)
      .send({
        outcome: company ? "refresh_queued" : "created",
        jobId: job[0].id,
        companyId: company?.id ?? null,
        message: company
          ? `Updating ${ticker} filing coverage.`
          : `Resolving ${ticker} through the official SEC mapping.`,
      });
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
    const id = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((request.params as { companyId?: string }).companyId);
    if (!id.success)
      return reply
        .code(400)
        .send({ error: "Company id must be a positive integer." });
    const companies = await sql`
      SELECT id, cik, legal_name, exchange, sic, sic_description, entity_type, fiscal_year_end, state_of_incorporation, state_of_incorporation_description,
        business_address, mailing_address, phone, former_names, earliest_requested_filing_date, latest_requested_filing_date
      FROM companies WHERE id = ${id.data}
    `;
    if (!companies[0])
      return reply.code(404).send({ error: "Company not found." });
    const [filings, jobs, search] = await Promise.all([
      sql`SELECT filings.id, (SELECT d.id FROM filing_documents d WHERE d.filing_id = filings.id ORDER BY d.id DESC LIMIT 1) AS document_id,
        (SELECT d.sec_url FROM filing_documents d WHERE d.filing_id = filings.id ORDER BY id DESC LIMIT 1) AS sec_url,
        (SELECT count(*)::integer FROM chunks c JOIN normalized_documents n ON n.id = c.normalized_document_id JOIN filing_documents d ON d.id = c.document_id WHERE c.filing_id = filings.id AND c.chunk_profile_version = ${chunkingProfileVersion} AND n.status = 'parsed' AND n.parser_version = ${filingParserVersion} AND c.normalized_text_hash = n.text_hash AND n.source_content_hash = d.content_hash) AS chunk_count,
        (SELECT CASE WHEN w.status = 'failed' THEN w.error_message ELSE NULL END FROM work_items w WHERE w.filing_id = filings.id ORDER BY w.id DESC LIMIT 1) AS last_error,
        accession_number, form_type, filing_date, report_date, primary_document, is_supported, filing_status,
        (SELECT status FROM filing_documents WHERE filing_documents.filing_id = filings.id ORDER BY id DESC LIMIT 1) AS source_status
        , (SELECT normalized_documents.status FROM normalized_documents JOIN filing_documents ON filing_documents.id = normalized_documents.document_id WHERE filing_documents.filing_id = filings.id AND normalized_documents.parser_version = ${filingParserVersion} AND normalized_documents.source_content_hash = filing_documents.content_hash ORDER BY normalized_documents.parsed_at DESC LIMIT 1) AS parse_status
        FROM filings WHERE company_id = ${id.data} ORDER BY filing_date DESC`,
      sql`SELECT id, status, progress, last_error, created_at, updated_at FROM jobs WHERE company_id = ${id.data} ORDER BY id DESC LIMIT 10`,
      retrieval.status(id.data),
    ]);
    return { company: companies[0], filings, jobs, search };
  });

  app.get("/api/v1/companies/:companyId/search", async (request, reply) => {
    const params = z
      .object({ companyId: z.coerce.number().int().positive() })
      .safeParse(request.params);
    const query = z
      .object({
        q: z.string().trim().min(2).max(500),
        mode: z.enum(["full_text", "semantic", "hybrid"]).default("full_text"),
        formType: z.string().trim().min(1).max(32).optional(),
        sectionType: z.string().trim().min(1).max(64).optional(),
        filedAfter: z.string().date().optional(),
        filedBefore: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .safeParse(request.query);
    if (!params.success)
      return reply
        .code(400)
        .send({ error: "Company id must be a positive integer." });
    if (!query.success)
      return reply
        .code(400)
        .send({
          error:
            "A search query of at least two characters and valid filters are required.",
          details: query.error.flatten(),
        });
    if (
      query.data.filedAfter &&
      query.data.filedBefore &&
      query.data.filedAfter > query.data.filedBefore
    ) {
      return reply
        .code(400)
        .send({ error: "filedAfter cannot be later than filedBefore." });
    }
    const company = await sql<
      { id: number }[]
    >`SELECT id FROM companies WHERE id = ${params.data.companyId}`;
    if (!company[0])
      return reply.code(404).send({ error: "Company not found." });
    try {
      return await retrieval.search(
        params.data.companyId,
        query.data.q,
        query.data.mode,
        query.data,
      );
    } catch (error) {
      return reply
        .code(503)
        .send({
          error:
            error instanceof Error ? error.message : "Search is unavailable.",
        });
    }
  });

  app.get("/api/v1/companies/:companyId/corpus", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { companyId?: string }).companyId);
    if (!id.success) return reply.code(400).send({ error: "Company id must be a positive integer." });
    if (!(await sql`SELECT id FROM companies WHERE id = ${id.data}`)[0]) return reply.code(404).send({ error: "Company not found." });
    return { ...(await corpus.status(id.data)), externalEmbeddingEstimate: config.aiMode === "external" ? await corpus.embeddingEstimate(id.data) : null };
  });

  app.post("/api/v1/companies/:companyId/corpus/retry", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { companyId?: string }).companyId);
    const body = z.object({ documentIds: z.array(z.coerce.number().int().positive()).max(100).optional() }).safeParse(request.body ?? {});
    if (!id.success || !body.success) return reply.code(400).send({ error: "Valid company and optional document ids are required." });
    const result = await corpus.retry(id.data, body.data.documentIds);
    return reply.code(result.queued ? 202 : 200).send(result);
  });

  app.post("/api/v1/companies/:companyId/embeddings/approve", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { companyId?: string }).companyId);
    const body = z.object({ corpusFingerprint: z.string().min(1), profileKey: z.string().min(1) }).safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "The current corpus fingerprint and profile key are required." });
    if (config.aiMode !== "external") return reply.code(409).send({ error: "Approval is only required for external embeddings." });
    const approved = await corpus.approveEmbeddings(id.data, body.data.corpusFingerprint, body.data.profileKey);
    if (!approved) return reply.code(409).send({ error: "The estimate is stale. Refresh corpus status before approving." });
    const queued = await retrieval.queue(id.data, true);
    return reply.code(202).send({ approved, ...queued });
  });

  app.post("/api/v1/companies/:companyId/questions", async (request, reply) => {
    const id = z.coerce.number().int().positive().safeParse((request.params as { companyId?: string }).companyId);
    const body = z.object({ question: z.string().trim().min(2).max(2_000) }).safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "A valid company and question are required." });
    const company = await sql`SELECT id FROM companies WHERE id = ${id.data}`;
    if (!company[0]) return reply.code(404).send({ error: "Company not found." });
    const status = await corpus.status(id.data);
    if (status.readiness !== "ready" && status.readiness !== "ready_with_exclusions")
      return reply.code(409).send({ error: "The filing corpus is not operationally complete yet.", corpus: status });
    if (!config.aiChatProvider || !config.aiChatBaseUrl || !config.aiChatModel)
      return reply.code(503).send({ error: "A chat provider and model must be configured for grounded questions." });
    try {
      return { ...(await groundedAnswer.answer(id.data, body.data.question)), externalDisclosure: config.aiMode === "external" ? "The bounded evidence package for this question was sent to the configured external chat provider." : null };
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : "Grounded answer generation failed." });
    }
  });

  app.post(
    "/api/v1/companies/:companyId/search/reindex",
    async (request, reply) => {
      const id = z.coerce
        .number()
        .int()
        .positive()
        .safeParse((request.params as { companyId?: string }).companyId);
      if (!id.success)
        return reply
          .code(400)
          .send({ error: "Company id must be a positive integer." });
      const company = await sql`SELECT id FROM companies WHERE id = ${id.data}`;
      if (!company[0])
        return reply.code(404).send({ error: "Company not found." });
      const result = await backfillSearchIndex(sql, { companyId: id.data });
      const semantic = await retrieval.queue(id.data, true);
      if (semantic.queued)
        return reply
          .code(202)
          .send({ ...result, embeddingsQueued: semantic.queued });
      return reply.code(result.queued > 0 ? 202 : 200).send(result);
    },
  );

  app.post(
    "/api/v1/filings/:filingId/source/acquire",
    async (request, reply) => {
      const id = z.coerce
        .number()
        .int()
        .positive()
        .safeParse((request.params as { filingId?: string }).filingId);
      if (!id.success)
        return reply
          .code(400)
          .send({ error: "Filing id must be a positive integer." });
      const filings = await sql<
        { id: number; company_id: number; is_supported: boolean }[]
      >`
      SELECT id, company_id, is_supported FROM filings WHERE id = ${id.data}
    `;
      const filing = filings[0];
      if (!filing) return reply.code(404).send({ error: "Filing not found." });
      if (!filing.is_supported)
        return reply
          .code(409)
          .send({
            error:
              "Source acquisition is currently limited to supported MVP filing forms.",
          });
      const active = await sql<{ id: number }[]>`
      SELECT id FROM work_items
      WHERE filing_id = ${filing.id} AND work_type = 'acquire_filing_source' AND status IN ('pending', 'running')
      LIMIT 1
    `;
      if (active[0])
        return reply
          .code(409)
          .send({
            error: "Source acquisition is already queued for this filing.",
          });
      const jobs = await sql<{ id: number }[]>`
      INSERT INTO jobs (job_type, company_id, status, progress)
      VALUES ('filing_source_acquisition', ${filing.company_id}, 'running', ${sql.json({ sourceAcquisition: { status: "queued", queued: 1, complete: 0, failed: 0 } })})
      RETURNING id
    `;
      await sql`
      INSERT INTO work_items (job_id, work_type, company_id, filing_id, input)
      VALUES (${jobs[0].id}, 'acquire_filing_source', ${filing.company_id}, ${filing.id}, '{}'::jsonb)
    `;
      return reply
        .code(202)
        .send({
          jobId: jobs[0].id,
          message: "Primary SEC source acquisition queued.",
        });
    },
  );

  app.post("/api/v1/filings/:filingId/parse", async (request, reply) => {
    const id = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((request.params as { filingId?: string }).filingId);
    if (!id.success)
      return reply
        .code(400)
        .send({ error: "Filing id must be a positive integer." });
    const documents = await sql<
      { id: number; filing_id: number; company_id: number }[]
    >`
      SELECT filing_documents.id, filing_documents.filing_id, filings.company_id
      FROM filing_documents JOIN filings ON filings.id = filing_documents.filing_id
      WHERE filing_documents.filing_id = ${id.data} AND filing_documents.status = 'downloaded'
      ORDER BY filing_documents.id DESC LIMIT 1
    `;
    const document = documents[0];
    if (!document)
      return reply
        .code(409)
        .send({
          error: "A preserved primary source is required before parsing.",
        });
    const active = await sql<{ id: number }[]>`
      SELECT id FROM work_items
      WHERE document_id = ${document.id} AND work_type = 'parse_filing_source' AND status IN ('pending', 'running')
      LIMIT 1
    `;
    if (active[0])
      return reply
        .code(409)
        .send({ error: "Parsing is already queued for this source." });
    const jobs = await sql<{ id: number }[]>`
      INSERT INTO jobs (job_type, company_id, status, progress)
      VALUES ('filing_parsing', ${document.company_id}, 'running', ${sql.json({ parsing: { status: "queued", queued: 1, complete: 0, failed: 0 } })})
      RETURNING id
    `;
    await sql`
      INSERT INTO work_items (job_id, work_type, company_id, filing_id, document_id, input)
      VALUES (${jobs[0].id}, 'parse_filing_source', ${document.company_id}, ${document.filing_id}, ${document.id}, '{}'::jsonb)
    `;
    return reply
      .code(202)
      .send({
        jobId: jobs[0].id,
        message: "Deterministic filing parsing queued.",
      });
  });

  app.post("/api/v1/filings/:filingId/chunk", async (request, reply) => {
    const id = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((request.params as { filingId?: string }).filingId);
    if (!id.success)
      return reply
        .code(400)
        .send({ error: "Filing id must be a positive integer." });
    const documents = await sql<
      {
        document_id: number;
        company_id: number;
        normalized_document_id: number;
        text_hash: string;
      }[]
    >`
      SELECT filing_documents.id AS document_id, filings.company_id, normalized_documents.id AS normalized_document_id, normalized_documents.text_hash
      FROM normalized_documents
      JOIN filing_documents ON filing_documents.id = normalized_documents.document_id
      JOIN filings ON filings.id = filing_documents.filing_id
      WHERE filings.id = ${id.data} AND normalized_documents.status = 'parsed'
      ORDER BY normalized_documents.id DESC LIMIT 1
    `;
    const document = documents[0];
    if (!document)
      return reply
        .code(409)
        .send({ error: "A parsed filing is required before chunking." });
    const result = await backfillSearchIndex(sql, { filingId: id.data });
    if (result.queued === 0)
      return reply
        .code(409)
        .send({
          error:
            "This filing is already indexed or has active parse/index work.",
        });
    return reply
      .code(202)
      .send({
        jobId: result.jobIds[0],
        message: "Search indexing queued for the parsed filing.",
      });
  });

  app.get("/api/v1/filings/:filingId/parsed", async (request, reply) => {
    const id = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((request.params as { filingId?: string }).filingId);
    if (!id.success)
      return reply
        .code(400)
        .send({ error: "Filing id must be a positive integer." });
    const readerQuery = z
      .object({
        documentId: z.coerce.number().int().positive().optional(),
        normalizedDocumentId: z.coerce.number().int().positive().optional(),
        textHash: z.string().optional(),
      })
      .safeParse(request.query);
    if (!readerQuery.success)
      return reply.code(400).send({ error: "Invalid evidence reference." });
    return sql.begin(async (tx) => {
      await tx`SELECT id FROM filing_documents WHERE filing_id = ${id.data} FOR SHARE`;
      const documents = await tx<
        {
          document_id: number;
          normalized_document_id: number;
          normalized_text_path: string;
          text_hash: string;
          warnings: string[];
          parser_version: string;
          sec_url: string;
          content_type: string;
          source_hash: string;
          form_type: string;
          accession_number: string;
        }[]
      >`
      SELECT filing_documents.id AS document_id, normalized_documents.id AS normalized_document_id,
        normalized_documents.normalized_text_path, normalized_documents.text_hash, normalized_documents.warnings, normalized_documents.parser_version, filing_documents.sec_url, filing_documents.content_type, filing_documents.content_hash AS source_hash,
        filings.form_type, filings.accession_number
      FROM normalized_documents
      JOIN filing_documents ON filing_documents.id = normalized_documents.document_id
      JOIN filings ON filings.id = filing_documents.filing_id
      WHERE filings.id = ${id.data}
        AND (${readerQuery.data.documentId ?? null}::bigint IS NULL OR filing_documents.id = ${readerQuery.data.documentId ?? null})
        AND ((${readerQuery.data.normalizedDocumentId ?? null}::bigint IS NOT NULL AND normalized_documents.id = ${readerQuery.data.normalizedDocumentId ?? null}) OR
          (${readerQuery.data.normalizedDocumentId ?? null}::bigint IS NULL AND normalized_documents.status = 'parsed'
            AND normalized_documents.parser_version = ${filingParserVersion}
            AND normalized_documents.source_content_hash = filing_documents.content_hash))
      ORDER BY normalized_documents.parsed_at DESC, normalized_documents.id DESC LIMIT 1
    `;
      const document = documents[0];
      if (!document)
        return reply
          .code(409)
          .send({ error: "A current parsed filing is not available yet." });
      const expectedHash = (request.query as { textHash?: string }).textHash;
      if (expectedHash && expectedHash !== document.text_hash)
        return reply
          .code(409)
          .send({
            error:
              "This evidence changed. Run the search again to open the current passage.",
          });
      try {
        const text = await readFile(document.normalized_text_path, "utf8");
        if (
          createHash("sha256").update(text).digest("hex") !== document.text_hash
        )
          return reply
            .code(409)
            .send({
              error:
                "Extracted evidence integrity check failed. Reparse this source.",
            });
        const sections = await tx`
        SELECT filing_sections.id, section_type, section_label, confidence_status, source_spans.start_offset, source_spans.end_offset,
          source_spans.page_start, source_spans.page_end
        FROM filing_sections JOIN source_spans ON source_spans.id = filing_sections.source_span_id
        WHERE filing_sections.document_id = ${document.document_id} AND source_spans.normalized_document_id = ${document.normalized_document_id}
        ORDER BY source_spans.start_offset
      `;
        return {
          filing: {
            id: id.data,
            formType: document.form_type,
            accessionNumber: document.accession_number,
          },
          document: {
            id: document.document_id,
            normalizedDocumentId: document.normalized_document_id,
            textHash: document.text_hash,
            warnings: document.warnings,
            parserVersion: document.parser_version,
            secUrl: document.sec_url,
            contentType: document.content_type,
            sourceHash: document.source_hash,
          },
          sections,
          text,
        };
      } catch (error) {
        return reply
          .code(500)
          .send({
            error:
              error instanceof Error
                ? `The parsed filing text could not be read: ${error.message}`
                : "The parsed filing text could not be read.",
          });
      }
    });
  });

  app.get("/api/v1/documents/:documentId/source", async (request, reply) => {
    const id = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((request.params as { documentId?: string }).documentId);
    if (!id.success)
      return reply.code(400).send({ error: "Invalid document." });
    const documents =
      await sql`SELECT local_path, content_type, content_hash FROM filing_documents WHERE id = ${id.data} AND status = 'downloaded'`;
    if (!documents[0]?.local_path)
      return reply
        .code(404)
        .send({ error: "No preserved source is available." });
    const expectedHash = (request.query as { contentHash?: string })
      .contentHash;
    if (expectedHash && expectedHash !== documents[0].content_hash)
      return reply
        .code(409)
        .send({
          error: "This original source changed. Reopen the current document.",
        });
    try {
      const raw = await readFile(documents[0].local_path);
      if (
        createHash("sha256").update(raw).digest("hex") !==
        documents[0].content_hash
      )
        return reply
          .code(409)
          .send({ error: "Preserved source integrity check failed." });
      reply.header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; sandbox",
      );
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "no-store");
      if (documents[0].content_type?.includes("html")) {
        const safe = sanitizeHtml(raw.toString("utf8"), {
          allowedTags: [
            ...sanitizeHtml.defaults.allowedTags,
            "html",
            "head",
            "body",
            "style",
          ],
          allowedAttributes: {
            "*": [
              "style",
              "class",
              "id",
              "colspan",
              "rowspan",
              "align",
              "width",
              "height",
            ],
          },
          allowVulnerableTags: true,
          allowedSchemes: [],
        });
        return reply.type("text/html; charset=utf-8").send(safe);
      }
      return reply.type("text/plain; charset=utf-8").send(raw);
    } catch {
      return reply
        .code(404)
        .send({ error: "The preserved source file could not be read." });
    }
  });

  app.get("/api/v1/jobs/:jobId", async (request, reply) => {
    const id = z.coerce
      .number()
      .int()
      .positive()
      .safeParse((request.params as { jobId?: string }).jobId);
    if (!id.success)
      return reply
        .code(400)
        .send({ error: "Job id must be a positive integer." });
    const jobs =
      await sql`SELECT id, company_id, requested_ticker, requested_start_date, status, progress, last_error, created_at, updated_at FROM jobs WHERE id = ${id.data}`;
    if (!jobs[0]) return reply.code(404).send({ error: "Job not found." });
    const workItems =
      await sql`SELECT id, work_type, status, attempt_count, error_code, error_message, updated_at FROM work_items WHERE job_id = ${id.data} ORDER BY id`;
    return { job: jobs[0], workItems };
  });
  return app;
}
