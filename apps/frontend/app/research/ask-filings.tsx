"use client";

import { useEffect, useState } from "react";
import { post, request, type AnswerCitation, type CorpusStatus, type GroundedAnswerResponse } from "./types";

export function AskFilings({ companyId, onOpenCitation }: { companyId: string; onOpenCitation: (citation: AnswerCitation) => void }) {
  const [corpus, setCorpus] = useState<CorpusStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<GroundedAnswerResponse | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const refresh = () => request<CorpusStatus>(`/api/v1/companies/${companyId}/corpus`).then(setCorpus).catch((reason: Error) => setError(reason.message));
  useEffect(() => {
    setCorpus(null); setAnswer(null); setQuestion(""); setError("");
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [companyId]);

  async function ask() {
    setWorking(true); setError(""); setAnswer(null);
    try { setAnswer(await request<GroundedAnswerResponse>(`/api/v1/companies/${companyId}/questions`, post({ question: question.trim() }))); }
    catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }
  async function retry() {
    setWorking(true); setError("");
    try { await request(`/api/v1/companies/${companyId}/corpus/retry`, post({})); await refresh(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }
  async function approve() {
    if (!corpus?.externalEmbeddingEstimate) return;
    setWorking(true); setError("");
    try { await request(`/api/v1/companies/${companyId}/embeddings/approve`, post(corpus.externalEmbeddingEstimate)); await refresh(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }

  const ready = corpus?.readiness === "ready" || corpus?.readiness === "ready_with_exclusions";
  const source = (label: string) => answer?.citations.find((citation) => citation.label === label);
  return <section className="ask-filings" aria-labelledby="ask-filings-title">
    <header>
      <div><h2 id="ask-filings-title">Ask the filings</h2><p>Answers use only this company’s indexed SEC evidence.</p></div>
      {corpus && <span className={`corpus-state ${ready ? "ready" : "pending"}`}>{ready ? corpus.readiness === "ready_with_exclusions" ? "Ready with exclusions" : "Ready" : "Building evidence corpus"}</span>}
    </header>
    {!corpus ? <p className="research-progress">Checking evidence coverage…</p> : !ready ? <div className="corpus-progress">
      <p>Questions unlock when every supported document and structured financial fact has reached a terminal, disclosed state. Search remains available below.</p>
      <dl>{Object.entries(corpus.stageCounts).map(([stage, count]) => <div key={stage}><dt>{stage.replaceAll("_", " ")}</dt><dd>{count}</dd></div>)}<div><dt>Financial facts</dt><dd>{corpus.structuredFactsComplete ? "Complete" : "Pending"}</dd></div><div><dt>Missing filing manifests</dt><dd>{corpus.coverage.missingManifests}</dd></div></dl>
      <div className="corpus-actions">
        {corpus.externalEmbeddingEstimate && <button onClick={() => void approve()} disabled={working}>Approve external embedding of {corpus.externalEmbeddingEstimate.tokenEstimate.toLocaleString()} estimated tokens</button>}
        {(corpus.exclusions.some((item) => item.retryable) || corpus.failures.length > 0) && <button onClick={() => void retry()} disabled={working}>Retry excluded evidence</button>}
      </div>
      {corpus.exclusions.length > 0 && <details><summary>{corpus.exclusions.length} excluded document{corpus.exclusions.length === 1 ? "" : "s"}</summary><ul>{corpus.exclusions.map((item) => <li key={item.id}><strong>{item.document_name}</strong><span>{item.exclusion_reason}</span></li>)}</ul></details>}
    </div> : <>
      <form className="question-form" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <label htmlFor="filing-question">Question</label>
        <div><textarea id="filing-question" value={question} onChange={(event) => setQuestion(event.target.value)} minLength={2} maxLength={2000} placeholder="What changed in the company’s risk disclosures?" rows={2} /><button className="primary-button" disabled={working || question.trim().length < 2}>{working ? "Reviewing evidence…" : "Ask"}</button></div>
        <small>{corpus.readiness === "ready_with_exclusions" ? "Some documents were excluded after bounded retries. Every answer will retain that limitation." : "Each question runs fresh retrieval. Generated prose is never reused as evidence."}</small>
      </form>
      {answer && <div className="research-answer" aria-live="polite">
        <AnswerSection title="What the filings show" items={answer.findings} source={source} />
        {answer.interpretation.length > 0 && <AnswerSection title="Interpretation" items={answer.interpretation} source={source} />}
        <section><h3>Limitations</h3>{answer.limitations.length ? <ul>{answer.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No additional evidence limitations were reported.</p>}</section>
        <section className="answer-sources"><h3>Sources</h3>{answer.citations.map((citation) => citation.kind === "chunk" ? <button key={citation.label} onClick={() => onOpenCitation(citation)}><strong>{citation.label}</strong><span>{citation.locator.formType} {citation.locator.accessionNumber}{citation.locator.pageStart ? ` · page ${citation.locator.pageStart}${citation.locator.pageEnd !== citation.locator.pageStart ? `–${citation.locator.pageEnd}` : ""}` : ""}</span></button> : <div key={citation.label}><strong>{citation.label}</strong><span>{citation.locator.formType} {citation.locator.accessionNumber} · structured fact</span></div>)}</section>
        {answer.externalDisclosure && <p className="provider-disclosure">{answer.externalDisclosure}</p>}
      </div>}
    </>}
    {error && <p className="ask-error" role="alert">{error}</p>}
  </section>;
}

function AnswerSection({ title, items, source }: { title: string; items: Array<{ statement: string; citations: string[] }>; source: (label: string) => AnswerCitation | undefined }) {
  return <section><h3>{title}</h3><ul>{items.map((item, index) => <li key={index}><span>{item.statement}</span><span className="inline-citations">{item.citations.map((label) => <abbr key={label} title={source(label)?.text ?? "Supplied evidence"}>{label}</abbr>)}</span></li>)}</ul></section>;
}
