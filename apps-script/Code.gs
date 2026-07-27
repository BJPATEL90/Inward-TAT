/**
 * Inward TAT — Google Sheets backend
 * Phase 1: workbook structure, configuration and validation.
 *
 * Run setupInwardTatWorkbook() once from a bound Apps Script project.
 * The function is idempotent: it creates missing tabs/headers/configuration
 * without deleting operational data or overwriting existing configuration.
 */

const INWARD_TAT = Object.freeze({
  VERSION: "1.0.0",
  SPREADSHEET_ID: "1vTWxEboW_4-9RBJEr0gvKTOQmgM2XEBh1onhDU4mzZI",
  COLORS: Object.freeze({
    NAVY: "#1D3475",
    BLUE: "#2443C4",
    BLUE_LIGHT: "#EAF0FF",
    GREEN: "#0B7A48",
    AMBER: "#A15C00",
    RED: "#B42318",
    TEXT: "#172033",
    MUTED: "#5C6B85",
    GRID: "#D9E1EF",
    WHITE: "#FFFFFF",
  }),
  SHEETS: Object.freeze({
    CONFIG: "Config",
    RAW_GOODS: "Raw_Goods_Inward",
    RAW_GRN: "Raw_GRN",
    RAW_PUTAWAY: "Raw_Putaway",
    FACT: "Fact_Inward_TAT",
    MTD: "MTD_Summary",
    EXCEPTIONS: "Data_Exceptions",
    IMPORT_LOG: "Import_Log",
    EXECUTION_LOG: "Execution_Log",
    EMAIL_LOG: "Email_Log",
  }),
});

/**
 * Run once from the Apps Script editor after OAuth scopes change.
 * Google will display the consent screen for the pipeline's required services.
 */
function authorizeInwardTat() {
  const spreadsheet = SpreadsheetApp.openById(INWARD_TAT.SPREADSHEET_ID);
  GmailApp.search("newer_than:1d", 0, 1);
  UrlFetchApp.getRequest("https://www.google.com/generate_204");
  ScriptApp.getProjectTriggers();
  return "Authorization complete for " + spreadsheet.getName();
}

