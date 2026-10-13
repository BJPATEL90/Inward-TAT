# Monthly MIS development

Approved 13 October 2026. Develop and verify one phase at a time.

## Agreed requirements

- Daily 08:00 This Month reports remain the operational input.
- Explicit previous-month closing exports are required to capture the final day.
- Reporting month follows unloading date in IST. Later GRN/Putaway completions remain linked to that receipt month.
- Automatic Apps Script ingestion plus frontend upload for missing/corrected exports.
- One selected-month Refresh Data action; no pipeline-function choices for users.
- Immutable sources and issued MIS versions; corrections remain traceable.
- Excel has Summary (monthly/daily/facility results, graphs, pending closure) and Detailed Data (facility-level records, separate date/time columns).
- Seven SKU exclusions apply only to resolved OWN facility; excluded source records remain traceable.
- Provisional, Final and Revision pending statuses. Final issuance needs recorded closure/review.
- Previous-month pending notifications include owner and ageing. Owner mapping, delivery mode and reminder policy remain to be finalized before enabling notifications.

## Phases

1. **Monthly foundation**: strict IST month windows, immutable source archive, stable-key correction reconciliation, tests. No production pipeline or trigger changes.
2. **Ingestion and refresh**: authorized upload/selected-month APIs; separate historical source storage; closing-export coverage checks; later completion recovery; atomic publish of validated monthly results. Preserve daily processing and raw source archives. A newer current-month email is not proof of previous-month coverage.
3. **Monthly MIS and dashboard**: selected month, upload/refresh controls, closure summary, two-tab Excel with graphs and separate date/time values. Retain final versions and surface revisions.
4. **Closure and reminders**: owner mapping, ageing, approval/version history, system notifications, end-to-end verification and deployment.

## Safety and reconciliation

- Never replace daily raw tabs with a historical month's extracts.
- Incoming extracts must declare their report interval and generation time; timestamps observed in transactions alone cannot prove complete coverage.
- A missing row in a later extract is not a deletion. Explicit deletion/cancellation handling needs source evidence.
- Stable IDs identify corrections. Changes to identity fields without stable IDs need review, not inferred matches.
- Block conflicting values from the same extract generation time. Ignore older snapshots when a newer version exists.
- Retain source reports independently from normalized current records and calculated KPIs.
- Report refresh is not final approval. Do not send messages or install triggers during foundation work.

## Phase 1 status

Implemented locally: MonthlyClosure.gs and a standalone validation suite. The existing pipeline/API/frontend are unchanged by Phase 1. Archive creation is opt-in and requires an explicit Drive folder ID; no live archive has been created. Phase 2 will connect and secure the module before production enablement.

Verified: monthly foundation scenarios, Apps Script syntax, existing hybrid matching scenarios, and production frontend build. Archive checks use a mocked Drive service; live permissions and archive persistence must be checked in Phase 2. The module is excluded by the current clasp allowlist and has not been deployed.

Resume with Phase 2 in this workspace. Latest deployed base was fast-forwarded to commit 4fa1da5 before development. Preserve untracked outputs/, work/ and apps-script/clasp.cmd. Implement selected-month ingestion with durable correction history and authenticated APIs before adding frontend controls. No global or daily-source replacement should be introduced.

## Phase 2 status

Implemented locally:
- Authenticated POST actions monthlyStatus, monthlyUpload and monthlyRefresh, restricted to the existing manual-task user allowlist.
- GRN and facility-specific Putaway CSV validation and source archiving; selected-month unloading refresh from the corresponding Goods Receiving tab.
- Immutable Drive revisions containing sources, normalized records, correction history and calculated results. Publish the revision pointer only after verifying the saved file.
- Existing hybrid matching/KPI engine supports an explicit calculation-only input path. Default daily calls preserve their original behavior and persistence.
- Monthly results follow unloading date, retain later completions and expose source exceptions. Excluded OWN receipts remain in monthly detail and are omitted from eligible averages.
- Explicit closing-email adapter verifies sender, subject and configured closing-export job. It does not infer coverage from email arrival date and does not install triggers.
- Frontend API helpers ready for Phase 3 controls.

