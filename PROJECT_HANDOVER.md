# Inward TAT Dashboard — Project Handover

## Purpose

The Inward TAT dashboard tracks the time taken to receive and put away inbound inventory at Mosaic Wellness mother facilities. It combines the manual Goods Inward tracker with Unicommerce GRN and Putaway exports, presents operational KPIs, and sends a daily stakeholder email.

## Production links

- Dashboard: https://bjpatel90.github.io/Inward-TAT/
- Google Sheet backend: https://docs.google.com/spreadsheets/d/1vTWxEboW_4-9RBJEr0gvKTOQmgM2XEBh1onhDU4mzZI/edit
- Apps Script project: https://script.google.com/home/projects/14CR1zTWF9p1JdGhA2zTWvxbqtFCgG3wIodMAnG78DPso_ysrx2dUUqRE/edit
- GitHub repository: https://github.com/BJPATEL90/Inward-TAT

Dashboard access is limited to verified `@mosaicwellness.in` Google Workspace accounts.

## KPI rules

| KPI | Measurement | Formula |
|---|---|---|
| KPI1 | Unloading to Putaway | Latest completed Putaway timestamp − Vehicle Unloading timestamp |
| KPI2 | GRN to Putaway | Latest completed Putaway timestamp − GRN Received Timestamp |
| KPI3 | Unloading to GRN | GRN Received Timestamp − Vehicle Unloading timestamp |

Calculation rules:

- Time is continuous and includes nights, Sundays, and holidays.
- Date-range selection is based on Vehicle Unloading Date.
- The final fact key is resolved ERP `Facility + GRN Number + SKU`.
- Goods-to-GRN matching first uses `SKU + Invoice Number + GRN Number` across facilities. When that exact key is unavailable, the existing `Facility + GRN Number + SKU` rule is used as a controlled fallback.
- Primary keys resolving to multiple ERP facilities are marked `AMBIGUOUS_MATCH` and excluded from KPI averages.
- Putaway shelf rows are consolidated to the unique key; the latest `Last Updated` timestamp is used.
- A simple arithmetic average is calculated only across the same `COMPLETE` record cohort.
- Therefore, at average level, `KPI1 = KPI2 + KPI3`.
- Missing or negative timestamp sequences are exceptions and are excluded from all three KPI averages.
- Last Quarter and Last Month values are published values maintained in `Config`.
- MTD, Yesterday, custom date ranges, and facility views are calculated from operational facts.

## Facilities

- SL Ambient
- SL Mother Hub
- SL Rx
- OWN
- EXPORT

Goods Inward records are initially filtered to SL Mother Hub and SL Ambient. The invoice-based primary match resolves the ERP facility across SL Ambient, SL Mother Hub, SL Rx, OWN, and EXPORT. Controlled `GRN Number + SKU` fallback bridges map SL Ambient to SL Rx and SL Mother Hub to OWN or EXPORT.

## Source data

### Goods Inward tracker

The monthly `FG-<Month>-<YY>` tab provides Vehicle Unloading Date, Unloading Time, Received At, GRN Number, and SKU. The current monthly tab is selected automatically.

### GRN report

- Sender: `noreply@e.unicommerce.com`
- Subject: `Export Job Complete - GRN`
- Required timestamp: `GRN Received Timestamp`
- Expected delivery: next day as a cumulative month-to-date report

### Putaway reports

- Sender: `noreply@e.unicommerce.com`
- Subject: `Export Job Complete - GRN/Gatepass to Putaway`
- Export jobs: `GRN/Putaway-SLAMB`, `GRN/Putaway-SLMH`, `GRN/Putaway-SLRX`, `GRN/Putaway-OWN`, and `GRN/Putaway-EXPORT`
- Filter: `Type = PUTAWAY_GRN_ITEM` and `Status Code = COMPLETE`
- Required timestamp: latest `Last Updated` across matching shelf rows

## Automated processing

1. Read the current Goods Inward monthly tab.
2. Search Gmail for the latest cumulative GRN export.
3. Find the latest Putaway export for each facility.
4. Download, normalize, and deduplicate source rows.
5. Apply the SL Rx facility bridge.
6. Match records using `Facility + GRN Number + SKU`.
7. Pivot shelf-level Putaway rows to one completion timestamp.
8. Rebuild `Fact_Inward_TAT`, `MTD_Summary`, and `Data_Exceptions`.
9. Record every processing stage in `Execution_Log` and `Import_Log`.
10. Send the stakeholder email with KPI cards, MTD trend, dashboard link, and CSV attachment.

## Google Sheet tabs

| Tab | Purpose |
|---|---|
| `Config` | Rules, source details, published KPIs, recipients, URLs, and schedules |
| `Raw_Goods_Inward` | Filtered unloading records |
| `Raw_GRN` | Normalized GRN records |
| `Raw_Putaway` | Normalized shelf-level Putaway records |
| `Fact_Inward_TAT` | Unique record-level timestamps, KPI values, status, and exceptions |
| `MTD_Summary` | Daily and facility-level aggregates for faster loading |
| `Data_Exceptions` | Missing matches and invalid timestamp sequences |
| `Execution_Log` | Step-by-step background processing status |
| `Import_Log` | File-level import and duplicate details |
| `Email_Log` | Email execution, recipients, KPIs, and failures |

## Operating functions

| Function | Use |
|---|---|
| `runInwardTatPipeline` | Run the complete data import and KPI rebuild |
| `sendDailyInwardTatEmail` | Send the stakeholder email manually |
| `setupInwardTatWorkbook` | Create or repair workbook tabs and configuration |
| `validateInwardTatWorkbook` | Validate workbook structure |
| `authorizeInwardTat` | Grant required Google permissions |
| `installDailyInwardTatPipelineTrigger` | Install the daily pipeline trigger |
| `activateInwardTatEmail` | Install the daily email trigger and send a test |
| `clearWronglyPulledPutawayData` | Clear incorrect Putaway imports before a clean reload |

## Daily controls

- Confirm the pipeline ends with `PIPELINE | COMPLETED` in `Execution_Log`.
- Confirm one current cumulative GRN report and three facility Putaway reports were selected.
- Review `Data_Exceptions` for missing GRN, missing Putaway, facility/SKU mismatches, or negative sequences.
- Treat Yesterday `00:00` as data pending when no complete unloading cohort is available.
- Confirm `KPI1 = KPI2 + KPI3` after rounding.
- Keep recipients, schedules, published period KPIs, and URLs in `Config`; do not hard-code them.

## Deployment

- Frontend changes pushed to `main` are deployed to GitHub Pages by GitHub Actions.
- Backend changes are pushed from `apps-script/` using `clasp push` and the existing Apps Script deployment URL is retained.
- OAuth client secrets and deployment credentials must never be committed to GitHub.

## Support checklist

If figures appear wrong, check in this order:

1. Goods Inward unloading date and time.
2. Exact Facility + GRN Number + SKU combination.
3. GRN Received Timestamp.
4. Latest completed Putaway `Last Updated` timestamp.
5. Facility mapping, especially SL Ambient versus SL Rx.
6. Exception status and execution logs.
7. Whether all KPI averages use only `COMPLETE` records.
