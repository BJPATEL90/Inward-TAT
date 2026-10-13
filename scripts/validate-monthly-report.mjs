import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
process.env.TZ = "Asia/Kolkata";

const config = { MONTHLY_WORKFLOW_ENABLED: "TRUE", MONTHLY_ARCHIVE_FOLDER_ID: "folder", OWN_EXCLUDED_SKUS: "OWNAPP.00034" };
const records = [
  { key: "goods-1", sourceId: "goods-file", extractedAt: "2026-10-03T08:00:00+05:30", values: { _sourceType: "GOODS_INWARD", "Received at": "SL Mother Hub", "Invoice number": "=HYPERLINK(\"bad\")", SKU: "OWNAPP.00034", "No. of Boxes Recd": "20", "Unloading Date": "2026-09-30", "Unloading Time": "23:00:00" } },
  { key: "grn-1", sourceId: "grn-file", extractedAt: "2026-10-03T08:00:00+05:30", values: { _sourceType: "GRN", Facility: "OWN", "GRN Received Timestamp": "2026-10-01 01:00:00" } },
  { key: "put-1", sourceId: "put-file", extractedAt: "2026-10-03T08:00:00+05:30", values: { _sourceType: "PUTAWAY", Facility: "OWN", "Last Updated": "2026-10-02 08:00:00" } },
];
const fact = facility => [`${facility}|G1|OWNAPP.00034`, facility, "OWNAPP.00034", "G1", "2026-09-30T17:30:00.000Z", "2026-09-30T19:30:00.000Z", "2026-10-02T02:30:00.000Z", 2, 31, 33, "", "", "", "COMPLETE", "", "", 2, 3, 4, "", "PRIMARY_MATCH"];
const state = { month: "2026-09", revision: 3, status: "PROVISIONAL", updatedAt: "2026-10-03T08:00:00+05:30", records, sources: [],
  calculationConfig: config,
  calculations: { summary: { records: 2, eligibleRecords: 1, completeRecords: 1, pendingRecords: 0, excludedRecords: 1, kpi1Hours: 33, kpi2Hours: 31, kpi3Hours: 2 },
    facts: [fact("OWN"), fact("EXPORT")], sourceExceptions: [],
    daily: [{ date: "2026-09-30", records: 2, completeRecords: 1, pendingRecords: 0, kpi1Hours: 33, kpi2Hours: 31, kpi3Hours: 2 }],
    facilities: [{ facility: "EXPORT", records: 1, completeRecords: 1, pendingRecords: 0, kpi1Hours: 33, kpi2Hours: 31, kpi3Hours: 2 }] } };
