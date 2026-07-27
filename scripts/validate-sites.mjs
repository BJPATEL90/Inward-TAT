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

globalThis.fetch = async () =>
  new Response(JSON.stringify({ ok: true, facts: [] }), {
    headers: { "content-type": "application/json" },
  });
const apiResponse = await worker.fetch(
  new Request("https://inward-tat.test/api/dashboard?action=dashboard"),
  { APPS_SCRIPT_URL: "https://example.test/upstream" },
);
const apiPayload = await apiResponse.json();

if (
  rootResponse.status !== 200 ||
  !html.includes('id="root"') ||
  assetResponse.status !== 200 ||
  apiResponse.status !== 200 ||
  apiPayload.ok !== true
) {
  throw new Error("Sites production route validation failed");
}

console.log("Sites homepage, asset, and live API routes validated");
