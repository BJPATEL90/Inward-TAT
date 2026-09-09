/**
 * Read-only web API for the Inward TAT dashboard.
 *
 * Deploy this Apps Script project as a web app and point the React frontend's
 * VITE_APPS_SCRIPT_URL to the /exec URL.
 */

const INWARD_TAT_GOOGLE_CLIENT_ID =
  "1021762366002-ks887scr10gojel9jsljbuoq3htsb2bi.apps.googleusercontent.com";
const INWARD_TAT_GOOGLE_DOMAIN = "mosaicwellness.in";

function doGet(event) {
  return handleApiRequest_(event);
}

function doPost(event) {
  return handleApiRequest_(event);
}

function handleApiRequest_(event) {
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
    if (action === "authconfig") {
      return apiResponse_({
        ok: true,
        clientId: INWARD_TAT_GOOGLE_CLIENT_ID,
        domain: INWARD_TAT_GOOGLE_DOMAIN,
      }, event);
    }
    if (action === "authverify") {
      const auth = verifyGoogleCredential_(
        String((event && event.parameter && event.parameter.credential) || "")
      );
      return apiResponse_(auth, event);
    }
    if (["dashboard", "manualtaskaction", "putawayanalysis"].indexOf(action) === -1) {
      return jsonResponse_({ ok: false, error: "Unsupported action: " + action });
    }

    const auth = verifyGoogleCredential_(
      String((event && event.parameter && event.parameter.credential) || "")
    );
    if (!auth.ok) {
      return apiResponse_(auth, event);
    }
    if (action === "manualtaskaction") {
      return apiResponse_(submitManualTaskAction_(event, auth.user), event);
    }
    if (action === "putawayanalysis") return apiResponse_(buildPutawayAnalysis_(), event);

    const bypassCache =
      String((event && event.parameter && event.parameter.refresh) || "") === "1";
    const requestedMonth = String(
      (event && event.parameter && event.parameter.month) || ""
    ).trim();
    const cacheKey = "INWARD_TAT_DASHBOARD_V2_" + (requestedMonth || "CURRENT");
    const cache = CacheService.getScriptCache();
    if (!bypassCache) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return apiResponse_(
          attachDashboardUserContext_(JSON.parse(cached), auth.user),
          event
        );
      }
    }

    const payload = buildDashboardSnapshot_(requestedMonth);
    const json = JSON.stringify(payload);
    if (json.length < 90000) {
      cache.put(cacheKey, json, 120);
    }
    return apiResponse_(attachDashboardUserContext_(payload, auth.user), event);
  } catch (error) {
    return apiResponse_({
      ok: false,
      error: error.message || String(error),
      generatedAt: new Date().toISOString(),
    }, event);
  }
}

function verifyGoogleCredential_(credential) {
  if (!credential) {
    return { ok: false, error: "Google sign-in required" };
  }

  const response = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" +
      encodeURIComponent(credential),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    return { ok: false, error: "Google session is invalid or expired" };
  }

  const claims = JSON.parse(response.getContentText());
  const verified =
    claims.aud === INWARD_TAT_GOOGLE_CLIENT_ID &&
    String(claims.email_verified).toLowerCase() === "true" &&
    Number(claims.exp || 0) > Math.floor(Date.now() / 1000) &&
    String(claims.hd || "").toLowerCase() === INWARD_TAT_GOOGLE_DOMAIN;

  if (!verified) {
    return {
      ok: false,
      error: "Use an authorized Mosaic Wellness Google account",
    };
  }

  return {
    ok: true,
    user: {
      email: claims.email,
      name: claims.name || claims.email,
      picture: claims.picture || "",
      domain: claims.hd || "",
    },
  };
}

function attachDashboardUserContext_(payload, user) {
  const result = Object.assign({}, payload);
  result.permissions = {
    canManagePendingTasks: isManualTaskUser_(user && user.email),
  };
  return result;
}

function isManualTaskUser_(email) {
  const config = getConfig_();
  const allowed = String(config.MANUAL_TASK_USERS || "")
    .split(/[;,\n]/)
    .map(function (value) {
      return value.trim().toLowerCase();
    })
    .filter(Boolean);
  return allowed.indexOf(String(email || "").trim().toLowerCase()) !== -1;
}

