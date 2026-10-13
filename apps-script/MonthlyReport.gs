/** Two-tab monthly MIS. Every export is tied to an immutable source revision. */
function monthlyExcelDateTime_(value, offsetMinutes) {
  if (!value) return ["", ""];
  const stamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(stamp.getTime())) return ["", ""];
  const ist = new Date(stamp.getTime() + (offsetMinutes == null ? 330 : offsetMinutes) * 60000);
  return [Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) / 86400000 + 25569,
    (ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds()) / 86400];
}

function monthlyReportModel_(state, config) {
  config = state.calculationConfig || config;
  const calculations = state.calculations || { facts: [], sourceExceptions: [], summary: {}, daily: [], facilities: [] };
  const exclusions = new Set(String(config.OWN_EXCLUDED_SKUS || "").split(/[|,;\n]/).map(normalizeSku_).filter(Boolean));
  const cutoff = state.updatedAt || new Date().toISOString();
  const headers = ["Record Key", "Facility", "GRN Number", "SKU", "Invoice", "Boxes (source row)",
    "Unloading Date", "Unloading Time", "GRN Date", "GRN Time", "Putaway Date", "Putaway Time",
    "KPI1 Hours", "KPI2 Hours", "KPI3 Hours", "Status", "KPI Eligibility", "Exception", "Match Method",
    "Owner", "Ageing Hours", "Goods Source", "GRN Source", "Putaway Source"];
  function source(rowNumber) { return state.records[Number(rowNumber) - 2] || null; }
  function sourceLink(record) { return record ? "https://drive.google.com/file/d/" + record.sourceId + "/view" : ""; }
  const details = calculations.facts.map(function (fact) {
    const goods = source(fact[16]);
    const exempt = fact[1] === "OWN" && exclusions.has(fact[2]);
    const pending = !exempt && fact[13] !== "COMPLETE";
    return [fact[0], fact[1], fact[3], fact[2], goods ? goods.values["Invoice number"] || "" : "",
      goods && Number.isFinite(Number(goods.values["No. of Boxes Recd"])) ? Number(goods.values["No. of Boxes Recd"]) : "",
      ...monthlyExcelDateTime_(fact[4]), ...monthlyExcelDateTime_(fact[5]), ...monthlyExcelDateTime_(fact[6]),
      fact[9], fact[8], fact[7], exempt ? "EXCLUDED" : fact[13], exempt ? "EXCLUDE" : "INCLUDE",
      exempt ? "Approved OWN SKU exclusion" : fact[14], fact[20], pending ? "Unassigned" : "",
      pending ? Math.max(0, (Date.parse(cutoff) - new Date(fact[4]).getTime()) / 3600000) : "",
      sourceLink(goods), sourceLink(source(fact[17])), sourceLink(source(fact[18]))];
  });
  calculations.sourceExceptions.forEach(function (entry) {
    const record = source(entry.sourceRow);
    details.push([record ? record.key : "", entry.facility, entry.grnNumber, entry.sku,
      record ? record.values["Invoice number"] || "" : "", "", "", "", "", "", "", "", "", "", "",
      "SOURCE_EXCEPTION", "REVIEW", entry.exceptionCode + ": " + entry.exceptionDetail, "", "Unassigned", "",
      sourceLink(record), "", ""]);
  });
  const volume = new Map();
  const allowed = String(config.GOODS_ALLOWED_FACILITIES || "SL Mother Hub|SL Ambient").split("|").map(normalizeFacility_);
  state.records.forEach(function (record) {
    const row = record.values;
    if (row._sourceType !== "GOODS_INWARD" || !allowed.includes(normalizeFacility_(row["Received at"])) || !monthlyValidUnloading_(row)) return;
    const unloading = combineDateAndTime_(row["Unloading Date"], row["Unloading Time"]);
    if (!monthlyContainsTimestamp_(state.month, unloading)) return;
    const day = Utilities.formatDate(unloading, "Asia/Kolkata", "yyyy-MM-dd");
    const boxes = Number(row["No. of Boxes Recd"]);
    const group = volume.get(day) || { boxes: 0, missingBoxes: 0 };
    if (String(row["No. of Boxes Recd"] == null ? "" : row["No. of Boxes Recd"]).trim() && Number.isFinite(boxes) && boxes >= 0) group.boxes += boxes;
    else group.missingBoxes++;
    volume.set(day, group);
  });
  const monthWindow = monthlyWindow_(state.month);
  const dailyMap = new Map(calculations.daily.map(function (day) { return [day.date, day]; }));
  const daily = [];
  for (let time = monthWindow.start.getTime(); time < monthWindow.end.getTime(); time += 86400000) {
    const date = Utilities.formatDate(new Date(time), "Asia/Kolkata", "yyyy-MM-dd");
    const day = dailyMap.get(date) || { records: 0, excludedRecords: 0, eligibleRecords: 0, completeRecords: 0, pendingRecords: 0, kpi1Hours: null, kpi2Hours: null, kpi3Hours: null };
    daily.push(Object.assign({ date: date, boxes: (volume.get(date) || {}).boxes || 0,
      missingBoxValues: (volume.get(date) || {}).missingBoxes || 0,
      progress: time >= Date.parse(cutoff) ? "Future day" : dailyMap.has(date) ? "Activity captured" : "No activity captured; check sources" }, day));
  }
  const sourceTables = ["GOODS_INWARD", "GRN", "PUTAWAY"].map(function (type) {
    const records = state.records.filter(function (record) { return record.values._sourceType === type; });
    const names = Array.from(new Set(records.flatMap(function (record) { return Object.keys(record.values).filter(function (name) { return name.charAt(0) !== "_"; }); })));
    const columns = names.flatMap(function (name) {
      if (/Timestamp|Last Updated|QC Completed On|^Created$|^Updated$/i.test(name)) return [{ name: name, label: name + " Date", kind: "datePart" }, { name: name, label: name + " Time", kind: "timePart" }, { name: name, label: name + " Unparsed Original", kind: "unparsed" }];
      return [{ name: name, label: name, kind: /date|MFG\.|EXP\./i.test(name) ? "date" : /time/i.test(name) ? "time" : "text" }];
    });
    return { type: type, headers: ["Stable Source Key", "Archive Source", "Extracted Date (UTC)", "Extracted Time (UTC)"].concat(columns.map(function (column) { return column.label; })),
      formats: ["@", "@", "dd-mmm-yyyy", "hh:mm:ss"].concat(columns.map(function (column) { return /date/i.test(column.kind) ? "dd-mmm-yyyy" : /time/i.test(column.kind) ? "hh:mm:ss" : "@"; })),
      rows: records.map(function (record) {
        return [record.key, sourceLink(record), ...monthlyExcelDateTime_(record.extractedAt, 0)].concat(columns.map(function (column) {
          const value = record.values[column.name] == null ? "" : record.values[column.name];
          if (column.kind === "text" || value === "") return value;
          if (column.kind === "time") { const time = parseTimeParts_(value); return time ? (time.hour * 3600 + time.minute * 60 + time.second) / 86400 : value; }
          const parsed = parseDateTime_(value);
          if (column.kind === "unparsed") return parsed ? "" : value;
          const pair = monthlyExcelDateTime_(parsed);
          return column.kind === "timePart" ? pair[1] : pair[0];
        }));
      }) };
  });
  return { month: state.month, revision: state.revision, status: state.status, cutoff: cutoff,
    summary: calculations.summary, daily: daily, facilities: calculations.facilities,
    headers: headers, details: details, sourceTables: sourceTables, sources: state.sources,
    targetHours: Number(config.KPI1_TARGET_HOURS || 14),
    totalBoxes: daily.reduce(function (total, day) { return total + day.boxes; }, 0),
    missingBoxValues: daily.reduce(function (total, day) { return total + day.missingBoxValues; }, 0),
    sourceExceptionCount: calculations.sourceExceptions.length };
}

