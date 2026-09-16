import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SEC_BASE_URL = "https://www.sec.gov";
const SEC_DATA_URL = "https://data.sec.gov";

export type SecCachedResponse = {
  url: string;
  status: number;
  contentType: string | null;
  bodyPath: string;
  contentHash: string;
};

export type TickerMatch = { ticker: string; cik: number; title: string };

export type SubmissionFiling = {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate?: string;
  primaryDocument?: string;
  items?: string;
  isXbrl?: boolean;
  isInlineXbrl?: boolean;
};

export type CompanySubmission = {
  name: string;
  tickers: string[];
  exchanges: string[];
  sic?: string;
  sicDescription?: string;
  entityType?: string;
  fiscalYearEnd?: string;
  stateOfIncorporation?: string;
  stateOfIncorporationDescription?: string;
  businessAddress?: SecAddress;
  mailingAddress?: SecAddress;
  formerNames: Array<{ name?: string; from?: string; to?: string }>;
  filings: SubmissionFiling[];
  cachedResponses: SecCachedResponse[];
};

export type SecAddress = {
  street1?: string;
  street2?: string;
  city?: string;
  stateOrCountry?: string;
  stateOrCountryDescription?: string;
  zipCode?: string;
  phone?: string;
};

type FetchLike = typeof fetch;

