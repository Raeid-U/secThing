import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { connectDatabase, loadConfig, answerPromptVersion, diagnoseAnswerRun } from "@secthing/platform";

async function main() {
const { values } = parseArgs({ options: { limit: { type: "string", default: "5" }, "company-id": { type: "string" }, file: { type: "string" }, "include-claims": { type: "boolean", default: false }, help: { type: "boolean" } } });
if (values.help) {
  process.stdout.write("Read-only answer audit diagnostics. No model calls or database writes.\nUsage: npm run diagnose:answers -- [--limit 5] [--company-id 1]\n       npm run diagnose:answers -- --file /path/to/model-runs.json\nDocker: docker compose exec backend npm run diagnose:answers -- --limit 5\nDefault output omits model prose. --include-claims adds unverified claim text and bounded quotes; full source bodies and credentials remain omitted.\n");
} else {
  const limit = Number(values.limit), companyId = values["company-id"] === undefined ? null : Number(values["company-id"]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 || (companyId !== null && (!Number.isInteger(companyId) || companyId < 1))) throw new Error("Use --limit 1–20 and an optional positive --company-id.");
  if (values.file) {
    const payload: unknown = JSON.parse(await readFile(values.file, "utf8"));
    if (!Array.isArray(payload)) throw new Error("The diagnostic file must contain a JSON array of model-run rows.");
    process.stdout.write(JSON.stringify({ currentPromptVersion: answerPromptVersion, mode: "offline_read_only_replay", runs: payload.slice(0, limit).map((row) => diagnoseAnswerRun(row, { includeClaims: values["include-claims"] })) }, null, 2) + "\n");
  } else {
    const config = loadConfig();
    const sql = connectDatabase(config.databaseUrl);
    try {
      const rows = await sql`SELECT m.id, m.company_id, c.legal_name AS company_name, m.created_at, m.prompt_version,
        m.validation_status, m.error_message, m.raw_output FROM model_runs m JOIN companies c ON c.id = m.company_id
        WHERE (${companyId}::bigint IS NULL OR m.company_id = ${companyId}) ORDER BY m.id DESC LIMIT ${limit}`;
      process.stdout.write(JSON.stringify({ currentPromptVersion: answerPromptVersion, mode: "read_only_audit_replay",
        currentRuntime: { model: config.aiChatModel, contextWindow: config.aiChatContextWindow, outputTokens: config.aiChatMaxOutputTokens, verificationOutputTokens: config.aiVerificationMaxOutputTokens },
        runs: rows.map((row) => diagnoseAnswerRun(row, { contextWindow: config.aiChatContextWindow, outputTokens: config.aiChatMaxOutputTokens ?? 1024, verificationOutputTokens: config.aiVerificationMaxOutputTokens, includeClaims: values["include-claims"] })) }, null, 2) + "\n");
    } finally { await sql.end(); }
  }
}

}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Answer diagnostics failed.");
  process.exitCode = 1;
});