function monthlyReportPreview_(state, config) {
  const model = monthlyReportModel_(state, config);
  return Object.assign(monthlyPublicState_(state), {
    daily: model.daily, totalBoxes: model.totalBoxes, missingBoxValues: model.missingBoxValues,
    pending: model.details.filter(function (row) { return row[15] === "SOURCE_EXCEPTION" || (row[16] === "INCLUDE" && row[15] !== "COMPLETE"); })
      .slice(0, 100).map(function (row) { return { key: row[0], facility: row[1], grn: row[2], sku: row[3], stage: row[17], owner: row[19], ageingHours: row[20] }; }),
  });
}

function monthlySafeCell_(value) {
  // Imported text must not execute as an Excel/Sheets formula.
  return typeof value === "string" && /^[=+@-]/.test(value) ? "'" + value : value == null ? "" : value;
}

function monthlyWriteTable_(sheet, row, values) {
  if (!values.length) return;
  const width = values[0].length;
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (sheet.getMaxRows() < row + values.length - 1) sheet.insertRowsAfter(sheet.getMaxRows(), row + values.length - 1 - sheet.getMaxRows());
  for (let start = 0; start < values.length; start += 1000) {
    const batch = values.slice(start, start + 1000).map(function (cells) { return cells.map(monthlySafeCell_); });
    sheet.getRange(row + start, 1, batch.length, width).setValues(batch);
  }
  sheet.getRange(row, 1, 1, width).setBackground("#1D3475").setFontColor("#ffffff").setFontWeight("bold").setWrap(true);
  sheet.setRowHeight(row, 42);
}

