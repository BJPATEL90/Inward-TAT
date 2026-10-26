import { fallbackSnapshot } from "./data";
import { getStoredSession, postToAppsScript } from "./auth";

const API_URL = String(import.meta.env.VITE_APPS_SCRIPT_URL || "/api/dashboard").trim();

export async function loadDashboard({ refresh = false, month = "" } = {}) {
  if (!API_URL) {
    return { data: fallbackSnapshot, source: "preview" };
  }

  const url = new URL(API_URL, window.location.origin);
  url.searchParams.set("action", "dashboard");
  if (refresh) url.searchParams.set("refresh", "1");
  if (month) url.searchParams.set("month", month);
  url.searchParams.set("_", String(Date.now()));

  if (url.hostname === "script.google.com") {
    const data = await postToAppsScript({
      action: "dashboard",
      refresh: refresh ? "1" : "0",
      month,
      credential: getStoredSession()?.credential || "",
    });
    if (!data.ok) {
      throw new Error(data.error || "Dashboard API returned an error");
    }
    return { data, source: "live" };
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: authHeaders(),
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Dashboard API returned ${response.status}`);
  }
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || "Dashboard API returned an error");
  }
  return { data, source: "live" };
}

export function hasLiveApi() {
  return Boolean(API_URL);
}

export async function loadPutawayAnalysis() {
  if (!API_URL || new URL(API_URL, window.location.origin).hostname !== "script.google.com") {
    throw new Error("Putaway analysis requires the live Apps Script connection.");
  }
  const data = await postToAppsScript({ action: "putawayAnalysis", credential: getStoredSession()?.credential || "" });
  if (!data.ok) throw new Error(data.error || "Unable to load putaway analysis");
  return data;
}

export async function submitManualTaskAction(payload) {
  if (!API_URL || !new URL(API_URL, window.location.origin).hostname.includes("script.google.com")) {
    throw new Error("Manual task updates require the live Apps Script API.");
  }
  const data = await postToAppsScript({
    action: "manualTaskAction",
    credential: getStoredSession()?.credential || "",
    ...payload,
  });
  if (!data.ok) throw new Error(data.error || "Manual task action failed");
  return data;
}

function authHeaders() {
  const credential = getStoredSession()?.credential;
  return credential ? { Authorization: `Bearer ${credential}` } : {};
}

export async function saveException(payload) {
  if (!API_URL || new URL(API_URL, window.location.origin).hostname !== "script.google.com") {
    throw new Error("Exception updates require the live Apps Script connection.");
  }
  const data = await postToAppsScript({ ...payload, action: "saveexception", credential: getStoredSession()?.credential || "" }, { timeoutMs: 45000, maxAttempts: 1 });
  if (!data.ok) throw new Error(data.error || "Unable to save the exception.");
  return data;
}

export async function processExceptionBulk(month, rows, apply = false) {
  if (!API_URL || new URL(API_URL, window.location.origin).hostname !== "script.google.com") throw new Error("Bulk exceptions require the live Apps Script connection.");
  const data = await postToAppsScript({ action: apply ? "exceptionbulkapply" : "exceptionbulkpreview", month,
    rows: JSON.stringify(rows), credential: getStoredSession()?.credential || "" });
  if (!data.ok) throw new Error(data.error || "Bulk exception request failed.");
  return data;
}

async function requestMonthly(action, month, source, extra = {}) {
  if (!API_URL || new URL(API_URL, window.location.origin).hostname !== "script.google.com") {
    throw new Error("Monthly reporting requires the live Apps Script connection.");
  }
  const payload = { action, month, credential: getStoredSession()?.credential || "", ...extra };
  if (source) payload.source = JSON.stringify(source);
  const result = await postToAppsScript(payload);
  if (!result.ok) throw new Error(result.error || "Monthly processing failed");
  return result;
}

export function loadMonthlyStatus(month) { return requestMonthly("monthlyStatus", month); }
export function refreshMonthlySources(month) { return requestMonthly("monthlyRefresh", month); }
export function uploadMonthlySource(month, source) { return requestMonthly("monthlyUpload", month, source); }
export function loadMonthlyInbox(month, source) { return requestMonthly("monthlyInbox", month, source); }
export function importMonthlyInbox(month, source) { return requestMonthly("monthlyEmailImport", month, source); }
export function downloadMonthlyReport(month, revision) { return requestMonthly("monthlyReport", month, null, { revision: String(revision) }); }
