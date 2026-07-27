const SESSION_KEY = "inwardTatGoogleSession";
const APPS_SCRIPT_URL = String(import.meta.env.VITE_APPS_SCRIPT_URL || "").trim();
const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_WORKSPACE_DOMAIN = String(
  import.meta.env.VITE_GOOGLE_WORKSPACE_DOMAIN || "mosaicwellness.in",
).trim();

export function getStoredSession() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function storeSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function getAuthConfig() {
  if (APPS_SCRIPT_URL) {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error("Google sign-in is not configured");
    }
    return {
      ok: true,
      clientId: GOOGLE_CLIENT_ID,
      domain: GOOGLE_WORKSPACE_DOMAIN,
    };
  }
  const response = await fetch("/api/auth/config", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Google sign-in is not configured");
  }
  return data;
}

export async function verifyGoogleCredential(credential) {
  if (APPS_SCRIPT_URL) {
    const data = await postToAppsScript({
      action: "authVerify",
      credential,
    });
    if (!data.ok) {
      throw new Error(data.error || "Google sign-in could not be verified");
    }
    return { credential, user: data.user };
  }
  const response = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}` },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Google sign-in could not be verified");
  }
  return { credential, user: data.user };
}

export async function postToAppsScript(parameters) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(parameters),
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Dashboard API returned ${response.status}`);
  }
  return response.json();
}

export function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Unable to load Google sign-in"));
    document.head.appendChild(script);
  });
}
