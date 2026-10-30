/** Owner-run monthly repair. Never invoked by the daily pipeline or HTTP router. */
function monthlyInboxBackfillSettings_() {
  // Edit these values for ONE export, then run previewMonthlyInboxBackfill.
  // Use a Gmail message ID from listMonthlyBackfillEmails, not a thread ID.
  return {
    month: "2026-10",
    messageId: "",
    type: "PUTAWAY", // GRN or PUTAWAY
    facility: "", // SL Mother Hub, SL Ambient, SL Rx, OWN, EXPORT; ALL requires Facility column
    periodStart: "2026-10-01T00:00:00+05:30",
    periodEndExclusive: "2026-11-01T00:00:00+05:30",
    extractedAt: "", // Actual export generation time, e.g. 2026-11-01T08:00:00+05:30
  };
}

function monthlyBackfillOwner_() {
  const user = { email: Session.getEffectiveUser().getEmail() };
  return { user: user, config: monthlyAccess_(user) };
}

/** Last seven days, up to 50 threads. Subjects/job names do not restrict discovery. */
function listMonthlyBackfillEmails() {
  const access = monthlyBackfillOwner_();
  const senders = monthlyBackfillSenders_(access.config);
  const query = "{" + senders.map(function (sender) { return "from:" + sender; }).join(" ") + "} newer_than:7d -in:spam -in:trash";
  const threads = GmailApp.search(query, 0, 50);
  const reports = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      try {
        monthlyBackfillEmail_(message, access.config);
        reports.push({ messageId: message.getId(), receivedAt: message.getDate().toISOString(), subject: message.getSubject() });
      } catch (ignored) { /* Only successful exports from configured senders. */ }
    });
  });
  console.log(JSON.stringify({ reports: reports, limited: threads.length === 50, note: "Received time is not source coverage. One message per run." }));
  return reports;
}

function monthlyBackfillSenders_(config) {
  const senders = [config.GRN_EMAIL_FROM, config.PUTAWAY_EMAIL_FROM].map(function (value) { return String(value || "").trim().toLowerCase(); });
  if (senders.some(function (sender) { return !/^[\w.+-]+@[\w.-]+$/.test(sender); })) throw new Error("Uniware email senders are not configured.");
  return Array.from(new Set(senders));
}

function monthlyBackfillEmail_(message, config, type) {
  const from = String(message.getFrom());
  const match = from.match(/<([^>]+)>/);
  const sender = (match ? match[1] : from).trim().toLowerCase();
  const allowed = type ? [String(config[type + "_EMAIL_FROM"] || "").trim().toLowerCase()] : monthlyBackfillSenders_(config);
  if (allowed.indexOf(sender) === -1) throw new Error("Export sender does not match the configured Uniware source.");
  const body = getEmailBodyText_(message);
  if (extractEmailField_(body, "Status").toUpperCase() !== "SUCCESSFUL") throw new Error("Export did not complete successfully.");
  const url = extractExportFileUrl_(body);
  if (!/^https:\/\//i.test(url)) throw new Error("No HTTPS Uniware export link found. Select the original export email, not a forwarded attachment.");
  return url;
}

function monthlyBackfillSource_(settings, config) {
  if (!["GRN", "PUTAWAY"].includes(settings.type)) throw new Error("Choose GRN or PUTAWAY in the backfill settings.");
  if (!/^[a-fA-F0-9]+$/.test(String(settings.messageId || ""))) throw new Error("Set messageId using listMonthlyBackfillEmails.");
  // Fail before downloading if month, facility or declared dates are incomplete.
  validateMonthlySource_(Object.assign({}, settings, { content: "PREFLIGHT" }));
  const message = GmailApp.getMessageById(settings.messageId);
  const url = monthlyBackfillEmail_(message, config, settings.type);
  if (Date.parse(settings.extractedAt) > message.getDate().getTime()) throw new Error("Generation time cannot be after the export email was received.");
  let filename = settings.type + "-" + settings.messageId + ".csv";
  try { filename = decodeURIComponent(url.split("?")[0]).split("/").pop() || filename; } catch (ignored) { /* Preserve fallback. */ }
  return Object.assign({}, settings, { content: downloadCsv_(url), filename: filename,
    channel: "BACKFILL_EMAIL", coverageDeclared: false, extractionTimeBasis: "OWNER_DECLARED" });
}

/** Read-only validation and reconciliation preview; downloads CSV but writes nothing. */
function previewMonthlyInboxBackfill() {
  return monthlyExecuteInboxBackfill_(false);
}

/** Imports one selected export; originals and revisions archived by existing monthly merge. */
function runMonthlyInboxBackfill() {
  return monthlyExecuteInboxBackfill_(true);
}

function monthlyExecuteInboxBackfill_(apply) {
  const access = monthlyBackfillOwner_();
  const source = monthlyBackfillSource_(monthlyInboxBackfillSettings_(), access.config);
  let result;
  if (apply) {
    if (source.content.length > 5000000) throw new Error("Large export: run previewMonthlyInboxBackfillBatch, then runMonthlyInboxBackfillBatch repeatedly until complete=true.");
    const state = ingestMonthlySource_(source, access.user, access.config);
    result = { month: state.month, revision: state.revision, duplicate: state.duplicate, reconciliation: state.lastReconciliation };
  } else {
    const parsed = monthlyParseCsv_(source);
    const state = readMonthlyState_(source.month);
    const merge = reconcileMonthlyRecords_(state.records, parsed.records);
    result = { month: source.month, type: source.type, facility: source.facility, revision: state.revision,
      sourceRows: parsed.sourceRows, acceptedRows: parsed.records.length, reconciliation: merge.counts };
  }
  console.log(JSON.stringify(result));
  return result;
}
