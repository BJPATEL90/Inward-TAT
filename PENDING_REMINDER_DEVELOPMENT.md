# Pending inward reminder engine

## Approved operational rules

- The Goods Inward Google Sheet is the reminder source.
- The backend checks the source every 30 minutes. This checker updates state only and never sends email.
- `Reported - Waiting for Unloading`: reporting timestamp exists and unloading is blank. It is eligible from the next scheduled email.
- `Waiting for GRN`: unloading exists and the GRN ID is still blank after 2 continuous hours.
- `Waiting for Putaway`: a GRN ID exists and the Putaway ID is blank after 10 continuous hours from the first backend observation of that GRN ID.
- A present Putaway ID closes the reminder. No source GRN or Putaway timestamp is assumed.
- Separate scheduled email triggers run near 03:00, 07:00, 10:00, 13:00, 15:00, 17:00, 19:00 and 23:00 Asia/Kolkata. Google may apply its normal small trigger-time variance.
- Reminder rows stop appearing after the required ID is observed.

## Workbook additions

- `Reminder_Config`: editable primary and CC recipient fields; supports `ALL` or facility-specific scopes.
- `Reminder_State`: system-managed first-observed timestamps and state transitions.
- `Pending_Reminders`: current open transactions, due time, ageing and email eligibility.
- `Reminder_Log`: send result and schedule-slot deduplication.

No columns or formulas are added to `Fact_Inward_TAT`; reminder timing cannot change KPI calculations.

## Email behavior

- One modern HTML email is sent to the configured action owner and copied stakeholders.
- Records are grouped into the three operational stages.
- The compact table combines related values so reporting, unloading, vehicle, facility, vendor, invoice/date, SKU/name, due time and ageing remain visible.
- Mobile email clients receive a stacked version through responsive CSS.
- HTML values are escaped before rendering.
- More than 100 eligible records are split into email parts so no source record is silently dropped.
- A schedule slot is sent once; manual tests use a unique manual slot.

## Setup and rollout

1. Deploy the backend revision.
2. Run `setupPendingReminderEngine` once. This creates the four tabs and installs the 30-minute trigger.
3. Enter the action owner in `Primary Recipient(s)` and stakeholders in `Stakeholder CC` on `Reminder_Config`.
4. Run `sendPendingReminderEmailNow` for a controlled test.
5. Review `Pending_Reminders` and `Reminder_Log` before relying on scheduled delivery.

Rollback is performed by deleting the `runPendingReminderEngine` trigger or setting `REMINDER_ENABLED` to `FALSE`. Existing KPI processing remains operational.