function createMonthlyMis_(month, expectedRevision, user) {
  const config = monthlyAccess_(user);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const state = readMonthlyState_(month);
    if (!state.revision || !state.calculations) throw new Error("Refresh this month and import its reports before generating MIS.");
    if (String(expectedRevision) !== String(state.revision)) throw new Error("Monthly data changed. Reload the month before downloading MIS.");
    const folder = monthlyDrive_().getFolderById(config.MONTHLY_ARCHIVE_FOLDER_ID);
    const filename = "Inward_TAT_MIS_" + month + "_r" + state.revision + "_" + state.status + ".xlsx";
    const prior = folder.getFilesByName(filename);
    let output;
    if (prior.hasNext()) output = prior.next();
    else {
      const model = monthlyReportModel_(state, config);
      const workbook = SpreadsheetApp.create(filename.replace(/\.xlsx$/, ""));
      const summary = workbook.getSheets()[0].setName("Summary");
      const detail = workbook.insertSheet("Detailed Data");
      const detailValues = model.details.length ? model.details : [Array(model.headers.length).fill("")];
      detail.getRange("A1").setValue("Monthly records and supporting sources — " + month);
      monthlyWriteTable_(detail, 3, [model.headers].concat(detailValues));
      const endRow = 3 + detailValues.length;
      detail.getRange(4, 7, detailValues.length, 1).setNumberFormat("dd-mmm-yyyy");
      detail.getRange(4, 9, detailValues.length, 1).setNumberFormat("dd-mmm-yyyy");
      detail.getRange(4, 11, detailValues.length, 1).setNumberFormat("dd-mmm-yyyy");
      [8, 10, 12].forEach(function (column) { detail.getRange(4, column, detailValues.length, 1).setNumberFormat("hh:mm:ss"); });
      detail.getRange(4, 13, detailValues.length, 3).setNumberFormat("0.00");
      detail.getRange(4, 21, detailValues.length, 1).setNumberFormat("0.0");
      detail.getRange(3, 1, detailValues.length + 1, model.headers.length).createFilter();
      detail.setFrozenRows(3); detail.setFrozenColumns(4);
      let sourceRow = endRow + 4;
      model.sourceTables.forEach(function (table) {
        if (detail.getMaxRows() < sourceRow) detail.insertRowsAfter(detail.getMaxRows(), sourceRow - detail.getMaxRows());
        detail.getRange(sourceRow, 1).setValue(table.type + " supporting source records (different grain; do not add to KPI record counts)");
        monthlyWriteTable_(detail, sourceRow + 1, [table.headers].concat(table.rows));
        if (table.rows.length) table.formats.forEach(function (format, column) { detail.getRange(sourceRow + 2, column + 1, table.rows.length, 1).setNumberFormat(format); });
        sourceRow += table.rows.length + 5;
      });
      detail.setColumnWidths(1, detail.getMaxColumns(), 145);
      detail.setColumnWidth(1, 290); detail.setColumnWidth(18, 280);
      detail.setColumnWidths(22, 3, 300);
      summary.getRange("A1:H1").merge().setValue("Inward TAT Monthly MIS — " + month).setFontSize(18).setFontWeight("bold");
      monthlyWriteTable_(summary, 3, [["Report field", "Value"], ["Status", model.status], ["Revision", model.revision],
        ["Data cutoff (UTC)", model.cutoff], ["Total receipt records", model.summary.records || 0],
        ["Eligible records", model.summary.eligibleRecords || 0], ["Complete records", model.summary.completeRecords || 0],
        ["Pending eligible records", model.summary.pendingRecords || 0], ["Approved OWN exclusions", model.summary.excludedRecords || 0],
        ["Source corrections required", model.sourceExceptionCount], ["Boxes unloaded (unique source rows)", model.totalBoxes],
        ["Missing box values", model.missingBoxValues], ["KPI1 average hours", ""], ["KPI2 average hours", ""], ["KPI3 average hours", ""]]);
      // Averages reconcile directly to the exact complete, eligible detail cohort.
      ["M", "N", "O"].forEach(function (column, index) {
        const q = "'Detailed Data'!Q4:Q" + endRow; const p = "'Detailed Data'!P4:P" + endRow;
        summary.getRange(15 + index, 2).setFormula('=IF(COUNTIFS(' + q + ',"INCLUDE",' + p + ',"COMPLETE")=0,"",SUMIFS(\'Detailed Data\'!' + column + '4:' + column + endRow + ',' + q + ',"INCLUDE",' + p + ',"COMPLETE")/COUNTIFS(' + q + ',"INCLUDE",' + p + ',"COMPLETE"))').setNumberFormat("0.00");
      });
      summary.getRange("A20:H21").merge().setValue("IST reporting month follows unloading date. Later GRN/Putaway completions remain in this month. Provisional until source coverage and pending items are reviewed. Owner assignment and final approval are part of closure setup.").setWrap(true);
      summary.setRowHeight(20, 60);
      const dailyValues = model.daily.map(function (day) { return [monthlyExcelDateTime_(day.date + "T00:00:00+05:30")[0], day.records,
        day.completeRecords, day.pendingRecords, day.kpi1Hours, day.kpi2Hours, day.kpi3Hours, model.targetHours, day.boxes, day.progress]; });
      monthlyWriteTable_(summary, 24, [["Date", "Records", "Complete", "Pending", "KPI1 h", "KPI2 h", "KPI3 h", "Target h", "Boxes unloaded", "Progress"]].concat(dailyValues));
      summary.getRange(25, 1, dailyValues.length, 1).setNumberFormat("dd-mmm-yyyy");
      summary.getRange(25, 5, dailyValues.length, 4).setNumberFormat("0.00");
      const facilityRow = 28 + dailyValues.length;
      monthlyWriteTable_(summary, facilityRow, [["Facility", "Records", "Complete", "Pending", "KPI1 h", "KPI2 h", "KPI3 h"]].concat(model.facilities.map(function (row) {
        return [row.facility, row.records, row.completeRecords, row.pendingRecords, row.kpi1Hours, row.kpi2Hours, row.kpi3Hours];
      })));
      const sourcesRow = facilityRow + model.facilities.length + 4;
      monthlyWriteTable_(summary, sourcesRow, [["Source", "Facility", "Declared month coverage", "Extracted at UTC", "Archive"]].concat(model.sources.map(function (source) {
        return [source.type, source.facility, source.completeMonthCoverage ? "Full month declared" : "Partial coverage", source.extractedAt, "https://drive.google.com/file/d/" + source.fileId + "/view"];
      })));
      summary.setColumnWidths(1, 10, 125); summary.setColumnWidth(1, 300); summary.setColumnWidth(2, 190); summary.setColumnWidth(10, 300); summary.setFrozenRows(3);
      const chartEnd = 24 + dailyValues.length;
      summary.insertChart(summary.newChart().setChartType(Charts.ChartType.LINE)
        .addRange(summary.getRange("A24:A" + chartEnd)).addRange(summary.getRange("E24:H" + chartEnd))
        .setNumHeaders(1).setOption("title", "Daily KPI trends and " + model.targetHours + "-hour target").setOption("width", 650).setOption("height", 300).setPosition(3, 12, 0, 0).build());
      summary.insertChart(summary.newChart().setChartType(Charts.ChartType.COLUMN)
        .addRange(summary.getRange("A24:A" + chartEnd)).addRange(summary.getRange("C24:D" + chartEnd))
        .setNumHeaders(1).setOption("title", "Daily completion and pending progress").setOption("isStacked", true).setOption("width", 650).setOption("height", 300).setPosition(19, 12, 0, 0).build());
      summary.insertChart(summary.newChart().setChartType(Charts.ChartType.COLUMN)
        .addRange(summary.getRange("A24:A" + chartEnd)).addRange(summary.getRange("I24:I" + chartEnd))
        .setNumHeaders(1).setOption("title", "Daily unloading volume (boxes)").setOption("width", 650).setOption("height", 300).setPosition(35, 12, 0, 0).build());
      if (model.facilities.length) summary.insertChart(summary.newChart().setChartType(Charts.ChartType.COLUMN)
        .addRange(summary.getRange(facilityRow, 1, model.facilities.length + 1, 1)).addRange(summary.getRange(facilityRow, 5, model.facilities.length + 1, 3))
        .setNumHeaders(1).setOption("title", "Facility KPI comparison").setOption("width", 650).setOption("height", 300).setPosition(51, 12, 0, 0).build());
      SpreadsheetApp.flush();
      monthlyDrive_().getFileById(workbook.getId()).moveTo(folder);
      let blob;
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + workbook.getId() + "/export?format=xlsx", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
        const candidate = response.getBlob(); const bytes = candidate.getBytes();
        if (response.getResponseCode() === 200 && bytes.length > 4 && bytes[0] === 80 && bytes[1] === 75) { blob = candidate; break; }
        if (attempt < 2) Utilities.sleep(1000 * (attempt + 1));
      }
      if (!blob) throw new Error("Excel export failed. The monthly revision remains intact; retry download.");
      output = folder.createFile(blob.setName(filename));
    }
    const bytes = output.getBlob().getBytes();
    if (bytes.length > 12000000) throw new Error("MIS exceeds the direct-download limit. Retrieve the archived report from Drive.");
    return { ok: true, filename: filename, month: month, revision: state.revision, status: state.status,
      fileId: output.getId(), base64: Utilities.base64Encode(bytes), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  } finally { lock.releaseLock(); }
}
