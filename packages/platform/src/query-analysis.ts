export type QueryAnalysis = {
  formTypes: string[]; filedAfter?: string; filedBefore?: string;
  periodAfter?: string; periodBefore?: string; asOf?: string;
  metrics: string[]; topics: string[]; keywords: string[];
  comparison: boolean; numeric: boolean;
};
const METRIC_ALIASES: Record<string, string[]> = { revenue: ["revenue", "sales"], net_income: ["net income", "profit", "loss"], assets: ["assets"], liabilities: ["liabilities"], cash: ["cash"], operating_cash_flow: ["operating cash flow", "cash from operations"], debt: ["debt", "borrowings"], shares: ["shares outstanding"], eps: ["eps", "earnings per share"] };
const STOPWORDS = new Set("what when where which who how did does do the a an this that company companies filings filing in on of to for and or from between versus vs change changed compare much amount during before after since until through as at by is was were are has have had its their over time tell me about show explain please fiscal year years quarter quarters reported report annual".split(" "));
export class QueryScopeError extends Error {}
function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new QueryScopeError(`Invalid question date: ${value}. Use YYYY-MM-DD.`);
  return value;
}
function shiftDay(value: string, days: number) { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

// No inference call: preserve the complete semantic question and derive explicit
// constraints separately. Bare financial years refer to reporting periods, not
// the year in which the report was filed. An explicit "filed" qualifier overrides.
export function analyzeQuestion(question: string, now = new Date()): QueryAnalysis {
  const lower = question.toLowerCase().replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/g,
    (_, month: string, day: string, year: string) => {
      const months = "january february march april may june july august september october november december".split(" ");
      return validDate(`${year}-${String(months.indexOf(month) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`);
    });
  if (/\bfiscal\s+(?:quarter|q[1-4])|\bq[1-4]\b.*\bfiscal\b/.test(lower)) throw new QueryScopeError("For fiscal-quarter questions, specify the reporting-period dates (YYYY-MM-DD) so calendar quarters are not assumed.");
  const forms = [...new Set([...lower.matchAll(/\b(?:10-k|10-q|8-k)(?:\/a)?\b/g)].map((m) => m[0].toUpperCase()))];
  const metrics = Object.entries(METRIC_ALIASES).filter(([, aliases]) => aliases.some((alias) => new RegExp(`\\b${alias}\\b`).test(lower))).map(([metric]) => metric);
  const numeric = metrics.length > 0 || /\b(how much|amount|percent|percentage|ratio)\b/.test(lower);
  const topics = [/\brisks?\b/.test(lower) ? "risk_factors" : "", /\bbusiness\b/.test(lower) ? "business" : "", /\b(management|md&a)\b/.test(lower) ? "management_discussion" : ""].filter(Boolean);
  const keywords = [...new Set((lower.replace(/\b(?:19|20)\d{2}(?:-\d{2}-\d{2})?\b/g, " ").replace(/\b(?:10-k|10-q|8-k)(?:\/a)?\b/g, " ").match(/[a-z][a-z'-]+/g) ?? []).filter((w) => !STOPWORDS.has(w)))].slice(0, 24);
  const result: QueryAnalysis = { formTypes: forms, metrics, topics, keywords, comparison: /\b(change|changed|compare|versus|vs\.?|trend|over time|between)\b/.test(lower), numeric };
  const publication = lower.match(/\bfiled\s+(?:in|between|from|after|since|before|until|through)\s+(?:19|20)\d{2}(?:-\d{2}-\d{2})?(?:\s+(?:and|to|through|until|before)\s+(?:19|20)\d{2}(?:-\d{2}-\d{2})?)?/);
  const remainder = publication ? lower.replace(publication[0], "") : lower;
  const separatePeriod = Boolean(publication && /\b(?:19|20)\d{2}\b/.test(remainder) && (numeric || /\b(fiscal|reporting|period|fy|q[1-4])\b/.test(remainder)));
  const explicitFiled = !separatePeriod && /\bfiled\b|filing dates?/.test(lower);
  const period = !explicitFiled && (numeric || /\b(fiscal|reporting|period|fy|q[1-4])\b/.test(lower));
  const asOf = lower.match(/\bas (?:of|at)\s+((?:19|20)\d{2}(?:-\d{2}-\d{2})?)/);
  if (asOf) {
    result.asOf = asOf[1].length === 4 ? `${asOf[1]}-12-31` : validDate(asOf[1]);
    result.filedBefore = result.asOf;
  }
  const dateText = separatePeriod ? remainder : lower;
  const scopeText = asOf ? dateText.replace(asOf[0], "") : dateText;
  const dates = [...scopeText.matchAll(/\b((?:19|20)\d{2}-\d{2}-\d{2})\b/g)].map((m) => validDate(m[1]));
  const years = [...scopeText.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  let after: string | undefined, before: string | undefined;
  if (dates.length >= 2) { after = dates[0]; before = dates[dates.length - 1]; }
  else if (dates.length === 1) { after = dates[0]; before = dates[0]; }
  else if (years.length) { after = `${Math.min(...years)}-01-01`; before = `${Math.max(...years)}-12-31`; }
  const quarter = scopeText.match(/\bq([1-4])\s+(?:of\s+)?((?:19|20)\d{2})\b/);
  if (quarter) {
    const month = (Number(quarter[1]) - 1) * 3;
    after = new Date(Date.UTC(Number(quarter[2]), month, 1)).toISOString().slice(0, 10);
    before = new Date(Date.UTC(Number(quarter[2]), month + 3, 0)).toISOString().slice(0, 10);
  }
  const relative = scopeText.match(/\b(?:last|past)\s+(\d{1,2})\s+(years?|months?|days?)\b/);
  if (relative) {
    const start = new Date(now); const n = Number(relative[1]);
    if (!n) throw new QueryScopeError("The requested time range must be positive.");
    if (relative[2].startsWith("year")) start.setUTCFullYear(start.getUTCFullYear() - n);
    else if (relative[2].startsWith("month")) start.setUTCMonth(start.getUTCMonth() - n);
    else start.setUTCDate(start.getUTCDate() - n);
    after = start.toISOString().slice(0, 10); before = now.toISOString().slice(0, 10);
  } else if (/\blast year\b/.test(lower)) { after = `${now.getUTCFullYear() - 1}-01-01`; before = `${now.getUTCFullYear() - 1}-12-31`; }
  else if (/\bthis year\b/.test(lower)) { after = `${now.getUTCFullYear()}-01-01`; before = now.toISOString().slice(0, 10); }
  if (after && before && after > before) throw new QueryScopeError("The question's start date is after its end date.");
  if (!relative) {
    const boundary = (word: string) => scopeText.match(new RegExp(`\\b(?:${word})\\s+((?:19|20)\\d{2}(?:-\\d{2}-\\d{2})?)\\b`))?.[1];
    const lowerExclusive = boundary("after");
    const lowerInclusive = boundary("since");
    const upperExclusive = boundary("before|prior to");
    const upperInclusive = boundary("until|through");
    const startOf = (value: string) => value.length === 4 ? `${value}-01-01` : validDate(value);
    const endOf = (value: string) => value.length === 4 ? `${value}-12-31` : validDate(value);
    if (lowerExclusive || lowerInclusive) {
      after = lowerExclusive ? shiftDay(endOf(lowerExclusive), 1) : startOf(lowerInclusive!);
      if (!upperExclusive && !upperInclusive && years.length === 1) before = undefined;
    }
    if (upperExclusive || upperInclusive) {
      before = upperExclusive ? shiftDay(startOf(upperExclusive), -1) : endOf(upperInclusive!);
      if (!lowerExclusive && !lowerInclusive && !/\b(?:between|from)\b/.test(scopeText)) after = undefined;
    }
  }
  if (after && before && after > before) throw new QueryScopeError("The question's start date is after its end date.");
  if (period) { result.periodAfter = after; result.periodBefore = before; }
  else { if (after) result.filedAfter = after; if (before) result.filedBefore = before; }
  if (result.asOf) {
    if (result.filedBefore && result.filedBefore > result.asOf) result.filedBefore = result.asOf;
    if (period && (!result.periodBefore || result.periodBefore > result.asOf)) result.periodBefore = result.asOf;
  }
  if (separatePeriod) {
    // Recursive input contains only the publication clause, so it cannot create
    // another separate period. Keep publication and reporting dates independent.
    const filedScope = analyzeQuestion(publication![0], now);
    result.filedAfter = filedScope.filedAfter;
    if (filedScope.filedBefore && (!result.filedBefore || filedScope.filedBefore < result.filedBefore)) result.filedBefore = filedScope.filedBefore;
  }
  result.comparison ||= years.length > 1 || Boolean(relative);
  return result;
}
