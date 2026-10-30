/** One resumable 5,000-source-row batch per owner execution. */
function runMonthlyInboxBackfillBatch() { return monthlyInboxBackfillBatch_(true); }
function previewMonthlyInboxBackfillBatch() { return monthlyInboxBackfillBatch_(false); }

function monthlyBackfillDigest_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (byte) { return (byte & 255).toString(16).padStart(2, "0"); }).join("");
}

/** Scan CSV boundaries without parsing the full matrix; quoted newlines are data. */
function monthlyCsvBatch_(csv, offset, limit) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) throw new Error("Invalid batch cursor.");
  let quoted = false, start = 0, header = null, rows = 0, picked = 0, first = -1, last = -1;
  function boundary(end, next) {
    const line = csv.slice(start, end);
    if (header === null) header = line.replace(/^\uFEFF/, "");
    else if (line.trim()) {
      if (rows >= offset && picked < limit) { if (first < 0) first = start; last = end; picked++; }
      rows++;
    }
    start = next;
  }
  for (let i = 0; i < csv.length; i++) {
    if (csv[i] === '"') {
      if (quoted && csv[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (csv[i] === "\n" || csv[i] === "\r")) {
      const end = i;
      if (csv[i] === "\r" && csv[i + 1] === "\n") i++;
      boundary(end, i + 1);
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote; batch not imported.");
  if (start < csv.length) boundary(csv.length, csv.length);
  if (!header || rows === 0) throw new Error("CSV contains no data rows.");
  if (offset > rows) throw new Error("Batch cursor is beyond source rows.");
  return { content: picked ? header + "\n" + csv.slice(first, last) + "\n" : "", totalRows: rows, batchRows: picked,
    nextOffset: offset + picked, complete: offset + picked === rows };
}

function monthlyInboxBackfillBatch_(apply) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw new Error("A backfill batch is already running for this account.");
  try {
    const access = monthlyBackfillOwner_();
    const settings = monthlyInboxBackfillSettings_();
    const source = monthlyBackfillSource_(settings, access.config);
    if (source.content.length > 40000000) throw new Error("Export exceeds the 40 million character download ceiling. Generate smaller Uniware exports.");
    const hash = monthlyBackfillDigest_(source.content);
    const jobKey = "INWARD_TAT_BATCH_" + monthlyBackfillDigest_(JSON.stringify([
      source.month, source.messageId, source.type, source.facility, source.periodStart, source.periodEndExclusive, source.extractedAt, hash,
    ]));
    const properties = PropertiesService.getScriptProperties();
    const offset = Number(properties.getProperty(jobKey) || 0);
    const batch = monthlyCsvBatch_(source.content, offset, 5000);
    source.content = batch.content; // Release the full download before loading monthly state.
    source.batch = { hash: hash, firstSourceRow: offset + 2, sourceRows: batch.batchRows, totalSourceRows: batch.totalRows };
    const progress = { month: source.month, type: source.type, facility: source.facility,
      processedSourceRows: batch.nextOffset, totalSourceRows: batch.totalRows, batchRows: batch.batchRows,
      complete: batch.complete, provisional: true };
    if (!batch.batchRows) { console.log(JSON.stringify(progress)); return progress; }
    let result;
    if (apply) {
      console.log("Saving source rows " + (offset + 2) + " through " + (batch.nextOffset + 1) + ".");
      // Mixed Putaway exports can contain chunks with no GRN items; header/type
      // validation still applies and their original rows are archived as evidence.
      const state = ingestMonthlySource_(source, access.user, access.config);
      // Checkpoint only after archive verification and publication. A lost response
      // safely replays this exact chunk via content/metadata hash detection.
      properties.setProperty(jobKey, String(batch.nextOffset));
      result = Object.assign(progress, { revision: state.revision, duplicate: state.duplicate, reconciliation: state.lastReconciliation });
    } else {
      const parsed = monthlyParseCsv_(source);
      const state = readMonthlyState_(source.month);
      const merge = reconcileMonthlyRecords_(state.records, parsed.records);
      result = Object.assign(progress, { revision: state.revision, acceptedRows: parsed.records.length, reconciliation: merge.counts, preview: true });
    }
    console.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}
