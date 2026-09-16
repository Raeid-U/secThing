---
name: development-paper-trail
description: Preserve durable software-project continuity across fresh Codex sessions by using plan.md, FRD.md, BRD-PRD.md, the latest published dev_log_N.md, a single rolling dev_context.md file for unpublished work, and the current repository state. Use when implementing, debugging, refactoring, hardening, documenting, or otherwise materially changing an ongoing codebase. Continuously preserve meaningful engineering context in dev_context.md, but create a new numbered development log only when the user explicitly asks for a dev log, session report, handoff, or equivalent publication. Git history remains user-controlled.
---

# Development Paper Trail

## Purpose

Maintain a durable internal engineering paper trail so a fresh Codex session can continue an ongoing software project without requiring the previous chat transcript or a long conversational context.

The project should be recoverable primarily from:

- `BRD-PRD.md`
- `FRD.md`
- `plan.md`
- the latest numbered development log
- `dev_context.md` when unpublished work exists
- the current repository itself

This skill separates **working memory** from **published history**.

`dev_context.md` is a single rolling, mutable context file. It preserves meaningful work completed since the most recent published development log. It may be updated repeatedly, condensed, reorganized, or rewritten as the work evolves. It is not a historical artifact and must never be numbered or duplicated simply because another prompt was completed.

Numbered development logs are **session reports / publication checkpoints**. They consolidate the accumulated unpublished context into a durable narrative record only when the user explicitly asks for a dev log, session report, handoff, checkpoint, or equivalent.

The accumulated context and eventual session report should preserve:

- what state the project was in before the work;
- why the work was needed;
- what requirements or plan items drove it;
- what was implemented across the session;
- what was added, changed, removed, or deliberately not added;
- important design and business-rule decisions;
- problems and failed approaches encountered;
- how those problems were resolved;
- what tests or other validation were performed;
- what the system looks like now;
- what is still missing, deferred, or risky; and
- where the next development session should continue.

Development logs are not commit messages and are not a replacement for the repository.

`dev_context.md` is the project's **unpublished engineering memory**. Numbered dev logs are the project's **published engineering memory**.

---

# Core Principle

A new session should normally be able to do this:

1. read the relevant requirement and planning documents;
2. read the newest published development log;
3. read `dev_context.md` if it exists and contains unpublished work;
4. inspect the relevant current code;
5. understand the present implementation state;
6. continue development safely;
7. update the rolling context as meaningful work occurs; and
8. create the next numbered development log **only when the user explicitly requests one**.

Do not make continuation depend on the previous chat.

Do not make continuation depend on Git commit SHAs.

Do not create a numbered development log merely because a prompt, task, feature, fix, or coding turn has completed.

---

# Sources of Truth

Use the following hierarchy.

## 1. Current repository

The actual files in the working tree are the source of truth for what currently exists.

A development log or `dev_context.md` describes the state at the time it was written. The user may have edited files afterward.

If the repository and written context disagree, inspect the code and treat the repository as authoritative for implementation state.

Do not silently ignore the discrepancy. Preserve it in `dev_context.md` when it matters, and include it in the next requested dev log if still relevant.

## 2. Requirement and planning documents

When present, treat these as the main sources of intended product scope and direction:

- `BRD-PRD.md`
- `FRD.md`
- `plan.md`

Also use equivalent project-specific documents such as:

- architecture documents;
- schema/design notes;
- API specifications;
- roadmap documents;
- UX requirements;
- deployment plans;
- security requirements.

Do not rewrite requirements merely to make them match the implementation.

If code and requirements diverge, identify the divergence.

## 3. Rolling unpublished context — `dev_context.md`

When present, `dev_context.md` is the primary continuity source for work completed after the latest numbered dev log.

It should preserve durable context that is not reliably recoverable from code alone, including:

- design and business-rule decisions;
- implementation sequencing;
- important user clarifications;
- rejected or failed approaches;
- bugs and diagnostic findings;
- fixes and why they worked;
- validation already performed;
- temporary compromises;
- scope boundaries;
- unfinished work;
- the current continuation point.

It is mutable working memory, not a permanent historical record.

## 4. Published development logs

Development logs preserve consolidated historical context from earlier completed reporting periods.

The newest published log should normally contain enough historical continuity that older logs do not all need to be loaded.

## 5. Current chat

