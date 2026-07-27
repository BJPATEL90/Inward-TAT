import { fallbackSnapshot } from "./data";
import { getStoredSession } from "./auth";

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
    const data = await loadJsonp(url);
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

function loadJsonp(url) {
  return new Promise((resolve, reject) => {
    const callback = `inwardTat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Dashboard API timed out"));
    }, 120000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.remove();
      delete window[callback];
    };

    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Unable to connect to dashboard API"));
    };
    url.searchParams.set("callback", callback);
    script.src = url.toString();
    document.head.appendChild(script);
  });
}
