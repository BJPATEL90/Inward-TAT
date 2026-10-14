import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
process.env.TZ = "Asia/Kolkata";

const properties = new Map();
const files = new Map();
let fileNumber = 0;
let failWrite = false;
let released = 0;
const config = { MONTHLY_WORKFLOW_ENABLED: "TRUE", MONTHLY_ARCHIVE_FOLDER_ID: "monthly-folder" };
const user = { email: "owner@mosaicwellness.in" };
function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === ",") { row.push(cell); cell = ""; }
    else if (!quoted && ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r" || quoted) cell += ch;
  }
  if (quoted) throw new Error("Malformed CSV");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const context = vm.createContext({ Date, Map, Set, Number, String, Array, JSON, Math,
  getConfig_: () => config, isManualTaskUser_: email => email === user.email,
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { released++; } }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value),
  }) },
  Utilities: { DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    formatDate: date => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10),
    parseCsv, getUuid: () => String(fileNumber + 1),
    computeDigest: (_, text) => [...crypto.createHash("sha256").update(text).digest()],
    newBlob: (text, type, name) => ({ text, type, name }),
  },
  DriveApp: {
    getFileById: id => { if (!files.has(id)) throw new Error("Missing archive"); return files.get(id); },
    getFolderById: id => { assert.equal(id, "monthly-folder"); return {
      getFilesByName: name => { const found = [...files.values()].find(file => file.name === name);
        return { hasNext: () => !!found, next: () => found }; },
      createFile: blob => {
        const id = String(++fileNumber);
        const text = failWrite && blob.name.includes("revision-") ? "corrupt" : blob.text;
        const file = { name: blob.name, getId: () => id, getBlob: () => ({ getDataAsString: () => text }) };
        files.set(id, file); return file;
      },
    }; },
  },
});
for (const file of ["Pipeline.gs", "MonthlyClosure.gs", "MonthlyIngestion.gs", "MonthlyReport.gs"]) {
  new vm.Script(fs.readFileSync(new URL(`../apps-script/${file}`, import.meta.url), "utf8"), { filename: file }).runInContext(context);
}
context.getConfig_ = () => config;
context.monthlyDrive_ = () => context.DriveApp;
const grn = { month: "2026-09", type: "GRN", facility: "ALL", filename: "grn.csv",
  periodStart: "2026-09-01T00:00:00+05:30", periodEndExclusive: "2026-10-01T00:00:00+05:30",
  extractedAt: "2026-10-01T08:00:00+05:30",
  content: "Facility,GRN Code,Item SkuCode,GRN Received Timestamp,Batch Code,Vendor Batch Number,GRN Invoice No\nOWN,G1,SKU1,2026-09-30 23:00:00,B1,V1,INV1\nEXPORT,G1,SKU1,2026-09-30 23:00:00,B1,V1,INV2\n" };
const ingest = source => context.submitMonthlyUpload_({ parameter: { source: JSON.stringify(source) } }, user);
const largerGrn = { ...grn, content: grn.content + "\n" + " ".repeat(5000001) };
assert.throws(() => context.monthlyParseCsv_(largerGrn), /Import from Inbox/);
assert.equal(context.monthlyParseCsv_({ ...largerGrn, channel: "EMAIL" }).records.length, 2);
assert.throws(() => context.monthlyParseCsv_({ ...grn, channel: "EMAIL", content: "X".repeat(25000001) }), /25 million/);
const manyRows = { ...grn, content: grn.content.split("\n")[0] + "\n" + (grn.content.split("\n")[1] + "\n").repeat(20001) };
assert.throws(() => context.monthlyParseCsv_(manyRows), /20,000 rows/);
assert.equal(context.monthlyParseCsv_({ ...manyRows, channel: "EMAIL" }).records.length, 1);
const first = ingest(grn);
assert.equal(first.revision, 1);
assert.equal(first.records, 2);
assert.equal(first.status, "PROVISIONAL");
assert.equal(ingest(grn).duplicate, true);
assert.equal(context.monthlyStatus_("2026-09", user).revision, 1);
const corrected = { ...grn, extractedAt: "2026-10-02T08:00:00+05:30",
  content: grn.content.replace("OWN,G1,SKU1,2026-09-30 23:00:00", "OWN,G1,SKU1,2026-10-01 01:00:00") };
