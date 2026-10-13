import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
let responseCode = 200;
let body = "{}";
let consentGranted = false;
let lockCalls = 0;
let fetchCalls = 0;
const context = vm.createContext({ JSON, String, Object, Error,
  LockService: { getScriptLock: () => { lockCalls++; throw new Error("authorized setup reached lock"); } },
  ScriptApp: { getOAuthToken: () => "secret-token", AuthMode: { FULL: "FULL" },
    requireScopes: (mode, scopes) => {
      assert.equal(mode, "FULL");
      assert.deepEqual(Array.from(scopes), ["https://www.googleapis.com/auth/drive.file"]);
      if (!consentGranted) throw new Error("authorization required");
    } },
  UrlFetchApp: { fetch: (_, options) => { assert.equal(options.headers.Authorization, "Bearer secret-token");
    fetchCalls++;
    return { getResponseCode: () => responseCode, getContentText: () => body }; } } });
new vm.Script(fs.readFileSync(new URL("../apps-script/MonthlyDrive.gs", import.meta.url), "utf8")).runInContext(context);
assert.throws(() => context.setupMonthlyReportingArchive(), /authorization required/);
assert.equal(lockCalls, 0);
assert.equal(fetchCalls, 0);
consentGranted = true;
assert.throws(() => context.setupMonthlyReportingArchive(), /authorized setup reached lock/);
assert.equal(lockCalls, 1);
assert.equal(context.monthlyDriveRequest_("https://www.googleapis.com/drive/v3/files").getResponseCode(), 200);
responseCode = 403;
body = JSON.stringify({ error: { message: "Drive API is disabled for this project.", errors: [{ reason: "accessNotConfigured" }], details: [{ reason: "SERVICE_DISABLED" }] } });
assert.throws(() => context.monthlyDriveRequest_("https://www.googleapis.com/drive/v3/files"), /Enable Google Drive API/);
body = JSON.stringify({ error: { message: "Insufficient authentication scopes.", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } });
assert.throws(() => context.monthlyDriveRequest_("https://www.googleapis.com/drive/v3/files"), /Reauthorise/);
body = "not JSON";
assert.throws(() => context.monthlyDriveRequest_("https://www.googleapis.com/drive/v3/files"), /unknown reason/);
try { context.monthlyDriveRequest_("https://www.googleapis.com/drive/v3/files"); } catch (error) { assert.equal(error.message.includes("secret-token"), false); }
console.log("Monthly Drive diagnostics validated for disabled API, missing scopes and non-JSON failures; tokens are not logged.");
