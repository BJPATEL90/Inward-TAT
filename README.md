# Inward TAT Dashboard

Operational dashboard and daily stakeholder report for Mosaic Wellness mother-facility inbound turnaround time.

**Live dashboard:** [https://bjpatel90.github.io/Inward-TAT/](https://bjpatel90.github.io/Inward-TAT/)

Access is restricted to verified `@mosaicwellness.in` Google Workspace accounts.

## KPI definitions

All calculations use continuous elapsed time, including nights, Sundays, and holidays. Goods-to-GRN matching uses `SKU + Invoice Number + GRN Number` first and the existing facility key as a controlled fallback. Results use a simple average across unique resolved ERP `Facility + GRN Number + SKU` records. KPI cards show an unambiguous hours-and-minutes value such as `29h 50m`, with `29.84 decimal hrs` underneath for reconciliation.

| KPI | Definition | Start | End |
|---|---|---|---|
| KPI1 | Unloading to Putaway | Vehicle unloading date and time | Latest completed putaway timestamp |
| KPI2 | GRN to Putaway | GRN Received Timestamp | Latest completed putaway timestamp |
| KPI3 | Unloading to GRN | Vehicle unloading date and time | GRN Received Timestamp |

Last Quarter and Last Month use published static values stored in the `Config` sheet. MTD, Yesterday, custom date ranges, and facility selections are calculated from operational data.

## Facilities

The dashboard covers:

- SL Ambient
- SL Mother Hub
- SL Rx
- OWN

`Raw_Goods_Inward` imports only SL Mother Hub and SL Ambient unloading rows. The primary invoice key resolves the ERP facility across SL Ambient, SL Mother Hub, SL Rx, and OWN. When the primary key is unavailable, controlled `GRN Number + SKU` bridges map SL Ambient to SL Rx and SL Mother Hub to OWN.

## Data sources

### Goods Inward tracker

The manual Google Sheet supplies:

- Unloading Date
- Unloading Time
- Received at
- GRN no.
- SKU

The monthly source tab is selected automatically using the `FG-` prefix, with the configured tab name as a fallback.

### GRN report

- Sender: `noreply@e.unicommerce.com`
- Subject: `Export Job Complete - GRN`
- Timestamp: `GRN Received Timestamp`

Only the configured mother facilities are processed. Exact `SKU + Invoice Number + GRN Number` matching is attempted first across facilities. Unresolved rows use `Facility + GRN Number + SKU`; ambiguous matches are excluded and logged. Final facts remain unique by resolved ERP `Facility + GRN Number + SKU`.

### Putaway reports

- Sender: `noreply@e.unicommerce.com`
- Subject: `Export Job Complete - GRN/Gatepass to Putaway`
- Export jobs:
  - `GRN/Putaway-SLAMB`
  - `GRN/Putaway-SLMH`
  - `GRN/Putaway-SLRX`
  - `GRN/Putaway-OWN`

Only `PUTAWAY_GRN_ITEM` rows with `COMPLETE` status are used. Because one GRN item may occupy multiple shelves, shelf-level rows are consolidated by `Facility + GRN Number + SKU`; the latest `Last Updated` value becomes the putaway completion timestamp.

ERP exports are expected to be cumulative MTD reports. For example, data from 1–10 July is received on 11 July. Previously processed messages and CSV URLs are skipped.

## Processing flow

1. Find the latest valid GRN and facility-specific putaway emails.
2. Download and normalize cumulative CSV files.
3. Import the current monthly Goods Inward tracker.
4. Apply the SL Rx bridge.
5. Deduplicate source data.
6. Rebuild `Fact_Inward_TAT`.
7. Rebuild `MTD_Summary` for faster dashboard loading.
8. Record progress, duplicates, row counts, and errors in the log sheets.

The workbook contains:

| Sheet | Purpose |
|---|---|
| `Config` | Business rules, source settings, published KPIs, dashboard URL, and email schedule |
| `Raw_Goods_Inward` | Filtered monthly unloading records |
| `Raw_GRN` | Normalized GRN export rows |
| `Raw_Putaway` | Normalized facility putaway rows |
| `Fact_Inward_TAT` | Unique record-level timestamps, KPIs, and status |
| `MTD_Summary` | Daily and facility-level MTD aggregates |
| `Data_Exceptions` | Missing matches, timestamps, and invalid sequences |
| `Execution_Log` | Detailed pipeline progress and diagnostics |
| `Import_Log` | Import-level row counts and status |
| `Email_Log` | Email runs, KPI values, recipients, and errors |

## Dashboard

The React dashboard provides:

- Executive ribbon for Last Quarter, Last Month, MTD, and Yesterday
- KPI1, KPI2, and KPI3 values as hours and minutes, with decimal hours shown underneath
- Yesterday data-pending alert when no unloading records are available
- Custom From/To date filters
- Facility filter
- MTD KPI1 daily trend
- Facility comparison
- Record-level review by Facility + GRN + SKU
- MTD and filtered CSV download
- Last refresh timestamp
- Responsive desktop and mobile layouts

The selected date range is based on Vehicle Unloading Date. All three selected-range KPIs change with the date and facility filters.

## Authentication and security

The public GitHub Pages URL displays Google Sign-In before loading operational data.

- Google Identity Services issues the ID token.
- Apps Script validates the token with Google.
- The OAuth audience, token expiry, verified email, and `mosaicwellness.in` hosted domain are checked.
- Dashboard data is not returned without a valid token.
- The OAuth Client ID is public by design.
- OAuth client secrets, local environment files, build output, and deployment credentials are excluded from Git.

Never commit a `client_secret_*.json` file.

## Daily email

The Apps Script email automation sends the report according to `EMAIL_RECIPIENTS` and `EMAIL_SEND_TIME` in the `Config` sheet.

Subject format:

```text
Inward TAT | DD MMM YYYY
```

The email contains:

- `Published on` date and time in IST
- Reference-style navy Mosaic Wellness header
- Last Quarter, Last Month, MTD, and Yesterday cards
- KPI1, KPI2, and KPI3 values
- Yesterday pending-data status
- MTD KPI1 daily trend chart
- GitHub dashboard link
- MTD record-level CSV attachment

Run `activateInwardTatEmail` once to install the daily trigger and send a test email. Run `sendDailyInwardTatEmail` for an on-demand report.

## Apps Script operations

Run these functions from the Apps Script editor as required:

| Function | Purpose |
|---|---|
| `setupInwardTatWorkbook` | Creates missing sheets, headers, formats, and configuration keys |
| `validateInwardTatWorkbook` | Validates the workbook structure |
| `authorizeInwardTat` | Requests the required Sheets, Gmail, URL Fetch, and trigger permissions |
| `runInwardTatPipeline` | Runs the complete import and KPI rebuild |
| `installDailyInwardTatPipelineTrigger` | Installs the daily pipeline trigger near 08:30 IST, before the stakeholder email |
| `installInwardTatTrigger(hour)` | Installs the pipeline trigger at a custom hour; defaults to 08:30 IST when run without an argument |
| `activateInwardTatEmail` | Installs the email trigger and sends a test |
| `sendDailyInwardTatEmail` | Sends the report immediately |
| `clearWronglyPulledPutawayData` | Clears incorrect putaway imports and dependent calculated data for a clean reload |

## Frontend development

Requirements:

- Node.js 20+
- npm

Install and start locally:

```bash
npm install
npm run dev
```

Create `.env.local`:

```env
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
VITE_GOOGLE_WORKSPACE_DOMAIN=mosaicwellness.in
```

Validate:

```bash
npm run lint
npx vite build --base=/Inward-TAT/
```

## Deployment

### Frontend

GitHub Actions deploys `main` to GitHub Pages using:

```text
.github/workflows/deploy-pages.yml
```

Every push to `main` runs:

1. `npm ci`
2. ESLint
3. Vite production build with the `/Inward-TAT/` base path
4. GitHub Pages deployment

### Backend

The Apps Script source is stored in `apps-script/` and synchronized with `clasp`.

```bash
cd apps-script
clasp push
```

After backend changes, update the existing Apps Script deployment so the `/exec` URL remains stable.

## Operational notes

- Yesterday may show `00:00` when the next-day ERP or unloading data has not yet arrived. This is shown as pending, not treated as a valid zero-duration KPI.
- Missing GRN or putaway matches remain visible as exceptions and do not contribute false zero values to averages.
- Negative timestamp sequences are marked as exceptions.
- Update business rules and recipients through the `Config` sheet rather than hard-coding operational values.
