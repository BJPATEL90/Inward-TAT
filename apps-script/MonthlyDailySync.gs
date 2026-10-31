/** Read-only daily capture; publication writes only immutable monthly archives. */
function monthlyDailyValues_(value, header) {
  if (!(value instanceof Date)) return value == null ? "" : value;
  if (/Timestamp|Last Updated|Imported At|Calculated At|Action At/i.test(header)) return Utilities.formatDate(value, "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
  return Utilities.formatDate(value, "Asia/Kolkata", /time/i.test(header) ? "HH:mm:ss" : "yyyy-MM-dd");
}

function monthlyDailyRows_(sheet, selected) {
  if (!sheet) throw new Error("Daily source sheet is missing.");
  const width = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  const rows = [];
  const last = sheet.getLastRow();
  if (selected && Array.from(selected).some(function (row) { return row > last; })) throw new Error("Daily source row is missing in " + sheet.getName() + ". Complete the daily pipeline before syncing.");
  for (let start = 2; start <= last; start += 5000) {
    const end = Math.min(last, start + 4999);
    if (selected && !Array.from(selected).some(function (row) { return row >= start && row <= end; })) continue;
    sheet.getRange(start, 1, end - start + 1, width).getValues().forEach(function (row, index) {
      const physicalRow = start + index;
      if (selected && !selected.has(physicalRow)) return;
      const values = {};
      headers.forEach(function (header, column) { values[header] = monthlyDailyValues_(row[column], header); });
      rows.push({ row: physicalRow, values: values });
    });
  }
  return { sheet: sheet.getName(), headers: headers, rows: rows };
}

function monthlyDailyCapture_(month, config) {
  monthlyWindow_(month);
  const book = openInwardTatSpreadsheet_();
  const factSheet = book.getSheetByName(INWARD_TAT.SHEETS.FACT);
  if (!factSheet || factSheet.getLastRow() < 2) throw new Error("Daily facts are empty. Complete the daily pipeline first.");
  const headers = factSheet.getRange(1, 1, 1, 29).getValues()[0];
  const expected = SHEET_DEFINITIONS.filter(function (entry) { return entry.name === INWARD_TAT.SHEETS.FACT; })[0].headers;
  if (expected.some(function (name, index) { return headers[index] !== name; })) throw new Error("Daily Fact schema differs. Sync stopped.");
  const keys = new Set();
  const facts = factSheet.getRange(2, 1, factSheet.getLastRow() - 1, 29).getValues().filter(function (row) {
    return monthlyContainsTimestamp_(month, parseDateTime_(row[4]));
  }).map(function (row) {
    if (!row[0] || keys.has(row[0])) throw new Error("Daily transaction keys are blank or duplicated. Sync stopped.");
    keys.add(row[0]);
    return row.map(function (value, index) { return value instanceof Date ? value.toISOString() : value == null ? "" : value; });
  });
  if (!facts.length) throw new Error("No processed daily transactions for " + month + ". Historical monthly data has not been changed.");
  function selected(column) { return new Set(facts.map(function (row) { return Number(row[column]); }).filter(function (row) { return Number.isInteger(row) && row >= 2; })); }
  const goods = monthlyDailyRows_(book.getSheetByName(INWARD_TAT.SHEETS.RAW_GOODS), selected(16));
  const grn = monthlyDailyRows_(book.getSheetByName(INWARD_TAT.SHEETS.RAW_GRN), selected(17));
  const putaway = monthlyDailyRows_(book.getSheetByName(INWARD_TAT.SHEETS.RAW_PUTAWAY), selected(18));
  const lookups = [goods, grn, putaway].map(function (table) { return new Map(table.rows.map(function (entry) { return [entry.row, entry.values]; })); });
  facts.forEach(function (fact) {
    const calculatedAt = new Date(fact[19]);
    if (!Number.isFinite(calculatedAt.getTime())) throw new Error("Daily calculation timestamp is missing. Complete the daily pipeline first.");
    lookups.forEach(function (lookup, index) {
      const values = lookup.get(Number(fact[16 + index]));
      const importedAt = values && parseDateTime_(values["Imported At"]);
      if (importedAt && importedAt > calculatedAt) throw new Error("Daily raw data is newer than its calculation. Complete the daily pipeline before syncing.");
    });
  });
  const manualSheet = book.getSheetByName(INWARD_TAT.SHEETS.MANUAL_TASKS);
  const actions = manualSheet ? monthlyDailyRows_(manualSheet, null).rows.filter(function (row) { return keys.has(row.values["Record Key"]); }) : [];
  return { schemaVersion: 1, month: month, spreadsheetId: book.getId(), factHeaders: headers,
    facts: facts, goods: goods, grn: grn, putaway: putaway, manualActions: actions,
    dailyLastSuccessfulRefresh: String(config.LAST_SUCCESSFUL_REFRESH || ""),
    note: "Processed daily facts plus their referenced raw rows; not a full ERP export or proof of month closure." };
}

function monthlyDailyMerge_(state, capture, sourceId, capturedAt) {
  const incoming = [], pointers = { goods: new Map(), grn: new Map(), putaway: new Map() };
  ["goods", "grn", "putaway"].forEach(function (kind) {
    capture[kind].rows.forEach(function (entry) {
      // Use a separate evidence namespace; these representative raw rows must not
      // be mistaken for a complete Putaway shelf-level source on later rebuilds.
      const key = JSON.stringify(["DAILY_EVIDENCE", capture.spreadsheetId, capture[kind].sheet, entry.row]);
      pointers[kind].set(entry.row, key);
      incoming.push({ key: key, sourceId: sourceId, extractedAt: capturedAt,
        values: Object.assign({}, entry.values, { _sourceType: "DAILY_EVIDENCE", _dailyKind: kind }) });
    });
  });
  capture.facts.forEach(function (fact) {
    const goodsKey = pointers.goods.get(Number(fact[16]));
    if (!goodsKey) throw new Error("Missing daily unloading evidence for " + fact[0]);
    incoming.push({ key: JSON.stringify(["DAILY_FACT", fact[0]]), sourceId: sourceId, extractedAt: capturedAt,
      values: { _sourceType: "DAILY_FACT", fact: fact, goodsKey: goodsKey,
        grnKey: pointers.grn.get(Number(fact[17])) || null, putawayKey: pointers.putaway.get(Number(fact[18])) || null } });
  });
  const merged = reconcileMonthlyRecords_(state.records, incoming);
  const oldFacts = new Map((state.calculations && state.calculations.facts || []).map(function (fact) { return [fact[0], fact]; }));
  const changes = { transactions: capture.facts.length, added: 0, changed: 0, unchanged: 0, becameComplete: 0, becamePending: 0, manuallyClosed: 0 };
  capture.facts.forEach(function (fact) {
    const previous = oldFacts.get(fact[0]);
    if (!previous) changes.added++;
    else if (JSON.stringify(previous.slice(0, 16).concat(previous.slice(20))) !== JSON.stringify(fact.slice(0, 16).concat(fact.slice(20)))) changes.changed++;
    else changes.unchanged++;
    if (fact[13] === "MANUALLY_CLOSED") changes.manuallyClosed++;
    if (previous && previous[13] !== "COMPLETE" && fact[13] === "COMPLETE") changes.becameComplete++;
    if (previous && previous[13] === "COMPLETE" && fact[13] !== "COMPLETE" && fact[13] !== "MANUALLY_CLOSED") changes.becamePending++;
  });
  return { records: merged.records, changes: merged.changes, counts: merged.counts, preview: changes };
}

function syncMonthlyDaily_(parameters, user) {
  const config = monthlyAccess_(user);
  const month = String(parameters.month || "");
  const apply = parameters.apply === "true";
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error("The daily pipeline or another update is running. Retry Sync from Daily Data after it finishes.");
  try {
    const capture = monthlyDailyCapture_(month, config);
    let content = JSON.stringify(capture);
    const hash = monthlyBackfillDigest_(content);
    const state = readMonthlyState_(month);
    if (apply && (String(parameters.expectedRevision) !== String(state.revision) || parameters.captureHash !== hash)) throw new Error("Daily or monthly data changed after preview. Preview the sync again.");
    if (state.lastDailySync && state.lastDailySync.hash === hash && state.lastDailySync.revision === state.revision) return { ok: true, duplicate: true, revision: state.revision, sync: state.lastDailySync.counts };
    const capturedAt = new Date().toISOString();
    const merged = monthlyDailyMerge_(state, capture, "DAILY_PREVIEW", capturedAt);
    if (!apply) return { ok: true, preview: true, revision: state.revision, captureHash: hash, sync: merged.preview };
    // Archive the exact capture including all manual actions before publishing.
    const folder = monthlyDrive_().getFolderById(config.MONTHLY_ARCHIVE_FOLDER_ID);
    const archive = folder.createFile(Utilities.newBlob(content, "application/json", "Inward-TAT-" + month + "-Daily-Capture-" + Utilities.getUuid() + ".json"));
    if (archive.getBlob().getDataAsString("UTF-8") !== content) throw new Error("Daily capture verification failed; month unchanged.");
    merged.records.forEach(function (record) { if (record.sourceId === "DAILY_PREVIEW") record.sourceId = archive.getId(); });
    delete state.calculations; delete state.changes;
    state.records = [];
    const next = Object.assign({}, state, { revision: state.revision + 1, previousRevisionFileId: state.fileId || null,
      status: ["FINAL", "REVISION_PENDING"].includes(state.status) ? "REVISION_PENDING" : "PROVISIONAL",
      updatedAt: capturedAt, updatedBy: user.email, records: merged.records, changes: merged.changes,
      lastReconciliation: merged.counts,
      lastDailySync: { hash: hash, revision: state.revision + 1, capturedAt: capturedAt, counts: merged.preview, fileId: archive.getId() },
      sources: state.sources.concat([{ type: "DAILY_SYNC", facility: "ALL", fileId: archive.getId(), hash: hash, extractedAt: capturedAt,
        acceptedRows: capture.facts.length, coverageDeclared: false, completeMonthCoverage: false }]),
      calculationConfig: { OWN_EXCLUDED_SKUS: String(config.OWN_EXCLUDED_SKUS || config.EXCLUDED_SKUS || ""),
        GOODS_ALLOWED_FACILITIES: String(config.GOODS_ALLOWED_FACILITIES || "SL Mother Hub|SL Ambient"), KPI1_TARGET_HOURS: Number(config.KPI1_TARGET_HOURS || 14) },
      calculations: calculateMonthlyRevision_(month, merged.records, config) });
    content = JSON.stringify(next);
    const file = folder.createFile(Utilities.newBlob(content, "application/json", "Inward-TAT-" + month + "-revision-" + next.revision + "-" + Utilities.getUuid() + ".json"));
    if (file.getBlob().getDataAsString("UTF-8") !== content) throw new Error("Monthly revision verification failed; prior month retained.");
    PropertiesService.getScriptProperties().setProperty(monthlyStateKey_(month), file.getId());
    return { ok: true, revision: next.revision, sync: merged.preview, duplicate: false };
  } finally { lock.releaseLock(); }
}
