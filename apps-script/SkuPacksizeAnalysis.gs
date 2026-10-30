function generateSkuMultiplePacksizeJanAug() {
  var SOURCE_SPREADSHEET_ID = "1s-0M1E3dB47JJ6BxIcq8fVYYuA0UkjDxJdXLkivmu0Q";
  var OUTPUT_SPREADSHEET_ID = "1vTWxEboW_4-9RBJEr0gvKTOQmgM2XEBh1onhDU4mzZI";
  var OUTPUT_SHEET_NAME = "SKU_Multiple_Packsize_Jan_Aug";
  var months = [
    { label: "Jan-26", sheet: "FG-Jan-26" },
    { label: "Feb-26", sheet: "FG-Feb-26" },
    { label: "Mar-26", sheet: "FG-March-26" },
    { label: "Apr-26", sheet: "FG-April-26" },
    { label: "May-26", sheet: "FG-May-26" },
    { label: "Jun-26", sheet: "FG-Jun-26" },
    { label: "Jul-26", sheet: "FG-July-26" },
    { label: "Aug-26", sheet: "FG-August-26" }
  ];

  var source = SpreadsheetApp.openById(SOURCE_SPREADSHEET_ID);
  var rows = [];
  var bySku = {};

  months.forEach(function(month) {
    var sheet = source.getSheetByName(month.sheet);
    if (!sheet) return;

    var values = sheet.getDataRange().getDisplayValues();
    if (values.length < 2) return;

    var header = values[0].map(normalizeHeaderForSkuPacksize_);
    var idx = {
      sku: header.indexOf("sku"),
      name: header.indexOf("itemname"),
      pack: header.indexOf("packsize"),
      vendor: header.indexOf("vendorname")
    };
    if (idx.sku < 0 || idx.name < 0 || idx.pack < 0 || idx.vendor < 0) return;

    values.slice(1).forEach(function(row) {
      var sku = cleanSkuPacksizeValue_(row[idx.sku]);
      var pack = cleanSkuPacksizeValue_(row[idx.pack]);
      if (!sku || !pack || pack === "-") return;

      var record = {
        month: month.label,
        sku: sku,
        name: cleanSkuPacksizeValue_(row[idx.name]),
        pack: pack,
        vendor: cleanSkuPacksizeValue_(row[idx.vendor])
      };
      rows.push(record);

      if (!bySku[sku]) bySku[sku] = {};
      bySku[sku][pack] = true;
    });
  });

  var output = rows.filter(function(record) {
    return Object.keys(bySku[record.sku] || {}).length > 1;
  }).sort(function(a, b) {
    return (a.sku + a.month + a.pack + a.vendor).localeCompare(b.sku + b.month + b.pack + b.vendor);
  });

  var active = SpreadsheetApp.openById(OUTPUT_SPREADSHEET_ID);
  var outSheet = active.getSheetByName(OUTPUT_SHEET_NAME) || active.insertSheet(OUTPUT_SHEET_NAME);
  outSheet.clearContents();
  var table = [["Inward Month", "SKU code", "SKU Name", "Pack size", "Vendor Name"]];
  output.forEach(function(record) {
    table.push([record.month, record.sku, record.name, record.pack, record.vendor]);
  });
  outSheet.getRange(1, 1, table.length, table[0].length).setValues(table);
  outSheet.setFrozenRows(1);
  outSheet.autoResizeColumns(1, table[0].length);

  return {
    outputSheet: OUTPUT_SHEET_NAME,
    rows: output.length,
    skuCount: Object.keys(bySku).filter(function(sku) {
      return Object.keys(bySku[sku] || {}).length > 1;
    }).length
  };
}

function normalizeHeaderForSkuPacksize_(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanSkuPacksizeValue_(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}
