import React, { useEffect, useRef, useState } from "react";
import { loadMonthlyStatus, refreshMonthlySources, uploadMonthlySource, downloadMonthlyReport } from "./api";
import "./monthly-mis.css";

function previousMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === "year").value);
  const month = Number(parts.find(part => part.type === "month").value);
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`;
}
const duration = value => value == null || value === "" ? "—" : `${Number(value).toFixed(2)} h`;

export default function MonthlyMis() {
  const [month, setMonth] = useState(previousMonth);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reportLink, setReportLink] = useState(null);
  const [type, setType] = useState("GRN");
  const [facility, setFacility] = useState("ALL");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [extracted, setExtracted] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const fileRef = useRef(null);
  const selection = useRef(month);
  useEffect(() => {
    let active = true;
    selection.current = month;
    setData(null); setError(""); setNotice(""); setReportLink(null); setConfirmed(false);
    setFrom(`${month}-01T00:00`);
    const [year, index] = month.split("-").map(Number);
    const end = new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 10);
    setThrough(`${end}T00:00`); setExtracted("");
    if (fileRef.current) fileRef.current.value = "";
    setBusy(true);
    loadMonthlyStatus(month).then(result => { if (active) setData(result); })
      .catch(reason => { if (active) setError(reason.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [month]);

  async function run(operation) {
    const selected = month;
    setBusy(true); setError(""); setNotice(""); setReportLink(null);
    try {
      await operation(selected);
      if (selection.current === selected) setData(await loadMonthlyStatus(selected));
    } catch (reason) { if (selection.current === selected) setError(reason.message); }
    finally { if (selection.current === selected) setBusy(false); }
  }
  async function upload(event) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Select a CSV file."); return; }
    if (file.size > 5000000) { setError("File exceeds 5 MB. Split the report into smaller CSVs."); return; }
    await run(async selected => {
      const result = await uploadMonthlySource(selected, { month: selected, type, facility,
        periodStart: `${from}:00+05:30`, periodEndExclusive: `${through}:00+05:30`, extractedAt: `${extracted}:00+05:30`,
        filename: file.name, content: await file.text() });
      setNotice(result.duplicate ? "This report was already imported." : `Imported revision ${result.revision}. Monthly KPIs recalculated.`);
      if (fileRef.current) fileRef.current.value = "";
      setConfirmed(false);
    });
  }
  async function download() {
    setBusy(true); setError(""); setReportLink(null);
    try {
      const report = await downloadMonthlyReport(month, data.revision);
      const bytes = Uint8Array.from(atob(report.base64), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: report.mimeType }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = report.filename; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setReportLink({ url: `https://drive.google.com/file/d/${report.fileId}/view`, filename: report.filename });
      setNotice(`Downloaded ${report.status.toLowerCase().replaceAll("_", " ")} MIS, revision ${report.revision}.`);
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }
  const summary = data?.summary || {};
  const count = value => data?.revision ? value || 0 : "—";
  return <section className="monthly-mis" aria-busy={busy}>
    <div className="mis-toolbar">
      <label>Reporting month<input type="month" required value={month} disabled={busy} onChange={event => event.target.value && setMonth(event.target.value)} /></label>
      <button disabled={busy || !data} onClick={() => run(async selected => { await refreshMonthlySources(selected); setNotice("Unloading refreshed and stored reports recalculated. Upload missing GRN/Putaway exports below."); })}>Refresh Data</button>
      <button disabled={busy || !data?.revision} onClick={download}>Download Monthly MIS (.xlsx)</button>
    </div>
    {busy && <p role="status">Processing monthly reports…</p>}
    {error && <div className="mis-error" role="alert">{error}<button disabled={busy} onClick={() => run(async () => {})}>Reload month</button></div>}
    {notice && <p className="mis-notice" role="status">{notice}</p>}
    {reportLink && <p><a href={reportLink.url} target="_blank" rel="noreferrer">Open archived MIS</a></p>}
    <div className="mis-status"><strong>{data?.status?.replaceAll("_", " ") || "Monthly reporting"}</strong><span>Revision {data?.revision || 0}</span><span>Last refresh: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "Not refreshed"}</span></div>
    <div className="mis-cards">{[["KPI1: Unloading to Putaway", duration(summary.kpi1Hours)], ["KPI2: GRN to Putaway", duration(summary.kpi2Hours)], ["KPI3: Unloading to GRN", duration(summary.kpi3Hours)], ["Complete / eligible", `${count(summary.completeRecords)} / ${count(summary.eligibleRecords)}`], ["Pending", count(summary.pendingRecords)], ["Source corrections", count(data?.sourceExceptionCount)], ["Boxes unloaded", count(data?.totalBoxes)]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    <p>Monthly figures remain provisional until source coverage and pending closure are reviewed. {summary.excludedRecords || 0} approved OWN SKU records excluded from KPIs. {data?.missingBoxValues || 0} source rows have missing box values.</p>
    <form className="mis-upload" onSubmit={upload}>
      <h2>Upload Missing / Corrected Reports</h2>
      <p>Enter the actual report filter and generation time in IST. “Through” is exclusive. A report received on the 1st does not necessarily cover the previous month.</p>
      <fieldset disabled={busy || !data}>
        <label>Report type<select value={type} onChange={event => { setType(event.target.value); setFacility(event.target.value === "PUTAWAY" ? "SL Mother Hub" : "ALL"); setConfirmed(false); }}><option>GRN</option><option>PUTAWAY</option></select></label>
        <label>Facility<select value={facility} onChange={event => setFacility(event.target.value)}>{(type === "GRN" ? ["ALL", "SL Mother Hub", "SL Ambient", "SL Rx", "OWN", "EXPORT"] : ["SL Mother Hub", "SL Ambient", "SL Rx", "OWN", "EXPORT"]).map(value => <option key={value}>{value}</option>)}</select></label>
        <label>From (IST)<input type="datetime-local" required value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label>Through, exclusive (IST)<input type="datetime-local" required value={through} onChange={event => setThrough(event.target.value)} /></label>
        <label>Export generated at (IST)<input type="datetime-local" required value={extracted} onChange={event => setExtracted(event.target.value)} /></label>
        <label>CSV file<input type="file" ref={fileRef} accept=".csv,text/csv" required /></label>
        <label className="mis-confirm"><input type="checkbox" checked={confirmed} required onChange={event => setConfirmed(event.target.checked)} />I verified the date filter, facility and generation time against this export.</label>
        <button type="submit" disabled={!confirmed}>Upload and Recalculate</button>
      </fieldset>
    </form>
    <MisTable title="Source coverage" headers={["Report", "Facility", "Coverage", "Generated (UTC)", "Accepted rows", "Archive"]} rows={(data?.sources || []).map(source => [source.type, source.facility, source.completeMonthCoverage ? "Full month declared" : "Partial", source.extractedAt, source.acceptedRows, <a href={`https://drive.google.com/file/d/${source.fileId}/view`} target="_blank" rel="noreferrer">Source</a>])} />
    <MisTable title="Daily progress" headers={["Date", "Records", "Complete", "Pending", "KPI1", "KPI2", "KPI3", "Boxes", "Progress"]} rows={(data?.daily || []).map(day => [day.date, day.records, day.completeRecords, day.pendingRecords, duration(day.kpi1Hours), duration(day.kpi2Hours), duration(day.kpi3Hours), day.boxes, day.progress])} />
    <MisTable title="Facility performance" headers={["Facility", "Eligible", "Complete", "Pending", "KPI1", "KPI2", "KPI3"]} rows={(data?.facilities || []).map(row => [row.facility, row.eligibleRecords, row.completeRecords, row.pendingRecords, duration(row.kpi1Hours), duration(row.kpi2Hours), duration(row.kpi3Hours)])} />
    <MisTable title="Pending closure — first 100 items; full list in Excel" headers={["Facility", "GRN", "SKU", "Required correction", "Owner", "Ageing"]} rows={(data?.pending || []).map(row => [row.facility, row.grn, row.sku, row.stage, row.owner, duration(row.ageingHours)])} />
  </section>;
}
function MisTable({ title, headers, rows }) {
  return <section className="mis-table"><h2>{title}</h2><div><table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell ?? "—"}</td>)}</tr>) : <tr><td colSpan={headers.length}>No records available.</td></tr>}</tbody></table></div></section>;
}
