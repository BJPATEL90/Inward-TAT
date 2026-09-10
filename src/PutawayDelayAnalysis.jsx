import { useEffect, useMemo, useState } from "react";
import { loadPutawayAnalysis } from "./api";
import { analyzePutaway, groupPutaway, levelBand, numeric, dateOffset } from "./putawayAnalysis";

const number = (v, digits = 1) => numeric(v) ? v.toLocaleString("en-IN", { maximumFractionDigits: digits }) : "—";
const hours = (v) => numeric(v) ? `${v.toFixed(2)} h` : "—";
export default function PutawayDelayAnalysis() {
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(true);
  const [from, setFrom] = useState("2026-08-01"), [to, setTo] = useState("2026-08-31");
  const [facility, setFacility] = useState("All facilities"), [view, setView] = useState("summary");
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(null), [limit, setLimit] = useState(100);
  const refresh = async () => {
    setBusy(true); setError("");
    try { setData(await loadPutawayAnalysis()); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { let active = true; loadPutawayAnalysis().then((d) => { if (active) setData(d); }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, []);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const result = useMemo(() => valid ? analyzePutaway(data?.records || [], from, to, facility) : null, [data, from, to, facility, valid]);
  const rows = useMemo(() => (result?.rows || []).filter((r) => `${r.grn} ${r.sku} ${r.reason}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.variance ?? -Infinity) - (a.variance ?? -Infinity)), [result, query]);
  function exportRows() {
    const fields = ["date", "facility", "grn", "sku", "abc", "hours", "pack", "packSource", "boxes", "reachBoxes", "weightedLevel", "highestLevel", "shelfCount", "excludedUnits", "median", "p75", "peerCount", "benchmarkScope", "variance", "reason", "contexts", "issues"];
    const cell = (v) => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob(["\uFEFF" + [fields, ...rows.map((r) => fields.map((f) => r[f]))].map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `putaway-analysis-${from}-${to}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const change = result?.average !== null && result?.previousAverage !== null ? result.average - result.previousAverage : null;
  const signals = useMemo(() => buildDelaySignals(result?.eligible || []), [result]);`r`n  const master = data?.master || {};
  return <div className="delay-page">
    <div className="delay-toolbar">
      <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>Through<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label>Facility<select value={facility} onChange={(e) => setFacility(e.target.value)}><option>All facilities</option>{[...new Set((data?.records || []).map((r) => r.facility))].sort().map((f) => <option key={f}>{f}</option>)}</select></label>
      <button onClick={() => { const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); const monday = dateOffset(today, -((weekday + 6) % 7)); setFrom(dateOffset(monday, -7)); setTo(dateOffset(monday, -1)); }}>Last complete week</button>
      <button disabled={busy} onClick={refresh}>{busy ? "Loading…" : "Refresh analysis"}</button>
      <button disabled={!rows.length} onClick={exportRows}>Export details</button>
    </div>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {!valid && <p role="alert">Choose a valid date range.</p>}
    {busy && !data && <p role="status">Reading SKU classes, shelf allocations and retained KPI records…</p>}
    {data && result && <>
      <p className="delay-note">KPI2 measures continuous elapsed hours, including waiting. Shelf analysis covers R bins 001–014, from Ground to Level 6. Reach truck is required from Level 1. Box figures are equivalent boxes (units ÷ pack size).</p>
      <nav className="delay-tabs" aria-label="Putaway analysis views">{[["summary", "Weekly / period summary"], ["drivers", "Driver comparison"], ["records", "GRN drill-down"]].map(([id, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>)}</nav>
      <div className="delay-cards">
        <Metric title="Average KPI2 · eligible R-bin records" value={hours(result.average)} note={`${result.eligible.length} of ${result.rows.length} records eligible`} />
        <Metric title="Above 7-hour target" value={`${result.aboveTarget} records`} note="Fixed operational target" />
        <Metric title="Above historical P75" value={`${result.aboveP75} records`} note="Only records with a usable benchmark" />
        <Metric title="Change vs previous equal-length period" value={change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)} h`} note={`${result.previousFrom} to ${dateOffset(from, -1)} · ${result.previousCount} eligible records`} />
        <Metric title="Estimated avoidable excess" value={hours(signals.avoidableHours)} note="Top workload signatures · review only" />
      </div>
      <p className="delay-note">Reference: {result.baselineStart} to {result.baselineEnd}. {result.calibration ? "August calibration uses the same month's observations, excluding the reviewed record." : "Up to 90 prior days, starting with available August history."} Matching uses facility, ABC, highest level band and box-volume band when at least 10 peers exist; otherwise facility-only history needs at least 3 peers. All averages count each Facility + GRN + SKU once.</p>
      {view === "summary" && <>
        <section className="delay-panel"><h2>What may explain the time taken?</h2><p>{result.eligible.length ? `${result.aboveTarget} of ${result.eligible.length} eligible records exceeded 7 hours. ${result.aboveP75} also exceeded their historical upper reference.` : "No eligible shelf records are available for this selection."}</p><p>Compare box volume, reach-truck workload and destination shelves below. These are observed workload factors. Equipment waiting, staffing and queue delays need operational evidence before a cause can be confirmed.</p>
          <Comparison rows={groupPutaway(result.eligible, levelBand)} label="Highest destination level" />
        </section>
        <section className="delay-panel"><h2>Facility comparison</h2><Comparison rows={groupPutaway(result.eligible, (r) => r.facility)} label="Facility" /></section>
        <section className="delay-panel"><h2>Root-cause scorecard</h2><p>Prioritises excess hours above the 7-hour target. A record can carry more than one signature, so this is an operational lead—not proof of causation.</p><div className="delay-cause-grid">{signals.rows.map((r) => <div className="delay-cause-row" key={r.key}><div><b>{r.label}</b><small>{r.records} records · {r.action}</small></div><div className="delay-cause-bar"><span style={{ width: `${r.share}%`, background: r.color }} /></div><strong>{hours(r.excess)} · {r.share}%</strong></div>)}</div><div className="delay-action-list"><div><b>Do first:</b> pre-stage upper-level C-class receipts and reserve a reach-truck window for high-box GRNs.</div><div><b>Expected leverage:</b> {hours(signals.focusHours)} across the top two workload signatures.</div></div></section>
        <section className="delay-panel"><h2>Next-shift action queue</h2><div className="delay-action-grid">{signals.rows.slice(0, 3).map((r, i) => <div className="delay-action-card" key={r.key}><span className="delay-rank">{i + 1}</span><div><b>{r.action}</b><small>{r.records} records · {hours(r.excess)} excess hours at stake</small></div><span className={`delay-priority p${i + 1}`}>P{i + 1}</span></div>)}</div></section>
        <section className="delay-panel"><h2>Data coverage</h2><p>{master.rows ?? 0} master rows · {master.uniqueSkus ?? 0} unique SKUs · {master.missingPackRows ?? 0} missing/invalid pack sizes · {master.conflictingPackSkus ?? 0} SKUs with conflicting packs · {master.unclassifiedSkus ?? 0} unclassified SKUs.</p><p>{result.rows.length - result.eligible.length} selected records lack eligible R-bin completion data. {result.eligible.filter((r) => r.boxes === null).length} eligible records lack a usable box count. Non-R quantities remain visible in each record's detail.</p></section>
      </>}
      {view === "drivers" && <div className="delay-comparisons">{[["ABC class", (r) => r.abc], ["Highest destination level", levelBand], ["Box volume", (r) => r.volumeBand], ["Destination shelves", (r) => r.shelfCount === 1 ? "Single shelf" : "Multiple shelves"]].map(([label, key]) => <section className="delay-panel" key={label}><h2>{label}</h2><Comparison rows={groupPutaway(result.eligible, key)} label={label} /></section>)}<p className="delay-note">Box bands use each facility's historical 33rd and 67th percentiles. Comparisons show association; ABC class alone is not a cause of delay.</p></div>}
      {view === "records" && <section className="delay-panel"><h2>GRN + SKU records</h2><input className="delay-search" aria-label="Search GRN or SKU" placeholder="Search GRN, SKU or finding" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(100); }} /><div className="delay-table"><table><thead><tr>{["Date / Facility", "GRN / SKU", "ABC", "KPI2", "R-bin boxes", "Level / shelves", "Median / P75", "Variance", "Finding"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(0, limit).map((r) => <tr key={r.recordKey}><td>{r.date}<small>{r.facility}</small></td><td><button className="delay-link" onClick={() => setSelected(r)}>{r.grn}</button><small>{r.sku}</small></td><td>{r.abc}</td><td>{hours(r.hours)}</td><td>{number(r.boxes)}</td><td>{number(r.weightedLevel, 2)} avg / {r.shelfCount}<small>Max: {r.highestLevel ?? "—"}</small></td><td>{hours(r.median)} / {hours(r.p75)}<small>{r.peerCount} peers · {r.benchmarkScope}</small></td><td>{hours(r.variance)}</td><td>{r.reason}<small>{r.contexts.join(" · ")}</small>{r.issues.length > 0 && <small className="delay-warning">{r.issues.join(" · ")}</small>}</td></tr>)}</tbody></table></div>{!rows.length && <p>No records match this selection.</p>}{rows.length > limit && <button onClick={() => setLimit(limit + 100)}>Show more ({rows.length - limit} remaining)</button>}</section>}
      {selected && <div className="delay-modal-backdrop" onClick={() => setSelected(null)}><section className="delay-modal" role="dialog" aria-modal="true" aria-label="Shelf allocations" onClick={(e) => e.stopPropagation()}><button autoFocus onClick={() => setSelected(null)}>Close</button><h2>{selected.grn} · {selected.sku}</h2><p>{selected.facility} · KPI2 {hours(selected.hours)} · {selected.abc}</p><p>Pack size: {selected.pack ?? "Unavailable"} · {selected.packSource}. Excluded location units: {number(selected.excludedUnits)}. Reach-truck boxes: {number(selected.reachBoxes)}.</p><ComparisonAllocations row={selected} /><p>{selected.issues.join(" · ")}</p></section></div>}
    </>}
  </div>;
}
function Metric({ title, value, note }) { return <div className="delay-metric"><span>{title}</span><strong>{value}</strong><small>{note}</small></div>; }
function Comparison({ rows, label }) { return <div className="delay-table"><table><thead><tr><th>{label}</th><th>Records</th><th>Average KPI2</th><th>Median</th><th>P75</th><th>Above 7h</th><th>R-bin boxes</th></tr></thead><tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.count}</td><td>{hours(r.hours)}</td><td>{hours(r.median)}</td><td>{hours(r.p75)}</td><td>{r.above}</td><td>{number(r.boxes)}</td></tr>)}</tbody></table></div>; }
function buildDelaySignals(rows) {
  const excess = (r) => Math.max(0, numeric(r.hours) ? r.hours - 7 : 0);
  const definitions = [
    { key: "upper", label: "Upper-level reach-truck work", color: "#7357c9", action: "Pre-stage + reserve reach-truck window", test: (r) => r.highestLevel >= 5 && r.reachShare > 0 },
    { key: "volume", label: "Higher box volume", color: "#2f6fed", action: "Batch 120+ box receipts by aisle", test: (r) => r.volumeBand === "Higher volume" },
    { key: "shelves", label: "Multi-shelf travel", color: "#168f9a", action: "Sequence adjacent destination shelves", test: (r) => r.shelfCount >= 4 },
    { key: "exception", label: "Link / scan exception", color: "#d89416", action: "Clear exception queue before KPI close", test: (r) => r.issues?.length > 0 },
  ];
  const total = rows.reduce((n, r) => n + excess(r), 0);
  const scored = definitions.map((d) => ({ ...d, records: rows.filter(d.test).length, excess: rows.filter(d.test).reduce((n, r) => n + excess(r), 0) })).filter((r) => r.records > 0);
  return { rows: scored.map((r) => ({ ...r, share: total ? Math.round((r.excess / total) * 100) : 0 })), avoidableHours: scored.slice(0, 3).reduce((n, r) => n + r.excess, 0), focusHours: scored.slice(0, 2).reduce((n, r) => n + r.excess, 0) };
}
function ComparisonAllocations({ row }) { return <div className="delay-table"><table><thead><tr><th>Shelf</th><th>Level</th><th>Units</th><th>Boxes</th><th>Reach truck</th></tr></thead><tbody>{row.allocations.map((a) => <tr key={a.shelf}><td>{a.shelf}</td><td>{a.level === 0 ? "Ground" : a.level}</td><td>{number(a.units)}</td><td>{number(row.pack ? a.units / row.pack : null)}</td><td>{a.level > 0 ? "Required" : "No"}</td></tr>)}</tbody></table></div>; }
