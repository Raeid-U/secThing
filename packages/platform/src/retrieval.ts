import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { OllamaClient, type EmbeddingProvider } from "./ai.js";
import type { PlatformConfig } from "./config.js";
import { chunkingProfileVersion } from "./chunking.js";
import { filingParserVersion } from "./filing-parser.js";

export type SearchMode = "full_text" | "semantic" | "hybrid";
export type SearchFilters = {
  formType?: string;
  sectionType?: string;
  filedAfter?: string;
  filedBefore?: string;
  limit: number;
};
type Profile = { id: number; dimension: number | null };
type Hit = { chunk_id: string; rank: number; [key: string]: unknown };

export function embeddingSettings(config: PlatformConfig) {
  if (
    config.aiMode === "disabled" ||
    !config.aiEmbeddingBaseUrl ||
    !config.aiEmbeddingModel ||
    config.aiEmbeddingProvider !== "ollama"
  )
    return null;
  if (config.localOnly && config.aiMode === "external") return null;
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        provider: config.aiEmbeddingProvider,
        url: config.aiEmbeddingBaseUrl,
        model: config.aiEmbeddingModel,
        dimension: config.aiEmbeddingDimension ?? null,
        version: "raw-text-v1",
        chunking: chunkingProfileVersion,
      }),
    )
    .digest("hex");
  return { key, model: config.aiEmbeddingModel };
}

export class Retrieval {
  private provider: EmbeddingProvider;
  constructor(
    private sql: Sql,
    private config: PlatformConfig,
    provider?: EmbeddingProvider,
  ) {
    this.provider =
      provider ??
      new OllamaClient({
        baseUrl: config.aiEmbeddingBaseUrl ?? "http://localhost:11434",
        apiKey: config.aiEmbeddingApiKey,
        timeoutMs: config.aiRequestTimeoutMs,
      });
  }

  private async profile(): Promise<Profile> {
    const settings = embeddingSettings(this.config);
    if (!settings)
      throw new Error("Meaning search needs a configured embedding model.");
    const profiles = await this.sql<Profile[]>`
      INSERT INTO embedding_profiles (profile_key, provider, model, dimension)
      VALUES (${settings.key}, 'ollama', ${settings.model}, ${this.config.aiEmbeddingDimension ?? null})
      ON CONFLICT (profile_key) DO UPDATE SET profile_key = EXCLUDED.profile_key RETURNING id, dimension
    `;
    return profiles[0];
  }

  async status(companyId: number) {
    const settings = embeddingSettings(this.config);
    const rows = await this.sql<{ chunks: number; embedded: number }[]>`
      SELECT count(*)::integer AS chunks,
        count(e.chunk_id)::integer AS embedded
      FROM chunks c
      JOIN normalized_documents n ON n.id = c.normalized_document_id
      JOIN filing_documents d ON d.id = c.document_id
      LEFT JOIN embedding_profiles p ON p.profile_key = ${settings?.key ?? ""}
      LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id AND e.profile_id = p.id AND e.chunk_hash = c.chunk_hash
      WHERE c.company_id = ${companyId} AND c.chunk_profile_version = ${chunkingProfileVersion}
        AND n.status = 'parsed' AND n.parser_version = ${filingParserVersion}
        AND n.source_content_hash = d.content_hash AND n.text_hash = c.normalized_text_hash
    `;
    const work = await this.sql<{ pending: number; failed: number }[]>`
      SELECT count(*) FILTER (WHERE status IN ('pending', 'running'))::integer AS pending,
        count(*) FILTER (WHERE status = 'failed')::integer AS failed
      FROM (
        SELECT DISTINCT ON (w.document_id) w.status FROM work_items w
        JOIN normalized_documents n ON n.document_id = w.document_id AND n.status = 'parsed'
          AND n.text_hash = w.input->>'textHash'
        WHERE w.company_id = ${companyId} AND w.work_type = 'embed_document'
          AND w.input->>'profileKey' = ${settings?.key ?? ""}
        ORDER BY w.document_id, w.id DESC
      ) latest
    `;
    return {
      configured: Boolean(settings),
      model: settings?.model ?? null,
      ...rows[0],
      ...work[0],
    };
  }

