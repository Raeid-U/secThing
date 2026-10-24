import type { Sql, TransactionSql } from "postgres";
import type { SecCachedResponse } from "./sec.js";

export const FINANCIAL_CONCEPTS: Record<string, string[]> = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  net_income: ["NetIncomeLoss", "ProfitLoss"],
  assets: ["Assets"],
  liabilities: ["Liabilities"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  operating_cash_flow: ["NetCashProvidedByUsedInOperatingActivities"],
  debt: ["LongTermDebtAndFinanceLeaseObligationsCurrent", "LongTermDebtCurrent", "LongTermDebtNoncurrent", "LongTermDebt"],
  shares: ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
  eps: ["EarningsPerShareBasic", "EarningsPerShareDiluted"],
};

const conceptToMetric = new Map(Object.entries(FINANCIAL_CONCEPTS).flatMap(([metric, concepts]) => concepts.map((concept) => [concept, metric])));

export type NormalizedFinancialFact = {
  metric: string; taxonomy: string; concept: string; unit: string; value: number;
  periodStart?: string; periodEnd?: string; instantDate?: string; fiscalYear?: number;
  fiscalPeriod?: string; formType?: string; accessionNumber?: string; frame?: string;
  filed?: string; rawFact: Record<string, unknown>; conflictStatus: "selected" | "conflicting";
};

export function normalizeCompanyFacts(payload: unknown): NormalizedFinancialFact[] {
  if (!payload || typeof payload !== "object") return [];
  const facts = (payload as Record<string, unknown>).facts;
  if (!facts || typeof facts !== "object") return [];
  const result: NormalizedFinancialFact[] = [];
  for (const [taxonomy, taxonomyFacts] of Object.entries(facts as Record<string, unknown>)) {
    if (!taxonomyFacts || typeof taxonomyFacts !== "object") continue;
    for (const [concept, conceptBody] of Object.entries(taxonomyFacts as Record<string, unknown>)) {
      const metric = conceptToMetric.get(concept);
      if (!metric || !conceptBody || typeof conceptBody !== "object") continue;
      const units = (conceptBody as Record<string, unknown>).units;
      if (!units || typeof units !== "object") continue;
      for (const [unit, entries] of Object.entries(units as Record<string, unknown>)) {
        if (!Array.isArray(entries)) continue;
        for (const raw of entries) {
          if (!raw || typeof raw !== "object") continue;
          const fact = raw as Record<string, unknown>;
          if (typeof fact.val !== "number" || !Number.isFinite(fact.val)) continue;
          const start = typeof fact.start === "string" ? fact.start : undefined;
          const end = typeof fact.end === "string" ? fact.end : undefined;
          result.push({ metric, taxonomy, concept, unit, value: fact.val, periodStart: start,
            periodEnd: start ? end : undefined, instantDate: start ? undefined : end,
            fiscalYear: typeof fact.fy === "number" ? fact.fy : undefined,
            fiscalPeriod: typeof fact.fp === "string" ? fact.fp : undefined,
            formType: typeof fact.form === "string" ? fact.form : undefined,
            accessionNumber: typeof fact.accn === "string" ? fact.accn : undefined,
            frame: typeof fact.frame === "string" ? fact.frame : undefined,
            filed: typeof fact.filed === "string" ? fact.filed : undefined, rawFact: fact, conflictStatus: "selected" });
        }
      }
    }
  }
  const groups = new Map<string, NormalizedFinancialFact[]>();
  for (const fact of result) {
    const key = [fact.metric, fact.unit, fact.periodStart ?? "", fact.periodEnd ?? fact.instantDate ?? "", fact.fiscalPeriod ?? ""].join("|");
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  for (const group of groups.values()) {
    const values = new Set(group.map((fact) => fact.value));
    if (values.size < 2) continue;
    group.sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? "") || Number(b.formType?.endsWith("/A")) - Number(a.formType?.endsWith("/A")));
    group.forEach((fact, index) => { fact.conflictStatus = index === 0 ? "selected" : "conflicting"; });
  }
  return result;
}

export async function persistCompanyFacts(sql: Sql | TransactionSql, companyId: number, response: SecCachedResponse, payload: unknown) {
  const sources = await sql<{ id: number }[]>`INSERT INTO companyfacts_sources (company_id, sec_url, body_path, content_hash)
    VALUES (${companyId}, ${response.url}, ${response.bodyPath}, ${response.contentHash})
    ON CONFLICT (company_id, content_hash) DO UPDATE SET status = 'complete', error_message = NULL RETURNING id`;
  const sourceId = sources[0].id;
  await sql`DELETE FROM financial_facts WHERE source_id = ${sourceId}`;
  const facts = normalizeCompanyFacts(payload);
  for (const fact of facts) await sql`INSERT INTO financial_facts (company_id, source_id, metric, taxonomy, concept, unit, value,
    period_start, period_end, instant_date, fiscal_year, fiscal_period, form_type, accession_number, frame, conflict_status, raw_fact)
    VALUES (${companyId}, ${sourceId}, ${fact.metric}, ${fact.taxonomy}, ${fact.concept}, ${fact.unit}, ${fact.value},
      ${fact.periodStart ?? null}, ${fact.periodEnd ?? null}, ${fact.instantDate ?? null}, ${fact.fiscalYear ?? null},
      ${fact.fiscalPeriod ?? null}, ${fact.formType ?? null}, ${fact.accessionNumber ?? null}, ${fact.frame ?? null},
      ${fact.conflictStatus}, ${sql.json(fact.rawFact as never)})`;
  return { sourceId, count: facts.length };
}
