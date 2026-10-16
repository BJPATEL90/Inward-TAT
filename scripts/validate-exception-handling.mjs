import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let locked = false, releases = 0, writes = 0, failNextWrite = false;
const removed = [];
const context = vm.createContext({ Date, Map, Set, Array, String, Number, Boolean, Math, JSON,
  SpreadsheetApp: { flush() {} },
  Utilities: { formatDate: date => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10) },
  LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; },
    releaseLock() { locked = false; releases++; } }) },
  CacheService: { getScriptCache: () => ({ remove: key => removed.push(key) }) },
});
for (const name of ["Code.gs", "Pipeline.gs", "Api.gs", "ExceptionHandling.gs"]) {
  new vm.Script(fs.readFileSync(new URL(`../apps-script/${name}`, import.meta.url), "utf8"), { filename: name }).runInContext(context);
}
const definition = vm.runInContext("SHEET_DEFINITIONS.find(entry => entry.name === INWARD_TAT.SHEETS.FACT)", context);
const headers = Array.from(definition.headers);
assert.equal(headers.length, 29);
assert.deepEqual(headers.slice(26), ["Exception (Y/N)", "Exception Bucket", "Remarks"]);

function makeFact(key = "OWN|G1|S1", hours = 20) {
  const row = Array(26).fill("");
  Object.assign(row, { 0: key, 1: "OWN", 2: "S1", 3: "G1", 7: 8, 8: hours - 8,
    9: hours, 10: new Date("2026-10-01T00:00:00+05:30"), 13: "COMPLETE" });
  return row;
}
let cells = [];
const sheet = {
  getLastRow: () => cells.length,
  getLastColumn: () => 29,
  getRange(row, column, height, width) {
    return {
      getValues: () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => cells[row - 1 + r]?.[column - 1 + c] ?? "")),
      setValues(values) {
        writes++;
        if (failNextWrite) { failNextWrite = false; throw new Error("simulated sheet failure"); }
        for (let r = 0; r < height; r++) {
          cells[row - 1 + r] ||= Array(29).fill("");
          for (let c = 0; c < width; c++) {
            const value = values[r][c];
            // Sheets consumes the text-literal apostrophe, preserving visible text.
            cells[row - 1 + r][column - 1 + c] = typeof value === "string" && value.startsWith("'") ? value.slice(1) : value;
          }
        }
      },
      clearContent() {
        for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) cells[row - 1 + r][column - 1 + c] = "";
      },
    };
  },
};
context.ensureFactMatchingSchema_ = () => sheet;
context.isManualTaskUser_ = email => email === "owner@mosaicwellness.in";
const user = { email: "owner@mosaicwellness.in" };
const reset = (rows = [makeFact().concat(["N", "", ""])]) => { cells = [headers.slice(), ...rows.map(row => row.slice())]; writes = 0; };
const request = extra => ({ recordKey: "OWN|G1|S1", exceptionBucket: "Manpower issue", exceptionRemarks: "",
  expectedBucket: "", expectedRemarks: "", ...extra });
const save = extra => context.saveTatException_(request(extra), user);
reset();
for (const hours of [null, "20", undefined, NaN, 12, 0, -1]) assert.equal(context.tatExceptionFlag_(hours, "Other", ""), "N");
assert.equal(context.tatExceptionFlag_(12.00001, "Other", ""), "Y");
assert.equal(context.tatExceptionFlag_(20, "", " \n"), "N");
assert.equal(context.tatExceptionFlag_(20, "", "reason"), "Y");
for (const bucket of vm.runInContext("TAT_EXCEPTION_BUCKETS", context)) {
  reset();
  assert.equal(save({ exceptionBucket: bucket }).exceptionFlag, "Y");
}
reset();
assert.throws(() => context.saveTatException_(request(), { email: "viewer@mosaicwellness.in" }), /not authorised/);
assert.throws(() => save({ exceptionBucket: "Unknown" }), /Invalid exception bucket/);
assert.throws(() => save({ exceptionRemarks: "x".repeat(2001) }), /2,000/);
assert.throws(() => save({ expectedRemarks: undefined }), /Reload/);
assert.equal(writes, 0);
const before = cells[1].slice(0, 26);
assert.equal(save().exceptionFlag, "Y");
assert.deepEqual(cells[1].slice(0, 26), before);
assert.deepEqual(cells[1].slice(26), ["Y", "Manpower issue", ""]);
assert.ok(removed.includes("INWARD_TAT_DASHBOARD_V2_2026-10"));
assert.ok(removed.includes("INWARD_TAT_DASHBOARD_V2_CURRENT"));
assert.throws(() => save(), /another user/);
assert.equal(save({ expectedBucket: "Manpower issue", exceptionBucket: "", exceptionRemarks: "=IMPORTXML(\"url\")" }).exceptionFlag, "Y");
assert.equal(cells[1][28], '=IMPORTXML("url")');
assert.equal(save({ expectedRemarks: '=IMPORTXML("url")', exceptionBucket: "", exceptionRemarks: "" }).exceptionFlag, "N");
assert.equal(locked, false);

