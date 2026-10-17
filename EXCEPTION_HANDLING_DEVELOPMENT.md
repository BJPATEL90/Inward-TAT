# Exception Handling — Phase 2

Status: Phases 2–4 implemented and tested; production rollout approved on 16 October 2026. Backend version 48 is published to the existing production deployment. The frontend is released through the accompanying main-branch push.

## Scope

Append these fields to `Fact_Inward_TAT`, after its original 26 columns:

- `Exception (Y/N)`
- `Exception Bucket`
- `Remarks`

Phase 2 introduces no new sheet, OAuth scope, trigger, or UI. Existing KPI formulas, matching keys, OWN SKU exclusions, data-quality Exception Code/Detail, daily summaries, email calculations and isolated monthly revisions are unchanged.

Business exceptions use the current `Facility|GRN Number|SKU` record key. The flag is derived, never trusted from a browser: finite numeric KPI1 strictly greater than 12, and a trimmed nonblank bucket or remark, yields Y. Otherwise N. A later correction below the threshold retains the saved text but resets the flag.

## API contract for the next UI phase

Authenticated POST action `saveexception` accepts:

- `recordKey`
- `exceptionBucket` (blank or one of the eight agreed buckets)
- `exceptionRemarks` (trimmed; maximum 2,000 characters)
- `expectedBucket` and `expectedRemarks` (the exact values loaded before editing, including blank strings)

Only the existing `MANUAL_TASK_USERS` allowlist can save. Read-only dashboard access is unchanged. The dashboard exposes `permissions.canManageExceptions`, `exceptionFlag`, `exceptionBucket`, and `exceptionRemarks` for the next UI phase.

The save acquires the same script lock as the daily/historical pipelines, re-resolves the physical sheet row by key (including blank-row gaps), checks the previously loaded values to reject stale edits, rechecks current KPI1, then writes only the three fields. Clearing both fields is allowed even if a corrected KPI1 is no longer above 12. Text is escaped against formula execution. CURRENT and affected-month dashboard cache entries are invalidated after a successful flush. The client must reload after saving or a stale-edit error.

## Preservation safeguards

Daily and historical fact rebuilds read existing entries by key, merge them into the new rows, and derive the new flags without changing the first 26 calculation columns. Monthly isolated calculations return before this persistence path, and do not inherit or modify daily exception entries.

If an annotated transaction disappears or its key changes, rebuilding stops before overwriting the facts; it does not silently discard or reassign that exception. An operator must reconcile the key/source data before rerunning. The destructive `clearWronglyPulledPutawayData` recovery is similarly refused while exception entries exist.

Fact replacement writes before clearing trailing rows and attempts restoration from its in-memory snapshot if a normal write throws. This is not a database transaction: an abrupt Apps Script termination or failed restoration can still require restoring Google Sheets version history. Automated key reassignment, independent long-term exception archives and an audit-history ledger are not part of this phase.

## Validation

`node scripts/validate-exception-handling.mjs` covers schema width, all buckets, threshold/blank rules, permissions, POST/auth guards, edits/clearing, stale edits, physical row positions, duplicate-key rejection, formula safety, retention, recalculation after corrections, missing-key/recovery guards, normal write-error restoration and unchanged inclusive KPI summaries.

Regression checks: Apps Script syntax, hybrid matching, monthly ingestion/isolation, inbox, workbook generation, lint and frontend production build.

## Phase 3 — page and editing

The new Exception Handling navigation page reuses the main dashboard's period-card component and the exact `summarizeFacts` function. It shares performance month, date range, facility, status and transaction search state with the existing dashboard/details views. Changing performance month keeps this page open and loads that month's transactions through the existing API.

Two cards summarise all matching records versus matching records without a valid saved business exception. The >12-hour table is a separate subset: it never becomes the input for the inclusive card. Neither unsaved drafts nor backend save errors change the cards. Empty complete-record datasets display no KPI, not zero. Counts distinguish complete/filtered records and removed valid exceptions.