Use the current chat for the immediate task, but do not leave important durable engineering context only in chat if it would matter in a fresh session.

Capture meaningful durable context in `dev_context.md` as work progresses.

Do **not** create a numbered development log simply to get information out of chat.

---

# Development Log and Rolling Context Naming

Preserve the repository's existing numbered development-log convention.

The preferred numbered convention is:

`dev_log_1.md`  
`dev_log_2.md`  
`dev_log_3.md`  
...  
`dev_log_N.md`

When existing logs are stored in a directory, continue using that directory.

When existing logs use another naming scheme, continue that scheme unless the user asks to change it.

If no development-log convention exists, default to:

`dev_log_1.md`

in the repository root.

For unpublished working context, use exactly one rolling file named:

`dev_context.md`

Place it alongside the development logs unless the repository already has an established location for project paper-trail documents.

Rules for `dev_context.md`:

- there must be at most one active rolling context file for this purpose;
- update the existing file instead of creating `dev_context_2.md`, dated copies, checkpoint copies, or per-prompt files;
- it may be rewritten or condensed as necessary to stay useful;
- it should identify the latest published dev log it continues from, when one exists;
- it is not a formal dev log and does not consume a dev-log number;
- after a requested dev log is published, reset it to a short clean state that points to the newly published log, or remove stale unpublished details if nothing remains outstanding.

Never overwrite a previous numbered development log with new project history.

The log number, not a commit SHA, is the primary published continuity marker.

---

# Starting Work in a Fresh Session

Before substantive work on an existing project, recover context efficiently.

## Step 1 — Identify the project documents

Locate, when present:

- `BRD-PRD.md`
- `FRD.md`
- `plan.md`
- the numbered development logs
- `dev_context.md`
- any project-specific design or architecture documents relevant to the request

Do not create missing requirement documents merely because this skill references them.

## Step 2 — Read the newest published development log and rolling context

Determine the highest numbered existing development log and read it.

Then read `dev_context.md` if it exists.

Interpret them together:

- the newest numbered log is the latest **published** historical checkpoint;
- `dev_context.md` contains **unpublished work since that checkpoint**;
- the repository remains authoritative for what actually exists now.

Do **not** automatically load the entire development-log history.

Older logs should be read only when:

- the newest log or `dev_context.md` explicitly points back to a prior decision;
- the current task concerns an older subsystem whose rationale is not adequately carried forward;
- a contradiction needs to be resolved;
- the user asks about earlier history; or
- the newest continuity documents are unusually small or incomplete.

This is deliberate.

Each requested development log should carry forward enough current-state context that future sessions usually do not need every earlier log.

## Step 3 — Read the relevant requirements and plan sections

Read the portions of `BRD-PRD.md`, `FRD.md`, and `plan.md` that affect the requested task.

Prefer targeted reading over loading large documents in full when the relevant section is identifiable.

Understand:

- the intended requirement;
- the current milestone or phase;
- acceptance criteria;
- explicit non-goals;
- dependencies; and
- sequencing constraints.

## Step 4 — Inspect the actual repository

Inspect the code involved in the user's task.

Use repository search and read relevant:

- models;
- schemas/types;
- routes/controllers;
- services;
- components;
- tests;
- migrations;
- configuration;
- documentation;
- deployment files.

Read-only Git inspection may be used where helpful, for example:

- `git status --short`
- `git diff`
- `git diff --stat`

The purpose is to understand the working tree, not to manage Git history.

## Step 5 — Reconstruct only the context needed for the task

Before editing, be able to answer:

- What is already implemented?
- What unpublished work is recorded in `dev_context.md`?
- What remains incomplete?
- What requirements govern this work?
- What prior design decisions must be preserved?
- What files or subsystems are affected?
- What user changes exist in the working tree?
- What is the safest next implementation step?

Do not spend the session producing a giant recap unless the user asks for one.

The purpose of the paper trail is to reduce catch-up cost.

---

# Working During the Session

Perform the user's engineering task normally.

While working, maintain `dev_context.md` as a **rolling context buffer** for durable information a future agent would otherwise have to rediscover.

Update it after meaningful work or before ending a substantive turn/session. Do not treat every user prompt as a publication boundary, and do not create a numbered development log as part of ordinary implementation work.

Especially preserve:

- major implementation choices;
- business rules;
- architecture changes;
- data-model changes;
- new or changed APIs;
- migrations;
- authorization rules;
- lifecycle rules;
- new dependencies;
- new configuration;
- changed deployment assumptions;
- significant file/module responsibilities;
- bugs discovered;
- failed approaches;
- important error messages when diagnostically useful;
- fixes and why they worked;
- test-suite changes;
- validation actually performed;
- compatibility implications;
- intentional non-goals;
- temporary limitations;
- deferred work;
- unfinished work and the safest continuation point;
- important user clarifications or decisions that affect later implementation.

Do not turn `dev_context.md` into a raw transcript of the coding session.

Capture the engineering story, not every command or conversational exchange.

As the context file grows, consolidate repeated or superseded notes. Preserve the final decision and useful history of how difficult problems were resolved, but remove conversational noise and obsolete intermediate wording.

---

# When to Publish the Next Development Log

Create the next numbered development log **only when the user explicitly asks for one**.

Examples of an explicit request include:

- "make a dev log";
- "write the dev log";
- "give me a session report";
- "create the handoff";
- "checkpoint this work";
- "summarize this development session into the paper trail";
- equivalent language that clearly requests publication of the accumulated engineering context.

Do **not** infer a request merely because:

- a feature was implemented;
- a bug was fixed;
- a milestone was reached;
- tests passed;
- the user says "thanks" or appears finished;
- the task was substantial;
- a fresh prompt begins;
- the current coding turn is ending;
- the agent believes a checkpoint would be useful.

Until the user requests publication, keep accumulating and consolidating durable context in `dev_context.md`.

When the user does request a dev log:

1. read the newest published dev log;
2. read the full current `dev_context.md`;
3. inspect the relevant final repository state and changes;
4. review the requirements and plan items affected;
5. incorporate important context from the current chat that has not yet been captured;
6. produce the next numbered dev log as a **consolidated session report**, not a prompt-by-prompt chronology;
7. include what was achieved, why, decisions, issues, failed approaches, resolutions, validation, current state, unfinished work, and next direction;
8. make the report truthful about what was and was not tested;
9. after publication, reset `dev_context.md` so it points to the new published log and contains only genuinely unpublished or still-active context.

A single requested dev log may therefore cover many prompts, multiple features, several fixes, debugging work, and iterative refinements.

The publication boundary is controlled by the user, not by the agent.

---

# Preferred Development Log Style

Model new logs as an **internal narrative development changelog / engineering paper trail**.

Do not force every log into an identical mechanical template.

The headings should follow the work.

A backend feature phase may naturally organize around:

- domain decisions;
- models;
- schemas;
- service layer;
- API layer;
- tests.

A frontend phase may instead organize around:

- UX goal;
- routes/pages;
- components;
- state/data flow;
- API integration;
- responsive behavior;
- validation.

A hardening phase may organize around:

- problem;
- threat or operational concern;
- config;
- middleware;
- validation;
- regression testing.

Use the structure that best explains the work.

However, the following overall pattern should normally be recognizable.

---

# Recommended Log Opening

Begin with project identity and purpose.

Example structure:

```markdown
# <Project Name>
## Development Changelog

**Prepared:** YYYY-MM-DD
**Project:** <project name and concise architecture/stack description>
**Purpose:** Internal development log continuing from the earlier dev logs. This document records the design and implementation work completed for <phase / feature / milestone>, including <major areas>, and captures the resulting project state and recommended next direction.

---
```

The `Purpose` line should explain what this particular log records.

Do not use generic text if a precise description is available.

---

# 1. Continuity Note

Most substantial logs should begin with a continuity note.

Summarize the prior paper trail at a high level.

For example:

```markdown
# 1. Continuity Note

This document continues the internal development record from the earlier dev logs.

The previous phase left the project with:

- ...
- ...
- ...

This log continues that paper trail with:

- ...
- ...
```

Do not reproduce every historical step.

The continuity note should orient a fresh session, not duplicate earlier logs.

When the immediately previous log is especially relevant, identify it explicitly:

> `dev_log_12.md` ended with the backend ready for...

---

# 2. Project State Entering This Phase

Describe the state inherited at the beginning of the work.

Focus on what matters to understanding why this phase happened.

Useful content includes:

- important existing capabilities;
- the last meaningful test milestone;
- known missing pieces;
- incomplete prior work;
- constraints;
- relevant architecture already in place;
- working-tree differences discovered at the start.

