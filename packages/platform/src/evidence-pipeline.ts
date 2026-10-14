import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ChunkingAndIndexing, chunkingProfileVersion } from "./chunking.js";
import { FilingParser, filingParserVersion } from "./filing-parser.js";
import type { PlatformConfig } from "./config.js";
import type { Sql, TransactionSql } from "postgres";

type EvidenceWork = { job_id: number; company_id: number | null; filing_id: number | null; document_id: number | null };
type ParseDocument = { id: number; filing_id: number; form_type: string; local_path: string; content_type: string | null; content_hash: string };
type ChunkDocument = { document_id: number; filing_id: number; company_id: number; normalized_document_id: number; normalized_text_path: string; text_hash: string };
const parser = new FilingParser();
const chunking = new ChunkingAndIndexing();

/** Queue current parsed evidence without downloading sources or repeating valid indexes. */
export async function backfillSearchIndex(sql: Sql, scope: { companyId?: number; filingId?: number } = {}) {
  return sql.begin(async (transaction) => {
    // Serialize concurrent backfill requests, then share the worker's document lock.
    await transaction`SELECT pg_advisory_xact_lock(289462261)`;
    await transaction`
      SELECT filing_documents.id FROM filing_documents
      JOIN filings ON filings.id = filing_documents.filing_id
      WHERE (${scope.companyId ?? null}::bigint IS NULL OR filings.company_id = ${scope.companyId ?? null})
        AND (${scope.filingId ?? null}::bigint IS NULL OR filings.id = ${scope.filingId ?? null})
      ORDER BY filing_documents.id FOR UPDATE OF filing_documents
    `;
    const candidates = await transaction<{ document_id: number; filing_id: number; company_id: number }[]>`
      SELECT filing_documents.id AS document_id, filings.id AS filing_id, filings.company_id
      FROM filing_documents
      JOIN filings ON filings.id = filing_documents.filing_id
      JOIN normalized_documents ON normalized_documents.document_id = filing_documents.id
      WHERE normalized_documents.status = 'parsed'
        AND normalized_documents.parser_version = ${filingParserVersion}
        AND normalized_documents.source_content_hash = filing_documents.content_hash
        AND (${scope.companyId ?? null}::bigint IS NULL OR filings.company_id = ${scope.companyId ?? null})
        AND (${scope.filingId ?? null}::bigint IS NULL OR filings.id = ${scope.filingId ?? null})
        AND NOT EXISTS (
          SELECT 1 FROM chunks WHERE chunks.normalized_document_id = normalized_documents.id
            AND chunks.chunk_profile_version = ${chunkingProfileVersion}
            AND chunks.normalized_text_hash = normalized_documents.text_hash
        )
        AND NOT EXISTS (
          SELECT 1 FROM work_items WHERE work_items.document_id = filing_documents.id
            AND work_type IN ('parse_filing_source', 'chunk_document') AND status IN ('pending', 'running')
        )
      ORDER BY filings.company_id, filing_documents.id
    `;
    const jobIds: number[] = [];
    const companies = [...new Set(candidates.map((candidate) => candidate.company_id))];
    for (const companyId of companies) {
      const documents = candidates.filter((candidate) => candidate.company_id === companyId);
      const jobs = await transaction<{ id: number }[]>`
        INSERT INTO jobs (job_type, company_id, status, progress)
        VALUES ('search_index_backfill', ${companyId}, 'running',
          ${transaction.json({ chunking: { status: 'queued', queued: documents.length, complete: 0, failed: 0 } })})
        RETURNING id
      `;
      jobIds.push(jobs[0].id);
      for (const document of documents) {
        await queueChunking(transaction, jobs[0].id, companyId, document.filing_id, document.document_id);
      }
    }
    return { queued: candidates.length, jobIds };
  });
}

export async function parseFilingSource(sql: Sql, config: Pick<PlatformConfig, "dataDir">, item: EvidenceWork): Promise<void> {
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
    await transaction`SELECT id FROM filing_documents WHERE id = ${document.id} FOR UPDATE`;
    const current = await transaction<{ content_hash: string }[]>`SELECT content_hash FROM filing_documents WHERE id = ${document.id}`;
    if (current[0].content_hash !== document.content_hash) throw new Error("Source changed during parsing; retry with the current source.");
    // Sections are document-wide. Invalidate every prior parse before replacing them.
    await transaction`DELETE FROM chunks WHERE document_id = ${document.id}`;
    await transaction`DELETE FROM filing_sections WHERE document_id = ${document.id}`;
    await transaction`DELETE FROM source_spans WHERE normalized_document_id IN (SELECT id FROM normalized_documents WHERE document_id = ${document.id})`;
    await transaction`UPDATE normalized_documents SET status = 'superseded', updated_at = now() WHERE document_id = ${document.id}`;
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
    await transaction`UPDATE filings SET filing_status = 'parsed', updated_at = now() WHERE id = ${document.filing_id}`;
    await queueChunking(transaction, item.job_id, item.company_id, document.filing_id, document.id);
  });
}

