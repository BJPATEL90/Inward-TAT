/**
 * Inward TAT — Phase 2 pipeline
 *
 * Responsibilities:
 * 1. Read the manual Goods Inward tracker when configured.
 * 2. Locate GRN and named facility Putaway exports in Gmail.
 * 3. Download and normalize the CSV data.
 * 4. Deduplicate by stable source keys.
 * 5. Rebuild Facility + SKU + GRN facts, exceptions and MTD summaries.
 *
 * This file expects Code.gs from Phase 1 in the same Apps Script project.
 */

function runInwardTatPipeline() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const startedAt = new Date();
  const runId = Utilities.getUuid();

  try {
    logExecution_(runId, "PIPELINE", "STARTED", "Inward TAT pipeline started.", {});
    const config = getConfig_();
    logExecution_(runId, "CONFIG", "COMPLETED", "Configuration loaded.", {});
    const results = {
      goods: syncGoodsInward_(config, runId),
      grn: importUnicommerceEmails_("GRN", config, runId),
      putaway: importUnicommerceEmails_("PUTAWAY", config, runId),
    };

    logExecution_(runId, "DEDUPE", "STARTED", "Removing duplicate GRN and shelf-level Putaway rows.", {});
    dedupeRawReportSheets_();
    logExecution_(runId, "DEDUPE", "COMPLETED", "Raw report deduplication completed.", {});
    logExecution_(runId, "KPI_REBUILD", "STARTED", "Pivoting Putaway shelves and rebuilding KPI facts.", {});
    const processing = rebuildTatFacts_(config, runId);
    logExecution_(
      runId,
      "KPI_REBUILD",
      "COMPLETED",
      "KPI facts and MTD summary rebuilt.",
      {
        rowsRead: processing.factRows,
        rowsImported: processing.completeRows,
        rowsSkipped: processing.exceptionRows,
      }
    );
    updateConfigValue_("LAST_SUCCESSFUL_REFRESH", new Date());
    logExecution_(
      runId,
      "PIPELINE",
      "COMPLETED",
      "Inward TAT pipeline completed successfully.",
      { durationSeconds: (new Date().getTime() - startedAt.getTime()) / 1000 }
    );

    return {
      ok: true,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      imports: results,
      processing: processing,
    };
  } catch (error) {
    try {
      logExecution_(
        runId,
        "PIPELINE",
        "FAILED",
        error.message || String(error),
        { durationSeconds: (new Date().getTime() - startedAt.getTime()) / 1000 }
      );
    } catch (ignoredLogError) {}
    try {
      appendImportLog_({
        importId: Utilities.getUuid(),
        startedAt: startedAt,
        completedAt: new Date(),
        sourceType: "PIPELINE",
        sourceName: "runInwardTatPipeline",
        status: "FAILED",
        errorDetail: error.stack || error.message || String(error),
      });
    } catch (logError) {
      throw new Error(
        "Pipeline failed: " +
          (error.message || String(error)) +
          " | Import logging also failed: " +
          (logError.message || String(logError))
      );
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function clearWronglyPulledPutawayData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const putawaySheet = getSheet_(INWARD_TAT.SHEETS.RAW_PUTAWAY);
    const factSheet = getSheet_(INWARD_TAT.SHEETS.FACT);
    const mtdSheet = getSheet_(INWARD_TAT.SHEETS.MTD);
    const exceptionSheet = getSheet_(INWARD_TAT.SHEETS.EXCEPTIONS);
    const rowsCleared = Math.max(putawaySheet.getLastRow() - 1, 0);

    clearDataRows_(putawaySheet);
    clearDataRows_(factSheet);
    clearDataRows_(mtdSheet);
    clearDataRows_(exceptionSheet);

    const importLog = getSheet_(INWARD_TAT.SHEETS.IMPORT_LOG);
    let importsReleased = 0;
    if (importLog.getLastRow() > 1) {
      const rowCount = importLog.getLastRow() - 1;
      const sourceTypes = importLog.getRange(2, 4, rowCount, 1).getDisplayValues();
      const statusAndDetail = importLog.getRange(2, 11, rowCount, 2).getValues();
      statusAndDetail.forEach(function (row, index) {
        if (
          String(sourceTypes[index][0]).toUpperCase() === "PUTAWAY" &&
          String(row[0]).toUpperCase() === "SUCCESS"
        ) {
          row[0] = "CLEARED_REIMPORT_ALLOWED";
          row[1] =
            "Cleared by clearWronglyPulledPutawayData on " +
            Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");
          importsReleased += 1;
        }
      });
      importLog.getRange(2, 11, rowCount, 2).setValues(statusAndDetail);
    }

    updateConfigValue_("LAST_SUCCESSFUL_REFRESH", "");
    appendImportLog_({
      sourceType: "CLEANUP",
      sourceName: "clearWronglyPulledPutawayData",
      rowsRead: rowsCleared,
      rowsAdded: 0,
      rowsSkipped: 0,
      status: "SUCCESS",
      errorDetail:
        importsReleased + " Putaway import(s) released for corrected re-import.",
    });

    return {
      ok: true,
      putawayRowsCleared: rowsCleared,
      importsReleased: importsReleased,
      nextStep: "Run runInwardTatPipeline after corrected facility-named exports arrive.",
    };
  } finally {
    lock.releaseLock();
  }
}