const SHEET_DEFINITIONS = Object.freeze([
  {
    name: INWARD_TAT.SHEETS.CONFIG,
    tabColor: INWARD_TAT.COLORS.BLUE,
    headers: ["Config Key", "Config Value", "Data Type", "Description", "Updated At"],
    widths: [250, 280, 110, 460, 170],
  },
  {
    name: INWARD_TAT.SHEETS.RAW_GOODS,
    tabColor: "#7186C8",
    headers: [
      "Import Id", "Source Spreadsheet Id", "Source Sheet", "Source Row", "Imported At",
      "SR NO.", "Recall / fresh", "Reporting date", "Reporting Time", "Unloading Date",
      "Unloading Time", "Vehicle Arrival Time", "Transporter name", "Vehicle Number",
      "Vehicle Type", "LR /Docket no.", "LR /Docket Date", "Air / Train / Surface",
      "Total value", "Received at", "Receiver Name", "From Vendor",
      "From Location (Vendor)", "Invoice number", "Invoice Date", "SKU", "Item Name",
      "Batch No.", "MFG. Date", "EXP. Date", "Pack size", "MRP", "Box/ Pallet",
      "No. of Boxes Recd", "Invoice Qty", "Received Qty", "Short Received",
      "Excess received", "Damged Qty", "QC done date", "GRN no.", "GRN Date",
      "Putaway No", "Putway Date", "Classification (A/B/C)", "PO No", "Comments",
      "ROLLUP", "Invoice link", "LR copy link", "Suraj QC samples",
      "Gate pass number QC Samples", "Doc toStock TAT", "GRN to Stock TAT", "Week",
      "Remakrs for Delay", "mail", "Reporting to Unloading TAT",
    ],
  },
  {
    name: INWARD_TAT.SHEETS.RAW_GRN,
    tabColor: "#7186C8",
    headers: [
      "Import Id", "Email Message Id", "Source File", "Source Row", "Imported At",
      "GRN Code", "GRN Date", "GRN Created By", "Item SkuCode", "Item Type Name",
      "Item Type Color", "Item Type Size", "Item Type Brand", "Facility", "Category",
      "Batch Code", "Additional Cost", "Vendor SkuCode", "Vendor Name", "Vendor Code",
      "GRN Invoice No", "GRN Invoice Date", "PO Code", "Gate Entry", "PO Date",
      "Quantity Received", "Quantity Rejected", "Percentage Rejection",
      "Values of Goods Received without taxes", "Values of Goods Received with taxes",
      "Values of Goods Rejected without taxes", "Values of Goods Rejected with taxes",
      "Rejection Reason", "Expiry Date", "Grn item Status", "Updated",
      "GRN Received Timestamp", "QC Completed On", "BOM Cost", "BOM Cost Without GST",
      "Bom_Cost", "Vendor Batch Number",
    ],
  },
  {
    name: INWARD_TAT.SHEETS.RAW_PUTAWAY,
    tabColor: "#7186C8",
    headers: [
      "Import Id", "Email Message Id", "Source File", "Export Job", "Facility",
      "Source Row", "Imported At", "Putaway Item Id", "Putaway Code", "Type",
      "Product Name", "SKU Code", "Status Code", "Quantity", "Shelf", "Inventory Type",
      "QC Comment", "Created By", "Created", "Last Updated", "GRN Number",
      "Gatepass Code", "Vendor Code", "To Party",
    ],
  },
  {
    name: INWARD_TAT.SHEETS.FACT,
    tabColor: INWARD_TAT.COLORS.GREEN,
    headers: [
      "Record Key", "Facility", "SKU", "GRN Number", "Unloading Timestamp",
      "GRN Received Timestamp", "Putaway Completed Timestamp",
      "KPI3 Unloading to GRN Hours", "KPI2 GRN to Putaway Hours",
      "KPI1 Unloading to Putaway Hours", "Unloading Date", "GRN Date", "Putaway Date",
      "Record Status", "Exception Code", "Exception Detail", "Goods Source Row",
      "GRN Source Row", "Putaway Source Row", "Calculated At",
    ],
  },
  {
    name: INWARD_TAT.SHEETS.MTD,
    tabColor: INWARD_TAT.COLORS.GREEN,
    headers: [
      "Summary Date", "Facility", "KPI1 Unloading to Putaway Avg Hours",
      "KPI2 GRN to Putaway Avg Hours", "KPI3 Unloading to GRN Avg Hours",
      "Unique Records", "Complete Records", "Exception Records", "Last Refreshed At",
    ],
  },
  {
    name: INWARD_TAT.SHEETS.EXCEPTIONS,
    tabColor: INWARD_TAT.COLORS.RED,
    headers: [
      "Exception Id", "Detected At", "Source Report", "Source Row", "Facility", "SKU",
      "GRN Number", "Exception Code", "Exception Detail", "Resolution Status",
      "Resolved By", "Resolved At",
    ],
  },
  {
    name: INWARD_TAT.SHEETS.IMPORT_LOG,
    tabColor: INWARD_TAT.COLORS.AMBER,
    headers: [
      "Import Id", "Started At", "Completed At", "Source Type", "Source Name",
      "Email Message Id", "Facility", "Rows Read", "Rows Added", "Rows Skipped",
      "Status", "Error Detail",
    ],
  },
  {
    name: INWARD_TAT.SHEETS.EXECUTION_LOG,
    tabColor: INWARD_TAT.COLORS.BLUE,
    headers: [
      "Run Id", "Timestamp", "Stage", "Status", "Message", "Report Type",
      "Email Subject", "Email Received At", "Email Message Id", "Export Job",
      "Facility", "CSV URL", "Rows Read", "Rows Imported", "Rows Skipped",
      "Duration Seconds",
    ],
    widths: [240, 170, 180, 130, 500, 120, 320, 170, 200, 300, 150, 500, 110, 120, 110, 120],
  },
  {
    name: INWARD_TAT.SHEETS.EMAIL_LOG,
    tabColor: INWARD_TAT.COLORS.AMBER,
    headers: [
      "Email Run Id", "Generated At", "Period Start", "Period End", "Recipients",
      "KPI1 Hours", "KPI2 Hours", "KPI3 Hours", "CSV File Id", "Status", "Error Detail",
    ],
  },
]);

