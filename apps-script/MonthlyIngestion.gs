/** Isolated monthly storage. No writes to daily Raw_*, Fact or MTD sheets. */
function monthlyAccess_(user) {
  const config = getConfig_();
  if (String(config.MONTHLY_WORKFLOW_ENABLED || "FALSE").toUpperCase() !== "TRUE") {
    throw new Error("Monthly workflow is not enabled yet.");
  }
  if (!isManualTaskUser_(user && user.email)) throw new Error("You are not authorised to manage monthly reports.");
  if (!String(config.MONTHLY_ARCHIVE_FOLDER_ID || "").trim()) throw new Error("Monthly archive folder is not configured.");
  return config;
}

function monthlyStateKey_(month) {
  monthlyWindow_(month);
  return "INWARD_TAT_MONTHLY_STATE_" + month;
}

/** Matches the daily raw-Putaway identity; one item can reference multiple GRNs. */
function monthlyPutawaySourceKey_(values) {
  return JSON.stringify(["PUTAWAY", normalizeFacility_(values.Facility), String(values["Putaway Item Id"] || "").trim(),
    normalizeSku_(values["SKU Code"]), normalizeGrn_(values["GRN Number"])]);
}

/** Original columns remain in source archives; keep only engine inputs in state. */
function monthlyCompactPutaway_(record) {
  if (record.values._sourceType !== "PUTAWAY") return record;
  const values = { _sourceType: "PUTAWAY" };
  ["Facility", "Putaway Item Id", "SKU Code", "GRN Number", "Type", "Status Code", "Last Updated"].forEach(function (name) {
    if (Object.prototype.hasOwnProperty.call(record.values, name)) values[name] = record.values[name];
  });
  record.values = values;
  return record;
}

function readMonthlyState_(month) {
  const fileId = PropertiesService.getScriptProperties().getProperty(monthlyStateKey_(month));
  if (!fileId) return { schemaVersion: 1, month: month, revision: 0, status: "PROVISIONAL", records: [], sources: [] };
  const state = JSON.parse(monthlyDrive_().getFileById(fileId).getBlob().getDataAsString("UTF-8"));
  if (state.schemaVersion !== 1 || state.month !== month || !Array.isArray(state.records) || !Array.isArray(state.sources)) {
    throw new Error("Monthly stored revision is invalid.");
  }
  state.fileId = fileId;
  // Older monthly revisions used only facility + item ID. Upgrade in memory;
  // the archived revision stays immutable and the next import publishes new keys.
  state.records.forEach(function (record) {
    if (record.values && record.values._sourceType === "PUTAWAY") {
      let parts = [];
      try { parts = JSON.parse(record.key); } catch (ignored) { /* Preserve unrelated identities. */ }
      if (Array.isArray(parts) && parts.length === 3 && parts[0] === "PUTAWAY") record.key = monthlyPutawaySourceKey_(record.values);
    }
    monthlyCompactPutaway_(record);
  });
  return state;
}

function monthlyStatus_(month, user) {
  const config = monthlyAccess_(user);
  return monthlyReportPreview_(readMonthlyState_(month), config);
}

function monthlyPublicState_(state) {
  return {
    ok: true, month: state.month, revision: state.revision, status: state.status,
    updatedAt: state.updatedAt || null, records: state.records.length,
    recordCounts: state.records.reduce(function (counts, row) {
      counts[row.values._sourceType] = (counts[row.values._sourceType] || 0) + 1;
      return counts;
    }, {}),
    sources: state.sources, lastReconciliation: state.lastReconciliation || null,
    // Source coverage is not closure approval or proof that every receipt is complete.
    closureReady: false,
    summary: state.calculations ? state.calculations.summary : null,
    sourceExceptionCount: state.calculations ? state.calculations.sourceExceptions.length : 0,
    daily: state.calculations ? state.calculations.daily : [],
    facilities: state.calculations ? state.calculations.facilities : [],
  };
}

