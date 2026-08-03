import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  TableProperties,
  X,
} from "lucide-react";
import { hasLiveApi, loadDashboard } from "./api";
import {
  clearSession,
  getAuthConfig,
  getStoredSession,
  loadGoogleIdentity,
  storeSession,
  verifyGoogleCredential,
} from "./auth";

const FACILITIES = ["All facilities", "SL Ambient", "SL Mother Hub", "SL Rx"];

function App() {
  const [session, setSession] = useState(null);
  const [authState, setAuthState] = useState("checking");
  const handleAuthenticated = useCallback((verified) => {
    storeSession(verified);
    setSession(verified);
    setAuthState("signed-in");
  }, []);

  useEffect(() => {
    const stored = getStoredSession();
    if (!stored?.credential) {
      setAuthState("signed-out");
      return;
    }
    verifyGoogleCredential(stored.credential)
      .then((verified) => {
        storeSession(verified);
        setSession(verified);
        setAuthState("signed-in");
      })
      .catch(() => {
        clearSession();
        setAuthState("signed-out");
      });
  }, []);

  if (authState === "checking") return <LoadingScreen />;
  if (authState !== "signed-in") {
    return (
      <GoogleLoginScreen onAuthenticated={handleAuthenticated} />
    );
  }

  return (
    <DashboardApp
      authUser={session.user}
      onSignOut={() => {
        clearSession();
        window.google?.accounts?.id?.disableAutoSelect();
        setSession(null);
        setAuthState("signed-out");
      }}
    />
  );
}

function GoogleLoginScreen({ onAuthenticated }) {
  const buttonRef = useRef(null);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState("Mosaic Wellness");

  useEffect(() => {
    let active = true;
    Promise.all([getAuthConfig(), loadGoogleIdentity()])
      .then(([config]) => {
        if (!active || !buttonRef.current) return;
        setDomain(config.domain);
        window.google.accounts.id.initialize({
          client_id: config.clientId,
          hd: config.domain,
          callback: async ({ credential }) => {
            setError("");
            try {
              onAuthenticated(await verifyGoogleCredential(credential));
            } catch (loginError) {
              setError(loginError.message || "Google sign-in failed");
            }
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text: "signin_with",
          width: 320,
        });
      })
      .catch((loginError) => {
        if (active) setError(loginError.message || "Google sign-in is unavailable");
      });
    return () => {
      active = false;
    };
  }, [onAuthenticated]);

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand-mark">IT</div>
        <span className="login-eyebrow">Mosaic Wellness</span>
        <h1>Inward TAT</h1>
        <p>Sign in with your Mosaic Wellness Google account to access vehicle arrival and putaway performance.</p>
        <div ref={buttonRef} className="google-signin-button" />
        {error && <div className="login-error"><AlertCircle size={17} />{error}</div>}
        <small>Access restricted to @{domain}</small>
      </section>
    </main>
  );
}