Required settings before enablement: MONTHLY_WORKFLOW_ENABLED=TRUE, MONTHLY_ARCHIVE_FOLDER_ID=<Drive folder ID>. Closing email settings: MONTHLY_CLOSING_GRN_JOB=<exact export job>, MONTHLY_CLOSING_PUTAWAY_JOB_PREFIX=<closing job prefix recognized by existing facility mapping>. Interval/generation metadata must be supplied by the closing-job descriptor. No settings, live archive, triggers or production deployments were changed in this phase. Monthly modules remain outside the current clasp allowlist until coordinated deployment.

Limits: 5 million CSV characters and 20,000 rows per upload. Goods corrections use source sheet ID plus SR NO.; serial numbers must stay stable. GRN keys use facility/GRN/SKU/batch/vendor batch; changed identity fields require review. Putaway uses facility plus Putaway Item Id. Missing rows are retained, not interpreted as cancellations.

Monthly manual override review, closure approval, full calendar/day-volume presentation, report generation and frontend controls are remaining Phase 3/4 work. Monthly status remains provisional and closureReady=false; no report is labelled final from extraction coverage alone.

Verification passed: standalone monthly archive/merge tests; integration tests for uploads, selected-month refresh, explicit closing-email selection, atomic failed-write recovery, access/POST guards, late completions, OWN-only exclusions, incomplete shelves, invalid timestamp sequence and missing unloading. A default daily-call regression check confirms daily persistence still occurs and the monthly path performs no daily-sheet writes. Apps Script syntax, existing hybrid matching checks, frontend API lint and production build passed. Tests mock Google services; live Drive/Gmail permissions are not yet tested.

Phase 2 handed off to Phase 3 locally. Keep MONTHLY_WORKFLOW_ENABLED false until live validation. The closing-email adapter needs a verified Uniware closing job in Phase 4.

## Phase 3 status

Complete locally:
- Separate Monthly MIS navigation/screen: selected month, source refresh, upload form with explicit IST extraction window, source coverage, full calendar daily progress, facility KPIs and pending preview.
- XLSX download uses monthlyReport authenticated POST, validates the requested revision and returns the archived workbook bytes. Existing dashboard CSV/refresh controls remain on their original views, avoiding cross-month confusion.
- Excel generation uses native Apps Script Spreadsheet services at runtime. Exactly two tabs: Summary and Detailed Data. Summary includes complete-cohort KPI formulas, monthly counts, daily progress, unique-source unloading volume, facility comparison and source coverage. Four graphs: daily KPI/target, completion/pending, boxes and facility KPIs.
- Detailed Data includes every monthly calculated receipt, approved OWN exclusions and source exceptions, plus separate supporting Goods/GRN/Putaway source tables. Date/time fields are numeric Excel dates and fractions in separate columns (IST, extraction metadata in UTC). Unparseable original timestamp text is retained in an explicitly labelled column. Original exports remain archived.
- Every export is tied to a source revision. Repeated downloads reuse that revision's archived XLSX. Changes require a new revision; earlier issued files remain intact. Calculation configuration is stored with new revisions.
- Monthly module files added to clasp allowlist for coordinated deployment.

Verification passed: monthly foundation and ingestion suites, MIS model/export wiring suite, default daily regression, hybrid matching, Apps Script syntax, frontend lint and build. Headless Edge tested authenticated navigation, selected-month refresh, verified upload metadata, revision reload, XLSX download event, desktop/mobile layouts and return to existing Dashboard controls. UI uses mocked API; Spreadsheet/Drive export tests use mocked Google services, not a live generated Excel. Actual Google XLSX export, chart conversion and Drive permissions must be verified at deployment.

No production deployment or live source changes occurred. Owner mapping, manual-override closure review, final approval and reminders remain Phase 4. Pending owner displays Unassigned until mapping is configured. Source extraction jobs must explicitly cover the previous month and later completions; this cannot be inferred from email arrival date.