function monthlyParseCsv_(source) {
  const metadata = validateMonthlySource_(source);
  const backfillEmail = source.channel === "BACKFILL_EMAIL";
  const fromEmail = source.channel === "EMAIL" || backfillEmail;
  const characterLimit = backfillEmail ? 40000000 : fromEmail ? 25000000 : 5000000;
  if (source.content.length > characterLimit) throw new Error(fromEmail ? "Email export exceeds the " + characterLimit / 1000000 + " million character limit. Use smaller extraction windows." : "Upload exceeds the 5 million character limit. Use Import from Inbox or split the CSV.");
  if (!["ALL", "SL Mother Hub", "SL Ambient", "SL Rx", "OWN", "EXPORT"].includes(metadata.facility)) {
    throw new Error("Choose a supported facility or ALL for a multi-facility GRN export.");
  }
  const matrix = Utilities.parseCsv(source.content.replace(/^\uFEFF/, ""));
  if (!matrix.length || matrix.length > (fromEmail ? 200001 : 20001)) throw new Error(fromEmail ? "Email CSV is empty or exceeds 200,000 rows. Use smaller extraction windows." : "CSV is empty or exceeds 20,000 rows. Use Import from Inbox or split the CSV.");
  const headers = matrix[0].map(function (header) {
    const name = String(header).trim();
    return source.type === "PUTAWAY" ? ({ "Item Type skuCode": "SKU Code", "Updated": "Last Updated", "Facility Name": "Facility" }[name] || name) : name;
  });
  if (headers.some(function (header) { return !header; }) || new Set(headers).size !== headers.length) {
    throw new Error("CSV headers must be unique and nonblank.");
  }
  const required = source.type === "GRN"
    ? (metadata.facility === "ALL" ? ["Facility"] : []).concat(["GRN Code", "Item SkuCode", "GRN Received Timestamp", "Batch Code", "Vendor Batch Number"])
    : source.type === "PUTAWAY"
      ? ["Putaway Item Id", "SKU Code", "GRN Number", "Type", "Status Code", "Last Updated"]
      : ["SR NO.", "Received at", "SKU", "GRN no.", "Unloading Date", "Unloading Time"];
  if (source.type === "GRN" && headers.includes("Putaway Item Id") && !headers.includes("GRN Code")) throw new Error("This is a PUTAWAY CSV, not a GRN report. Select PUTAWAY, or choose the actual GRN export containing GRN Code and GRN Received Timestamp.");
  if (source.type === "PUTAWAY" && headers.includes("GRN Code") && !headers.includes("Putaway Item Id")) throw new Error("This is a GRN CSV. Select GRN as the report type.");
  required.forEach(function (header) {
    if (!headers.includes(header)) throw new Error("Missing CSV column: " + header);
  });
  if (!matrix.slice(1).some(function (cells) { return cells.some(function (cell) { return String(cell).trim(); }); })) throw new Error("This CSV contains headers only, with no data records. Regenerate the export with the correct filters.");
  if (source.type === "PUTAWAY" && metadata.facility === "ALL" && !headers.includes("Facility")) throw new Error("Putaway requires an explicit facility or a Facility column in a multi-facility GRN-linked CSV.");
  const records = [];
  matrix.slice(1).forEach(function (cells, index) {
    if (!cells.some(function (cell) { return String(cell).trim(); })) return;
    if (cells.length !== headers.length) throw new Error("Column count mismatch at source row " + (index + 2));
    const values = {};
    headers.forEach(function (header, column) { values[header] = cells[column]; });
    if (headers.some(function (header) { return header.charAt(0) === "_"; })) throw new Error("Reserved CSV column name.");
    if (source.type === "PUTAWAY" && String(values.Type).trim() !== "PUTAWAY_GRN_ITEM") return;
    const rawFacility = source.type === "GOODS_INWARD" ? values["Received at"] : values.Facility;
    const facility = normalizeFacility_(rawFacility || metadata.facility);
    if (source.type === "GOODS_INWARD" && String(source.goodsAllowedFacilities || "SL Mother Hub|SL Ambient").split("|").map(normalizeFacility_).indexOf(facility) === -1) return;
    if (!["SL Mother Hub", "SL Ambient", "SL Rx", "OWN", "EXPORT"].includes(facility)) {
      if ((source.type === "PUTAWAY" || source.type === "GRN") && metadata.facility === "ALL" && String(rawFacility || "").trim()) return;
      throw new Error("Invalid facility at source row " + (index + 2));
    }
    if (metadata.facility !== "ALL" && facility !== metadata.facility) throw new Error("Source facility does not match its declared facility.");
    if (source.type !== "GOODS_INWARD") values.Facility = facility;
    values._sourceType = source.type;
    let parts;
    if (source.type === "PUTAWAY") {
      if (!String(values["Putaway Item Id"]).trim()) throw new Error("Missing Putaway Item Id at row " + (index + 2));
      if (!normalizeGrn_(values["GRN Number"]) || !normalizeSku_(values["SKU Code"])) throw new Error("Missing Putaway GRN Number or SKU Code at row " + (index + 2));
      parts = [source.type, facility, String(values["Putaway Item Id"]).trim(), normalizeSku_(values["SKU Code"]), normalizeGrn_(values["GRN Number"])];
    } else if (source.type === "GRN") {
      if (!normalizeGrn_(values["GRN Code"]) || !normalizeSku_(values["Item SkuCode"])) throw new Error("Missing GRN identity at row " + (index + 2));
      parts = [source.type, facility, normalizeGrn_(values["GRN Code"]), normalizeSku_(values["Item SkuCode"]),
        String(values["Batch Code"]).trim().toUpperCase(), String(values["Vendor Batch Number"]).trim().toUpperCase()];
    } else {
      if (!source.sheetId || !String(values["SR NO."]).trim()) throw new Error("Goods source sheet and serial number are required.");
      // A receiving serial can span different batches/GRNs. Physical row identity
      // is safe only with replacement of the complete selected-sheet snapshot.
      parts = source.channel === "GOOGLE_SHEET" && source.goodsSnapshotMode === "SHEET_ROWS_V1"
        ? [source.type, String(source.sheetId), "ROW", index + 2]
        : [source.type, String(source.sheetId), String(values["SR NO."]).trim()];
    }
    records.push(monthlyCompactPutaway_({ key: JSON.stringify(parts), sourceId: "VALIDATION", extractedAt: metadata.extractedAt, values: values }));
  });
  // Detect duplicate/conflicting identities within a source before persistence.
  const checked = reconcileMonthlyRecords_([], records);
  if (source.type === "PUTAWAY" && !checked.records.length && !(source.channel === "BACKFILL_EMAIL" && source.batch)) throw new Error("No PUTAWAY_GRN_ITEM records were found. This export cannot support inward TAT.");
  if (source.type === "GRN" && !checked.records.length) throw new Error("No GRN records for the supported inward facilities were found in this export.");
  return { metadata: metadata, records: checked.records, sourceRows: matrix.length - 1 };
}