function DashboardApp({ authUser, onSignOut }) {
  const [snapshot, setSnapshot] = useState(null);
  const [source, setSource] = useState("loading");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [facility, setFacility] = useState("All facilities");
  const [status, setStatus] = useState("All status");
  const [query, setQuery] = useState("");

  const hydrate = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const result = await loadDashboard({ refresh });
      setSnapshot(result.data);
      setSource(result.source);
    } catch (loadError) {
      setError(loadError.message || "Unable to load dashboard data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    hydrate(false);
  }, []);

  const availableDates = useMemo(
    () =>
      (snapshot?.facts || [])
        .map((row) => row.unloadingDate)
        .filter(Boolean)
        .sort(),
    [snapshot],
  );
  const defaultFrom = availableDates[0] || monthStartIso(snapshot?.generatedAt);
  const defaultTo =
    [...(snapshot?.daily || [])]
      .filter((row) => row.facility === "All Mother Facilities" && row.kpi1Hours != null)
      .map((row) => row.summaryDate)
      .sort()
      .at(-1) ||
    availableDates.at(-1) ||
    yesterdayIso(snapshot?.generatedAt);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (snapshot && !fromDate) setFromDate(defaultFrom);
    if (snapshot && !toDate) setToDate(defaultTo);
  }, [snapshot, defaultFrom, defaultTo, fromDate, toDate]);

  const filteredFacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (snapshot?.facts || []).filter((row) => {
      const dateMatch =
        (!fromDate || row.unloadingDate >= fromDate) &&
        (!toDate || row.unloadingDate <= toDate);
      const facilityMatch = facility === "All facilities" || row.facility === facility;
      const statusMatch = status === "All status" || row.status === status;
      const queryMatch =
        !normalizedQuery ||
        [row.grnNumber, row.sku, row.facility, row.status, row.exceptionCode]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      return dateMatch && facilityMatch && statusMatch && queryMatch;
    });
  }, [snapshot, fromDate, toDate, facility, status, query]);

  const selectedSummary = useMemo(() => {
    const isFullPreviewRange =
      source === "preview" &&
      facility === "All facilities" &&
      status === "All status" &&
      !query.trim() &&
      fromDate === defaultFrom &&
      toDate === defaultTo;
    return isFullPreviewRange
      ? snapshot?.summary?.mtd || summarizeFacts(filteredFacts)
      : summarizeFacts(filteredFacts);
  }, [filteredFacts, source, facility, status, query, fromDate, toDate, defaultFrom, defaultTo, snapshot]);

  const exportCsv = () => {
    const rowsToExport = page === "details" ? filteredFacts : snapshot?.facts || [];
    const headers = [
      "Facility",
      "GRN Number",
      "SKU",
      "Unloading Timestamp",
      "GRN Received Timestamp",
      "Putaway Completed Timestamp",
      "KPI1 Unloading to Putaway",
      "KPI2 GRN to Putaway",
      "KPI3 Unloading to GRN",
      "Status",
      "Exception",
    ];
    const rows = rowsToExport.map((row) => [
      row.facility,
      row.grnNumber,
      row.sku,
      row.unloadingTimestamp,
      row.grnReceivedTimestamp,
      row.putawayCompletedTimestamp,
      formatDuration(row.kpi1Hours),
      formatDuration(row.kpi2Hours),
      formatDuration(row.kpi3Hours),
      row.status,
      row.exceptionCode,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inward-tat-${page === "details" ? "filtered" : "mtd"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !snapshot) {
    return <LoadingScreen />;
  }

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />
      )}
      <Sidebar
        page={page}
        setPage={(nextPage) => {
          setPage(nextPage);
          setSidebarOpen(false);
        }}
        open={sidebarOpen}
      />
      <main className="main-area">
        <TopBar
          page={page}
          openMenu={() => setSidebarOpen(true)}
          exportCsv={exportCsv}
          refresh={() => hydrate(true)}
          refreshing={refreshing}
          lastRefresh={snapshot?.lastRefresh}
          source={source}
          authUser={authUser}
          onSignOut={onSignOut}
        />
        {error && (
          <div className="error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button onClick={() => hydrate(false)}>Try again</button>
          </div>
        )}
        {page === "dashboard" ? (
          <Dashboard
            snapshot={snapshot}
            fromDate={fromDate}
            toDate={toDate}
            setFromDate={setFromDate}
            setToDate={setToDate}
            facility={facility}
            setFacility={setFacility}
            selectedSummary={selectedSummary}
            openDetails={() => setPage("details")}
          />
        ) : (
          <Details
            rows={filteredFacts}
            fromDate={fromDate}
            toDate={toDate}
            setFromDate={setFromDate}
            setToDate={setToDate}
            facility={facility}
            setFacility={setFacility}
            status={status}
            setStatus={setStatus}
            query={query}
            setQuery={setQuery}
          />
        )}
      </main>
    </div>
  );
}