// A blank physical row must not redirect the write to another transaction.
reset([Array(29).fill(""), makeFact().concat(["N", "", ""])]);
save();
assert.deepEqual(cells[1], Array(29).fill(""));
assert.equal(cells[2][27], "Manpower issue");
reset([makeFact().concat(["N", "", ""]), makeFact().concat(["N", "", ""])]);
assert.throws(() => save(), /missing or duplicated/);
reset([makeFact("OWN|G1|S1", 12).concat(["N", "Other", "old reason"])]);
assert.throws(() => save({ expectedBucket: "Other", expectedRemarks: "old reason" }), /greater than 12/);
assert.equal(save({ expectedBucket: "Other", expectedRemarks: "old reason", exceptionBucket: "", exceptionRemarks: "" }).exceptionFlag, "N");

// Daily/historical rebuilds preserve entries, derive Y/N again, and leave KPI inputs intact.
reset(); save({ exceptionRemarks: "delay" });
const rebuilt = makeFact();
context.replaceTatFactsPreservingExceptions_(sheet, [rebuilt]);
assert.deepEqual(cells[1].slice(0, 26), rebuilt);
assert.deepEqual(cells[1].slice(26), ["Y", "Manpower issue", "delay"]);
context.replaceTatFactsPreservingExceptions_(sheet, [makeFact("OWN|G1|S1", 10)]);
assert.deepEqual(cells[1].slice(26), ["N", "Manpower issue", "delay"]);
const count = writes;
assert.throws(() => context.replaceTatFactsPreservingExceptions_(sheet, []), /annotated transaction is absent/);
assert.equal(writes, count);
assert.throws(() => context.assertNoTatExceptionEntries_(context.sheetObjects_(sheet)), /Recovery stopped/);
const snapshot = cells.map(row => row.slice());
failNextWrite = true;
assert.throws(() => context.replaceTatFactsPreservingExceptions_(sheet, [makeFact()]), /simulated sheet failure/);
assert.deepEqual(cells, snapshot);
assert.equal(locked, false);
assert.ok(releases >= 7);

// Empty adjusted datasets return null KPIs; including-exceptions uses the same
// complete-record formulas regardless of these additional fields.
const metric = { status: "COMPLETE", kpi1Hours: 20, kpi2Hours: 12, kpi3Hours: 8 };
const baseline = context.summarizeApiFacts_([metric]);
const annotated = { ...metric, exceptionFlag: "Y", exceptionBucket: "Other", exceptionRemarks: "delay" };
assert.deepEqual(context.summarizeApiFacts_([annotated]), baseline);
assert.equal(context.summarizeApiFacts_([annotated].filter(row => row.exceptionFlag !== "Y")).kpi1Hours, null);

// The new API write action is POST-only and requires valid authentication.
context.apiResponse_ = payload => payload;
context.verifyGoogleCredential_ = () => ({ ok: true, user });
reset();
assert.match(context.doGet({ parameter: { action: "saveexception", ...request() } }).error, /POST/);
assert.equal(writes, 0);
assert.equal(context.doPost({ parameter: { action: "saveexception", ...request() } }).exceptionFlag, "Y");
context.verifyGoogleCredential_ = () => ({ ok: false, error: "expired" });
assert.equal(context.doPost({ parameter: { action: "saveexception", ...request() } }).error, "expired");

console.log("Exception backend validated: three-column schema, threshold, permissions, POST/auth, edits/clearing, physical rows, conflict checks, rebuild retention, recovery guard, formula safety and write-error restoration.");