assert.equal(ingest(corrected).lastReconciliation.updated, 1);
const state = context.readMonthlyState_("2026-09");
assert.ok(state.previousRevisionFileId);
assert.equal(state.changes[0].before.values["GRN Received Timestamp"], "2026-09-30 23:00:00");
assert.equal(state.records.length, 2);
assert.equal(state.sources[1].completeMonthCoverage, true);
const before = properties.get("INWARD_TAT_MONTHLY_STATE_2026-09");
failWrite = true;
assert.throws(() => ingest({ ...corrected, extractedAt: "2026-10-03T08:00:00+05:30" }), /verification/);
assert.equal(properties.get("INWARD_TAT_MONTHLY_STATE_2026-09"), before);
assert.equal(context.readMonthlyState_("2026-09").revision, 2);
failWrite = false;
assert.throws(() => ingest({ ...corrected, content: "SKU\nX" }), /Missing CSV column/);
assert.throws(() => ingest({ ...grn, facility: "OWN" }), /declared facility/);
assert.throws(() => context.monthlyStatus_("2026-09", { email: "other@mosaicwellness.in" }), /authorised/);
config.MONTHLY_WORKFLOW_ENABLED = "FALSE";
assert.throws(() => ingest(grn), /not enabled/);
config.MONTHLY_WORKFLOW_ENABLED = "TRUE";
const putaway = { ...grn, type: "PUTAWAY", facility: "OWN",
  content: 'Putaway Item Id,SKU Code,GRN Number,Type,Status Code,Last Updated\n123,SKU1,G1,PUTAWAY_GRN_ITEM,COMPLETE,2026-10-02 08:00:00\n' };
assert.equal(ingest(putaway).recordCounts.PUTAWAY, 1);
assert.throws(() => context.monthlyParseCsv_({ ...putaway, content: putaway.content.split("\n")[0] + "\n" }), /headers only/);
assert.throws(() => context.monthlyParseCsv_({ ...putaway, content: "Putaway Item Id,Item Type skuCode,Type,Status Code,Updated,Facility Name\n123,SKU1,PUTAWAY_GRN_ITEM,COMPLETE,2026-10-02 08:00:00,OWN\n" }), /Missing CSV column/);
const multiFacility = { ...putaway, facility: "ALL", content: putaway.content.split("\n")[0] + ",Facility\n" + putaway.content.split("\n")[1] + ",OWN\n" };
assert.equal(context.monthlyParseCsv_(multiFacility).records[0].values.Facility, "OWN");
assert.equal(context.monthlyParseCsv_({ ...multiFacility, content: multiFacility.content.replace("SKU Code", "Item Type skuCode").replace("Last Updated", "Updated").replace("Facility", "Facility Name") }).records[0].values.Facility, "OWN");
assert.equal(context.validateMonthlySource_({ ...grn, coverageDeclared: false }).completeMonthCoverage, false);
assert.throws(() => ingest({ ...putaway, facility: "ALL" }), /explicit facility/);
assert.throws(() => ingest({ ...putaway, content: putaway.content.replace("123,", ",") }), /Missing Putaway Item Id/);
assert.ok(released >= 4);

