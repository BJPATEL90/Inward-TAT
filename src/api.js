import { fallbackSnapshot } from "./data";

const API_URL = String(import.meta.env.VITE_APPS_SCRIPT_URL || "").trim();

export async function loadDashboard({ refresh = false } = {}) {
  if (!API_URL) {
    return { data: fallbackSnapshot, source: "preview" };
  }

  const url = new URL(API_URL);
  url.searchParams.set("action", "dashboard");
  if (refresh) url.searchParams.set("refresh", "1");
  url.searchParams.set("_", String(Date.now()));

  const response = await fetch(url.toString(), {
    method: "GET",
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