async function queueChunking(sql: TransactionSql, jobId: number, companyId: number | null, filingId: number, documentId: number): Promise<void> {
  await sql`SELECT id FROM filing_documents WHERE id = ${documentId} FOR UPDATE`;
  await sql`
    INSERT INTO work_items (job_id, work_type, company_id, filing_id, document_id, input)
    SELECT ${jobId}, 'chunk_document', ${companyId}, ${filingId}, ${documentId}, '{}'::jsonb
    WHERE EXISTS (
      SELECT 1 FROM normalized_documents
      WHERE document_id = ${documentId} AND status = 'parsed'
    )
      AND NOT EXISTS (
        SELECT 1 FROM chunks
        JOIN normalized_documents ON normalized_documents.id = chunks.normalized_document_id
        WHERE normalized_documents.document_id = ${documentId}
          AND chunks.chunk_profile_version = ${chunkingProfileVersion}
          AND chunks.normalized_text_hash = normalized_documents.text_hash
      )
      AND NOT EXISTS (
        SELECT 1 FROM work_items
        WHERE job_id = ${jobId} AND work_type = 'chunk_document' AND document_id = ${documentId}
          AND status = 'pending'
      )
  `;
}

export async function chunkDocument(sql: Sql, item: EvidenceWork): Promise<void> {
  if (!item.document_id || !item.filing_id || !item.company_id) throw new Error("Chunking work item is missing its company, filing, or document.");
  await sql.begin(async (transaction) => {
    await transaction`SELECT id FROM filing_documents WHERE id = ${item.document_id} FOR UPDATE`;
    const documents = await transaction<ChunkDocument[]>`
      SELECT filing_documents.id AS document_id, filing_documents.filing_id, filings.company_id,
        normalized_documents.id AS normalized_document_id, normalized_documents.normalized_text_path, normalized_documents.text_hash
      FROM normalized_documents
      JOIN filing_documents ON filing_documents.id = normalized_documents.document_id
      JOIN filings ON filings.id = filing_documents.filing_id
      WHERE filing_documents.id = ${item.document_id} AND normalized_documents.status = 'parsed'
        AND normalized_documents.parser_version = ${filingParserVersion}
        AND normalized_documents.source_content_hash = filing_documents.content_hash
      ORDER BY normalized_documents.parsed_at DESC, normalized_documents.id DESC LIMIT 1
    `;
    const document = documents[0];
    if (!document) throw new Error("A parsed normalized document is required before chunking.");
    const normalizedText = await readFile(document.normalized_text_path, "utf8");
    if (createHash("sha256").update(normalizedText).digest("hex") !== document.text_hash) {
      throw new Error("Normalized text does not match its persisted hash; reparse the source before indexing.");
    }
    const sections = await transaction<{ id: number; section_type: string; section_label: string; start_offset: number; end_offset: number }[]>`
      SELECT filing_sections.id, filing_sections.section_type, filing_sections.section_label, source_spans.start_offset, source_spans.end_offset
      FROM filing_sections JOIN source_spans ON source_spans.id = filing_sections.source_span_id
      WHERE filing_sections.document_id = ${document.document_id}
        AND source_spans.normalized_document_id = ${document.normalized_document_id}
      ORDER BY source_spans.start_offset
    `;
    const chunks = chunking.process(normalizedText, sections.map((section) => ({
      sectionId: section.id,
      sectionType: section.section_type,
      sectionLabel: section.section_label,
      startOffset: section.start_offset,
      endOffset: section.end_offset,
    })));
    if (chunks.length === 0) throw new Error("Chunking produced no searchable evidence.");
    await transaction`DELETE FROM chunks WHERE normalized_document_id = ${document.normalized_document_id}`;
    await transaction`DELETE FROM source_spans WHERE normalized_document_id = ${document.normalized_document_id} AND span_kind = 'chunk'`;
    for (const chunk of chunks) {
      const spans = await transaction<{ id: number }[]>`
        INSERT INTO source_spans (normalized_document_id, start_offset, end_offset, span_text_hash, span_kind)
        VALUES (${document.normalized_document_id}, ${chunk.startOffset}, ${chunk.endOffset}, ${chunk.hash}, 'chunk')
        RETURNING id
      `;
      await transaction`
        INSERT INTO chunks (company_id, filing_id, document_id, normalized_document_id, section_id, source_span_id,
          start_offset, end_offset, chunk_text, chunk_hash, token_estimate, chunk_profile, chunk_profile_version, normalized_text_hash)
        VALUES (${document.company_id}, ${document.filing_id}, ${document.document_id}, ${document.normalized_document_id}, ${chunk.sectionId}, ${spans[0].id},
          ${chunk.startOffset}, ${chunk.endOffset}, ${chunk.text}, ${chunk.hash}, ${chunk.tokenEstimate}, ${chunk.profile}, ${chunkingProfileVersion}, ${document.text_hash})
      `;
    }
    await transaction`UPDATE filings SET filing_status = 'chunked', updated_at = now() WHERE id = ${document.filing_id}`;
  });
}