  async queue(companyId?: number, retryFailed = false) {
    const settings = embeddingSettings(this.config);
    if (!settings) return { queued: 0 };
    const profile = await this.profile();
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(289462262)`;
      const documents = await tx<
        {
          document_id: number;
          filing_id: number;
          company_id: number;
          text_hash: string;
        }[]
      >`
        SELECT DISTINCT c.document_id, c.filing_id, c.company_id, n.text_hash
        FROM chunks c JOIN normalized_documents n ON n.id = c.normalized_document_id
        JOIN filing_documents d ON d.id = c.document_id
        WHERE (${companyId ?? null}::bigint IS NULL OR c.company_id = ${companyId ?? null})
          AND c.chunk_profile_version = ${chunkingProfileVersion}
          AND n.status = 'parsed' AND n.parser_version = ${filingParserVersion}
          AND n.text_hash = c.normalized_text_hash AND n.source_content_hash = d.content_hash
          AND NOT EXISTS (SELECT 1 FROM chunk_embeddings e WHERE e.chunk_id = c.id AND e.profile_id = ${profile.id} AND e.chunk_hash = c.chunk_hash)
          AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.document_id = c.document_id
            AND w.work_type = 'embed_document' AND w.input->>'profileKey' = ${settings.key}
            AND (w.status IN ('pending', 'running') OR (${!retryFailed} AND w.status = 'failed' AND w.input->>'textHash' = n.text_hash)))
        ORDER BY c.company_id, c.document_id LIMIT 100
      `;
      for (const document of documents) {
        const jobs = await tx<{ id: number }[]>`
          INSERT INTO jobs (job_type, company_id, status, progress)
          VALUES ('semantic_indexing', ${document.company_id}, 'running', '{"embeddings":"queued"}') RETURNING id
        `;
        await tx`INSERT INTO work_items (job_id, work_type, company_id, filing_id, document_id, input)
          VALUES (${jobs[0].id}, 'embed_document', ${document.company_id}, ${document.filing_id}, ${document.document_id},
            ${tx.json({ profileKey: settings.key, textHash: document.text_hash })})`;
      }
      return { queued: documents.length };
    });
  }

  private async vectors(inputs: string[], profile: Profile) {
    const settings = embeddingSettings(this.config)!;
    const response = await this.provider.embed({
      model: settings.model,
      inputs,
    });
    if (response.embeddings.length !== inputs.length)
      throw new Error("Embedding response count does not match the input.");
    const dimension = profile.dimension ?? response.embeddings[0]?.length;
    if (
      !dimension ||
      response.embeddings.some(
        (v) =>
          v.length !== dimension ||
          v.some((n) => !Number.isFinite(n)) ||
          v.every((n) => n === 0),
      )
    ) {
      throw new Error(
        "Embedding vectors have invalid values or incompatible dimensions.",
      );
    }
    const updated = await this.sql`
      UPDATE embedding_profiles SET dimension = ${dimension}
      WHERE id = ${profile.id} AND (dimension IS NULL OR dimension = ${dimension}) RETURNING dimension
    `;
    if (!updated.length)
      throw new Error(
        "The embedding model dimension changed; configure a new embedding profile.",
      );
    profile.dimension = dimension;
    return response.embeddings;
  }

  async embedDocument(documentId: number, profileKey?: string, assertOwnership?: (tx: TransactionSql) => Promise<void>) {
    const settings = embeddingSettings(this.config);
    if (!settings || (profileKey && profileKey !== settings.key)) return;
    const profile = await this.profile();
    // Batch inference outside transactions; validate the generation again at write time.
    for (;;) {
      const chunks = await this.sql<
        { id: number; chunk_text: string; chunk_hash: string }[]
      >`
        SELECT c.id, c.chunk_text, c.chunk_hash FROM chunks c
        JOIN normalized_documents n ON n.id = c.normalized_document_id JOIN filing_documents d ON d.id = c.document_id
        WHERE c.document_id = ${documentId} AND c.chunk_profile_version = ${chunkingProfileVersion}
          AND n.status = 'parsed' AND n.parser_version = ${filingParserVersion}
          AND n.text_hash = c.normalized_text_hash AND n.source_content_hash = d.content_hash
          AND NOT EXISTS (SELECT 1 FROM chunk_embeddings e WHERE e.chunk_id = c.id AND e.profile_id = ${profile.id} AND e.chunk_hash = c.chunk_hash)
        ORDER BY c.id LIMIT 16
      `;
      if (!chunks.length) return;
      const vectors = await this.vectors(
        chunks.map((chunk) => chunk.chunk_text),
        profile,
      );
      await this.sql.begin(async (tx) => {
        await assertOwnership?.(tx);
        await tx`SELECT id FROM filing_documents WHERE id = ${documentId} FOR UPDATE`;
        for (const [index, chunk] of chunks.entries()) {
          await tx`INSERT INTO chunk_embeddings (chunk_id, profile_id, chunk_hash, embedding)
            SELECT c.id, ${profile.id}, c.chunk_hash, ${JSON.stringify(vectors[index])}::vector
            FROM chunks c JOIN normalized_documents n ON n.id = c.normalized_document_id
            JOIN filing_documents d ON d.id = c.document_id
            WHERE c.id = ${chunk.id} AND c.chunk_hash = ${chunk.chunk_hash}
              AND c.chunk_profile_version = ${chunkingProfileVersion} AND n.status = 'parsed'
              AND n.parser_version = ${filingParserVersion} AND n.text_hash = c.normalized_text_hash AND n.source_content_hash = d.content_hash
            ON CONFLICT (chunk_id, profile_id) DO UPDATE SET embedding = EXCLUDED.embedding, chunk_hash = EXCLUDED.chunk_hash
          `;
        }
      });
    }
  }

  async search(
    companyId: number,
    query: string,
    mode: SearchMode,
    filters: SearchFilters,
  ) {
    let fallback: string | null = null;
    let vector: number[] | null = null;
    let profile: Profile | null = null;
    if (mode !== "full_text") {
      try {
        if (!(await this.status(companyId)).embedded)
          throw new Error("No meaning-search passages are ready yet.");
        profile = await this.profile();
        [vector] = await this.vectors([query], profile);
      } catch (error) {
        if (mode === "semantic") throw error;
        fallback =
          error instanceof Error
            ? error.message
            : "Meaning search is unavailable.";
      }
    }
    const retrieve = async (semantic: boolean) => this.sql<Hit[]>`
      SELECT c.id AS chunk_id, c.company_id, c.filing_id, c.document_id, c.normalized_document_id,
        c.normalized_text_hash AS text_hash, c.chunk_text, c.start_offset, c.end_offset, c.source_span_id,
        c.section_id, f.form_type, f.filing_date, f.report_date, f.accession_number,
        d.document_name, s.section_type, s.section_label,
        CASE WHEN ${semantic} THEN 1 - (e.embedding <=> ${vector ? JSON.stringify(vector) : "[1]"}::vector)
          ELSE ts_rank_cd(c.search_vector, websearch_to_tsquery('english', ${query})) END AS rank,
        CASE WHEN ${semantic} THEN left(c.chunk_text, 360)
          ELSE ts_headline('english', c.chunk_text, websearch_to_tsquery('english', ${query}),
            'StartSel=<mark>, StopSel=</mark>, MaxWords=42, MinWords=18') END AS snippet
      FROM chunks c JOIN filings f ON f.id = c.filing_id
      JOIN filing_documents d ON d.id = c.document_id JOIN filing_sections s ON s.id = c.section_id
      JOIN normalized_documents n ON n.id = c.normalized_document_id
      LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id AND e.profile_id = ${profile?.id ?? null}
      WHERE c.company_id = ${companyId} AND c.chunk_profile_version = ${chunkingProfileVersion}
        AND n.status = 'parsed' AND n.parser_version = ${filingParserVersion}
        AND n.source_content_hash = d.content_hash AND n.text_hash = c.normalized_text_hash
        AND (CASE WHEN ${semantic} THEN e.chunk_id IS NOT NULL AND e.chunk_hash = c.chunk_hash
          ELSE c.search_vector @@ websearch_to_tsquery('english', ${query}) END)
        AND (${filters.formType ?? null}::text IS NULL OR f.form_type = ${filters.formType ?? null})
        AND (${filters.sectionType ?? null}::text IS NULL OR s.section_type = ${filters.sectionType ?? null})
        AND (${filters.filedAfter ?? null}::date IS NULL OR f.filing_date >= ${filters.filedAfter ?? null}::date)
        AND (${filters.filedBefore ?? null}::date IS NULL OR f.filing_date <= ${filters.filedBefore ?? null}::date)
      ORDER BY rank DESC, f.filing_date DESC, c.id LIMIT ${Math.min(100, filters.limit * 3)}
    `;
    const lexical = mode === "semantic" ? [] : await retrieve(false);
    const meaning = vector ? await retrieve(true) : [];
    const hits = new Map<string, Hit>();
    for (const list of [lexical, meaning])
      for (const [index, hit] of list.entries()) {
        const existing = hits.get(hit.chunk_id);
        hits.set(hit.chunk_id, {
          ...hit,
          rank: (existing?.rank ?? 0) + 1 / (60 + index + 1),
        });
      }
    const results =
      mode === "hybrid" && vector
        ? [...hits.values()].sort((a, b) => b.rank - a.rank)
        : mode === "semantic"
          ? meaning
          : lexical;
    return {
      query,
      mode: fallback ? "full_text" : mode,
      fallback,
      results: results.slice(0, filters.limit),
    };
  }
}
