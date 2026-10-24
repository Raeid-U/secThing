import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { OllamaClient, OpenAiCompatibleClient, type EmbeddingProvider } from "./ai.js";
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
export type SearchHit = { chunk_id: string; rank: number; chunk_text: string; filing_id: string; document_id: string; normalized_document_id: string; source_span_id: string; form_type: string; filing_date: string; accession_number: string; section_type: string; section_label: string; start_offset: number; end_offset: number; text_hash: string; [key: string]: unknown };
type Hit = SearchHit;
export type QueryAnalysis = { formTypes: string[]; filedAfter?: string; filedBefore?: string; metrics: string[]; comparison: boolean; numeric: boolean };
export type EvidenceSource = { label: string; kind: "chunk" | "financial_fact"; sourceId: string; text: string; tokenEstimate: number; locator: Record<string, unknown> };
export type EvidencePackage = { question: string; analysis: QueryAnalysis; sources: EvidenceSource[]; tokens: { budget: number; used: number; reservedOutput: number }; generationIds: string[]; coverage: Record<string, unknown> };

const METRIC_ALIASES: Record<string, string[]> = { revenue: ["revenue", "sales"], net_income: ["net income", "profit", "loss"], assets: ["assets"], liabilities: ["liabilities"], cash: ["cash"], operating_cash_flow: ["operating cash flow", "cash from operations"], debt: ["debt", "borrowings"], shares: ["shares outstanding"], eps: ["eps", "earnings per share"] };
export function analyzeQuestion(question: string): QueryAnalysis {
  const lower = question.toLowerCase();
  const years = [...lower.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  const forms = [...new Set([...lower.matchAll(/\b(10-k|10-q|8-k)(?:\/a)?\b/g)].map((match) => match[0].toUpperCase()))];
  const metrics = Object.entries(METRIC_ALIASES).filter(([, aliases]) => aliases.some((alias) => lower.includes(alias))).map(([metric]) => metric);
  return { formTypes: forms, ...(years.length ? { filedAfter: `${Math.min(...years)}-01-01`, filedBefore: `${Math.max(...years)}-12-31` } : {}), metrics,
    comparison: /\b(change|changed|compare|versus|vs\.?|trend|over time|between)\b/.test(lower) || years.length > 1,
    numeric: metrics.length > 0 || /\b(how much|amount|percent|percentage|ratio)\b/.test(lower) };
}

export function embeddingSettings(config: PlatformConfig) {
  if (
    config.aiMode === "disabled" ||
    !config.aiEmbeddingBaseUrl ||
    !config.aiEmbeddingModel ||
    !["ollama", "openai_compatible"].includes(config.aiEmbeddingProvider ?? "")
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
      (config.aiEmbeddingProvider === "openai_compatible" ? new OpenAiCompatibleClient({
        baseUrl: config.aiEmbeddingBaseUrl ?? "http://localhost:11434", apiKey: config.aiEmbeddingApiKey, timeoutMs: config.aiRequestTimeoutMs,
      }) : new OllamaClient({
        baseUrl: config.aiEmbeddingBaseUrl ?? "http://localhost:11434",
        apiKey: config.aiEmbeddingApiKey,
        timeoutMs: config.aiRequestTimeoutMs,
      }));
  }

  private async profile(): Promise<Profile> {
    const settings = embeddingSettings(this.config);
    if (!settings)
      throw new Error("Meaning search needs a configured embedding model.");
    const profiles = await this.sql<Profile[]>`
      INSERT INTO embedding_profiles (profile_key, provider, model, dimension)
      VALUES (${settings.key}, ${this.config.aiEmbeddingProvider ?? "ollama"}, ${settings.model}, ${this.config.aiEmbeddingDimension ?? null})
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
    if (this.config.aiMode === "external") {
      if (!companyId) return { queued: 0, approvalRequired: true };
      const corpus = await this.sql<{ fingerprint: string | null }[]>`
        SELECT md5(string_agg(c.id::text || ':' || c.chunk_hash, ',' ORDER BY c.id)) AS fingerprint
        FROM chunks c JOIN normalized_documents n ON n.id = c.normalized_document_id
        WHERE c.company_id = ${companyId} AND n.status = 'parsed'`;
      const approved = corpus[0].fingerprint && (await this.sql`
        SELECT id FROM embedding_approvals WHERE company_id = ${companyId} AND profile_key = ${settings.key}
          AND corpus_fingerprint = ${corpus[0].fingerprint} AND approved_at IS NOT NULL`)[0];
      if (!approved) return { queued: 0, approvalRequired: true };
    }
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
      if (!chunks.length) {
        await this.sql`UPDATE filing_documents SET stage = 'embedded', updated_at = now() WHERE id = ${documentId}`;
        return;
      }
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

  async evidencePackage(companyId: number, question: string, options: { maxInputTokens: number; reservedOutputTokens?: number }): Promise<EvidencePackage> {
    const analysis = analyzeQuestion(question);
    const search = await this.search(companyId, question, "hybrid", { limit: 36, formType: analysis.formTypes.length === 1 ? analysis.formTypes[0] : undefined,
      filedAfter: analysis.filedAfter, filedBefore: analysis.filedBefore });
    const selected: SearchHit[] = [];
    const perFiling = new Map<string, number>();
    for (const hit of search.results as SearchHit[]) {
      const count = perFiling.get(String(hit.filing_id)) ?? 0;
      if (analysis.comparison && count >= 2) continue;
      selected.push(hit); perFiling.set(String(hit.filing_id), count + 1);
    }
    const facts = analysis.metrics.length ? await this.sql<{ id: string; metric: string; taxonomy: string; concept: string; unit: string; value: string; period_start: string | null; period_end: string | null; instant_date: string | null; fiscal_year: number | null; fiscal_period: string | null; form_type: string | null; accession_number: string | null; conflict_status: string }[]>`
      SELECT id, metric, taxonomy, concept, unit, value::text, period_start::text, period_end::text, instant_date::text,
        fiscal_year, fiscal_period, form_type, accession_number, conflict_status FROM financial_facts
      WHERE company_id = ${companyId} AND metric = ANY(${analysis.metrics}::text[])
      ORDER BY COALESCE(period_end, instant_date) DESC, conflict_status = 'selected' DESC LIMIT 20` : [];
    const candidates: EvidenceSource[] = [
      ...facts.map((fact, index) => ({ label: `F${index + 1}`, kind: "financial_fact" as const, sourceId: `financial_fact:${fact.id}`,
        text: `${fact.metric}: ${fact.value} ${fact.unit}; period ${fact.period_start ? `${fact.period_start} to ${fact.period_end}` : fact.instant_date}; ${fact.form_type ?? "unknown form"}; status ${fact.conflict_status}.`, tokenEstimate: 32,
        locator: { financialFactId: fact.id, accessionNumber: fact.accession_number, formType: fact.form_type, taxonomy: fact.taxonomy, concept: fact.concept } })),
      ...selected.map((hit, index) => ({ label: `C${index + 1}`, kind: "chunk" as const, sourceId: `chunk:${hit.chunk_id}`, text: hit.chunk_text,
        tokenEstimate: Math.max(1, Math.ceil(hit.chunk_text.length / 4)), locator: { chunkId: hit.chunk_id, filingId: hit.filing_id, documentId: hit.document_id,
          normalizedDocumentId: hit.normalized_document_id, sourceSpanId: hit.source_span_id, accessionNumber: hit.accession_number, formType: hit.form_type,
          filingDate: hit.filing_date, sectionType: hit.section_type, sectionLabel: hit.section_label, startOffset: hit.start_offset, endOffset: hit.end_offset, textHash: hit.text_hash } })),
    ];
    const sources: EvidenceSource[] = [];
    let used = 0;
    for (const source of candidates) { if (used + source.tokenEstimate > options.maxInputTokens) continue; sources.push(source); used += source.tokenEstimate; }
    const generations = [...new Set(sources.flatMap((source) => source.kind === "chunk" ? [String(source.locator.normalizedDocumentId)] : []))];
    return { question, analysis, sources, tokens: { budget: options.maxInputTokens, used, reservedOutput: options.reservedOutputTokens ?? this.config.aiChatMaxOutputTokens ?? 1_024 },
      generationIds: generations, coverage: { retrievalMode: search.mode, fallback: search.fallback, sourceCount: sources.length, financialFactCount: facts.length } };
  }
}