const grids = [];
let exports = 0;
let failExport = false;
let releases = 0;
const archived = new Map();
function cellKey(row, column) { return `${row}:${column}`; }
function range(sheet, row, col, rows = 1, columns = 1) {
  const object = { setValues: values => { values.forEach((line, r) => line.forEach((value, c) => sheet.cells.set(cellKey(row + r, col + c), value))); return object; },
    setValue: value => { sheet.cells.set(cellKey(row, col), value); return object; },
    setFormula: formula => { sheet.cells.set(cellKey(row, col), formula); return object; },
    setNumberFormat: format => { sheet.formats.push({ row, col, rows, columns, format }); return object; } };
  for (const method of ["setBackground", "setFontColor", "setFontWeight", "setWrap", "setFontSize", "merge", "createFilter"]) object[method] = () => object;
  return object;
}
function sheet(name) {
  const s = { name, cells: new Map(), formats: [], charts: [], maxRows: 1000, maxColumns: 26,
    setName: value => { s.name = value; return s; }, getMaxRows: () => s.maxRows, getMaxColumns: () => s.maxColumns,
    insertRowsAfter: (_, count) => { s.maxRows += count; }, insertColumnsAfter: (_, count) => { s.maxColumns += count; },
    getRange: (row, col, rows, columns) => {
      if (typeof row === "string") { const match = row.match(/^([A-Z]+)(\d+)/); row = Number(match[2]); col = [...match[1]].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0); }
      return range(s, row, col, rows, columns);
    }, insertChart: chart => s.charts.push(chart),
    newChart: () => { const chart = { options: {}, ranges: [] }; const builder = {
      setChartType: type => { chart.type = type; return builder; }, addRange: r => { chart.ranges.push(r); return builder; },
      setOption: (key, value) => { chart.options[key] = value; return builder; }, setPosition: () => builder,
      setNumHeaders: () => builder, build: () => chart,
    }; return builder; },
  };
  for (const method of ["setRowHeight", "setColumnWidths", "setColumnWidth", "setFrozenRows", "setFrozenColumns"]) s[method] = () => s;
  grids.push(s); return s;
}
const context = vm.createContext({ Date, Map, Set, String, Number, Array, JSON, Math,
  Charts: { ChartType: { LINE: "LINE", COLUMN: "COLUMN" } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { releases++; } }) },
  Utilities: { formatDate: date => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10), sleep() {}, base64Encode: bytes => Buffer.from(bytes).toString("base64") },
  ScriptApp: { getOAuthToken: () => "private-test-token" },
  SpreadsheetApp: { create: () => { const first = sheet("Sheet1"); return { getId: () => "generated-sheet", getSheets: () => [first], insertSheet: name => sheet(name) }; }, flush() {} },
  UrlFetchApp: { fetch: () => { exports++; return { getResponseCode: () => failExport ? 500 : 200,
    getBlob: () => ({ getBytes: () => failExport ? [1] : [80, 75, 3, 4, 1], setName: name => ({ name, getBytes: () => [80, 75, 3, 4, 1] }) }) }; } },
  DriveApp: { getFileById: () => ({ moveTo() {} }), getFolderById: () => ({
    getFilesByName: name => ({ hasNext: () => archived.has(name), next: () => archived.get(name) }),
    createFile: blob => { const file = { getId: () => "xlsx-file", getBlob: () => blob }; archived.set(blob.name, file); return file; },
  }) },
});
for (const file of ["Pipeline.gs", "MonthlyClosure.gs", "MonthlyIngestion.gs", "MonthlyReport.gs"]) {
  new vm.Script(fs.readFileSync(new URL(`../apps-script/${file}`, import.meta.url), "utf8")).runInContext(context);
}
context.monthlyAccess_ = () => config;
context.monthlyDrive_ = () => context.DriveApp;
context.readMonthlyState_ = () => state;
const model = context.monthlyReportModel_(state, {});
assert.equal(model.daily.length, 30);
assert.equal(model.details[0][6], 46295); // 30 September 2026 Excel date.
assert.equal(model.details[0][7], 23 / 24);
assert.equal(model.details[0][8], 46296); // Late milestone remains on 1 October.
assert.equal(model.details[0][15], "EXCLUDED");
assert.equal(model.details[1][16], "INCLUDE");
assert.equal(model.totalBoxes, 20); // Same unloading source referenced by two facts is counted once.
assert.equal(model.sourceTables[1].headers.includes("GRN Received Timestamp"), false);
assert.equal(model.sourceTables[1].headers.includes("GRN Received Timestamp Date"), true);
assert.equal(model.sourceTables[1].rows[0][4], "OWN");
assert.equal(context.monthlySafeCell_("=SUM(1,2)"), "'=SUM(1,2)");
assert.equal(context.monthlySafeCell_(33), 33);
assert.throws(() => context.createMonthlyMis_(state.month, 2, { email: "owner" }), /changed/);
assert.equal(grids.length, 0);
const report = context.createMonthlyMis_(state.month, 3, { email: "owner" });
assert.equal(report.revision, 3);
assert.equal(report.status, "PROVISIONAL");
assert.equal(grids.length, 2);
assert.deepEqual(grids.map(s => s.name), ["Summary", "Detailed Data"]);
assert.equal(grids[0].charts.length, 4);
assert.match(grids[0].cells.get("15:2"), /SUMIFS\('Detailed Data'!M4:M5/);
assert.match(grids[0].cells.get("17:2"), /'Detailed Data'!O4:O5/);
assert.equal(grids[1].cells.get("4:5").startsWith("'="), true);
assert.equal(grids[1].formats.some(f => f.col === 8 && f.format === "hh:mm:ss"), true);
assert.equal(context.createMonthlyMis_(state.month, 3, { email: "owner" }).filename, report.filename);
assert.equal(exports, 1); // Repeated request returns the archived XLSX.
context.readMonthlyState_ = () => { throw new Error("Test exporter read operational monthly state"); };
assert.equal(context.createMonthlyMisWithConfig_(state.month, 3, config, state).fileId, report.fileId);
context.monthlyAccess_ = () => { throw new Error("Monthly workflow is not enabled yet."); };
assert.throws(() => context.createMonthlyMis_(state.month, 3, { email: "owner" }), /not enabled/);
context.monthlyAccess_ = () => config;
context.readMonthlyState_ = () => state;
state.revision = 4; failExport = true;
assert.throws(() => context.createMonthlyMis_(state.month, 4, { email: "owner" }), /export failed/);
assert.equal(archived.size, 1);
assert.ok(releases >= 4);
console.log("Monthly MIS validated: two tabs, IST date/time types, cohort formulas, 4 chart definitions, source evidence, immutable exports and failure recovery.");
