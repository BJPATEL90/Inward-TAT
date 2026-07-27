# Inward TAT Dashboard

Mosaic Wellness vehicle-unloading to putaway turnaround-time dashboard, built
with React and Vite and backed by Google Sheets and Apps Script.

## Run locally

```bash
npm install
npm run dev
```

## Live API

Set `VITE_APPS_SCRIPT_URL` to the deployed Apps Script `/exec` URL. Without the
variable, the dashboard opens with a clearly marked preview snapshot.

## Authentication

Production access uses Google Identity Services. The browser receives only the
public OAuth Client ID; Apps Script verifies the Google ID token and restricts
dashboard data to the configured Mosaic Wellness Workspace domain.
Never commit a `client_secret_*.json` file.

The frontend is deployed to GitHub Pages from `.github/workflows/deploy-pages.yml`.
The repository also includes the Apps Script backend.

## Included

- Executive KPI ribbon for Last Quarter, Last Month, MTD, and Yesterday
- MTD KPI1 daily trend and ERP-facility performance
- Custom date and facility analysis
- Facility + GRN + SKU detail navigation
- Direct MTD/filtered CSV download
- Responsive desktop and mobile layout
