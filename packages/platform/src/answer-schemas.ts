// Grammar constraints prevent small local models from replacing claim objects
// with strings. Citation membership and semantic support are still validated.
export function answerResponseSchema(labels: string[]): Record<string, unknown> {
  const label = { type: "string", ...(labels.length ? { enum: labels } : {}) };
  const statement = { type: "object", additionalProperties: false, required: ["statement", "citations"], properties: {
    statement: { type: "string", minLength: 1, maxLength: 1600 },
    citations: { type: "array", minItems: 1, items: label },
  } };
  return { type: "object", additionalProperties: false, required: ["summary", "findings", "interpretation"], properties: {
    summary: { type: "array", maxItems: 2, items: statement },
    findings: { type: "array", maxItems: 3, items: statement },
    interpretation: { type: "array", maxItems: 1, items: statement },
  } };
}

export function verificationResponseSchema(claimIds: string[], labels: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required: ["verdicts"], properties: {
    verdicts: { type: "array", minItems: claimIds.length, maxItems: claimIds.length, items: {
      type: "object", additionalProperties: false, required: ["id", "factual", "temporal", "contextual", "quotes"], properties: {
        id: { type: "string", ...(claimIds.length ? { enum: claimIds } : {}) },
        factual: { type: "boolean" }, temporal: { type: "boolean" }, contextual: { type: "boolean" },
        quotes: { type: "array", maxItems: labels.length, items: { type: "object", additionalProperties: false, required: ["source", "text"], properties: {
          source: { type: "string", ...(labels.length ? { enum: labels } : {}) }, text: { type: "string", minLength: 1, maxLength: 240 },
        } } },
      },
    } },
  } };
}
