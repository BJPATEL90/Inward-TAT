import assert from "node:assert/strict";
import { createServer } from "vite";
import { fallbackSnapshot } from "../src/data.js";
const { chromium } = await import("file:///C:/Users/Mosaic/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
process.env.VITE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/monthly-local-test/exec";
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 5188, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => sessionStorage.setItem("inwardTatGoogleSession", JSON.stringify({ credential: "test-only-token", user: { email: "owner@mosaicwellness.in", name: "Test user" } })));
  const calls = [];
  let revision = 1;
  await page.route("https://script.google.com/**", async route => {
    const parameters = new URLSearchParams(route.request().postData());
    const action = parameters.get("action"); calls.push({ action, parameters });
    let response;
    if (action === "authVerify") response = { ok: true, user: { email: "owner@mosaicwellness.in", name: "Test user" } };
    else if (action === "dashboard") response = { ...fallbackSnapshot, ok: true };
    else if (action === "monthlyDailySync") {
      const apply = parameters.get("apply") === "true";
      if (apply) { assert.equal(parameters.get("captureHash"), "verified-preview"); assert.equal(parameters.get("expectedRevision"), String(revision)); revision++; }
      response = { ok: true, preview: !apply, revision, captureHash: "verified-preview", sync: {
        transactions: 773, added: 0, changed: 53, unchanged: 720, becameComplete: 50, becamePending: 0, manuallyClosed: 3,
      } };
    }
    else if (action === "monthlyReport") response = { ok: true, filename: `Inward_TAT_MIS_2026-09_r${revision}_PROVISIONAL.xlsx`, fileId: "archive", revision, status: "PROVISIONAL", base64: "UEsDBAE=", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    else if (action === "monthlyInbox") response = { ok: true, nextOffset: null, receivedFrom: "2026-10-07", receivedThrough: "2026-10-15", emails: [
      { messageId: "b456", type: "PUTAWAY", exportJob: "Copy of Putaway All facility", facility: "ALL", receivedAt: "2026-10-14T05:39:19Z", processable: false, issue: "This export has no GRN Number." },
      { messageId: "a123", type: "GRN", exportJob: "GRN", facility: "ALL", receivedAt: "2026-10-14T05:30:00Z", processable: true },
      { messageId: "c789", type: "PUTAWAY", exportJob: "GRN/Gatepass to Putaway", facility: "ALL", receivedAt: "2026-10-14T05:31:00Z", processable: true } ] };
    else {
      if (action === "monthlyUpload" || action === "monthlyEmailImport") revision++;
      response = { ok: true, month: parameters.get("month"), revision, status: "PROVISIONAL", updatedAt: "2026-10-13T03:00:00Z",
        summary: { eligibleRecords: 100, completeRecords: 98, pendingRecords: 2, excludedRecords: 7, kpi1Hours: 21.29, kpi2Hours: 12.32, kpi3Hours: 8.97 },
        sourceExceptionCount: 1, totalBoxes: 2000, missingBoxValues: 0,
        sources: [{ type: "GRN", facility: "ALL", completeMonthCoverage: true, extractedAt: "2026-10-01T02:30:00Z", acceptedRows: 100, fileId: "source" }],
        daily: [{ date: "2026-09-30", records: 10, completeRecords: 8, pendingRecords: 2, kpi1Hours: 20, kpi2Hours: 12, kpi3Hours: 8, boxes: 200, progress: "Activity captured" }],
        facilities: [{ facility: "SL Mother Hub", eligibleRecords: 100, completeRecords: 98, pendingRecords: 2, kpi1Hours: 21.29, kpi2Hours: 12.32, kpi3Hours: 8.97 }],
        pending: [{ key: "K1", facility: "SL Mother Hub", grn: "G1", sku: "SKU1", stage: "NO_PUTAWAY_MATCH", owner: "Unassigned", ageingHours: 72 }],
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response), headers: { "access-control-allow-origin": "*" } });
  });
  await page.goto("http://127.0.0.1:5188");
  await page.getByRole("button", { name: "Monthly MIS", exact: true }).click();
  await page.getByLabel("Reporting month").fill("2026-09");
  await page.getByRole("button", { name: "Download Monthly MIS (.xlsx)", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".monthly-mis")?.getAttribute("aria-busy") || document.querySelector(".monthly-mis")?.getAttribute("aria-busy") === "false");
  assert.equal(await page.getByRole("button", { name: "Download CSV", exact: true }).count(), 0);
  await page.getByLabel("Reporting month").blur();
  await page.screenshot({ path: "work/monthly-mis-desktop.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Refresh Data", exact: true }).click();
  await page.getByText("Unloading refreshed and stored reports recalculated.", { exact: false }).waitFor();
  assert.ok(calls.some(call => call.action === "monthlyRefresh" && call.parameters.get("month") === "2026-09"));
  await page.getByLabel("Import method").selectOption("FILE");
  assert.equal(await page.getByLabel("Facility for this file").inputValue(), "");
  await page.getByLabel("Facility for this file").selectOption("ALL");
  await page.getByLabel("Export generated at (IST)").fill("2026-10-01T08:00");
  await page.getByLabel("CSV file", { exact: true }).setInputFiles({ name: "closing.csv", mimeType: "text/csv", buffer: Buffer.from("Facility,GRN Code,Item SkuCode,GRN Received Timestamp,Batch Code,Vendor Batch Number\nOWN,G1,SKU1,2026-09-30 23:00:00,B1,V1\n") });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Upload and Recalculate" }).click();
  await page.getByText("Imported revision 2.", { exact: false }).waitFor();
  const source = JSON.parse(calls.find(call => call.action === "monthlyUpload").parameters.get("source"));
  assert.equal(source.month, "2026-09");
  assert.equal(source.periodStart, "2026-09-01T00:00:00+05:30");
  assert.equal(source.periodEndExclusive, "2026-10-01T00:00:00+05:30");
  await page.getByLabel("Import method").selectOption("EMAIL");
  await page.getByRole("button", { name: "Find Export Emails" }).click();
  await page.getByText("3 export emails found on this page.", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("Export generated at (IST)").count(), 0);
  await page.getByRole("combobox", { name: /^Export email/ }).selectOption("b456");
  assert.equal(await page.getByRole("button", { name: "Fetch and Process" }).isDisabled(), true);
  await page.getByText("This export has no GRN Number.").waitFor();
  await page.getByRole("combobox", { name: /^Export email/ }).selectOption("c789");
  assert.equal(await page.getByRole("button", { name: "Fetch and Process" }).isDisabled(), true);
  await page.getByLabel("Facility for this email export").selectOption("OWN");
  assert.equal(await page.getByRole("button", { name: "Fetch and Process" }).isEnabled(), true);
  await page.getByRole("combobox", { name: /^Export email/ }).selectOption("a123");
  await page.getByRole("button", { name: "Fetch and Process" }).click();
  await page.getByText("Imported revision 3.", { exact: false }).waitFor();
  const emailSource = JSON.parse(calls.find(call => call.action === "monthlyEmailImport").parameters.get("source"));
  assert.equal(emailSource.messageId, "a123");
  assert.equal(emailSource.facility, undefined);
  assert.equal(emailSource.type, undefined);
  assert.equal(emailSource.simple, true);
  assert.equal(emailSource.content, undefined); // Export is downloaded server-side, not sent by the browser.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Monthly MIS (.xlsx)", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "Inward_TAT_MIS_2026-09_r3_PROVISIONAL.xlsx");
  await page.getByRole("button", { name: "Sync from Daily Data", exact: true }).click();
  await page.getByText("Daily sync preview for 2026-09", { exact: true }).waitFor();
  assert.equal(revision, 3);
  await page.getByRole("button", { name: "Cancel sync", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Apply daily sync", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Sync from Daily Data", exact: true }).click();
  await page.getByRole("button", { name: "Apply daily sync", exact: true }).click();
  await page.getByText("Daily sync saved as revision 4.", { exact: false }).waitFor();
  assert.equal(revision, 4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "work/monthly-mis-mobile.png", fullPage: true, animations: "disabled" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Download CSV", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Refresh data", exact: true }).count(), 1);
  console.log("Monthly UI validated: month selection, refresh, upload metadata, revision reload, XLSX download, desktop/mobile layout and no browser exceptions.");
} finally {
  await browser?.close();
  await server.close();
}