const CONFIG_DEFAULTS = Object.freeze([
  ["APP_VERSION", INWARD_TAT.VERSION, "TEXT", "Workbook/backend schema version."],
  ["TIME_ZONE", "Asia/Kolkata", "TEXT", "Timezone used for all elapsed-hour calculations."],
  ["TAT_CALCULATION_MODE", "CONTINUOUS", "TEXT", "Continuous elapsed time; includes nights, Sundays and holidays."],
  ["AVERAGE_METHOD", "SIMPLE", "TEXT", "Simple average across unique Facility + SKU + GRN records."],
  ["UNIQUE_KEY_FIELDS", "FACILITY|GRN_NUMBER|SKU", "TEXT", "Fields used to deduplicate and join source reports."],
  ["GOODS_START_FIELDS", "UNLOADING_DATE|UNLOADING_TIME", "TEXT", "Start timestamp for the TAT calculation."],
  ["GRN_TIMESTAMP_FIELD", "GRN_RECEIVED_TIMESTAMP", "TEXT", "GRN milestone timestamp."],
  ["PUTAWAY_TIMESTAMP_FIELD", "LAST_UPDATED", "TEXT", "Putaway completion timestamp; latest value wins for partial putaway."],
  ["PUTAWAY_TYPE_FILTER", "PUTAWAY_GRN_ITEM", "TEXT", "Only this putaway row type is processed."],
  ["PUTAWAY_STATUS_FILTER", "COMPLETE", "TEXT", "Only completed putaway rows contribute to completed KPIs."],
  ["FACILITY_SL_AMBIENT", "SL Ambient", "TEXT", "Canonical facility name for GRN and dashboard output."],
  ["FACILITY_SL_MOTHER_HUB", "SL Mother Hub", "TEXT", "Canonical facility name for GRN and dashboard output."],
  ["FACILITY_SL_RX", "SL Rx", "TEXT", "Canonical facility name for GRN and dashboard output."],
  ["PUTAWAY_EXPORT_SLAMB", "GRN/Putaway-SLAMB", "TEXT", "Email export job mapped to SL Ambient."],
  ["PUTAWAY_EXPORT_SLMH", "GRN/Putaway-SLMH", "TEXT", "Email export job mapped to SL Mother Hub."],
  ["PUTAWAY_EXPORT_SLRX", "GRN/Putaway-SLRX", "TEXT", "Email export job mapped to SL Rx."],
  ["GRN_EMAIL_FROM", "noreply@e.unicommerce.com", "TEXT", "Expected sender for the GRN report."],
  ["GRN_EMAIL_SUBJECT", "Export Job Complete - GRN", "TEXT", "Exact subject used to locate the GRN report."],
  ["PUTAWAY_EMAIL_FROM", "noreply@e.unicommerce.com", "TEXT", "Expected sender for putaway reports."],
  ["PUTAWAY_EMAIL_SUBJECT", "Export Job Complete - GRN/Gatepass to Putaway", "TEXT", "Shared subject for all three putaway facility exports."],
  ["KPI1_LABEL", "Unloading to Putaway", "TEXT", "Primary/banner KPI."],
  ["KPI2_LABEL", "GRN to Putaway", "TEXT", "Secondary KPI."],
  ["KPI3_LABEL", "Unloading to GRN", "TEXT", "Secondary KPI."],
  ["LAST_QUARTER_KPI1_HOURS", 29.84, "NUMBER", "Published value; retained exactly as provided."],
  ["LAST_QUARTER_KPI2_HOURS", 13, "NUMBER", "Published value; retained exactly as provided."],
  ["LAST_QUARTER_KPI3_HOURS", 15.84, "NUMBER", "Published value; retained exactly as provided."],
  ["LAST_MONTH_KPI1_HOURS", 28.4, "NUMBER", "Published value; retained exactly as provided."],
  ["LAST_MONTH_KPI2_HOURS", 14.4, "NUMBER", "Published value; retained exactly as provided."],
  ["LAST_MONTH_KPI3_HOURS", 14, "NUMBER", "Published value; retained exactly as provided."],
  ["GOODS_SOURCE_SPREADSHEET_ID", "", "TEXT", "Spreadsheet ID of the manual Goods Inward tracker."],
  ["GOODS_SOURCE_SHEET_NAME", "", "TEXT", "Fallback tab name in the Goods Inward tracker."],
  ["GOODS_SOURCE_TAB_MODE", "AUTO_MONTHLY", "TEXT", "Automatically selects the current FG monthly tab."],
  ["GOODS_SOURCE_SHEET_PREFIX", "FG-", "TEXT", "Prefix used to locate monthly Goods Inward tabs."],
  ["GOODS_ALLOWED_FACILITIES", "SL Mother Hub|SL Ambient", "TEXT", "Only these Goods Inward facilities are imported."],
  ["RX_BRIDGE_ENABLED", "TRUE", "TEXT", "Reclassifies SL Ambient unloading rows as SL Rx when GRN Number + SKU exists in the SL Rx GRN dump."],
  ["RX_BRIDGE_FIELDS", "GRN_NUMBER|SKU", "TEXT", "Bridge used between Goods Inward, GRN and Putaway."],
  ["DASHBOARD_URL", "", "URL", "Production dashboard URL included in stakeholder email."],
  ["EMAIL_RECIPIENTS", "", "EMAIL_LIST", "Comma-separated stakeholder recipients."],
  ["EMAIL_SEND_TIME", "", "TIME", "Daily stakeholder email time in TIME_ZONE."],
  ["EMAIL_LOOKBACK_DAYS", 45, "NUMBER", "Gmail search window used by the ingestion pipeline."],
  ["ERP_EXPORT_MODE", "MTD_CUMULATIVE", "TEXT", "Uses the latest MTD GRN export and latest named Putaway export for each facility."],
  ["PIPELINE_BATCH_SIZE", 500, "NUMBER", "Maximum rows written to Sheets in one operation."],
  ["LAST_SUCCESSFUL_REFRESH", "", "DATETIME", "Updated only after a complete successful pipeline run."],
]);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Inward TAT")
    .addItem("Set up workbook", "setupInwardTatWorkbook")
    .addItem("Validate workbook", "validateInwardTatWorkbook")
    .addSeparator()
    .addItem("Configure daily email", "configureInwardTatEmail")
    .addItem("Activate daily email + send test", "activateInwardTatEmail")
    .addItem("Send email now", "sendDailyInwardTatEmail")
    .addToUi();
}

