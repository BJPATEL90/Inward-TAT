const INWARD_TAT_DASHBOARD_URL =
  "https://bjpatel90.github.io/Inward-TAT/";

/**
 * One-time guided setup. Run from the Apps Script editor or the Inward TAT
 * spreadsheet menu, then approve the requested Gmail/trigger permissions.
 */
function configureInwardTatEmail() {
  const ui = SpreadsheetApp.getUi();
  const config = getConfig_();
  const recipientsResponse = ui.prompt(
    "Inward TAT email recipients",
    "Enter comma-separated email addresses.",
    ui.ButtonSet.OK_CANCEL
  );
  if (recipientsResponse.getSelectedButton() !== ui.Button.OK) return;

  const recipients = recipientsResponse.getResponseText().trim();
  validateEmailRecipients_(recipients);

  const timeResponse = ui.prompt(
    "Daily send time",
    "Enter time in 24-hour HH:MM format (Asia/Kolkata), for example 10:30.",
    ui.ButtonSet.OK_CANCEL
  );
  if (timeResponse.getSelectedButton() !== ui.Button.OK) return;

  const sendTime = timeResponse.getResponseText().trim();
  parseEmailTime_(sendTime);
  setConfigValue_("EMAIL_RECIPIENTS", recipients);
  setConfigValue_("EMAIL_SEND_TIME", sendTime);
  setConfigValue_(
    "DASHBOARD_URL",
    String(config.DASHBOARD_URL || INWARD_TAT_DASHBOARD_URL).trim() ||
      INWARD_TAT_DASHBOARD_URL
  );
  installDailyInwardTatEmailTrigger_();
  ui.alert(
    "Daily email configured",
    "The report will be sent daily at approximately " +
      sendTime +
      " Asia/Kolkata.",
    ui.ButtonSet.OK
  );
}

/**
 * Sends the current MTD operational report to EMAIL_RECIPIENTS.
 */
function sendDailyInwardTatEmail() {
  const startedAt = new Date();
  const runId = "EMAIL-" + Utilities.getUuid();
  let recipients = "";
  let payload = null;
  console.log("[" + runId + "] EMAIL | STARTED | Preparing Inward TAT email.");
  try {
    const config = getConfig_();
    recipients = String(config.EMAIL_RECIPIENTS || "").trim();
    validateEmailRecipients_(recipients);
    console.log(
      "[" +
        runId +
        "] EMAIL_CONFIG | COMPLETED | Configuration loaded for " +
        recipients.split(",").length +
        " recipient(s)."
    );

    console.log(
      "[" + runId + "] EMAIL_PAYLOAD | STARTED | Building KPI cards, chart and monthly workbook."
    );
    payload = buildInwardTatEmailPayload_(config);
    console.log(
      "[" +
        runId +
        "] EMAIL_PAYLOAD | COMPLETED | " +
        payload.facts.length +
        " current-month record(s) prepared; attachment " +
        payload.workbookBlob.getName() +
        "."
    );

    console.log(
      "[" + runId + "] EMAIL_SEND | STARTED | Sending stakeholder email."
    );
    GmailApp.sendEmail(
      recipients,
      "Inward TAT | " + payload.subjectDateLabel,
      "Please view this email in HTML format.",
      {
        htmlBody: payload.html,
        attachments: [payload.workbookBlob],
        inlineImages: { mtdTrend: payload.chartBlob },
        name: "Mosaic Wellness | Inward TAT",
      }
    );
    appendEmailLog_([
      runId,
      startedAt,
      payload.periodStart,
      payload.periodEnd,
      recipients,
      payload.summary.kpi1Hours,
      payload.summary.kpi2Hours,
      payload.summary.kpi3Hours,
      payload.workbookBlob.getName(),
      "SENT",
      "",
    ]);
    console.log(
      "[" +
        runId +
        "] EMAIL_SEND | COMPLETED | Email sent successfully to " +
        recipients.split(",").length +
        " recipient(s)."
    );
    return {
      ok: true,
      runId: runId,
      recipients: recipients,
      records: payload.facts.length,
    };
  } catch (error) {
    console.error(
      "[" +
        runId +
        "] EMAIL | FAILED | " +
        (error.message || String(error))
    );
    appendEmailLog_([
      runId,
      startedAt,
      payload ? payload.periodStart : "",
      payload ? payload.periodEnd : "",
      recipients,
      payload ? payload.summary.kpi1Hours : "",
      payload ? payload.summary.kpi2Hours : "",
      payload ? payload.summary.kpi3Hours : "",
      payload ? payload.workbookBlob.getName() : "",
      "FAILED",
      error.message || String(error),
    ]);
    throw error;
  }
}

