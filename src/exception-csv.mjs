/** Saved business-exception rule shared by the cards, table and export. */
export function isValidBusinessException(row) {
  return !isWarehouseDelay(row) && Number.isFinite(row.kpi1Hours) && row.kpi1Hours > 12 &&
    Boolean(String(row.exceptionBucket || "").trim() || String(row.exceptionRemarks || "").trim());
}

export function isWarehouseDelay(row) {
  return ["wh delay", "wh issue"].includes(String(row.exceptionBucket || "").trim().toLowerCase());
}

export function needsExceptionValidation(row) {
  return Number.isFinite(row.kpi1Hours) && row.kpi1Hours > 12 &&
    !String(row.exceptionBucket || "").trim() && !String(row.exceptionRemarks || "").trim();
}

const istParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export function splitIstTimestamp(value, fallbackDate = "") {
  const text = String(value || "");
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (dateOnly.test(text)) return [text, ""];
  if (!text) return [dateOnly.test(fallbackDate) ? fallbackDate : "", ""];
  // Require an explicit offset: browser/OS timezones must not reinterpret data.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Error("A transaction timestamp has no valid timezone. Refresh the data before exporting.");
  }
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error("A transaction timestamp is invalid. Refresh the data before exporting.");
  const parts = Object.fromEntries(istParts.formatToParts(date).map(part => [part.type, part.value]));
  return [`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}:${parts.second}`];
}

export const EXCEPTION_CSV_HEADERS = Object.freeze([
  "Record Key", "Facility", "GRN Number", "SKU",
  "Unloading Date (IST)", "Unloading Time (IST)",
  "GRN Received Date (IST)", "GRN Received Time (IST)",
  "Putaway Completed Date (IST)", "Putaway Completed Time (IST)",
  "KPI1 Unloading to Putaway Hours", "KPI2 GRN to Putaway Hours", "KPI3 Unloading to GRN Hours",
  "Record Status", "Data Quality Exception Code", "Data Quality Exception Detail",
  "Goods Source Row", "GRN Source Row", "Putaway Source Row", "Calculated Date (IST)", "Calculated Time (IST)",
  "Match Method", "Match Detail", "Manual Action Status", "Manual Action By",
  "Manual Action Date (IST)", "Manual Action Time (IST)", "Manual Action Reason",
  "Exception (Y/N)", "Exception Bucket", "Remarks",
]);

function csvCell(value) {
  let text = value == null ? "" : String(value);
  // Quoting alone does not prevent spreadsheet formula execution.
  if (typeof value === "string" && (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function buildExceptionCsv(rows) {
  const numeric = value => Number.isFinite(value) ? value : "";
  const values = rows.map(row => [
    row.recordKey, row.facility, row.grnNumber, row.sku,
    ...splitIstTimestamp(row.unloadingTimestamp, row.unloadingDate),
    ...splitIstTimestamp(row.grnReceivedTimestamp, row.grnDate),
    ...splitIstTimestamp(row.putawayCompletedTimestamp, row.putawayDate),
    numeric(row.kpi1Hours), numeric(row.kpi2Hours), numeric(row.kpi3Hours), row.status,
    row.exceptionCode, row.exceptionDetail, row.goodsSourceRow, row.grnSourceRow, row.putawaySourceRow,
    ...splitIstTimestamp(row.calculatedAt), row.matchMethod, row.matchDetail, row.manualActionStatus, row.manualActionBy,
    ...splitIstTimestamp(row.manualActionAt), row.manualActionReason,
    isValidBusinessException(row) ? "Y" : "N", row.exceptionBucket, row.exceptionRemarks,
  ]);
  return "\uFEFF" + [EXCEPTION_CSV_HEADERS, ...values].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function exceptionCsvFilename({ month, from, to, facility, scope }) {
  const safe = text => String(text || "all").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80);
  return `inward-tat-exceptions-${safe(month)}-${safe(from)}_to_${safe(to)}-${safe(facility)}-${scope === "ALL" ? "all-filtered" : "delayed"}.csv`;
}
