import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { EXCEPTION_BUCKETS, BULK_HEADERS } from "../src/exception-bulk.mjs";
import { buildExceptionWorkbook, parseExceptionWorkbook, inspectExceptionWorkbook } from "../src/exception-xlsx.mjs";

const data = await buildExceptionWorkbook([{ recordKey: "OWN|G1|SKU1" }]);
const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(data);
const sheet = workbook.worksheets[0];
assert.equal(workbook.worksheets.length, 1);
assert.deepEqual([1, 2, 3].map(column => sheet.getRow(1).getCell(column).value), BULK_HEADERS);
assert.equal(sheet.getCell("A2").value, "OWN|G1|SKU1");
for (const cell of ["B2", "B501", "B1001"]) {
  const validation = sheet.dataValidations.model[cell] || sheet.dataValidations.model["B2:B1001"];
  assert.equal(validation.type, "list");
  assert.equal(validation.formulae[0], '"' + EXCEPTION_BUCKETS.join(",") + '"');
  assert.equal(validation.showErrorMessage, true);
  assert.equal(validation.errorStyle, "stop");
}
sheet.getCell("B2").value = "WH delay"; sheet.getCell("C2").value = 'Delay, "quoted"\nગુજરાતી';
let parsed = await parseExceptionWorkbook(await workbook.xlsx.writeBuffer());
assert.deepEqual(parsed, [{ recordKey: "OWN|G1|SKU1", exceptionBucket: "WH delay", exceptionRemarks: 'Delay, "quoted"\nગુજરાતી' }]);
sheet.getCell("B2").value = "Invoice issue";
assert.equal((await parseExceptionWorkbook(await workbook.xlsx.writeBuffer()))[0].exceptionBucket, "Invoice issue");
sheet.getCell("B2").value = "Invalid pasted bucket";
assert.equal((await parseExceptionWorkbook(await workbook.xlsx.writeBuffer()))[0].exceptionBucket, "Invalid pasted bucket"); // Server rejects it at preview.
sheet.getCell("B2").value = { formula: '"WH delay"', result: "WH delay" };
await assert.rejects(parseExceptionWorkbook(await workbook.xlsx.writeBuffer()), /formulas/);
sheet.getCell("B2").value = ""; sheet.getCell("C2").value = "";
assert.equal((await parseExceptionWorkbook(await workbook.xlsx.writeBuffer()))[0].exceptionRemarks, "");
sheet.getCell("D2").value = "extra";
await assert.rejects(parseExceptionWorkbook(await workbook.xlsx.writeBuffer()), /three columns/);
sheet.getCell("D2").value = null;
workbook.addWorksheet("Extra");
await assert.rejects(parseExceptionWorkbook(await workbook.xlsx.writeBuffer()), /one worksheet/);
assert.throws(() => inspectExceptionWorkbook(new TextEncoder().encode("not an excel workbook")), /not an unencrypted/);
assert.throws(() => inspectExceptionWorkbook(new Uint8Array(2000001)), /2 MB/);
const zip = await JSZip.loadAsync(data);
zip.file("xl/vbaProject.bin", "macro");
await assert.rejects(parseExceptionWorkbook(await zip.generateAsync({ type: "uint8array" })), /Macro/);
const inflated = data.slice(); const view = new DataView(inflated.buffer);
for (let position = 0; position < inflated.length - 46; position++) {
  if (view.getUint32(position, true) === 0x02014b50) { view.setUint32(position + 24, 20000001, true); break; }
}
assert.throws(() => inspectExceptionWorkbook(inflated), /Expanded/);
const empty = await buildExceptionWorkbook([]);
await assert.rejects(parseExceptionWorkbook(empty), /at least one/);
console.log("Excel exception template validated: all ten dropdown entries through B1001, stop validation, three columns, Unicode roundtrip, both new buckets, blank clearing and workbook safety guards.");
