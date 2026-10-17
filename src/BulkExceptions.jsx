import React, { useRef, useState } from "react";
import { processExceptionBulk } from "./api";
import { bulkExceptionTemplate, EXCEPTION_BUCKETS, parseExceptionBulkCsv } from "./exception-bulk.mjs";

export default function BulkExceptions({ month, templateRows, onApplied }) {
  const fileRef = useRef(null), generation = useRef(0);
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const reset = () => { generation.current++; setPreview(null); setConfirmed(false); setError(""); setNotice(""); };
  const template = () => {
    const rows = templateRows.slice(0, 1000);
    const url = URL.createObjectURL(new Blob([bulkExceptionTemplate(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `inward-tat-exception-template-${month}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Template contains ${rows.length} pending keys from the current transaction view${templateRows.length > 1000 ? " (first 1,000 only; narrow filters for other keys)" : ""}. Enter exact bucket names or remarks against each Record Key.`);
  };
  const validate = async () => {
    const current = ++generation.current;
    setBusy(true); setError(""); setPreview(null); setConfirmed(false); setNotice("");
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("Choose a three-column CSV file.");
      if (file.size > 2000000) throw new Error("Exception CSV must not exceed 2 MB.");
      const rows = parseExceptionBulkCsv(await file.text());
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
    <h3>Bulk update exceptions</h3>
    <p>Three columns only: <strong>Record Key, Exception Bucket, Remarks</strong>. Select the reporting month above. A CSV cannot hold dropdowns; unknown bucket names are rejected. Blank bucket and remarks together clear an existing exception.</p>
    <details><summary>Allowed buckets</summary><p>{EXCEPTION_BUCKETS.join(" · ")}</p></details>
    <div className="exception-bulk-controls">
      <button type="button" disabled={busy} onClick={template}>Download bulk template</button>
      <label>Bulk exception CSV<input type="file" ref={fileRef} accept=".csv,text/csv" disabled={busy} onChange={reset} /></label>
      <button type="button" disabled={busy} onClick={validate}>{busy ? "Processing…" : "Validate bulk CSV"}</button>
    </div>
    <p>Maximum 1,000 rows / 2 MB per file. Template includes pending keys from all pages of the current table view, up to this limit. Preview validates against the latest Google Sheet; any error prevents all writes.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {preview && !preview.valid && <div role="alert"><strong>No entries saved. Correct these errors and validate again:</strong><ul>{preview.errors.map((row, index) => <li key={index}>Row {row.row} · {row.recordKey || "missing key"}: {row.error}</li>)}</ul></div>}
    {preview?.valid && <div>
      <p>{preview.totalRows} valid rows · {preview.changedRows} changes identified. Showing first 20 rows.</p>
      <div className="exception-table-scroll"><table><thead><tr><th>Record Key</th><th>Exception Bucket</th><th>Remarks</th><th>Result</th></tr></thead><tbody>{preview.updates.slice(0, 20).map(row => <tr key={row.recordKey}><td>{row.recordKey}</td><td>{row.exceptionBucket || "—"}</td><td>{row.exceptionRemarks || "—"}</td><td>{row.exceptionFlag}</td></tr>)}</tbody></table></div>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> I verified the Record Keys and changes, including any entries being cleared.</label>
      <button type="button" disabled={!confirmed || busy} onClick={apply}>Apply bulk changes</button>
    </div>}
  </section>;
}