function importUnicommerceEmails_(reportType, config, runId) {
  const isGrn = reportType === "GRN";
  const sender = isGrn ? config.GRN_EMAIL_FROM : config.PUTAWAY_EMAIL_FROM;
  const subject = isGrn ? config.GRN_EMAIL_SUBJECT : config.PUTAWAY_EMAIL_SUBJECT;
  const lookbackDays = Number(config.EMAIL_LOOKBACK_DAYS || 45);
  const query =
    "from:" +
    sender +
    ' subject:"' +
    subject +
    '" newer_than:' +
    lookbackDays +
    "d -in:trash -in:spam";
  logExecution_(
    runId,
    reportType + "_EMAIL_SEARCH",
    "STARTED",
    "Searching Gmail for " + reportType + " export emails.",
    { reportType: reportType, emailSubject: subject }
  );
  const threads = GmailApp.search(query, 0, 100);
  const messages = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (message.getSubject().trim() === subject.trim()) messages.push(message);
    });
  });

  messages.sort(function (a, b) {
    return a.getDate().getTime() - b.getDate().getTime();
  });

  const selectedMessages = selectExportMessages_(
    messages,
    isGrn,
    config
  );
  logExecution_(
    runId,
    reportType + "_EMAIL_SEARCH",
    "COMPLETED",
    messages.length +
      " matching email(s) found; " +
      selectedMessages.length +
      " latest cumulative export(s) selected.",
    { reportType: reportType, emailSubject: subject }
  );
  const summary = {
    found: messages.length,
    selected: selectedMessages.length,
    imported: 0,
    skipped: 0,
    failed: 0,
  };
  selectedMessages.forEach(function (message) {
    const sourceType = isGrn ? "GRN" : "PUTAWAY";
    const body = getEmailBodyText_(message);
    const exportJob = extractEmailField_(body, "Export");
    const status = extractEmailField_(body, "Status").toUpperCase();
    const fileUrl = extractExportFileUrl_(body);
    let facility = isGrn ? "" : facilityFromPutawayExport_(exportJob, config);
    const emailDetails = {
      reportType: reportType,
      emailSubject: message.getSubject(),
      emailReceivedAt: message.getDate(),
      emailMessageId: message.getId(),
      exportJob: exportJob,
      facility: facility,
      csvUrl: fileUrl,
    };
    logExecution_(
      runId,
      reportType + "_EMAIL",
      "FOUND",
      "Email found: " +
        message.getSubject() +
        " at " +
        Utilities.formatDate(message.getDate(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss"),
      emailDetails
    );
    if (
      hasProcessedImport_(message.getId(), sourceType) ||
      hasProcessedCsvUrl_(fileUrl, sourceType)
    ) {
      logExecution_(
        runId,
        reportType + "_CSV",
        "SKIPPED_DUPLICATE",
        "Duplicate CSV found; this email or CSV link was already processed.",
        emailDetails
      );
      summary.skipped += 1;
      return;
    }

    const startedAt = new Date();
    const importId = Utilities.getUuid();

    try {
      if (status && status !== "SUCCESSFUL") {
        throw new Error("Unicommerce export status is not SUCCESSFUL: " + status);
      }
      if (!fileUrl) throw new Error("Export File Path was not found in the email body.");

      if (!isGrn) {
        if (!facility) {
          appendImportLog_({
            importId: importId,
            startedAt: startedAt,
            completedAt: new Date(),
            sourceType: sourceType,
            sourceName: exportJob || subject,
            emailMessageId: message.getId(),
            status: "SKIPPED_TERMINAL",
            errorDetail:
              "Putaway export name does not identify SLAMB, SLMH or SLRX: " +
              exportJob,
          });
          logExecution_(
            runId,
            reportType + "_CSV",
            "SKIPPED",
            "Putaway email skipped because the export job does not identify a facility.",
            emailDetails
          );
          summary.skipped += 1;
          return;
        }
      }

      logExecution_(
        runId,
        reportType + "_CSV",
        "STARTED",
        "Importing " + (facility || reportType) + " CSV.",
        emailDetails
      );
      const csvText = downloadCsv_(fileUrl);
      const parsed = parseCsvObjects_(csvText);
      const accepted = isGrn
        ? normalizeGrnRows_(parsed.rows)
        : normalizePutawayRows_(parsed.rows, facility, config);
      logExecution_(
        runId,
        reportType + "_ROWS",
        "IMPORTING",
        "CSV downloaded. Importing accepted rows.",
        Object.assign({}, emailDetails, {
          rowsRead: parsed.rows.length,
          rowsSkipped: parsed.rows.length - accepted.length,
        })
      );
      const targetSheet = isGrn
        ? INWARD_TAT.SHEETS.RAW_GRN
        : INWARD_TAT.SHEETS.RAW_PUTAWAY;

      const metadata = isGrn
        ? {
            "Import Id": importId,
            "Email Message Id": message.getId(),
            "Source File": fileUrl,
            "Source Row": "",
            "Imported At": new Date(),
          }
        : {
            "Import Id": importId,
            "Email Message Id": message.getId(),
            "Source File": fileUrl,
            "Export Job": exportJob,
            Facility: facility,
            "Source Row": "",
            "Imported At": new Date(),
          };

      const rowsAdded = appendMappedRows_(
        targetSheet,
        parsed.headers,
        accepted,
        metadata,
        Number(config.PIPELINE_BATCH_SIZE || 500)
      );

      appendImportLog_({
        importId: importId,
        startedAt: startedAt,
        completedAt: new Date(),
        sourceType: sourceType,
        sourceName: exportJob || subject,
        emailMessageId: message.getId(),
        facility: facility,
        rowsRead: parsed.rows.length,
        rowsAdded: rowsAdded,
        rowsSkipped: parsed.rows.length - accepted.length,
        status: "SUCCESS",
      });
      logExecution_(
        runId,
        reportType + "_ROWS",
        "COMPLETED",
        rowsAdded +
          " row(s) imported for " +
          (facility || reportType) +
          "; " +
          (parsed.rows.length - accepted.length) +
          " row(s) filtered.",
        Object.assign({}, emailDetails, {
          rowsRead: parsed.rows.length,
          rowsImported: rowsAdded,
          rowsSkipped: parsed.rows.length - accepted.length,
          durationSeconds: (new Date().getTime() - startedAt.getTime()) / 1000,
        })
      );
      summary.imported += 1;
    } catch (error) {
      appendImportLog_({
        importId: importId,
        startedAt: startedAt,
        completedAt: new Date(),
        sourceType: sourceType,
        sourceName: exportJob || subject,
        emailMessageId: message.getId(),
        facility: facility,
        status: "FAILED",
        errorDetail: error.message || String(error),
      });
      logExecution_(
        runId,
        reportType + "_CSV",
        "FAILED",
        error.message || String(error),
        Object.assign({}, emailDetails, {
          durationSeconds: (new Date().getTime() - startedAt.getTime()) / 1000,
        })
      );
      summary.failed += 1;
    }
  });

  return summary;
}

function syncGoodsInward_(config, runId) {
  const sourceId = String(config.GOODS_SOURCE_SPREADSHEET_ID || "").trim();
  let sourceSheetName = String(config.GOODS_SOURCE_SHEET_NAME || "").trim();
  if (!sourceId) {
    return {
      status: "NOT_CONFIGURED",
      rowsRead: 0,
      rowsWritten: 0,
      message: "Goods Inward source spreadsheet ID is blank.",
    };
  }

  const startedAt = new Date();
  const importId = Utilities.getUuid();
  try {
    logExecution_(
      runId,
      "GOODS_INWARD",
      "STARTED",
      "Opening the monthly Goods Inward tracker.",
      {}
    );
    const source = SpreadsheetApp.openById(sourceId);
    const sourceSheet = resolveGoodsSourceSheet_(source, config);
    sourceSheetName = sourceSheet.getName();
    logExecution_(
      runId,
      "GOODS_INWARD",
      "SOURCE_FOUND",
      "Goods Inward source found: " + source.getName() + " / " + sourceSheetName,
      {}
    );

    const values = sourceSheet.getDataRange().getValues();
    if (values.length < 2) {
      return { status: "EMPTY", rowsRead: 0, rowsWritten: 0 };
    }

    const headers = values[0].map(cleanHeader_);
    const sourceHeaderIndex = headerIndex_(headers);
    const facilityColumn = sourceHeaderIndex[normalizeHeader_("Received at")];
    if (facilityColumn === undefined) {
      throw new Error("Goods Inward source is missing the Received at column.");
    }
    const allowedFacilities = String(
      config.GOODS_ALLOWED_FACILITIES || "SL Mother Hub|SL Ambient"
    )
      .split("|")
      .map(normalizeFacility_)
      .filter(Boolean);
    const allRecords = values.slice(1).map(function (row, index) {
      return { row: row, sourceRow: index + 2 };
    });
    const records = allRecords.filter(function (record) {
      return (
        allowedFacilities.indexOf(
          normalizeFacility_(record.row[facilityColumn])
        ) !== -1
      );
    });
    logExecution_(
      runId,
      "GOODS_INWARD_FILTER",
      "COMPLETED",
      "Filtered Goods Inward to SL Mother Hub and SL Ambient only.",
      {
        rowsRead: allRecords.length,
        rowsImported: records.length,
        rowsSkipped: allRecords.length - records.length,
      }
    );
    const target = getSheet_(INWARD_TAT.SHEETS.RAW_GOODS);
    clearDataRows_(target);
    const targetHeaders = readHeaders_(target);
    const output = records.map(function (record) {
      const metadata = {
        "Import Id": importId,
        "Source Spreadsheet Id": sourceId,
        "Source Sheet": sourceSheetName,
        "Source Row": record.sourceRow,
        "Imported At": new Date(),
      };
      return targetHeaders.map(function (targetHeader) {
        if (Object.prototype.hasOwnProperty.call(metadata, targetHeader)) {
          return metadata[targetHeader];
        }
        const index = sourceHeaderIndex[normalizeHeader_(targetHeader)];
        return index === undefined ? "" : record.row[index];
      });
    });

    writeRowsInBatches_(target, output, Number(config.PIPELINE_BATCH_SIZE || 500));
    appendImportLog_({
      importId: importId,
      startedAt: startedAt,
      completedAt: new Date(),
      sourceType: "GOODS_INWARD",
      sourceName: source.getName() + " / " + sourceSheetName,
      rowsRead: allRecords.length,
      rowsAdded: output.length,
      rowsSkipped: allRecords.length - output.length,
      status: "SUCCESS",
    });
    logExecution_(
      runId,
      "GOODS_INWARD",
      "COMPLETED",
      output.length + " Goods Inward row(s) imported.",
      {
        rowsRead: allRecords.length,
        rowsImported: output.length,
        rowsSkipped: allRecords.length - output.length,
        durationSeconds: (new Date().getTime() - startedAt.getTime()) / 1000,
      }
    );
    return { status: "SUCCESS", rowsRead: allRecords.length, rowsWritten: output.length };
  } catch (error) {
    appendImportLog_({
      importId: importId,
      startedAt: startedAt,
      completedAt: new Date(),
      sourceType: "GOODS_INWARD",
      sourceName: sourceId + " / " + sourceSheetName,
      status: "FAILED",
      errorDetail: error.message || String(error),
    });
    logExecution_(
      runId,
      "GOODS_INWARD",
      "FAILED",
      error.message || String(error),
      { durationSeconds: (new Date().getTime() - startedAt.getTime()) / 1000 }
    );
    throw error;
  }
}

function resolveGoodsSourceSheet_(spreadsheet, config) {
  const configuredName = String(config.GOODS_SOURCE_SHEET_NAME || "").trim();
  const mode = String(config.GOODS_SOURCE_TAB_MODE || "AUTO_MONTHLY").trim().toUpperCase();
  if (mode !== "AUTO_MONTHLY") {
    const configuredSheet = configuredName ? spreadsheet.getSheetByName(configuredName) : null;
    if (!configuredSheet) {
      throw new Error("Goods Inward source tab not found: " + (configuredName || "(blank)"));
    }
    return configuredSheet;
  }

  const timeZone = String(config.TIME_ZONE || Session.getScriptTimeZone() || "Asia/Calcutta");
  const prefix = String(config.GOODS_SOURCE_SHEET_PREFIX || "FG-").trim();
  const now = new Date();
  const monthLong = Utilities.formatDate(now, timeZone, "MMMM");
  const monthShort = Utilities.formatDate(now, timeZone, "MMM");
  const yearShort = Utilities.formatDate(now, timeZone, "yy");
  const yearLong = Utilities.formatDate(now, timeZone, "yyyy");
  const candidates = [
    prefix + monthLong + "-" + yearShort,
    prefix + monthShort + "-" + yearShort,
    prefix + monthLong + "-" + yearLong,
    prefix + monthShort + "-" + yearLong,
  ].map(normalizeTabName_);

  const sheetsByNormalizedName = {};
  spreadsheet.getSheets().forEach(function (sheet) {
    sheetsByNormalizedName[normalizeTabName_(sheet.getName())] = sheet;
  });

  for (let index = 0; index < candidates.length; index += 1) {
    if (sheetsByNormalizedName[candidates[index]]) {
      return sheetsByNormalizedName[candidates[index]];
    }
  }

  if (configuredName) {
    const fallback =
      spreadsheet.getSheetByName(configuredName) ||
      sheetsByNormalizedName[normalizeTabName_(configuredName)];
    if (fallback) return fallback;
  }

  throw new Error(
    "Current Goods Inward monthly tab not found. Expected " +
      prefix +
      monthLong +
      "-" +
      yearShort +
      (configuredName ? " or fallback " + configuredName : "")
  );
}

function normalizeTabName_(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeGrnRows_(rows) {
  return rows.filter(function (row) {
    return Boolean(
      normalizeFacility_(row.Facility) &&
        String(row["GRN Code"] || "").trim() &&
        String(row["Item SkuCode"] || "").trim()
    );
  });
}

function normalizePutawayRows_(rows, facility, config) {
  return rows.filter(function (row) {
    return (
      facility &&
      String(row.Type || "").trim().toUpperCase() ===
        String(config.PUTAWAY_TYPE_FILTER || "PUTAWAY_GRN_ITEM").toUpperCase()
    );
  });
}

function rebuildTatFacts_(config, runId) {
  const goodsSheet = getSheet_(INWARD_TAT.SHEETS.RAW_GOODS);
  const grnSheet = getSheet_(INWARD_TAT.SHEETS.RAW_GRN);
  const putawaySheet = getSheet_(INWARD_TAT.SHEETS.RAW_PUTAWAY);
  const goods = sheetObjects_(goodsSheet);
  const grn = sheetObjects_(grnSheet);
  const putaway = sheetObjects_(putawaySheet);

  const goodsMap = new Map();
  const grnMap = new Map();
  const putawayMap = new Map();
  const exceptions = [];
  const rxSkuGrnBridge = new Set();
  const rxBridgeEnabled =
    String(config.RX_BRIDGE_ENABLED || "TRUE").toUpperCase() === "TRUE";
  let rxMappedGoodsRecords = 0;

  if (rxBridgeEnabled) {
    grn.forEach(function (row) {
      const facility = normalizeFacility_(row.Facility);
      const sku = normalizeSku_(row["Item SkuCode"]);
      const grnNumber = normalizeGrn_(row["GRN Code"]);
      if (facility === "SL Rx" && sku && grnNumber) {
        rxSkuGrnBridge.add(grnNumber + "|" + sku);
      }
    });
  }

  goods.forEach(function (row) {
    const warehouseFacility = normalizeFacility_(row["Received at"]);
    const sku = normalizeSku_(row.SKU);
    const grnNumbers = splitGrnNumbers_(row["GRN no."]);
    const unloadingTimestamp = combineDateAndTime_(
      row["Unloading Date"],
      row["Unloading Time"]
    );

    if (!warehouseFacility || !sku || !grnNumbers.length || !unloadingTimestamp) {
      exceptions.push(
        exceptionFromRow_(
          "GOODS_INWARD",
          row.__row,
          warehouseFacility,
          sku,
          grnNumbers.join(" / "),
          !warehouseFacility
            ? "MISSING_GOODS_FACILITY"
            : !sku
              ? "MISSING_GOODS_SKU"
              : !grnNumbers.length
                ? "MISSING_GOODS_GRN"
                : "MISSING_UNLOADING_TIMESTAMP",
          "Goods Inward requires Received at, SKU, GRN no., Unloading Date and Unloading Time."
        )
      );
      return;
    }

    grnNumbers.forEach(function (grnNumber) {
      const facility =
        rxBridgeEnabled &&
        warehouseFacility === "SL Ambient" &&
        rxSkuGrnBridge.has(grnNumber + "|" + sku)
          ? "SL Rx"
          : warehouseFacility;
      if (facility === "SL Rx" && warehouseFacility === "SL Ambient") {
        rxMappedGoodsRecords += 1;
      }
      const key = makeRecordKey_(facility, sku, grnNumber);
      const existing = goodsMap.get(key);
      if (!existing || unloadingTimestamp < existing.timestamp) {
        goodsMap.set(key, {
          timestamp: unloadingTimestamp,
          row: row.__row,
          facility: facility,
          sku: sku,
          grn: grnNumber,
        });
      }
    });
  });
  logExecution_(
    runId,
    "RX_FACILITY_BRIDGE",
    "COMPLETED",
    rxMappedGoodsRecords +
      " SL Ambient unloading record(s) mapped to ERP facility SL Rx using GRN Number + SKU.",
    {
      reportType: "GOODS_INWARD",
      facility: "SL Rx",
      rowsImported: rxMappedGoodsRecords,
    }
  );

  grn.forEach(function (row) {
    const facility = normalizeFacility_(row.Facility);
    const sku = normalizeSku_(row["Item SkuCode"]);
    const grnNumber = normalizeGrn_(row["GRN Code"]);
    const timestamp = parseDateTime_(row["GRN Received Timestamp"]);
    const key = makeRecordKey_(facility, sku, grnNumber);
    if (!facility || !sku || !grnNumber || !timestamp) return;
    const existing = grnMap.get(key);
    if (!existing || timestamp > existing.timestamp) {
      grnMap.set(key, { timestamp: timestamp, row: row.__row });
    }
  });

  putaway.forEach(function (row) {
    const facility = normalizeFacility_(row.Facility);
    const sku = normalizeSku_(row["SKU Code"]);
    const grnNumber = normalizeGrn_(row["GRN Number"]);
    const status = String(row["Status Code"] || "").trim().toUpperCase();
    const timestamp = parseDateTime_(row["Last Updated"]);
    const key = makeRecordKey_(facility, sku, grnNumber);
    if (!facility || !sku || !grnNumber || !timestamp) return;
    const completed =
      status === String(config.PUTAWAY_STATUS_FILTER || "COMPLETE").toUpperCase();
    const existing = putawayMap.get(key);
    if (!existing) {
      putawayMap.set(key, {
        timestamp: timestamp,
        row: row.__row,
        allShelvesComplete: completed,
        shelfRows: 1,
      });
      return;
    }
    existing.allShelvesComplete = existing.allShelvesComplete && completed;
    existing.shelfRows += 1;
    if (timestamp > existing.timestamp) {
      existing.timestamp = timestamp;
      existing.row = row.__row;
    }
  });

  const factRows = [];
  const allSourceKeys = new Set(
    Array.from(goodsMap.keys()).concat(
      Array.from(grnMap.keys()),
      Array.from(putawayMap.keys())
    )
  );

  allSourceKeys.forEach(function (key) {
    const goodsRow = goodsMap.get(key);
    const grnRow = grnMap.get(key);
    const putawayRow = putawayMap.get(key);
    const parts = key.split("|");
    const facility = parts[0];
    const grnNumber = parts[1];
    const sku = parts.slice(2).join("|");
    const issueCodes = [];

    if (!goodsRow) issueCodes.push("NO_GOODS_MATCH");
    if (!grnRow) issueCodes.push("NO_GRN_MATCH");
    if (!putawayRow) issueCodes.push("NO_PUTAWAY_MATCH");
    if (
      putawayRow &&
      !putawayRow.allShelvesComplete
    ) {
      issueCodes.push("PUTAWAY_NOT_COMPLETE");
    }

    const unloading = goodsRow ? goodsRow.timestamp : null;
    const grnReceived = grnRow ? grnRow.timestamp : null;
    const putawayCompleted =
      putawayRow &&
      putawayRow.allShelvesComplete
        ? putawayRow.timestamp
        : null;
    const kpi3 = hoursBetween_(unloading, grnReceived);
    const kpi2 = hoursBetween_(grnReceived, putawayCompleted);
    const kpi1 = hoursBetween_(unloading, putawayCompleted);

    if (kpi3 !== null && kpi3 < 0) issueCodes.push("NEGATIVE_KPI3");
    if (kpi2 !== null && kpi2 < 0) issueCodes.push("NEGATIVE_KPI2");
    if (kpi1 !== null && kpi1 < 0) issueCodes.push("NEGATIVE_KPI1");

    const recordStatus = issueCodes.length ? "INCOMPLETE" : "COMPLETE";
    factRows.push([
      key,
      facility,
      sku,
      grnNumber,
      unloading || "",
      grnReceived || "",
      putawayCompleted || "",
      validHours_(kpi3),
      validHours_(kpi2),
      validHours_(kpi1),
      unloading ? startOfDay_(unloading) : "",
      grnReceived ? startOfDay_(grnReceived) : "",
      putawayCompleted ? startOfDay_(putawayCompleted) : "",
      recordStatus,
      issueCodes.join("|"),
      issueCodes.length ? "Record excluded from one or more KPI averages." : "",
      goodsRow ? goodsRow.row : "",
      grnRow ? grnRow.row : "",
      putawayRow ? putawayRow.row : "",
      new Date(),
    ]);

    issueCodes.forEach(function (code) {
      exceptions.push(
        exceptionFromRow_(
          "FACT_JOIN",
          "",
          facility,
          sku,
          grnNumber,
          code,
          "Unable to produce a complete continuous TAT record for " + key + "."
        )
      );
    });
  });

  replaceDataRows_(getSheet_(INWARD_TAT.SHEETS.FACT), factRows);
  replaceExceptions_(exceptions);
  const mtdRows = rebuildMtdSummary_(factRows);
  replaceDataRows_(getSheet_(INWARD_TAT.SHEETS.MTD), mtdRows);

  return {
    factRows: factRows.length,
    completeRows: factRows.filter(function (row) {
      return row[13] === "COMPLETE";
    }).length,
    exceptionRows: exceptions.length,
    mtdSummaryRows: mtdRows.length,
    rxMappedGoodsRecords: rxMappedGoodsRecords,
  };
}

function rebuildMtdSummary_(factRows) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const groups = new Map();

  factRows.forEach(function (row) {
    const unloadingDate = row[10];
    if (!(unloadingDate instanceof Date) || unloadingDate < monthStart) return;
    const facility = row[1];
    [facility, "All Mother Facilities"].forEach(function (groupFacility) {
      const dateKey = Utilities.formatDate(
        unloadingDate,
        "Asia/Kolkata",
        "yyyy-MM-dd"
      );
      const key = dateKey + "|" + groupFacility;
      if (!groups.has(key)) {
        groups.set(key, {
          date: startOfDay_(unloadingDate),
          facility: groupFacility,
          kpi1: [],
          kpi2: [],
          kpi3: [],
          unique: 0,
          complete: 0,
          exceptions: 0,
        });
      }
      const group = groups.get(key);
      group.unique += 1;
      if (row[13] === "COMPLETE") group.complete += 1;
      else group.exceptions += 1;
      if (typeof row[9] === "number") group.kpi1.push(row[9]);
      if (typeof row[8] === "number") group.kpi2.push(row[8]);
      if (typeof row[7] === "number") group.kpi3.push(row[7]);
    });
  });

  return Array.from(groups.values())
    .sort(function (a, b) {
      return a.date - b.date || a.facility.localeCompare(b.facility);
    })
    .map(function (group) {
      return [
        group.date,
        group.facility,
        average_(group.kpi1),
        average_(group.kpi2),
        average_(group.kpi3),
        group.unique,
        group.complete,
        group.exceptions,
        new Date(),
      ];
    });
}

function dedupeRawReportSheets_() {
  dedupeSheet_(INWARD_TAT.SHEETS.RAW_GRN, function (row) {
    return [
      normalizeFacility_(row.Facility),
      normalizeSku_(row["Item SkuCode"]),
      normalizeGrn_(row["GRN Code"]),
      String(row["Batch Code"] || "").trim().toUpperCase(),
      String(row["Vendor Batch Number"] || "").trim().toUpperCase(),
    ].join("|");
  });
  dedupeSheet_(INWARD_TAT.SHEETS.RAW_PUTAWAY, function (row) {
    const facility = normalizeFacility_(row.Facility);
    if (!facility) return "";
    return [
      facility,
      String(row["Putaway Item Id"] || "").trim(),
      normalizeSku_(row["SKU Code"]),
      normalizeGrn_(row["GRN Number"]),
    ].join("|");
  });
}

function dedupeSheet_(sheetName, keyFunction) {
  const sheet = getSheet_(sheetName);
  const rows = sheetObjects_(sheet);
  if (!rows.length) return;
  const newestByKey = new Map();
  rows.forEach(function (row) {
    const key = keyFunction(row);
    if (!key || key.replace(/\|/g, "") === "") return;
    const existing = newestByKey.get(key);
    const importedAt = parseDateTime_(row["Imported At"]) || new Date(0);
    if (!existing || importedAt >= existing.importedAt) {
      newestByKey.set(key, { importedAt: importedAt, values: row.__values });
    }
  });
  replaceDataRows_(
    sheet,
    Array.from(newestByKey.values()).map(function (entry) {
      return entry.values;
    })
  );
}

function downloadCsv_(url) {
  const response = UrlFetchApp.fetch(url, {
    followRedirects: true,
    muteHttpExceptions: true,
    headers: { Accept: "text/csv,*/*" },
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("CSV download failed with HTTP " + status + ".");
  }
  return response.getContentText("UTF-8").replace(/^\uFEFF/, "");
}

function parseCsvObjects_(csvText) {
  const matrix = Utilities.parseCsv(csvText);
  if (!matrix.length) throw new Error("CSV file is empty.");
  const headers = matrix[0].map(cleanHeader_);
  const rows = matrix.slice(1).filter(function (row) {
    return row.some(function (value) {
      return String(value).trim() !== "";
    });
  }).map(function (row, index) {
    const object = { __sourceRow: index + 2 };
    headers.forEach(function (header, column) {
      object[header] = row[column] === undefined ? "" : row[column];
    });
    return object;
  });
  return { headers: headers, rows: rows };
}

function appendMappedRows_(sheetName, sourceHeaders, objects, metadata, batchSize) {
  const sheet = getSheet_(sheetName);
  const targetHeaders = readHeaders_(sheet);
  const sourceIndex = headerIndex_(sourceHeaders);
  const rows = objects.map(function (object) {
    return targetHeaders.map(function (targetHeader) {
      if (targetHeader === "Source Row") return object.__sourceRow || "";
      if (Object.prototype.hasOwnProperty.call(metadata, targetHeader)) {
        return metadata[targetHeader];
      }
      const sourceHeader = sourceHeaders[sourceIndex[normalizeHeader_(targetHeader)]];
      return sourceHeader ? object[sourceHeader] : "";
    });
  });
  writeRowsInBatches_(sheet, rows, batchSize);
  return rows.length;
}

function writeRowsInBatches_(sheet, rows, batchSize) {
  if (!rows.length) return;
  const width = rows[0].length;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    sheet.getRange(sheet.getLastRow() + 1, 1, batch.length, width).setValues(batch);
  }
}

function replaceDataRows_(sheet, rows) {
  clearDataRows_(sheet);
  if (rows.length) writeRowsInBatches_(sheet, rows, 500);
}

function replaceExceptions_(rows) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.EXCEPTIONS);
  const preserved = sheetObjects_(sheet).filter(function (row) {
    return ["FACT_JOIN", "GOODS_INWARD", "PUTAWAY_EMAIL", "PUTAWAY"].indexOf(
      String(row["Source Report"])
    ) === -1;
  });
  const combined = preserved.map(function (row) {
    return row.__values;
  }).concat(rows.map(exceptionToRow_));
  const unique = new Map();
  combined.forEach(function (row) {
    const key = [row[2], row[3], row[4], row[5], row[6], row[7]].join("|");
    unique.set(key, row);
  });
  replaceDataRows_(sheet, Array.from(unique.values()));
}

