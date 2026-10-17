import React, { useState } from "react";
import { saveException } from "./api";
import { buildExceptionCsv, exceptionCsvFilename, isValidBusinessException as validException, splitIstTimestamp } from "./exception-csv.mjs";
import "./exception-handling.css";

const BUCKETS = ["RT availability", "Manpower issue", "PO unavailable for GRN", "MRP issue", "Batch issue", "Short receipt", "Excess receipt", "Other"];

export default function ExceptionHandling({ rows, labels, fromDate, toDate, setFromDate, setToDate,
  facility, setFacility, facilities, status, setStatus, query, setQuery, selectedMonth, availableMonths,
  onMonthChange, formatMonth, cardComponent, summarize, formatDuration, canManage, onSaved }) {
  const Card = cardComponent;
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [exportScope, setExportScope] = useState("DELAYED");
  const [exportError, setExportError] = useState("");
  const [transactionView, setTransactionView] = useState("INCLUDING");
  const adjusted = rows.filter(row => !validException(row));
  const delayed = rows.filter(row => Number.isFinite(row.kpi1Hours) && row.kpi1Hours > 12);
  const inclusiveSummary = summarize(rows);
  const adjustedSummary = summarize(adjusted);
  const excluded = rows.length - adjusted.length;
  const pendingValidation = delayed.filter(row => !validException(row)).length;
  const excludedKpiTransactions = inclusiveSummary.completeRecords - adjustedSummary.completeRecords;
  const transactionRows = rows.filter(row => transactionView === "INCLUDING" || (transactionView === "EXCLUDING" ? !validException(row) : validException(row)));
  const tableDelayed = transactionRows.filter(row => Number.isFinite(row.kpi1Hours) && row.kpi1Hours > 12);
  const pages = Math.max(1, Math.ceil(tableDelayed.length / 50));
  const currentPage = Math.min(page, pages);
  const visible = tableDelayed.slice((currentPage - 1) * 50, currentPage * 50);
  const setFilter = setter => event => { setter(event.target.value); setPage(1); };
  const exportRows = exportScope === "ALL" ? transactionRows : tableDelayed;
  const downloadCsv = () => {
    setExportError("");
    try {
      const csv = buildExceptionCsv(exportRows);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exceptionCsvFilename({ month: selectedMonth, from: fromDate, to: toDate, facility, scope: exportScope }).replace(/\.csv$/, `-${transactionView.toLowerCase()}.csv`);
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Downloaded ${exportRows.length} saved transactions. Dates and times are in separate IST columns; unsaved edits are not exported.`);
    } catch (failure) { setExportError(failure.message || "Unable to create the CSV download."); }
  };
  return <div className="page-content exception-page">
    <section className="month-view-toolbar" aria-label="Exception reporting month">
      <div><span className="section-eyebrow">Business exceptions</span><h2>Including and excluding exceptions</h2>
        <p>Same complete-transaction averages and current filters. Unsaved entries do not affect either card.</p></div>
      <label><span>Performance month</span><select aria-label="Performance month" value={selectedMonth} onChange={event => onMonthChange(event.target.value)}>
        {availableMonths.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}
      </select></label>
    </section>
    <section className="detail-filters exception-filters" aria-label="Exception filters">
      <label><span>Search transactions</span><input value={query} onChange={setFilter(setQuery)} placeholder="GRN, SKU, facility or quality code" /></label>
      <label><span>From</span><input type="date" value={fromDate} max={toDate || undefined} onChange={setFilter(setFromDate)} /></label>
      <label><span>To</span><input type="date" value={toDate} min={fromDate || undefined} onChange={setFilter(setToDate)} /></label>
      <label><span>Facility</span><select aria-label="Facility" value={facility} onChange={setFilter(setFacility)}>{facilities.map(value => <option key={value}>{value}</option>)}</select></label>
      <label><span>Status</span><select aria-label="Status" value={status} onChange={setFilter(setStatus)}><option>All status</option><option>COMPLETE</option><option>INCOMPLETE</option><option>MANUALLY_CLOSED</option></select></label>
    </section>
    <section className="exception-card-grid" aria-label="Exception KPI comparison">
      <div data-testid="including-exceptions"><Card title="Including exceptions" data={inclusiveSummary} labels={labels} dates={`${fromDate} to ${toDate}`} tone="blue" />
        <p><strong>KPI transaction count: {inclusiveSummary.completeRecords}</strong> · {rows.length} filtered transactions. Existing eligibility rules apply.</p></div>
      <div data-testid="excluding-exceptions"><Card title="Excluding exceptions" data={adjustedSummary} labels={labels} dates={`${fromDate} to ${toDate}`} tone="blue" />
        <p><strong>KPI transaction count: {adjustedSummary.completeRecords}</strong> · {adjusted.length} remaining transactions. {excluded} valid exception{excluded === 1 ? "" : "s"} excluded; {excludedKpiTransactions} removed from the KPI averages.</p></div>
    </section>
    <dl className="exception-validation-counts" aria-label="Exception validation counts">
      <div data-testid="delayed-count"><dt>Transactions &gt; 12 hours</dt><dd>{delayed.length}</dd></div>
      <div data-testid="validated-count"><dt>Saved exceptions · Y</dt><dd>{excluded}</dd></div>
      <div data-testid="pending-validation-count"><dt>Pending exception validation · N</dt><dd>{pendingValidation}</dd></div>
    </dl>
    <section className="exception-guidance">
      <p><strong>Exception = Y:</strong> KPI1 is greater than 12 hours and a saved bucket or non-blank remark exists. With both blank, the transaction remains included in both cards. Existing data-quality codes are not business exceptions.</p>
      <p>After Save, Y transactions are excluded from all three adjusted KPI averages, but stay in this table for review and editing. Pending validation means &gt;12-hour transactions without a saved exception, not pending GRN/Putaway tasks. Counts cover all pages under the active filters.</p>
      <p>The transaction-view filter below applies to the table and CSV. The two KPI cards and validation counts keep the shared date/facility/status/search scope for comparison.</p>
      {!canManage && <p role="status">Read-only access. Exception edits require existing pending-task management permission.</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="exception-transactions" aria-label="Delayed transactions">
      <div className="exception-table-heading"><h3>Transactions with KPI1 &gt; 12 hours</h3><span>{tableDelayed.length} matching transactions</span></div>
      <div className="exception-export">
        <label><span>Transaction view · table &amp; CSV</span><select aria-label="Transaction view" value={transactionView} onChange={setFilter(setTransactionView)}>
          <option value="INCLUDING">Including exceptions · all transactions</option>
          <option value="EXCLUDING">Excluding exceptions · N only</option>
          <option value="ONLY">Exceptions only · Y only</option>
        </select></label>
        <label><span>CSV scope</span><select aria-label="CSV scope" value={exportScope} onChange={event => setExportScope(event.target.value)}>
          <option value="DELAYED">Delayed transactions · all table pages</option><option value="ALL">All filtered transactions · KPI source</option>
        </select></label>
        <button type="button" className="download-button" disabled={!exportRows.length} onClick={downloadCsv}>Download CSV</button>
        <p>{exportRows.length} saved transactions · Active filters apply · Separate IST date/time columns</p>
        {exportError && <p role="alert">{exportError}</p>}
      </div>
      <div className="exception-table-scroll" tabIndex={0} role="region" aria-label="Scrollable exception transaction table">
        <table><thead><tr><th className="exception-compact-column" scope="col">Transaction date<small>Unloading</small></th><th className="exception-compact-column" scope="col">Time<small>IST</small></th><th scope="col">Facility / GRN / SKU</th><th scope="col">Status</th><th scope="col">KPI1</th><th scope="col">KPI2</th><th scope="col">KPI3</th><th scope="col">Exception (Y/N)</th><th scope="col">Exception Bucket</th><th scope="col">Remarks</th><th scope="col">Action</th></tr></thead>
          <tbody>{visible.map(row => <ExceptionRow key={row.recordKey} row={row} canManage={canManage} formatDuration={formatDuration}
            onSaved={result => { onSaved(result); setNotice(`Saved ${row.facility} / ${row.grnNumber} / ${row.sku}. ${result.exceptionFlag === "Y" ? "Exception = Y: excluded from the adjusted KPI dataset; including-exceptions KPIs are unchanged." : "Exception = N: included in the adjusted dataset under the existing eligibility rules."}`); }} />)}
            {!visible.length && <tr><td colSpan={11}>No transactions with KPI1 greater than 12 hours match these filters. Change the date or facility filter to review another group.</td></tr>}
          </tbody></table>
      </div>
      <div className="exception-pagination"><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span>Page {currentPage} of {pages} · up to 50 rows per page</span><button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>
    </section>
  </div>;
}

function ExceptionRow({ row, canManage, formatDuration, onSaved }) {
  const savedValues = () => ({ bucket: row.exceptionBucket || "", remarks: row.exceptionRemarks || "",
    expectedBucket: row.exceptionBucket || "", expectedRemarks: row.exceptionRemarks || "" });
  const [draft, setDraft] = useState(savedValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = draft.bucket !== draft.expectedBucket || draft.remarks !== draft.expectedRemarks;
  const stale = draft.expectedBucket !== (row.exceptionBucket || "") || draft.expectedRemarks !== (row.exceptionRemarks || "");
  const identity = `${row.facility} / ${row.grnNumber} / ${row.sku}`;
  let transactionDate = row.unloadingDate || "", transactionTime = "";
  try { [transactionDate, transactionTime] = splitIstTimestamp(row.unloadingTimestamp, row.unloadingDate); }
  catch { /* Keep the known cohort date if a source timestamp is malformed. */ }
  const endpoint = (timestamp, fallback) => {
    try { return splitIstTimestamp(timestamp, fallback); }
    catch { return [fallback || "", ""]; }
  };
  const [grnDate, grnTime] = endpoint(row.grnReceivedTimestamp, row.grnDate);
  const [putawayDate, putawayTime] = endpoint(row.putawayCompletedTimestamp, row.putawayDate);
  const save = async () => {
    setSaving(true); setError("");
    try {
      const result = await saveException({ recordKey: row.recordKey, exceptionBucket: draft.bucket, exceptionRemarks: draft.remarks,
        expectedBucket: draft.expectedBucket, expectedRemarks: draft.expectedRemarks });
      setDraft({ bucket: result.exceptionBucket, remarks: result.exceptionRemarks, expectedBucket: result.exceptionBucket, expectedRemarks: result.exceptionRemarks });
      onSaved(result);
    } catch (failure) { setError(failure.message || "Unable to save. Refresh and retry."); }
    finally { setSaving(false); }
  };
  return <tr>
    <td className="exception-compact-column"><time dateTime={transactionDate}>{displayEndpointDate(transactionDate)}</time></td>
    <td className="exception-compact-column">{transactionTime || "—"}</td>
    <th scope="row"><span>{row.facility}</span><strong>{row.grnNumber}</strong><span>{row.sku}</span></th>
    <td>{row.status}</td>
    <KpiDateCell kpi="1" hours={row.kpi1Hours} formatDuration={formatDuration} startLabel="Unloading" startDate={transactionDate} startTime={transactionTime} endLabel="Putaway" endDate={putawayDate} endTime={putawayTime} />
    <KpiDateCell kpi="2" hours={row.kpi2Hours} formatDuration={formatDuration} startLabel="GRN" startDate={grnDate} startTime={grnTime} endLabel="Putaway" endDate={putawayDate} endTime={putawayTime} />
    <KpiDateCell kpi="3" hours={row.kpi3Hours} formatDuration={formatDuration} startLabel="Unloading" startDate={transactionDate} startTime={transactionTime} endLabel="GRN" endDate={grnDate} endTime={grnTime} />
    <td><strong>{validException(row) ? "Y" : "N"}</strong><small>{validException(row) ? "Excluded from adjusted KPIs" : "Pending exception validation"}</small>{dirty && <small>Unsaved changes</small>}</td>
    <td><select aria-label={`Exception bucket for ${identity}`} value={draft.bucket} disabled={!canManage || saving} onChange={event => setDraft({ ...draft, bucket: event.target.value })}>
      <option value="">No bucket</option>{BUCKETS.map(bucket => <option key={bucket}>{bucket}</option>)}</select></td>
    <td><textarea aria-label={`Remarks for ${identity}`} value={draft.remarks} maxLength={2000} rows={3} disabled={!canManage || saving}
      onChange={event => setDraft({ ...draft, remarks: event.target.value })} /></td>
    <td><button type="button" disabled={!canManage || saving || !dirty || stale} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      {canManage && (dirty || stale) && <button type="button" disabled={saving} onClick={() => { setDraft(savedValues()); setError(""); }}>Reset to saved</button>}
      {stale && <small role="alert">Saved values changed. Reset to saved before editing again.</small>}
      {error && <small role="alert">{error}</small>}
    </td>
  </tr>;
}

function displayEndpointDate(date) {
  return date ? date.split("-").reverse().join("-") : "—";
}

function KpiDateCell({ kpi, hours, formatDuration, startLabel, startDate, startTime, endLabel, endDate, endTime }) {
  return <td className="exception-kpi-cell" data-kpi={kpi}>
    <strong>{formatDuration(hours)}</strong>
    <div className="exception-kpi-dates"><small>{startLabel}: {displayEndpointDate(startDate)}<span className="exception-endpoint-time">{startTime ? `${startTime} IST` : "Time: —"}</span></small><small>{endLabel}: {displayEndpointDate(endDate)}<span className="exception-endpoint-time">{endTime ? `${endTime} IST` : "Time: —"}</span></small></div>
  </td>;
}
