/**
 * Pending inward reminder engine.
 *
 * The Goods Inward Google Sheet is authoritative for milestone presence:
 * - a reporting timestamp with no unloading timestamp is waiting for unloading;
 * - an unloading timestamp with no GRN ID is waiting for GRN;
 * - a GRN ID with no Putaway ID is waiting for putaway;
 * - a Putaway ID closes the reminder.
 *
 * The source does not provide reliable GRN/Putaway event timestamps. This
 * engine therefore records the first time each ID is observed during its
 * 30-minute checks. KPI facts and their source timestamps are not modified.
 */

const INWARD_REMINDER = Object.freeze({
  STAGES: Object.freeze({
    WAITING_UNLOADING: "WAITING_UNLOADING",
    WAITING_GRN: "WAITING_GRN",
    WAITING_PUTAWAY: "WAITING_PUTAWAY",
    CLOSED: "CLOSED",
  }),
  LABELS: Object.freeze({
    WAITING_UNLOADING: "Reported - Waiting for Unloading",
    WAITING_GRN: "Waiting for GRN",
    WAITING_PUTAWAY: "Waiting for Putaway",
    CLOSED: "Closed",
  }),
});

function setupPendingReminderEngine() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = openInwardTatSpreadsheet_();
    ensurePendingReminderSheets_(spreadsheet, true);
    seedConfig_(getSheet_(INWARD_TAT.SHEETS.CONFIG));
    seedPendingReminderRecipients_();
    applyDataFormats_(spreadsheet);
    const trigger = installPendingReminderTrigger_();
    return {
      ok: true,
      sheets: [
        INWARD_TAT.SHEETS.REMINDER_CONFIG,
        INWARD_TAT.SHEETS.REMINDER_STATE,
        INWARD_TAT.SHEETS.REMINDER_PENDING,
        INWARD_TAT.SHEETS.REMINDER_LOG,
      ],
      trigger: trigger,
      nextStep:
        "Enter Primary Recipient(s) and Stakeholder CC in Reminder_Config, then run sendPendingReminderEmailNow for a controlled test.",
    };
  } finally {
    lock.releaseLock();
  }
}

function ensurePendingReminderSheets_(spreadsheet, applyStyle) {
  const reminderNames = new Set([
    INWARD_TAT.SHEETS.REMINDER_CONFIG,
    INWARD_TAT.SHEETS.REMINDER_STATE,
    INWARD_TAT.SHEETS.REMINDER_PENDING,
    INWARD_TAT.SHEETS.REMINDER_LOG,
  ]);
  SHEET_DEFINITIONS.filter(function (definition) {
    return reminderNames.has(definition.name);
  }).forEach(function (definition) {
    const sheet = getOrCreateSheet_(spreadsheet, definition.name);
    ensureHeaders_(sheet, definition.headers);
    if (applyStyle) styleSheet_(sheet, definition);
  });
}

function seedPendingReminderRecipients_() {
  const sheet = getSheet_(INWARD_TAT.SHEETS.REMINDER_CONFIG);
  if (sheet.getLastRow() > 1) return;
  sheet.getRange(2, 4).insertCheckboxes();
  sheet.getRange(2, 1, 1, 6).setValues([[
    "ALL",
    "",
    "",
    true,
    "Enter the action owner in Primary Recipient(s) and all other stakeholders in Stakeholder CC.",
    new Date(),
  ]]);
}

