/**
 * Secondary freshness safety net for the dashboard.
 * Rebuilds Fact/MTD from imported Raw_* sheets when coverage is stale.
 */
function ensureInwardTatDashboardFresh() {
  const runId = "FALLBACK-" + Utilities.getUuid();
  const config = getConfig_();
  const checkedAt = new Date();
  if (String(config.FALLBACK_RECOVERY_ENABLED || "TRUE").toUpperCase() !== "TRUE") {
    updateFallbackRecoveryStatus_("SKIPPED", checkedAt, "Fallback recovery is disabled in Config.");
    logExecution_(runId, "FALLBACK_RECOVERY", "SKIPPED", "Fallback recovery is disabled in Config.", {});
    return { ok: true, status: "SKIPPED" };
  }

  const expectedThrough = latestExpectedDashboardDate_();
  const availableThrough = latestCombinedMtdDate_();
  const beforeDetail = fallbackCoverageDetail_(expectedThrough, availableThrough);
  if (!expectedThrough || (availableThrough && availableThrough.getTime() >= expectedThrough.getTime())) {
    updateFallbackRecoveryStatus_("CURRENT", checkedAt, beforeDetail);
    logExecution_(runId, "FALLBACK_RECOVERY", "CURRENT", "Dashboard coverage is current. " + beforeDetail, {});
    return { ok: true, status: "CURRENT", expectedThrough: fallbackDateText_(expectedThrough), availableThrough: fallbackDateText_(availableThrough) };
  }

  logExecution_(runId, "FALLBACK_RECOVERY", "STARTED", "Stale MTD detected. Rebuilding from imported raw sheets. " + beforeDetail, {});
  try {
    const rebuild = rebuildHistoricalInwardTatFacts();
    const recoveredThrough = latestCombinedMtdDate_();
    const afterDetail = fallbackCoverageDetail_(expectedThrough, recoveredThrough);
    if (!recoveredThrough || recoveredThrough.getTime() < expectedThrough.getTime()) {
      throw new Error("Fallback rebuild completed but dashboard coverage remains stale. " + afterDetail);
    }
    updateFallbackRecoveryStatus_("RECOVERED", new Date(), afterDetail);
    CacheService.getScriptCache().remove("INWARD_TAT_DASHBOARD_V1");
    logExecution_(runId, "FALLBACK_RECOVERY", "COMPLETED", "Dashboard recovered from imported raw sheets. " + afterDetail, {});
    return { ok: true, status: "RECOVERED", expectedThrough: fallbackDateText_(expectedThrough), availableThrough: fallbackDateText_(recoveredThrough), processing: rebuild.processing };
  } catch (error) {
    const detail = beforeDetail + " | " + (error.message || String(error));
    updateFallbackRecoveryStatus_("FAILED", new Date(), detail);
    logExecution_(runId, "FALLBACK_RECOVERY", "FAILED", detail, {});
    throw error;
  }
}

function latestExpectedDashboardDate_() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let latest = null;
  sheetObjects_(getSheet_(INWARD_TAT.SHEETS.RAW_GOODS)).forEach(function (row) {
    const date = combineDateAndTime_(row["Unloading Date"], row["Unloading Time"]) || parseDateTime_(row["Unloading Date"]);
    if (!(date instanceof Date) || isNaN(date.getTime()) || date < monthStart || date >= cutoff) return;
    const day = startOfDay_(date);
    if (!latest || day > latest) latest = day;
  });
  return latest;
}

function latestCombinedMtdDate_() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  let latest = null;
  sheetObjects_(getSheet_(INWARD_TAT.SHEETS.MTD)).forEach(function (row) {
    if (String(row.Facility || "").trim() !== "All Mother Facilities") return;
    const date = parseDateTime_(row["Summary Date"]);
    if (!(date instanceof Date) || isNaN(date.getTime()) || date < monthStart || date >= nextMonth) return;
    const day = startOfDay_(date);
    if (!latest || day > latest) latest = day;
  });
  return latest;
}

function fallbackCoverageDetail_(expectedThrough, availableThrough) {
  return "Expected through " + (fallbackDateText_(expectedThrough) || "no eligible unloading date") + "; available through " + (fallbackDateText_(availableThrough) || "none") + ".";
}

function fallbackDateText_(value) {
  return value instanceof Date && !isNaN(value.getTime()) ? Utilities.formatDate(value, "Asia/Kolkata", "yyyy-MM-dd") : "";
}

function updateFallbackRecoveryStatus_(status, timestamp, detail) {
  updateConfigValue_("LAST_FALLBACK_STATUS", status || "");
  updateConfigValue_("LAST_FALLBACK_AT", timestamp || new Date());
  updateConfigValue_("LAST_FALLBACK_DETAIL", detail || "");
}

function installInwardTatRecoveryTrigger() {
  seedConfig_(getSheet_(INWARD_TAT.SHEETS.CONFIG));
  const config = getConfig_();
  const configuredHour = Number(config.FALLBACK_RECOVERY_HOUR);
  const hour = Number.isInteger(configuredHour) && configuredHour >= 0 && configuredHour <= 23 ? configuredHour : 10;
  ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === "ensureInwardTatDashboardFresh";
  }).forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("ensureInwardTatDashboardFresh").timeBased().everyDays(1).atHour(hour).nearMinute(0).inTimezone("Asia/Kolkata").create();
  console.log("FALLBACK_TRIGGER | INSTALLED | ensureInwardTatDashboardFresh scheduled daily near " + String(hour).padStart(2, "0") + ":00 IST.");
  return { ok: true, handler: "ensureInwardTatDashboardFresh", schedule: "Daily freshness check near " + String(hour).padStart(2, "0") + ":00 IST", hour: hour, nearMinute: 0 };
}
