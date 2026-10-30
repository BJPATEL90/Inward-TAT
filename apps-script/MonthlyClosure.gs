/** Monthly foundation. Deliberately not invoked by the daily pipeline. */
function monthlyWindow_(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
    throw new Error("Select a reporting month in YYYY-MM format.");
  }
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  if (year < 2000 || year > 2100) throw new Error("Reporting year is outside the supported range.");
  // IST has no daylight-saving transitions. End is exclusive.
  const offset = 330 * 60 * 1000;
  return {
    month: month,
    timeZone: "Asia/Kolkata",
    start: new Date(Date.UTC(year, index, 1) - offset),
    end: new Date(Date.UTC(year, index + 1, 1) - offset),
  };
}

function monthlyContainsTimestamp_(month, timestamp) {
  const window = monthlyWindow_(month);
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) return false;
  return timestamp >= window.start && timestamp < window.end;
}

/** Validate declared extraction coverage, not just observed transaction dates. */
function validateMonthlySource_(source) {
  if (!source || !["GOODS_INWARD", "GRN", "PUTAWAY"].includes(source.type)) {
    throw new Error("Unsupported monthly source type.");
  }
  const window = monthlyWindow_(source.month);
  if (!String(source.facility || "").trim()) throw new Error("Source facility is required.");
  [source.periodStart, source.periodEndExclusive, source.extractedAt].forEach(function (value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
      throw new Error("Source timestamps require explicit timezone offsets.");
    }
  });
  const start = new Date(source.periodStart);
  const end = new Date(source.periodEndExclusive);
  const extractedAt = new Date(source.extractedAt);
  if (![start, end, extractedAt].every(function (date) { return Number.isFinite(date.getTime()); })) {
    throw new Error("Source interval and extraction time must be valid timestamps.");
  }
  if (start >= end || extractedAt < end) throw new Error("Source interval is invalid or not yet complete at extraction.");
  if (typeof source.content !== "string" || !source.content.trim()) throw new Error("Source content is empty.");
  return {
    month: source.month,
    type: source.type,
    facility: String(source.facility).trim(),
    periodStart: start.toISOString(),
    periodEndExclusive: end.toISOString(),
    extractedAt: extractedAt.toISOString(),
    sheetId: source.sheetId ? String(source.sheetId) : null,
    goodsSnapshotMode: source.goodsSnapshotMode === "SHEET_ROWS_V1" ? "SHEET_ROWS_V1" : null,
    batch: source.batch || null,
    coverageDeclared: source.coverageDeclared !== false,
    extractionTimeBasis: source.extractionTimeBasis || "DECLARED",
    completeMonthCoverage: source.coverageDeclared !== false && start <= window.start && end >= window.end,
  };
}

/**
 * Side-effect-free merge. The caller supplies verified stable identity keys.
 * Null keys are rejected; absent incoming records do not delete stored records.
 * Equal extraction times with conflicting values fail before any persistence.
 */
function reconcileMonthlyRecords_(existing, incoming) {
  const records = new Map();
  const changes = [];
  const counts = { inserted: 0, updated: 0, unchanged: 0, stale: 0 };
  function validate(record) {
    if (!record || typeof record.key !== "string" || !record.key.trim()) throw new Error("Stable record key is required.");
    if (!record.sourceId || !record.values || typeof record.values !== "object" || Array.isArray(record.values)) {
      throw new Error("Record source and named values are required.");
    }
    if (typeof record.extractedAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(record.extractedAt)) {
      throw new Error("Record extraction timestamp requires a timezone offset.");
    }
    const time = Date.parse(record.extractedAt);
    if (!Number.isFinite(time)) throw new Error("Record extraction timestamp is required.");
    return time;
  }
  function signature(values) {
    return JSON.stringify(Object.keys(values).sort().map(function (key) { return [key, values[key]]; }));
  }
  existing.forEach(function (record) {
    validate(record);
    if (records.has(record.key)) throw new Error("Duplicate identity in stored records: " + record.key);
    records.set(record.key, record);
  });
  incoming.forEach(function (record) {
    const time = validate(record);
    const previous = records.get(record.key);
    if (!previous) {
      records.set(record.key, record);
      counts.inserted += 1;
      changes.push({ key: record.key, before: null, after: record });
      return;
    }
    const previousTime = validate(previous);
    if (time < previousTime) { counts.stale += 1; return; }
    const equal = signature(previous.values) === signature(record.values);
    if (time === previousTime && !equal) throw new Error("Conflicting values at the same extraction time: " + record.key);
    if (equal) {
      counts.unchanged += 1;
      // Advance the watermark even if business values did not change.
      if (time > previousTime) records.set(record.key, record);
      return;
    }
    counts.updated += 1;
    records.set(record.key, record);
    changes.push({ key: record.key, before: previous, after: record });
  });
  return { records: Array.from(records.values()), changes: changes, counts: counts };
}

/**
 * Opt-in immutable Drive archive. Original content and declared coverage are
 * retained together. Call only from an authorized locked ingestion workflow.
 * No existing files are modified; identical source metadata/content is reused.
 */
function archiveMonthlySource_(folderId, source) {
  if (!String(folderId || "").trim()) throw new Error("Monthly archive folder is not configured.");
  const metadata = validateMonthlySource_(source);
  const envelope = JSON.stringify({ schemaVersion: 1, metadata: metadata, content: source.content });
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, envelope, Utilities.Charset.UTF_8);
  const hash = digest.map(function (byte) { return (byte & 255).toString(16).padStart(2, "0"); }).join("");
  const name = "Inward-TAT-" + metadata.month + "-" + metadata.type + "-" + hash + ".json";
  const folder = monthlyDrive_().getFolderById(folderId);
  const files = folder.getFilesByName(name);
  if (files.hasNext()) {
    const existing = files.next();
    if (existing.getBlob().getDataAsString("UTF-8") !== envelope) throw new Error("Archive integrity mismatch.");
    return { fileId: existing.getId(), hash: hash, reused: true, metadata: metadata };
  }
  const file = folder.createFile(Utilities.newBlob(envelope, "application/json", name));
  return { fileId: file.getId(), hash: hash, reused: false, metadata: metadata };
}