function installPendingReminderTrigger_() {
  const scheduledHours = pendingReminderScheduleHours_(getConfig_());
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (["runPendingReminderEngine", "sendScheduledPendingReminderEmail"].indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("runPendingReminderEngine")
    .timeBased()
    .everyMinutes(30)
    .create();
  scheduledHours.forEach(function (hour) {
    ScriptApp.newTrigger("sendScheduledPendingReminderEmail")
      .timeBased()
      .atHour(hour)
      .nearMinute(0)
      .everyDays(1)
      .inTimezone("Asia/Kolkata")
      .create();
  });
  return {
    checkHandler: "runPendingReminderEngine",
    checkSchedule: "Every 30 minutes",
    emailHandler: "sendScheduledPendingReminderEmail",
    emailHours: scheduledHours,
    timeZone: "Asia/Kolkata",
  };
}

function installPendingReminderTrigger() {
  const result = installPendingReminderTrigger_();
  return { ok: true, trigger: result };
}

function runPendingReminderEngine() {
  return runPendingReminderEngine_("CHECK_ONLY");
}

function sendScheduledPendingReminderEmail() {
  return runPendingReminderEngine_("SCHEDULED");
}

function sendPendingReminderEmailNow() {
  return runPendingReminderEngine_("FORCE");
}

function runPendingReminderEngine_(emailMode) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const startedAt = new Date();
  const runId = "REMINDER-" + Utilities.getUuid();
  try {
    const spreadsheet = openInwardTatSpreadsheet_();
    ensurePendingReminderSheets_(spreadsheet, false);
    seedConfig_(getSheet_(INWARD_TAT.SHEETS.CONFIG));
    seedPendingReminderRecipients_();
    const config = getConfig_();
    if (String(config.REMINDER_ENABLED || "TRUE").toUpperCase() !== "TRUE") {
      logExecution_(runId, "PENDING_REMINDER", "SKIPPED", "Pending reminder engine is disabled in Config.", {});
      return { ok: true, status: "DISABLED" };
    }

    const previousRows = reminderSheetObjects_(getSheet_(INWARD_TAT.SHEETS.REMINDER_STATE));
    const previousByKey = new Map();
    previousRows.forEach(function (row) {
      const key = String(row["Reminder Key"] || "").trim();
      if (key) previousByKey.set(key, row);
    });
    const sourceRows = readPendingReminderSource_(config, previousRows);
    const stateRows = reconcilePendingReminderState_(sourceRows, previousByKey, startedAt);
    const pendingRows = buildPendingReminderRows_(stateRows, config, startedAt);
    writePendingReminderState_(stateRows);
    writePendingReminderSnapshot_(pendingRows);

    const eligible = pendingRows.filter(function (row) {
      return row.emailEligible === true;
    });
    const timeZone = String(config.TIME_ZONE || "Asia/Kolkata");
    const slot = emailMode === "FORCE"
      ? "MANUAL " + Utilities.formatDate(startedAt, timeZone, "yyyy-MM-dd HH:mm:ss") + " " + runId
      : emailMode === "SCHEDULED"
        ? pendingReminderScheduleSlot_(startedAt, config)
        : "";
    let emailResult = {
      status: emailMode === "CHECK_ONLY" ? "CHECK_ONLY" : slot ? "NO_PENDING" : "OUTSIDE_SCHEDULE",
      sent: 0,
    };
    if (slot && eligible.length) {
      emailResult = sendPendingReminderEmails_(eligible, config, slot, runId, startedAt);
      if (emailResult.sentKeys.size) {
        stateRows.forEach(function (row) {
          if (emailResult.sentKeys.has(row.reminderKey)) {
            row.lastReminderSlot = slot;
            row.lastReminderAt = startedAt;
          }
        });
        writePendingReminderState_(stateRows);
      }
      emailResult = {
        status: emailResult.status,
        sent: emailResult.sent,
        parts: emailResult.parts,
      };
    }

    logExecution_(
      runId,
      "PENDING_REMINDER",
      "COMPLETED",
      "Reminder source checked; " + pendingRows.length + " open record(s), " + eligible.length + " email-eligible record(s), email status " + emailResult.status + ".",
      {
        rowsRead: sourceRows.length,
        rowsImported: pendingRows.length,
        rowsSkipped: pendingRows.length - eligible.length,
        durationSeconds: (new Date().getTime() - startedAt.getTime()) / 1000,
      }
    );
    return {
      ok: true,
      checkedAt: startedAt.toISOString(),
      sourceRows: sourceRows.length,
      openRows: pendingRows.length,
      eligibleRows: eligible.length,
      email: emailResult,
    };
  } catch (error) {
    try {
      logExecution_(runId, "PENDING_REMINDER", "FAILED", error.message || String(error), {
        durationSeconds: (new Date().getTime() - startedAt.getTime()) / 1000,
      });
    } catch (ignoredLogError) {}
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function readPendingReminderSource_(config, previousRows) {
  const sourceId = String(config.GOODS_SOURCE_SPREADSHEET_ID || "").trim();
  if (!sourceId) throw new Error("GOODS_SOURCE_SPREADSHEET_ID is blank.");
  const source = SpreadsheetApp.openById(sourceId);
  const sourceSheets = resolveGoodsSourceSheets_(source, config).slice();
  const sourceSheetNames = new Set(sourceSheets.map(function (sheet) {
    return sheet.getName();
  }));
  previousRows.forEach(function (row) {
    if (String(row["Source Spreadsheet Id"] || "").trim() !== sourceId) return;
    if (String(row["Current Stage"] || "") === INWARD_REMINDER.STAGES.CLOSED) return;
    const sourceSheetName = String(row["Source Sheet"] || "").trim();
    if (!sourceSheetName || sourceSheetNames.has(sourceSheetName)) return;
    const sourceSheet = source.getSheetByName(sourceSheetName);
    if (!sourceSheet) return;
    sourceSheets.push(sourceSheet);
    sourceSheetNames.add(sourceSheetName);
  });

  const allowedFacilities = String(config.GOODS_ALLOWED_FACILITIES || "SL Mother Hub|SL Ambient")
    .split("|")
    .map(normalizeFacility_)
    .filter(Boolean);
  const output = [];
  const reminderKeys = new Set();
  sourceSheets.forEach(function (sheet) {
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return;
    const headers = values[0].map(cleanHeader_);
    const indexes = headerIndex_(headers);
    const facilityIndex = indexes[normalizeHeader_("Received at")];
    if (facilityIndex === undefined) {
      throw new Error("Reminder source tab " + sheet.getName() + " is missing the Received at column.");
    }
    values.slice(1).forEach(function (row, index) {
      const facility = normalizeFacility_(row[facilityIndex]);
      if (allowedFacilities.indexOf(facility) === -1) return;
      const reportingDate = reminderSourceValue_(row, indexes, ["Reporting date"]);
      const reportingTime = reminderSourceValue_(row, indexes, ["Reporting Time"]);
      const unloadingDate = reminderSourceValue_(row, indexes, ["Unloading Date"]);
      const unloadingTime = reminderSourceValue_(row, indexes, ["Unloading Time"]);
      const reportingTimestamp = combineDateAndTime_(reportingDate, reportingTime) || parseDateTime_(reportingDate);
      const unloadingTimestamp = combineDateAndTime_(unloadingDate, unloadingTime) || parseDateTime_(unloadingDate);
      const grnId = reminderText_(reminderSourceValue_(row, indexes, ["GRN no.", "GRN no", "GRN Number"]));
      const putawayId = reminderText_(reminderSourceValue_(row, indexes, ["Putaway No", "Putaway No.", "Putaway ID"]));
      const invoiceNumber = reminderText_(reminderSourceValue_(row, indexes, ["Invoice number", "Invoice No"]));
      const sku = reminderText_(reminderSourceValue_(row, indexes, ["SKU"]));
      const vehicleNumber = reminderText_(reminderSourceValue_(row, indexes, ["Vehicle Number"]));
      const serialNumber = reminderText_(reminderSourceValue_(row, indexes, ["SR NO.", "SR NO", "Serial Number"]));
      if (!reportingTimestamp && !unloadingTimestamp && !grnId && !putawayId) return;
      const sourceRow = index + 2;
      const sourceIdentity = serialNumber
        ? "SR:" + serialNumber + "|SKU:" + sku + "|INV:" + invoiceNumber
        : "ROW:" + sourceRow;
      let reminderKey = [sourceId, sheet.getName(), sourceIdentity].join("|");
      if (reminderKeys.has(reminderKey)) reminderKey += "|ROW:" + sourceRow;
      reminderKeys.add(reminderKey);
      output.push({
        reminderKey: reminderKey,
        sourceSpreadsheetId: sourceId,
        sourceSheet: sheet.getName(),
        sourceRow: sourceRow,
        facility: facility,
        reportingTimestamp: reportingTimestamp,
        unloadingTimestamp: unloadingTimestamp,
        grnId: grnId,
        putawayId: putawayId,
        vendor: reminderText_(reminderSourceValue_(row, indexes, ["From Vendor", "Vendor Name"])),
        invoiceNumber: invoiceNumber,
        invoiceDate: reminderSourceValue_(row, indexes, ["Invoice Date"]),
        sku: sku,
        skuName: reminderText_(reminderSourceValue_(row, indexes, ["Item Name", "SKU Name"])),
        vehicleNumber: vehicleNumber,
      });
    });
  });
  return output;
}

function reminderSourceValue_(row, indexes, aliases) {
  for (let index = 0; index < aliases.length; index += 1) {
    const column = indexes[normalizeHeader_(aliases[index])];
    if (column !== undefined) return row[column];
  }
  return "";
}

function reminderText_(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function reconcilePendingReminderState_(sourceRows, previousByKey, checkedAt) {
  const seen = new Set();
  const seenSourceRows = new Set(sourceRows.map(pendingReminderSourceRowKey_));
  const output = sourceRows.map(function (source) {
    seen.add(source.reminderKey);
    const previous = previousByKey.get(source.reminderKey) || {};
    const previousGrnId = reminderText_(previous["GRN ID"]);
    const previousPutawayId = reminderText_(previous["Putaway ID"]);
    let grnObservedAt = parseDateTime_(previous["GRN Observed At"]);
    let putawayObservedAt = parseDateTime_(previous["Putaway Observed At"]);
    if (source.grnId && source.grnId !== previousGrnId) grnObservedAt = checkedAt;
    if (source.putawayId && source.putawayId !== previousPutawayId) putawayObservedAt = checkedAt;

    const stage = source.putawayId
      ? INWARD_REMINDER.STAGES.CLOSED
      : source.grnId
        ? INWARD_REMINDER.STAGES.WAITING_PUTAWAY
        : source.unloadingTimestamp
          ? INWARD_REMINDER.STAGES.WAITING_GRN
          : source.reportingTimestamp
            ? INWARD_REMINDER.STAGES.WAITING_UNLOADING
            : "";
    const previousStage = reminderText_(previous["Current Stage"]);
    const previousStageEntered = parseDateTime_(previous["Stage Entered At"]);
    const stageEnteredAt = stage === previousStage && previousStageEntered
      ? previousStageEntered
      : stage === INWARD_REMINDER.STAGES.WAITING_UNLOADING
        ? source.reportingTimestamp || checkedAt
        : stage === INWARD_REMINDER.STAGES.WAITING_GRN
          ? source.unloadingTimestamp || checkedAt
          : stage === INWARD_REMINDER.STAGES.WAITING_PUTAWAY
            ? grnObservedAt || checkedAt
            : stage === INWARD_REMINDER.STAGES.CLOSED
              ? putawayObservedAt || checkedAt
              : checkedAt;
    const previousClosed = parseDateTime_(previous["Closed At"]);
    const closedAt = stage === INWARD_REMINDER.STAGES.CLOSED
      ? previousStage === INWARD_REMINDER.STAGES.CLOSED && previousPutawayId === source.putawayId && previousClosed
        ? previousClosed
        : putawayObservedAt || checkedAt
      : null;
    return {
      reminderKey: source.reminderKey,
      sourceSpreadsheetId: source.sourceSpreadsheetId,
      sourceSheet: source.sourceSheet,
      sourceRow: source.sourceRow,
      facility: source.facility,
      reportingTimestamp: source.reportingTimestamp,
      unloadingTimestamp: source.unloadingTimestamp,
      grnId: source.grnId,
      grnObservedAt: grnObservedAt,
      putawayId: source.putawayId,
      putawayObservedAt: putawayObservedAt,
      currentStage: stage,
      stageEnteredAt: stageEnteredAt,
      firstSeenAt: parseDateTime_(previous["First Seen At"]) || checkedAt,
      lastSeenAt: checkedAt,
      closedAt: closedAt,
      lastReminderSlot: reminderText_(previous["Last Reminder Slot"]),
      lastReminderAt: parseDateTime_(previous["Last Reminder At"]),
      vendor: source.vendor,
      invoiceNumber: source.invoiceNumber,
      invoiceDate: source.invoiceDate,
      sku: source.sku,
      skuName: source.skuName,
      vehicleNumber: source.vehicleNumber,
      sourcePresent: true,
    };
  });

  previousByKey.forEach(function (previous, key) {
    if (seen.has(key)) return;
    if (seenSourceRows.has(pendingReminderSourceRowKey_(previous))) return;
    output.push(reminderStateObjectFromSheet_(previous, false));
  });
  return output.filter(function (row) {
    return Boolean(row.reminderKey && row.currentStage);
  });
}

function pendingReminderSourceRowKey_(row) {
  const spreadsheetId = reminderText_(row.sourceSpreadsheetId || row["Source Spreadsheet Id"]);
  const sheetName = reminderText_(row.sourceSheet || row["Source Sheet"]);
  const sourceRow = reminderText_(row.sourceRow || row["Source Row"]);
  return [spreadsheetId, sheetName, sourceRow].join("|");
}

function reminderStateObjectFromSheet_(row, sourcePresent) {
  return {
    reminderKey: reminderText_(row["Reminder Key"]),
    sourceSpreadsheetId: reminderText_(row["Source Spreadsheet Id"]),
    sourceSheet: reminderText_(row["Source Sheet"]),
    sourceRow: row["Source Row"] || "",
    facility: reminderText_(row.Facility),
    reportingTimestamp: parseDateTime_(row["Reporting Timestamp"]),
    unloadingTimestamp: parseDateTime_(row["Unloading Timestamp"]),
    grnId: reminderText_(row["GRN ID"]),
    grnObservedAt: parseDateTime_(row["GRN Observed At"]),
    putawayId: reminderText_(row["Putaway ID"]),
    putawayObservedAt: parseDateTime_(row["Putaway Observed At"]),
    currentStage: reminderText_(row["Current Stage"]),
    stageEnteredAt: parseDateTime_(row["Stage Entered At"]),
    firstSeenAt: parseDateTime_(row["First Seen At"]),
    lastSeenAt: parseDateTime_(row["Last Seen At"]),
    closedAt: parseDateTime_(row["Closed At"]),
    lastReminderSlot: reminderText_(row["Last Reminder Slot"]),
    lastReminderAt: parseDateTime_(row["Last Reminder At"]),
    vendor: reminderText_(row.Vendor),
    invoiceNumber: reminderText_(row["Invoice Number"]),
    invoiceDate: row["Invoice Date"] || "",
    sku: reminderText_(row.SKU),
    skuName: reminderText_(row["SKU Name"]),
    vehicleNumber: reminderText_(row["Vehicle Number"]),
    sourcePresent: sourcePresent,
  };
}

function buildPendingReminderRows_(stateRows, config, checkedAt) {
  const grnHours = Math.max(Number(config.REMINDER_GRN_SLA_HOURS) || 2, 0);
  const putawayHours = Math.max(Number(config.REMINDER_PUTAWAY_SLA_HOURS) || 10, 0);
  return stateRows.filter(function (row) {
    return row.currentStage !== INWARD_REMINDER.STAGES.CLOSED;
  }).map(function (row) {
    let dueAt = row.stageEnteredAt;
    if (row.currentStage === INWARD_REMINDER.STAGES.WAITING_GRN && row.unloadingTimestamp) {
      dueAt = new Date(row.unloadingTimestamp.getTime() + grnHours * 3600000);
    }
    if (row.currentStage === INWARD_REMINDER.STAGES.WAITING_PUTAWAY && row.grnObservedAt) {
      dueAt = new Date(row.grnObservedAt.getTime() + putawayHours * 3600000);
    }
    const ageingStart = row.currentStage === INWARD_REMINDER.STAGES.WAITING_UNLOADING
      ? row.reportingTimestamp
      : row.currentStage === INWARD_REMINDER.STAGES.WAITING_GRN
        ? row.unloadingTimestamp
        : row.grnObservedAt;
    const ageingHours = ageingStart ? Math.max(hoursBetween_(ageingStart, checkedAt), 0) : null;
    const emailEligible = Boolean(row.sourcePresent && dueAt && checkedAt >= dueAt);
    return Object.assign({}, row, {
      dueAt: dueAt,
      ageingHours: ageingHours,
      emailEligible: emailEligible,
      checkedAt: checkedAt,
    });
  }).sort(function (a, b) {
    const stageOrder = {};
    stageOrder[INWARD_REMINDER.STAGES.WAITING_UNLOADING] = 1;
    stageOrder[INWARD_REMINDER.STAGES.WAITING_GRN] = 2;
    stageOrder[INWARD_REMINDER.STAGES.WAITING_PUTAWAY] = 3;
    return (stageOrder[a.currentStage] || 9) - (stageOrder[b.currentStage] || 9) ||
      ((b.ageingHours || 0) - (a.ageingHours || 0));
  });
}

function writePendingReminderState_(rows) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.REMINDER_STATE);
  const values = rows.map(function (row) {
    return [
      row.reminderKey, row.sourceSpreadsheetId, row.sourceSheet, row.sourceRow,
      row.facility, row.reportingTimestamp || "", row.unloadingTimestamp || "", row.grnId,
      row.grnObservedAt || "", row.putawayId, row.putawayObservedAt || "", row.currentStage,
      row.stageEnteredAt || "", row.firstSeenAt || "", row.lastSeenAt || "", row.closedAt || "",
      row.lastReminderSlot, row.lastReminderAt || "", row.vendor, row.invoiceNumber,
      row.invoiceDate || "", row.sku, row.skuName, row.vehicleNumber, row.sourcePresent ? "YES" : "NO",
    ];
  });
  clearDataRows_(sheet);
  writeRowsInBatches_(sheet, values, 500);
}

function writePendingReminderSnapshot_(rows) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.REMINDER_PENDING);
  const values = rows.map(function (row) {
    const eligibleLabel = row.sourcePresent
      ? row.emailEligible ? "YES" : "NO - WITHIN SLA"
      : "NO - SOURCE MISSING";
    return [
      row.reminderKey, INWARD_REMINDER.LABELS[row.currentStage] || row.currentStage,
      row.facility, row.vehicleNumber, row.reportingTimestamp || "", row.unloadingTimestamp || "",
      row.grnId, row.grnObservedAt || "", row.putawayId, row.dueAt || "",
      row.ageingHours === null ? "" : validHours_(row.ageingHours), eligibleLabel,
      row.vendor, row.invoiceNumber, row.invoiceDate || "", row.sku, row.skuName,
      row.sourceSheet, row.sourceRow, row.checkedAt,
    ];
  });
  clearDataRows_(sheet);
  writeRowsInBatches_(sheet, values, 500);
}

