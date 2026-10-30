import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const manifest = JSON.parse(fs.readFileSync(new URL("../apps-script/appsscript.json", import.meta.url), "utf8"));
assert.ok(manifest.oauthScopes.includes("https://www.googleapis.com/auth/userinfo.email"), "Owner identity check requires userinfo.email scope");

const config = { GRN_EMAIL_FROM: "exports@example.com", PUTAWAY_EMAIL_FROM: "exports@example.com" };
let writes = 0, downloads = 0, parsedSource;
const message = {
  getFrom: () => "Uniware <exports@example.com>",
  getSubject: () => "A different manual report name",
  getDate: () => new Date("2026-11-01T04:00:00Z"),
};
const context = vm.createContext({ console: { log() {} }, Session: { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
  monthlyAccess_: user => { assert.equal(user.email, "owner@example.com"); return config; },
  getEmailBodyText_: () => "body", extractEmailField_: () => "SUCCESSFUL",
  extractExportFileUrl_: () => "https://example.com/custom.csv",
  GmailApp: { getMessageById: () => message }, downloadCsv_: () => { downloads++; return "CSV"; },
  monthlyParseCsv_: source => { parsedSource = source; return { sourceRows: 2, records: [{ key: "K", sourceId: "VALIDATION", extractedAt: source.extractedAt, values: { SKU: "S1" } }] }; },
  readMonthlyState_: () => ({ records: [], revision: 1 }),
  reconcileMonthlyRecords_: () => ({ counts: { inserted: 1 } }),
  ingestMonthlySource_: source => { writes++; parsedSource = source; return { month: source.month, revision: 2, duplicate: false }; },
});
for (const file of ["MonthlyClosure.gs", "MonthlyBackfill.gs"]) {
  vm.runInContext(fs.readFileSync(new URL(`../apps-script/${file}`, import.meta.url), "utf8"), context);
}
const settings = { month: "2026-10", messageId: "abc123", type: "PUTAWAY", facility: "SL Ambient",
  periodStart: "2026-10-01T00:00:00+05:30", periodEndExclusive: "2026-11-01T00:00:00+05:30",
  extractedAt: "2026-11-01T08:00:00+05:30" };
context.monthlyInboxBackfillSettings_ = () => settings;
assert.equal(context.previewMonthlyInboxBackfill().acceptedRows, 1);
assert.equal(writes, 0);
assert.equal(parsedSource.coverageDeclared, false);
assert.equal(parsedSource.channel, "BACKFILL_EMAIL");
assert.equal(context.runMonthlyInboxBackfill().revision, 2);
assert.equal(writes, 1);
settings.extractedAt = "2026-11-02T08:00:00+05:30";
assert.throws(() => context.runMonthlyInboxBackfill(), /Generation time/);
settings.extractedAt = "2026-11-01T08:00:00+05:30";
message.getFrom = () => "other@example.com";
assert.throws(() => context.runMonthlyInboxBackfill(), /sender/);
assert.equal(downloads, 2);
assert.equal(writes, 1);
console.log("Monthly backfill checks passed: manual names, preview without writes, sender/date guards, monthly-only apply.");