function submitManualTaskAction_(event, user) {
  if (!isManualTaskUser_(user && user.email)) {
    throw new Error("You are not authorised to update or close pending tasks.");
  }
  const parameters = (event && event.parameter) || {};
  const recordKey = String(parameters.recordKey || "").trim();
  const actionType = String(parameters.taskAction || "").trim().toUpperCase();
  const reason = String(parameters.reason || "").trim();
  const remarks = String(parameters.remarks || "").trim();
  const evidenceUrl = String(parameters.evidenceUrl || "").trim();
  if (!recordKey) throw new Error("Record key is required.");
  if (["UPDATE_FIELDS", "CLOSE", "REOPEN"].indexOf(actionType) === -1) {
    throw new Error("Unsupported manual task action.");
  }
  if (!reason) throw new Error("Reason is required for every manual action.");
  if (!remarks) throw new Error("Remarks are required for every manual action.");

  const fact = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.FACT)).filter(function (row) {
    return String(row["Record Key"] || "").trim() === recordKey;
  })[0];
  if (!fact) throw new Error("The selected pending task was not found.");

  let manualGrn = null;
  let manualPutaway = null;
  if (actionType === "UPDATE_FIELDS") {
    manualGrn = parseApiManualDateTime_(parameters.grnReceivedTimestamp);
    manualPutaway = parseApiManualDateTime_(parameters.putawayCompletedTimestamp);
    if (!manualGrn && !manualPutaway) {
      throw new Error("Enter at least one missing timestamp.");
    }
    const unloading = parseDateTime_(fact["Unloading Timestamp"]);
    const effectiveGrn = parseDateTime_(fact["GRN Received Timestamp"]) || manualGrn;
    const effectivePutaway =
      parseDateTime_(fact["Putaway Completed Timestamp"]) || manualPutaway;
    if (!unloading) throw new Error("Unloading timestamp is missing and cannot be overridden here.");
    if (effectiveGrn && effectiveGrn < unloading) {
      throw new Error("GRN Received Timestamp cannot be earlier than unloading.");
    }
    if (effectivePutaway && effectivePutaway < unloading) {
      throw new Error("Putaway Timestamp cannot be earlier than unloading.");
    }
    if (effectiveGrn && effectivePutaway && effectivePutaway < effectiveGrn) {
      throw new Error("Putaway Timestamp cannot be earlier than GRN Received Timestamp.");
    }
  }

  const definition = SHEET_DEFINITIONS.filter(function (entry) {
    return entry.name === INWARD_TAT.SHEETS.MANUAL_TASKS;
  })[0];
  const sheet = getOrCreateSheet_(openInwardTatSpreadsheet_(), definition.name);
  ensureHeaders_(sheet, definition.headers);
  sheet.appendRow([
    Utilities.getUuid(),
    recordKey,
    fact.Facility || "",
    fact["GRN Number"] || "",
    fact.SKU || "",
    actionType,
    manualGrn || "",
    manualPutaway || "",
    reason,
    remarks,
    evidenceUrl,
    user.email,
    new Date(),
  ]);
  const rebuild = rebuildHistoricalInwardTatFacts();
  return {
    ok: true,
    recordKey: recordKey,
    actionType: actionType,
    completedAt: rebuild.completedAt,
  };
}

function parseApiManualDateTime_(value) {
  const text = String(value || "").trim().replace("T", " ");
  return text ? parseDateTime_(text) : null;
}