function pendingReminderScheduleSlot_(now, config) {
  const timeZone = String(config.TIME_ZONE || "Asia/Kolkata");
  const scheduledHours = pendingReminderScheduleHours_(config);
  const hour = Number(Utilities.formatDate(now, timeZone, "H"));
  return scheduledHours.indexOf(hour) === -1
    ? ""
    : Utilities.formatDate(now, timeZone, "yyyy-MM-dd") + " " + String(hour).padStart(2, "0") + ":00";
}

function pendingReminderScheduleHours_(config) {
  const hours = String(config.REMINDER_SCHEDULE_HOURS || "3|7|10|13|15|17|19|23")
    .split(/[|,;\s]+/)
    .map(Number)
    .filter(function (hour) {
      return Number.isInteger(hour) && hour >= 0 && hour <= 23;
    });
  const unique = Array.from(new Set(hours)).sort(function (a, b) { return a - b; });
  if (!unique.length) throw new Error("REMINDER_SCHEDULE_HOURS does not contain a valid hour.");
  return unique;
}

function sendPendingReminderEmails_(rows, config, slot, runId, generatedAt) {
  const recipients = pendingReminderRecipients_(rows);
  if (!recipients.to.length) {
    return { status: "RECIPIENTS_NOT_CONFIGURED", sent: 0, parts: 0, sentKeys: new Set() };
  }
  const maxRows = Math.max(Math.min(Number(config.REMINDER_EMAIL_MAX_ROWS) || 100, 200), 1);
  const parts = [];
  for (let index = 0; index < rows.length; index += maxRows) {
    parts.push(rows.slice(index, index + maxRows));
  }
  const sentKeys = new Set();
  let sent = 0;
  parts.forEach(function (partRows, index) {
    const partNumber = index + 1;
    if (reminderPartAlreadySent_(slot, partNumber)) {
      partRows.forEach(function (row) { sentKeys.add(row.reminderKey); });
      return;
    }
    const counts = pendingReminderCounts_(partRows);
    const suffix = parts.length > 1 ? " | Part " + partNumber + " of " + parts.length : "";
    const subject = "Action required: " + rows.length + " inward task(s) pending" + suffix;
    try {
      GmailApp.sendEmail(
        recipients.to.join(","),
        subject,
        buildPendingReminderPlainText_(partRows, generatedAt, config),
        {
          htmlBody: buildPendingReminderHtml_(partRows, generatedAt, config, partNumber, parts.length),
          cc: recipients.cc.join(","),
          name: "Mosaic Wellness | Inward Pending Reminder",
        }
      );
      appendPendingReminderLog_([
        runId, generatedAt, slot, partNumber, parts.length, recipients.to.join(", "),
        recipients.cc.join(", "), counts.waitingUnloading, counts.waitingGrn,
        counts.waitingPutaway, partRows.length, "SENT", "",
      ]);
      partRows.forEach(function (row) { sentKeys.add(row.reminderKey); });
      sent += 1;
    } catch (error) {
      appendPendingReminderLog_([
        runId, generatedAt, slot, partNumber, parts.length, recipients.to.join(", "),
        recipients.cc.join(", "), counts.waitingUnloading, counts.waitingGrn,
        counts.waitingPutaway, partRows.length, "FAILED", error.message || String(error),
      ]);
      throw error;
    }
  });
  return {
    status: sent ? "SENT" : "ALREADY_SENT",
    sent: sent,
    parts: parts.length,
    sentKeys: sentKeys,
  };
}