function activateInwardTatEmail() {
  installDailyInwardTatEmailTrigger_();
  return sendDailyInwardTatEmail();
}

function buildInwardTatEmailPayload_(config) {
  const timeZone = String(config.TIME_ZONE || "Asia/Kolkata");
  const facts = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.FACT));
  const daily = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.MTD));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthFacts = facts.filter(function (row) {
    const date = parseDateTime_(row["Unloading Date"]);
    return date && date >= previousMonthStart && date < previousMonthEnd;
  });
  const mtdFacts = facts.filter(function (row) {
    const date = parseDateTime_(row["Unloading Date"]);
    return date && date >= monthStart && date < nextMonth;
  });
  if (!mtdFacts.length) {
    throw new Error("No MTD Fact_Inward_TAT records are available for the email.");
  }

  const periodEnd = mtdFacts.reduce(function (latest, row) {
    const date = parseDateTime_(row["Unloading Date"]);
    return !latest || date > latest ? date : latest;
  }, null);
  const summary = summarizeEmailFacts_(mtdFacts);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = Utilities.formatDate(yesterday, timeZone, "yyyy-MM-dd");
  const yesterdaySummary = summarizeEmailFacts_(
    mtdFacts.filter(function (row) {
      const unloadingDate = parseDateTime_(row["Unloading Date"]);
      return (
        unloadingDate &&
        Utilities.formatDate(unloadingDate, timeZone, "yyyy-MM-dd") ===
          yesterdayKey
      );
    })
  );
  const chartBlob = buildMtdTrendChart_(daily, monthStart, nextMonth, timeZone);
  const workbookBlob = buildMonthlyWorkbook_(
    lastMonthFacts,
    mtdFacts,
    previousMonthStart,
    monthStart,
    periodEnd,
    timeZone
  );
  const dashboardUrl =
    String(config.DASHBOARD_URL || "").trim() || INWARD_TAT_DASHBOARD_URL;

  return {
    facts: mtdFacts,
    summary: summary,
    periodStart: monthStart,
    periodEnd: periodEnd,
    subjectDateLabel: Utilities.formatDate(now, timeZone, "dd MMM yyyy"),
    workbookBlob: workbookBlob,
    chartBlob: chartBlob,
    html: buildInwardTatEmailHtml_(
      {
        lastQuarter: {
          kpi1Hours: Number(config.LAST_QUARTER_KPI1_HOURS),
          kpi2Hours: Number(config.LAST_QUARTER_KPI2_HOURS),
          kpi3Hours: Number(config.LAST_QUARTER_KPI3_HOURS),
        },
        lastMonth: {
          kpi1Hours: Number(config.LAST_MONTH_KPI1_HOURS),
          kpi2Hours: Number(config.LAST_MONTH_KPI2_HOURS),
          kpi3Hours: Number(config.LAST_MONTH_KPI3_HOURS),
        },
        mtd: summary,
        yesterday: yesterdaySummary,
      },
      monthStart,
      periodEnd,
      yesterday,
      now,
      dashboardUrl,
      timeZone
    ),
  };
}

