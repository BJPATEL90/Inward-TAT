import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Database,
  Download,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  ShieldCheck,
  TableProperties,
  X,
} from "lucide-react";
import { hasLiveApi, loadDashboard, submitManualTaskAction } from "./api";
import {
  clearSession,
  getAuthConfig,
  getStoredSession,
  loadGoogleIdentity,
  storeSession,
  verifyGoogleCredential,
} from "./auth";

const FACILITIES = ["All facilities", "SL Ambient", "SL Mother Hub", "SL Rx", "OWN", "EXPORT"];

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

  const pendingFacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (snapshot?.facts || [])
      .filter((row) => {
        const dateMatch =
          row.unloadingDate &&
          (!fromDate || row.unloadingDate >= fromDate) &&
          (!toDate || row.unloadingDate <= toDate);
        const facilityMatch = facility === "All facilities" || row.facility === facility;
        const queryMatch =
          !normalizedQuery ||
          [row.grnNumber, row.sku, row.facility, row.exceptionCode]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        return row.status === "INCOMPLETE" && dateMatch && facilityMatch && queryMatch;
      })
      .sort((a, b) =>
        String(b.unloadingTimestamp || b.unloadingDate).localeCompare(
          String(a.unloadingTimestamp || a.unloadingDate),
        ),
      );
  }, [snapshot, fromDate, toDate, facility, query]);

  const manuallyClosedFacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (snapshot?.facts || [])
      .filter((row) => {
        const dateMatch =
          row.unloadingDate &&
          (!fromDate || row.unloadingDate >= fromDate) &&
          (!toDate || row.unloadingDate <= toDate);
        const facilityMatch = facility === "All facilities" || row.facility === facility;
        const queryMatch =
          !normalizedQuery ||
          [row.grnNumber, row.sku, row.facility, row.manualActionReason]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery);
        return row.status === "MANUALLY_CLOSED" && dateMatch && facilityMatch && queryMatch;
      })
      .sort((a, b) => String(b.manualActionAt || "").localeCompare(String(a.manualActionAt || "")));
  }, [snapshot, fromDate, toDate, facility, query]);

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
    const rowsToExport =
      page === "details" ? filteredFacts : page === "pending" ? pendingFacts : snapshot?.facts || [];
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
      "Manual Action Status",
      "Manual Action By",
      "Manual Action At",
      "Manual Action Reason",
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
      row.manualActionStatus,
      row.manualActionBy,
      row.manualActionAt,
      row.manualActionReason,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const exportName = page === "details" ? "filtered" : page === "pending" ? "pending-tasks" : "mtd";
    anchor.download = `inward-tat-${exportName}.csv`;
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
        ) : page === "details" ? (
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
        ) : page === "pending" ? (
          <PendingTasks
            rows={pendingFacts}
            closedRows={manuallyClosedFacts}
            fromDate={fromDate}
            toDate={toDate}
            setFromDate={setFromDate}
            setToDate={setToDate}
            facility={facility}
            setFacility={setFacility}
            query={query}
            setQuery={setQuery}
            generatedAt={snapshot?.generatedAt}
            onExport={exportCsv}
            canManage={Boolean(snapshot?.permissions?.canManagePendingTasks)}
            onTaskUpdated={() => hydrate(true)}
          />
        ) : (
          <CalculationLogic />
        )}
      </main>
    </div>
  );
}

function Sidebar({ page, setPage, open }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "pending", label: "Pending Tasks", icon: ClipboardList },
    { id: "details", label: "Detailed Records", icon: TableProperties },
    { id: "logic", label: "Calculation Logic", icon: BookOpen },
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
  const pageTitle =
    page === "dashboard"
      ? "Vehicle Arrival to Putaway TAT"
      : page === "pending"
        ? "Pending Tasks"
      : page === "details"
        ? "Detailed TAT Records"
        : "Calculation & Publication Logic";
  const pageSubtitle =
    page === "dashboard"
      ? "Mother-facility inbound performance"
      : page === "pending"
        ? "Open GRN, Putaway, timestamp, and matching actions"
      : page === "details"
        ? "Resolved ERP Facility + GRN + SKU level review"
        : "How records are matched, calculated, excluded, and published";
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="menu-button" onClick={openMenu} aria-label="Open navigation">
          <Menu size={21} />
        </button>
        <div>
          <h1>{pageTitle}</h1>
          <p>{pageSubtitle}</p>
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

