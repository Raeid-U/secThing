---
name: frontend-philosophy
description: Design or refine task-focused application frontends with flat content sections, restrained controls, thoughtful typography, searchable and sortable lists, contextual modals, and clear data status. Use when this restrained visual style is requested for a dashboard, workspace, catalog, planner, or data application.
---

# Frontend philosophy

Build a calm workspace whose hierarchy comes from alignment, typography, space,
and a few meaningful rules. Make the primary task obvious and the underlying
information easy to compare. Preserve the host application's functionality and
user's explicit design choices. This is a visual and interaction approach,
independent of framework, domain, and branding; it does not prescribe a backend,
pixel font, game imagery, or a particular accent colour.

## Establish the task before styling

Inspect the existing screens and identify:
- The primary user decision and the fields needed to make it.
- Searchable fields, filters, sort keys, and the default ordering that serves
  that decision. Speed or throughput should not automatically outrank value.
- Primary data, optional explanations, editable settings, and system status.
- Data sources, freshness expectations, partial failures, and missing values.
- Existing routing, UI primitives, persistence choices, and constraints.

Write a brief implementation direction in task-appropriate working notes:
page hierarchy, information grouping, dominant metric, responsive treatment,
and state ownership. Keep changes proportional to the request. Use existing
components and native semantics before introducing a UI library.

## Compose a continuous page

Use a shared content edge for navigation, heading, controls, and results.
Start with one quiet page surface. Distinguish major sections with vertical
space and thin rules. Keep section headings and their actions on a shared
alignment line; wrap them as a group on narrow screens.

Reserve filled containers for real containment: a modal, a selected surface,
a critical warning, or a bounded editor. Avoid making every metric, filter,
row, paragraph, and action an independent rounded card. A border is useful
when it explains a relationship; remove it when alignment already does.

Choose the information structure from the task:
- Comparable records: semantic table on wide screens; keep identity and the
  selected metric prominent on narrow screens.
- Bounded slots, queues, or appointments: intentional rows with fixed roles
  for position, identity, context, and time/status.
- Saved items: flat rows with identity, quick reference, outcome, and action.
- Multiple views: plain navigation with an underline or rule for the current
  view. Add another page when the task deserves independent navigation, not
  merely because a section has several rows.

Grid and flex are implementation tools, not design identities. Use either to
maintain meaningful alignment. Don't force unrelated content into equal tiles.

## Make controls feel part of the workspace

Create one integrated control band near the results: expandable search,
a compact labelled sort, a small number of text filters, optional checkboxes,
reset, and result count. Let labels, spacing, and occasional separators group
controls. Use modest rectangular fields or bottom borders; avoid pill-shaped
menus and nested toolbar boxes.

Give every control an accessible name. Use buttons for actions and links for
navigation; an underlined text button is appropriate for contextual details.
Keep selection visible with weight, underline, and `aria-pressed` or the
appropriate native state. Do not rely on hue alone. Retain clear keyboard focus
and generous hit areas even when the visible treatment is small.

Filter, search, and sort compose together. Reset clears filters without
silently resetting unrelated preferences. Show the resulting count and a
specific empty state with a way to recover. Preserve zero values and distinguish
unknown from zero. Put unknown numeric values last and use a stable tie-breaker.
See [interaction patterns](references/patterns.md) for a generic data pipeline.

## Use progressive disclosure deliberately

Keep the main view to identity, essential comparison fields, one concise status,
and the likely next action. Move long assumptions, provenance, calculation
explanations, and secondary settings behind an underlined detail action or an
accessible `(?)`/info control. A help modal can hold an explanation and a related
navigation link; avoid displaying the same paragraph beside every row.

Prefer a centered dialog for focused inspection or editing, with a bounded
width and internally scrollable content. On mobile, let it approach the viewport
width with a small safe margin. Keep a visible title and close action. Escape,
focus containment, focus restoration, and usable long content are part of the
interaction. Use an existing accessible dialog primitive or native `dialog`;
never substitute a styled `div` without equivalent behavior. Prefer one dialog
at a time; a side panel is appropriate when persistent comparison with the page
is central to the task, rather than as a default.

Do not hide required decisions, critical errors, or information needed for the
primary comparison inside help. Quick-reference ingredients/components may
remain inline while methodology moves to the modal.

## Treat typography and colour as structure

Use a legible UI sans-serif, a restrained heading scale, and tabular numerals
for values, counts, timers, and money. An optional numeric monospace face can
make dense comparisons easier. Avoid decorative fonts unless the product asks
for them. Load only needed weights, preserve font licensing, and provide fallbacks.

Use neutral charcoal/stone or warm off-white foundations. Pick one restrained
accent for active states and key actions. Assign semantic warning/error/success
colours separately. Backgrounds should not inherit the accent tint across the
whole application. Keep muted text readable; small metadata still needs contrast.
Use spacing, size, weight, and placement before adding another colour.

Use [foundation.css](assets/foundation.css) as a starting vocabulary, not a
mandatory stylesheet. Adapt tokens to existing brand and accessibility needs.
Its light theme demonstrates that the philosophy is not tied to dark mode.

## Make status useful and honest

Place source status close to refresh controls or the data it describes. Pair a
small indicator with text such as “Updated 4 min ago”, “Updating”, “Outdated”, or
“Refresh failed · showing saved data”. Independent sources need independent
states and timestamps. Show partial progress as each completes; serialize jobs
only when the application's requirements call for it.

When appropriate to the domain, retain the last usable snapshot during refresh
and recoverable failures. Mark its age and provide detailed provenance on demand.
A failed attempt must not become a fresh timestamp. Hide or block stale data only
when the underlying task requires it. Use the application's freshness policy;
there is no universal timeout. Announce transitions without updating an ARIA
live region every second.

Persist preferences only under the product's existing consent/privacy model.
Don't add tracking or persist sensitive/operational data merely to demonstrate
the pattern. Reflect actual retention in product copy rather than making blanket
claims that nothing is collected.

## Implement and review

Read [patterns.md](references/patterns.md) when building a list, dialog, status
system, or responsive comparison view. Open [example.html](assets/example.html)
for a portable reference combining those patterns. It is synthetic demo data,
not a production data service or a required application architecture.

Implement the smallest coherent vertical slice and exercise its real states:
- Populated, empty, filtered-empty, loading, partial, unavailable, stale.
- Search plus filter plus each ordering; missing and zero-valued metrics.
- Keyboard navigation, visible focus, dialog open/close/return focus.
- Narrow phone, intermediate width, wide desktop; long names and large values.
- Text contrast, zoom/reflow, touch targets, and reduced-motion behavior.

Inspect actual rendered screens. Check shared edges, heading/action alignment,
number wrapping, horizontal overflow, and whether the active sort remains
visible. Run checks appropriate to the implementation; avoid tests that merely
assert CSS classes. Report what was verified and remaining limitations.

Before finishing, remove decorative containment that adds no meaning. If a
screen feels busy, first reduce simultaneous secondary information and improve
grouping; shrinking text or hiding necessary controls is rarely the solution.