/** Replace one complete receiving-tab snapshot; retain ERP and other tabs. */
function reconcileMonthlyGoodsSnapshot_(existing, incoming, source) {
  const scoped = existing.filter(function (record) {
    let key;
    try { key = JSON.parse(record.key); } catch (ignored) { return false; }
    return record.values._sourceType === "GOODS_INWARD" && key[0] === "GOODS_INWARD" && key[1] === String(source.sheetId);
  });
  if (scoped.some(function (record) { return Date.parse(record.extractedAt) > Date.parse(source.extractedAt); })) {
    throw new Error("A newer Goods Receiving snapshot already exists. Refresh again to read the latest sheet.");
  }
  const incomingKeys = new Set(incoming.map(function (record) { return record.key; }));
  const removed = new Set(scoped.filter(function (record) { return !incomingKeys.has(record.key); }));
  const merged = reconcileMonthlyRecords_(existing.filter(function (record) { return !removed.has(record); }), incoming);
  merged.counts.replacedSnapshotRows = removed.size;
  merged.changes = Array.from(removed).map(function (record) { return { key: record.key, before: record, after: null }; }).concat(merged.changes);
  return merged;
}

function ingestMonthlySource_(source, user, config) {
  const parsed = monthlyParseCsv_(source);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (source.batch) console.log("Monthly batch: reading current revision.");
    const state = readMonthlyState_(source.month);
    if (source.batch) console.log("Monthly batch: archiving original batch rows.");
    const archived = archiveMonthlySource_(config.MONTHLY_ARCHIVE_FOLDER_ID, source);
    if (state.sources.some(function (entry) { return entry.hash === archived.hash; })) {
      return Object.assign(monthlyPublicState_(state), { duplicate: true });
    }
    // Prior derived data and change payloads can be large; sources/revisions keep
    // the audit history and this execution recomputes current calculations.
    delete state.changes;
    delete state.calculations;
    parsed.records.forEach(function (record) { record.sourceId = archived.fileId; });
    const merged = source.type === "GOODS_INWARD" && source.channel === "GOOGLE_SHEET" && source.goodsSnapshotMode === "SHEET_ROWS_V1"
      ? reconcileMonthlyGoodsSnapshot_(state.records, parsed.records, source)
      : reconcileMonthlyRecords_(state.records, parsed.records);
    state.records = [];
    if (source.batch) console.log("Monthly batch: calculating KPIs for " + merged.records.length + " stored source records.");
    const next = {
      schemaVersion: 1, month: state.month, revision: state.revision + 1,
      status: state.status === "FINAL" || state.status === "REVISION_PENDING" ? "REVISION_PENDING" : "PROVISIONAL",
      updatedAt: new Date().toISOString(), updatedBy: user.email,
      previousRevisionFileId: state.fileId || null,
      records: merged.records, changes: merged.changes,
      sources: state.sources.concat([Object.assign({}, archived.metadata, {
        fileId: archived.fileId, hash: archived.hash, channel: source.channel || "UPLOAD",
        filename: String(source.filename || ""), sourceRows: parsed.sourceRows, acceptedRows: parsed.records.length,
        sheetId: source.sheetId || null,
        messageId: source.messageId || null,
      })]),
      lastReconciliation: merged.counts,
      calculationConfig: {
        OWN_EXCLUDED_SKUS: String(config.OWN_EXCLUDED_SKUS || config.EXCLUDED_SKUS || ""),
        GOODS_ALLOWED_FACILITIES: String(config.GOODS_ALLOWED_FACILITIES || "SL Mother Hub|SL Ambient"),
        KPI1_TARGET_HOURS: Number(config.KPI1_TARGET_HOURS || 14),
      },
      calculations: calculateMonthlyRevision_(state.month, merged.records, config),
    };
    const content = JSON.stringify(next);
    if (source.batch) console.log("Monthly batch: uploading revision " + next.revision + " (" + content.length + " JSON characters).");
    const filename = "Inward-TAT-" + source.month + "-revision-" + next.revision + "-" + Utilities.getUuid() + ".json";
    const file = monthlyDrive_().getFolderById(config.MONTHLY_ARCHIVE_FOLDER_ID)
      .createFile(Utilities.newBlob(content, "application/json", filename));
    // Publish last, after validating the written revision. Failure leaves the prior pointer intact.
    if (source.batch) console.log("Monthly batch: verifying uploaded revision.");
    if (file.getBlob().getDataAsString("UTF-8") !== content) throw new Error("Monthly revision failed verification.");
    PropertiesService.getScriptProperties().setProperty(monthlyStateKey_(source.month), file.getId());
    return Object.assign(monthlyPublicState_(next), { duplicate: false });
  } finally { lock.releaseLock(); }
}

