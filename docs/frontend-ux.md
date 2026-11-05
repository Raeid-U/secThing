# secThing Frontend Experience

## Product posture

secThing is a calm evidence workspace, not a market dashboard or an AI chat
shell. The implemented journey is:

1. choose or add a company;
2. search its preserved filing evidence;
3. inspect a result against the original source;
4. open Ask the filings for a cited explanation, then return to the evidence bank.

Exact-word search remains useful without an AI runtime. Meaning-based modes are
shown only when the backend reports that they are configured.

## Visual foundation

- Canvas `#f4f7f8`, surface `#ffffff`, ink `#17232d`, muted ink `#61717c`,
  rule `#d5dee3`, evidence accent `#25657a`.
- Public Sans is the locally served application face. Source Serif 4 is used
  only for filing text and search excerpts.
- Alignment, whitespace, and rules establish hierarchy. Filled surfaces are
  reserved for selection, status, dialogs, and document containment.
- Search is the dominant interaction. Status metrics and technical provenance
  remain available without competing with it.

## Page and responsive hierarchy

- `/records` is the canonical application surface; `/` and `/home` redirect to
  it. Existing query parameters and deep links remain valid.
- The no-company state is the company library. The desktop company rail remains
  available for rapid switching; on narrower screens it becomes an overlay.
- A selected company shows identity and evidence coverage, one integrated
  search/filter band, then filings or ranked passages.
- Ask the filings opens a native dialog from the selected company's header. The
  evidence bank retains the full page height when the dialog is closed. The dialog
  has a company heading, a scrolling answer area, and an always-available composer;
  it keeps the existing palette, Public Sans for conversation, and Source Serif
  only for original evidence. Answers use a readable line length rather than chat
  bubbles or a second dashboard.
- Verified summaries appear as cited prose; supporting findings and coverage details
  are expandable. Evidence-only fallbacks are named explicitly and never labeled as
  an AI summary. Inline citation buttons open the exact retained passage in the
  evidence reader. Financial facts can be inspected in place with their provenance.
- Opening evidence collapses the library. Desktop compares preserved original
  and extracted text; phones show one explicit Original/Extracted view at a
  time. Search controls and document controls must never require horizontal
  page scrolling.

## Interaction and language rules

- Present search modes as “Exact words,” “Related meaning,” and “Best match”
  while retaining the backend values `full_text`, `semantic`, and `hybrid`.
- Reset clears only the evidence filters. Company, query, reader, and unrelated
  preferences remain unchanged.
- Use direct actions such as “Add company,” “Update evidence,” “Inspect source,”
  and “Start research.”
- Empty and failure states explain what is missing and provide a recovery
  action. Unknown values are never presented as zero.
- System health and source provenance use native modal dialogs with Escape,
  focus containment, and focus restoration. Original/extracted comparison is a
  persistent side-by-side surface because comparison is the task itself.
- Status always uses text in addition to color. Keyboard focus remains visible,
  and reduced-motion preferences are respected.

## State ownership

`useWorkspace` remains responsible for URL state, request cancellation,
polling, search revisions, and the current company/reader snapshots. Components
own only local presentation state such as rail visibility, intake progress,
reader view, font size, and pane ratio. The frontend consumes explicit backend
status fields and does not infer successful processing from missing data.

## Ask state and return path

The current question/answer is retained while the dialog is closed, including when
following a source. Its launcher then says “Return to answer.” Escape and “Back to
evidence” restore launcher focus; a source link focuses the evidence reader.
Company changes and corpus deletion reset the answer and abort obsolete requests.
Closing a pending question keeps it running so users can continue inspecting
evidence. Each question still runs independently; this is not persistent chat
history or follow-up memory.

Corpus status polling runs while Ask is open or working. A pending/running evidence
rebuild for the selected company keeps its composer gated, even if old chunks are
still searchable. Search and source inspection remain available.
