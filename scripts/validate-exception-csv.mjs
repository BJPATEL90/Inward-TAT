import assert from "node:assert/strict";
import { buildExceptionCsv, EXCEPTION_CSV_HEADERS, exceptionCsvFilename, splitIstTimestamp, isValidBusinessException, needsExceptionValidation } from "../src/exception-csv.mjs";

// Independent CSV reader verifies embedded CR/LF, quotes and column alignment.
function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if (char === "\n" && !quoted) { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r" || quoted) cell += char;
  }
  assert.equal(quoted, false);
  return rows;
}
const record = { recordKey: "OWN|G1|SKU1", facility: "OWN", grnNumber: "G1", sku: "SKU1",
  unloadingTimestamp: "2026-09-30T20:00:00Z", grnReceivedTimestamp: "2026-10-01T01:31:01+05:30",
  putawayCompletedTimestamp: "2026-10-01T21:30:00+05:30", calculatedAt: "2026-10-02T00:00:00Z",
  manualActionAt: "2026-10-01T23:59:59+05:30", kpi1Hours: 20, kpi2Hours: 19.983056, kpi3Hours: 0.016944,
  status: "COMPLETE", exceptionCode: "QUALITY_CODE", exceptionDetail: "Separate quality detail",
  goodsSourceRow: "22", grnSourceRow: "33", putawaySourceRow: "44", matchMethod: "PRIMARY_MATCH",
  matchDetail: 'Invoice "A", matched', manualActionStatus: "SYSTEM_RECOVERED", manualActionBy: "owner@example.com",
  manualActionReason: "Source corrected", exceptionBucket: "Other", exceptionRemarks: 'Delay, see "note"\r\nગુજરાતી',
};
const original = structuredClone(record);
for (const exceptionBucket of ["WH delay", "WH issue", " WH DELAY "]) {
  const reviewed = { ...record, exceptionBucket, exceptionFlag: "Y" };
  assert.equal(isValidBusinessException(reviewed), false);
  assert.equal(needsExceptionValidation(reviewed), false);
  assert.equal(parseCsv(buildExceptionCsv([reviewed]).slice(1))[1][28], "N");
}
assert.equal(needsExceptionValidation({ kpi1Hours: 13 }), true);
assert.equal(needsExceptionValidation({ kpi1Hours: 12 }), false);
assert.equal(needsExceptionValidation(record), false);
const csv = buildExceptionCsv([record, { ...record, recordKey: "K2", kpi1Hours: 12, exceptionRemarks: "" }]);
assert.ok(csv.startsWith("\uFEFF"));
const parsed = parseCsv(csv.slice(1));
assert.deepEqual(parsed[0], Array.from(EXCEPTION_CSV_HEADERS));
assert.equal(parsed.length, 3);
for (const row of parsed) assert.equal(row.length, 31);
const result = Object.fromEntries(parsed[0].map((header, index) => [header, parsed[1][index]]));
assert.equal(result["Unloading Date (IST)"], "2026-10-01");
assert.equal(result["Unloading Time (IST)"], "01:30:00");
assert.equal(result["GRN Received Time (IST)"], "01:31:01");
assert.equal(result["Manual Action Time (IST)"], "23:59:59");
assert.equal(result["Calculated Time (IST)"], "05:30:00");
assert.equal(result["Remarks"], record.exceptionRemarks);
assert.equal(result["Match Detail"], record.matchDetail);
assert.equal(result["KPI2 GRN to Putaway Hours"], "19.983056");
assert.equal(result["Data Quality Exception Code"], "QUALITY_CODE");
assert.equal(result["Exception (Y/N)"], "Y");
assert.equal(parsed[2][28], "N");
assert.deepEqual(record, original);
for (const unsafe of ['=HYPERLINK("url")', "+SUM(1,2)", "-1+1", "@SUM(1)", "   =SUM(1)", "\t=SUM(1)", "\n=SUM(1)"]) {
  const exported = parseCsv(buildExceptionCsv([{ ...record, exceptionRemarks: unsafe }]).slice(1));
  assert.equal(exported[1][30], "'" + unsafe);
}
assert.deepEqual(splitIstTimestamp(null), ["", ""]);
assert.deepEqual(splitIstTimestamp(null, "2026-09-01"), ["2026-09-01", ""]);
assert.deepEqual(splitIstTimestamp("2026-09-01"), ["2026-09-01", ""]);
assert.deepEqual(splitIstTimestamp("2026-10-01T00:00:00+05:30"), ["2026-10-01", "00:00:00"]);
assert.throws(() => splitIstTimestamp("2026-10-01T10:00:00"), /timezone/);
assert.throws(() => splitIstTimestamp("2026-99-99T10:00:00Z"), /invalid/);
assert.equal(parseCsv(buildExceptionCsv([]).slice(1)).length, 1);
assert.equal(isValidBusinessException({ kpi1Hours: 13, exceptionRemarks: " \n" }), false);
assert.equal(isValidBusinessException({ kpi1Hours: null, exceptionBucket: "Other" }), false);
const missing = parseCsv(buildExceptionCsv([{ recordKey: "blank", unloadingDate: "2026-09-01" }]).slice(1))[1];
assert.equal(missing[4], "2026-09-01");
assert.equal(missing[5], "");
assert.equal(missing[10], "");
assert.equal(missing[28], "N");
assert.equal(exceptionCsvFilename({ month: "2026-09", from: "2026-09-01", to: "2026-09-30", facility: "SL Mother Hub", scope: "ALL" }),
  "inward-tat-exceptions-2026-09-2026-09-01_to_2026-09-30-SL-Mother-Hub-all-filtered.csv");
console.log("Exception CSV validated: 31 columns, numeric hours, IST rollover/midnight, timezone guards, missing values, CSV escaping, formula safety, Unicode, flags and no data mutation.");