function clearDataRows_(sheet) {
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
}

function sheetObjects_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
    .getValues();
  const headers = values[0].map(cleanHeader_);
  return values.slice(1).filter(function (row) {
    return row.some(function (value) {
      return value !== "";
    });
  }).map(function (row, index) {
    const object = { __row: index + 2, __values: row };
    headers.forEach(function (header, column) {
      object[header] = row[column];
    });
    return object;
  });
}

function getConfig_() {
  const sheet = getSheet_(INWARD_TAT.SHEETS.CONFIG);
  if (sheet.getLastRow() < 2) throw new Error("Config sheet is empty.");
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const config = {};
  rows.forEach(function (row) {
    if (String(row[0]).trim()) config[String(row[0]).trim()] = row[1];
  });
  return config;
}

function updateConfigValue_(key, value) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.CONFIG);
  const keys = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  const index = keys.findIndex(function (row) {
    return row[0] === key;
  });
  if (index === -1) throw new Error("Config key not found: " + key);
  sheet.getRange(index + 2, 2).setValue(value);
  sheet.getRange(index + 2, 5).setValue(new Date());
}

function hasProcessedImport_(messageId, sourceType) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.IMPORT_LOG);
  if (sheet.getLastRow() < 2) return false;
  const rows = sheetObjects_(sheet);
  return rows.some(function (row) {
    return (
      String(row["Email Message Id"]) === String(messageId) &&
      String(row["Source Type"]) === sourceType &&
      String(row.Status).toUpperCase() === "SUCCESS"
    );
  });
}

