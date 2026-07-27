/**
 * Read-only web API for the Inward TAT dashboard.
 *
 * Deploy this Apps Script project as a web app and point the React frontend's
 * VITE_APPS_SCRIPT_URL to the /exec URL.
 */

function doGet(event) {
  const action = String((event && event.parameter && event.parameter.action) || "dashboard")
    .trim()
    .toLowerCase();
  try {
    if (action === "health") {
      return apiResponse_({
        ok: true,
        service: "Inward TAT",
        generatedAt: new Date().toISOString(),
      }, event);
    }
    if (action !== "dashboard") {
      return jsonResponse_({ ok: false, error: "Unsupported action: " + action });
    }

    const bypassCache =
      String((event && event.parameter && event.parameter.refresh) || "") === "1";
    const cache = CacheService.getScriptCache();
    if (!bypassCache) {
      const cached = cache.get("INWARD_TAT_DASHBOARD_V1");
      if (cached) {
        return apiTextResponse_(cached, event);
      }
    }

    const payload = buildDashboardSnapshot_();
    const json = JSON.stringify(payload);
    if (json.length < 90000) {
      cache.put("INWARD_TAT_DASHBOARD_V1", json, 120);
    }
    return apiTextResponse_(json, event);
  } catch (error) {
    return apiResponse_({
      ok: false,
      error: error.message || String(error),
      generatedAt: new Date().toISOString(),
    }, event);
  }
}

function buildDashboardSnapshot_() {
  const config = getConfig_();
  const facts = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.FACT));
  const daily = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.MTD));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const currentMonthFacts = facts
    .filter(function (row) {
      const unloadingDate = parseDateTime_(row["Unloading Date"]);
      return unloadingDate && unloadingDate >= monthStart && unloadingDate < nextMonth;
    })
    .map(function (row) {
      return {
        recordKey: textOrBlank_(row["Record Key"]),
        facility: textOrBlank_(row.Facility),
        sku: textOrBlank_(row.SKU),
        grnNumber: textOrBlank_(row["GRN Number"]),
        unloadingTimestamp: apiDateTime_(row["Unloading Timestamp"]),
        grnReceivedTimestamp: apiDateTime_(row["GRN Received Timestamp"]),
        putawayCompletedTimestamp: apiDateTime_(row["Putaway Completed Timestamp"]),
        kpi1Hours: apiNumber_(row["KPI1 Unloading to Putaway Hours"]),
        kpi2Hours: apiNumber_(row["KPI2 GRN to Putaway Hours"]),
        kpi3Hours: apiNumber_(row["KPI3 Unloading to GRN Hours"]),
        unloadingDate: apiDate_(row["Unloading Date"]),
        grnDate: apiDate_(row["GRN Date"]),
        putawayDate: apiDate_(row["Putaway Date"]),
        status: textOrBlank_(row["Record Status"]),
        exceptionCode: textOrBlank_(row["Exception Code"]),
        exceptionDetail: textOrBlank_(row["Exception Detail"]),
      };
    });

  const currentMonthDaily = daily
    .filter(function (row) {
      const summaryDate = parseDateTime_(row["Summary Date"]);
      return summaryDate && summaryDate >= monthStart && summaryDate < nextMonth;
    })
    .map(function (row) {
      return {
        summaryDate: apiDate_(row["Summary Date"]),
        facility: textOrBlank_(row.Facility),
        kpi1Hours: apiNumber_(row["KPI1 Unloading to Putaway Avg Hours"]),
        kpi2Hours: apiNumber_(row["KPI2 GRN to Putaway Avg Hours"]),
        kpi3Hours: apiNumber_(row["KPI3 Unloading to GRN Avg Hours"]),
        uniqueRecords: apiNumber_(row["Unique Records"]),
        completeRecords: apiNumber_(row["Complete Records"]),
        exceptionRecords: apiNumber_(row["Exception Records"]),
      };
    });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = Utilities.formatDate(yesterday, "Asia/Kolkata", "yyyy-MM-dd");

  return {
    ok: true,
    apiVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    timeZone: textOrBlank_(config.TIME_ZONE) || "Asia/Kolkata",
    lastRefresh: apiDateTime_(config.LAST_SUCCESSFUL_REFRESH),
    labels: {
      kpi1: textOrBlank_(config.KPI1_LABEL) || "Unloading to Putaway",
      kpi2: textOrBlank_(config.KPI2_LABEL) || "GRN to Putaway",
      kpi3: textOrBlank_(config.KPI3_LABEL) || "Unloading to GRN",
    },
    staticPeriods: {
      lastQuarter: {
        kpi1Hours: apiNumber_(config.LAST_QUARTER_KPI1_HOURS),
        kpi2Hours: apiNumber_(config.LAST_QUARTER_KPI2_HOURS),
        kpi3Hours: apiNumber_(config.LAST_QUARTER_KPI3_HOURS),
      },
      lastMonth: {
        kpi1Hours: apiNumber_(config.LAST_MONTH_KPI1_HOURS),
        kpi2Hours: apiNumber_(config.LAST_MONTH_KPI2_HOURS),
        kpi3Hours: apiNumber_(config.LAST_MONTH_KPI3_HOURS),
      },
    },
    summary: {
      mtd: summarizeApiFacts_(currentMonthFacts),
      yesterday: summarizeApiFacts_(
        currentMonthFacts.filter(function (row) {
          return row.unloadingDate === yesterdayKey;
        })
      ),
      facilities: ["SL Ambient", "SL Mother Hub", "SL Rx"].map(function (facility) {
        return Object.assign(
          { facility: facility },
          summarizeApiFacts_(
            currentMonthFacts.filter(function (row) {
              return row.facility === facility;
            })
          )
        );
      }),
    },
    facts: currentMonthFacts,
    daily: currentMonthDaily,
  };
}