function setupInwardTatWorkbook() {
  const spreadsheet = openInwardTatSpreadsheet_();
  spreadsheet.setSpreadsheetTimeZone("Asia/Kolkata");

  reuseEmptyDefaultSheet_(spreadsheet);

  SHEET_DEFINITIONS.forEach(function (definition) {
    const sheet = getOrCreateSheet_(spreadsheet, definition.name);
    ensureHeaders_(sheet, definition.headers);
    styleSheet_(sheet, definition);
  });

  seedConfig_(spreadsheet.getSheetByName(INWARD_TAT.SHEETS.CONFIG));
  applyDataFormats_(spreadsheet);
  createNamedRanges_(spreadsheet);
  onOpen();

  const result = validateInwardTatWorkbook(false);
  if (!result.ok) {
    throw new Error("Workbook setup did not pass validation: " + result.errors.join(" | "));
  }

  spreadsheet.toast(
    "Workbook structure is ready. Phase 1 validation passed.",
    "Inward TAT",
    6
  );
  return result;
}

function validateInwardTatWorkbook(showToast) {
  const spreadsheet = openInwardTatSpreadsheet_();
  const errors = [];
  const checks = [];

  SHEET_DEFINITIONS.forEach(function (definition) {
    const sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) {
      errors.push("Missing sheet: " + definition.name);
      return;
    }

    const actualHeaders = sheet
      .getRange(1, 1, 1, definition.headers.length)
      .getDisplayValues()[0];
    const mismatches = definition.headers.filter(function (header, index) {
      return actualHeaders[index] !== header;
    });

    if (mismatches.length) {
      errors.push(
        definition.name + " header mismatch: " + mismatches.join(", ")
      );
    } else {
      checks.push(definition.name + ": OK");
    }
  });

  const configSheet = spreadsheet.getSheetByName(INWARD_TAT.SHEETS.CONFIG);
  if (configSheet) {
    const configKeys =
      configSheet.getLastRow() > 1
        ? configSheet
            .getRange(2, 1, configSheet.getLastRow() - 1, 1)
            .getDisplayValues()
            .flat()
            .filter(String)
        : [];
    CONFIG_DEFAULTS.forEach(function (row) {
      if (configKeys.indexOf(row[0]) === -1) {
        errors.push("Missing config key: " + row[0]);
      }
    });
  }

  const result = {
    ok: errors.length === 0,
    version: INWARD_TAT.VERSION,
    checks: checks,
    errors: errors,
    validatedAt: new Date().toISOString(),
  };

  if (showToast !== false) {
    spreadsheet.toast(
      result.ok ? "Phase 1 validation passed." : errors.join(" | "),
      "Inward TAT",
      result.ok ? 5 : 10
    );
  }
  return result;
}