// Reuse the deployed matching/KPI engine; any daily-sheet access is a test failure.
context.getSheet_ = () => { throw new Error("Monthly calculation touched a daily sheet"); };
context.latestManualTaskActions_ = () => { throw new Error("Unexpected manual sheet write"); };
context.logExecution_ = () => { throw new Error("Monthly calculation touched daily logs"); };
const record = (type, values) => ({ values: { ...values, _sourceType: type } });
const dataset = [
  record("GOODS_INWARD", { "Received at": "SL Mother Hub", SKU: "SKU1", "GRN no.": "G1", "Invoice number": "INV1", "Unloading Date": "2026-09-30", "Unloading Time": "23:00:00" }),
  record("GRN", { Facility: "OWN", "Item SkuCode": "SKU1", "GRN Code": "G1", "GRN Invoice No": "INV1", "GRN Received Timestamp": "2026-10-01 01:00:00" }),
  record("PUTAWAY", { Facility: "OWN", "SKU Code": "SKU1", "GRN Number": "G1", "Status Code": "COMPLETE", "Last Updated": "2026-10-02 08:00:00" }),
];
const calculated = context.calculateMonthlyRevision_("2026-09", dataset, {});
assert.equal(calculated.summary.completeRecords, 1);
assert.equal(calculated.summary.kpi1Hours, 33);
assert.equal(calculated.summary.kpi2Hours, 31);
assert.equal(calculated.summary.kpi3Hours, 2);
assert.equal(calculated.daily[0].date, "2026-09-30");
assert.equal(context.calculateMonthlyRevision_("2026-10", dataset, {}).summary.records, 0);
const exempt = context.calculateMonthlyRevision_("2026-09", dataset, { OWN_EXCLUDED_SKUS: "SKU1" });
assert.equal(exempt.summary.excludedRecords, 1);
assert.equal(exempt.summary.completeRecords, 0);
assert.equal(exempt.facts.length, 1); // Underlying excluded receipt remains reviewable.
const otherFacility = dataset.map(row => record(row.values._sourceType, { ...row.values,
  ...(row.values.Facility ? { Facility: "EXPORT" } : {}) }));
assert.equal(context.calculateMonthlyRevision_("2026-09", otherFacility, { OWN_EXCLUDED_SKUS: "SKU1" }).summary.completeRecords, 1);
const pendingShelf = dataset.concat([record("PUTAWAY", { Facility: "OWN", "SKU Code": "SKU1", "GRN Number": "G1", "Status Code": "PENDING", "Last Updated": "2026-10-02 09:00:00" })]);
assert.equal(context.calculateMonthlyRevision_("2026-09", pendingShelf, {}).summary.pendingRecords, 1);
const invalid = dataset.map(row => row.values._sourceType === "GRN"
  ? record("GRN", { ...row.values, "GRN Received Timestamp": "2026-09-30 22:00:00" }) : row);
assert.equal(context.calculateMonthlyRevision_("2026-09", invalid, {}).summary.completeRecords, 0);
const missingUnloading = dataset.map(row => row.values._sourceType === "GOODS_INWARD"
  ? record("GOODS_INWARD", { ...row.values, "Unloading Time": "" }) : row);
assert.equal(context.calculateMonthlyRevision_("2026-09", missingUnloading, {}).sourceExceptions.length, 1);

// Selected-month refresh reads the named source tab without changing daily sheets.
context.resolveGoodsSourceSheetForMonth_ = (_, __, date) => {
  assert.equal(new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 7), "2026-09");
  return {
    getDataRange: () => ({ getValues: () => [
      ["SR NO.", "Received at", "SKU", "GRN no.", "Invoice number", "Unloading Date", "Unloading Time"],
      [1, "SL Mother Hub", "SKU1", "G1", "INV1", "2026-09-30", "23:00:00"],
    ] }), getName: () => "FG-Sept-26", getSheetId: () => 123,
  };
};
context.SpreadsheetApp = { openById: () => ({ getId: () => "source-workbook" }) };
const refreshed = context.refreshMonthlySources_("2026-09", user);
assert.equal(refreshed.recordCounts.GOODS_INWARD, 1);
assert.equal(refreshed.summary.records, 1);
assert.equal(refreshed.summary.completeRecords, 1);

