import fs from "node:fs";
import readline from "node:readline";
const names = ["Copy of Putaway All facility_13102026183839.csv", "Copy of Putaway All facility_14102026110829.csv", "Copy of Putaway All facility_14102026110846.csv", "Copy of Putaway All facility_14102026110904.csv", "Copy of Putaway All facility_14102026110918.csv", "Gatepass to Putaway_14102026110641.csv"];
function parse(text) {
  const cells = []; let cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (text[i] === ',' && !quoted) { cells.push(cell); cell = ""; } else cell += text[i];
  }
  return quoted ? null : cells.concat(cell);
}
for (const name of names) {
  const path = `C:/Users/Mosaic/Downloads/${name}`;
  const stats = fs.statSync(path);
  let headers; let rows = 0; let pending = ""; let invalid = 0;
  const facilities = {}, types = {}; let earliest = "", latest = "";
  for await (const line of readline.createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity })) {
    pending += (pending ? "\n" : "") + line;
    const cells = parse(pending); if (!cells) continue; pending = "";
    if (!headers) { headers = cells; continue; }
    if (!cells.some(value => value.trim())) continue;
    rows++; if (cells.length !== headers.length) { invalid++; continue; }
    const facility = cells[headers.indexOf("Facility Name")] || cells[headers.indexOf("Facility")] || "NO_FACILITY_COLUMN";
    const type = cells[headers.indexOf("Type")] || "";
    facilities[facility] = (facilities[facility] || 0) + 1; types[type] = (types[type] || 0) + 1;
    const time = cells[headers.indexOf("Updated")] || cells[headers.indexOf("Last Updated")] || "";
    if (time && (!earliest || time < earliest)) earliest = time;
    if (time && time > latest) latest = time;
  }
  console.log(JSON.stringify({ name, bytes: stats.size, rows, invalid, incompleteQuotedRecord: !!pending, missingKpiColumns: ["SKU Code", "GRN Number", "Last Updated"].filter(column => !headers.includes(column)), facilityCount: Object.keys(facilities).length, grnPutawayRows: types.PUTAWAY_GRN_ITEM || 0, earliestUpdated: earliest, latestUpdated: latest }));
}
