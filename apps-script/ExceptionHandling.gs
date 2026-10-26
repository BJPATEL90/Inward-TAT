/** Manual business exceptions. Existing KPI formulas and quality codes are untouched. */
const TAT_EXCEPTION_BUCKETS = Object.freeze([
  "RT availability", "Manpower issue", "PO unavailable for GRN", "MRP issue",
  "Batch issue", "Short receipt", "Excess receipt", "Other", "WH delay", "Invoice issue",
]);

function tatExceptionFlag_(kpi1, bucket, remarks) {
  if (["wh delay", "wh issue"].indexOf(String(bucket || "").trim().toLowerCase()) !== -1) return "N";
  return typeof kpi1 === "number" && isFinite(kpi1) && kpi1 > 12 &&
    (String(bucket || "").trim() || String(remarks || "").trim()) ? "Y" : "N";
}

function hasTatExceptionEntry_(row) {
  return Boolean(String(row["Exception Bucket"] || "").trim() || String(row.Remarks || "").trim());
}

function assertNoTatExceptionEntries_(rows) {
  if (rows.some(hasTatExceptionEntry_)) {
    throw new Error("Recovery stopped: saved exception entries would be cleared. Preserve or reconcile these transactions before retrying.");
  }
}

/** Quote text so a remark cannot execute as a Sheets formula. */
function tatExceptionSheetText_(value) {
  const text = String(value || "");
  return /^[=+\-@'\t\r\n]/.test(text) ? "'" + text : text;
}

function mergeTatExceptionEntries_(facts, previous) {
  const entries = new Map();
  previous.forEach(function (row) {
    if (!hasTatExceptionEntry_(row)) return;
    const key = String(row["Record Key"] || "");
    if (!key || entries.has(key)) throw new Error("Saved exception transaction keys are missing or duplicated; rebuild stopped.");
    entries.set(key, row);
  });
  const keys = new Set(facts.map(function (row) { return row[0]; }));
  entries.forEach(function (row, key) {
    if (!keys.has(key)) throw new Error("Rebuild stopped: an annotated transaction is absent from the rebuilt data. Reconcile its record key first: " + key);
  });
  return facts.map(function (row) {
    const saved = entries.get(row[0]) || {};
    const bucket = String(saved["Exception Bucket"] || "");
    const remarks = String(saved.Remarks || "");
    return row.slice(0, 26).concat([
      tatExceptionFlag_(row[9], bucket, remarks),
      tatExceptionSheetText_(bucket), tatExceptionSheetText_(remarks),
    ]);
  });
}

/** Caller holds the pipeline lock. Validate before any overwrite; restore on write errors. */
function replaceTatFactsPreservingExceptions_(sheet, facts) {
  const previous = sheetObjects_(sheet);
  const rows = mergeTatExceptionEntries_(facts, previous);
  const width = 29;
  const previousCount = Math.max(sheet.getLastRow() - 1, 0);
  const backup = previousCount ? sheet.getRange(2, 1, previousCount, width).getValues() : [];
  function write(values) {
    for (let start = 0; start < values.length; start += 500) {
      const batch = values.slice(start, start + 500);
      sheet.getRange(2 + start, 1, batch.length, width).setValues(batch);
    }
  }
  try {
    write(rows);
    SpreadsheetApp.flush();
    if (previousCount > rows.length) sheet.getRange(rows.length + 2, 1, previousCount - rows.length, width).clearContent();
  } catch (error) {
    try {
      write(backup.map(function (row) { return row.map(function (value) {
        return typeof value === "string" ? tatExceptionSheetText_(value) : value;
      }); }));
      if (rows.length > previousCount) sheet.getRange(previousCount + 2, 1, rows.length - previousCount, width).clearContent();
      SpreadsheetApp.flush();
    } catch (restoreError) {
      throw new Error("Fact write and restoration failed. Stop rebuilds and restore the sheet backup. " + restoreError.message);
    }
    throw error;
  }
}

function saveTatException_(parameters, user) {
  if (!isManualTaskUser_(user && user.email)) throw new Error("You are not authorised to edit exceptions.");
  parameters = parameters || {};
  const key = String(parameters.recordKey || "").trim();
  const bucket = String(parameters.exceptionBucket || "").trim();
  const remarks = String(parameters.exceptionRemarks || "").trim();
  if (!key) throw new Error("Record key is required.");
  if (bucket && TAT_EXCEPTION_BUCKETS.indexOf(bucket) === -1) throw new Error("Invalid exception bucket.");
  if (remarks.length > 2000) throw new Error("Remarks must not exceed 2,000 characters.");
  if (typeof parameters.expectedBucket !== "string" || typeof parameters.expectedRemarks !== "string") {
    throw new Error("Reload the transaction before saving: previous bucket and remarks are required.");
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error("The pipeline or another save is updating the data. Your remarks have not been changed by this request. Please retry shortly.");
  try {
    const sheet = getSheet_(INWARD_TAT.SHEETS.FACT);
    const headers = sheet.getRange(1, 1, 1, 29).getValues()[0];
    const expectedHeaders = SHEET_DEFINITIONS.filter(function (entry) { return entry.name === INWARD_TAT.SHEETS.FACT; })[0].headers;
    if (headers.join("|") !== expectedHeaders.join("|")) throw new Error("Transaction schema has changed. Contact the administrator before saving.");
    // Read only the key column, then the one physical row. Do not reformat the
    // sheet or transfer all 29 columns for every individual remark save.
    const matches = [];
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (values, index) {
      if (String(values[0] || "") === key) matches.push(index + 2);
    });
    if (matches.length !== 1) throw new Error("Transaction is missing or duplicated. Refresh before saving.");
    const fact = { __row: matches[0] };
    const values = sheet.getRange(fact.__row, 1, 1, 29).getValues()[0];
    headers.forEach(function (header, column) { fact[header] = values[column]; });
    const alreadySaved = String(fact["Exception Bucket"] || "") === bucket && String(fact.Remarks || "") === remarks;
    if (!alreadySaved && (String(fact["Exception Bucket"] || "") !== parameters.expectedBucket || String(fact.Remarks || "") !== parameters.expectedRemarks)) {
      throw new Error("This exception was changed by another user. Refresh before saving.");
    }
    const kpi1 = fact["KPI1 Unloading to Putaway Hours"];
    if ((bucket || remarks) && !(typeof kpi1 === "number" && isFinite(kpi1) && kpi1 > 12)) {
      throw new Error("Only transactions with KPI1 greater than 12 hours can receive an exception. Refresh the data.");
    }
    const flag = tatExceptionFlag_(kpi1, bucket, remarks);
    sheet.getRange(fact.__row, 27, 1, 3).setValues([[flag, tatExceptionSheetText_(bucket), tatExceptionSheetText_(remarks)]]);
    SpreadsheetApp.flush();
    const month = apiDate_(fact["Unloading Date"]);
    const cache = CacheService.getScriptCache();
    cache.remove("INWARD_TAT_DASHBOARD_V2_CURRENT");
    if (month) cache.remove("INWARD_TAT_DASHBOARD_V2_" + month.slice(0, 7));
    return { ok: true, recordKey: key, exceptionFlag: flag, exceptionBucket: bucket, exceptionRemarks: remarks };
  } finally {
    lock.releaseLock();
  }
}
