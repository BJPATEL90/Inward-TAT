import { BULK_HEADERS, EXCEPTION_BUCKETS } from "./exception-bulk.mjs";

async function workbookLibrary() {
  const module = await import("exceljs");
  return module.default || module;
}

/** Reject non-XLSX, encrypted/embedded content and oversized ZIP expansions before loading. */
export function inspectExceptionWorkbook(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > 2000000) throw new Error("Excel exception file must not exceed 2 MB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) throw new Error("This is not an unencrypted .xlsx workbook. Use the downloaded Excel template.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error("Invalid Excel ZIP directory.");
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
  let position = view.getUint32(end + 16, true), expanded = 0;
  if (!count || count > 64 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || position + directorySize > end) throw new Error("Unsupported or oversized workbook archive.");
  const names = [];
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw new Error("Invalid Excel ZIP entry.");
    const nameLength = view.getUint16(position + 28, true), extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (next > end || view.getUint16(position + 8, true) & 1) throw new Error("Encrypted or invalid Excel ZIP entry.");
    const name = new TextDecoder().decode(bytes.slice(position + 46, position + 46 + nameLength));
    if (name.startsWith("/") || name.includes("..") || /vbaProject|externalLinks\/|embeddings\//i.test(name)) throw new Error("Macro, external-link or embedded workbooks are not supported. Paste values into the template.");
    expanded += view.getUint32(position + 24, true);
    if (expanded > 20000000) throw new Error("Expanded Excel workbook is too large. Use the small three-column template.");
    names.push(name); position = next;
  }
  if (!names.includes("xl/workbook.xml")) throw new Error("ZIP file is not an Excel workbook.");
  return bytes;
}

export async function buildExceptionWorkbook(rows) {
  if (rows.length > 1000) throw new Error("Template supports up to 1,000 rows.");
  const ExcelJS = await workbookLibrary(), workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Exceptions", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(BULK_HEADERS);
  for (const row of rows) sheet.addRow([String(row.recordKey || ""), "", ""]);
  sheet.columns = [{ width: 65 }, { width: 29 }, { width: 65 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D3475" } };
  sheet.getColumn(1).numFmt = "@"; sheet.getColumn(2).numFmt = "@"; sheet.getColumn(3).numFmt = "@";
  sheet.autoFilter = "A1:C1";
  sheet.dataValidations.add("B2:B1001", { type: "list", allowBlank: true, formulae: ['"' + EXCEPTION_BUCKETS.join(",") + '"'],
    showInputMessage: true, promptTitle: "Exception bucket", prompt: "Select one of the ten allowed buckets, or leave blank for remarks only.",
    showErrorMessage: true, errorStyle: "stop", errorTitle: "Invalid exception bucket", error: "Choose an available bucket from the dropdown." });
  sheet.getCell("B1").note = "Select a bucket in column B. All ten allowed categories are in the dropdown. Server validation also rejects invalid pasted values.";
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function parseExceptionWorkbook(data) {
  const bytes = inspectExceptionWorkbook(data);
  const ExcelJS = await workbookLibrary(), workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  if (workbook.worksheets.length !== 1) throw new Error("Use a workbook with one worksheet and the three template columns only.");
  const sheet = workbook.worksheets[0];
  if (sheet.rowCount > 1001) throw new Error("Upload between 1 and 1,000 exception rows.");
  const cellText = (cell, rowNumber) => {
    const value = cell.value;
    if (value == null) return "";
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`Excel row ${rowNumber}: formulas, links and other objects are not accepted. Paste values only.`);
    return String(value).trim();
  };
  const headers = [1, 2, 3].map(column => cellText(sheet.getRow(1).getCell(column), 1));
  if (headers.some((value, i) => value !== BULK_HEADERS[i])) throw new Error("Use exactly these three columns: Record Key, Exception Bucket, Remarks.");
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, column) => { if (column > 3 && cellText(cell, rowNumber)) throw new Error(`Excel row ${rowNumber}: only three columns are allowed.`); });
    if (rowNumber === 1) return;
    const values = [1, 2, 3].map(column => cellText(row.getCell(column), rowNumber));
    if (values.some(Boolean)) rows.push({ recordKey: values[0], exceptionBucket: values[1], exceptionRemarks: values[2] });
  });
  if (!rows.length) throw new Error("Enter at least one exception row in the workbook.");
  return rows;
}
