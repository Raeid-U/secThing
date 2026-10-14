import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { applyMigrations, chunkDocument, connectDatabase, loadConfig, parseFilingSource, Retrieval } from "@secthing/platform";

async function main() {
  assert(process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL to a disposable pgvector database.");
  assert(process.env.AI_EMBEDDING_BASE_URL && process.env.AI_EMBEDDING_MODEL,
    "Set AI_EMBEDDING_BASE_URL and AI_EMBEDDING_MODEL to a running Ollama model.");
  const schema = `retrieval_smoke_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("search_path", `${schema},public`);
  const sql = connectDatabase(url.toString());
  const admin = connectDatabase(process.env.TEST_DATABASE_URL);
  const dataDir = await mkdtemp(join(tmpdir(), "secthing-real-retrieval-"));
  const config = loadConfig({ ...process.env, DATABASE_URL: url.toString(), DATA_DIR: dataDir,
    AI_MODE: "local", AI_EMBEDDING_PROVIDER: "ollama" });
  let created = false;
  try {
    await admin.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(289462260)`;
      await tx`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`;
    });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    await applyMigrations(sql);
    const [company] = await sql`INSERT INTO companies (cik, legal_name, identity_source, identity_fetched_at)
      VALUES (123, 'Retrieval Fixture Inc', 'synthetic_smoke_fixture', now()) RETURNING id`;
    const fixtures = [
      { form: "10-K", text: "Item 1. Business\nWe design semiconductor processors and sell microchips for data centers and artificial intelligence computing." },
      { form: "10-K", text: "Item 1A. Risk Factors\nOur factories depend on a single overseas supplier. Trade restrictions and shipping disruptions could interrupt component deliveries." },
      { form: "10-Q", text: "PART I — FINANCIAL INFORMATION\nItem 2. Management Discussion\nOur revolving credit facility and cash reserves fund working capital. Debt repayments and liquidity needs are monitored by treasury." },
      { form: "8-K", text: "Item 5.02 Departure of Directors or Certain Officers\nThe chief executive officer resigned. The board appointed an interim leader and began an external executive recruitment process." },
    ];
    const documentIds: number[] = [];
    const retrieval = new Retrieval(sql, config);
    const started = performance.now();
    for (const [index, fixture] of fixtures.entries()) {
      const [filing] = await sql`INSERT INTO filings (company_id, cik, accession_number, form_type, filing_date, is_supported)
        VALUES (${company.id}, 123, ${`0000000123-26-${String(index + 1).padStart(6, "0")}`}, ${fixture.form}, '2026-01-01', true) RETURNING id`;
      const path = join(dataDir, `${index}.txt`);
      await writeFile(path, fixture.text);
      const [doc] = await sql`INSERT INTO filing_documents (filing_id, document_name, document_type, sec_url, content_type, content_hash, local_path, status)
        VALUES (${filing.id}, ${`${index}.txt`}, 'primary', ${`https://example.invalid/fixture/${index}`}, 'text/plain', ${createHash("sha256").update(fixture.text).digest("hex")}, ${path}, 'downloaded') RETURNING id`;
      const [job] = await sql`INSERT INTO jobs (company_id, job_type) VALUES (${company.id}, 'retrieval_smoke') RETURNING id`;
      const item = { company_id: company.id, filing_id: filing.id, document_id: doc.id, job_id: job.id };
      await parseFilingSource(sql, { dataDir }, item);
      await chunkDocument(sql, item);
      await retrieval.embedDocument(item.document_id);
      documentIds.push(Number(doc.id));
    }
    const indexingMs = Math.round(performance.now() - started);
    const coverage = await retrieval.status(company.id);
    assert(coverage.chunks > 0 && coverage.embedded === coverage.chunks, "Embedding coverage is incomplete.");
    const lexical = await retrieval.search(company.id, "microchips", "full_text", { limit: 3 });
    assert.equal(Number(lexical.results[0]?.document_id), documentIds[0]);
    const questions = [
      { query: "What products does this company manufacture?", expected: 0 },
      { query: "What could disrupt the company's supply chain?", expected: 1 },
      { query: "How does the business finance its short term cash requirements?", expected: 2 },
      { query: "Has there been a change in senior leadership?", expected: 3 },
    ];
    const measurements: object[] = [];
    let topOne = 0;
    for (const question of questions) {
      for (const mode of ["semantic", "hybrid"] as const) {
        const before = performance.now();
        const result = await retrieval.search(company.id, question.query, mode, { limit: 3 });
        assert.equal(result.fallback, null, "Live semantic retrieval unexpectedly fell back.");
        const correct = Number(result.results[0]?.document_id) === documentIds[question.expected];
        if (correct) topOne++;
        assert(result.results.some((row) => Number(row.document_id) === documentIds[question.expected]), "Expected source absent from top three.");
        for (const row of result.results) {
          const fixture = fixtures[documentIds.indexOf(Number(row.document_id))];
          assert.equal(fixture.text.slice(Number(row.start_offset), Number(row.end_offset)), row.chunk_text);
        }
        measurements.push({ query: question.query, mode, correctTopOne: correct, milliseconds: Math.round(performance.now() - before) });
      }
    }
    console.info(JSON.stringify({ model: config.aiEmbeddingModel, indexingMs, coverage, topOne, queries: measurements.length, measurements }, null, 2));
    assert(topOne >= 6, "Fewer than 6 of 8 fixture queries returned the expected source first.");
  } finally {
    await sql.end();
    if (created) await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await rm(dataDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