function Sidebar({ page, setPage, open }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "details", label: "Detailed Records", icon: TableProperties },
  ];
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand-block">
        <div className="brand-mark">IT</div>
        <div>
          <strong>Inward TAT</strong>
          <span>Mosaic Wellness</span>
        </div>
      </div>
      <nav>
        <p>Workspace</p>
        {items.map((item) => (
          <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>
            {React.createElement(item.icon, { size: 19 })}
            <span>{item.label}</span>
            {page === item.id && <ChevronRight size={16} />}
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <Database size={18} />
        <div>
          <strong>Automated pipeline</strong>
          <span>Google Sheets + Apps Script</span>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ page, openMenu, exportCsv, refresh, refreshing, lastRefresh, source, authUser, onSignOut }) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="menu-button" onClick={openMenu} aria-label="Open navigation">
          <Menu size={21} />
        </button>
        <div>
          <h1>{page === "dashboard" ? "Vehicle Arrival to Putaway TAT" : "Detailed TAT Records"}</h1>
          <p>{page === "dashboard" ? "Mother-facility inbound performance" : "Facility + GRN + SKU level review"}</p>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="refresh-meta">
          <span className={source === "live" ? "live-dot" : "preview-dot"} />
          <div>
            <small>{source === "live" ? "Live data" : hasLiveApi() ? "Connecting" : "Preview data"}</small>
            <strong>Updated {formatDateTime(lastRefresh)}</strong>
          </div>
        </div>
        <button className={`icon-action ${refreshing ? "spinning" : ""}`} onClick={refresh} aria-label="Refresh data">
          <RefreshCw size={18} />
        </button>
        <button className="download-button" onClick={exportCsv}>
          <Download size={17} />
          <span>Download CSV</span>
        </button>
        <button className="user-action" onClick={onSignOut} title={`Sign out ${authUser?.email || ""}`}>
          <span>{(authUser?.name || authUser?.email || "User").slice(0, 1).toUpperCase()}</span>
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

function Dashboard({
  snapshot,
  fromDate,
  toDate,
  setFromDate,
  setToDate,
  facility,
  setFacility,
  selectedSummary,
  openDetails,
}) {
  const labels = snapshot?.labels || {};
  const mtd = snapshot?.summary?.mtd || {};
  const yesterday = snapshot?.summary?.yesterday || {};
  const yesterdayDate = yesterdayIso(snapshot?.generatedAt);
  const yesterdayFacts = (snapshot?.facts || []).filter(
    (row) => row.unloadingDate === yesterdayDate,
  );
  const pendingYesterday = yesterdayFacts.filter(
    (row) => row.kpi1Hours == null || row.kpi2Hours == null || row.kpi3Hours == null,
  );
  const showYesterdayPending =
    pendingYesterday.length > 0 &&
    yesterday.kpi1Hours == null &&
    yesterday.kpi2Hours == null &&
    yesterday.kpi3Hours == null;
  const staticPeriods = snapshot?.staticPeriods || {};
  const periodCards = [
    { title: "Last Quarter", data: staticPeriods.lastQuarter, dates: previousQuarterRange(snapshot?.generatedAt), tone: "green" },
    { title: "Last Month", data: staticPeriods.lastMonth, dates: previousMonthRange(snapshot?.generatedAt), tone: "amber" },
    { title: "Month to Date", data: mtd, dates: `${monthStartIso(snapshot?.generatedAt)} to ${latestCompleteDate(snapshot)}`, tone: "green" },
    { title: "Yesterday", data: yesterday, dates: yesterdayIso(snapshot?.generatedAt), tone: yesterday.kpi1Hours == null ? "red" : "blue" },
  ];

  return (
    <div className="page-content">
      <section className="executive-ribbon">
        <div className="ribbon-heading">
          <span>Executive KPI</span>
          <h2>Vehicle Arrival to Putaway TAT</h2>
          <p>Continuous elapsed time · Simple average · Hours and minutes with decimal hours below</p>
        </div>
        <div className="period-grid">
          {periodCards.map((card) => (
            <PeriodCard key={card.title} {...card} labels={labels} />
          ))}
        </div>
      </section>

      {showYesterdayPending && (
        <section className="data-pending-banner" role="status">
          <div className="pending-banner-icon"><Clock3 size={22} /></div>
          <div className="pending-banner-copy">
            <strong>Yesterday data entry pending</strong>
            <span>
              {pendingYesterday.length} unloading {pendingYesterday.length === 1 ? "record is" : "records are"} awaiting GRN and putaway data for {formatShortDate(yesterdayDate)}.
              KPI values will update after the next pipeline refresh.
            </span>
          </div>
          <div className="pending-count">
            <strong>{pendingYesterday.length}</strong>
            <span>records pending</span>
          </div>
        </section>
      )}

      <section className="filter-panel">
        <div>
          <span className="section-eyebrow">Date analysis</span>
          <h3>Selected range</h3>
        </div>
        <label>
          <span>From</span>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
        <label>
          <span>Facility</span>
          <select value={facility} onChange={(event) => setFacility(event.target.value)}>
            {FACILITIES.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <div className="range-records">
          <strong>{selectedSummary.records || 0}</strong>
          <span>unique records</span>
        </div>
      </section>

      <section className="range-kpis">
        <MiniKpi kpi="KPI1" label={labels.kpi1 || "Unloading to Putaway"} value={selectedSummary.kpi1Hours} note="Calculated for selected range" primary />
        <MiniKpi kpi="KPI2" label={labels.kpi2 || "GRN to Putaway"} value={selectedSummary.kpi2Hours} note="Calculated for selected range" />
        <MiniKpi kpi="KPI3" label={labels.kpi3 || "Unloading to GRN"} value={selectedSummary.kpi3Hours} note="Calculated for selected range" />
        <article className="completion-card">
          <div className="completion-icon"><CheckCircle2 size={23} /></div>
          <div>
            <span>Complete records</span>
            <strong>{selectedSummary.completeRecords || 0}</strong>
            <small>{percentage(selectedSummary.completeRecords, selectedSummary.records)} of selected records</small>
          </div>
        </article>
      </section>

      <section className="dashboard-grid">
        <TrendPanel daily={snapshot?.daily || []} />
        <FacilityPanel facilities={snapshot?.summary?.facilities || []} />
      </section>

      <section className="detail-callout">
        <div>
          <span className="section-eyebrow">Audit-ready detail</span>
          <h3>Review the Facility + GRN + SKU bridge</h3>
          <p>Inspect timestamps, individual TATs, completion status, and data exceptions.</p>
        </div>
        <button onClick={openDetails}>Open detailed records <ChevronRight size={17} /></button>
      </section>
    </div>
  );
}

function PeriodCard({ title, data = {}, dates, tone, labels }) {
  return (
    <article className={`period-card tone-${tone}`}>
      <span className="period-title">{title}</span>
      <strong className="primary-duration">{formatDurationWords(data.kpi1Hours)}</strong>
      <em className="decimal-duration">{formatDecimalHours(data.kpi1Hours)}</em>
      <small><b>KPI1</b> · {labels.kpi1 || "Unloading to Putaway"}</small>
      <div className="sub-kpis">
        <div>
          <span><b>KPI2</b> · {labels.kpi2 || "GRN to Putaway"}</span>
          <strong>{formatDurationWords(data.kpi2Hours)}</strong>
          <em className="decimal-duration">{formatDecimalHours(data.kpi2Hours)}</em>
        </div>
        <div>
          <span><b>KPI3</b> · {labels.kpi3 || "Unloading to GRN"}</span>
          <strong>{formatDurationWords(data.kpi3Hours)}</strong>
          <em className="decimal-duration">{formatDecimalHours(data.kpi3Hours)}</em>
        </div>
      </div>
      <footer>
        <span>{dates}</span>
        <i />
      </footer>
    </article>
  );
}

function MiniKpi({ kpi, label, value, note, primary = false }) {
  return (
    <article className={`mini-kpi ${primary ? "primary" : ""}`}>
      <span><b>{kpi}</b> · {label}</span>
      <strong>{formatDurationWords(value)}</strong>
      <em className="decimal-duration">{formatDecimalHours(value)}</em>
      <small>{note}</small>
    </article>
  );
}

function TrendPanel({ daily }) {
  const rows = daily
    .filter((row) => row.facility === "All Mother Facilities" && row.kpi1Hours != null)
    .sort((a, b) => a.summaryDate.localeCompare(b.summaryDate));
  const width = 760;
  const height = 270;
  const pad = { left: 48, right: 24, top: 25, bottom: 38 };
  const values = rows.map((row) => row.kpi1Hours);
  const max = Math.max(60, ...values);
  const x = (index) =>
    pad.left + (index * (width - pad.left - pad.right)) / Math.max(rows.length - 1, 1);
  const y = (value) =>
    height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  const path = rows
    .map((row, index) => `${index ? "L" : "M"} ${x(index)} ${y(row.kpi1Hours)}`)
    .join(" ");
  const area = rows.length
    ? `${path} L ${x(rows.length - 1)} ${height - pad.bottom} L ${x(0)} ${height - pad.bottom} Z`
    : "";

  return (
    <article className="panel trend-panel">
      <PanelHeading title="MTD KPI1 daily trend" subtitle="Unloading to Putaway · Daily simple average" />
      <div className="chart-legend"><span><i />KPI1 average</span><em>{rows.length} reporting days</em></div>
      <svg viewBox={`0 0 ${width} ${height}`} className="line-chart" role="img" aria-label="Daily MTD unloading to putaway trend">
        <defs>
          <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2748c7" stopOpacity=".22" />
            <stop offset="100%" stopColor="#2748c7" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = max * ratio;
          return (
            <g key={ratio}>
              <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} className="chart-gridline" />
              <text x={pad.left - 10} y={y(value) + 4} textAnchor="end">{Math.round(value)}h</text>
            </g>
          );
        })}
        {area && <path d={area} fill="url(#trendArea)" />}
        {path && <path d={path} className="trend-path" />}
        {rows.map((row, index) => (
          <circle key={row.summaryDate} cx={x(index)} cy={y(row.kpi1Hours)} r="3.5" className="trend-point">
            <title>{formatShortDate(row.summaryDate)}: {formatDuration(row.kpi1Hours)}</title>
          </circle>
        ))}
        {rows.filter((_, index) => index % Math.max(Math.ceil(rows.length / 7), 1) === 0 || index === rows.length - 1).map((row) => {
          const index = rows.indexOf(row);
          return <text key={row.summaryDate} x={x(index)} y={height - 12} textAnchor="middle" className="chart-date">{formatDay(row.summaryDate)}</text>;
        })}
      </svg>
    </article>
  );
}

