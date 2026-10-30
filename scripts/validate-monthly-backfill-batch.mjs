import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
const properties = new Map();
let published = 12, fail = false, replay = false, writes = 0, released = 0;
const hashes = new Set();
const csv = 'ID,Remarks\r\n' + Array.from({length: 51456}, (_, i) => `${i},"batch, note ${i}${i === 4999 ? '\nsecond line' : ''}"`).join('\r\n');
const context = vm.createContext({ console: { log() {} },
  monthlyBackfillOwner_: () => ({ user: {}, config: {} }),
  monthlyInboxBackfillSettings_: () => ({}),
  monthlyBackfillSource_: () => ({ month: "2026-10", messageId: "abc", type: "PUTAWAY", facility: "SL Mother Hub", content: csv }),
  LockService: { getUserLock: () => ({ tryLock: () => true, releaseLock: () => { released++; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key), setProperty: (key, value) => {
    if (replay) { replay = false; throw Error("lost checkpoint"); } properties.set(key, value);
  } }) },
  Utilities: { DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    computeDigest: (_, value) => [...crypto.createHash("sha256").update(value).digest()] },
  monthlyParseCsv_: source => ({ records: [], sourceRows: source.batch.sourceRows }),
  readMonthlyState_: () => ({ revision: published, records: [] }),
  reconcileMonthlyRecords_: () => ({ counts: {} }),
  ingestMonthlySource_: source => {
    if (fail) throw Error("save failed");
    writes++;
    assert.ok(source.content.length < csv.length);
    const signature = JSON.stringify(source.batch);
    const duplicate = hashes.has(signature);
    if (!duplicate) { hashes.add(signature); published++; }
    return { revision: published, duplicate, lastReconciliation: {} };
  },
});
vm.runInContext(fs.readFileSync(new URL("../apps-script/MonthlyBackfillBatch.gs", import.meta.url), "utf8"), context);
const quoted = 'A,B\r\n1,"x\ny"\r\n\r\n2,"a""b"\r\n3,z';
const first = context.monthlyCsvBatch_(quoted, 0, 1);
assert.equal(first.batchRows, 1); assert.equal(first.totalRows, 3);
assert.equal(first.content, 'A,B\n1,"x\ny"\n');
assert.equal(context.monthlyCsvBatch_(quoted, 1, 1).content, 'A,B\n2,"a""b"\n');
assert.equal(context.monthlyCsvBatch_(quoted, 2, 1).complete, true);
assert.throws(() => context.monthlyCsvBatch_('A\n"bad', 0, 1), /Unclosed/);
assert.throws(() => context.monthlyCsvBatch_(quoted, 4, 1), /beyond/);
context.previewMonthlyInboxBackfillBatch(); assert.equal(properties.size, 0); assert.equal(writes, 0);
fail = true; assert.throws(() => context.runMonthlyInboxBackfillBatch(), /save failed/); assert.equal(properties.size, 0);
fail = false; replay = true;
assert.throws(() => context.runMonthlyInboxBackfillBatch(), /lost checkpoint/);
assert.equal(properties.size, 0);
assert.equal(context.runMonthlyInboxBackfillBatch().duplicate, true);
assert.equal(published, 13);
let result;
for (let i = 0; i < 10; i++) result = context.runMonthlyInboxBackfillBatch();
assert.equal(result.complete, true); assert.equal(result.processedSourceRows, 51456);
assert.equal(result.batchRows, 1456); assert.equal(hashes.size, 11);
const before = writes;
assert.equal(context.runMonthlyInboxBackfillBatch().batchRows, 0); assert.equal(writes, before);
assert.ok(released >= 15);
console.log("Batched backfill validated on 51,456 rows: CSV boundaries, preview isolation, failed saves, lost-checkpoint replay, 11 batches and completed-run idempotency.");
