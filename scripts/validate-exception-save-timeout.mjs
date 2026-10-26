import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let pendingTimer, cleared = 0, requests = 0, signal;
const context = vm.createContext({ URL, URLSearchParams, AbortController, Date, Promise, Error,
  window: { setTimeout(callback) { pendingTimer = callback; return 1; }, clearTimeout() { cleared++; } },
  fetch: async (_url, options) => { requests++; signal = options.signal; return new Promise(() => {}); },
});
const source = fs.readFileSync(new URL("../src/auth.js", import.meta.url), "utf8")
  .replaceAll("import.meta.env", '({ VITE_APPS_SCRIPT_URL: "https://script.google.com/test/exec" })')
  .replaceAll("export ", "");
vm.runInContext(source, context);
const save = () => context.postToAppsScript({ action: "saveexception" }, { timeoutMs: 45000, maxAttempts: 1 });
let promise = save();
pendingTimer();
await assert.rejects(promise, /Save confirmation timed out.*remarks are retained/);
assert.equal(signal.aborted, true);
assert.equal(requests, 1);
assert.equal(cleared, 1);

// The timeout must cover JSON/body reads, not only arrival of response headers.
context.fetch = async () => { requests++; return { ok: true, json: () => new Promise(() => {}) }; };
promise = save();
await Promise.resolve();
pendingTimer();
await assert.rejects(promise, /server may still finish saving/);
assert.equal(requests, 2);
context.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
assert.equal((await save()).ok, true);
context.fetch = async () => { requests++; return { ok: false, status: 403 }; };
await assert.rejects(save(), /returned 403/);
assert.equal(requests, 3);
assert.match(fs.readFileSync(new URL("../src/api.js", import.meta.url), "utf8"), /timeoutMs: 45000, maxAttempts: 1/);
console.log("Save transport validated: fetch/body timeout, abort, timer cleanup, single write attempt, success and permission failure.");
