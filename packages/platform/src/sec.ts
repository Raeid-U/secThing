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

export type AcquiredFilingDocument = {
  documentName: string;
  documentType: "primary_filing" | "exhibit";
  url: string;
  contentType: string | null;
  bodyPath: string;
  contentHash: string;
  byteSize: number;
  indexResponse: SecCachedResponse;
};

export type FilingManifestEntry = {
  documentName: string;
  secType?: string;
  byteSize?: number;
  classification: "primary_filing" | "exhibit" | "structured_fact" | "excluded";
  included: boolean;
  exclusionReason?: string;
};

const HUMAN_READABLE_EXTENSIONS = new Set([".htm", ".html", ".txt", ".pdf"]);
const TECHNICAL_EXTENSIONS = new Set([".xsd", ".xml", ".json"]);

export function classifyFilingDocument(input: { name: string; secType?: string; primaryDocument?: string; formType: string }): FilingManifestEntry {
  const name = input.name.toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const isPrimary = input.name === input.primaryDocument || input.secType === input.formType;
  if (isPrimary && HUMAN_READABLE_EXTENSIONS.has(extension))
    return { documentName: input.name, secType: input.secType, classification: "primary_filing", included: true };
  if (input.secType?.toUpperCase().startsWith("EX-") && HUMAN_READABLE_EXTENSIONS.has(extension))
    return { documentName: input.name, secType: input.secType, classification: "exhibit", included: true };
  if (TECHNICAL_EXTENSIONS.has(extension) || /(?:_cal|_def|_lab|_pre)\./i.test(name))
    return { documentName: input.name, secType: input.secType, classification: "structured_fact", included: false, exclusionReason: "Technical XBRL support file; companyfacts is ingested separately." };
  if ([".jpg", ".jpeg", ".png", ".gif", ".svg", ".css", ".js"].includes(extension))
    return { documentName: input.name, secType: input.secType, classification: "excluded", included: false, exclusionReason: "Non-text presentation or viewer asset." };
  return { documentName: input.name, secType: input.secType, classification: "excluded", included: false, exclusionReason: "Not a supported human-readable filing document." };
}

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
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function asOptionalStringArray(value: unknown): Array<string | undefined> {
  return Array.isArray(value) ? value.map(asString) : [];
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
  const accessions = asOptionalStringArray(object.accessionNumber);
  const forms = asOptionalStringArray(object.form);
  const dates = asOptionalStringArray(object.filingDate);
  const reportDates = asOptionalStringArray(object.reportDate);
  const primaryDocuments = asOptionalStringArray(object.primaryDocument);
  const items = asOptionalStringArray(object.items);
  const xbrl = Array.isArray(object.isXBRL) ? object.isXBRL : [];
  const inlineXbrl = Array.isArray(object.isInlineXBRL) ? object.isInlineXBRL : [];

  return accessions.flatMap((accessionNumber, index) => {
    const form = forms[index];
    const filingDate = dates[index];
    if (!accessionNumber || !form || !filingDate) return [];
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

export function filingArchiveDirectoryUrl(cik: number, accessionNumber: string): string {
  const accession = accessionNumber.replaceAll("-", "");
  if (!/^\d+$/.test(accession)) throw new Error(`Invalid SEC accession number: ${accessionNumber}`);
  return `${SEC_BASE_URL}/Archives/edgar/data/${cik}/${accession}`;
}

function safeDocumentName(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : undefined;
}

function contentExtension(url: string, contentType: string | null): string {
  const pathname = new URL(url).pathname;
  const name = pathname.slice(pathname.lastIndexOf("/") + 1);
  const match = name.match(/(\.[A-Za-z0-9]{1,12})$/);
  if (match) return match[1].toLowerCase();
  if (contentType?.includes("html")) return ".html";
  if (contentType?.includes("json")) return ".json";
  if (contentType?.includes("plain")) return ".txt";
  return ".bin";
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

  async fetchCompanyFacts(cik: number): Promise<{ body: unknown; response: SecCachedResponse }> {
    const result = await this.fetchJson(`${SEC_DATA_URL}/api/xbrl/companyfacts/CIK${canonicalCik(cik)}.json`);
    return { body: result.body, response: result.cache };
  }

  async acquirePrimaryFiling(input: { cik: number; accessionNumber: string; formType: string; primaryDocument?: string }): Promise<AcquiredFilingDocument> {
    const result = await this.acquireFilingDocuments(input);
    const primary = result.documents.find((document) => document.documentType === "primary_filing");
    if (!primary) throw new Error(`SEC filing index did not identify a primary ${input.formType} document for ${input.accessionNumber}.`);
    return { ...primary, indexResponse: result.indexResponse };
  }

  async acquireFilingDocuments(input: { cik: number; accessionNumber: string; formType: string; primaryDocument?: string }): Promise<{ manifest: FilingManifestEntry[]; documents: AcquiredFilingDocument[]; indexResponse: SecCachedResponse }> {
    const directoryUrl = filingArchiveDirectoryUrl(input.cik, input.accessionNumber);
    const index = await this.fetchJson(`${directoryUrl}/index.json`);
    const root = index.body as Record<string, unknown>;
    const directory = root.directory;
    const items: unknown[] = directory && typeof directory === "object" && Array.isArray((directory as Record<string, unknown>).item)
      ? (directory as Record<string, unknown>).item as unknown[]
      : [];
    const documents = items.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const name = safeDocumentName(asString(item.name));
      return name ? [{ name, type: asString(item.type), size: typeof item.size === "number" ? item.size : undefined }] : [];
    });
    const preferred = safeDocumentName(input.primaryDocument);
    const documentName = preferred && documents.some((document) => document.name === preferred)
      ? preferred
      : documents.find((document) => document.type === input.formType)?.name;
    if (!documentName) throw new Error(`SEC filing index did not identify a primary ${input.formType} document for ${input.accessionNumber}.`);
    const manifest = documents.map((document) => ({
      ...classifyFilingDocument({ name: document.name, secType: document.type, primaryDocument: documentName, formType: input.formType }),
      byteSize: document.size,
    }));
    const acquired: AcquiredFilingDocument[] = [];
    for (const entry of manifest.filter((candidate) => candidate.included)) {
      const url = `${directoryUrl}/${encodeURIComponent(entry.documentName)}`;
      const document = await this.fetchText(url, join("sec", "filings", String(input.cik), input.accessionNumber.replaceAll("-", "")), "text/html, text/plain, application/xhtml+xml, application/pdf, */*");
      acquired.push({ documentName: entry.documentName, documentType: entry.classification as "primary_filing" | "exhibit", url,
        contentType: document.cache.contentType, bodyPath: document.cache.bodyPath, contentHash: document.cache.contentHash,
        byteSize: document.byteSize, indexResponse: index.cache });
    }
    return { manifest, documents: acquired, indexResponse: index.cache };
  }

  private async fetchJson(url: string): Promise<{ body: unknown; cache: SecCachedResponse }> {
    const response = await this.fetchText(url, join("sec", "api"), "application/json");
    return { body: JSON.parse(response.text) as unknown, cache: response.cache };
  }

  private async fetchText(url: string, relativeDirectory: string, accept: string): Promise<{ text: string; byteSize: number; cache: SecCachedResponse }> {
    const userAgent = requireUserAgent(this.options.userAgent);
    const request = this.options.fetch ?? fetch;
    const attempts = 3;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await this.waitForRateLimit();
      try {
        const response = await request(url, { headers: { "User-Agent": userAgent, Accept: accept } });
        const body = Buffer.from(await response.arrayBuffer());
        const text = body.toString("utf8");
        if (!response.ok) {
          if ([403, 429, 500, 502, 503, 504].includes(response.status) && attempt < attempts - 1) {
            await this.backoff(attempt);
            continue;
          }
          throw new Error(`SEC request failed (${response.status}) for ${url}.`);
        }
        const contentHash = createHash("sha256").update(body).digest("hex");
        const directory = join(this.options.dataDir, relativeDirectory);
        await mkdir(directory, { recursive: true });
        const bodyPath = join(directory, `${contentHash}${contentExtension(url, response.headers.get("content-type"))}`);
        await writeFile(bodyPath, body, { flag: "w" });
        return {
          text,
          byteSize: body.byteLength,
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