function openInwardTatSpreadsheet_() {
  return SpreadsheetApp.openById(INWARD_TAT.SPREADSHEET_ID);
}

function reuseEmptyDefaultSheet_(spreadsheet) {
  if (spreadsheet.getSheetByName(INWARD_TAT.SHEETS.CONFIG)) return;
  const defaultSheet = spreadsheet.getSheetByName("Sheet1");
  if (!defaultSheet) return;

  const isEmpty =
    defaultSheet.getLastRow() === 0 ||
    (defaultSheet.getLastRow() === 1 &&
      defaultSheet.getLastColumn() === 1 &&
      defaultSheet.getRange("A1").isBlank());
  if (isEmpty) defaultSheet.setName(INWARD_TAT.SHEETS.CONFIG);
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns()
    );
  }

  const existing = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const isBlank = existing.every(function (value) {
    return value === "";
  });

  if (isBlank) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }

  const mismatch = headers.some(function (header, index) {
    return existing[index] !== header;
  });
  if (mismatch) {
    throw new Error(
      "Header protection: sheet '" +
        sheet.getName() +
        "' already contains a different structure."
    );
  }
}

function styleSheet_(sheet, definition) {
  const headerRange = sheet.getRange(1, 1, 1, definition.headers.length);
  headerRange
    .setBackground(INWARD_TAT.COLORS.NAVY)
    .setFontColor(INWARD_TAT.COLORS.WHITE)
    .setFontFamily("Arial")
    .setFontWeight("bold")
    .setFontSize(10)
    .setVerticalAlignment("middle")
    .setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);
  sheet.setTabColor(definition.tabColor);
  sheet.setHiddenGridlines(false);

  if (definition.widths) {
    definition.widths.forEach(function (width, index) {
      sheet.setColumnWidth(index + 1, width);
    });
  } else {
    const maxColumnsToSize = Math.min(definition.headers.length, 24);
    for (let column = 1; column <= maxColumnsToSize; column += 1) {
      sheet.setColumnWidth(column, column <= 7 ? 145 : 125);
    }
  }

  const filter = sheet.getFilter();
  if (!filter && sheet.getMaxRows() > 1) {
    sheet
      .getRange(1, 1, sheet.getMaxRows(), definition.headers.length)
      .createFilter();
  }
}

