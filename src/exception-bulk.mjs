export const EXCEPTION_BUCKETS = Object.freeze(["RT availability", "Manpower issue", "PO unavailable for GRN", "MRP issue", "Batch issue", "Short receipt", "Excess receipt", "Other", "WH delay", "Invoice issue"]);
export const BULK_HEADERS = ["Record Key", "Exception Bucket", "Remarks"];

export function parseExceptionBulkCsv(content) {
  if (content.length > 2000000) throw new Error("Exception CSV must be no larger than 2 MB of text.");
  const text = content.replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw new Error("CSV contains binary data.");
  const rows = []; let row = [], cell = "", quoted = false, closed = false;
  const endCell = () => { row.push(cell); cell = ""; closed = false; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += ch;
    } else if (ch === ",") endCell();
    else if (ch === "\r" || ch === "\n") { if (ch === "\r" && text[i + 1] === "\n") i++; endRow(); }
    else if (ch === '"') { if (cell || closed) throw new Error("Malformed CSV quoting."); quoted = true; }
    else { if (closed) throw new Error("Unexpected text after a quoted CSV cell."); if (ch === "\0") throw new Error("CSV contains binary data."); cell += ch; }
  }
  if (quoted) throw new Error("Unclosed quoted CSV cell.");
  if (cell || row.length || closed) endRow();
  if (!rows.length || rows[0].length !== 3 || rows[0].some((value, i) => value.trim() !== BULK_HEADERS[i])) throw new Error("Use exactly these three columns: Record Key, Exception Bucket, Remarks.");
  const data = rows.slice(1).filter(values => values.some(value => value.trim()));
  if (!data.length || data.length > 1000) throw new Error("Upload between 1 and 1,000 exception rows.");
  return data.map((values, index) => {
    if (values.length !== 3) throw new Error(`Data row ${index + 2}: expected three columns.`);
    return { recordKey: values[0].trim(), exceptionBucket: values[1].trim(), exceptionRemarks: values[2].trim() };
  });
}

export function bulkExceptionTemplate(rows) {
  const cell = value => {
    const text = String(value || "");
    return '"' + (/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
  };
  return "\uFEFF" + [BULK_HEADERS, ...rows.map(row => [row.recordKey, row.exceptionBucket, row.exceptionRemarks])].map(values => values.map(cell).join(",")).join("\r\n") + "\r\n";
}