function hasProcessedCsvUrl_(fileUrl, sourceType) {
  const url = String(fileUrl || "").trim();
  if (!url) return false;
  const sheetName =
    sourceType === "GRN"
      ? INWARD_TAT.SHEETS.RAW_GRN
      : INWARD_TAT.SHEETS.RAW_PUTAWAY;
  const sheet = getSheet_(sheetName);
  if (sheet.getLastRow() < 2) return false;
  const headers = readHeaders_(sheet);
  const sourceFileColumn = headers.indexOf("Source File") + 1;
  if (!sourceFileColumn) return false;
  return Boolean(
    sheet
      .getRange(2, sourceFileColumn, sheet.getLastRow() - 1, 1)
      .createTextFinder(url)
      .matchEntireCell(true)
      .findNext()
  );
}

function logExecution_(runId, stage, status, message, details) {
  const info = details || {};
  const consoleMessage =
    "[" +
    (runId || "NO-RUN-ID") +
    "] " +
    (stage || "GENERAL") +
    " | " +
    (status || "INFO") +
    " | " +
    (message || "") +
    (Object.keys(info).length ? " | " + JSON.stringify(info) : "");
  if (String(status || "").match(/FAILED|ERROR/)) {
    console.error(consoleMessage);
  } else {
    console.log(consoleMessage);
  }

  const sheet = getExecutionLogSheet_();
  sheet.appendRow([
    runId || "",
    new Date(),
    stage || "",
    status || "",
    message || "",
    info.reportType || "",
    info.emailSubject || "",
    info.emailReceivedAt || "",
    info.emailMessageId || "",
    info.exportJob || "",
    info.facility || "",
    info.csvUrl || "",
    info.rowsRead === undefined ? "" : info.rowsRead,
    info.rowsImported === undefined ? "" : info.rowsImported,
    info.rowsSkipped === undefined ? "" : info.rowsSkipped,
    info.durationSeconds === undefined
      ? ""
      : Math.round(Number(info.durationSeconds) * 100) / 100,
  ]);
  SpreadsheetApp.flush();
}