Resume Phase 4 from this workspace. Configure archive access, verify explicit Uniware closing jobs and reminder delivery policy, integrate closure ownership/approval, then deploy and validate with actual sources. Preserve outputs/, work/ and apps-script/clasp.cmd.

## Deployment — 13 October 2026

Phases 1–3 published to GitHub main in ff43c03. GitHub Pages run 38354936828 completed successfully. Apps Script web endpoint was updated in place to version 38 and its health check returned ok=true.

Preserved the live backend's 120-second dashboard cache and historical month availability instead of introducing the repository's earlier two-month restriction. Deployment staged from the live project, retaining the unrelated SkuPacksizeAnalysis script and unchanged manifest/scopes. Native DriveApp calls in the monthly modules were replaced by a REST adapter using the existing drive.file scope, avoiding a broader permission request that could interrupt the daily trigger.

Archive initialization could not be executed remotely: clasp run setupMonthlyReportingArchive returned a permission error. Monthly workflow remains disabled. Required one-time action by the Apps Script owner: run setupMonthlyReportingArchive from the script editor. It creates/reuses an app-accessible private archive folder and stores its Config ID, but deliberately leaves MONTHLY_WORKFLOW_ENABLED=FALSE. After that, validate actual archive writes and XLSX export, then enable the monthly flag. Daily reporting remains independent. No monthly data has been imported or changed by this deployment.

The owner ran setup and received HTTP 403 at the folder-creation request. The original error omitted Google's response details, so the exact cause is not yet known. MonthlyDrive now surfaces the API reason and message, with specific guidance for SERVICE_DISABLED/accessNotConfigured versus ACCESS_TOKEN_SCOPE_INSUFFICIENT. Existing scopes and daily triggers remain unchanged. Diagnostic cases are covered by scripts/validate-monthly-drive.mjs. The next owner setup attempt must supply the detailed error before any scope or Cloud-project changes are considered.

The next owner execution confirmed insufficientPermissions / ACCESS_TOKEN_SCOPE_INSUFFICIENT. Archive setup now calls ScriptApp.requireScopes for the existing drive.file permission before acquiring a lock or changing data. Running setup in the Apps Script editor can request the omitted granular consent; the owner must grant that permission and rerun setup. No authorization is revoked, no scope is broadened and no daily trigger is changed. Syntax, lint and missing/granted-consent guard tests passed. Live folder creation and Excel export remain unverified until owner consent succeeds.

## Live isolated validation — 13 October 2026

Owner enabled Drive v3 under Services in the existing Default Cloud project and completed archive setup. The enabled service is now also preserved in the repository manifest; no Cloud-project switch or extra OAuth scope was needed.

Editor-only testMonthlyReportingArchive passed at 15:40 IST with MONTHLY_WORKFLOW_ENABLED=FALSE. It parsed and archived three synthetic Goods/GRN/Putaway sources in a separate TEST ONLY folder, verified exact read-back, calculated one receipt crossing month-end (KPI1 33h, KPI2 31h, KPI3 2h) and used the same shared exporter as production. A repeated export returned the identical archived file and bytes. It did not publish monthly state pointers, import operational data or alter daily triggers/configuration.

Test folder: https://drive.google.com/drive/folders/1RfkAO86geVr8KTVQmNqZPsUWnRDNVA0t
Test Excel: https://drive.google.com/file/d/18eGOIXzDDrzQXzWC3LC5pwDO1lZrYdjC/view
Downloaded backup: outputs/Inward_TAT_MIS_2026-09_r1_TEST_ONLY.xlsx (16,844 bytes).

Downloaded OpenXML verified exactly Summary and Detailed Data tabs, four chart objects, cached formula results 33/31/2 and numeric separate unloading/GRN/Putaway date/time cells. The source cohort is synthetic, not September operational MIS. Actual month import, UI upload and dashboard download against operational data remain to be validated before issuing MIS; monthly workflow remains disabled. Synthetic files are retained in the labelled folder for traceability.