/** Only configured successful Uniware exports are selectable; no arbitrary mailbox content. */
function monthlyInboxDescriptor_(message, type, config) {
  const subject = message.getSubject().trim();
  if (!type || type === "AUTO") type = subject === String(config.GRN_EMAIL_SUBJECT || "").trim() ? "GRN" : "PUTAWAY";
  if (!["GRN", "PUTAWAY"].includes(type)) throw new Error("Choose GRN or Putaway.");
  const prefix = type === "GRN" ? "GRN" : "PUTAWAY";
  const sender = String(message.getFrom()).match(/<([^>]+)>/);
  if ((sender ? sender[1] : String(message.getFrom())).trim().toLowerCase() !== String(config[prefix + "_EMAIL_FROM"] || "").trim().toLowerCase() ||
      (subject !== String(config[prefix + "_EMAIL_SUBJECT"] || "").trim() && !(type === "PUTAWAY" && ["Export Job Complete - Copy of Putaway All facility", "Export Job Complete - Gatepass to Putaway"].includes(subject)))) throw new Error("Email sender or subject differs from the configured Uniware source.");
  const body = getEmailBodyText_(message);
  if (extractEmailField_(body, "Status").toUpperCase() !== "SUCCESSFUL") throw new Error("Export did not complete successfully.");
  const job = extractEmailField_(body, "Export");
  if (!String(job || "").trim()) throw new Error("Email export job is missing.");
  const manualName = String(job).match(/^Export Job (.+?) created by /i);
  const jobName = manualName ? manualName[1].trim() : String(job).trim();
  let facility = "ALL";
  let issue = "";
  if (type === "PUTAWAY") {
    const known = ["SLAMB", "SLMH", "SLRX", "OWN", "EXPORT"].some(function (suffix) {
      return config["PUTAWAY_EXPORT_" + suffix] && jobName.toLowerCase() === String(config["PUTAWAY_EXPORT_" + suffix]).trim().toLowerCase();
    });
    const closing = String(config.MONTHLY_CLOSING_PUTAWAY_JOB_PREFIX || "").trim();
    const allFacility = subject === "Export Job Complete - Copy of Putaway All facility";
    const genericGrnLinked = ["GRN/Gatepass to Putaway", "Gatepass to Putaway"].includes(jobName);
    if (allFacility) issue = "The supplied all-facility format has no GRN Number and exceeds the import size limit. Use a GRN-linked Putaway export with GRN Number, SKU Code, Last Updated and Facility, or named facility exports.";
    else if (!known && !genericGrnLinked && !(closing && jobName.indexOf(closing) === 0)) throw new Error("Unrecognised Putaway export job.");
    if (known || (closing && jobName.indexOf(closing) === 0)) {
      facility = facilityFromPutawayExport_(jobName, config);
      if (!["SL Mother Hub", "SL Ambient", "SL Rx", "OWN", "EXPORT"].includes(facility)) throw new Error("Unsupported email facility.");
    }
  } else if (jobName !== "GRN" && jobName !== String(config.MONTHLY_CLOSING_GRN_JOB || "")) throw new Error("Unrecognised GRN export job.");
  const url = extractExportFileUrl_(body);
  if (!/^https:\/\//.test(url)) throw new Error("No HTTPS export download link in this email.");
  let filename = "";
  try { filename = decodeURIComponent(url.split("?")[0]).split("/").pop(); } catch (ignored) { /* Original email date remains available. */ }
  const stamp = filename.match(/_(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})(?:\.csv|[._])/i);
  let extractedAt = null;
  if (stamp) {
    const value = stamp[3] + "-" + stamp[2] + "-" + stamp[1] + "T" + stamp[4] + ":" + stamp[5] + ":" + stamp[6] + "+05:30";
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime()) && parsed <= message.getDate() && Utilities.formatDate(parsed, "Asia/Kolkata", "yyyy-MM-dd'T'HH:mm:ss") === value.slice(0, 19)) extractedAt = parsed.toISOString();
  }
  return { messageId: message.getId(), type: type, exportJob: jobName, filename: filename, facility: facility,
    receivedAt: message.getDate().toISOString(), extractedAt: extractedAt, issue: issue, processable: !issue, url: url };
}