function seedConfig_(sheet) {
  const existingCount = Math.max(sheet.getLastRow() - 1, 0);
  const existingRows = existingCount
    ? sheet.getRange(2, 1, existingCount, 5).getValues()
    : [];
  const existingKeys = new Set(
    existingRows.map(function (row) {
      return String(row[0]).trim();
    })
  );
  const now = new Date();
  const missingRows = CONFIG_DEFAULTS.filter(function (row) {
    return !existingKeys.has(row[0]);
  }).map(function (row) {
    return [row[0], row[1], row[2], row[3], now];
  });

  if (missingRows.length) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, missingRows.length, 5)
      .setValues(missingRows);
  }

  const dataRows = Math.max(sheet.getLastRow() - 1, 1);
  sheet.getRange(2, 5, dataRows, 1).setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange(2, 1, dataRows, 1).setFontWeight("bold");
  sheet.getRange(2, 4, dataRows, 1).setFontColor(INWARD_TAT.COLORS.MUTED);
  sheet.getRange(2, 1, dataRows, 5).setVerticalAlignment("top");
}

function applyDataFormats_(spreadsheet) {
  const fact = spreadsheet.getSheetByName(INWARD_TAT.SHEETS.FACT);
  fact.getRange("E:G").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  fact.getRange("H:J").setNumberFormat("0.00");
  fact.getRange("K:M").setNumberFormat("yyyy-mm-dd");
  fact.getRange("T:T").setNumberFormat("yyyy-mm-dd hh:mm:ss");

  const mtd = spreadsheet.getSheetByName(INWARD_TAT.SHEETS.MTD);
  mtd.getRange("A:A").setNumberFormat("yyyy-mm-dd");
  mtd.getRange("C:E").setNumberFormat("0.00");
  mtd.getRange("F:H").setNumberFormat("#,##0");
  mtd.getRange("I:I").setNumberFormat("yyyy-mm-dd hh:mm:ss");

  const exceptions = spreadsheet.getSheetByName(INWARD_TAT.SHEETS.EXCEPTIONS);
  exceptions.getRange("B:B").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  exceptions.getRange("L:L").setNumberFormat("yyyy-mm-dd hh:mm:ss");

  const importLog = spreadsheet.getSheetByName(INWARD_TAT.SHEETS.IMPORT_LOG);
  importLog.getRange("B:C").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  importLog.getRange("H:J").setNumberFormat("#,##0");
}

function createNamedRanges_(spreadsheet) {
  setNamedRange_(
    spreadsheet,
    "INWARD_TAT_CONFIG",
    spreadsheet
      .getSheetByName(INWARD_TAT.SHEETS.CONFIG)
      .getRange(1, 1, Math.max(2, spreadsheet.getSheetByName(INWARD_TAT.SHEETS.CONFIG).getLastRow()), 5)
  );
  setNamedRange_(
    spreadsheet,
    "INWARD_TAT_FACT",
    spreadsheet
      .getSheetByName(INWARD_TAT.SHEETS.FACT)
      .getRange(1, 1, Math.max(2, spreadsheet.getSheetByName(INWARD_TAT.SHEETS.FACT).getLastRow()), 20)
  );
  setNamedRange_(
    spreadsheet,
    "INWARD_TAT_MTD_SUMMARY",
    spreadsheet
      .getSheetByName(INWARD_TAT.SHEETS.MTD)
      .getRange(1, 1, Math.max(2, spreadsheet.getSheetByName(INWARD_TAT.SHEETS.MTD).getLastRow()), 9)
  );
}

function setNamedRange_(spreadsheet, name, range) {
  const existing = spreadsheet
    .getNamedRanges()
    .find(function (namedRange) {
      return namedRange.getName() === name;
    });
  if (existing) existing.remove();
  spreadsheet.setNamedRange(name, range);
}
