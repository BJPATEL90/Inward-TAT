const workerModule = await import(`../dist/server/index.js?test=${Date.now()}`);
const worker = workerModule.default;

const rootResponse = await worker.fetch(
  new Request("https://inward-tat.test/"),
  {},
);
const html = await rootResponse.text();
const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
if (!assetPath) throw new Error("Built HTML does not reference a JavaScript asset");

const assetResponse = await worker.fetch(
  new Request(`https://inward-tat.test${assetPath}`),
  {},
);

const testEnv = {
  APPS_SCRIPT_URL: "https://example.test/upstream",
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_WORKSPACE_DOMAIN: "mosaicwellness.in",
};
globalThis.fetch = async (input) => {
  const url = String(input);
  const payload = url.startsWith("https://oauth2.googleapis.com/")
    ? {
        aud: testEnv.GOOGLE_CLIENT_ID,
        email_verified: "true",
        exp: String(Math.floor(Date.now() / 1000) + 3600),
        hd: testEnv.GOOGLE_WORKSPACE_DOMAIN,
        email: "tester@mosaicwellness.in",
        name: "Test User",
      }
    : { ok: true, facts: [] };
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
};
const configResponse = await worker.fetch(
  new Request("https://inward-tat.test/api/auth/config"),
  testEnv,
);
const verifyResponse = await worker.fetch(
  new Request("https://inward-tat.test/api/auth/verify", {
    method: "POST",
    headers: { Authorization: "Bearer valid-test-token" },
  }),
  testEnv,
);
const unauthorizedApi = await worker.fetch(
  new Request("https://inward-tat.test/api/dashboard?action=dashboard"),
  testEnv,
);
const apiResponse = await worker.fetch(
  new Request("https://inward-tat.test/api/dashboard?action=dashboard", {
    headers: { Authorization: "Bearer valid-test-token" },
  }),
  testEnv,
);
const apiPayload = await apiResponse.json();

if (
  rootResponse.status !== 200 ||
  !html.includes('id="root"') ||
  assetResponse.status !== 200 ||
  configResponse.status !== 200 ||
  verifyResponse.status !== 200 ||
  unauthorizedApi.status !== 401 ||
  apiResponse.status !== 200 ||
  apiPayload.ok !== true
) {
  throw new Error("Sites production route validation failed");
}

console.log("Sites homepage, asset, and live API routes validated");
