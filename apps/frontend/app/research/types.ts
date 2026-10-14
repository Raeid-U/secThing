export type Company = {
  id: string;
  cik: string;
  legal_name: string;
  tickers: string[];
  ingestion_status: string | null;
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
  jobs: { id: string; status: string; last_error: string | null }[];
  search: SearchStatus;
};
export type Hit = {
  chunk_id: string;
  filing_id: string;
  document_id: string;
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
