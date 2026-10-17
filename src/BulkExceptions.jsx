import React, { useRef, useState } from "react";
import { processExceptionBulk } from "./api";
import { bulkExceptionTemplate, EXCEPTION_BUCKETS, parseExceptionBulkCsv } from "./exception-bulk.mjs";
import { buildExceptionWorkbook, parseExceptionWorkbook } from "./exception-xlsx.mjs";

export default function BulkExceptions({ month, templateRows, onApplied }) {
  const fileRef = useRef(null), generation = useRef(0);
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const reset = () => { generation.current++; setPreview(null); setConfirmed(false); setError(""); setNotice(""); };
  const template = async (excel) => {
    setBusy(true); setError("");
    try {
    const rows = templateRows.slice(0, 1000);
    const contents = excel ? await buildExceptionWorkbook(rows) : bulkExceptionTemplate(rows);
    const url = URL.createObjectURL(new Blob([contents], { type: excel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `inward-tat-exception-template-${month}.${excel ? "xlsx" : "csv"}`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Template contains ${rows.length} pending keys from the current transaction view${templateRows.length > 1000 ? " (first 1,000 only; narrow filters for other keys)" : ""}. ${excel ? "Column B has a dropdown with all ten buckets for rows 2–1001." : "CSV has no dropdown; enter exact bucket names."}`);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  const validate = async () => {
    const current = ++generation.current;
    setBusy(true); setError(""); setPreview(null); setConfirmed(false); setNotice("");
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("Choose a three-column Excel (.xlsx) or CSV file.");
      if (file.size > 2000000) throw new Error("Exception file must not exceed 2 MB.");
      let rows;
      if (/\.xlsx$/i.test(file.name)) rows = await parseExceptionWorkbook(await file.arrayBuffer());
      else if (/\.csv$/i.test(file.name)) rows = parseExceptionBulkCsv(await file.text());
      else throw new Error("Only .xlsx and .csv exception files are supported.");
      const result = await processExceptionBulk(month, rows);
      if (current === generation.current) setPreview(result);
    } catch (failure) { if (current === generation.current) setError(failure.message); }
    finally { if (current === generation.current) setBusy(false); }
  };
  const apply = async () => {
    setBusy(true); setError("");
    try {
      const result = await processExceptionBulk(month, preview.updates, true);
      setPreview(result); setConfirmed(false);
      if (result.valid) { onApplied(result.updates); setNotice(`Bulk update complete: ${result.appliedRows} changed, ${result.totalRows - result.appliedRows} unchanged. KPI cards and review counts now reflect saved values.`); }
    } catch (failure) { setError(failure.message); setConfirmed(false); }
    finally { setBusy(false); }
  };
  return <section className="exception-bulk" aria-label="Bulk exception upload" aria-busy={busy}>
    <div className="exception-bulk-main">
    <h3>Bulk update exceptions</h3>
    <p><strong>Record Key · Exception Bucket · Remarks</strong><br />Excel includes a bucket dropdown. Invalid bucket names are rejected. WH delay is automatically N.</p>
    <div className="exception-bulk-controls">
      <button type="button" disabled={busy} onClick={() => template(true)}>Download Excel template</button>
      <button type="button" disabled={busy} onClick={() => template(false)}>Download CSV template</button>
      <label>Bulk exception file<input type="file" ref={fileRef} accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" disabled={busy} onChange={reset} /></label>
      <button type="button" disabled={busy} onClick={validate}>{busy ? "Processing…" : "Validate bulk file"}</button>
    </div>
    <p>1,000 rows / 2 MB · Template: unreviewed keys across all table pages. Validate before applying; any error prevents all writes.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {preview && !preview.valid && <div role="alert"><strong>No entries saved. Correct these errors and validate again:</strong><ul>{preview.errors.map((row, index) => <li key={index}>Row {row.row} · {row.recordKey || "missing key"}: {row.error}</li>)}</ul></div>}
    {preview?.valid && <div>
      <p>{preview.totalRows} valid rows · {preview.changedRows} changes identified. Showing first 20 rows.</p>
      <div className="exception-table-scroll"><table><thead><tr><th>Record Key</th><th>Exception Bucket</th><th>Remarks</th><th>Result</th></tr></thead><tbody>{preview.updates.slice(0, 20).map(row => <tr key={row.recordKey}><td>{row.recordKey}</td><td>{row.exceptionBucket || "—"}</td><td>{row.exceptionRemarks || "—"}</td><td>{row.exceptionFlag}</td></tr>)}</tbody></table></div>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> I verified the Record Keys and changes, including any entries being cleared.</label>
      <button type="button" disabled={!confirmed || busy} onClick={apply}>Apply bulk changes</button>
    </div>}
    </div>
    <aside className="exception-bucket-list" aria-label="Available buckets"><h4>Available buckets</h4><ul>{EXCEPTION_BUCKETS.map(bucket => <li key={bucket}>{bucket}</li>)}</ul></aside>
  </section>;
}