function getExecutionLogSheet_() {
  const spreadsheet = openInwardTatSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(INWARD_TAT.SHEETS.EXECUTION_LOG);
  const headers = [
    "Run Id", "Timestamp", "Stage", "Status", "Message", "Report Type",
    "Email Subject", "Email Received At", "Email Message Id", "Export Job",
    "Facility", "CSV URL", "Rows Read", "Rows Imported", "Rows Skipped",
    "Duration Seconds",
  ];
  if (!sheet) {
    sheet = spreadsheet.insertSheet(INWARD_TAT.SHEETS.EXECUTION_LOG);
    sheet.setTabColor(INWARD_TAT.COLORS.BLUE);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet
      .getRange(1, 1, 1, headers.length)
      .setBackground(INWARD_TAT.COLORS.NAVY)
      .setFontColor(INWARD_TAT.COLORS.WHITE)
      .setFontWeight("bold");
    sheet.setColumnWidth(1, 240);
    sheet.setColumnWidth(2, 170);
    sheet.setColumnWidth(3, 180);
    sheet.setColumnWidth(4, 140);
    sheet.setColumnWidth(5, 500);
    sheet.setColumnWidth(7, 320);
    sheet.setColumnWidth(10, 300);
    sheet.setColumnWidth(12, 500);
    sheet.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");
    sheet.getRange("H:H").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  } else {
    const actualHeaders = sheet
      .getRange(1, 1, 1, headers.length)
      .getDisplayValues()[0];
    if (actualHeaders.join("|") !== headers.join("|")) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function selectExportMessages_(messages, isGrn, config) {
  const cumulative =
    String(config.ERP_EXPORT_MODE || "MTD_CUMULATIVE").toUpperCase() ===
    "MTD_CUMULATIVE";
  if (!cumulative) return messages;
  if (isGrn) return messages.length ? [messages[messages.length - 1]] : [];

  const latestByFacility = {};
  messages.forEach(function (message) {
    const exportJob = extractEmailField_(getEmailBodyText_(message), "Export");
    const facility = facilityFromPutawayExport_(exportJob, config);
    if (facility) latestByFacility[facility] = message;
  });
  return ["SL Rx", "SL Ambient", "SL Mother Hub"]
    .map(function (facility) {
      return latestByFacility[facility];
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.getDate().getTime() - b.getDate().getTime();
    });
}

function appendImportLog_(entry) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.IMPORT_LOG);
  sheet.appendRow([
    entry.importId || Utilities.getUuid(),
    entry.startedAt || new Date(),
    entry.completedAt || new Date(),
    entry.sourceType || "",
    entry.sourceName || "",
    entry.emailMessageId || "",
    entry.facility || "",
    entry.rowsRead || 0,
    entry.rowsAdded || 0,
    entry.rowsSkipped || 0,
    entry.status || "",
    entry.errorDetail || "",
  ]);
}

