import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const pipelineSource = fs.readFileSync(
  new URL("../apps-script/Pipeline.gs", import.meta.url),
  "utf8",
);
const context = vm.createContext({ Map, Set, Date, Array, String, Boolean, Number, Math });
new vm.Script(pipelineSource, { filename: "Pipeline.gs" }).runInContext(context);

const resolve = context.resolveHybridGrnMatch_;
const recordKey = context.makeRecordKey_;
const primaryKey = context.makePrimaryMatchKey_;

function entry(facility, sku, invoice, grn) {
  return { facility, sku, invoice, grn, timestamp: new Date("2026-07-01T10:00:00Z"), row: 2 };
}

function indexes(entries) {
  const grnMap = new Map();
  const primary = new Map();
  const rx = new Set();
  const own = new Set();
  const exportFacility = new Set();
  entries.forEach((item) => {
    grnMap.set(recordKey(item.facility, item.sku, item.grn), item);
    if (item.invoice) {
      const key = primaryKey(item.sku, item.invoice, item.grn);
      if (!primary.has(key)) primary.set(key, []);
      primary.get(key).push(item);
    }
    if (item.facility === "SL Rx") rx.add(`${item.grn}|${item.sku}`);
    if (item.facility === "OWN") own.add(`${item.grn}|${item.sku}`);
    if (item.facility === "EXPORT") exportFacility.add(`${item.grn}|${item.sku}`);
  });
  return { grnMap, primary, rx, own, exportFacility };
}

function resolveWithBridges(goodsFacility, sku, invoice, grn, idx) {
  return resolve(
    goodsFacility,
    sku,
    invoice,
    grn,
    idx.grnMap,
    idx.primary,
    idx.rx,
    true,
    idx.own,
    true,
    idx.exportFacility,
    true,
  );
}

const sku = "SKU-1";
const grn = "G100";
const invoice = "INV/100";

{
  const idx = indexes([entry("SL Mother Hub", sku, invoice, grn)]);
  const result = resolveWithBridges("SL Mother Hub", sku, invoice, grn, idx);
  assert.equal(result.method, "PRIMARY_MATCH");
  assert.equal(result.facility, "SL Mother Hub");
}

{
  const idx = indexes([entry("SL Ambient", sku, invoice, grn)]);
  const result = resolveWithBridges("SL Mother Hub", sku, invoice, grn, idx);
  assert.equal(result.method, "CROSS_FACILITY_MATCH");
  assert.equal(result.facility, "SL Ambient");
}

{
  const idx = indexes([entry("SL Mother Hub", sku, "INV/ERP", grn)]);
  const blank = resolveWithBridges("SL Mother Hub", sku, "", grn, idx);
  const mismatch = resolveWithBridges("SL Mother Hub", sku, "INV/GOODS", grn, idx);
  assert.equal(blank.method, "FALLBACK_BLANK_INVOICE");
  assert.equal(mismatch.method, "FALLBACK_INVOICE_MISMATCH");
}

{
  const idx = indexes([
    entry("SL Ambient", sku, invoice, grn),
    entry("SL Mother Hub", sku, invoice, grn),
  ]);
  const result = resolveWithBridges("SL Mother Hub", sku, invoice, grn, idx);
  assert.equal(result.method, "AMBIGUOUS_MATCH");
  assert.equal(result.blockGrnJoin, true);
}

{
  const idx = indexes([]);
  const result = resolveWithBridges("SL Mother Hub", sku, invoice, grn, idx);
  assert.equal(result.method, "NO_GRN_MATCH");
}

{
  const rxEntry = entry("SL Rx", sku, "INV/ERP", grn);
  const idx = indexes([rxEntry]);
  const result = resolveWithBridges("SL Ambient", sku, "INV/GOODS", grn, idx);
  assert.equal(result.method, "FALLBACK_INVOICE_MISMATCH");
  assert.equal(result.facility, "SL Rx");
}

{
  const ownEntry = entry("OWN", sku, "INV/ERP", grn);
  const idx = indexes([ownEntry]);
  const result = resolveWithBridges("SL Mother Hub", sku, "INV/GOODS", grn, idx);
  assert.equal(result.method, "FALLBACK_INVOICE_MISMATCH");
  assert.equal(result.facility, "OWN");
  assert.match(result.detail, /controlled Facility \+ SKU \+ GRN fallback/);
}

{
  const exportEntry = entry("EXPORT", sku, "INV/ERP", grn);
  const idx = indexes([exportEntry]);
  const result = resolveWithBridges("SL Mother Hub", sku, "INV/GOODS", grn, idx);
  assert.equal(result.method, "FALLBACK_INVOICE_MISMATCH");
  assert.equal(result.facility, "EXPORT");
  assert.match(result.detail, /SL Mother Hub-to-EXPORT bridge/);
}

{
  const idx = indexes([
    entry("OWN", sku, "INV/OWN", grn),
    entry("EXPORT", sku, "INV/EXPORT", grn),
  ]);
  const result = resolveWithBridges("SL Mother Hub", sku, "INV/GOODS", grn, idx);
  assert.equal(result.method, "AMBIGUOUS_MATCH");
  assert.equal(result.blockGrnJoin, true);
  assert.match(result.detail, /OWN, EXPORT/);
}

assert.equal(context.normalizeInvoice_("  inv/100  "), "INV/100");
console.log("Hybrid matching scenarios validated");