function summarizeApiFacts_(facts) {
  const kpi1 = facts
    .map(function (row) {
      return row.kpi1Hours;
    })
    .filter(isApiNumber_);
  const kpi2 = facts
    .map(function (row) {
      return row.kpi2Hours;
    })
    .filter(isApiNumber_);
  const kpi3 = facts
    .map(function (row) {
      return row.kpi3Hours;
    })
    .filter(isApiNumber_);
  return {
    kpi1Hours: apiAverage_(kpi1),
    kpi2Hours: apiAverage_(kpi2),
    kpi3Hours: apiAverage_(kpi3),
    records: facts.length,
    completeRecords: facts.filter(function (row) {
      return row.status === "COMPLETE";
    }).length,
    exceptionRecords: facts.filter(function (row) {
      return row.status !== "COMPLETE";
    }).length,
    kpi1Records: kpi1.length,
    kpi2Records: kpi2.length,
    kpi3Records: kpi3.length,
  };
}

function apiAverage_(values) {
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

function isApiNumber_(value) {
  return typeof value === "number" && isFinite(value);
}

function apiResponse_(payload, event) {
  return apiTextResponse_(JSON.stringify(payload), event);
}

function apiTextResponse_(json, event) {
  const callback = String(
    (event && event.parameter && event.parameter.callback) || ""
  ).trim();
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + json + ");").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(json).setMimeType(
    ContentService.MimeType.JSON
  );
}

function apiNumber_(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return isFinite(number) ? number : null;
}

function apiDate_(value) {
  const date = parseDateTime_(value);
  return date
    ? Utilities.formatDate(date, "Asia/Kolkata", "yyyy-MM-dd")
    : null;
}

function apiDateTime_(value) {
  const date = parseDateTime_(value);
  return date
    ? Utilities.formatDate(date, "Asia/Kolkata", "yyyy-MM-dd'T'HH:mm:ssXXX")
    : null;
}

function textOrBlank_(value) {
  return value === null || value === undefined ? "" : String(value);
}
