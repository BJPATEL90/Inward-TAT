import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
let responseCode = 200;
let body = "{}";
const context = vm.createContext({ JSON, String, Object, Error, ScriptApp: { getOAuthToken: () => "secret-token" },
  UrlFetchApp: { fetch: (_, options) => { assert.equal(options.headers.Authorization, "Bearer secret-token");
    return { getResponseCode: () => responseCode, getContentText: () => body }; } } });
new vm.Script(fs.readFileSync(new URL("../apps-script/MonthlyDrive.gs", import.meta.url), "utf8")).runInContext(context);
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