config.MONTHLY_CLOSING_GRN_JOB = "GRN/Previous-Month-Close";
config.GRN_EMAIL_FROM = "noreply@e.unicommerce.com";
config.GRN_EMAIL_SUBJECT = "Export Job Complete - GRN";
context.GmailApp = { getMessageById: () => ({
  getFrom: () => "Uniware <noreply@e.unicommerce.com>", getSubject: () => config.GRN_EMAIL_SUBJECT,
}) };
let exportJob = "GRN/This-Month";
context.getEmailBodyText_ = () => "email";
context.extractEmailField_ = (_, field) => field === "Export" ? exportJob : "SUCCESSFUL";
context.extractExportFileUrl_ = () => "https://example.com/closing.csv";
context.downloadCsv_ = () => grn.content;
assert.throws(() => context.importMonthlyClosingEmail_({ ...grn, messageId: "id" }, user), /configured explicit/);
exportJob = config.MONTHLY_CLOSING_GRN_JOB;
assert.equal(context.importMonthlyClosingEmail_({ ...grn, messageId: "id" }, user).ok, true);

// Regression: the existing two-argument daily call still uses its original sheets/writes.
const written = [];
context.INWARD_TAT = { SHEETS: { RAW_GOODS: "goods", RAW_GRN: "grn", RAW_PUTAWAY: "putaway", FACT: "facts", MTD: "mtd" } };
context.getSheet_ = name => ({ name });
context.ensureFactMatchingSchema_ = () => ({ name: "facts" });
context.sheetObjects_ = sheet => dataset.filter(row => row.values._sourceType ===
  ({ goods: "GOODS_INWARD", grn: "GRN", putaway: "PUTAWAY" })[sheet.name]).map((row, index) => ({ ...row.values, __row: index + 2 }));
context.latestManualTaskActions_ = () => new Map();
context.logExecution_ = () => {};
context.replaceDataRows_ = (sheet, rows) => written.push({ sheet: sheet.name, rows });
context.replaceExceptions_ = () => {};
context.rebuildMtdSummary_ = () => [];
assert.equal(context.rebuildTatFacts_({}, "DAILY_TEST").completeRows, 1);
assert.deepEqual(written.map(item => item.sheet), ["facts", "mtd"]);
const countBeforeMonthly = written.length;
assert.equal(context.calculateMonthlyRevision_("2026-09", dataset, {}).summary.completeRecords, 1);
assert.equal(written.length, countBeforeMonthly);

// Verify route method/auth guards without invoking monthly persistence.
let called = 0;
context.verifyGoogleCredential_ = () => ({ ok: true, user });
context.apiResponse_ = payload => payload;
context.jsonResponse_ = payload => payload;
new vm.Script(fs.readFileSync(new URL("../apps-script/Api.gs", import.meta.url), "utf8")).runInContext(context);
context.verifyGoogleCredential_ = () => ({ ok: true, user });
context.apiResponse_ = payload => payload;
context.submitMonthlyUpload_ = () => { called++; return { ok: true }; };
assert.equal(context.doGet({ parameter: { action: "monthlyupload" } }).ok, false);
assert.equal(called, 0);
assert.equal(context.doPost({ parameter: { action: "monthlyupload", month: "2026-09", source: JSON.stringify(grn) } }).ok, true);
assert.equal(called, 1);
assert.equal(context.doPost({ parameter: { action: "monthlyupload", month: "2026-08", source: JSON.stringify(grn) } }).ok, false);
context.listMonthlyInbox_ = () => { called++; return { ok: true }; };
assert.equal(context.doGet({ parameter: { action: "monthlyinbox" } }).ok, false);
assert.equal(context.doPost({ parameter: { action: "monthlyinbox", month: grn.month, source: JSON.stringify(grn) } }).ok, true);
assert.equal(called, 2);
assert.equal(context.doPost({ parameter: { action: "monthlyemailimport", month: "2026-08", source: JSON.stringify(grn) } }).ok, false);
context.verifyGoogleCredential_ = () => ({ ok: false, error: "expired" });
assert.equal(context.doPost({ parameter: { action: "monthlyupload" } }).error, "expired");
assert.equal(called, 2);
console.log("Monthly ingestion validated: authorisation, POST guards, isolated revisions, corrections, duplicate uploads, facility checks and failed-write recovery.");