Each row supports the eight agreed buckets, remarks, saving, clearing both fields and resetting drafts to loaded values. Saved bucket/remarks form the optimistic-concurrency baseline sent to the Phase 2 endpoint. Changed loaded values require resetting the row before editing again; backend conflicts appear alongside the action while keeping the draft. Only `permissions.canManageExceptions` enables editing. A successful save updates the local snapshot so both cards respond, while the endpoint persists the values in Sheets. Existing data-quality codes and manual pending-task actions are not modified.

Tables paginate at 50 rows and scroll horizontally on small screens. Pagination limits rendering only; both card calculations use the complete filtered dataset. The existing generic Download CSV button remains hidden on this page; Phase 4 supplies its own scoped download instead of the unfiltered main-dashboard CSV.

`node scripts/validate-exception-ui.mjs` tests the actual local React page against a mocked API: saved-only card updates, exact >12 threshold, complete-record eligibility, bucket and remarks-only saves, clearing/whitespace, save failure/draft retention, all-excluded/null KPIs, shared month/date/facility/status/search filters, read-only access, 50-row pagination, desktop/mobile layout, and absence of browser exceptions. Test screenshots under `work/exception-handling-*.png` use synthetic data, not operational results.

## Phase 4 — filtered CSV download

Download CSV is available to both viewers and editors. The default scope exports the complete delayed table (KPI1 > 12), across all pages, with the active month/date/facility/status/search filters. An explicit `All filtered transactions · KPI source` scope exports the dataset underlying the inclusive card, including complete and incomplete records and records at/below the threshold. Neither scope implicitly removes exceptions. No matching rows disables the download.

CSV exports saved snapshot data only, never pending row drafts. A shared business-exception predicate drives cards, table flags and exported Y/N. There are 31 columns covering all 29 underlying fact fields, with existing date-only fields incorporated into the corresponding separated timestamp date fields rather than repeated. The API now additionally exposes the three raw-sheet source row references and calculation timestamp, previously absent from the dashboard payload. Other fields include record identity, numeric unrounded KPI hours, status, data-quality codes/details, matching metadata, manual-action details and the three business-exception fields.

Every combined timestamp (unloading, GRN received, Putaway complete, calculation and manual action) becomes distinct Date (IST) and Time (IST) columns. UTC/offset-bearing timestamps are formatted explicitly in Asia/Kolkata, not the browser timezone. Date-only fallbacks retain dates without inventing times. Ambiguous or invalid timestamps stop the export and display an error. CSV has UTF-8 BOM, CRLF records, quoted/escaped cells, preserved multiline remarks and spreadsheet-formula neutralisation for text. Filenames include reporting month, date range, facility and selected scope. Downloading requires no backend write and does not create archives or send emails.

`node scripts/validate-exception-csv.mjs` independently parses the CSV to verify column alignment, timestamps/IST midnight and rollover, numeric precision, missing values, flags, Unicode, multiline quoting, formula protection and nonmutation of records. Browser tests additionally verify default/all-filtered scopes, active filters, exclusion of unsaved drafts, disabled empty exports and a 58-row export while only eight rows are visible on page two.

## Production rollout — 16 October 2026

Confirmed Apps Script project: `14CR1zTWF9p1JdGhA2zTWvxbqtFCgG3wIodMAnG78DPso_ysrx2dUUqRE`. Fresh live scripts were pulled, baseline-checked and preserved locally in `work/exception-live-backup-20261016-v47` before publishing version 48. Unrelated live scripts and the manifest were retained.

The existing `Fact_Inward_TAT` tab (sheet ID 1739635534) was extended from 26 to 29 columns. AA1:AC1 now contains the agreed three headers; AA2:AA5837 was initialised to N for 5,836 existing transaction keys. Buckets and remarks were left blank. No existing transaction, timestamp or KPI column was overwritten. Headers and initial flags were read back after migration. This rollout did not run a fact rebuild, send email, add triggers or create operational exceptions.