function buildDashboardSnapshot_(requestedMonth) {
  const config = getConfig_();
  const facts = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.FACT));
  const daily = sheetObjects_(getSheet_(INWARD_TAT.SHEETS.MTD));
  const volumeSheet = openInwardTatSpreadsheet_().getSheetByName(INWARD_TAT.SHEETS.VOLUME);
  const volumePeriods = volumeSheet
    ? sheetObjects_(volumeSheet).map(function (row) {
        return {
          key: textOrBlank_(row["Period Key"]),
          label: textOrBlank_(row["Period Label"]),
          periodStart: apiDate_(row["Period Start"]),
          periodEnd: apiDate_(row["Period End"]),
          totalBoxes: apiNumber_(row["Total Boxes"]),
          reportingDays: apiNumber_(row["Reporting Days"]),
          averageBoxesPerDay: apiNumber_(row["Average Boxes Per Day"]),
          peakBoxes: apiNumber_(row["Peak Boxes"]),
          peakDate: apiDate_(row["Peak Date"]),
          dailyCapacityBoxes: apiNumber_(row["Daily Capacity Boxes"]),
          peakUtilizationPct: apiNumber_(row["Peak Utilization %"]),
        };
      })
    : [];
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthMatch = String(requestedMonth || "").match(/^(\d{4})-(\d{2})$/);
  const monthStart = monthMatch
    ? new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)
    : currentMonthStart;
  const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

  const apiFacts = facts
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
        matchMethod: textOrBlank_(row["Match Method"]),
        matchDetail: textOrBlank_(row["Match Detail"]),
        manualActionStatus: textOrBlank_(row["Manual Action Status"]),
        manualActionBy: textOrBlank_(row["Manual Action By"]),
        manualActionAt: apiDateTime_(row["Manual Action At"]),
        manualActionReason: textOrBlank_(row["Manual Action Reason"]),
      };
    });
  const monthStartKey = Utilities.formatDate(monthStart, "Asia/Kolkata", "yyyy-MM-dd");
  const nextMonthKey = Utilities.formatDate(nextMonth, "Asia/Kolkata", "yyyy-MM-dd");
  const periodFacts = apiFacts.filter(function (row) {
    return row.unloadingDate >= monthStartKey && row.unloadingDate < nextMonthKey;
  });
  const isCurrentMonth = monthStart.getTime() === currentMonthStart.getTime();
  const availableMonths = Array.from(
    new Set(
      apiFacts
        .map(function (row) {
          return String(row.unloadingDate || "").slice(0, 7);
        })
        .filter(Boolean)
        .concat([Utilities.formatDate(currentMonthStart, "Asia/Kolkata", "yyyy-MM")])
    )
  ).sort().reverse();

  const sheetDaily = daily
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
        boxesUnloaded: apiNumber_(row["Boxes Unloaded"]),
        dailyCapacityBoxes: apiNumber_(row["Daily Capacity Boxes"]),
        capacityUtilizationPct: apiNumber_(row["Capacity Utilization %"]),
        boxesVsCapacity: apiNumber_(row["Boxes Vs Capacity"]),
        capacityVariancePct: apiNumber_(row["Capacity Variance %"]),
      };
    });
  const selectedDaily = isCurrentMonth
    ? sheetDaily
    : buildDashboardDaily_(periodFacts, monthStart, nextMonth, config);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const lastAvailableDate = periodFacts
    .map(function (row) {
      return row.unloadingDate;
    })
    .filter(Boolean)
    .sort()
    .pop();
  const referenceDateKey = isCurrentMonth
    ? Utilities.formatDate(yesterday, "Asia/Kolkata", "yyyy-MM-dd")
    : lastAvailableDate || Utilities.formatDate(
        new Date(nextMonth.getTime() - 86400000),
        "Asia/Kolkata",
        "yyyy-MM-dd"
      );

  return {
    ok: true,
    apiVersion: "1.2.0",
    generatedAt: new Date().toISOString(),
    timeZone: textOrBlank_(config.TIME_ZONE) || "Asia/Kolkata",
    view: {
      month: Utilities.formatDate(monthStart, "Asia/Kolkata", "yyyy-MM"),
      label: Utilities.formatDate(monthStart, "Asia/Kolkata", "MMMM yyyy"),
      periodStart: monthStartKey,
      periodEnd: Utilities.formatDate(
        new Date(nextMonth.getTime() - 86400000),
        "Asia/Kolkata",
        "yyyy-MM-dd"
      ),
      referenceDate: referenceDateKey,
      isCurrentMonth: isCurrentMonth,
    },
    availableMonths: availableMonths,
    lastRefresh: apiDateTime_(config.LAST_SUCCESSFUL_REFRESH),
    labels: {
      kpi1: textOrBlank_(config.KPI1_LABEL) || "Unloading to Putaway",
      kpi2: textOrBlank_(config.KPI2_LABEL) || "GRN to Putaway",
      kpi3: textOrBlank_(config.KPI3_LABEL) || "Unloading to GRN",
    },
    volume: {
      dailyCapacityBoxes:
        apiNumber_(config.DAILY_UNLOADING_CAPACITY_BOXES) || 3500,
      scope: "Combined across all facilities",
      sourceField: "No. of Boxes Recd",
      periods: volumePeriods,
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
      mtd: summarizeApiFacts_(periodFacts),
      yesterday: summarizeApiFacts_(
        periodFacts.filter(function (row) {
          return row.unloadingDate === referenceDateKey;
        })
      ),
      facilities: ["SL Ambient", "SL Mother Hub", "SL Rx", "OWN", "EXPORT"].map(function (facility) {
        return Object.assign(
          { facility: facility },
          summarizeApiFacts_(
            periodFacts.filter(function (row) {
              return row.facility === facility;
            })
          )
        );
      }),
    },
    facts: periodFacts,
    daily: selectedDaily,
  };
}