function listMonthlyInbox_(request, user) {
  const config = monthlyAccess_(user);
  monthlyWindow_(request.month);
  if (request.type && !["GRN", "PUTAWAY", "AUTO"].includes(request.type)) throw new Error("Choose GRN or Putaway.");
  const start = String(request.receivedFrom || Utilities.formatDate(new Date(Date.now() - 7 * 86400000), "Asia/Kolkata", "yyyy-MM-dd"));
  const end = String(request.receivedThrough || Utilities.formatDate(new Date(Date.now() + 86400000), "Asia/Kolkata", "yyyy-MM-dd"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
      !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || end <= start || Date.parse(end) - Date.parse(start) > 93 * 86400000) throw new Error("Select an email date range of 1–93 days; Through is exclusive.");
  const senders = Array.from(new Set([config.GRN_EMAIL_FROM, config.PUTAWAY_EMAIL_FROM].map(function (value) { return String(value || "").trim(); })));
  if (senders.some(function (sender) { return !/^[\w.+-]+@[\w.-]+$/.test(sender); })) throw new Error("Uniware email source is not configured.");
  const subjects = [config.GRN_EMAIL_SUBJECT, config.PUTAWAY_EMAIL_SUBJECT, "Export Job Complete - Copy of Putaway All facility", "Export Job Complete - Gatepass to Putaway"];
  const startTime = Date.parse(start + "T00:00:00+05:30"); const endTime = Date.parse(end + "T00:00:00+05:30");
  // Gmail date searches use their own timezone; pad the search then filter exact IST boundaries.
  const queryStart = new Date(startTime - 86400000).toISOString().slice(0, 10).replace(/-/g, "/");
  const queryEnd = new Date(endTime + 86400000).toISOString().slice(0, 10).replace(/-/g, "/");
  const offset = Number(request.offset || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 2000) throw new Error("Invalid inbox page.");
  const query = "{" + senders.map(function (sender) { return "from:" + sender; }).join(" ") + "} {" + subjects.map(function (subject) { return 'subject:"' + String(subject || "").replace(/["\\]/g, "") + '"'; }).join(" ") + "} after:" + queryStart + " before:" + queryEnd + " -in:spam -in:trash";
  const threads = GmailApp.search(query, offset, 50);
  const emails = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (message.getDate().getTime() < startTime || message.getDate().getTime() >= endTime) return;
      try {
        const descriptor = monthlyInboxDescriptor_(message, request.type || "AUTO", config);
        delete descriptor.url; emails.push(descriptor);
      } catch (ignored) { /* Other messages in a matching thread are not selectable. */ }
    });
  });
  emails.sort(function (a, b) { return b.receivedAt.localeCompare(a.receivedAt); });
  return { ok: true, emails: emails, nextOffset: threads.length === 50 ? offset + 50 : null, receivedFrom: start, receivedThrough: end,
    note: "Email dates are not extraction coverage. Verify the actual report filter and generation time before importing." };
}

function importMonthlyInbox_(request, user) {
  const config = monthlyAccess_(user);
  const simpleImport = request.simple === true;
  if (!/^[a-fA-F0-9]+$/.test(String(request.messageId || ""))) throw new Error("Select a listed export email.");
  // Revalidate the message server-side; never trust client-supplied sender, URL or facility.
  const descriptor = monthlyInboxDescriptor_(GmailApp.getMessageById(request.messageId), simpleImport ? "AUTO" : request.type, config);
  if (!descriptor.processable) throw new Error(descriptor.issue);
  if (simpleImport) {
    let facility = descriptor.facility;
    const requestedFacility = String(request.facility || "").trim();
    if (descriptor.type === "PUTAWAY" && facility === "ALL" && requestedFacility) {
      if (!["ALL", "SL Mother Hub", "SL Ambient", "SL Rx", "OWN", "EXPORT"].includes(requestedFacility)) throw new Error("Select a supported facility for this unnamed export.");
      facility = requestedFacility;
    } else if (requestedFacility && requestedFacility !== facility) throw new Error("Facility cannot override the named email export facility.");
    const window = monthlyWindow_(request.month);
    const extracted = descriptor.extractedAt || descriptor.receivedAt;
    const end = new Date(Math.min(window.end.getTime(), Date.parse(extracted)));
    if (end <= window.start) throw new Error("This export predates the selected reporting month.");
    request = { month: request.month, type: descriptor.type, facility: facility, messageId: descriptor.messageId,
      periodStart: window.start.toISOString(), periodEndExclusive: end.toISOString(), extractedAt: extracted,
      extractionTimeBasis: descriptor.extractedAt ? "EXPORT_FILENAME" : "EMAIL_RECEIVED_PROXY", coverageDeclared: false };
  }
  if (!simpleImport && request.facility !== descriptor.facility) throw new Error("Selected facility differs from the email export facility.");
  validateMonthlySource_(Object.assign({}, request, { content: "PREFLIGHT" }));
  const source = Object.assign({}, request, { content: downloadCsv_(descriptor.url), channel: "EMAIL", filename: descriptor.exportJob, messageId: descriptor.messageId });
  return ingestMonthlySource_(source, user, config);
}

function submitMonthlyUpload_(event, user) {
  const config = monthlyAccess_(user);
  const raw = String(event.parameter.source || "");
  if (raw.length > 5100000) throw new Error("Monthly upload is too large.");
  const source = JSON.parse(raw);
  if (!["GRN", "PUTAWAY"].includes(source.type)) throw new Error("Upload GRN or Putaway. Refresh unloading from the Goods Receiving sheet.");
  source.channel = "UPLOAD";
  return ingestMonthlySource_(source, user, config);
}

function refreshMonthlySources_(month, user) {
  const config = monthlyAccess_(user);
  const window = monthlyWindow_(month);
  const now = new Date();
  if (window.start >= now) throw new Error("Cannot refresh a future month.");
  const spreadsheet = SpreadsheetApp.openById(config.GOODS_SOURCE_SPREADSHEET_ID);
  const sheet = resolveGoodsSourceSheetForMonth_(spreadsheet, config, window.start);
  if (!sheet) throw new Error("Goods Receiving monthly tab was not found.");
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function (value, column) {
    return cleanHeader_(value) || "Unnamed Source Column " + (column + 1);
  });
  // The existing September tracker labels its serial-number column F.
  if (!headers.includes("SR NO.") && headers[0] === "F") headers[0] = "SR NO.";
  const output = values.map(function (row, index) {
    return (index ? row : headers).map(function (value, column) {
      if (index && value instanceof Date) {
        return Utilities.formatDate(value, "Asia/Kolkata", /time/i.test(headers[column]) ? "HH:mm:ss" : "yyyy-MM-dd");
      }
      return value;
    }).map(function (value) { return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"'; }).join(",");
  }).join("\r\n");
  const source = {
    month: month, type: "GOODS_INWARD", facility: "ALL", content: output,
    periodStart: window.start.toISOString(), periodEndExclusive: new Date(Math.min(now.getTime(), window.end.getTime())).toISOString(),
    extractedAt: now.toISOString(), channel: "GOOGLE_SHEET", filename: sheet.getName(),
    goodsSnapshotMode: "SHEET_ROWS_V1",
    goodsAllowedFacilities: String(config.GOODS_ALLOWED_FACILITIES || "SL Mother Hub|SL Ambient"),
    sheetId: spreadsheet.getId() + ":" + sheet.getSheetId(),
  };
  const result = ingestMonthlySource_(source, user, config);
  result.requiredAction = "Upload explicit closing GRN/Putaway exports, including later completions where required. Current-month emails are not evidence of previous-month coverage.";
  return result;
}

function calculateMonthlyRevision_(month, records, config) {
  const inputs = { goods: [], grn: [], putaway: [], manualActions: new Map() };
  const sourceExceptions = [];
  const allowedGoods = String(config.GOODS_ALLOWED_FACILITIES || "SL Mother Hub|SL Ambient").split("|").map(normalizeFacility_);
  records.forEach(function (record, index) {
    const values = Object.assign({}, record.values, { __row: index + 2 });
    if (values._sourceType === "GOODS_INWARD" && allowedGoods.includes(normalizeFacility_(values["Received at"]))) {
      if (monthlyValidUnloading_(values)) inputs.goods.push(values);
      else sourceExceptions.push(exceptionFromRow_("GOODS_INWARD", values.__row,
        normalizeFacility_(values["Received at"]), values.SKU, values["GRN no."],
        "MISSING_OR_INVALID_UNLOADING_TIMESTAMP", "Verify both unloading date and unloading time; a blank time is not midnight."));
    }
    if (values._sourceType === "GRN") inputs.grn.push(values);
    if (values._sourceType === "PUTAWAY") inputs.putaway.push(values);
  });
  const calculated = rebuildTatFacts_(config, "MONTHLY_PREVIEW", inputs);
  const baseFacts = calculated.facts.filter(function (row) {
    return monthlyContainsTimestamp_(month, row[4]);
  });
  const facts = monthlyDailyFactOverlay_(records, baseFacts, month);
  const excludedSkus = new Set(String(config.OWN_EXCLUDED_SKUS || config.EXCLUDED_SKUS || "").split(/[|,;\n]/).map(normalizeSku_).filter(Boolean));
  function summarize(rows) {
    const excluded = rows.filter(function (row) { return row[1] === "OWN" && excludedSkus.has(row[2]); });
    const eligible = rows.filter(function (row) { return !excluded.includes(row); });
    const complete = eligible.filter(function (row) { return row[13] === "COMPLETE"; });
    const manuallyClosed = eligible.filter(function (row) { return row[13] === "MANUALLY_CLOSED"; });
    const adjusted = complete.filter(function (row) { return row[26] !== "Y"; });
    return {
      records: rows.length, excludedRecords: excluded.length, eligibleRecords: eligible.length,
      completeRecords: complete.length, manuallyClosedRecords: manuallyClosed.length, pendingRecords: eligible.length - complete.length - manuallyClosed.length,
      kpi1Hours: average_(complete.map(function (row) { return row[9]; })),
      kpi2Hours: average_(complete.map(function (row) { return row[8]; })),
      kpi3Hours: average_(complete.map(function (row) { return row[7]; })),
      excludingExceptions: { records: adjusted.length, kpi1Hours: average_(adjusted.map(function (row) { return row[9]; })),
        kpi2Hours: average_(adjusted.map(function (row) { return row[8]; })), kpi3Hours: average_(adjusted.map(function (row) { return row[7]; })) },
    };
  }
  const groupedDays = new Map();
  const groupedFacilities = new Map();
  facts.forEach(function (row) {
    const day = Utilities.formatDate(row[4], "Asia/Kolkata", "yyyy-MM-dd");
    if (!groupedDays.has(day)) groupedDays.set(day, []);
    if (!groupedFacilities.has(row[1])) groupedFacilities.set(row[1], []);
    groupedDays.get(day).push(row); groupedFacilities.get(row[1]).push(row);
  });
  return {
    summary: summarize(facts), facts: facts,
    daily: Array.from(groupedDays.keys()).sort().map(function (day) { return Object.assign({ date: day }, summarize(groupedDays.get(day))); }),
    facilities: Array.from(groupedFacilities.keys()).sort().map(function (facility) { return Object.assign({ facility: facility }, summarize(groupedFacilities.get(facility))); }),
    sourceExceptions: sourceExceptions.concat(calculated.exceptions.filter(function (entry) { return entry.sourceReport === "GOODS_INWARD"; })),
    // Existing manual overrides are integrated with monthly review in the closure phase.
    manualOverridesApplied: records.some(function (record) { return record.values._sourceType === "DAILY_FACT"; }),
  };
}

function monthlyDailyFactOverlay_(records, baseFacts, month) {
  const facts = new Map(baseFacts.map(function (row) { return [row[0], row]; }));
  const indices = new Map(records.map(function (record, index) { return [record.key, index + 2]; }));
  records.forEach(function (record) {
    if (record.values._sourceType !== "DAILY_FACT") return;
    const saved = record.values;
    let row = saved.fact.slice();
    [4, 5, 6, 10, 11, 12, 19, 24].forEach(function (index) {
      if (!row[index]) return;
      const value = row[index];
      const parsed = typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value) : parseDateTime_(value);
      if (parsed && Number.isFinite(parsed.getTime())) row[index] = parsed;
    });
    if (!monthlyContainsTimestamp_(month, row[4])) return;
    const base = facts.get(row[0]);
    // A Goods-only refresh must not discard synced ERP completions. New ERP
    // imports can supersede a daily snapshot; later daily corrections use Sync.
    const newerSource = base && [17, 18].some(function (column) {
      const source = records[Number(base[column]) - 2];
      return source && Date.parse(source.extractedAt) > Date.parse(record.extractedAt);
    });
    if (newerSource) row = base.slice(0, 26).concat(saved.fact.slice(26, 29));
    else { row[16] = indices.get(saved.goodsKey) || ""; row[17] = indices.get(saved.grnKey) || ""; row[18] = indices.get(saved.putawayKey) || ""; }
    if (typeof tatExceptionFlag_ === "function") row[26] = tatExceptionFlag_(row[9], row[27], row[28]);
    facts.set(row[0], row);
  });
  return Array.from(facts.values());
}

function monthlyValidUnloading_(row) {
  const date = String(row["Unloading Date"] || "").trim();
  const parts = date.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/);
  const time = parseTimeParts_(row["Unloading Time"]);
  if (!parts || !time || time.hour > 23 || time.minute > 59 || time.second > 59) return false;
  const year = Number(parts[1].length === 4 ? parts[1] : parts[3]);
  const month = Number(parts[2]);
  const day = Number(parts[1].length === 4 ? parts[3] : parts[1]);
  if (year < 2000 || year > 2100 || month < 1 || day < 1) return false;
  const check = new Date(year, month - 1, day);
  return check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === day;
}

