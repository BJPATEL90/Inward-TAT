# Inward TAT — One-Page Process Note

## Objective

Measure and communicate inbound turnaround time from vehicle unloading through GRN and final Putaway for SL Ambient, SL Mother Hub, SL Rx, and OWN.

## KPI framework

| KPI | Definition |
|---|---|
| KPI1 | Vehicle Unloading to latest completed Putaway |
| KPI2 | GRN Received Timestamp to latest completed Putaway |
| KPI3 | Vehicle Unloading to GRN Received Timestamp |

All KPIs use continuous elapsed time and a simple average across the same complete `Facility + GRN Number + SKU` cohort. The control equation is **KPI1 = KPI2 + KPI3**.

## Daily input and timing

| Input | Source | Expected content |
|---|---|---|
| Goods Inward | Monthly Google Sheet tab | Unloading date/time, facility, GRN, and SKU |
| GRN | Unicommerce email | Latest cumulative MTD report with `GRN Received Timestamp` |
| Putaway | Four Unicommerce emails | Cumulative SLAMB, SLMH, SLRX, and OWN reports with `Last Updated` |

ERP reports received on a date contain activity through the previous day. For example, the 1–10 report is received on the 11th.

## Process

1. The daily Apps Script trigger reads Goods Inward and finds the latest cumulative ERP emails.
2. Source rows are normalized and deduplicated.
3. Goods records are matched to GRN using SKU + Invoice Number + GRN Number across all facilities.
4. If the primary key is unavailable, Facility + GRN Number + SKU is used as a controlled fallback, including the existing SL Ambient-to-SL Rx bridge.
5. Ambiguous primary matches are excluded and logged; Putaway shelf rows are pivoted using the resolved ERP facility + GRN Number + SKU, with the latest completed timestamp retained.
6. Complete records are used for all KPI averages; missing or negative records move to exceptions.
7. The dashboard and MTD summary are refreshed.
8. Stakeholders receive the KPI email, MTD trend, dashboard link, and CSV attachment.

## Daily validation

- `Execution_Log` shows `PIPELINE | COMPLETED`.
- One GRN and all four Putaway exports were processed.
- Yesterday is not treated as zero when data is still pending.
- No unexplained `NO_GRN_MATCH`, `NO_PUTAWAY_MATCH`, or negative timestamp exception remains.
- KPI1 equals KPI2 plus KPI3 for the same complete cohort.
- The dashboard last-refresh timestamp and email publication date are current.

## Exception handling

| Exception | Action |
|---|---|
| Missing GRN | Verify exact facility, GRN, SKU, and GRN Received Timestamp |
| Missing Putaway | Verify the correct facility export, type, status, SKU, and GRN |
| Negative KPI | Correct the Goods Inward unloading timestamp or ERP milestone timestamp |
| SL Ambient / SL Rx mismatch | Validate the GRN Number + SKU bridge |
| Yesterday shows zero | Confirm whether next-day source data has arrived and the pipeline has run |

## Key links and ownership

- Dashboard: https://bjpatel90.github.io/Inward-TAT/
- Backend workbook: https://docs.google.com/spreadsheets/d/1vTWxEboW_4-9RBJEr0gvKTOQmgM2XEBh1onhDU4mzZI/edit
- Repository: https://github.com/BJPATEL90/Inward-TAT
- Operational settings and stakeholder recipients are maintained in the workbook `Config` tab.

Manual recovery functions: `runInwardTatPipeline` for a full refresh and `sendDailyInwardTatEmail` for an on-demand email.
