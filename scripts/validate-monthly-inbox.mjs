import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const config = { GRN_EMAIL_FROM: "noreply@e.unicommerce.com", GRN_EMAIL_SUBJECT: "Export Job Complete - GRN",
  PUTAWAY_EMAIL_FROM: "noreply@e.unicommerce.com", PUTAWAY_EMAIL_SUBJECT: "Export Job Complete - GRN/Gatepass to Putaway", PUTAWAY_EXPORT_OWN: "GRN/Putaway-OWN" };
const message = (overrides = {}) => ({ getId: () => "a123", getFrom: () => "Uniware <noreply@e.unicommerce.com>",
  getSubject: () => config.GRN_EMAIL_SUBJECT, getDate: () => new Date("2026-10-01T00:10:00+05:30"),
  getPlainBody: () => "", getBody: () => "", ...overrides });
let selected = message(); let job = "GRN"; let status = "SUCCESSFUL"; let downloads = 0; let searches = 0; let imported;
const context = vm.createContext({ Date, String, Number, JSON, Array, Map, Set, Math,
  GmailApp: { getMessageById: () => selected, search: query => { searches++; assert.match(query, /from:noreply@e.unicommerce.com/); return [{ getMessages: () => [selected, message({ getFrom: () => "other@example.com" })] }]; } },
});
new vm.Script(fs.readFileSync(new URL("../apps-script/MonthlyIngestion.gs", import.meta.url), "utf8")).runInContext(context);
context.monthlyAccess_ = user => { if (user?.email !== "owner@example.com") throw Error("Not authorised"); return config; };
context.monthlyWindow_ = month => { assert.equal(month, "2026-09"); };
context.getEmailBodyText_ = () => "verified body";
context.extractEmailField_ = (_, field) => field === "Export" ? job : status;
context.extractExportFileUrl_ = () => "https://example.com/export.csv?private-link";
context.facilityFromPutawayExport_ = () => "OWN";
context.validateMonthlySource_ = source => { if (source.extractedAt !== "2026-10-01T08:00:00+05:30") throw Error("Invalid extraction time"); };
context.downloadCsv_ = () => { downloads++; return "CSV"; };
context.ingestMonthlySource_ = source => { imported = source; return { ok: true, revision: 1 }; };
const user = { email: "owner@example.com" };
const query = { month: "2026-09", type: "GRN", receivedFrom: "2026-10-01", receivedThrough: "2026-10-02" };
const listed = context.listMonthlyInbox_(query, user);
assert.equal(listed.emails.length, 1);
assert.equal(listed.emails[0].facility, "ALL");
assert.equal(JSON.stringify(listed).includes("private-link"), false);
assert.equal(downloads, 0);
assert.throws(() => context.listMonthlyInbox_({ ...query, receivedFrom: '2026-10-01 OR from:other' }, user), /date range/);
assert.equal(searches, 1);
assert.throws(() => context.listMonthlyInbox_(query, { email: "other" }), /authorised/);
const request = { ...query, messageId: "a123", facility: "ALL", extractedAt: "2026-10-01T08:00:00+05:30" };
assert.throws(() => context.importMonthlyInbox_({ ...request, facility: "OWN" }, user), /differs/);
assert.throws(() => context.importMonthlyInbox_({ ...request, extractedAt: "bad" }, user), /extraction/);
assert.equal(downloads, 0);
assert.equal(context.importMonthlyInbox_(request, user).ok, true);
assert.equal(imported.channel, "EMAIL");
assert.equal(imported.messageId, "a123");
assert.equal(imported.content, "CSV");
selected = message({ getFrom: () => "other@example.com" });
assert.throws(() => context.importMonthlyInbox_(request, user), /sender or subject/);
selected = message(); status = "FAILED";
assert.throws(() => context.importMonthlyInbox_(request, user), /successfully/);
status = "SUCCESSFUL"; job = "GRN/Putaway-OWN";
selected = message({ getSubject: () => config.PUTAWAY_EMAIL_SUBJECT });
assert.equal(context.monthlyInboxDescriptor_(selected, "PUTAWAY", config).facility, "OWN");
job = "Unrecognised";
assert.throws(() => context.monthlyInboxDescriptor_(selected, "PUTAWAY", config), /Unrecognised/);
assert.equal(downloads, 1);
console.log("Monthly inbox validated: authorisation, sender/job/status checks, IST filtering, no download on invalid requests, private-link redaction and EMAIL provenance.");
