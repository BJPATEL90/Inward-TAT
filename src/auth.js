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

export async function postToAppsScript(parameters, { timeoutMs = 0, maxAttempts = 3 } = {}) {
  const retryDelays = [0, 400, 1000].slice(0, maxAttempts);
  let lastError;

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) {
      await new Promise((resolve) => window.setTimeout(resolve, retryDelays[attempt]));
    }

    let timer;
    const controller = new AbortController();
    try {
      const url = new URL(APPS_SCRIPT_URL);
      url.searchParams.set("_request", `${Date.now()}-${attempt}`);
      const request = async () => {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams(parameters),
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) return await response.json();

      throw new Error(`Dashboard API returned ${response.status}`);
      };
      if (timeoutMs) {
        return await Promise.race([request(), new Promise((_, reject) => {
          timer = window.setTimeout(() => {
            const failure = new Error("Save confirmation timed out. Your entered remarks are retained. The server may still finish saving; retry the same values to confirm, or copy your draft before refreshing.");
            failure.name = "SaveTimeoutError";
            reject(failure);
            controller.abort();
          }, timeoutMs);
        })]);
      }
      return await request();
    } catch (error) {
      lastError = error;
      if (error.name === "SaveTimeoutError") throw error;
      if (/returned (400|401|403)/.test(String(error?.message || ""))) throw error;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  throw lastError || new Error("Dashboard API is temporarily unavailable");
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
