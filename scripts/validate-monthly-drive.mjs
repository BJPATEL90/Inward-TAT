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
let location = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test";
let uploadFails = false, missingId = false;
const uploads = [];
const blob = { getName: () => "revision.json", getContentType: () => "application/json",
  getBytes: () => { throw Error("Large blob must never become a JavaScript byte array"); } };
context.UrlFetchApp.fetch = (url, options) => {
  assert.equal(options.headers.Authorization, "Bearer secret-token");
  uploads.push({url, options});
  if (options.method === "post") {
    assert.ok(url.includes("uploadType=resumable"));
    assert.equal(options.headers["X-Upload-Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.payload), {name: "revision.json", parents: ["archive-folder"]});
    return {getResponseCode: () => 200, getHeaders: () => ({location})};
  }
  assert.equal(options.method, "put"); assert.equal(options.payload, blob);
  assert.equal(options.followRedirects, false);
  return {getResponseCode: () => uploadFails ? 500 : 200, getContentText: () => JSON.stringify(missingId ? {} : {id: "saved-file"})};
};
assert.equal(context.monthlyDrive_().getFolderById("archive-folder").createFile(blob).getId(), "saved-file");
uploadFails = true;
assert.throws(() => context.monthlyDrive_().getFolderById("archive-folder").createFile(blob), /HTTP 500/);
uploadFails = false; missingId = true;
assert.throws(() => context.monthlyDrive_().getFolderById("archive-folder").createFile(blob), /without a file ID/);
location = "https://example.com/upload";
const count = uploads.length;
assert.throws(() => context.monthlyDrive_().getFolderById("archive-folder").createFile(blob), /invalid upload session/);
assert.equal(uploads.length, count + 1); // No bearer-authenticated call to untrusted host.
console.log("Resumable archive upload validated: native Blob payload, preserved headers, failed-upload guards and trusted session URLs.");
