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
  const config = getConfig_();
  const recipients = String(config.EMAIL_RECIPIENTS || "").trim();
  validateEmailRecipients_(recipients);

  const payload = buildInwardTatEmailPayload_(config);
  try {
    GmailApp.sendEmail(
      recipients,
      "Inward TAT | MTD update | " + payload.periodEndLabel,
      "Please view this email in HTML format.",
      {
        htmlBody: payload.html,
        attachments: [payload.csvBlob],
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
      payload.csvBlob.getName(),
      "SENT",
      "",
    ]);
    return {
      ok: true,
      runId: runId,
      recipients: recipients,
      records: payload.facts.length,
    };
  } catch (error) {
    appendEmailLog_([
      runId,
      startedAt,
      payload.periodStart,
      payload.periodEnd,
      recipients,
      payload.summary.kpi1Hours,
      payload.summary.kpi2Hours,
      payload.summary.kpi3Hours,
      payload.csvBlob.getName(),
      "FAILED",
      error.message || String(error),
    ]);
    throw error;
  }
}

function buildInwardTatEmailPayload_(config) {
  const timeZone = String(config.TIME_ZONE || "Asia/Kolkata");
  const facts = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.FACT));
  const daily = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.MTD));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
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
  const chartBlob = buildMtdTrendChart_(daily, monthStart, nextMonth, timeZone);
  const csvBlob = buildMtdCsv_(mtdFacts, monthStart, periodEnd, timeZone);
  const dashboardUrl =
    String(config.DASHBOARD_URL || "").trim() || INWARD_TAT_DASHBOARD_URL;

  return {
    facts: mtdFacts,
    summary: summary,
    periodStart: monthStart,
    periodEnd: periodEnd,
    periodEndLabel: Utilities.formatDate(periodEnd, timeZone, "dd MMM yyyy"),
    csvBlob: csvBlob,
    chartBlob: chartBlob,
    html: buildInwardTatEmailHtml_(
      summary,
      monthStart,
      periodEnd,
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
  summary,
  periodStart,
  periodEnd,
  dashboardUrl,
  timeZone
) {
  const period =
    Utilities.formatDate(periodStart, timeZone, "dd MMM yyyy") +
    " – " +
    Utilities.formatDate(periodEnd, timeZone, "dd MMM yyyy");
  const completion =
    summary.records > 0
      ? Math.round((summary.completeRecords / summary.records) * 100)
      : 0;
  return (
    '<div style="margin:0;background:#f4f7fc;padding:24px;font-family:Arial,sans-serif;color:#172033">' +
    '<div style="max-width:900px;margin:auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #d9e1ef">' +
    '<div style="padding:28px 32px;background:linear-gradient(120deg,#1d3475,#2443c4);color:#fff">' +
    '<div style="font-size:12px;letter-spacing:2px;font-weight:700">EXECUTIVE KPI</div>' +
    '<h1 style="margin:9px 0 5px;font-size:28px">Vehicle Arrival to Putaway TAT</h1>' +
    '<div style="font-size:14px;color:#dce5ff">MTD · ' +
    period +
    "</div></div>" +
    '<div style="padding:26px 32px">' +
    '<div style="display:inline-block;width:44%;min-width:250px;padding:22px;border-radius:14px;background:#f7f9fe;border:1px solid #d9e1ef;vertical-align:top">' +
    '<div style="font-size:12px;font-weight:700;color:#52627d">KPI1 · UNLOADING TO PUTAWAY</div>' +
    '<div style="font-size:38px;font-weight:800;color:#0b7a48;margin-top:8px">' +
    formatEmailHours_(summary.kpi1Hours) +
    "</div></div>" +
    '<div style="display:inline-block;width:44%;min-width:250px;margin-left:2%;padding:22px;border-radius:14px;background:#f7f9fe;border:1px solid #d9e1ef;vertical-align:top">' +
    '<div style="font-size:12px;color:#52627d">KPI2 · GRN TO PUTAWAY</div>' +
    '<div style="font-size:25px;font-weight:800;color:#1d3475;margin:7px 0 15px">' +
    formatEmailHours_(summary.kpi2Hours) +
    "</div>" +
    '<div style="font-size:12px;color:#52627d">KPI3 · UNLOADING TO GRN</div>' +
    '<div style="font-size:25px;font-weight:800;color:#1d3475;margin-top:7px">' +
    formatEmailHours_(summary.kpi3Hours) +
    "</div></div>" +
    '<p style="margin:20px 0 8px;color:#52627d">' +
    summary.completeRecords +
    " complete records of " +
    summary.records +
    " MTD records (" +
    completion +
    "%).</p>" +
    '<div style="margin-top:24px"><img src="cid:mtdTrend" alt="MTD KPI1 trend" style="width:100%;max-width:900px;border:1px solid #d9e1ef;border-radius:12px"></div>' +
    '<div style="margin-top:26px"><a href="' +
    dashboardUrl +
    '" style="display:inline-block;background:#2443c4;color:#fff;text-decoration:none;padding:13px 22px;border-radius:9px;font-weight:700">Open Inward TAT Dashboard</a></div>' +
    '<p style="font-size:12px;color:#71809a;margin-top:20px">The attached CSV contains MTD Facility + GRN + SKU level records. Dashboard access is restricted to Mosaic Wellness Google accounts.</p>' +
    "</div></div></div>"
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
  return (
    String(hourPart).padStart(2, "0") +
    ":" +
    String(minutePart).padStart(2, "0")
  );
}

function csvEscape_(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}
