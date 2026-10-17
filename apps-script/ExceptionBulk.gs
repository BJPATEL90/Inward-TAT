/** Small annotation uploads only; not the monthly GRN/Putaway import path. */
function bulkTatExceptions_(parameters, user, apply) {
  if (!isManualTaskUser_(user && user.email)) throw new Error("You are not authorised to edit exceptions.");
  const content = String(parameters.rows || "");
  if (content.length > 3000000) throw new Error("Bulk exception request is too large.");
  const inputs = JSON.parse(content);
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000) throw new Error("Upload between 1 and 1,000 exception rows.");
  const month = String(parameters.month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Select a valid reporting month.");
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureFactMatchingSchema_();
    const matrix = sheet.getRange(1, 1, sheet.getLastRow(), 29).getValues();
    const index = new Map();
    matrix.slice(1).forEach(function (values, position) {
      const key = String(values[0] || "");
      if (!key) return;
      if (index.has(key)) index.set(key, null);
      else index.set(key, { values: values, position: position });
    });
    const seen = new Set(), errors = [], updates = [];
    inputs.forEach(function (input, position) {
      input = input || {};
      const sourceRow = position + 2;
      const key = String(input.recordKey || "").trim();
      const bucket = String(input.exceptionBucket || "").trim();
      const remarks = String(input.exceptionRemarks || "").trim();
      let error = "";
      if (!key) error = "Record Key is required.";
      else if (seen.has(key)) error = "Duplicate Record Key in this file.";
      else if (bucket && TAT_EXCEPTION_BUCKETS.indexOf(bucket) === -1) error = "Invalid bucket: " + bucket + ". Choose an exact allowed bucket name.";
      else if (remarks.length > 2000) error = "Remarks exceed 2,000 characters.";
      seen.add(key);
      const match = index.get(key);
      if (!error && !match) error = "Record Key is missing or duplicated in the fact sheet.";
      if (!error) {
        const values = match.values;
        if (String(apiDate_(values[10]) || "").slice(0, 7) !== month) error = "Transaction is outside the selected reporting month.";
        else if ((bucket || remarks) && !(typeof values[9] === "number" && isFinite(values[9]) && values[9] > 12)) error = "KPI1 must exceed 12 hours to add an exception.";
        const currentBucket = String(values[27] || ""), currentRemarks = String(values[28] || "");
        const alreadyApplied = currentBucket === bucket && currentRemarks === remarks;
        if (!error && apply && (typeof input.expectedBucket !== "string" || typeof input.expectedRemarks !== "string")) error = "Preview this file before applying.";
        if (!error && apply && !alreadyApplied && (input.expectedBucket !== currentBucket || input.expectedRemarks !== currentRemarks)) error = "Saved values changed after preview. Preview again.";
        if (!error) updates.push({ recordKey: key, exceptionBucket: bucket, exceptionRemarks: remarks,
          exceptionFlag: tatExceptionFlag_(values[9], bucket, remarks), expectedBucket: currentBucket, expectedRemarks: currentRemarks,
          position: match.position, changed: !alreadyApplied || values[26] !== tatExceptionFlag_(values[9], bucket, remarks) });
      }
      if (error) errors.push({ row: sourceRow, recordKey: key, error: error });
    });
    if (errors.length) return { ok: true, valid: false, errors: errors, totalRows: inputs.length, appliedRows: 0 };
    const changes = updates.filter(function (row) { return row.changed; });
    if (apply && changes.length) {
      // One rectangular write touches only the three exception columns.
      // Unchanged cells are escaped as text too, preserving formula-like remarks.
      const values = matrix.slice(1).map(function (row) { return row.slice(26, 29).map(tatExceptionSheetText_); });
      changes.forEach(function (row) { values[row.position] = [row.exceptionFlag, tatExceptionSheetText_(row.exceptionBucket), tatExceptionSheetText_(row.exceptionRemarks)]; });
      sheet.getRange(2, 27, values.length, 3).setValues(values);
      SpreadsheetApp.flush();
      const cache = CacheService.getScriptCache();
      cache.remove("INWARD_TAT_DASHBOARD_V2_CURRENT");
      cache.remove("INWARD_TAT_DASHBOARD_V2_" + month);
    }
    return { ok: true, valid: true, totalRows: inputs.length, changedRows: changes.length, appliedRows: apply ? changes.length : 0,
      updates: updates.map(function (row) { return { recordKey: row.recordKey, exceptionBucket: row.exceptionBucket,
        exceptionRemarks: row.exceptionRemarks, exceptionFlag: row.exceptionFlag, expectedBucket: row.expectedBucket, expectedRemarks: row.expectedRemarks }; }) };
  } finally { lock.releaseLock(); }
}