A strong state section makes the transition into the new work understandable.

Where useful, separate:

```markdown
## Implemented
...

## Not Yet Implemented
...
```

Do not imply that something exists merely because it was planned.

---

# Requirements and Plan Alignment

The old development logs may predate formal project requirements.

For projects that now contain `BRD-PRD.md`, `FRD.md`, and `plan.md`, incorporate those documents into the paper trail without turning the log into a copy of them.

Reference relevant sections naturally.

For example:

```markdown
This phase implements the course lifecycle behavior described in `FRD.md §5.2`
and advances the lifecycle milestone in `plan.md`.
```

or:

```markdown
## Requirements / Plan Alignment

Relevant project sources:
- `BRD-PRD.md` — Course administration / lifecycle requirement
- `FRD.md` — §5.2 Course visibility and access
- `plan.md` — Phase 4, lifecycle hardening

This phase completes the backend portion of the planned item. Frontend treatment remains outstanding.
```

Use a dedicated section when alignment is complex.

Otherwise, weave the references into the relevant feature sections.

Do not copy large requirement passages into the log.

---

# Explain Why the Phase Happened

A recurring strength of the development-paper-trail format is explaining why work happened before explaining implementation.

Use headings such as:

- `Why This Step Was Added`
- `Why This Phase Happened`
- `Problem the Feature Solved`
- `Why This Was Needed`
- `Goal`
- `Core Goal`
- `Scope`

Explain the practical or architectural problem.

Also record deliberate scope boundaries.

For example:

```markdown
This phase intentionally did not introduce:
- ...
- ...
```

This helps future sessions avoid reopening decisions or expanding scope accidentally.

---

# Record Important Decisions Before Implementation Detail

When a phase locks in business rules or architecture, give those decisions their own section.

Useful heading patterns include:

- `Major Design Decision`
- `Core Business Rules Locked In`
- `Design Decisions`
- `Implementation Decisions`
- `Permission Rule`
- `Lifecycle Behavior`
- `Important Principle`

Explain both the decision and the reason.

Prefer:

> Import always creates a new course rather than merging into an existing course. This avoids conflict-resolution and partial-overwrite semantics in v1.

Avoid:

> Implemented import.

A future session needs the rationale.

---

# Describe the Implementation in Domain-Native Sections

After rationale and decisions, describe what was actually built.

Organize the implementation according to the architecture rather than forcing a generic file-by-file list.

Examples:

```markdown
# 5. Implemented Assessment Domain

## 5.1 New Model: `Assessment`
...

## 5.2 New Model: `Submission`
...
```

or:

```markdown
# 6. Service Layer

# 7. API Layer

# 8. Tests Introduced
```

or:

```markdown
# 4. Authentication Hardening

## 4.1 Config Surface Expanded
## 4.2 Production Validation
## 4.3 Middleware Added
```

Use concrete:

- file paths;
- modules;
- classes;
- functions;
- endpoints;
- fields;
- response shapes;
- environment variables;
- migration names;
- UI components;

when those details improve continuity.

The log should be detailed enough that another capable coding agent can locate the implementation quickly.

---

# Added / Changed / Removed

The log must make meaningful additions, changes, removals, and non-changes understandable, but it does not need a mandatory `Added / Changed / Removed` table.

Use the structure that reads most naturally.

Explicitly mention when something was:

- newly introduced;
- renamed;
- replaced;
- removed;
- deprecated;
- intentionally retained;
- moved;
- centralized;
- split;
- merged;
- deferred.

Always explain **why** when the reason is not obvious.

For a meaningful removal, record what replaced it or why it is no longer needed.

---

# Issues Encountered and Resolutions

Record meaningful implementation problems.

Useful structures include:

```markdown
## Issues Encountered

### Foreign-Key Delete Ordering
...

### Resolution
...
```

or:

```markdown
# Testing Impact and Corrections
...
```

Capture:

- the symptom;
- the root cause when known;
- failed approaches when relevant;
- the chosen resolution;
- any lasting implication.

Do not preserve every transient syntax typo.

Preserve issues that contain reusable engineering knowledge.

A future session should not repeat the same dead end because the explanation was lost with the chat.

---

# Recording "The Code at This Point"

Do not paste the full source code into the development log.

The repository already stores the code.

Instead, describe the current code state through:

- important modules and their responsibilities;
- key models and fields;
- important functions/classes;
- API routes and semantics;
- interfaces/types;
- architectural relationships;
- configuration;
- migrations;
- feature flags;
- current limitations;
- important invariants.

Small source snippets are acceptable only when the exact shape is unusually important and would otherwise be costly to rediscover.

Do not duplicate entire files or full diffs.

The development log explains how to understand the repository at that point in time.

---

# Validation and Test Milestones

Accurately record validation performed during the phase.

Examples:

- unit tests;
- integration tests;
- end-to-end tests;
- type checks;
- lint;
- build;
- migrations;
- manual API checks;
- manual UI checks;
- deployment or container checks.

When useful, include a milestone such as:

```markdown
# Test Milestone Snapshot

At the end of this phase:

- **81 passing tests**
- no warnings
```

Never claim a test passed unless it was actually run.

If tests could not be run, say so and explain why.

If only a targeted test subset was run, state that clearly.

Do not convert an unverified implementation into a completed milestone.

---

# Current System State

Near the end of a substantial log, summarize the resulting state.

A common form is:

```markdown
# Current System State After <Phase>

## Implemented
- ...
- ...

## Not Yet Implemented
- ...
- ...
```

This is one of the primary resume surfaces for the next fresh session.

For a small or highly mature project, do not mechanically list the entire application every time.

Summarize enough stable project state to orient the next session, with emphasis on:

- the changed domain;
- adjacent dependencies;
- meaningful remaining gaps.

Clearly distinguish:

- implemented;
- partially implemented;
- not implemented;
- deferred;
- intentionally out of scope;
- blocked.

---

# Recommended Next Direction

Each substantial log should normally identify the next logical engineering direction.

This is not merely a wish list.

Explain why the next step follows from the current state.

For example:

```markdown
# Recommended Next Direction

The backend now has the schema and permission foundation required for the first
course-management business APIs.

The next step should therefore be:

## Step 6 — Users, Courses, Roster, and Session Generation APIs

Recommended scope:
- ...
```

If several reasonable directions exist, present the meaningful options and explain the tradeoff.

Prefer a concrete continuation point over vague text such as "continue development."

---

# Summary of Major Decisions

Most substantial logs should close with a compact numbered recap.

Example:

```markdown
# Summary of Major Decisions Added in Dev Log 13

1. ...
2. ...
3. ...
```

This is intentionally redundant with the detailed body.

Its purpose is fast future retrieval.

Only include decisions that matter beyond the current session.

Do not fill it with trivial implementation facts.

---

# Recommended Use of This Document

For substantial logs, normally close with a short statement that the document continues the internal development record.

For example:

```markdown
# Recommended Use of This Document

This document should be stored alongside the earlier dev logs as a continuation
of the internal engineering paper trail.

It is useful for:

- preserving implementation rationale between sessions;
- tracking architectural and business-rule decisions;
- recording the current milestone;
- grounding the next development phase.
```

This section may be shortened or omitted for a very small log when it would add no value.

---

# Short Requested Session Reports

A user-requested development log does not need to be hundreds of lines merely because it consolidates a session.

A short report is appropriate when the accumulated unpublished context primarily records:

- deferred production work;
- a compact deployment note;
- a focused architectural constraint;
- a small but important verification result;
- a set of "revisit before production" items.

The report may be much shorter than the full structure.

The requirement is durable usefulness, not length.

Do not inflate a small reporting period into a large document simply to satisfy a template.

This does **not** create an automatic checkpoint trigger. A short dev log is still written only when the user asks for one.

---

# Unfinished or Interrupted Work

If meaningful work is left partially complete, preserve that fact in `dev_context.md` before the session ends.

Record:

- what was completed;
- what is partially changed;
- which files are involved;
- what currently works;
- what is broken or unverified;
- what still needs implementation;
- the safest next action.

If the user requests a dev log while work is unfinished, carry this information into the published report honestly.

Do not write an "exit condition complete" section when the exit condition was not met.

Do not hide a failing test suite.

Do not describe planned code as implemented code.

---

# Updating plan.md, FRD.md, or BRD-PRD.md

Do not automatically rewrite requirement or planning documents every time implementation changes.

Update them only when:

- the user's task calls for it;
- the implementation legitimately completes or changes a tracked plan item;
- a requirement has been explicitly clarified or changed;
- leaving the document unchanged would make it materially inaccurate.

