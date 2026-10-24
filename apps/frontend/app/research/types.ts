export type Company = {
  id: string;
  cik: string;
  legal_name: string;
  tickers: string[];
  ingestion_status: string | null;
  exchange?: string | null;
  earliest_requested_filing_date?: string | null;
  latest_requested_filing_date?: string | null;
  progress?: Record<string, unknown> | null;
};
export type Filing = {
  id: string;
  document_id: string | null;
  accession_number: string;
  form_type: string;
  filing_date: string;
  report_date: string | null;
  is_supported: boolean;
  source_status: string | null;
  parse_status: string | null;
  chunk_count: number;
  last_error: string | null;
  sec_url: string | null;
};
export type SearchStatus = {
  configured: boolean;
  model: string | null;
  chunks: number;
  embedded: number;
  pending: number;
  failed: number;
};
export type Detail = {
  company: Company & {
    sic_description: string | null;
    earliest_requested_filing_date: string | null;
  };
  filings: Filing[];
  jobs: {
    id: string;
    status: string;
    progress: Record<string, unknown> | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }[];
  search: SearchStatus;
};
export type Hit = {
  chunk_id: string;
  filing_id: string;
  document_id: string;
  normalized_document_id: string;
  text_hash: string;
  start_offset: number;
  end_offset: number;
  form_type: string;
  filing_date: string;
  accession_number: string;
  section_label: string;
  snippet: string;
  chunk_text: string;
  rank: number;
};
export type Reader = {
  filing: { id: number; formType: string; accessionNumber: string };
  document: {
    id: string;
    normalizedDocumentId: string;
    textHash: string;
    warnings: string[];
    parserVersion: string;
    sourceHash: string;
    secUrl: string;
    contentType: string;
  };
  sections: {
    id: string;
    section_label: string;
    start_offset: number;
    end_offset: number;
  }[];
  text: string;
};
export type Location = {
  company: string;
  document: string;
  filing: string;
  q: string;
  mode: string;
  formType: string;
  sectionType: string;
  filedAfter: string;
  filedBefore: string;
  hash: string;
  start: string;
  end: string;
  generation: string;
};
export const emptyLocation: Location = {
  document: "",
  company: "",
  filing: "",
  q: "",
  mode: "full_text",
  formType: "",
  sectionType: "",
  filedAfter: "",
  filedBefore: "",
  hash: "",
  start: "",
  end: "",
  generation: "",
};

export type CorpusStatus = {
  readiness: "processing" | "ready" | "ready_with_exclusions";
  stageCounts: Record<string, number>;
  structuredFactsComplete: boolean;
  exclusions: Array<{ id: string; document_name: string; exclusion_reason: string; retryable: boolean }>;
  failures: Array<{ id: string; work_type: string; error_message: string }>;
  coverage: { earliestFilingDate: string | null; latestFilingDate: string | null; supportedFilings: number; missingManifests: number };
  externalEmbeddingEstimate: null | { profileKey: string; corpusFingerprint: string; documentCount: number; tokenEstimate: number };
};

export type AnswerCitation = {
  label: string;
  kind: "chunk" | "financial_fact";
  text: string;
  locator: { filingId?: string; documentId?: string; normalizedDocumentId?: string; textHash?: string; startOffset?: number; endOffset?: number; pageStart?: number; pageEnd?: number; accessionNumber?: string; formType?: string };
};
export type GroundedAnswerResponse = {
  status: "answered" | "insufficient_evidence" | "generation_limited";
  findings: Array<{ statement: string; citations: string[] }>;
  interpretation: Array<{ statement: string; citations: string[] }>;
  limitations: string[];
  citations: AnswerCitation[];
  coverage: Record<string, unknown>;
  modelRunId: string | null;
  externalDisclosure: string | null;
};

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "The request could not be completed.");
  return body as T;
}
export const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body === undefined
    ? {}
    : {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
});
export const dateLabel = (value: string) => value?.slice(0, 10) ?? "";
export function filingState(filing: Filing) {
  if (filing.last_error) return { label: "Needs attention", tone: "warning" };
  if (filing.chunk_count > 0) return { label: "Searchable", tone: "ready" };
  if (filing.parse_status === "parsed")
    return { label: "Index pending", tone: "pending" };
  if (filing.source_status === "downloaded")
    return { label: "Source saved", tone: "pending" };
  if (!filing.is_supported) return { label: "Catalogue only", tone: "muted" };
  return { label: "Awaiting source", tone: "pending" };
}