Predeployment checks passed: exception backend/CSV/browser tests, Apps Script syntax, hybrid matching, monthly ingestion/inbox/workbook/browser regressions, lint and production build. Final release checks include existing endpoint health, authentication rejection without credentials, Pages workflow completion and served frontend assets.

Rollback reference is Apps Script version 47 and frontend commit `828d173`. Do not revert to a pre-exception pipeline after staff begin recording exceptions without first preserving those annotations; the old rebuild clears the additional fields. Retain appended columns/data during rollback. No production KPI report or operational CSV has been generated as part of the synthetic tests. An authenticated production save/edit/clear should use an operator-approved real exception rather than an invented exception entry.

## Transaction review follow-up — 16 October 2026

Read-only inspection confirmed EXPORT GRN G0057 is persisted as Y with its bucket/remarks. The existing exclusion predicate already removes this valid exception; no KPI formula change is necessary. The page now explicitly shows KPI transaction counts on each card, the number of eligible complete records removed from the adjusted averages, and an excluded/pending indication on each row. A save acknowledgement states whether the saved row is excluded or returns to the normal eligibility rules.

Validation counters partition all >12-hour transactions under the common date/facility/status/search filters into saved valid Y exceptions and N records pending exception validation. These are review counts, not ageing counts for unfinished GRN/Putaway workflow tasks. They update from saved snapshot values, span all table pages and are not changed by unsaved drafts.

The transaction table adds the unloading/transaction date and separate unloading time (IST); this is the same cohort date used by the filters. The Transaction view selector filters the table and both CSV scopes to including exceptions, excluding exceptions (N only), or exceptions only (Y only). Saving Y while in the excluding view removes the row immediately, but it can still be edited in the including/Y-only views. The pair of KPI cards and validation counters retain their common base filter scope rather than being re-filtered by this table-only selector. CSV filenames include the view to make downloads distinguishable.

This is a frontend-only follow-up. Backend version 48, existing sheet annotations, daily processing and KPI formulas are unchanged. Regression tests cover all three KPI values/cohort counts, post-save row removal, date display, counter partitions, view-specific exports, empty datasets, read-only users and pagination. The frontend rollback reference for this follow-up is commit `abb426d`.

### Compact columns and KPI endpoint dates

Transaction date/time columns now use content-sized, nonwrapping widths and shorter two-line headers. Each table KPI value shows its start/end dates beneath it: unloading → Putaway for KPI1, GRN → Putaway for KPI2, unloading → GRN for KPI3. Dates are derived from the existing timestamps in IST, with the existing date-only values as fallback; missing dates display a dash. No timestamps or KPI calculations are changed. Browser regression tests check all three mappings, missing endpoints, compact column widths and the existing save/filter/export flows. This layout-only follow-up retains backend version 48 and has frontend rollback reference `44c8872`.

### IST endpoint times and pinnable navigation — 17 October 2026

Each KPI endpoint now shows its date and `HH:mm:ss IST` time beneath the duration. Times come from existing timezone-bearing source timestamps, formatted in Asia/Kolkata by the same export formatter. Date-only fallbacks display `Time: —` rather than inventing midnight.

The desktop menu button can hide/show the sidebar. Unpin navigation collapses it and removes the desktop main-area margin, recovering 248px for transaction viewing. In unpinned mode it opens as an overlay and closes on page selection, outside click or Escape. Pin navigation keeps it docked; the pinned preference is stored locally in this browser and survives reloads. On mobile it remains an off-canvas menu and closes after navigation regardless of the desktop preference. Hidden navigation is inert, menu controls expose expanded state, and closing an overlay returns focus to the menu button. No new animations or dependencies were added; tall menus can scroll.

Browser checks cover all endpoint time mappings, missing times, full-width recovery, Escape, preference reload, re-pinning and mobile auto-hide, plus the existing exception and Monthly MIS workflows. The production build and lint checks pass. This is frontend-only; backend version 48, annotations, filters and KPI calculations are unchanged. Rollback reference: frontend commit `bfeed63`.
