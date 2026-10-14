import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, backfillSearchIndex, chunkDocument, connectDatabase, loadConfig, parseFilingSource } from "@secthing/platform";
import { buildServer } from "../apps/backend/src/server.js";

// Use a disposable PostgreSQL instance. Never fall back to the application's DATABASE_URL.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("evidence lifecycle (PostgreSQL)", () => {
  const schema = `evidence_test_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = new URL(databaseUrl ?? "postgres://localhost/unused");
  scopedUrl.searchParams.set("search_path", schema);
  const admin = connectDatabase(databaseUrl ?? scopedUrl.toString());
  const sql = connectDatabase(scopedUrl.toString());
  let dataDir: string;
  let item: { job_id: number; company_id: number; filing_id: number; document_id: number };
  let app: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    await applyMigrations(sql);
    dataDir = await mkdtemp(join(tmpdir(), "secthing-evidence-test-"));
    app = buildServer(loadConfig({ DATABASE_URL: scopedUrl.toString(), DATA_DIR: dataDir }));
  }, 30_000);

  afterAll(async () => {
    await app?.close();
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

  it("reparses indexed evidence without foreign-key failures and removes obsolete search results", async () => {
    await parseAndIndex();
    await source("Cobalt production increased.");
    await parseFilingSource(sql, { dataDir }, item);
    expect(await sql`SELECT id FROM chunks`).toHaveLength(0);
    await chunkDocument(sql, item);
    expect(await sql`SELECT id FROM chunks WHERE search_vector @@ plainto_tsquery('english', 'orchard')`).toHaveLength(0);
    expect(await sql`SELECT id FROM chunks WHERE search_vector @@ plainto_tsquery('english', 'cobalt')`).toHaveLength(1);
    expect(await sql`SELECT id FROM source_spans WHERE span_kind = 'chunk'`).toHaveLength(1);
  });

  it("supersedes prior parser versions and removes their evidence references", async () => {
    await parseAndIndex();
    await sql`UPDATE normalized_documents SET parser_version = 'retired-parser'`;
    await parseFilingSource(sql, { dataDir }, item);
    await chunkDocument(sql, item);
    expect(await sql`SELECT id FROM normalized_documents WHERE status = 'parsed'`).toHaveLength(1);
    expect(await sql`SELECT id FROM normalized_documents WHERE status = 'superseded'`).toHaveLength(1);
    expect(await sql`SELECT id FROM source_spans WHERE normalized_document_id IN
      (SELECT id FROM normalized_documents WHERE status = 'superseded')`).toHaveLength(0);
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
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url })).json()).toEqual({ queued: 0, jobIds: [] });
    expect((await app.inject({ method: "POST", url: `/api/v1/filings/${item.filing_id}/chunk` })).statusCode).toBe(409);
  });
});