function recordException_(entry) {
  getSheet_(INWARD_TAT.SHEETS.EXCEPTIONS).appendRow(exceptionToRow_(entry));
}

function exceptionFromRow_(
  sourceReport,
  sourceRow,
  facility,
  sku,
  grnNumber,
  exceptionCode,
  exceptionDetail
) {
  return {
    sourceReport: sourceReport,
    sourceRow: sourceRow,
    facility: facility,
    sku: sku,
    grnNumber: grnNumber,
    exceptionCode: exceptionCode,
    exceptionDetail: exceptionDetail,
  };
}

function exceptionToRow_(entry) {
  return [
    entry.exceptionId || Utilities.getUuid(),
    entry.detectedAt || new Date(),
    entry.sourceReport || "",
    entry.sourceRow || "",
    entry.facility || "",
    entry.sku || "",
    entry.grnNumber || "",
    entry.exceptionCode || "",
    entry.exceptionDetail || "",
    entry.resolutionStatus || "OPEN",
    entry.resolvedBy || "",
    entry.resolvedAt || "",
  ];
}

function facilityFromPutawayExport_(exportJob, config) {
  const value = String(exportJob || "").toUpperCase().replace(/\s+/g, "");
  if (
    value.indexOf("SLAMB") !== -1 ||
    value.indexOf(String(config.PUTAWAY_EXPORT_SLAMB || "").toUpperCase()) !== -1
  ) {
    return "SL Ambient";
  }
  if (
    value.indexOf("SLMH") !== -1 ||
    value.indexOf(String(config.PUTAWAY_EXPORT_SLMH || "").toUpperCase()) !== -1
  ) {
    return "SL Mother Hub";
  }
  if (
    value.indexOf("SLRX") !== -1 ||
    value.indexOf(String(config.PUTAWAY_EXPORT_SLRX || "").toUpperCase()) !== -1
  ) {
    return "SL Rx";
  }
  return "";
}

