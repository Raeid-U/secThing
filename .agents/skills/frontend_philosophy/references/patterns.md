# Interaction framework

## Search, filter, sort, then present

Keep the raw records independent of derived presentation. Search the fields
users expect, label the scope, compose filters, and derive ordering without
mutating the source. Choose the default metric from the user's actual decision.
A throughput metric can remain selectable without dominating the default view.

```ts
type Item = {
  id: string;
  name: string;
  category: string;
  tags: string[];
  eligible: boolean;
  value: number | null;
  throughput: number | null;
};
type Sort = "value" | "throughput" | "name";

function visibleItems(
  items: Item[],
  query: string,
  category: string,
  eligibleOnly: boolean,
  sort: Sort,
): Item[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const compareNames = (a: Item, b: Item) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const numeric = (value: number | null) =>
    value !== null && Number.isFinite(value) ? value : null;

  return items.filter(item => {
    const haystack = [item.name, item.category, ...item.tags]
      .join(" ").toLocaleLowerCase();
    return terms.every(term => haystack.includes(term)) &&
      (category === "all" || item.category === category) &&
      (!eligibleOnly || item.eligible);
  }).sort((a, b) => {
    if (sort === "name") return compareNames(a, b);
    const av = numeric(a[sort]), bv = numeric(b[sort]);
    if (av === null) return bv === null ? compareNames(a, b) : 1;
    if (bv === null) return -1;
    return bv - av || compareNames(a, b);
  });
}
```

For large or server-paginated datasets, put this logic on the appropriate data
layer. Debounce remote search, cancel/ignore outdated responses, and distinguish
loaded-row count from total matches. Don't imply that local filtering searches
the full remote dataset.

## Toolbar anatomy

Use a visible or programmatic label for search, a real `select` for ordering,
text buttons for a short filter set, and a native checkbox for a binary option.
Use `aria-pressed` for independent filter buttons and `aria-current="page"` for
active navigation. Use actual tabs only when implementing the corresponding
keyboard and panel semantics. CSS borders make better decorative separators
than visible pipe characters announced by assistive technology.

At narrow widths, let search occupy a line and wrap the remaining groups. Keep
group labels with their controls. Avoid an entire sideways-scrolling toolbar.
Retain sort and reset access on mobile; hiding them makes the layout simpler at
the cost of the task.

## Row hierarchy

Identity is the leading anchor. Supporting context sits beneath it in smaller,
readable text. Align comparable numeric values at the right edge and separate
units from the dominant number. Keep the selected metric visible and marked as
the active ordering (`aria-sort` on a relevant table header). Show other metrics
at lower emphasis or in detail view.

A row can open details on pointer click as a convenience, but preserve a named
button or link inside it for keyboard users. Never make an unlabelled `tr` the
only activation path. Don't wrap interactive row controls inside another button.

For a timer, use one prominent countdown and a quieter absolute completion time
including the user's timezone. At zero, use a terminal state such as “Done” when
that reflects the domain. If the finish is only an estimate, distinguish that
from authoritative completion without putting several competing clocks inline.

## First-level component costs

A reference column can list immediate inputs without recursively expanding a
bill of materials. State whether amounts are unit prices or totals for the
required quantity, and whether the parent record represents a batch or one item.

Example:

    Components / batch
    3 × Alloy plate  Market A       120 credits
    1 × Valve        Market B        80 credits
    Assembly fee                     10 credits

If the displayed reference price differs from the cost model (for example,
cheaper subcomponent assembly), explain that difference in calculation help.
Use the existing pricing resolver instead of independently recreating arithmetic
in the UI. Unknown amounts display “Unavailable” or an explained dash, never zero.
Expose stale provenance or manual overrides where the user needs to assess them.

## State ownership and refresh

Keep these concepts separate:

```ts
type SourceState<T> = {
  snapshot: T | null;              // last usable data
  sourceUpdatedAt: number | null; // age of that data, not time the button was hit
  phase: "idle" | "updating" | "failed";
  lastAttemptAt: number | null;
  error: string | null;
};
```

Freshness is derived from the source timestamp and the domain's threshold.
Request phase is independent: data may be stale while a refresh is running.
On success replace the snapshot and its timestamp together. On failure retain
the old pair if safe, and show the failed attempt. On partial success update
only completed sources. Prevent duplicate jobs and stale responses overwriting
newer results. Preserve server rate limits/retry information where applicable.

An indicator needs text as well as colour:

    ● Market A: updated 4 min ago
    ● Market B: updating · showing data from 2 hr ago

A quiet summary is sufficient in the workspace; diagnostic details belong in
the relevant help/details surface. New loading states should not blank a whole
page when only one source is refreshing.

## Dialog implementation contract

Prefer the application's established accessible dialog primitive. With native
`dialog`, call `showModal()` to make the background inert; setting the `open`
attribute alone is not equivalent. Label with `aria-labelledby`, use a real close
button, and synchronize Escape/native close events with application state.

Capture the trigger before opening and restore focus when closing if it still
exists. If an action deletes the trigger, choose a stable nearby target. Put
initial focus on a suitable control or a focusable heading for longer reading.
Do not focus a destructive action by default. Use native focus containment or a
well-tested primitive; avoid inventing a partial focus trap.

Constrain width and height with viewport-relative limits, allow internal scroll,
and keep focus visible. If dismissing by backdrop click, distinguish it from a
click inside the dialog, including its padding. Don't require backdrop dismissal.
Test Escape, Tab/Shift+Tab, close button, scrolling, and return focus on mobile
and desktop. Multiple stacked dialogs and drawers require a deliberate layering
and scroll-lock strategy; avoid adding them casually.

## Layout review criteria

- The section title and its actions share a baseline or visually intentional row.
- Search, results, and navigation share a content edge.
- Primary values have sufficient space for the longest realistic number/unit.
- Metadata can wrap without pushing unrelated values out of alignment.
- A muted label remains readable; small text does not carry all meaning.
- Mobile preserves identity, selected metric, status, and action.
- No repeated card background is needed to understand grouping.
- Focus outlines remain visible; hover is not required to discover actions.
- At 200% zoom, controls reflow; at narrow widths, the page does not overflow.

Use a semantic table for a genuine cross-record comparison. A bounded horizontal
scroll region can be appropriate when every column is essential. Otherwise,
reduce optional columns intentionally and expose their data in details. Avoid
changing table elements to arbitrary block layout without checking the resulting
accessibility tree. Flex/list rows are often simpler when each entry is an
independent task with only a few comparison fields.