When a requirement document appears inconsistent with the requested implementation:

1. identify the mismatch;
2. follow the user's explicit current instruction when clear;
3. record the divergence in `dev_context.md`, and carry it into the next requested development log when still relevant;
4. update the source document only when authorized or clearly part of the task.

Development logs record history.

Requirement documents describe intended truth.

Do not use one as a substitute for the other.

---

# Git Boundaries

The user controls Git history.

This skill must not turn development continuity into an agent-managed Git workflow.

Unless the user explicitly asks, do **not** perform Git write operations such as:

- `git add`
- `git commit`
- `git push`
- branch creation
- branch switching
- merge
- rebase
- cherry-pick
- reset
- revert
- stash
- tag creation

Read-only Git inspection is allowed when useful.

Do not automatically create commits for development-log checkpoints.

Do not require a clean working tree before writing a development log.

Do not require a commit SHA.

Do not treat commit order as the development-log continuity mechanism.

The user may:

- edit files manually;
- commit after the session;
- combine several sessions into one commit;
- split one session across several commits;
- change branches later.

That is compatible with this skill.

On the next session, inspect the repository as it exists and continue from reality.

If the user specifically asks for Git assistance, follow that instruction separately.

---

# Avoiding Context Bloat

This system exists specifically to reduce long-context dependence without producing a new file after every prompt.

Therefore:

- read the newest published dev log first;
- then read `dev_context.md` for unpublished work;
- do not automatically read all earlier logs;
- keep only one rolling `dev_context.md`;
- consolidate duplicate or superseded notes inside `dev_context.md`;
- do not reproduce earlier logs inside the newest log;
- do not copy full requirements into context or logs;
- do not paste full diffs;
- do not paste entire source files;
- do not repeat stable background unless needed for continuity;
- summarize older phases at a higher level as the project matures;
- preserve the decisions, problems, fixes, validation, and state transitions that matter, not every conversational detail.

A good rolling context file should make a fresh session immediately aware of unpublished work.

A good requested dev log should consolidate that context so the next reporting period can start cleanly.

---

# Quality Standard for Rolling Context

A useful `dev_context.md` should let a fresh capable coding agent answer:

- Which published dev log does this unpublished work continue from?
- What has been changed since that log?
- Why were those changes made?
- What important user decisions or clarifications were given?
- What problems or failed approaches occurred?
- How were those problems resolved?
- What validation has actually been performed?
- What remains unfinished, risky, or deferred?
- What should be inspected or continued next?

It does not need polished prose. It does need accurate durable engineering context.

---

# Quality Standard for Development Logs

A strong requested development log should let a fresh capable coding agent answer:

- What project am I in?
- What reporting period or phase does this log cover?
- What did the previous published phase leave behind?
- Why was the accumulated work necessary?
- Which requirements or plan items does it serve?
- What exactly was implemented across the reporting period?
- What important rules or architecture decisions are now locked in?
- What failed or caused trouble?
- How were those issues resolved?
- What validation was actually performed?
- What is implemented now?
- What is still missing?
- What should I work on next?
- Which current code should I inspect first?

If the log cannot answer those questions, it is probably too vague.

---

# End-of-Session Procedure

Before finishing a substantive engineering session or turn:

1. inspect the final relevant repository state;
2. review the actual changes made;
3. run appropriate validation where possible;
4. compare the result against the relevant requirements and `plan.md`;
5. update `dev_context.md` with any durable engineering context not already captured;
6. consolidate stale, duplicated, or superseded context so the rolling file remains useful;
7. record tests truthfully, including failures, unverified areas, and unfinished work;
8. ensure `dev_context.md` contains enough current-state information for a fresh session;
9. do **not** create a numbered development log unless the user explicitly requested one;
10. do not perform a Git commit solely because context or a dev log was updated.

If the user explicitly requested a dev log during the session, publish it using the accumulated context and final repository state, then reset `dev_context.md` to reflect the new published baseline and any work that remains unpublished.

In the final response to the user, briefly mention:

- what was completed;
- validation status;
- important unresolved issues;
- the new development-log filename **only when the user asked for and received a dev log**.

Do not make the user manage agent handoff metadata.

`dev_context.md` is the ongoing handoff between publication points. The numbered development log is the user-triggered session report.