function normalizeFacility_(value) {
  const compact = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (["slambient", "slamb"].indexOf(compact) !== -1) return "SL Ambient";
  if (["slmotherhub", "slmother", "slmh"].indexOf(compact) !== -1) {
    return "SL Mother Hub";
  }
  if (["slrx"].indexOf(compact) !== -1) return "SL Rx";
  return "";
}

function normalizeSku_(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeGrn_(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function splitGrnNumbers_(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\/,;|]+/)
        .map(normalizeGrn_)
        .filter(Boolean)
    )
  );
}

function makeRecordKey_(facility, sku, grnNumber) {
  if (!facility || !sku || !grnNumber) return "";
  return facility + "|" + grnNumber + "|" + sku;
}

function getEmailBodyText_(message) {
  const plain = String(message.getPlainBody() || "");
  const html = String(message.getBody() || "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|td|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return normalizeEmailText_(plain + "\n" + html);
}

function normalizeEmailText_(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&colon;|&#58;/gi, ":")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n");
}

function extractEmailField_(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flattened = normalizeEmailText_(body).replace(/\s+/g, " ").trim();
  const match = flattened.match(
    new RegExp(
      "(?:^|\\s)" +
        escaped +
        "\\s*:\\s*(.*?)(?=\\s+(?:Export|Status|Message|Export File Path)\\s*:|$)",
      "i"
    )
  );
  return match ? match[1].trim() : "";
}

function extractExportFileUrl_(body) {
  const match = normalizeEmailText_(body).match(
    /Export\s*File\s*Path\s*:\s*(https?:\/\/[^\s<>"']+)/i
  );
  return match ? match[1].replace(/&amp;/g, "&").trim() : "";
}

function combineDateAndTime_(dateValue, timeValue) {
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    const result = new Date(dateValue.getTime());
    if (timeValue instanceof Date && !isNaN(timeValue.getTime())) {
      result.setHours(timeValue.getHours(), timeValue.getMinutes(), timeValue.getSeconds(), 0);
      return result;
    }
    const time = parseTimeParts_(timeValue);
    if (!time) return null;
    result.setHours(time.hour, time.minute, time.second, 0);
    return result;
  }
  return parseDateTime_(String(dateValue || "") + " " + String(timeValue || ""));
}

function parseDateTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(
    /^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;
  let day;
  let month;
  let year;
  if (match[1].length === 4) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }
  const result = new Date(
    year,
    month - 1,
    day,
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0),
    0
  );
  return isNaN(result.getTime()) ? null : result;
}

