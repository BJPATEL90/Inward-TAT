const SESSION_KEY = "inwardTatGoogleSession";

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
  const response = await fetch("/api/auth/config", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Google sign-in is not configured");
  }
  return data;
}

export async function verifyGoogleCredential(credential) {
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
