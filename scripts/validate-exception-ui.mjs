import assert from "node:assert/strict";
import { createServer } from "vite";
import { fallbackSnapshot } from "../src/data.js";
const { chromium } = await import("file:///C:/Users/Mosaic/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
process.env.VITE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/exception-local-test/exec";
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 5189, strictPort: true } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [], calls = [];
  let canManage = true, failSave = false;
  let fixtures = [
    ["G1", "SL Ambient", 20, "COMPLETE", "", ""],
    ["G2", "SL Ambient", 40, "COMPLETE", "Other", "Saved delay"],
    ["G3", "SL Ambient", 12, "COMPLETE", "", ""],
    ["G4", "OWN", 8, "COMPLETE", "", ""],
    ["G5", "OWN", null, "INCOMPLETE", "", ""],
    ["G6", "OWN", 15, "INCOMPLETE", "", ""],
  ].map(([grnNumber, facility, kpi1Hours, status, exceptionBucket, exceptionRemarks]) => ({
    recordKey: `${facility}|${grnNumber}|S1`, facility, grnNumber, sku: "S1", kpi1Hours,
    kpi2Hours: kpi1Hours == null ? null : kpi1Hours - 4, kpi3Hours: kpi1Hours == null ? null : 4,
    status, exceptionBucket, exceptionRemarks, unloadingDate: "2026-10-01", exceptionCode: "",
  }));
  await page.addInitScript(() => sessionStorage.setItem("inwardTatGoogleSession", JSON.stringify({ credential: "test-token", user: { email: "owner@mosaicwellness.in", name: "Test owner" } })));
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://script.google.com/**", async route => {
    const parameters = new URLSearchParams(route.request().postData());
    const action = parameters.get("action"); calls.push({ action, parameters });
    let response;
    if (action === "authVerify") response = { ok: true, user: { email: "owner@mosaicwellness.in", name: "Test owner" } };
    else if (action === "saveexception") {
      const row = fixtures.find(row => row.recordKey === parameters.get("recordKey"));
      if (failSave) response = { ok: false, error: "This exception was changed by another user. Refresh before saving." };
      else {
        assert.equal(parameters.get("expectedBucket"), row.exceptionBucket);
        assert.equal(parameters.get("expectedRemarks"), row.exceptionRemarks);
        row.exceptionBucket = parameters.get("exceptionBucket").trim();
        row.exceptionRemarks = parameters.get("exceptionRemarks").trim();
        response = { ok: true, recordKey: row.recordKey, exceptionFlag: row.exceptionBucket || row.exceptionRemarks ? "Y" : "N", exceptionBucket: row.exceptionBucket, exceptionRemarks: row.exceptionRemarks };
      }
    } else {
      const month = parameters.get("month") || "2026-10";
      response = { ...fallbackSnapshot, ok: true, generatedAt: "2026-10-16T06:00:00Z", lastRefresh: "2026-10-16T06:00:00Z",
        view: { month, periodStart: `${month}-01`, periodEnd: `${month}-01`, isCurrentMonth: month === "2026-10" },
        availableMonths: ["2026-10", "2026-09"], permissions: { canManageExceptions: canManage },
        facts: fixtures.map(row => ({ ...row, unloadingDate: `${month}-01`, unloadingTimestamp: `${month}-01T11:16:00+05:30` })),
        daily: [{ summaryDate: `${month}-01`, facility: "All Mother Facilities", kpi1Hours: 20 }],
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response), headers: { "access-control-allow-origin": "*" } });
  });
  await page.goto("http://127.0.0.1:5189");
  await page.getByRole("button", { name: "Exception Handling", exact: true }).click();
  const inclusive = page.getByTestId("including-exceptions"), adjusted = page.getByTestId("excluding-exceptions");
  await inclusive.getByText("20h 00m", { exact: true }).waitFor();
  assert.match(await adjusted.innerText(), /13h 20m/);
  assert.equal(await page.locator(".exception-transactions tbody tr").count(), 3);
  assert.equal(await page.getByTestId("delayed-count").locator("dd").innerText(), "3");
  assert.equal(await page.getByTestId("validated-count").locator("dd").innerText(), "1");
  assert.equal(await page.getByTestId("pending-validation-count").locator("dd").innerText(), "2");
  assert.equal(await page.locator(".exception-transactions tbody tr").first().locator("time").innerText(), "01-10-2026");
  assert.equal(await page.getByRole("button", { name: "Download CSV", exact: true }).count(), 1);
  const downloadCsv = async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV", exact: true }).click();
    const download = await pending;
    const stream = await download.createReadStream();
    const buffers = []; for await (const buffer of stream) buffers.push(buffer);
    return { text: Buffer.concat(buffers).toString("utf8"), filename: download.suggestedFilename() };
  };
  const row = page.getByRole("row").filter({ has: page.getByRole("rowheader").filter({ hasText: "G1" }) });
  const bucket = row.getByRole("combobox"), remarks = row.getByRole("textbox");
  const save = row.getByRole("button", { name: "Save", exact: true });
  assert.equal(await save.isDisabled(), true);
  await bucket.selectOption("Manpower issue");
  assert.match(await adjusted.innerText(), /13h 20m/); // Draft is not counted.
  const draftExport = await downloadCsv();
  assert.equal(draftExport.text.includes("Manpower issue"), false);
  assert.equal(draftExport.text.trimEnd().split("\r\n").length - 1, 3);
  assert.ok(draftExport.text.includes('"Exception (Y/N)","Exception Bucket","Remarks"'));
  await page.getByLabel("Transaction view", { exact: true }).selectOption("EXCLUDING");
  await save.click();
  await adjusted.getByText("10h 00m", { exact: true }).waitFor();
  assert.equal(await row.count(), 0); // Saved Y disappears immediately from the N-only view.
  await page.getByLabel("Transaction view", { exact: true }).selectOption("INCLUDING");
  assert.match(await inclusive.innerText(), /20h 00m/);
  assert.match(await adjusted.innerText(), /6h 00m/);
  assert.match(await adjusted.innerText(), /KPI transaction count: 2/);
  assert.match(await inclusive.innerText(), /KPI transaction count: 4/);
  assert.equal(await page.getByTestId("pending-validation-count").locator("dd").innerText(), "1");
  assert.equal(await page.getByTestId("validated-count").locator("dd").innerText(), "2");
  await row.getByText("Excluded from adjusted KPIs", { exact: true }).waitFor();
  await page.getByLabel("Transaction view", { exact: true }).selectOption("EXCLUDING");
  assert.equal(await page.locator(".exception-transactions tbody tr").count(), 1);
  assert.match(await adjusted.innerText(), /10h 00m/); // Table view must not change card scope.
  const onlyN = await downloadCsv();
  assert.equal(onlyN.text.includes('"G1"'), false);
  assert.equal(onlyN.text.includes('"G6"'), true);
  await page.getByLabel("Transaction view", { exact: true }).selectOption("ONLY");
  assert.equal(await page.locator(".exception-transactions tbody tr").count(), 2);
  const onlyY = await downloadCsv();
  assert.equal(onlyY.text.trimEnd().split("\r\n").length - 1, 2);
  assert.ok(onlyY.filename.endsWith("-only.csv"));
  await page.getByLabel("Transaction view", { exact: true }).selectOption("INCLUDING");
  await bucket.selectOption("");
  await save.click();
  await adjusted.getByText("13h 20m", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("pending-validation-count").locator("dd").innerText(), "2");
  await remarks.fill("   "); await save.click();
  await page.waitForFunction(() => !document.querySelector(".exception-transactions textarea")?.value);
  assert.match(await adjusted.innerText(), /13h 20m/);
  await remarks.fill("Remarks-only exception"); await save.click();
  await adjusted.getByText("10h 00m", { exact: true }).waitFor();
  failSave = true;
  await remarks.fill("Keep this draft"); await save.click();
  await row.getByRole("alert").getByText("This exception was changed", { exact: false }).waitFor();
  assert.equal(await remarks.inputValue(), "Keep this draft");
  assert.match(await adjusted.innerText(), /10h 00m/);
  failSave = false;
  await row.getByRole("button", { name: "Reset to saved" }).click();
  assert.equal(await remarks.inputValue(), "Remarks-only exception");
  await page.getByLabel("Search transactions").fill("G1");
  assert.equal(await adjusted.locator(".primary-duration").innerText(), "—");
  assert.match(await inclusive.innerText(), /20h 00m/);
  await page.getByLabel("Search transactions").fill("");
  await page.getByLabel("Facility", { exact: true }).selectOption("OWN");
  assert.match(await inclusive.innerText(), /8h 00m/);
  assert.equal(await page.locator(".exception-transactions tbody tr").count(), 1);
  const ownDelayed = await downloadCsv();
  assert.equal(ownDelayed.text.trimEnd().split("\r\n").length - 1, 1);
  assert.ok(ownDelayed.text.includes('"G6"'));
  assert.equal(ownDelayed.text.includes('"G4"'), false);
  await page.getByLabel("CSV scope", { exact: true }).selectOption("ALL");
  const ownAll = await downloadCsv();
  assert.equal(ownAll.text.trimEnd().split("\r\n").length - 1, 3);
  assert.ok(ownAll.text.includes('"G4"'));
  assert.ok(ownAll.filename.endsWith("OWN-all-filtered-including.csv"));
  await page.getByLabel("CSV scope", { exact: true }).selectOption("DELAYED");
  await page.getByLabel("Search transactions").fill("missing");
  await page.getByText("No transactions with KPI1 greater than 12 hours", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Download CSV", exact: true }).isDisabled(), true);
  await page.getByLabel("Search transactions").fill("");
  await page.getByLabel("Facility", { exact: true }).selectOption("All facilities");
  await page.getByLabel("Status", { exact: true }).selectOption("INCOMPLETE");
  assert.equal(await inclusive.locator(".primary-duration").innerText(), "—");
  await page.getByLabel("Status", { exact: true }).selectOption("All status");
  await page.getByLabel("Performance month", { exact: true }).selectOption("2026-09");
  await page.waitForFunction(() => document.querySelector('.exception-page input[type="date"]')?.value === "2026-09-01");
  assert.equal(await page.locator(".exception-page").count(), 1);
  await page.getByLabel("To", { exact: true }).fill("2026-09-02");
  await page.getByLabel("From", { exact: true }).fill("2026-09-02");
  await page.getByText("No transactions with KPI1 greater than 12 hours", { exact: false }).waitFor();
  await page.getByLabel("From", { exact: true }).fill("2026-09-01");
  await page.screenshot({ path: "work/exception-handling-desktop.png", fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector(".sidebar").getBoundingClientRect().right <= 0);
  await page.screenshot({ path: "work/exception-handling-mobile.png", fullPage: true, animations: "disabled" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  canManage = false;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.getByText("Read-only access.", { exact: false }).waitFor();
  assert.equal(await page.locator(".exception-transactions tbody select:enabled").count(), 0);
  assert.equal(await page.locator(".exception-transactions textarea:enabled").count(), 0);
  const saved = fixtures[0];
  assert.equal(saved.exceptionRemarks, "Remarks-only exception");
  fixtures = fixtures.concat(Array.from({ length: 55 }, (_, index) => ({ ...saved, recordKey: `SL Ambient|P${index}|S1`, grnNumber: `P${index}` })));
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await page.getByText("58 matching transactions", { exact: true }).waitFor();
  assert.equal(await page.locator(".exception-transactions tbody tr").count(), 50);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  assert.equal(await page.locator(".exception-transactions tbody tr").count(), 8);
  assert.equal(await page.getByTestId("delayed-count").locator("dd").innerText(), "58");
  assert.equal(await page.getByTestId("validated-count").locator("dd").innerText(), "57");
  assert.equal(await page.getByTestId("pending-validation-count").locator("dd").innerText(), "1");
  const paginated = await downloadCsv();
  assert.equal(paginated.text.trimEnd().split("\r\n").length - 1, 58);
  assert.ok(paginated.text.includes("Remarks-only exception"));
  assert.ok(paginated.filename.includes("2026-09-2026-09-01_to_2026-09-02"));
  // Shared filters persist when moving back to the original dashboard.
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Download CSV", exact: true }).waitFor();
  assert.equal(await page.locator(".month-view-toolbar select").inputValue(), "2026-09");
  assert.equal(calls.filter(call => call.action === "saveexception").length, 5);
  assert.deepEqual(errors, []);
  console.log("Exception UI validated: saved-only inclusive/adjusted KPIs, >12 table, buckets/remarks, clearing, failed saves, shared filters/month, read-only access and mobile layout.");
} finally {
  await browser?.close(); await server.close();
}
