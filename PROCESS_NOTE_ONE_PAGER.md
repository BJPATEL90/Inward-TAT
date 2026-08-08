# Inward TAT — One-Page Process Note

## Objective

Measure and communicate inbound turnaround time from vehicle unloading through GRN and final Putaway for SL Ambient, SL Mother Hub, SL Rx, OWN, and EXPORT.

## KPI framework

| KPI | Definition |
|---|---|
| KPI1 | Vehicle Unloading to latest completed Putaway |
| KPI2 | GRN Received Timestamp to latest completed Putaway |
| KPI3 | Vehicle Unloading to GRN Received Timestamp |

All KPIs use continuous elapsed time and a simple average. Each KPI includes only records containing both timestamps required for that KPI; unavailable milestones remain pending and are excluded. At record level, **KPI1 = KPI2 + KPI3**. Aggregate averages reconcile only when all three KPIs use the same completed cohort.

## Daily input and timing

| Input | Source | Expected content |
|---|---|---|
| Goods Inward | Monthly Google Sheet tab | Unloading date/time, facility, GRN, and SKU |
| GRN | Unicommerce email | Latest cumulative MTD report with `GRN Received Timestamp` |
| Putaway | Five Unicommerce emails | Cumulative SLAMB, SLMH, SLRX, OWN, and EXPORT reports with `Last Updated` |

ERP reports received on a date contain activity through the previous day. For example, the 1–10 report is received on the 11th.

## Process

1. The daily Apps Script trigger reads Goods Inward and finds the latest cumulative ERP emails.
2. Source rows are normalized and deduplicated.
3. Goods records are matched to GRN using SKU + Invoice Number + GRN Number across all facilities.
4. If the primary key is unavailable, Facility + GRN Number + SKU is used as a controlled fallback, including SL Ambient-to-SL Rx and SL Mother Hub-to-OWN/EXPORT bridges.
   Unicommerce GRN facility `Aramex` is normalized to `EXPORT` before this bridge is applied.
5. Ambiguous primary matches are excluded and logged; Putaway shelf rows are pivoted using the resolved ERP facility + GRN Number + SKU, with the latest completed timestamp retained.
6. Each KPI uses records with its required valid timestamp pair; missing or negative milestones remain pending or move to exceptions.
7. The dashboard and MTD summary are refreshed, including daily boxes unloaded and capacity utilisation.
8. Stakeholders receive the KPI email, volume summary, MTD trend, dashboard link, and CSV attachment.

## Volume and capacity

- Daily volume is the sum of `No. of Boxes Recd` from Goods Inward, grouped by unloading date and combined across all facilities.
- Daily capacity is controlled by `DAILY_UNLOADING_CAPACITY_BOXES` in Config and is currently 3,500 boxes.
- The dashboard overlays volume bars with KPI1, KPI2, and KPI3 so a TAT spike can be reviewed against that day's workload.
- Hover detail shows boxes unloaded, utilisation, and the percentage above or below capacity.
- The selected-range volume strip follows the dashboard date filter. A second ribbon publishes Last Quarter, Last Month, MTD, and Yesterday volume from the corresponding monthly Goods Inward tabs.

## Daily validation

- `Execution_Log` shows `PIPELINE | COMPLETED`.
- One GRN and all five Putaway exports were processed.
- Yesterday is not treated as zero when data is still pending.
- No unexplained `NO_GRN_MATCH`, `NO_PUTAWAY_MATCH`, or negative timestamp exception remains.
- KPI1 equals KPI2 plus KPI3 at record level and whenever the displayed aggregates share the same cohort.
- The dashboard last-refresh timestamp and email publication date are current.

## Exception handling

Manual task controls:

- Access is restricted through the `MANUAL_TASK_USERS` Config list.
- Every update, closure, and reopening is appended to `Manual_Task_Actions` with user, reason, remarks, evidence, and timestamp.
- Manual timestamps contribute to KPIs only after sequence validation; later ERP timestamps automatically take precedence.

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