function summarizeEmailFacts_(facts) {
  function average(field) {
    const values = facts
      .map(function (row) {
        const raw = row[field];
        return raw === "" || raw === null || raw === undefined
          ? null
          : Number(raw);
      })
      .filter(function (value) {
        return typeof value === "number" && isFinite(value) && value >= 0;
      });
    if (!values.length) return null;
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
  return {
    kpi1Hours: average("KPI1 Unloading to Putaway Hours"),
    kpi2Hours: average("KPI2 GRN to Putaway Hours"),
    kpi3Hours: average("KPI3 Unloading to GRN Hours"),
    records: facts.length,
    completeRecords: facts.filter(function (row) {
      return String(row["Record Status"]).toUpperCase() === "COMPLETE";
    }).length,
  };
}

function buildMtdTrendChart_(daily, monthStart, nextMonth, timeZone) {
  const rows = daily
    .filter(function (row) {
      const date = parseDateTime_(row["Summary Date"]);
      const facility = String(row.Facility || "");
      return (
        date &&
        date >= monthStart &&
        date < nextMonth &&
        facility === "All Mother Facilities" &&
        isFinite(Number(row["KPI1 Unloading to Putaway Avg Hours"]))
      );
    })
    .sort(function (a, b) {
      return (
        parseDateTime_(a["Summary Date"]).getTime() -
        parseDateTime_(b["Summary Date"]).getTime()
      );
    });
  if (!rows.length) {
    throw new Error("No MTD KPI1 daily trend data is available for the email.");
  }

  const table = Charts.newDataTable()
    .addColumn(Charts.ColumnType.STRING, "Date")
    .addColumn(Charts.ColumnType.NUMBER, "KPI1 (hours)");
  rows.forEach(function (row) {
    table.addRow([
      Utilities.formatDate(
        parseDateTime_(row["Summary Date"]),
        timeZone,
        "dd MMM"
      ),
      Number(row["KPI1 Unloading to Putaway Avg Hours"]),
    ]);
  });

  return Charts.newLineChart()
    .setDataTable(table.build())
    .setTitle("MTD KPI1 Trend — Unloading to Putaway")
    .setDimensions(900, 330)
    .setLegendPosition(Charts.Position.NONE)
    .setColors(["#2443C4"])
    .setPointStyle(Charts.PointStyle.MEDIUM)
    .setOption("backgroundColor", "#ffffff")
    .setOption("chartArea", { left: 65, top: 55, width: "87%", height: "65%" })
    .setOption("vAxis", { title: "Hours", minValue: 0 })
    .build()
    .getAs("image/png")
    .setName("inward-tat-mtd-trend.png");
}

function monthlyWorkbookHeaders_() {
  return [
    "Facility",
    "GRN Number",
    "SKU",
    "Unloading Timestamp",
    "GRN Received Timestamp",
    "Putaway Completed Timestamp",
    "KPI1 Unloading to Putaway Hours",
    "KPI2 GRN to Putaway Hours",
    "KPI3 Unloading to GRN Hours",
    "Record Status",
    "Exception Code",
    "Exception Detail",
  ];
}

function writeMonthlyWorkbookSheet_(sheet, facts) {
  const headers = monthlyWorkbookHeaders_();
  const values = facts.map(function (row) {
    return headers.map(function (header) {
      return row[header];
    });
  });
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) {
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
  sheet.setFrozenRows(1);
  sheet
    .getRange(1, 1, 1, headers.length)
    .setBackground("#1d3474")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  sheet.getRange("D:F").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  sheet.getRange("G:I").setNumberFormat("0.0000");
  sheet.setColumnWidths(1, headers.length, 150);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(12, 280);
}

function buildMonthlyWorkbook_(
  lastMonthFacts,
  currentMonthFacts,
  lastMonthStart,
  currentMonthStart,
  currentPeriodEnd,
  timeZone
) {
  const temporary = SpreadsheetApp.create(
    "TEMP_Inward_TAT_" + Utilities.getUuid()
  );
  const temporaryId = temporary.getId();
  try {
    const lastMonthLabel = Utilities.formatDate(
      lastMonthStart,
      timeZone,
      "MMM yyyy"
    );
    const currentMonthLabel = Utilities.formatDate(
      currentMonthStart,
      timeZone,
      "MMM yyyy"
    );
    const lastMonthSheet = temporary.getSheets()[0];
    lastMonthSheet.setName("Last Month - " + lastMonthLabel);
    const currentMonthSheet = temporary.insertSheet(
      "Current MTD - " + currentMonthLabel
    );
    writeMonthlyWorkbookSheet_(lastMonthSheet, lastMonthFacts);
    writeMonthlyWorkbookSheet_(currentMonthSheet, currentMonthFacts);
    SpreadsheetApp.flush();

    const response = UrlFetchApp.fetch(
      "https://docs.google.com/spreadsheets/d/" +
        temporaryId +
        "/export?format=xlsx",
      {
        headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
      }
    );
    if (response.getResponseCode() !== 200) {
      throw new Error(
        "Monthly workbook export failed with HTTP " +
          response.getResponseCode() +
          "."
      );
    }
    const fileName =
      "Inward_TAT_Last_Month_and_MTD_" +
      Utilities.formatDate(currentPeriodEnd, timeZone, "yyyyMMdd") +
      ".xlsx";
    return response
      .getBlob()
      .setContentType(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
      .setName(fileName);
  } finally {
    try {
      const cleanupResponse = UrlFetchApp.fetch(
        "https://www.googleapis.com/drive/v3/files/" + temporaryId,
        {
          method: "delete",
          headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
          muteHttpExceptions: true,
        }
      );
      if (cleanupResponse.getResponseCode() !== 204) {
        throw new Error("HTTP " + cleanupResponse.getResponseCode());
      }
    } catch (cleanupError) {
      console.warn(
        "Temporary monthly workbook cleanup failed: " + cleanupError.message
      );
    }
  }
}

function buildMtdCsv_(facts, periodStart, periodEnd, timeZone) {
  const headers = [
    "Facility",
    "GRN Number",
    "SKU",
    "Unloading Timestamp",
    "GRN Received Timestamp",
    "Putaway Completed Timestamp",
    "KPI1 Unloading to Putaway Hours",
    "KPI2 GRN to Putaway Hours",
    "KPI3 Unloading to GRN Hours",
    "Record Status",
    "Exception Code",
    "Exception Detail",
  ];
  const lines = [headers.map(csvEscape_).join(",")];
  facts.forEach(function (row) {
    lines.push(
      headers
        .map(function (header) {
          return csvEscape_(row[header]);
        })
        .join(",")
    );
  });
  const fileName =
    "Inward_TAT_MTD_" +
    Utilities.formatDate(periodStart, timeZone, "yyyyMMdd") +
    "_to_" +
    Utilities.formatDate(periodEnd, timeZone, "yyyyMMdd") +
    ".csv";
  return Utilities.newBlob(
    "\uFEFF" + lines.join("\r\n"),
    "text/csv",
    fileName
  );
}

function buildInwardTatEmailHtml_(
  periods,
  periodStart,
  periodEnd,
  yesterday,
  publishedAt,
  dashboardUrl,
  timeZone
) {
  const publishedLabel = Utilities.formatDate(
    publishedAt,
    timeZone,
    "dd MMM yyyy, hh:mm a"
  );
  const previousMonthStart = new Date(
    periodStart.getFullYear(),
    periodStart.getMonth() - 1,
    1
  );
  const previousMonthEnd = new Date(
    periodStart.getFullYear(),
    periodStart.getMonth(),
    0
  );
  const currentQuarterStartMonth =
    Math.floor(periodStart.getMonth() / 3) * 3;
  const previousQuarterStart = new Date(
    periodStart.getFullYear(),
    currentQuarterStartMonth - 3,
    1
  );
  const previousQuarterEnd = new Date(
    periodStart.getFullYear(),
    currentQuarterStartMonth,
    0
  );
  const yesterdayLabel = Utilities.formatDate(yesterday, timeZone, "dd MMM yyyy");
  const alertHtml =
    periods.yesterday.records === 0
      ? '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;border:1px solid #f1c84b;border-radius:12px;background:#fffaf0"><tr><td class="alert-cell" style="padding:20px 22px;color:#8a3f08"><div style="font-size:18px;font-weight:700">Yesterday data entry is pending.</div><div style="margin-top:10px;font-size:14px"><strong>Reason:</strong> No vehicle unloading records were available for ' +
        yesterdayLabel +
        " at the latest refresh.</div></td></tr></table>"
      : '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px;border:1px solid #9bd9ba;border-radius:12px;background:#f0fbf5"><tr><td class="alert-cell" style="padding:18px 22px;color:#0b6b43"><strong>Yesterday:</strong> ' +
        periods.yesterday.completeRecords +
        " of " +
        periods.yesterday.records +
        " records are complete.</td></tr></table>";
  return (
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    '@media only screen and (max-width:640px){' +
    '.email-shell{padding:0!important}.email-container{border-radius:0!important}.email-header{padding:24px 18px!important}' +
    '.header-logo,.header-copy{display:block!important;width:100%!important;text-align:left!important}.header-logo{padding-bottom:18px!important}' +
    '.header-logo div{width:82px!important;height:57px!important;padding-top:19px!important}.email-title{font-size:24px!important;line-height:30px!important}' +
    '.email-content{padding:24px 16px 30px!important}.kpi-grid{border-spacing:0!important}.kpi-grid,.kpi-grid tbody,.kpi-grid tr,.kpi-card{display:block!important;width:100%!important}' +
    '.kpi-card{box-sizing:border-box!important;margin:0 0 12px!important;padding:18px 14px!important}.alert-cell{padding:18px 16px!important}' +
    '.trend-image{width:100%!important;height:auto!important}.dashboard-button{display:block!important;padding:14px 16px!important}.kpi-definitions span{display:block!important;margin-top:5px!important}.kpi-definitions .separator{display:none!important}.email-footer{padding:0 8px!important;overflow-wrap:anywhere!important;word-break:break-word!important}' +
    '}' +
    '</style></head><body style="margin:0;padding:0;background:#f1f5fa">' +
    '<div class="email-shell" style="margin:0;background:#f1f5fa;padding:20px;font-family:Arial,Helvetica,sans-serif;color:#172033">' +
    '<table class="email-container" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:900px;margin:0 auto;background:#ffffff;border-collapse:separate;border-spacing:0;border-radius:18px;overflow:hidden">' +
    '<tr><td class="email-header" style="background:#192a5b;padding:34px 40px;color:#ffffff">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>' +
    '<td class="header-logo" width="110" valign="middle"><div style="width:88px;height:64px;padding-top:22px;border:1px solid #8fb7ff;border-radius:12px;text-align:center;font-size:11px;line-height:16px;letter-spacing:1px;font-weight:700;color:#dce8ff">MOSAIC<br>WELLNESS</div></td>' +
    '<td class="header-copy" valign="middle"><div style="font-size:12px;letter-spacing:2px;font-weight:700;color:#9fc4ff">DAILY INWARD TAT REPORT</div>' +
    '<div class="email-title" style="font-size:28px;line-height:36px;font-weight:700;margin-top:8px">Inward TAT Dashboard</div>' +
    '<div style="font-size:14px;color:#cbd9f2;margin-top:7px">Published on: ' +
    publishedLabel +
    " IST" +
    "</div></td></tr></table></td></tr>" +
    '<tr><td class="email-content" style="padding:32px 38px 36px">' +
    '<div style="font-size:20px;font-weight:700">Vehicle Arrival to Putaway TAT</div>' +
    '<div style="font-size:14px;color:#60718d;margin-top:8px">Last Quarter, Last Month, Month to Date, and Yesterday.</div>' +
    '<div class="kpi-definitions" style="font-size:14px;color:#60718d;margin-top:5px"><span>KPI1: Unloading to Putaway</span><span class="separator"> &nbsp;&middot;&nbsp; </span><span>KPI2: GRN to Putaway</span><span class="separator"> &nbsp;&middot;&nbsp; </span><span>KPI3: Unloading to GRN</span></div>' +
    '<table class="kpi-grid" role="presentation" width="100%" cellspacing="8" cellpadding="0" style="margin-top:18px;table-layout:fixed"><tr>' +
    buildEmailPeriodCard_(
      "LAST QUARTER",
      periods.lastQuarter,
      "#dff8e9",
      "#19a45b",
      Utilities.formatDate(previousQuarterStart, timeZone, "dd MMM") +
        " – " +
        Utilities.formatDate(previousQuarterEnd, timeZone, "dd MMM yyyy")
    ) +
    buildEmailPeriodCard_(
      "LAST MONTH",
      periods.lastMonth,
      "#fff8cd",
      "#e5a900",
      Utilities.formatDate(previousMonthStart, timeZone, "dd MMM") +
        " – " +
        Utilities.formatDate(previousMonthEnd, timeZone, "dd MMM yyyy")
    ) +
    buildEmailPeriodCard_(
      "MONTH TO DATE",
      periods.mtd,
      "#dff8e9",
      "#19a45b",
      Utilities.formatDate(periodStart, timeZone, "dd MMM") +
        " – " +
        Utilities.formatDate(periodEnd, timeZone, "dd MMM yyyy")
    ) +
    buildEmailPeriodCard_(
      "YESTERDAY",
      periods.yesterday,
      "#ffe2e2",
      "#e72f35",
      yesterdayLabel
    ) +
    "</tr></table>" +
    alertHtml +
    '<div style="font-size:18px;font-weight:700;margin-top:28px">MTD KPI1 Daily Trend</div>' +
    '<div style="font-size:13px;color:#60718d;margin-top:5px">Unloading to Putaway average hours by unloading date.</div>' +
    '<div style="margin-top:14px"><img class="trend-image" src="cid:mtdTrend" alt="MTD KPI1 trend" style="display:block;width:100%;height:auto;max-width:824px;border:1px solid #d9e1ef;border-radius:12px"></div>' +
    '<div style="text-align:center;margin-top:28px"><a href="' +
    dashboardUrl +
    '" class="dashboard-button" style="display:inline-block;background:#2750df;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:9px;font-size:15px;font-weight:700">Open Inward TAT Dashboard</a></div>' +
    '<div class="email-footer" style="font-size:12px;line-height:18px;color:#71809a;margin-top:22px;text-align:center;box-sizing:border-box">The attached Excel workbook contains separate Last Month and Current MTD tabs at Facility + GRN + SKU level.<br>Dashboard access is restricted to Mosaic Wellness Google accounts.</div>' +
    "</td></tr></table></div></body></html>"
  );
}

function buildEmailPeriodCard_(label, summary, background, accent, dateLabel) {
  const records =
    summary.records === undefined || summary.records === null
      ? ""
      : '<div style="margin-top:5px"><strong>Records:</strong> ' +
        summary.records +
        "</div>";
  return (
    '<td class="kpi-card" width="25%" valign="top" style="background:' +
    background +
    ";border-top:4px solid " +
    accent +
    ';border-radius:11px;padding:17px 9px;text-align:center;color:#31435f">' +
    '<div style="font-size:10px;letter-spacing:.5px;font-weight:700;color:#5d6f88">' +
    label +
    "</div>" +
    '<div style="font-size:25px;line-height:32px;font-weight:800;color:' +
    accent +
    ';margin:6px 0 9px">' +
    formatEmailHours_(summary.kpi1Hours) +
    "</div>" +
    '<div style="font-size:9px;font-weight:600;color:#667995;margin-top:-5px;margin-bottom:8px">' +
    formatEmailDecimalHours_(summary.kpi1Hours) +
    "</div>" +
    '<div style="border-top:1px solid #bfd1df;padding-top:9px;font-size:11px;line-height:17px">' +
    "<div><strong>KPI2:</strong> " +
    formatEmailHours_(summary.kpi2Hours) +
    ' <span style="font-size:9px;color:#677995">(' +
    formatEmailDecimalHours_(summary.kpi2Hours) +
    ")</span>" +
    "</div>" +
    "<div><strong>KPI3:</strong> " +
    formatEmailHours_(summary.kpi3Hours) +
    ' <span style="font-size:9px;color:#677995">(' +
    formatEmailDecimalHours_(summary.kpi3Hours) +
    ")</span>" +
    "</div>" +
    records +
    '<div style="font-size:9px;color:#677995;margin-top:7px">' +
    dateLabel +
    "</div></div></td>"
  );
}

function installDailyInwardTatEmailTrigger_() {
  const config = getConfig_();
  const parsed = parseEmailTime_(String(config.EMAIL_SEND_TIME || ""));
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "sendDailyInwardTatEmail") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("sendDailyInwardTatEmail")
    .timeBased()
    .atHour(parsed.hour)
    .nearMinute(parsed.minute)
    .everyDays(1)
    .inTimezone(String(config.TIME_ZONE || "Asia/Kolkata"))
    .create();
}

function installDailyInwardTatEmailTrigger() {
  installDailyInwardTatEmailTrigger_();
  const config = getConfig_();
  return {
    ok: true,
    sendTime: String(config.EMAIL_SEND_TIME || ""),
    timeZone: String(config.TIME_ZONE || "Asia/Kolkata"),
    recipients: String(config.EMAIL_RECIPIENTS || ""),
  };
}

function parseEmailTime_(value) {
  const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error("EMAIL_SEND_TIME must use 24-hour HH:MM format.");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function validateEmailRecipients_(value) {
  const recipients = String(value || "")
    .split(",")
    .map(function (email) {
      return email.trim();
    })
    .filter(Boolean);
  if (!recipients.length) {
    throw new Error("EMAIL_RECIPIENTS is blank.");
  }
  const invalid = recipients.filter(function (email) {
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  });
  if (invalid.length) {
    throw new Error("Invalid email recipient(s): " + invalid.join(", "));
  }
}

function setConfigValue_(key, value) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.CONFIG);
  const rows = sheet.getDataRange().getValues();
  for (let index = 1; index < rows.length; index += 1) {
    if (String(rows[index][0]).trim() === key) {
      sheet.getRange(index + 1, 2).setValue(value);
      sheet.getRange(index + 1, 5).setValue(new Date());
      return;
    }
  }
  throw new Error("Config key not found: " + key);
}

function appendEmailLog_(row) {
  const sheet = getSheet_(INWARD_TAT.SHEETS.EMAIL_LOG);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function formatEmailHours_(hours) {
  if (hours === null || hours === undefined || !isFinite(Number(hours))) {
    return "—";
  }
  const totalMinutes = Math.round(Number(hours) * 60);
  const hourPart = Math.floor(totalMinutes / 60);
  const minutePart = totalMinutes % 60;
  return hourPart + "h " + String(minutePart).padStart(2, "0") + "m";
}

function formatEmailDecimalHours_(hours) {
  if (hours === null || hours === undefined || !isFinite(Number(hours))) {
    return "—";
  }
  return Number(hours).toFixed(2) + " decimal hrs";
}

function csvEscape_(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}
