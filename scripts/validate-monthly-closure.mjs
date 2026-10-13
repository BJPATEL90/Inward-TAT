import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

const files = new Map();
let writes = 0;
const context = vm.createContext({
  Date, Map, Number, String, Array, JSON,
  Utilities: {
    DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    computeDigest: (_, text) => [...crypto.createHash("sha256").update(text).digest()],
    newBlob: (text, type, name) => ({ text, type, name }),
  },
  DriveApp: { getFolderById: () => ({
    getFilesByName: name => ({ hasNext: () => files.has(name), next: () => files.get(name) }),
    createFile: blob => {
      writes++;
      const file = { getId: () => String(writes), getBlob: () => ({ getDataAsString: () => blob.text }) };
      files.set(blob.name, file);
      return file;
    },
  }) },
});
new vm.Script(fs.readFileSync(new URL("../apps-script/MonthlyClosure.gs", import.meta.url), "utf8")).runInContext(context);
context.monthlyDrive_ = () => context.DriveApp;
const { monthlyWindow_: window, monthlyContainsTimestamp_: contains, reconcileMonthlyRecords_: merge,
  validateMonthlySource_: validate, archiveMonthlySource_: archive } = context;
assert.equal(window("2026-09").start.toISOString(), "2026-08-31T18:30:00.000Z");
assert.equal(window("2026-09").end.toISOString(), "2026-09-30T18:30:00.000Z");
assert.equal((window("2028-02").end - window("2028-02").start) / 86400000, 29);
assert.equal(window("2026-12").end.toISOString(), "2026-12-31T18:30:00.000Z");
assert.throws(() => window("2026-13"));
assert.equal(contains("2026-09", new Date("2026-09-30T23:59:59+05:30")), true);
assert.equal(contains("2026-09", new Date("2026-10-01T00:00:00+05:30")), false);

const source = { month: "2026-09", type: "GRN", facility: "OWN", content: "SKU,GRN\nSKU1,G1\n",
  periodStart: "2026-09-01T00:00:00+05:30", periodEndExclusive: "2026-10-01T00:00:00+05:30",
  extractedAt: "2026-10-01T08:00:00+05:30" };
assert.equal(validate(source).completeMonthCoverage, true);
assert.equal(validate({ ...source, periodEndExclusive: "2026-09-30T08:00:00+05:30" }).completeMonthCoverage, false);
assert.throws(() => validate({ ...source, extractedAt: "2026-09-30T08:00:00+05:30" }));
assert.throws(() => validate({ ...source, content: "" }));
assert.throws(() => validate({ ...source, extractedAt: "2026-10-01T08:00:00" }));

const row = (key, value, day = 1) => ({ key, sourceId: "source-" + day, values: { status: value },
  extractedAt: `2026-10-0${day}T08:00:00+05:30` });
const stored = [row("OWN|ITEM1", "PENDING"), row("EXPORT|ITEM1", "COMPLETE")];
const result = merge(stored, [row("OWN|ITEM1", "COMPLETE", 2)]);
assert.equal(result.counts.updated, 1);
assert.equal(result.records.length, 2);
assert.equal(stored[0].values.status, "PENDING");
assert.equal(result.changes[0].before.values.status, "PENDING");
assert.equal(merge(result.records, [row("OWN|ITEM1", "PENDING")]).counts.stale, 1);
assert.equal(merge(result.records, [row("OWN|ITEM1", "COMPLETE", 2)]).counts.unchanged, 1);
const watermark = merge(stored, [row("OWN|ITEM1", "PENDING", 3)]);
assert.equal(merge(watermark.records, [row("OWN|ITEM1", "COMPLETE", 2)]).counts.stale, 1);
assert.throws(() => merge(stored, [row("OWN|ITEM1", "OTHER")]));
assert.throws(() => merge(stored, [row("", "COMPLETE")]));
assert.throws(() => merge(stored, [{ ...row("OWN|ITEM1", "COMPLETE"), extractedAt: "2026-10-02T08:00:00" }]));
assert.throws(() => merge([stored[0], stored[0]], []));
assert.equal(merge(stored, [row("OWN|ITEM2", "COMPLETE")]).counts.inserted, 1);

assert.equal(archive("folder", source).reused, false);
assert.equal(archive("folder", source).reused, true);
assert.equal(writes, 1);
assert.equal(archive("folder", { ...source, content: source.content + "SKU2,G2\n" }).reused, false);
assert.equal(writes, 2);
assert.throws(() => archive("", source));
console.log("Monthly foundation validated: IST boundaries, coverage, corrections, idempotency, immutable archives.");