function parseTimeParts_(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] || 0),
  };
}

function hoursBetween_(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  return (end.getTime() - start.getTime()) / 3600000;
}

function validHours_(value) {
  return typeof value === "number" && isFinite(value) && value >= 0
    ? Math.round(value * 10000) / 10000
    : "";
}

function average_(values) {
  if (!values.length) return "";
  return (
    Math.round(
      (values.reduce(function (sum, value) {
        return sum + value;
      }, 0) /
        values.length) *
        10000
    ) / 10000
  );
}

function startOfDay_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function cleanHeader_(value) {
  return String(value || "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

function normalizeHeader_(value) {
  return cleanHeader_(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerIndex_(headers) {
  const result = {};
  headers.forEach(function (header, index) {
    result[normalizeHeader_(header)] = index;
  });
  return result;
}

function readHeaders_(sheet) {
  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(cleanHeader_);
}

function getSheet_(name) {
  const sheet = openInwardTatSpreadsheet_().getSheetByName(String(name));
  if (!sheet) throw new Error("Required sheet not found: " + name);
  return sheet;
}

function installInwardTatTrigger(hour) {
  const triggerHour = Number(hour);
  if (!Number.isInteger(triggerHour) || triggerHour < 0 || triggerHour > 23) {
    throw new Error("Trigger hour must be a whole number from 0 to 23.");
  }
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) {
      return trigger.getHandlerFunction() === "runInwardTatPipeline";
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });
  ScriptApp.newTrigger("runInwardTatPipeline")
    .timeBased()
    .everyDays(1)
    .atHour(triggerHour)
    .nearMinute(30)
    .inTimezone("Asia/Kolkata")
    .create();
  return { installed: true, hour: triggerHour, nearMinute: 30 };
}
