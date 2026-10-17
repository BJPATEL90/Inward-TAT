import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function formatDate(date, _timeZone, pattern) {
  const local = new Date(date.getTime() + 330 * 60000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  const hour = local.getUTCHours();
  if (pattern === "H") return String(hour);
  if (pattern === "yyyy-MM-dd") return `${year}-${month}-${day}`;
  if (pattern === "dd MMM yyyy") return `${String(local.getUTCDate()).padStart(2, "0")} Oct ${year}`;
  if (pattern === "dd MMM yyyy, hh:mm a") {
    const twelve = hour % 12 || 12;
    return `${String(local.getUTCDate()).padStart(2, "0")} Oct ${year}, ${String(twelve).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
  }
  return local.toISOString();
}

const context = vm.createContext({
  Date, Map, Set, Array, String, Number, Boolean, Math, JSON, Object,
  Utilities: { formatDate },
});
for (const name of ["Code.gs", "Pipeline.gs", "ReminderEngine.gs"]) {
  new vm.Script(fs.readFileSync(new URL(`../apps-script/${name}`, import.meta.url), "utf8"), { filename: name }).runInContext(context);
}

const sheetNames = vm.runInContext("SHEET_DEFINITIONS.map(entry => entry.name)", context);
for (const expected of ["Reminder_Config", "Reminder_State", "Pending_Reminders", "Reminder_Log"]) {
  assert.ok(sheetNames.includes(expected), `missing ${expected} sheet definition`);
}
const config = Object.fromEntries(vm.runInContext("CONFIG_DEFAULTS", context).map(row => [row[0], row[1]]));
assert.equal(config.REMINDER_CHECK_MINUTES, 30);
assert.equal(config.REMINDER_GRN_SLA_HOURS, 2);
assert.equal(config.REMINDER_PUTAWAY_SLA_HOURS, 10);
assert.equal(config.REMINDER_SCHEDULE_HOURS, "3|7|10|13|15|17|19|23");

const at = value => new Date(value);
const base = {
  reminderKey: "source|FG-Oct-26|12",
  sourceSpreadsheetId: "source",
  sourceSheet: "FG-Oct-26",
  sourceRow: 12,
  facility: "SL Ambient",
  reportingTimestamp: at("2026-10-17T10:00:00+05:30"),
  unloadingTimestamp: null,
  grnId: "",
  putawayId: "",
  vendor: "Vendor & Sons",
  invoiceNumber: "INV<1>",
  invoiceDate: at("2026-10-16T00:00:00+05:30"),
  sku: "SKU-1",
  skuName: "Item <One>",
  vehicleNumber: "MH01AB1234",
};
const emptyPrevious = new Map();
let checkedAt = at("2026-10-17T10:30:00+05:30");
let state = context.reconcilePendingReminderState_([base], emptyPrevious, checkedAt)[0];
assert.equal(state.currentStage, "WAITING_UNLOADING");
let pending = context.buildPendingReminderRows_([state], config, checkedAt)[0];
assert.equal(pending.emailEligible, true, "reported vehicles are eligible immediately at the next email slot");

const previousMap = row => new Map([[row.reminderKey, {
  "Reminder Key": row.reminderKey,
  "Source Spreadsheet Id": row.sourceSpreadsheetId,
  "Source Sheet": row.sourceSheet,
  "Source Row": row.sourceRow,
  Facility: row.facility,
  "Reporting Timestamp": row.reportingTimestamp,
  "Unloading Timestamp": row.unloadingTimestamp,
  "GRN ID": row.grnId,
  "GRN Observed At": row.grnObservedAt,
  "Putaway ID": row.putawayId,
  "Putaway Observed At": row.putawayObservedAt,
  "Current Stage": row.currentStage,
  "Stage Entered At": row.stageEnteredAt,
  "First Seen At": row.firstSeenAt,
  "Last Seen At": row.lastSeenAt,
  "Closed At": row.closedAt,
  "Last Reminder Slot": row.lastReminderSlot,
  "Last Reminder At": row.lastReminderAt,
  Vendor: row.vendor,
  "Invoice Number": row.invoiceNumber,
  "Invoice Date": row.invoiceDate,
  SKU: row.sku,
  "SKU Name": row.skuName,
  "Vehicle Number": row.vehicleNumber,
}]]);

const unloaded = { ...base, unloadingTimestamp: at("2026-10-17T11:00:00+05:30") };
checkedAt = at("2026-10-17T12:59:00+05:30");
state = context.reconcilePendingReminderState_([unloaded], previousMap(state), checkedAt)[0];
assert.equal(state.currentStage, "WAITING_GRN");
pending = context.buildPendingReminderRows_([state], config, checkedAt)[0];
assert.equal(pending.emailEligible, false);
assert.equal(pending.dueAt.toISOString(), at("2026-10-17T13:00:00+05:30").toISOString());
checkedAt = at("2026-10-17T13:01:00+05:30");
pending = context.buildPendingReminderRows_([state], config, checkedAt)[0];
assert.equal(pending.emailEligible, true);

const withGrn = { ...unloaded, grnId: "G123" };
checkedAt = at("2026-10-17T13:30:00+05:30");
state = context.reconcilePendingReminderState_([withGrn], previousMap(state), checkedAt)[0];
assert.equal(state.currentStage, "WAITING_PUTAWAY");
assert.equal(state.grnObservedAt.toISOString(), checkedAt.toISOString());
pending = context.buildPendingReminderRows_([state], config, at("2026-10-17T23:29:00+05:30"))[0];
assert.equal(pending.emailEligible, false);
pending = context.buildPendingReminderRows_([state], config, at("2026-10-17T23:31:00+05:30"))[0];
assert.equal(pending.emailEligible, true);

const sameGrnLater = context.reconcilePendingReminderState_([withGrn], previousMap(state), at("2026-10-17T15:00:00+05:30"))[0];
assert.equal(sameGrnLater.grnObservedAt.toISOString(), checkedAt.toISOString(), "same GRN must retain its first observed time");
const closed = context.reconcilePendingReminderState_([{ ...withGrn, putawayId: "P456" }], previousMap(sameGrnLater), at("2026-10-17T16:00:00+05:30"))[0];
assert.equal(closed.currentStage, "CLOSED");
assert.equal(context.buildPendingReminderRows_([closed], config, at("2026-10-17T17:00:00+05:30")).length, 0);

const duplicatePrevious = previousMap(state);
duplicatePrevious.set(`${state.reminderKey}|ROW:${state.sourceRow}`, {
  ...duplicatePrevious.get(state.reminderKey),
  "Reminder Key": `${state.reminderKey}|ROW:${state.sourceRow}`,
});
const deduplicatedState = context.reconcilePendingReminderState_([withGrn], duplicatePrevious, at("2026-10-17T15:30:00+05:30"));
assert.equal(deduplicatedState.length, 1, "stale alternate keys for the same source row must be purged");

for (const hour of [3, 7, 10, 13, 15, 17, 19, 23]) {
  const date = new Date(`2026-10-17T${String(hour).padStart(2, "0")}:00:00+05:30`);
  assert.ok(context.pendingReminderScheduleSlot_(date, config), `hour ${hour} should be scheduled`);
}
assert.equal(context.pendingReminderScheduleSlot_(at("2026-10-17T12:00:00+05:30"), config), "");

const html = context.buildPendingReminderHtml_([
  { ...pending, currentStage: "WAITING_PUTAWAY", facility: base.facility, vendor: base.vendor,
    invoiceNumber: base.invoiceNumber, invoiceDate: base.invoiceDate, sku: base.sku,
    skuName: base.skuName, vehicleNumber: base.vehicleNumber, grnId: "G123" },
], checkedAt, config, 1, 1);
assert.match(html, /Waiting for Putaway/);
assert.match(html, /Vendor &amp; Sons/);
assert.match(html, /INV&lt;1&gt;/);
assert.match(html, /Item &lt;One&gt;/);
assert.match(html, /@media only screen and \(max-width:700px\)/);
assert.doesNotMatch(html, /Fact_Inward_TAT/);

const reminderSource = fs.readFileSync(new URL("../apps-script/ReminderEngine.gs", import.meta.url), "utf8");
assert.doesNotMatch(reminderSource, /INWARD_TAT\.SHEETS\.FACT/);
assert.match(reminderSource, /everyMinutes\(30\)/);
assert.match(reminderSource, /sendScheduledPendingReminderEmail/);
assert.match(reminderSource, /atHour\(hour\)/);
assert.match(reminderSource, /GRN no\./);
assert.match(reminderSource, /Putaway No/);
assert.doesNotMatch(reminderSource, /MailApp\./, "reminder email must use the already-authorised Gmail service only");
assert.doesNotMatch(reminderSource, /sourceSheets\.indexOf\(sourceSheet\)/, "source tabs must be deduplicated by stable name, not wrapper identity");
assert.match(reminderSource, /sourceSheetNames\.has\(sourceSheetName\)/);

console.log("Pending reminder engine validated: three stages, ID-observed timestamps, 2h/10h SLAs, source-tab/state deduplication, eight email slots, responsive escaped HTML, 30-minute trigger and KPI-fact isolation.");