function CalculationLogic() {
  const stages = [
    {
      step: "01",
      title: "Vehicle unloading",
      text: "Goods Inward provides the unloading date and time, SKU, invoice number, GRN number, and physical receiving facility.",
    },
    {
      step: "02",
      title: "GRN resolution",
      text: "The system first matches SKU + Invoice Number + GRN across all ERP facilities to identify the correct ERP facility.",
    },
    {
      step: "03",
      title: "Controlled fallback",
      text: "If the invoice key is blank or mismatched, Facility + SKU + GRN is used, including the approved SL Ambient-to-SL Rx and SL Mother Hub-to-OWN/EXPORT bridges.",
    },
    {
      step: "04",
      title: "Putaway completion",
      text: "Completed shelf rows are consolidated by resolved ERP Facility + SKU + GRN. The latest Last Updated timestamp is retained.",
    },
  ];

  const remarks = [
    ["PRIMARY_MATCH", "Exact SKU + Invoice + GRN match in the same facility."],
    ["CROSS_FACILITY_MATCH", "The primary key identified a different ERP facility."],
    ["FALLBACK_BLANK_INVOICE", "Invoice was blank; the controlled facility key was used."],
    ["FALLBACK_INVOICE_MISMATCH", "Invoice did not match exactly; the controlled facility key was used."],
    ["AMBIGUOUS_MATCH", "More than one facility matched; the record is excluded until resolved."],
    ["NO_GRN_MATCH / NO_PUTAWAY_MATCH", "A required milestone is missing; the record remains incomplete."],
  ];

  return (
    <div className="page-content logic-page">
      <section className="logic-hero">
        <div>
          <span className="section-eyebrow">Governed calculation method</span>
          <h2>One continuous timeline, one complete cohort</h2>
          <p>
            Every published KPI uses continuous elapsed time, a simple arithmetic average,
            and the same set of complete records. Nights, Sundays, and holidays are included.
          </p>
        </div>
        <div className="logic-principle">
          <ShieldCheck size={24} />
          <div>
            <strong>No assumed matches</strong>
            <span>Ambiguous and incomplete records never contribute a false zero.</span>
          </div>
        </div>
      </section>

      <section className="logic-flow" aria-label="Calculation flow">
        {stages.map((stage, index) => (
          <React.Fragment key={stage.step}>
            <article className="logic-stage">
              <span>{stage.step}</span>
              <h3>{stage.title}</h3>
              <p>{stage.text}</p>
            </article>
            {index < stages.length - 1 && <ArrowRight className="logic-arrow" size={20} />}
          </React.Fragment>
        ))}
      </section>

      <section className="logic-grid">
        <article className="logic-panel formula-panel">
          <div className="logic-panel-heading">
            <span>01</span>
            <div><h3>KPI formulas</h3><p>Displayed as hours and minutes, with decimal hours for reconciliation.</p></div>
          </div>
          <div className="formula-list">
            <div><b>KPI1</b><span>Unloading to Putaway</span><strong>Putaway Completed − Vehicle Unloading</strong></div>
            <div><b>KPI2</b><span>GRN to Putaway</span><strong>Putaway Completed − GRN Received</strong></div>
            <div><b>KPI3</b><span>Unloading to GRN</span><strong>GRN Received − Vehicle Unloading</strong></div>
          </div>
          <div className="formula-proof">For the same complete cohort: <strong>KPI1 = KPI2 + KPI3</strong></div>
        </article>

        <article className="logic-panel publication-panel">
          <div className="logic-panel-heading">
            <span>02</span>
            <div><h3>Publication rules</h3><p>What changes automatically and what remains governed.</p></div>
          </div>
          <div className="publication-table">
            <div className="publication-head"><span>View</span><span>Source</span><span>Behaviour</span></div>
            <div><strong>Last Quarter</strong><span>Config</span><em>Published static value</em></div>
            <div><strong>Last Month</strong><span>Config</span><em>Published static value</em></div>
            <div><strong>Month to Date</strong><span>Fact data</span><em>Recalculated after refresh</em></div>
            <div><strong>Yesterday</strong><span>Fact data</span><em>Shows pending until milestones arrive</em></div>
            <div><strong>Selected range</strong><span>Fact data</span><em>Recalculated by unloading date</em></div>
          </div>
        </article>
      </section>

      <section className="logic-grid lower">
        <article className="logic-panel">
          <div className="logic-panel-heading">
            <span>03</span>
            <div><h3>Match remarks</h3><p>Visible in the Fact sheet and downloadable operational data.</p></div>
          </div>
          <div className="remark-list">
            {remarks.map(([code, meaning]) => (
              <div key={code}><code>{code}</code><span>{meaning}</span></div>
            ))}
          </div>
        </article>

        <article className="logic-panel rules-panel">
          <div className="logic-panel-heading">
            <span>04</span>
            <div><h3>Inclusion controls</h3><p>Rules applied before a record enters any KPI average.</p></div>
          </div>
          <ul>
            <li><CheckCircle2 size={17} /> Facility must resolve to SL Ambient, SL Mother Hub, SL Rx, OWN, or EXPORT.</li>
            <li><CheckCircle2 size={17} /> GRN Received Timestamp and completed Putaway Last Updated must exist.</li>
            <li><CheckCircle2 size={17} /> Putaway type must be PUTAWAY_GRN_ITEM and all consolidated shelf rows must be complete.</li>
            <li><CheckCircle2 size={17} /> Negative timestamp sequences are excluded and sent to exceptions.</li>
            <li><CheckCircle2 size={17} /> Date selection is based on Vehicle Unloading Date.</li>
            <li><CheckCircle2 size={17} /> A simple average is calculated only across COMPLETE records.</li>
          </ul>
        </article>
      </section>
    </div>
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
        <MiniKpi kpi="KPI1" label={labels.kpi1 || "Unloading to Putaway"} value={selectedSummary.kpi1Hours} records={selectedSummary.kpi1Records} totalRecords={selectedSummary.records} note="Records with unloading and putaway" primary />
        <MiniKpi kpi="KPI2" label={labels.kpi2 || "GRN to Putaway"} value={selectedSummary.kpi2Hours} records={selectedSummary.kpi2Records} totalRecords={selectedSummary.records} note="Records with GRN and putaway" />
        <MiniKpi kpi="KPI3" label={labels.kpi3 || "Unloading to GRN"} value={selectedSummary.kpi3Hours} records={selectedSummary.kpi3Records} totalRecords={selectedSummary.records} note="Records with unloading and GRN" />
        <article className="completion-card">
          <div className="completion-icon"><CheckCircle2 size={23} /></div>
          <div>
            <span>Complete records</span>
            <strong>{selectedSummary.completeRecords || 0}</strong>
            <small>{percentage(selectedSummary.completeRecords, selectedSummary.records)} of selected records</small>
          </div>
        </article>
      </section>

      <VolumeSummary
        daily={snapshot?.daily || []}
        fromDate={fromDate}
        toDate={toDate}
        capacity={snapshot?.volume?.dailyCapacityBoxes || 3500}
      />

      <PeriodVolumeSummary periods={snapshot?.volume?.periods || []} />

      <section className="dashboard-grid">
        <TrendPanel
          daily={snapshot?.daily || []}
          capacity={snapshot?.volume?.dailyCapacityBoxes || 3500}
        />
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
  const hasLiveCounts = data.records !== undefined && data.records !== null;
  const availability = (key) => {
    if (!hasLiveCounts) return "Published value";
    const count = data[`${key}Records`] ?? data.completeRecords ?? 0;
    return `${count} of ${data.records || 0} records \u00b7 ${percentage(count, data.records)} available`;
  };
  return (
    <article className={`period-card tone-${tone}`}>
      <span className="period-title">{title}</span>
      <strong className="primary-duration">{formatDurationWords(data.kpi1Hours)}</strong>
      <em className="decimal-duration">{formatDecimalHours(data.kpi1Hours) || "Awaiting data"}</em>
      <small><b>KPI1</b> · {labels.kpi1 || "Unloading to Putaway"}</small>
      <small className="kpi-availability">{availability("kpi1")}</small>
      <div className="sub-kpis">
        <div>
          <span><b>KPI2</b> · {labels.kpi2 || "GRN to Putaway"}</span>
          <strong>{formatDurationWords(data.kpi2Hours)}</strong>
          <em className="decimal-duration">{formatDecimalHours(data.kpi2Hours) || "Awaiting data"}</em>
          <small className="kpi-availability">{availability("kpi2")}</small>
        </div>
        <div>
          <span><b>KPI3</b> · {labels.kpi3 || "Unloading to GRN"}</span>
          <strong>{formatDurationWords(data.kpi3Hours)}</strong>
          <em className="decimal-duration">{formatDecimalHours(data.kpi3Hours) || "Awaiting data"}</em>
          <small className="kpi-availability">{availability("kpi3")}</small>
        </div>
      </div>
      <footer>
        <span>{dates}</span>
        <i />
      </footer>
    </article>
  );
}

function MiniKpi({ kpi, label, value, records, totalRecords, note, primary = false }) {
  const availableRecords = records || 0;
  return (
    <article className={`mini-kpi ${primary ? "primary" : ""}`}>
      <span><b>{kpi}</b> · {label}</span>
      <strong>{formatDurationWords(value)}</strong>
      <em className="decimal-duration">{formatDecimalHours(value) || "Awaiting data"}</em>
      <small>{note}</small>
      <div className="mini-kpi-availability">
        <span>{availableRecords} of {totalRecords || 0} records</span>
        <b>{percentage(availableRecords, totalRecords)} available</b>
      </div>
    </article>
  );
}

function VolumeSummary({ daily, fromDate, toDate, capacity }) {
  const rows = daily.filter(
    (row) =>
      row.facility === "All Mother Facilities" &&
      (!fromDate || row.summaryDate >= fromDate) &&
      (!toDate || row.summaryDate <= toDate) &&
      Number.isFinite(Number(row.boxesUnloaded)),
  );
  const total = rows.reduce((sum, row) => sum + Number(row.boxesUnloaded || 0), 0);
  const average = rows.length ? total / rows.length : 0;
  const peak = rows.reduce(
    (current, row) =>
      !current || Number(row.boxesUnloaded || 0) > Number(current.boxesUnloaded || 0)
        ? row
        : current,
    null,
  );
  const peakBoxes = Number(peak?.boxesUnloaded || 0);
  const peakUtilization = capacity ? (peakBoxes / capacity) * 100 : 0;

  return (
    <section className="volume-summary" aria-label="Combined unloading volume">
      <div className="volume-summary-title">
        <span className="section-eyebrow">Volume handled</span>
        <h3>Combined across all facilities</h3>
        <small>Sum of No. of Boxes Recd · Daily capacity {formatBoxes(capacity)} boxes</small>
      </div>
      <div><span>Total boxes</span><strong>{formatBoxes(total)}</strong><small>selected date range</small></div>
      <div><span>Average per day</span><strong>{formatBoxes(average)}</strong><small>{rows.length} reporting days</small></div>
      <div><span>Peak volume</span><strong>{formatBoxes(peakBoxes)}</strong><small>{peak ? formatShortDate(peak.summaryDate) : "No data"}</small></div>
      <div className={peakUtilization > 100 ? "over-capacity" : "within-capacity"}>
        <span>Peak utilisation</span>
        <strong>{Math.round(peakUtilization)}%</strong>
        <small>{peakUtilization > 100 ? `${Math.round(peakUtilization - 100)}% above capacity` : `${Math.round(100 - peakUtilization)}% spare capacity`}</small>
      </div>
    </section>
  );
}

function PeriodVolumeSummary({ periods }) {
  const order = ["LAST_QUARTER", "LAST_MONTH", "MTD", "YESTERDAY"];
  const byKey = Object.fromEntries(periods.map((period) => [period.key, period]));
  const cards = order.map((key) => byKey[key] || { key, label: key.replaceAll("_", " ") });
  return (
    <section className="period-volume-section" aria-label="Published volume periods">
      <header>
        <span className="section-eyebrow">Volume by reporting period</span>
        <h3>Combined boxes handled</h3>
        <small>Calculated from monthly Goods Inward tabs</small>
      </header>
      <div className="period-volume-grid">
        {cards.map((period) => {
          const utilization = Number(period.peakUtilizationPct || 0);
          return (
            <article key={period.key} className={`period-volume-card period-${period.key.toLowerCase()}`}>
              <span>{period.label}</span>
              <strong>{formatBoxes(period.totalBoxes)}</strong>
              <em>total boxes</em>
              <div>
                <small>Avg/day <b>{formatBoxes(period.averageBoxesPerDay)}</b></small>
                <small>Peak utilisation <b className={utilization > 100 ? "over" : ""}>{Math.round(utilization)}%</b></small>
              </div>
              <footer>{period.periodStart && period.periodEnd ? `${formatShortDate(period.periodStart)} to ${formatShortDate(period.periodEnd)}` : "Awaiting pipeline refresh"}</footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TrendPanel({ daily, capacity = 3500 }) {
  const [hovered, setHovered] = useState(null);
  const [visibleSeries, setVisibleSeries] = useState({
    kpi1Hours: true,
    kpi2Hours: true,
    kpi3Hours: true,
    target: true,
    volume: true,
    capacity: true,
  });
  const rows = daily
    .filter((row) => row.facility === "All Mother Facilities")
    .sort((a, b) => a.summaryDate.localeCompare(b.summaryDate));
  const width = 760;
  const height = 220;
  const pad = { left: 48, right: 54, top: 24, bottom: 34 };
  const max = 40;
  const target = 14;
  const volumeMax = Math.max(
    capacity * 1.25,
    ...rows.map((row) => Number(row.boxesUnloaded || 0) * 1.1),
  );
  const series = [
    { key: "kpi1Hours", label: "KPI1 · Unloading to Putaway", shortLabel: "KPI1", description: "Unloading to Putaway", color: "#16a65a" },
    { key: "kpi2Hours", label: "KPI2 · GRN to Putaway", shortLabel: "KPI2", description: "GRN to Putaway", color: "#3158d4" },
    { key: "kpi3Hours", label: "KPI3 · Unloading to GRN", shortLabel: "KPI3", description: "Unloading to GRN", color: "#e0a400" },
  ];
  const displayedSeries = series.filter((item) => visibleSeries[item.key]);
  const toggleSeries = (key) => {
    setHovered(null);
    setVisibleSeries((current) => ({ ...current, [key]: !current[key] }));
  };
  const x = (index) =>
    pad.left + (index * (width - pad.left - pad.right)) / Math.max(rows.length - 1, 1);
  const y = (value) => {
    const bounded = Math.min(Math.max(Number(value) || 0, 0), max);
    return height - pad.bottom - (bounded / max) * (height - pad.top - pad.bottom);
  };
  const volumeY = (value) => {
    const bounded = Math.min(Math.max(Number(value) || 0, 0), volumeMax);
    return height - pad.bottom - (bounded / volumeMax) * (height - pad.top - pad.bottom);
  };
  const pathFor = (key) => rows
    .map((row, index) => ({ index, value: Number(row[key]) }))
    .filter((point) => Number.isFinite(point.value))
    .map((point, index) => `${index ? "L" : "M"} ${x(point.index)} ${y(point.value)}`)
    .join(" ");
  const tooltipWidth = 174;
  const tooltipVolumeLines = visibleSeries.volume ? 3 : 0;
  const tooltipHeight = 31 + (displayedSeries.length + tooltipVolumeLines) * 15;
  const tooltipX = hovered
    ? Math.min(Math.max(x(hovered.index) - tooltipWidth / 2, pad.left), width - pad.right - tooltipWidth)
    : 0;
  const tooltipY = hovered
    ? Math.max(
        pad.top,
        Math.min(
          ...(displayedSeries.length
            ? displayedSeries.map((item) => y(hovered.row[item.key]))
            : [volumeY(hovered.row.boxesUnloaded)]),
        ) - tooltipHeight - 9,
      )
    : 0;
  const barWidth = Math.max(8, Math.min(22, (width - pad.left - pad.right) / Math.max(rows.length, 1) * 0.58));

  return (
    <article className="panel trend-panel">
      <PanelHeading title="MTD daily KPI trend" subtitle="Daily simple averages · Fixed 0–40 hour scale" />
      <div className="chart-legend">
        <div className="chart-series-legend">
          {series.map((item) => (
            <button
              type="button"
              key={item.key}
              className={`chart-legend-button ${visibleSeries[item.key] ? "active" : "inactive"}`}
              aria-pressed={visibleSeries[item.key]}
              onClick={() => toggleSeries(item.key)}
              title={`Show or hide ${item.label}`}
            >
              <i style={{ background: item.color }} />
              <span><strong>{item.shortLabel}</strong><small>{item.description}</small></span>
            </button>
          ))}
          <button
            type="button"
            className={`chart-legend-button ${visibleSeries.target ? "active" : "inactive"}`}
            aria-pressed={visibleSeries.target}
            onClick={() => toggleSeries("target")}
            title="Show or hide the KPI1 target"
          >
            <i className="target-legend" />
            <span><strong>KPI1 target</strong><small>14-hour benchmark</small></span>
          </button>
          <button
            type="button"
            className={`chart-legend-button ${visibleSeries.volume ? "active" : "inactive"}`}
            aria-pressed={visibleSeries.volume}
            onClick={() => toggleSeries("volume")}
            title="Show or hide unloaded box volume"
          >
            <i className="volume-legend" />
            <span><strong>Volume</strong><small>Boxes unloaded</small></span>
          </button>
          <button
            type="button"
            className={`chart-legend-button ${visibleSeries.capacity ? "active" : "inactive"}`}
            aria-pressed={visibleSeries.capacity}
            onClick={() => toggleSeries("capacity")}
            title="Show or hide daily box capacity"
          >
            <i className="capacity-legend" />
            <span><strong>Capacity</strong><small>{formatBoxes(capacity)} boxes/day</small></span>
          </button>
        </div>
        <em>{rows.length} reporting days</em>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="line-chart"
        role="img"
        aria-label="Daily MTD KPI trend and combined unloading volume"
        onMouseLeave={() => setHovered(null)}
      >
        {[0, 10, 20, 30, 40].map((value) => {
          return (
            <g key={value}>
              <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} className="chart-gridline" />
              <text x={pad.left - 10} y={y(value) + 4} textAnchor="end">{value}h</text>
            </g>
          );
        })}
        {[0, 0.5, 1].map((ratio) => (
          <text key={`volume-axis-${ratio}`} x={width - pad.right + 8} y={volumeY(volumeMax * ratio) + 4} textAnchor="start" className="volume-axis-label">
            {formatCompactBoxes(volumeMax * ratio)}
          </text>
        ))}
        {visibleSeries.volume && rows.map((row, index) => {
          const boxes = Number(row.boxesUnloaded);
          if (!Number.isFinite(boxes)) return null;
          const barY = volumeY(boxes);
          return (
            <rect
              key={`volume-${row.summaryDate}`}
              x={x(index) - barWidth / 2}
              y={barY}
              width={barWidth}
              height={height - pad.bottom - barY}
              rx="3"
              className={`volume-bar ${boxes > capacity ? "over-capacity" : ""}`}
              tabIndex="0"
              onMouseEnter={() => setHovered({ row, index })}
              onFocus={() => setHovered({ row, index })}
              onBlur={() => setHovered(null)}
            >
              <title>{`${formatShortDate(row.summaryDate)} · ${formatBoxes(boxes)} boxes · ${Math.round((boxes / capacity) * 100)}% utilisation`}</title>
            </rect>
          );
        })}
        {visibleSeries.capacity && <line x1={pad.left} x2={width - pad.right} y1={volumeY(capacity)} y2={volumeY(capacity)} className="capacity-line" />}
        {visibleSeries.capacity && <text x={width - pad.right - 3} y={volumeY(capacity) - 5} textAnchor="end" className="capacity-label">Capacity {formatBoxes(capacity)}</text>}
        {visibleSeries.target && <line x1={pad.left} x2={width - pad.right} y1={y(target)} y2={y(target)} className="target-line" />}
        {visibleSeries.target && <text x={width - pad.right - 3} y={y(target) - 5} textAnchor="end" className="target-label">KPI1 target 14h</text>}
        {displayedSeries.map((item) => {
          const path = pathFor(item.key);
          return path ? <path key={item.key} d={path} className="trend-path" style={{ stroke: item.color }} /> : null;
        })}
        {displayedSeries.flatMap((item) => rows.map((row, index) => {
          const value = Number(row[item.key]);
          if (!Number.isFinite(value)) return [];
          return (
            <circle
              key={`${item.key}-${row.summaryDate}`}
              cx={x(index)}
              cy={y(value)}
              r="3.5"
              className="trend-point"
              style={{ stroke: item.color }}
              tabIndex="0"
              onMouseEnter={() => setHovered({ row, index })}
              onFocus={() => setHovered({ row, index })}
              onBlur={() => setHovered(null)}
            >
              <title>{`${formatShortDate(row.summaryDate)} · ${item.label}: ${formatDuration(value)}`}</title>
            </circle>
          );
        }))}
        {rows.filter((_, index) => index % Math.max(Math.ceil(rows.length / 7), 1) === 0 || index === rows.length - 1).map((row) => {
          const index = rows.indexOf(row);
          return <text key={row.summaryDate} x={x(index)} y={height - 12} textAnchor="middle" className="chart-date">{formatDay(row.summaryDate)}</text>;
        })}
        {hovered && (
          <g className="chart-tooltip" transform={`translate(${tooltipX} ${tooltipY})`}>
            <rect width={tooltipWidth} height={tooltipHeight} rx="7" />
            <text x="10" y="16" className="tooltip-date">{formatShortDate(hovered.row.summaryDate)}</text>
            {displayedSeries.map((item, index) => (
              <g key={item.key} transform={`translate(0 ${28 + index * 15})`}>
                <circle cx="11" cy="0" r="3" fill={item.color} />
                <text x="19" y="3">{item.shortLabel}</text>
                <text x={tooltipWidth - 10} y="3" textAnchor="end">{formatDuration(hovered.row[item.key])}</text>
              </g>
            ))}
            {visibleSeries.volume && (
              <g transform={`translate(0 ${28 + displayedSeries.length * 15})`}>
                <rect x="8" y="-4" width="7" height="7" rx="1" className={Number(hovered.row.boxesUnloaded || 0) > capacity ? "tooltip-volume-over" : "tooltip-volume"} />
                <text x="19" y="3">Boxes</text>
                <text x={tooltipWidth - 10} y="3" textAnchor="end">{formatBoxes(hovered.row.boxesUnloaded)}</text>
                <text x="19" y="18">Utilisation</text>
                <text x={tooltipWidth - 10} y="18" textAnchor="end">{Math.round(Number(hovered.row.capacityUtilizationPct ?? ((Number(hovered.row.boxesUnloaded || 0) / capacity) * 100)))}%</text>
                <text x="19" y="33">Vs capacity</text>
                <text x={tooltipWidth - 10} y="33" textAnchor="end">{formatSignedPercent(Number(hovered.row.capacityVariancePct ?? (((Number(hovered.row.boxesUnloaded || 0) - capacity) / capacity) * 100)))}</text>
              </g>
            )}
          </g>
        )}
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
            <div><span>KPI1</span><strong>{formatDuration(row.kpi1Hours)}</strong><small>{percentage(row.kpi1Records ?? row.completeRecords, row.records)} available</small></div>
            <div><span>KPI2</span><strong>{formatDuration(row.kpi2Hours)}</strong><small>{percentage(row.kpi2Records ?? row.completeRecords, row.records)} available</small></div>
            <div><span>KPI3</span><strong>{formatDuration(row.kpi3Hours)}</strong><small>{percentage(row.kpi3Records ?? row.completeRecords, row.records)} available</small></div>
          </div>
        ))}
      </div>
      <div className="facility-note">
        <Clock3 size={17} />
        <span>ERP bridges: SL Ambient → SL Rx and SL Mother Hub → OWN/EXPORT using GRN Number + SKU.</span>
      </div>
    </article>
  );
}

function PendingTasks({
  rows,
  closedRows,
  fromDate,
  toDate,
  setFromDate,
  setToDate,
  facility,
  setFacility,
  query,
  setQuery,
  generatedAt,
  onExport,
  canManage,
  onTaskUpdated,
}) {
  const [taskView, setTaskView] = useState("open");
  const [taskEditor, setTaskEditor] = useState(null);
  const displayRows = taskView === "closed" ? closedRows : rows;
  const facilityCounts = FACILITIES.slice(1).map((name) => ({
    facility: name,
    count: rows.filter((row) => row.facility === name).length,
  }));
  const awaitingGrn = rows.filter((row) => pendingStage(row.exceptionCode).key === "grn").length;
  const awaitingPutaway = rows.filter((row) => pendingStage(row.exceptionCode).key === "putaway").length;
  const dataReview = rows.length - awaitingGrn - awaitingPutaway;

  return (
    <div className="page-content pending-page">
      <section className="pending-hero">
        <div>
          <span className="section-eyebrow">Operational follow-up</span>
          <h2>Records awaiting completion</h2>
          <p>
            These tasks are rechecked against every new cumulative ERP report and close automatically
            after the required timestamps and completed Putaway shelves are available.
          </p>
        </div>
        <div className="pending-hero-actions">
          <div className="pending-total">
            <strong>{rows.length}</strong>
            <span>open tasks</span>
          </div>
          <button type="button" className="download-button pending-download" onClick={onExport}>
            <Download size={16} />
            <span>Download pending CSV</span>
          </button>
        </div>
      </section>

      <section className="pending-metrics">
        <PendingMetric label="Awaiting GRN" value={awaitingGrn} tone="amber" />
        <PendingMetric label="Awaiting Putaway" value={awaitingPutaway} tone="blue" />
        <PendingMetric label="Data review" value={dataReview} tone="red" />
        <article className="pending-facility-metric">
          <span>Pending by facility</span>
          <div>
            {facilityCounts.map((item) => (
              <small key={item.facility}>
                <b>{item.count}</b> {shortFacility(item.facility)}
              </small>
            ))}
          </div>
        </article>
      </section>

      <section className="pending-filters">
        <label className="search-control">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search GRN, SKU, facility or reason"
          />
          {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
        </label>
        <label><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        <label><span>Facility</span><select value={facility} onChange={(event) => setFacility(event.target.value)}>{FACILITIES.map((option) => <option key={option}>{option}</option>)}</select></label>
      </section>

      <div className="task-view-tabs" role="tablist" aria-label="Task status view">
        <button type="button" className={taskView === "open" ? "active" : ""} onClick={() => setTaskView("open")}>Open tasks <span>{rows.length}</span></button>
        <button type="button" className={taskView === "closed" ? "active" : ""} onClick={() => setTaskView("closed")}>Manually closed <span>{closedRows.length}</span></button>
        {!canManage && <small>Manual actions are restricted to users listed in Config.</small>}
      </div>

      <section className="pending-list" aria-label="Pending task list">
        {displayRows.slice(0, 200).map((row) => {
          const stage = pendingStage(row.exceptionCode);
          return (
            <article className="pending-task" key={row.recordKey}>
              <div className={`pending-stage stage-${stage.key}`}>
                <span>{stage.label}</span>
                <small>{pendingAge(row.unloadingTimestamp || row.unloadingDate, generatedAt)}</small>
              </div>
              <div className="pending-identity">
                <span className={`facility-pill ${facilityClass(row.facility)}`}>{row.facility}</span>
                <div><strong>{row.grnNumber || "GRN pending"}</strong><small>{row.sku}</small></div>
              </div>
              <div className="pending-timeline">
                <PendingMilestone label="Unloading" value={row.unloadingTimestamp} complete />
                <ArrowRight size={15} />
                <PendingMilestone label="GRN received" value={row.grnReceivedTimestamp} complete={Boolean(row.grnReceivedTimestamp)} />
                <ArrowRight size={15} />
                <PendingMilestone label="Putaway" value={row.putawayCompletedTimestamp} complete={Boolean(row.putawayCompletedTimestamp)} />
              </div>
              <div className="pending-reason">
                <AlertCircle size={16} />
                <div className="pending-reason-content">
                  <strong>{taskView === "closed" ? "Manually closed" : stage.action}</strong>
                  <small>{taskView === "closed" ? row.manualActionReason || "Closed by authorised user" : readableException(row.exceptionCode)}</small>
                  {canManage && (
                    <div className="pending-task-actions">
                      {taskView === "open" ? (
                        <>
                          <button type="button" onClick={() => setTaskEditor({ row, mode: "UPDATE_FIELDS" })}>Update fields</button>
                          <button type="button" className="danger" onClick={() => setTaskEditor({ row, mode: "CLOSE" })}>Close</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setTaskEditor({ row, mode: "REOPEN" })}>Reopen task</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {!displayRows.length && (
          <div className="pending-empty">
            <CheckCircle2 size={30} />
            <strong>{taskView === "closed" ? "No manually closed tasks" : "No pending tasks in this selection"}</strong>
            <span>{taskView === "closed" ? "Closed task history will appear here." : "All unloading-backed records are complete."}</span>
          </div>
        )}
        {displayRows.length > 200 && <footer className="table-footer">Showing the latest 200 tasks. Download CSV for the complete filtered list.</footer>}
      </section>
      {taskEditor && (
        <ManualTaskModal
          editor={taskEditor}
          onClose={() => setTaskEditor(null)}
          onSaved={async () => {
            setTaskEditor(null);
            await onTaskUpdated();
          }}
        />
      )}
    </div>
  );
}

function ManualTaskModal({ editor, onClose, onSaved }) {
  const { row, mode } = editor;
  const [form, setForm] = useState({
    grnReceivedTimestamp: "",
    putawayCompletedTimestamp: "",
    reason: "",
    remarks: "",
    evidenceUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const title = mode === "UPDATE_FIELDS" ? "Update missing fields" : mode === "CLOSE" ? "Close pending task" : "Reopen task";

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await submitManualTaskAction({
        recordKey: row.recordKey,
        taskAction: mode,
        ...form,
      });
      await onSaved();
    } catch (submitError) {
      setError(submitError.message || "Unable to save the manual action.");
      setSaving(false);
    }
  };

  return (
    <div className="task-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="manual-task-title">
        <header>
          <div><span>Controlled manual action</span><h3 id="manual-task-title">{title}</h3></div>
          <button type="button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </header>
        <div className="task-modal-record">
          <span className={`facility-pill ${facilityClass(row.facility)}`}>{row.facility}</span>
          <div><strong>{row.grnNumber}</strong><small>{row.sku}</small></div>
        </div>
        <form onSubmit={submit}>
          {mode === "UPDATE_FIELDS" && (
            <div className="manual-timestamp-grid">
              {!row.grnReceivedTimestamp ? (
                <label><span>GRN Received Timestamp</span><input type="datetime-local" value={form.grnReceivedTimestamp} onChange={(event) => update("grnReceivedTimestamp", event.target.value)} /></label>
              ) : <div className="existing-timestamp"><span>GRN Received</span><strong>{formatTableDate(row.grnReceivedTimestamp)}</strong></div>}
              {!row.putawayCompletedTimestamp ? (
                <label><span>Putaway Completed Timestamp</span><input type="datetime-local" value={form.putawayCompletedTimestamp} onChange={(event) => update("putawayCompletedTimestamp", event.target.value)} /></label>
              ) : <div className="existing-timestamp"><span>Putaway Completed</span><strong>{formatTableDate(row.putawayCompletedTimestamp)}</strong></div>}
            </div>
          )}
          <label><span>Reason</span><select required value={form.reason} onChange={(event) => update("reason", event.target.value)}><option value="">Select reason</option><option>ERP data missing but operation verified</option><option>Physical completion confirmed</option><option>Matching issue verified</option><option>Incorrect or duplicate pending task</option><option>Other</option></select></label>
          <label><span>Remarks</span><textarea required rows="3" value={form.remarks} onChange={(event) => update("remarks", event.target.value)} placeholder="Enter the verification and supporting details" /></label>
          <label><span>Evidence URL <small>optional</small></span><input type="url" value={form.evidenceUrl} onChange={(event) => update("evidenceUrl", event.target.value)} placeholder="Google Drive or supporting document link" /></label>
          <div className={`manual-action-note ${mode === "CLOSE" ? "warning" : ""}`}>
            {mode === "UPDATE_FIELDS" && "Valid manual timestamps will be included in KPI calculations until ERP data recovers."}
            {mode === "CLOSE" && "This task will leave the open list and remain excluded from KPIs until ERP data recovers."}
            {mode === "REOPEN" && "The task will return to the open pending list on the next refresh."}
          </div>
          {error && <div className="task-modal-error"><AlertCircle size={15} />{error}</div>}
          <footer><button type="button" className="modal-cancel" onClick={onClose}>Cancel</button><button type="submit" className="modal-submit" disabled={saving}>{saving ? "Saving…" : "Confirm action"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function PendingMetric({ label, value, tone }) {
  return <article className={`pending-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>open records</small></article>;
}

function PendingMilestone({ label, value, complete }) {
  return (
    <div className={complete ? "milestone-complete" : "milestone-pending"}>
      <span>{label}</span>
      <strong>{value ? formatTableDate(value) : "Pending"}</strong>
    </div>
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
  const values = (key) => rows.map((row) => row[key]).filter((value) => Number.isFinite(value));
  const kpi1 = values("kpi1Hours");
  const kpi2 = values("kpi2Hours");
  const kpi3 = values("kpi3Hours");
  return {
    records: rows.length,
    completeRecords: completeRows.length,
    exceptionRecords: rows.filter((row) => row.status !== "COMPLETE").length,
    kpi1Hours: average(kpi1),
    kpi2Hours: average(kpi2),
    kpi3Hours: average(kpi3),
    kpi1Records: kpi1.length,
    kpi2Records: kpi2.length,
    kpi3Records: kpi3.length,
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
  if (facility === "SL Rx") return "RX";
  if (facility === "OWN") return "OWN";
  return "EX";
}

function formatBoxes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(number));
}

function formatCompactBoxes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`;
  return String(Math.round(number));
}

function formatSignedPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number > 0 ? "+" : ""}${Math.round(number)}%`;
}

function facilityClass(facility) {
  if (facility === "SL Mother Hub") return "mother";
  if (facility === "SL Ambient") return "ambient";
  if (facility === "SL Rx") return "rx";
  if (facility === "OWN") return "own";
  return "export";
}

function shortFacility(facility) {
  if (facility === "SL Mother Hub") return "Mother Hub";
  if (facility === "SL Ambient") return "Ambient";
  if (facility === "SL Rx") return "Rx";
  if (facility === "OWN") return "OWN";
  return "EXPORT";
}

function pendingStage(exceptionCode = "") {
  const codes = String(exceptionCode).split("|");
  if (codes.includes("NO_GRN_MATCH")) {
    return { key: "grn", label: "Awaiting GRN", action: "Check GRN availability or matching fields" };
  }
  if (codes.includes("NO_PUTAWAY_MATCH") || codes.includes("PUTAWAY_NOT_COMPLETE")) {
    return { key: "putaway", label: "Awaiting Putaway", action: "Check Putaway completion in ERP" };
  }
  if (codes.some((code) => code.startsWith("NEGATIVE_KPI"))) {
    return { key: "review", label: "Timestamp review", action: "Correct the timestamp sequence" };
  }
  if (codes.includes("AMBIGUOUS_MATCH")) {
    return { key: "review", label: "Match review", action: "Resolve the ambiguous source match" };
  }
  return { key: "review", label: "Data review", action: "Review missing or inconsistent source data" };
}

function readableException(exceptionCode = "") {
  const labels = {
    NO_GRN_MATCH: "GRN record not matched",
    NO_PUTAWAY_MATCH: "Putaway record not matched",
    PUTAWAY_NOT_COMPLETE: "One or more shelf rows are incomplete",
    NEGATIVE_KPI1: "Putaway precedes unloading",
    NEGATIVE_KPI2: "Putaway precedes GRN",
    NEGATIVE_KPI3: "GRN precedes unloading",
    AMBIGUOUS_MATCH: "More than one matching record found",
  };
  return String(exceptionCode)
    .split("|")
    .filter(Boolean)
    .map((code) => labels[code] || code.replaceAll("_", " ").toLowerCase())
    .join(" · ") || "Incomplete record";
}

function pendingAge(startValue, endValue) {
  if (!startValue) return "Age unavailable";
  const start = new Date(startValue);
  const end = endValue ? new Date(endValue) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Age unavailable";
  const hours = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 3600000));
  if (hours < 24) return `${hours}h open`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h open`;
}

export default App;
