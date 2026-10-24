import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, backfillSearchIndex, chunkDocument, connectDatabase, loadConfig, parseFilingSource, Retrieval, WorkQueue, LeaseLostError } from "@secthing/platform";
import { buildServer } from "../apps/backend/src/server.js";
import { post } from "../apps/frontend/app/research/types.js";

// Use a disposable PostgreSQL instance. Never fall back to the application's DATABASE_URL.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("evidence lifecycle (PostgreSQL)", () => {
  const schema = `evidence_test_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = new URL(databaseUrl ?? "postgres://localhost/unused");
  scopedUrl.searchParams.set("search_path", `${schema},public`);
  const admin = connectDatabase(databaseUrl ?? scopedUrl.toString());
  const sql = connectDatabase(scopedUrl.toString());
  let dataDir: string;
  let item: { job_id: number; company_id: number; filing_id: number; document_id: number };
  let app: ReturnType<typeof buildServer>;
  let questionApp: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await admin.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(289462260)`;
      await tx`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`;
    });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    await applyMigrations(sql);
    dataDir = await mkdtemp(join(tmpdir(), "secthing-evidence-test-"));
    app = buildServer(loadConfig({ DATABASE_URL: scopedUrl.toString(), DATA_DIR: dataDir, SEC_USER_AGENT: "secThing test test@example.com" }));
    questionApp = buildServer(loadConfig({ DATABASE_URL: scopedUrl.toString(), DATA_DIR: dataDir, SEC_USER_AGENT: "secThing test test@example.com",
      AI_MODE: "local", AI_CHAT_PROVIDER: "ollama", AI_CHAT_BASE_URL: "http://fixture", AI_CHAT_MODEL: "fixture-chat",
      AI_EMBEDDING_PROVIDER: "ollama", AI_EMBEDDING_BASE_URL: "http://fixture", AI_EMBEDDING_MODEL: "fixture-embed", AI_EMBEDDING_DIMENSION: "2" }), {
      embeddings: { embed: async (request) => ({ model: request.model, embeddings: request.inputs.map(() => [1, 0]) }) },
      chat: { chat: async (request) => ({ model: request.model, content: JSON.stringify({ findings: [{ statement: "Orchard revenue grew.", citations: ["C1"] }], interpretation: [], limitations: [] }) }) },
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await questionApp?.close();
    await sql.end();
    await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  async function source(text: string) {
    const content = `<html><body><h1>Item 1. Business</h1><p>${text}</p></body></html>`;
    const hash = createHash("sha256").update(content).digest("hex");
    const path = join(dataDir, `${hash}.html`);
    await writeFile(path, content);
    await sql`UPDATE filing_documents SET local_path = ${path}, content_hash = ${hash} WHERE id = ${item.document_id}`;
  }

  async function parseAndIndex() {
    await parseFilingSource(sql, { dataDir }, item);
    await chunkDocument(sql, item);
    await sql`UPDATE work_items SET status = 'complete'`;
  }

  beforeEach(async () => {
    await sql`TRUNCATE companies, jobs RESTART IDENTITY CASCADE`;
    const company = await sql`INSERT INTO companies (cik, legal_name, identity_source, identity_fetched_at)
      VALUES (123, 'Fixture Inc', 'fixture', now()) RETURNING id`;
    const filing = await sql`INSERT INTO filings (company_id, cik, accession_number, form_type, filing_date, is_supported)
      VALUES (${company[0].id}, 123, '0000000123-26-000001', '10-K', '2026-01-01', true) RETURNING id`;
    const document = await sql`INSERT INTO filing_documents (filing_id, document_name, document_type, content_type, sec_url, status)
      VALUES (${filing[0].id}, 'fixture.html', 'primary', 'text/html', 'https://www.sec.gov/fixture.html', 'downloaded') RETURNING id`;
    const job = await sql`INSERT INTO jobs (company_id, job_type) VALUES (${company[0].id}, 'fixture') RETURNING id`;
    item = { company_id: company[0].id, filing_id: filing[0].id, document_id: document[0].id, job_id: job[0].id };
    await source("Orchard revenue grew.");
  });

  it("parses, indexes and searches preserved evidence with metadata and filters", async () => {
    await parseAndIndex();
    const response = await app.inject({ url: `/api/v1/companies/${item.company_id}/search?q=orchard&formType=10-K&sectionType=business&filedAfter=2025-01-01` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: "full_text", results: [{
      filing_id: item.filing_id, accession_number: "0000000123-26-000001", form_type: "10-K",
      section_type: "business", source_span_id: expect.any(String), start_offset: 0,
      snippet: expect.stringContaining("Orchard"), rank: expect.any(Number),
    }] });
    const excluded = await app.inject({ url: `/api/v1/companies/${item.company_id}/search?q=orchard&formType=8-K` });
    expect(excluded.json().results).toEqual([]);
  });

  it("reparses into a new generation, hides obsolete search results, and retains old citations", async () => {
    await parseAndIndex();
    await source("Cobalt production increased.");
    await parseFilingSource(sql, { dataDir }, item);
    expect(await sql`SELECT id FROM chunks`).toHaveLength(1);
    await chunkDocument(sql, item);
    expect(await sql`SELECT id FROM chunks WHERE search_vector @@ plainto_tsquery('english', 'orchard')`).toHaveLength(1);
    expect(await sql`SELECT id FROM chunks WHERE search_vector @@ plainto_tsquery('english', 'cobalt')`).toHaveLength(1);
    expect(await sql`SELECT id FROM source_spans WHERE span_kind = 'chunk'`).toHaveLength(2);
    expect((await app.inject({ url: `/api/v1/companies/${item.company_id}/search?q=orchard` })).json().results).toEqual([]);
    const generations = await sql`SELECT id, generation, status FROM normalized_documents ORDER BY generation`;
    expect(generations).toMatchObject([{ generation: 1, status: "superseded" }, { generation: 2, status: "parsed" }]);
    const reopened = await app.inject({ url: `/api/v1/filings/${item.filing_id}/parsed?normalizedDocumentId=${generations[0].id}` });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().text).toContain("Orchard");
  });

  it("indexes preamble evidence and quarterly sections with exact source offsets", async () => {
    const content = "Coverword issuer introduction.\nPART I — FINANCIAL INFORMATION\nItem 1. Financial Statements\nQuarterly accounts.\nItem 2. Management Discussion\nLiquidity outlook.\nPART II — OTHER INFORMATION\nItem 1. Legal Proceedings\nCourtword dispute.";
    const path = join(dataDir, "quarterly.txt");
    await writeFile(path, content);
    await sql`UPDATE filings SET form_type = '10-Q' WHERE id = ${item.filing_id}`;
    await sql`UPDATE filing_documents SET local_path = ${path}, content_type = 'text/plain',
      content_hash = ${createHash("sha256").update(content).digest("hex")} WHERE id = ${item.document_id}`;
    await parseAndIndex();
    const cover = await app.inject({ url: `/api/v1/companies/${item.company_id}/search?q=coverword&sectionType=unknown` });
    expect(cover.json().results).toHaveLength(1);
    const legal = await app.inject({ url: `/api/v1/companies/${item.company_id}/search?q=courtword&sectionType=legal_proceedings` });
    expect(legal.json().results).toHaveLength(1);
    const chunks = await sql`SELECT chunk_text, start_offset, end_offset FROM chunks ORDER BY start_offset`;
    for (const chunk of chunks) expect(content.slice(chunk.start_offset, chunk.end_offset)).toBe(chunk.chunk_text);
    for (let index = 0; index < content.length; index++) {
      if (/\S/.test(content[index])) expect(chunks.some((c) => c.start_offset <= index && c.end_offset > index)).toBe(true);
    }
  });

  it("queues parser upgrades once and rebuilds the search index from preserved sources", async () => {
    await parseAndIndex();
    await sql`UPDATE normalized_documents SET parser_version = 'html-text-v1'`;
    await sql`INSERT INTO normalized_documents (document_id, parser_version, source_content_hash, normalized_text_path, text_hash, text_length, status, generation)
      SELECT document_id, 'older-parser', source_content_hash, normalized_text_path, text_hash, text_length, 'superseded', generation + 1 FROM normalized_documents`;
    expect((await app.inject({ url: `/api/v1/companies/${item.company_id}/search?q=orchard` })).json().results).toEqual([]);
    const results = await Promise.all([backfillSearchIndex(sql), backfillSearchIndex(sql)]);
    expect(results.reduce((sum, r) => sum + r.queued, 0)).toBe(1);
    expect(await sql`SELECT id FROM work_items WHERE work_type = 'parse_filing_source' AND status = 'pending'`).toHaveLength(1);
    await parseAndIndex();
    expect((await app.inject({ url: `/api/v1/companies/${item.company_id}/search?q=orchard` })).json().results).toHaveLength(1);
    expect((await backfillSearchIndex(sql)).queued).toBe(0);
  });

  it("supersedes prior parser versions while retaining their evidence references", async () => {
    await parseAndIndex();
    await sql`UPDATE normalized_documents SET parser_version = 'retired-parser'`;
    await parseFilingSource(sql, { dataDir }, item);
    await chunkDocument(sql, item);
    expect(await sql`SELECT id FROM normalized_documents WHERE status = 'parsed'`).toHaveLength(1);
    expect(await sql`SELECT id FROM normalized_documents WHERE status = 'superseded'`).toHaveLength(1);
    expect(await sql`SELECT id FROM source_spans WHERE normalized_document_id IN
      (SELECT id FROM normalized_documents WHERE status = 'superseded')`).not.toHaveLength(0);
  });

  it("keeps the prior evidence intact when persistence fails mid-reparse", async () => {
    await parseAndIndex();
    const before = await sql`SELECT id, chunk_text FROM chunks`;
    // Force replacement to fail after invalidation; the whole transaction must roll back.
    await sql.unsafe("ALTER TABLE filing_sections ADD CONSTRAINT reject_fixture CHECK (section_type <> 'business') NOT VALID");
    await expect(parseFilingSource(sql, { dataDir }, item)).rejects.toThrow();
    expect(await sql`SELECT id, chunk_text FROM chunks`).toEqual(before);
    await sql.unsafe("ALTER TABLE filing_sections DROP CONSTRAINT reject_fixture");
  });

  it("rejects corrupted normalized text without replacing valid chunks", async () => {
    await parseAndIndex();
    const before = await sql`SELECT id, chunk_text FROM chunks`;
    const documents = await sql`SELECT normalized_text_path FROM normalized_documents WHERE status = 'parsed'`;
    await writeFile(documents[0].normalized_text_path, "Corrupted local text.");
    await expect(chunkDocument(sql, item)).rejects.toThrow("persisted hash");
    expect(await sql`SELECT id, chunk_text FROM chunks`).toEqual(before);
  });

  it("backfills existing parses once across concurrent requests and leaves valid indexes alone", async () => {
    await parseFilingSource(sql, { dataDir }, item);
    await sql`DELETE FROM work_items`; // Represents a parse completed before chunking was introduced.
    const results = await Promise.all([backfillSearchIndex(sql), backfillSearchIndex(sql)]);
    expect(results.reduce((sum, result) => sum + result.queued, 0)).toBe(1);
    expect(await sql`SELECT id FROM work_items WHERE work_type = 'chunk_document'`).toHaveLength(1);
    await chunkDocument(sql, item);
    await sql`UPDATE work_items SET status = 'complete'`;
    expect(await backfillSearchIndex(sql)).toEqual({ queued: 0, jobIds: [] });
  });

  it("requeues outdated profiles and failed chunk jobs without duplicating chunk spans", async () => {
    await parseAndIndex();
    await sql`UPDATE chunks SET chunk_profile_version = 'retired-profile'`;
    expect((await backfillSearchIndex(sql)).queued).toBe(1);
    await sql`UPDATE work_items SET status = 'failed'`;
    expect((await backfillSearchIndex(sql)).queued).toBe(1);
    await chunkDocument(sql, item);
    expect(await sql`SELECT id FROM source_spans WHERE span_kind = 'chunk'`).toHaveLength(1);
  });

  it("hides stale-source indexes until the changed source is parsed", async () => {
    await parseAndIndex();
    await source("Changed source pending a new parse.");
    const response = await app.inject({ url: `/api/v1/companies/${item.company_id}/search?q=orchard` });
    expect(response.json().results).toEqual([]);
    expect((await backfillSearchIndex(sql)).queued).toBe(0);
    await expect(chunkDocument(sql, item)).rejects.toThrow("parsed normalized document");
  });

  it("skips a valid parsed document while reparse work is pending", async () => {
    await parseFilingSource(sql, { dataDir }, item);
    await sql`DELETE FROM work_items`;
    await sql`INSERT INTO work_items (job_id, company_id, filing_id, document_id, work_type)
      VALUES (${item.job_id}, ${item.company_id}, ${item.filing_id}, ${item.document_id}, 'parse_filing_source')`;
    expect(await backfillSearchIndex(sql)).toEqual({ queued: 0, jobIds: [] });
  });

  it("offers an idempotent company reindex API and preserves the per-filing queue contract", async () => {
    await parseFilingSource(sql, { dataDir }, item);
    await sql`DELETE FROM work_items`;
    const url = `/api/v1/companies/${item.company_id}/search/reindex`;
    const init = post();
    expect((await app.inject({ method: "POST", url,
      headers: Object.fromEntries(new Headers(init.headers)), payload: init.body as string | undefined })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url })).json()).toEqual({ queued: 0, jobIds: [] });
    expect((await app.inject({ method: "POST", url: `/api/v1/filings/${item.filing_id}/chunk` })).statusCode).toBe(409);
  });

  function semantic(provider?: { embed: (request: { model: string; inputs: string[] }) => Promise<{ model: string; embeddings: number[][] }> }, extra: Record<string, string> = {}) {
    const config = loadConfig({ DATABASE_URL: scopedUrl.toString(), DATA_DIR: dataDir, AI_MODE: "local",
      AI_EMBEDDING_PROVIDER: "ollama", AI_EMBEDDING_BASE_URL: "http://fixture", AI_EMBEDDING_MODEL: "fixture-embed", ...extra });
    return new Retrieval(sql, config, provider ?? { embed: async (request) => ({ model: request.model, embeddings: request.inputs.map(() => [1, 0]) }) });
  }

  it("rejects parse and chunk writes from an expired attempt without replacing evidence", async () => {
    await parseAndIndex();
    const before = await sql`SELECT id, chunk_text FROM chunks`;
    await sql`INSERT INTO work_items (job_id, company_id, filing_id, document_id, work_type)
      VALUES (${item.job_id}, ${item.company_id}, ${item.filing_id}, ${item.document_id}, 'parse_filing_source')`;
    const queue = new WorkQueue(sql, 'retired-worker');
    const work = (await queue.claim())!;
    await sql`UPDATE work_items SET lease_expires_at = now() - interval '1 second' WHERE id = ${work.id}`;
    const guard = (tx: Parameters<WorkQueue['assertOwnership']>[0]) => queue.assertOwnership(tx, work);
    await expect(parseFilingSource(sql, { dataDir }, item, guard)).rejects.toBeInstanceOf(LeaseLostError);
    await expect(chunkDocument(sql, item, guard)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await sql`SELECT id, chunk_text FROM chunks`).toEqual(before);
  });

  it("rejects an in-flight embedding write after its work lease has been reclaimed", async () => {
    await parseAndIndex();
    await sql`INSERT INTO work_items (job_id, company_id, filing_id, document_id, work_type)
      VALUES (${item.job_id}, ${item.company_id}, ${item.filing_id}, ${item.document_id}, 'embed_document')`;
    const queue = new WorkQueue(sql, 'old-embed-worker');
    const work = (await queue.claim())!;
    const retrieval = semantic({ embed: async (request) => {
      await sql`UPDATE work_items SET lease_expires_at = now() - interval '1 second' WHERE id = ${work.id}`;
      await new WorkQueue(sql, 'replacement-worker').recoverExpired();
      return { model: request.model, embeddings: request.inputs.map(() => [1, 0]) };
    } });
    await expect(retrieval.embedDocument(item.document_id, undefined, (tx) => queue.assertOwnership(tx, work))).rejects.toBeInstanceOf(LeaseLostError);
    expect(await sql`SELECT chunk_id FROM chunk_embeddings`).toHaveLength(0);
  });

  it("indexes vectors and supports semantic and fused search independently of chat", async () => {
    await parseAndIndex();
    const first = { ...item };
    const secondFiling = await sql`INSERT INTO filings (company_id, cik, accession_number, form_type, filing_date, is_supported)
      VALUES (${item.company_id}, 123, '0000000123-26-000002', '10-Q', '2026-04-01', true) RETURNING id`;
    const secondDocument = await sql`INSERT INTO filing_documents (filing_id, document_name, document_type, content_type, sec_url, status)
      VALUES (${secondFiling[0].id}, 'second.html', 'primary', 'text/html', 'https://www.sec.gov/second.html', 'downloaded') RETURNING id`;
    item = { ...item, filing_id: secondFiling[0].id, document_id: secondDocument[0].id };
    await source("Cobalt mining output increased.");
    await parseAndIndex();
    const retrieval = semantic({ embed: async (request) => ({ model: request.model,
      embeddings: request.inputs.map((input) => input.includes("Cobalt") ? [0, 1] : [1, 0]) }) });
    await retrieval.embedDocument(first.document_id);
    await retrieval.embedDocument(item.document_id);
    expect(await retrieval.status(item.company_id)).toMatchObject({ configured: true, chunks: 2, embedded: 2 });
    const meaning = await retrieval.search(item.company_id, "fruit agriculture", "semantic", { limit: 10 });
    expect(meaning.results).toHaveLength(2);
    expect(meaning.results[0]).toMatchObject({ chunk_text: expect.stringContaining("Orchard"), text_hash: expect.any(String), document_id: first.document_id });
    expect(meaning.results[0].rank).toBeGreaterThan(meaning.results[1].rank);
    const fused = await retrieval.search(item.company_id, "orchard", "hybrid", { limit: 10 });
    expect(fused.mode).toBe("hybrid");
    expect(fused.results).toHaveLength(2);
    expect(fused.results[0].document_id).toBe(first.document_id);
    expect(await retrieval.search(item.company_id, "fruit agriculture", "semantic", { formType: "8-K", limit: 10 })).toMatchObject({ results: [] });
  });

  it("keeps keyword search available with an explicit hybrid fallback", async () => {
    await parseAndIndex();
    const retrieval = new Retrieval(sql, loadConfig({ DATABASE_URL: scopedUrl.toString() }));
    expect(await retrieval.search(item.company_id, "orchard", "hybrid", { limit: 10 })).toMatchObject({ mode: "full_text", fallback: expect.any(String), results: [expect.any(Object)] });
    await expect(retrieval.search(item.company_id, "orchard", "semantic", { limit: 10 })).rejects.toThrow();
  });

  it("blocks questions until corpus readiness, then audits a citation-safe grounded answer", async () => {
    await parseAndIndex();
    const init = post({ question: "What happened to orchard revenue?" });
    const blocked = await questionApp.inject({ method: "POST", url: `/api/v1/companies/${item.company_id}/questions`,
      headers: Object.fromEntries(new Headers(init.headers)), payload: init.body as string });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ corpus: { readiness: "processing" } });
    await sql`INSERT INTO companyfacts_sources (company_id, sec_url, body_path, content_hash) VALUES
      (${item.company_id}, 'https://data.sec.gov/companyfacts.json', '/fixture/companyfacts.json', 'fixture-facts')`;
    await semantic(undefined, { AI_EMBEDDING_DIMENSION: "2" }).embedDocument(item.document_id);
    const corpus = await questionApp.inject({ url: `/api/v1/companies/${item.company_id}/corpus` });
    expect(corpus.json()).toMatchObject({ readiness: "ready", structuredFactsComplete: true, stageCounts: { embedded: 1 } });
    const answered = await questionApp.inject({ method: "POST", url: `/api/v1/companies/${item.company_id}/questions`,
      headers: Object.fromEntries(new Headers(init.headers)), payload: init.body as string });
    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({ status: "answered", findings: [{ citations: ["C1"] }], citations: [{ label: "C1", locator: { normalizedDocumentId: expect.any(String) } }], modelRunId: expect.any(String) });
    expect(await sql`SELECT validation_status, cited_source_ids FROM model_runs`).toMatchObject([{ validation_status: "valid", cited_source_ids: ["C1"] }]);
  });

  it("rejects incompatible/nonfinite/zero vectors without persisting them", async () => {
    await parseAndIndex();
    for (const vector of [[1, 2, 3], [NaN, 1], [0, 0]]) {
      const retrieval = semantic({ embed: async (request) => ({ model: request.model, embeddings: request.inputs.map(() => vector) }) }, { AI_EMBEDDING_DIMENSION: "2" });
      await expect(retrieval.embedDocument(item.document_id)).rejects.toThrow("incompatible dimensions");
    }
    expect(await sql`SELECT * FROM chunk_embeddings`).toHaveLength(0);
  });

  it("retires vectors from active retrieval without deleting old generations or reusing another profile", async () => {
    await parseAndIndex();
    const retrieval = semantic();
    await retrieval.embedDocument(item.document_id);
    expect((await semantic(undefined, { AI_EMBEDDING_MODEL: "different-embed" }).status(item.company_id)).embedded).toBe(0);
    await source("Cobalt demand rose.");
    await parseAndIndex();
    expect(await sql`SELECT * FROM chunk_embeddings`).toHaveLength(1);
    expect((await retrieval.status(item.company_id)).embedded).toBe(0);
    await retrieval.embedDocument(item.document_id);
    expect((await retrieval.status(item.company_id)).embedded).toBe(1);
    expect(await sql`SELECT * FROM chunk_embeddings`).toHaveLength(2);
  });

  it("does not persist an in-flight embedding against a retired chunk generation", async () => {
    await parseAndIndex();
    const old = await sql`SELECT id FROM chunks`;
    let changed = false;
    const retrieval = semantic({ embed: async (request) => {
      if (!changed) { changed = true; await source("Replacement evidence."); await parseAndIndex(); }
      return { model: request.model, embeddings: request.inputs.map(() => [1, 0]) };
    } });
    await retrieval.embedDocument(item.document_id);
    expect(await sql`SELECT * FROM chunk_embeddings WHERE chunk_id = ${old[0].id}`).toHaveLength(0);
    expect((await retrieval.status(item.company_id)).embedded).toBe(1);
  });

  it("queues semantic backfill once and requires an explicit retry after terminal failure", async () => {
    await parseAndIndex();
    const retrieval = semantic();
    const results = await Promise.all([retrieval.queue(item.company_id), retrieval.queue(item.company_id)]);
    expect(results.reduce((sum, result) => sum + result.queued, 0)).toBe(1);
    await sql`UPDATE work_items SET status = 'failed' WHERE work_type = 'embed_document'`;
    expect((await retrieval.status(item.company_id)).failed).toBe(1);
    expect((await retrieval.queue(item.company_id)).queued).toBe(0);
    expect((await retrieval.queue(item.company_id, true)).queued).toBe(1);
    expect(await retrieval.status(item.company_id)).toMatchObject({ failed: 0, pending: 1 });
  });

  it("serves preserved sources in isolation and rejects stale reader hashes", async () => {
    await source('Orchard<script>window.bad = true</script><img src="https://example.com/tracker"><form><input></form>');
    await parseAndIndex();
    const original = await app.inject({ url: `/api/v1/documents/${item.document_id}/source` });
    expect(original.statusCode).toBe(200);
    expect(original.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(original.body).not.toMatch(/<script|<img|<form|<input/);
    const reader = await app.inject({ url: `/api/v1/filings/${item.filing_id}/parsed` });
    expect(reader.json()).toMatchObject({ document: { parserVersion: expect.any(String), sourceHash: expect.any(String) }, sections: [{ end_offset: expect.any(Number) }] });
    expect((await app.inject({ url: `/api/v1/filings/${item.filing_id}/parsed?textHash=retired` })).statusCode).toBe(409);
    expect((await app.inject({ url: `/api/v1/documents/${item.document_id}/source?contentHash=retired` })).statusCode).toBe(409);
  });

  it("confirms existing identity locally and queues explicit refresh with lookback policy", async () => {
    await sql`INSERT INTO company_ticker_aliases (company_id, ticker, source) VALUES (${item.company_id}, 'TEST', 'fixture')`;
    await sql`UPDATE companies SET earliest_requested_filing_date = '2020-01-01' WHERE id = ${item.company_id}`;
    const identity = await app.inject({ method: "POST", url: "/api/v1/companies/resolve", payload: { ticker: "test" } });
    expect(identity.json()).toMatchObject({ company: { id: item.company_id, name: "Fixture Inc", existed: true } });
    expect((await app.inject({ method: "POST", url: "/api/v1/companies", payload: { ticker: "TEST", startDate: "2020-01-01", confirmedCik: 999 } })).statusCode).toBe(409);
    const refreshed = await app.inject({ method: "POST", url: "/api/v1/companies", payload: { ticker: "TEST", startDate: "2020-01-01", confirmedCik: 123, refresh: true, lookback: "custom" } });
    expect(refreshed.statusCode).toBe(202);
    expect((await sql`SELECT requested_lookback FROM companies WHERE id = ${item.company_id}`)[0].requested_lookback).toBe("custom");
  });

  it("does not add a new issuer until a completed identity preview is confirmed", async () => {
    const preview = await app.inject({ method: "POST", url: "/api/v1/companies/resolve", payload: { ticker: "NEW" } });
    expect(preview.statusCode).toBe(202);
    expect(await sql`SELECT id FROM companies WHERE cik = 456`).toHaveLength(0);
    await sql`UPDATE jobs SET status = 'complete',
      progress = ${sql.json({ company: { id: null, cik: 456, ticker: "NEW", name: "New Issuer", existed: false } })}
      WHERE id = ${preview.json().jobId}`;
    const confirmed = await app.inject({ method: "POST", url: "/api/v1/companies",
      payload: { ticker: "NEW", startDate: "1900-01-01", confirmedCik: 456, lookback: "all" } });
    expect(confirmed.statusCode).toBe(202);
    expect(confirmed.json().companyId).toBeTruthy();
    expect(await sql`SELECT id FROM companies WHERE cik = 456 AND requested_lookback = 'all'`).toHaveLength(1);
  });
});
