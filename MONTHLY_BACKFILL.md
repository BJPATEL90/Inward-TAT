# Owner-run monthly inbox backfill

Deployed 30 October 2026 as version 55 in Apps Script project `14CR1zTWF9p1JdGhA2zTWvxbqtFCgG3wIodMAnG78DPso_ysrx2dUUqRE`. No trigger is added and the daily pipeline is unchanged. Live health and unauthenticated import rejection passed; readback confirmed both target scripts and all unrelated scripts/manifest. Previous live code is in `work/monthly-backfill-backup-20261030`. Backfill has not been executed against operational data; the source settings are intentionally blank until an export is selected.

1. Generate GRN / GRN-linked Putaway exports in Uniware for the required interval. Keep the original successful export emails with download links in the script owner's inbox. A locally downloaded CSV alone is not available to this inbox function. Forwarded attachments are not supported.
2. Run `listMonthlyBackfillEmails`. Logs show candidate Gmail message IDs, subjects and received times from configured Uniware senders. This bounded search covers seven days / 50 threads and reports possible truncation.
3. Edit `monthlyInboxBackfillSettings_` in MonthlyBackfill.gs for ONE email: month, messageId, type, facility, actual filter start/end-exclusive and actual generation time (with IST offset). For full October use October 1 midnight through November 1 midnight, generated after that boundary. Mid-month exports are partial; do not declare a future end.
4. Run `previewMonthlyInboxBackfill`. Review accepted rows and inserted/updated/stale counts. Nothing is written. Header validation, explicit facility checks and same-time conflicts still apply.
5. Run `runMonthlyInboxBackfill`. Repeat for each facility/report. Each execution revalidates the original sender, successful status, source and current archive; it does not rely on subject/job names. It archives source data and publishes a new monthly revision only after verification. Repeat imports use existing content-hash duplicate detection; newer extracts update matching source keys; absent keys are retained.
6. In Monthly MIS select the month and Refresh Data to refresh Goods Receiving unloading and recalculate; then download the existing monthly MIS. Imports remain provisional; declared dates and an email do not prove completeness.

Dedicated owner-run imports accept up to 40 million CSV characters and 200,000 source rows. This is a parser ceiling, not a runtime guarantee; split extraction windows if Apps Script memory/time limits are reached. Browser upload remains 5 MB / 20,000 rows and normal inbox import remains 25 million characters. One email per execution avoids processing an entire mailbox in one run.

This stage writes only the existing isolated monthly archive. It does not create the proposed per-month Google Sheet or month-row dashboard, and does not copy daily exception annotations into monthly data. Those remain separate development tasks. Do not treat this as a final monthly closure.

## Receiving snapshot refresh correction — 30 October 2026

Deployed as version 56. Live readback, health and unauthenticated refresh rejection passed. Prior live code is in `work/monthly-refresh-backup-20261030`. No operational refresh was executed during release; select October and Refresh Data in the authenticated dashboard to publish the updated snapshot.

Receiving serial numbers repeat legitimately across split batch/GRN lines. Monthly refresh previously keyed Goods Receiving by workbook, tab and serial, rejecting these rows as same-time conflicts (October serial 454). Refresh now reads the complete tab and uses physical source rows within a versioned `SHEET_ROWS_V1` snapshot. This applies only to internal Google Sheet refresh, not ERP uploads or inbox imports.

Each successful refresh replaces only the previous Goods Receiving snapshot for the exact same workbook/tab; current deletions, sorting and corrections therefore cannot leave duplicate old lines behind. Other source tabs and all GRN/Putaway records remain intact. Existing serial-based snapshot rows migrate on the next refresh. Removed/replaced rows are recorded in revision changes, and all prior revisions/source envelopes remain archived. A stale refresh cannot overwrite a newer snapshot; failed verification cannot publish the state pointer. Users must keep the receiving tab complete; a deliberately removed source row disappears from the current snapshot while remaining in prior archived revisions.

Regression checks cover repeated serials with different batches/GRNs, legacy-key replacement, repeat import, row reorder, scope isolation and stale snapshot rejection. Refreshing unloading alone does not fetch missing ERP reports or finalize the month.

## Owner identity permission — version 57

Added the required `https://www.googleapis.com/auth/userinfo.email` scope on 30 October 2026 for `Session.getEffectiveUser().getEmail()`. The owner must run the preview in Apps Script and complete Google's authorization prompt to grant the new scope; uploading a manifest cannot grant account consent. Existing scripts, live backfill settings and all other manifest fields were preserved and verified by readback. Live health passed, but authenticated backfill remains unverified until the owner grants consent. Backup: `work/monthly-owner-scope-backup-20261030`.