function buildDashboardDaily_(periodFacts, monthStart, nextMonth, config) {
  const groups = new Map();
  const volumeByDate = new Map();
  const capacity = Math.max(
    Number(config.DAILY_UNLOADING_CAPACITY_BOXES) || 3500,
    0
  );

  sheetObjects_(getSheet_(INWARD_TAT.SHEETS.RAW_GOODS)).forEach(function (row) {
    const unloading =
      combineDateAndTime_(row["Unloading Date"], row["Unloading Time"]) ||
      parseDateTime_(row["Unloading Date"]);
    if (!unloading || unloading < monthStart || unloading >= nextMonth) return;
    const boxes = Number(
      String(row["No. of Boxes Recd"] || "").replace(/,/g, "").trim()
    );
    if (!isFinite(boxes) || boxes < 0) return;
    const dateKey = Utilities.formatDate(unloading, "Asia/Kolkata", "yyyy-MM-dd");
    volumeByDate.set(dateKey, (volumeByDate.get(dateKey) || 0) + boxes);
  });

  periodFacts.forEach(function (fact) {
    if (!fact.unloadingDate) return;
    [fact.facility, "All Mother Facilities"].forEach(function (facility) {
      const groupKey = fact.unloadingDate + "|" + facility;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          summaryDate: fact.unloadingDate,
          facility: facility,
          facts: [],
        });
      }
      groups.get(groupKey).facts.push(fact);
    });
  });

  return Array.from(groups.values())
    .map(function (group) {
      const summary = summarizeApiFacts_(group.facts);
      const boxes =
        group.facility === "All Mother Facilities"
          ? volumeByDate.get(group.summaryDate) || 0
          : 0;
      return {
        summaryDate: group.summaryDate,
        facility: group.facility,
        kpi1Hours: summary.kpi1Hours,
        kpi2Hours: summary.kpi2Hours,
        kpi3Hours: summary.kpi3Hours,
        uniqueRecords: summary.records,
        completeRecords: summary.completeRecords,
        exceptionRecords: summary.exceptionRecords,
        boxesUnloaded: boxes,
        dailyCapacityBoxes: capacity,
        capacityUtilizationPct: capacity ? (boxes / capacity) * 100 : 0,
        boxesVsCapacity: boxes - capacity,
        capacityVariancePct: capacity ? ((boxes - capacity) / capacity) * 100 : 0,
      };
    })
    .sort(function (a, b) {
      return (
        a.summaryDate.localeCompare(b.summaryDate) ||
        a.facility.localeCompare(b.facility)
      );
    });
}

function summarizeApiFacts_(facts) {
  const completeFacts = facts.filter(function (row) {
    return row.status === "COMPLETE";
  });
  const kpi1 = completeFacts
    .map(function (row) {
      return row.kpi1Hours;
    })
    .filter(isApiNumber_);
  const kpi2 = completeFacts
    .map(function (row) {
      return row.kpi2Hours;
    })
    .filter(isApiNumber_);
  const kpi3 = completeFacts
    .map(function (row) {
      return row.kpi3Hours;
    })
    .filter(isApiNumber_);
  return {
    kpi1Hours: apiAverage_(kpi1),
    kpi2Hours: apiAverage_(kpi2),
    kpi3Hours: apiAverage_(kpi3),
    records: facts.length,
    completeRecords: completeFacts.length,
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