function pendingReminderRecipients_(rows) {
  const facilities = new Set(rows.map(function (row) { return normalizeFacility_(row.facility); }).filter(Boolean));
  const to = new Set();
  const cc = new Set();
  reminderSheetObjects_(getSheet_(INWARD_TAT.SHEETS.REMINDER_CONFIG)).forEach(function (row) {
    const active = String(row.Active === true ? "TRUE" : row.Active || "").trim().toUpperCase();
    if (["TRUE", "YES", "Y", "1"].indexOf(active) === -1) return;
    const scopeText = String(row["Facility Scope"] || "ALL").trim();
    const scope = scopeText.toUpperCase() === "ALL" ? "ALL" : normalizeFacility_(scopeText);
    if (scope !== "ALL" && !facilities.has(scope)) return;
    parsePendingReminderEmails_(row["Primary Recipient(s)"]).forEach(function (email) { to.add(email); });
    parsePendingReminderEmails_(row["Stakeholder CC"]).forEach(function (email) { cc.add(email); });
  });
  to.forEach(function (email) { cc.delete(email); });
  return { to: Array.from(to), cc: Array.from(cc) };
}

function parsePendingReminderEmails_(value) {
  const emails = String(value || "").split(/[;,\n]+/).map(function (email) {
    return email.trim().toLowerCase();
  }).filter(Boolean);
  const invalid = emails.filter(function (email) {
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  });
  if (invalid.length) throw new Error("Invalid pending reminder recipient(s): " + invalid.join(", "));
  return emails;
}