/** Adapter for explicit closing emails; message arrival date never establishes coverage. */
function importMonthlyClosingEmail_(request, user) {
  const config = monthlyAccess_(user);
  if (!["GRN", "PUTAWAY"].includes(request.type)) throw new Error("Closing email must contain GRN or Putaway.");
  const message = GmailApp.getMessageById(String(request.messageId || ""));
  const expectedSender = String(request.type === "GRN" ? config.GRN_EMAIL_FROM : config.PUTAWAY_EMAIL_FROM).trim().toLowerCase();
  const expectedSubject = String(request.type === "GRN" ? config.GRN_EMAIL_SUBJECT : config.PUTAWAY_EMAIL_SUBJECT).trim();
  const sender = message.getFrom().match(/<([^>]+)>/);
  if ((sender ? sender[1] : message.getFrom()).trim().toLowerCase() !== expectedSender || message.getSubject().trim() !== expectedSubject) {
    throw new Error("Closing email sender or subject differs from the configured source.");
  }
  const body = getEmailBodyText_(message);
  const exportJob = extractEmailField_(body, "Export");
  const configuredJob = String(config[request.type === "GRN" ? "MONTHLY_CLOSING_GRN_JOB" : "MONTHLY_CLOSING_PUTAWAY_JOB_PREFIX"] || "").trim();
  if (!configuredJob || (request.type === "GRN" ? exportJob !== configuredJob : exportJob.indexOf(configuredJob) !== 0)) {
    throw new Error("Email is not from a configured explicit closing-export job.");
  }
  if (extractEmailField_(body, "Status").toUpperCase() !== "SUCCESSFUL") throw new Error("Closing export did not complete successfully.");
  const url = extractExportFileUrl_(body);
  if (!/^https:\/\//.test(url)) throw new Error("Closing export requires an HTTPS source URL.");
  const source = Object.assign({}, request, {
    facility: request.type === "GRN" ? "ALL" : facilityFromPutawayExport_(exportJob, config),
    content: downloadCsv_(url), channel: "EMAIL", filename: exportJob,
  });
  // The closing-job descriptor must supply the extraction interval and generation time.
  return ingestMonthlySource_(source, user, config);
}