function FacilityPanel({ facilities }) {
  return (
    <article className="panel facility-panel">
      <PanelHeading title="Facility performance" subtitle="MTD averages by ERP facility" />
      <div className="facility-list">
        {facilities.map((row) => (
          <div className="facility-row" key={row.facility}>
            <div className="facility-name">
              <span>{facilityInitials(row.facility)}</span>
              <div><strong>{row.facility}</strong><small>{row.completeRecords || 0} complete of {row.records || 0}</small></div>
            </div>
            <div><span>KPI1</span><strong>{formatDuration(row.kpi1Hours)}</strong></div>
            <div><span>KPI2</span><strong>{formatDuration(row.kpi2Hours)}</strong></div>
            <div><span>KPI3</span><strong>{formatDuration(row.kpi3Hours)}</strong></div>
          </div>
        ))}
      </div>
      <div className="facility-note">
        <Clock3 size={17} />
        <span>SL Rx is bridged from SL Ambient unloading entries using GRN Number + SKU.</span>
      </div>
    </article>
  );
}

function Details({
  rows,
  fromDate,
  toDate,
  setFromDate,
  setToDate,
  facility,
  setFacility,
  status,
  setStatus,
  query,
  setQuery,
}) {
  return (
    <div className="page-content details-page">
      <section className="details-summary">
        <div>
          <span className="section-eyebrow">Navigation 2</span>
          <h2>Facility + GRN + SKU records</h2>
          <p>Every row is a unique TAT record after shelf-level Putaway pivoting.</p>
        </div>
        <div className="details-count"><strong>{rows.length}</strong><span>matching records</span></div>
      </section>
      <section className="detail-filters">
        <label className="search-control">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search GRN, SKU, facility or exception" />
          {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
        </label>
        <label><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <label><span>Facility</span><select value={facility} onChange={(event) => setFacility(event.target.value)}>{FACILITIES.map((option) => <option key={option}>{option}</option>)}</select></label>
        <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All status</option><option>COMPLETE</option><option>INCOMPLETE</option></select></label>
      </section>
      <section className="table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Unloading date</th>
                <th>Facility</th>
                <th>GRN number</th>
                <th>SKU</th>
                <th>Unloading</th>
                <th>GRN received</th>
                <th>Putaway completed</th>
                <th>KPI1</th>
                <th>KPI2</th>
                <th>KPI3</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 150).map((row) => (
                <tr key={row.recordKey}>
                  <td>{formatShortDate(row.unloadingDate)}</td>
                  <td><span className={`facility-pill ${facilityClass(row.facility)}`}>{row.facility}</span></td>
                  <td><strong>{row.grnNumber}</strong></td>
                  <td className="sku-cell">{row.sku}</td>
                  <td>{formatTableDate(row.unloadingTimestamp)}</td>
                  <td>{formatTableDate(row.grnReceivedTimestamp)}</td>
                  <td>{formatTableDate(row.putawayCompletedTimestamp)}</td>
                  <td className="duration-cell">{formatDuration(row.kpi1Hours)}</td>
                  <td className="duration-cell">{formatDuration(row.kpi2Hours)}</td>
                  <td className="duration-cell">{formatDuration(row.kpi3Hours)}</td>
                  <td>
                    <span className={`status-pill ${row.status === "COMPLETE" ? "complete" : "incomplete"}`}>
                      {row.status === "COMPLETE" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      {row.status}
                    </span>
                    {row.exceptionCode && <small className="exception-code">{row.exceptionCode}</small>}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan="11" className="empty-state">No records match the selected filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 150 && <footer className="table-footer">Showing the first 150 records. Download CSV for the complete filtered dataset.</footer>}
      </section>
    </div>
  );
}

function PanelHeading({ title, subtitle }) {
  return <header className="panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div></header>;
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-mark">IT</div>
      <div className="loading-bar"><span /></div>
      <strong>Loading Inward TAT</strong>
      <p>Preparing facility, GRN and SKU metrics…</p>
    </div>
  );
}

function summarizeFacts(rows) {
  const average = (values) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const completeRows = rows.filter((row) => row.status === "COMPLETE");
  const values = (key) => completeRows.map((row) => row[key]).filter((value) => Number.isFinite(value));
  return {
    records: rows.length,
    completeRecords: completeRows.length,
    exceptionRecords: rows.filter((row) => row.status !== "COMPLETE").length,
    kpi1Hours: average(values("kpi1Hours")),
    kpi2Hours: average(values("kpi2Hours")),
    kpi3Hours: average(values("kpi3Hours")),
  };
}

function formatDuration(hours) {
  if (hours === null || hours === undefined || hours === "") return "\u2014";
  if (!Number.isFinite(Number(hours)) || Number(hours) < 0) return "\u2014";
  const totalMinutes = Math.round(Number(hours) * 60);
  const hourPart = Math.floor(totalMinutes / 60);
  const minutePart = totalMinutes % 60;
  return `${String(hourPart).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`;
}

function formatDurationWords(hours) {
  if (hours === null || hours === undefined || hours === "") return "—";
  if (!Number.isFinite(Number(hours)) || Number(hours) < 0) return "—";
  const totalMinutes = Math.round(Number(hours) * 60);
  const hourPart = Math.floor(totalMinutes / 60);
  const minutePart = totalMinutes % 60;
  return `${hourPart}h ${String(minutePart).padStart(2, "0")}m`;
}

function formatDecimalHours(hours) {
  if (hours === null || hours === undefined || hours === "") return "";
  if (!Number.isFinite(Number(hours)) || Number(hours) < 0) return "";
  return `${Number(hours).toFixed(2)} decimal hrs`;
}

function formatDateTime(value) {
  if (!value) return "not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTableDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day} ${new Intl.DateTimeFormat("en-IN", { month: "short" }).format(new Date(Number(year), Number(month) - 1, Number(day)))}`;
}

function formatDay(value) {
  return String(Number(value.slice(-2)));
}

function latestCompleteDate(snapshot) {
  return (
    [...(snapshot?.daily || [])]
      .filter((row) => row.facility === "All Mother Facilities" && row.kpi1Hours != null)
      .map((row) => row.summaryDate)
      .sort()
      .at(-1) || "—"
  );
}

function snapshotDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function monthStartIso(value) {
  const date = snapshotDate(value);
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function yesterdayIso(value) {
  const date = snapshotDate(value);
  return toIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));
}

function previousMonthRange(value) {
  const date = snapshotDate(value);
  const start = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const end = new Date(date.getFullYear(), date.getMonth(), 0);
  return `${toIsoDate(start)} to ${toIsoDate(end)}`;
}

function previousQuarterRange(value) {
  const date = snapshotDate(value);
  const currentQuarterStart = Math.floor(date.getMonth() / 3) * 3;
  const start = new Date(date.getFullYear(), currentQuarterStart - 3, 1);
  const end = new Date(date.getFullYear(), currentQuarterStart, 0);
  return `${toIsoDate(start)} to ${toIsoDate(end)}`;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function percentage(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function facilityInitials(facility) {
  if (facility === "SL Mother Hub") return "MH";
  if (facility === "SL Ambient") return "AM";
  return "RX";
}

function facilityClass(facility) {
  if (facility === "SL Mother Hub") return "mother";
  if (facility === "SL Ambient") return "ambient";
  return "rx";
}

export default App;