function requireUserAgent(userAgent: string | undefined): string {
  if (!userAgent || !/\S+.*@\S+/.test(userAgent)) {
    throw new Error("SEC_USER_AGENT must be descriptive and include a contact email before SEC ingestion can run.");
  }
  return userAgent;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asAddress(value: unknown): SecAddress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const address = value as Record<string, unknown>;
  const result: SecAddress = {
    street1: asString(address.street1),
    street2: asString(address.street2),
    city: asString(address.city),
    stateOrCountry: asString(address.stateOrCountry),
    stateOrCountryDescription: asString(address.stateOrCountryDescription),
    zipCode: asString(address.zipCode),
    phone: asString(address.phone),
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

function filingRows(raw: unknown): SubmissionFiling[] {
  if (!raw || typeof raw !== "object") return [];
  const object = raw as Record<string, unknown>;
  const accessions = asStringArray(object.accessionNumber);
  const forms = asStringArray(object.form);
  const dates = asStringArray(object.filingDate);
  const reportDates = asStringArray(object.reportDate);
  const primaryDocuments = asStringArray(object.primaryDocument);
  const items = asStringArray(object.items);
  const xbrl = Array.isArray(object.isXBRL) ? object.isXBRL : [];
  const inlineXbrl = Array.isArray(object.isInlineXBRL) ? object.isInlineXBRL : [];

  return accessions.flatMap((accessionNumber, index) => {
    const form = forms[index];
    const filingDate = dates[index];
    if (!form || !filingDate) return [];
    return [{
      accessionNumber,
      form,
      filingDate,
      reportDate: reportDates[index],
      primaryDocument: primaryDocuments[index],
      items: items[index],
      isXbrl: typeof xbrl[index] === "number" ? xbrl[index] === 1 : undefined,
      isInlineXbrl: typeof inlineXbrl[index] === "number" ? inlineXbrl[index] === 1 : undefined,
    }];
  });
}

export function canonicalCik(cik: number): string {
  return String(cik).padStart(10, "0");
}

export function isSupportedMvpForm(form: string): boolean {
  return ["10-K", "10-Q", "8-K", "10-K/A", "10-Q/A", "8-K/A"].includes(form);
}

export class SecClient {
  private static requestTail = Promise.resolve();
  private static nextRequestAt = 0;

  constructor(
    private readonly options: { dataDir: string; userAgent?: string; rateLimitPerSecond: number; fetch?: FetchLike },
  ) {}

  async resolveTicker(input: string): Promise<{ match: TickerMatch; response: SecCachedResponse }> {
    const response = await this.fetchJson(`${SEC_BASE_URL}/files/company_tickers.json`);
    const payload = response.body;
    const matches = Object.values(payload as Record<string, unknown>).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const value = entry as Record<string, unknown>;
      const ticker = asString(value.ticker)?.toUpperCase();
      const title = asString(value.title);
      const cik = value.cik_str;
      return ticker === input.toUpperCase() && title && typeof cik === "number"
        ? [{ ticker, title, cik }]
        : [];
    });
    if (matches.length === 0) throw new Error(`Ticker ${input.toUpperCase()} was not found in the official SEC mapping.`);
    if (matches.length > 1) throw new Error(`Ticker ${input.toUpperCase()} is ambiguous in the official SEC mapping.`);
    return { match: matches[0], response: response.cache };
  }

  async fetchCompanySubmission(cik: number): Promise<CompanySubmission> {
    const base = await this.fetchJson(`${SEC_DATA_URL}/submissions/CIK${canonicalCik(cik)}.json`);
    const root = base.body as Record<string, unknown>;
    const recent = root.filings && typeof root.filings === "object"
      ? filingRows((root.filings as Record<string, unknown>).recent)
      : [];
    const files = root.filings && typeof root.filings === "object"
      ? (root.filings as Record<string, unknown>).files
      : [];
    const cachedResponses = [base.cache];
    const historic: SubmissionFiling[] = [];
    if (Array.isArray(files)) {
      for (const entry of files) {
        const name = entry && typeof entry === "object" ? asString((entry as Record<string, unknown>).name) : undefined;
        if (!name) continue;
        const archived = await this.fetchJson(`${SEC_DATA_URL}/submissions/${name}`);
        cachedResponses.push(archived.cache);
        historic.push(...filingRows(archived.body));
      }
    }

    return {
      name: asString(root.name) ?? `CIK ${canonicalCik(cik)}`,
      tickers: asStringArray(root.tickers).map((ticker) => ticker.toUpperCase()),
      exchanges: asStringArray(root.exchanges),
      sic: asString(root.sic),
      sicDescription: asString(root.sicDescription),
      entityType: asString(root.entityType),
      fiscalYearEnd: asString(root.fiscalYearEnd),
      stateOfIncorporation: asString(root.stateOfIncorporation),
      stateOfIncorporationDescription: asString(root.stateOfIncorporationDescription),
      businessAddress: asAddress(root.businessAddress),
      mailingAddress: asAddress(root.mailingAddress),
      formerNames: Array.isArray(root.formerNames) ? root.formerNames.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")) : [],
      filings: [...recent, ...historic],
      cachedResponses,
    };
  }

  private async fetchJson(url: string): Promise<{ body: unknown; cache: SecCachedResponse }> {
    const userAgent = requireUserAgent(this.options.userAgent);
    const request = this.options.fetch ?? fetch;
    const attempts = 3;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await this.waitForRateLimit();
      try {
        const response = await request(url, { headers: { "User-Agent": userAgent, Accept: "application/json" } });
        const text = await response.text();
        if (!response.ok) {
          if ([403, 429, 500, 502, 503, 504].includes(response.status) && attempt < attempts - 1) {
            await this.backoff(attempt);
            continue;
          }
          throw new Error(`SEC request failed (${response.status}) for ${url}.`);
        }
        const contentHash = createHash("sha256").update(text).digest("hex");
        const directory = join(this.options.dataDir, "sec", "api");
        await mkdir(directory, { recursive: true });
        const bodyPath = join(directory, `${contentHash}.json`);
        await writeFile(bodyPath, text, { flag: "w" });
        return {
          body: JSON.parse(text) as unknown,
          cache: { url, status: response.status, contentType: response.headers.get("content-type"), bodyPath, contentHash },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("SEC request failed.");
        if (attempt < attempts - 1) await this.backoff(attempt);
      }
    }
    throw lastError ?? new Error(`SEC request failed for ${url}.`);
  }

  private async waitForRateLimit(): Promise<void> {
    const priorRequest = SecClient.requestTail;
    let releaseRequest: () => void;
    SecClient.requestTail = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await priorRequest;
    const minimumInterval = Math.ceil(1_000 / this.options.rateLimitPerSecond);
    try {
      const wait = SecClient.nextRequestAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      SecClient.nextRequestAt = Date.now() + minimumInterval;
    } finally {
      releaseRequest!();
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const jitter = Math.floor(Math.random() * 100);
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt) + jitter));
  }
}