function reminderPartAlreadySent_(slot, partNumber) {
  return reminderSheetObjects_(getSheet_(INWARD_TAT.SHEETS.REMINDER_LOG)).some(function (row) {
    return String(row["Schedule Slot"] || "") === slot &&
      Number(row.Part) === Number(partNumber) &&
      String(row.Status || "").toUpperCase() === "SENT";
  });
}

function appendPendingReminderLog_(row) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.REMINDER_LOG);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function pendingReminderCounts_(rows) {
  const counts = { waitingUnloading: 0, waitingGrn: 0, waitingPutaway: 0 };
  rows.forEach(function (row) {
    if (row.currentStage === INWARD_REMINDER.STAGES.WAITING_UNLOADING) counts.waitingUnloading += 1;
    if (row.currentStage === INWARD_REMINDER.STAGES.WAITING_GRN) counts.waitingGrn += 1;
    if (row.currentStage === INWARD_REMINDER.STAGES.WAITING_PUTAWAY) counts.waitingPutaway += 1;
  });
  return counts;
}

function buildPendingReminderHtml_(rows, generatedAt, config, partNumber, partCount) {
  const timeZone = String(config.TIME_ZONE || "Asia/Kolkata");
  const counts = pendingReminderCounts_(rows);
  const sections = [
    { stage: INWARD_REMINDER.STAGES.WAITING_UNLOADING, label: "Reported - Waiting for Unloading", color: "#b45309", background: "#fff7ed" },
    { stage: INWARD_REMINDER.STAGES.WAITING_GRN, label: "Waiting for GRN", color: "#b42318", background: "#fff1f0" },
    { stage: INWARD_REMINDER.STAGES.WAITING_PUTAWAY, label: "Waiting for Putaway", color: "#2443c4", background: "#eef2ff" },
  ];
  const sectionHtml = sections.map(function (section) {
    const stageRows = rows.filter(function (row) { return row.currentStage === section.stage; });
    if (!stageRows.length) return "";
    const body = stageRows.map(function (row) {
      return '<tr>' +
        reminderEmailCell_("Facility / Vehicle", '<strong>' + reminderHtmlEscape_(row.facility || "-") + '</strong><br><span>' + reminderHtmlEscape_(row.vehicleNumber || "No vehicle number") + '</span>') +
        reminderEmailCell_("Reporting", formatPendingReminderTimestamp_(row.reportingTimestamp, timeZone)) +
        reminderEmailCell_("Unloading", formatPendingReminderTimestamp_(row.unloadingTimestamp, timeZone)) +
        reminderEmailCell_("Vendor", reminderHtmlEscape_(row.vendor || "-")) +
        reminderEmailCell_("Invoice", '<strong>' + reminderHtmlEscape_(row.invoiceNumber || "-") + '</strong><br><span>' + reminderHtmlEscape_(formatPendingReminderDate_(row.invoiceDate, timeZone)) + '</span>') +
        reminderEmailCell_("SKU", '<strong>' + reminderHtmlEscape_(row.sku || "-") + '</strong><br><span>' + reminderHtmlEscape_(row.skuName || "-") + '</span>') +
        reminderEmailCell_("Pending / Ageing", pendingReminderStatusHtml_(row, timeZone)) +
        '</tr>';
    }).join("");
    return '<div style="margin-top:22px;border:1px solid #d9e1ef;border-radius:14px;overflow:hidden;background:#ffffff">' +
      '<div style="padding:14px 16px;background:' + section.background + ';border-left:5px solid ' + section.color + ';font-size:16px;font-weight:800;color:' + section.color + '">' +
      reminderHtmlEscape_(section.label) + ' <span style="font-size:12px;font-weight:700">(' + stageRows.length + ')</span></div>' +
      '<table class="pending-table" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;table-layout:fixed">' +
      '<thead><tr style="background:#f7f9fc;color:#51617a;font-size:10px;text-transform:uppercase;letter-spacing:.35px">' +
      '<th style="width:12%">Facility / Vehicle</th><th style="width:12%">Reporting</th><th style="width:12%">Unloading</th><th style="width:14%">Vendor</th><th style="width:13%">Invoice / Date</th><th style="width:18%">SKU / Name</th><th style="width:19%">Pending / Ageing</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }).join("");
  const partLabel = partCount > 1 ? "Part " + partNumber + " of " + partCount + " | " : "";
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    'body{margin:0;padding:0;background:#f2f5fa;font-family:Arial,sans-serif;color:#172033}.pending-table th{padding:11px 9px;text-align:left;border-bottom:1px solid #d9e1ef}.pending-table td{padding:11px 9px;border-bottom:1px solid #e8edf5;vertical-align:top;font-size:11px;line-height:1.45;overflow-wrap:anywhere}.pending-table td span{color:#66758c;font-size:10px}' +
    '@media only screen and (max-width:700px){.shell{width:100%!important;border-radius:0!important}.pending-table thead{display:none!important}.pending-table,.pending-table tbody,.pending-table tr,.pending-table td{display:block!important;width:100%!important;box-sizing:border-box!important}.pending-table tr{padding:8px 10px;border-bottom:8px solid #f2f5fa}.pending-table td{padding:6px 8px 6px 42%!important;border:0!important;position:relative!important;min-height:28px}.pending-table td:before{content:attr(data-label);position:absolute;left:8px;top:6px;width:38%;font-size:9px;font-weight:800;text-transform:uppercase;color:#65758d}.summary-cell{display:block!important;width:100%!important;box-sizing:border-box!important;margin-bottom:8px!important}}' +
    '</style></head><body><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:18px 8px"><table class="shell" role="presentation" width="1120" cellspacing="0" cellpadding="0" style="width:100%;max-width:1120px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(29,52,117,.10)">' +
    '<tr><td style="padding:24px 26px;background:#1d3475;color:#ffffff"><div style="font-size:12px;letter-spacing:.9px;text-transform:uppercase;color:#cbd7ff">Inward operations reminder</div><div style="font-size:25px;font-weight:800;margin-top:6px">Pending Uniware updates</div><div style="font-size:12px;color:#dce4ff;margin-top:8px">' + partLabel + 'Generated ' + reminderHtmlEscape_(Utilities.formatDate(generatedAt, timeZone, "dd MMM yyyy, hh:mm a")) + ' IST</div></td></tr>' +
    '<tr><td style="padding:20px 24px 28px"><table role="presentation" width="100%" cellspacing="8" cellpadding="0"><tr>' +
    pendingReminderSummaryCard_("Waiting unloading", counts.waitingUnloading, "#b45309", "#fff7ed") +
    pendingReminderSummaryCard_("Waiting GRN", counts.waitingGrn, "#b42318", "#fff1f0") +
    pendingReminderSummaryCard_("Waiting putaway", counts.waitingPutaway, "#2443c4", "#eef2ff") +
    '</tr></table><div style="font-size:12px;line-height:18px;color:#5c6b85;margin:12px 4px 0">This is a system-generated reminder. Records stop appearing after the required source ID is detected during a 30-minute backend check.</div>' +
    sectionHtml +
    '<div style="margin-top:22px;padding-top:14px;border-top:1px solid #e2e8f2;font-size:10px;color:#718096">GRN due: unloading + ' + reminderHtmlEscape_(config.REMINDER_GRN_SLA_HOURS || 2) + ' hours. Putaway due: first observed GRN ID + ' + reminderHtmlEscape_(config.REMINDER_PUTAWAY_SLA_HOURS || 10) + ' hours. Times shown in Asia/Kolkata.</div>' +
    '</td></tr></table></td></tr></table></body></html>';
}

function reminderEmailCell_(label, html) {
  return '<td data-label="' + reminderHtmlEscape_(label) + '">' + html + '</td>';
}

function pendingReminderSummaryCard_(label, count, color, background) {
  return '<td class="summary-cell" width="33.33%" style="padding:15px 12px;border-radius:12px;background:' + background + ';border-top:4px solid ' + color + ';text-align:center"><div style="font-size:11px;font-weight:700;color:#5c6b85">' + reminderHtmlEscape_(label) + '</div><div style="font-size:27px;font-weight:800;color:' + color + ';margin-top:4px">' + count + '</div></td>';
}

function pendingReminderStatusHtml_(row, timeZone) {
  const label = row.currentStage === INWARD_REMINDER.STAGES.WAITING_UNLOADING
    ? "Unloading not updated"
    : row.currentStage === INWARD_REMINDER.STAGES.WAITING_GRN
      ? "GRN ID not updated"
      : "Putaway ID not updated";
  const grn = row.currentStage === INWARD_REMINDER.STAGES.WAITING_PUTAWAY && row.grnId
    ? '<br><span>GRN: ' + reminderHtmlEscape_(row.grnId) + '</span>'
    : "";
  return '<strong style="color:#b42318">' + reminderHtmlEscape_(label) + '</strong>' + grn +
    '<br><span>Due: ' + reminderHtmlEscape_(formatPendingReminderTimestamp_(row.dueAt, timeZone)) + '</span>' +
    '<br><strong>' + reminderHtmlEscape_(formatPendingReminderAge_(row.ageingHours)) + '</strong>';
}

function buildPendingReminderPlainText_(rows, generatedAt, config) {
  const timeZone = String(config.TIME_ZONE || "Asia/Kolkata");
  const lines = [
    "INWARD OPERATIONS - PENDING UNIWARE UPDATES",
    "Generated: " + Utilities.formatDate(generatedAt, timeZone, "dd MMM yyyy, hh:mm a") + " IST",
    "",
  ];
  rows.forEach(function (row) {
    lines.push([
      INWARD_REMINDER.LABELS[row.currentStage] || row.currentStage,
      row.facility || "-",
      "Vehicle " + (row.vehicleNumber || "-"),
      "Reporting " + formatPendingReminderTimestamp_(row.reportingTimestamp, timeZone),
      "Unloading " + formatPendingReminderTimestamp_(row.unloadingTimestamp, timeZone),
      "Vendor " + (row.vendor || "-"),
      "Invoice " + (row.invoiceNumber || "-") + " / " + formatPendingReminderDate_(row.invoiceDate, timeZone),
      "SKU " + (row.sku || "-") + " / " + (row.skuName || "-"),
      "Due " + formatPendingReminderTimestamp_(row.dueAt, timeZone),
      formatPendingReminderAge_(row.ageingHours),
    ].join(" | "));
  });
  return lines.join("\n");
}

function formatPendingReminderTimestamp_(value, timeZone) {
  const date = parseDateTime_(value);
  return date ? Utilities.formatDate(date, timeZone, "dd MMM yyyy, hh:mm a") : "-";
}

function formatPendingReminderDate_(value, timeZone) {
  const date = parseDateTime_(value);
  return date ? Utilities.formatDate(date, timeZone, "dd MMM yyyy") : reminderText_(value) || "-";
}

function formatPendingReminderAge_(hours) {
  if (hours === null || hours === undefined || !isFinite(Number(hours))) return "Ageing unavailable";
  const minutes = Math.max(Math.round(Number(hours) * 60), 0);
  return "Ageing " + Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m";
}

function reminderHtmlEscape_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function reminderSheetObjects_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(cleanHeader_);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.map(function (row, index) {
    const result = { __row: index + 2 };
    headers.forEach(function (header, column) {
      result[header] = row[column];
    });
    return result;
  }).filter(function (row) {
    return headers.some(function (header) { return row[header] !== ""; });
  });
}
