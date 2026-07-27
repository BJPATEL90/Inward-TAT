import { fallbackSnapshot } from "./data";
import { getStoredSession, postToAppsScript } from "./auth";

const API_URL = String(import.meta.env.VITE_APPS_SCRIPT_URL || "/api/dashboard").trim();

export async function loadDashboard({ refresh = false } = {}) {
  if (!API_URL) {
    return { data: fallbackSnapshot, source: "preview" };
  }

  const url = new URL(API_URL, window.location.origin);
  url.searchParams.set("action", "dashboard");
  if (refresh) url.searchParams.set("refresh", "1");
  url.searchParams.set("_", String(Date.now()));

  if (url.hostname === "script.google.com") {
    const data = await postToAppsScript({
      action: "dashboard",
      refresh: refresh ? "1" : "0",
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

function authHeaders() {
  const credential = getStoredSession()?.credential;
  return credential ? { Authorization: `Bearer ${credential}` } : {};
}
