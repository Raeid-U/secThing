import type { Sql } from "postgres";
import type { ChatProvider } from "./ai.js";
import { OllamaClient, OpenAiCompatibleClient } from "./ai.js";
import type { PlatformConfig } from "./config.js";
import { Retrieval, type EvidencePackage } from "./retrieval.js";

export const answerPromptVersion = "grounded-answer-v1";
export const answerSchemaVersion = "grounded-answer-schema-v1";
export type SourcedStatement = { statement: string; citations: string[] };
export type StructuredAnswer = { findings: SourcedStatement[]; interpretation: SourcedStatement[]; limitations: string[] };

export function validateStructuredAnswer(value: unknown, allowedSources: Set<string>): StructuredAnswer {
  if (!value || typeof value !== "object") throw new Error("Model output is not an object.");
  const body = value as Record<string, unknown>;
  const statements = (field: "findings" | "interpretation") => {
    if (!Array.isArray(body[field])) throw new Error(`${field} must be an array.`);
    return body[field].map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error(`${field} contains an invalid statement.`);
      const item = entry as Record<string, unknown>;
      if (typeof item.statement !== "string" || !item.statement.trim() || !Array.isArray(item.citations) || !item.citations.length)
        throw new Error(`${field} statements require text and at least one citation.`);
      const citations = item.citations.filter((citation): citation is string => typeof citation === "string");
      if (citations.length !== item.citations.length || citations.some((citation) => !allowedSources.has(citation)))
        throw new Error(`${field} contains an unknown citation.`);
      return { statement: item.statement.trim(), citations };
    });
  };
  if (!Array.isArray(body.limitations) || body.limitations.some((item) => typeof item !== "string")) throw new Error("limitations must be a string array.");
  return { findings: statements("findings"), interpretation: statements("interpretation"), limitations: body.limitations as string[] };
}

function parseJson(content: string): unknown {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return JSON.");
  return JSON.parse(match[0]);
}

export class GroundedAnswer {
  private provider: ChatProvider;
  private retrieval: Retrieval;
  constructor(private sql: Sql, private config: PlatformConfig, provider?: ChatProvider, retrieval?: Retrieval) {
    this.retrieval = retrieval ?? new Retrieval(sql, config);
    this.provider = provider ?? (config.aiChatProvider === "openai_compatible"
      ? new OpenAiCompatibleClient({ baseUrl: config.aiChatBaseUrl!, apiKey: config.aiChatApiKey, timeoutMs: config.aiRequestTimeoutMs })
      : new OllamaClient({ baseUrl: config.aiChatBaseUrl!, apiKey: config.aiChatApiKey, timeoutMs: config.aiRequestTimeoutMs }));
  }

  async answer(companyId: number, question: string) {
    if (!this.config.aiChatModel || !this.config.aiChatBaseUrl) throw new Error("A chat provider and model must be configured.");
    const outputTokens = this.config.aiChatMaxOutputTokens ?? 1_024;
    const evidence = await this.retrieval.evidencePackage(companyId, question, { maxInputTokens: Math.max(512, this.config.aiChatContextWindow - outputTokens), reservedOutputTokens: outputTokens });
    if (!evidence.sources.length) return { status: "insufficient_evidence" as const, findings: [], interpretation: [], limitations: ["The indexed filings do not provide sufficient evidence for this question."], citations: [], coverage: evidence.coverage, modelRunId: null };
    const started = Date.now();
    let raw = "";
    let answer: StructuredAnswer | undefined;
    let validationError: string | undefined;
    const system = `You answer questions only from the supplied SEC evidence. This is research, not investment advice. Return JSON only with findings, interpretation, and limitations. Every finding and interpretation item must be {"statement":string,"citations":[source labels]}. Never cite labels not supplied. State gaps in limitations.`;
    const payload = JSON.stringify({ question, evidence: evidence.sources });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.provider.chat({ model: this.config.aiChatModel, messages: [
          { role: "system", content: system },
          { role: "user", content: attempt === 0 ? payload : `${payload}\nYour previous response was invalid (${validationError}). Return corrected JSON only.` },
        ], temperature: 0, responseFormat: "json" });
        raw = response.content;
        answer = validateStructuredAnswer(parseJson(raw), new Set(evidence.sources.map((source) => source.label)));
        break;
      } catch (error) { validationError = error instanceof Error ? error.message : "Structured output validation failed."; }
    }
    const cited = answer ? [...new Set([...answer.findings, ...answer.interpretation].flatMap((item) => item.citations))] : [];
    const runs = await this.sql<{ id: number }[]>`INSERT INTO model_runs (company_id, provider, model, prompt_version, schema_version,
      evidence_generation_ids, cited_source_ids, token_estimate, raw_output, validation_status, error_message, latency_ms)
      VALUES (${companyId}, ${this.config.aiChatProvider ?? "ollama"}, ${this.config.aiChatModel}, ${answerPromptVersion}, ${answerSchemaVersion},
        ${this.sql.json(evidence.generationIds as never)}, ${this.sql.json(cited as never)}, ${evidence.tokens.used},
        ${this.sql.json(({ content: raw }) as never)}, ${answer ? "valid" : "evidence_only"}, ${validationError ?? null}, ${Date.now() - started}) RETURNING id`;
    const citations = evidence.sources.filter((source) => cited.includes(source.label));
    return answer
      ? { status: "answered" as const, ...answer, citations, coverage: evidence.coverage, modelRunId: runs[0].id }
      : { status: "generation_limited" as const, findings: evidence.sources.map((source) => ({ statement: source.text, citations: [source.label] })), interpretation: [], limitations: [`Answer generation could not produce valid sourced output: ${validationError}`], citations: evidence.sources, coverage: evidence.coverage, modelRunId: runs[0].id };
  }
}
