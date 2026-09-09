/** Shelf workload context. Does not rebuild or modify historical KPI facts. */
function delaySheetObjects_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues(), headers = values[0].map(function (v) { return String(v).trim(); });
  return values.slice(1).map(function (row, i) {
    const result = { __row: i + 2 };
    headers.forEach(function (header, c) { result[header] = row[c]; });
    return result;
  }).filter(function (row) { return headers.some(function (h) { return row[h] !== ""; }); });
}
function delayPack_(value) {
  const n = Number(String(value == null ? "" : value).replace(/,/g, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function delayLevel_(shelf) {
  const match = String(shelf || "").trim().toUpperCase().match(/^R.*-(\d{3})$/);
  const n = match ? Number(match[1]) : 0;
  return n >= 1 && n <= 14 ? Math.floor((n - 1) / 2) : null;
}

function delayMasterIndex_(rows) {
  const index = new Map();
  rows.forEach(function (r) {
    const sku = normalizeSku_(r.SKU);
    if (!sku) return;
    if (!index.has(sku)) index.set(sku, { packs: new Set(), classes: new Set() });
    const entry = index.get(sku), p = delayPack_(r["Pack Size"]);
    if (p) entry.packs.add(p);
    const abc = String(r["ABC Class"] || "").trim().toUpperCase();
    if (/^[ABC]$/.test(abc)) entry.classes.add(abc);
  });
  return index;
}

function syncDelaySkuMaster_(runId) {
  const master = openInwardTatSpreadsheet_().getSheetByName("SKU_MASTER");
  if (!master || master.getLastRow() < 2) return { filled: 0 };
  const headers = readHeaders_(master), col = headers.indexOf("Pack Size") + 1;
  if (!col || headers.indexOf("SKU") < 0) throw new Error("SKU_MASTER requires SKU and Pack Size headers.");
  let sourceCol = headers.indexOf("Pack Size Source") + 1;
  if (!sourceCol) {
    sourceCol = master.getLastColumn() + 1;
    master.getRange(1, sourceCol).setValue("Pack Size Source");
  }
  const candidates = new Map();
  const source = SpreadsheetApp.openById("1s-0M1E3dB47JJ6BxIcq8fVYYuA0UkjDxJdXLkivmu0Q");
  source.getSheets().filter(function (s) { return /^FG[- ]/i.test(s.getName()); }).forEach(function (s) {
    if (s.getLastRow() < 2) return;
    const rows = s.getDataRange().getValues();
    const h = rows[0].map(function (v) { return String(v).trim().toLowerCase(); });
    const si = h.indexOf("sku"), pi = h.indexOf("pack size");
    if (si < 0 || pi < 0) return;
    rows.slice(1).forEach(function (r) {
      const sku = normalizeSku_(r[si]), raw = String(r[pi] == null ? "" : r[pi]).trim();
      if (!sku || !raw) return;
      if (!candidates.has(sku)) candidates.set(sku, new Set());
      candidates.get(sku).add(delayPack_(raw) || "INVALID");
    });
  });
  let filled = 0;
  delaySheetObjects_(master).forEach(function (r) {
    if (String(r["Pack Size"] == null ? "" : r["Pack Size"]).trim()) return;
    const values = candidates.get(normalizeSku_(r.SKU));
    if (!values || values.size !== 1 || values.has("INVALID")) return;
    const cell = master.getRange(r.__row, col);
    if (cell.getFormula() || cell.getValue() !== "") return;
    cell.setValue(Array.from(values)[0]);
    cell.setNote("Filled from consistent Goods Receiving pack sizes across retained monthly tabs on " + new Date().toISOString());
    master.getRange(r.__row, sourceCol).setValue("Goods Receiving fallback");
    filled += 1;
  });
  logExecution_(runId, "SKU_MASTER_SYNC", "COMPLETED", "Filled " + filled + " missing pack sizes from consistent Goods Receiving records.", { rowsImported: filled });
  return { filled: filled };
}

function buildPutawayAnalysis_() {
  const sheet = openInwardTatSpreadsheet_().getSheetByName("SKU_MASTER");
  if (!sheet) throw new Error("SKU_MASTER sheet is missing.");
  const rows = delaySheetObjects_(sheet), master = delayMasterIndex_(rows);
  const facts = delaySheetObjects_(getSheet_(INWARD_TAT.SHEETS.FACT));
  const goods = new Map(delaySheetObjects_(getSheet_(INWARD_TAT.SHEETS.RAW_GOODS)).map(function (r) { return [r.__row, r]; }));
  return {
    ok: true, generatedAt: new Date().toISOString(), targetHours: 7,
    benchmarkStart: "2026-08-01", benchmarkDays: 90,
    records: delayJoinRows_(facts, delaySheetObjects_(getSheet_(INWARD_TAT.SHEETS.RAW_PUTAWAY)), goods, master),
    master: { rows: rows.length, uniqueSkus: master.size,
      missingPackRows: rows.filter(function (r) { return !delayPack_(r["Pack Size"]); }).length,
      conflictingPackSkus: Array.from(master.values()).filter(function (r) { return r.packs.size > 1; }).length,
      unclassifiedSkus: Array.from(master.values()).filter(function (r) { return r.classes.size !== 1; }).length }
  };
}

function validatePutawayAnalysisDeployment() {
  const result = buildPutawayAnalysis_();
  return { ok: result.ok, generatedAt: result.generatedAt, master: result.master,
    records: result.records.length,
    augustRecords: result.records.filter(function (r) { return r.date >= "2026-08-01" && r.date < "2026-09-01"; }).length,
    augustEligible: result.records.filter(function (r) { return r.eligible && r.date >= "2026-08-01" && r.date < "2026-09-01"; }).length,
    augustBoxes: result.records.filter(function (r) { return r.eligible && r.date >= "2026-08-01" && r.date < "2026-09-01"; }).reduce(function (n, r) { return n + (r.boxes || 0); }, 0) };
}

function delayJoinRows_(facts, raw, goods, master) {
  const items = new Map();
  const itemGrns = new Map();
  raw.forEach(function (r) {
    if (String(r.Type || "").trim().toUpperCase() !== "PUTAWAY_GRN_ITEM") return;
    const key = makeRecordKey_(normalizeFacility_(r.Facility), normalizeSku_(r["SKU Code"]), normalizeGrn_(r["GRN Number"]));
    const id = String(r["Putaway Item Id"] || "").trim();
    if (!key || !id) return;
    const allocationKey = normalizeFacility_(r.Facility) + "|" + normalizeSku_(r["SKU Code"]) + "|" + id;
    if (!itemGrns.has(allocationKey)) itemGrns.set(allocationKey, new Set());
    itemGrns.get(allocationKey).add(normalizeGrn_(r["GRN Number"]));
    const t = parseDateTime_(r["Last Updated"]), time = t ? t.getTime() : 0;
    const prior = items.get(key + "|" + id);
    if (!prior || time >= prior.time) items.set(key + "|" + id, { key: key, time: time, row: r });
  });
  const groups = new Map();
  items.forEach(function (item) {
    if (!groups.has(item.key)) groups.set(item.key, []);
    groups.get(item.key).push(item.row);
  });
  return facts.filter(function (f) { return Boolean(f["Record Key"]); }).map(function (f) {
    const key = String(f["Record Key"]), sku = normalizeSku_(f.SKU), entry = master.get(sku), issues = [];
    let pack = entry && entry.packs.size === 1 ? Array.from(entry.packs)[0] : null;
    let packSource = pack ? "SKU_MASTER" : "Unavailable";
    if (entry && entry.packs.size > 1) issues.push("Conflicting master pack sizes");
    if (!pack) {
      const receipt = goods.get(Number(f["Goods Source Row"]));
      // Source row numbers may move after refresh: verify identity before fallback.
      if (receipt && normalizeSku_(receipt.SKU) === sku &&
          splitGrnNumbers_(receipt["GRN no."]).indexOf(normalizeGrn_(f["GRN Number"])) !== -1 &&
          apiDate_(receipt["Unloading Date"]) === apiDate_(f["Unloading Date"]) &&
          (normalizeFacility_(receipt["Received at"]) === normalizeFacility_(f.Facility) ||
           (/^(OWN|EXPORT)$/.test(String(f.Facility)) && normalizeFacility_(receipt["Received at"]) === "SL Mother Hub") ||
           (f.Facility === "SL Rx" && normalizeFacility_(receipt["Received at"]) === "SL Ambient"))) {
        pack = delayPack_(receipt["Pack size"]);
        if (pack) packSource = "Matched Goods Receiving row";
      }
    }
    const abc = entry && entry.classes.size === 1 ? Array.from(entry.classes)[0] : "Unclassified";
    if (abc === "Unclassified") issues.push("ABC unavailable or conflicting");
    if (!pack) issues.push("Pack size unavailable");
    const shelves = new Map(), sourceRows = groups.get(key) || [];
    let excludedUnits = 0, invalid = false, pending = false, ambiguousQuantity = false;
    sourceRows.forEach(function (r) {
      const allocationKey = normalizeFacility_(r.Facility) + "|" + normalizeSku_(r["SKU Code"]) + "|" + String(r["Putaway Item Id"] || "").trim();
      if (itemGrns.get(allocationKey).size > 1) { ambiguousQuantity = true; return; }
      if (String(r["Status Code"] || "").trim().toUpperCase() !== "COMPLETE") { pending = true; return; }
      const q = Number(String(r.Quantity == null ? "" : r.Quantity).replace(/,/g, ""));
      if (r.Quantity == null || String(r.Quantity).trim() === "" || !Number.isFinite(q) || q < 0) { invalid = true; return; }
      const shelf = String(r.Shelf || "").trim().toUpperCase(), level = delayLevel_(shelf);
      if (level === null) { excludedUnits += q; return; }
      if (!shelves.has(shelf)) shelves.set(shelf, { shelf: shelf, level: level, units: 0 });
      shelves.get(shelf).units += q;
    });
    const allocations = Array.from(shelves.values());
    const units = allocations.reduce(function (n, a) { return n + a.units; }, 0);
    const reach = allocations.reduce(function (n, a) { return n + (a.level > 0 ? a.units : 0); }, 0);
    const level = units ? allocations.reduce(function (n, a) { return n + a.units * a.level; }, 0) / units : null;
    if (!sourceRows.length) issues.push("Putaway shelf records unavailable");
    else if (!units) issues.push("No eligible R-bin quantity");
    if (excludedUnits) issues.push("Non-R or unsupported bins excluded");
    if (invalid) issues.push("Invalid putaway quantity");
    if (pending) issues.push("Incomplete putaway items");
    if (ambiguousQuantity) issues.push("Putaway item linked to multiple GRNs; quantity allocation unresolved");
    const value = f["KPI2 GRN to Putaway Hours"];
    const hours = value === "" || value == null ? null : Number(value);
    const complete = f["Record Status"] === "COMPLETE" && hours !== null && Number.isFinite(hours) && hours >= 0;
    return { recordKey: key, facility: String(f.Facility || ""), sku: sku,
      grn: String(f["GRN Number"] || ""), date: apiDate_(f["Unloading Date"]),
      hours: complete ? hours : null, status: String(f["Record Status"] || ""),
      abc: abc, pack: pack, packSource: packSource, rUnits: units,
      boxes: pack && !invalid && !ambiguousQuantity && units > 0 ? units / pack : null,
      reachBoxes: pack && !invalid && !ambiguousQuantity && units > 0 ? reach / pack : null,
      reachShare: units ? reach / units : null, weightedLevel: level,
      highestLevel: allocations.length ? Math.max.apply(null, allocations.map(function (a) { return a.level; })) : null,
      shelfCount: shelves.size, excludedUnits: excludedUnits, allocations: allocations,
      eligible: complete && units > 0 && !invalid && !pending && !ambiguousQuantity, issues: issues };
  });
}
