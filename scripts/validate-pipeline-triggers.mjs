import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let triggers = [], nextId = 0, failHour = null, locked = false;
const context = vm.createContext({ console, Set, Number,
  LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; }, releaseLock() { locked = false; } }) },
  ScriptApp: {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: trigger => { triggers = triggers.filter(item => item !== trigger); },
    newTrigger(handler) {
      const spec = { id: ++nextId, handler, getHandlerFunction: () => handler };
      const builder = { timeBased() { return this; }, everyDays(value) { spec.days = value; return this; },
        atHour(value) { spec.hour = value; return this; }, nearMinute(value) { spec.minute = value; return this; },
        inTimezone(value) { spec.timeZone = value; return this; }, create() {
          if (spec.hour === failHour) throw new Error("simulated quota error");
          triggers.push(spec); return spec;
        } };
      return builder;
    },
  },
});
vm.runInContext(fs.readFileSync(new URL("../apps-script/Pipeline.gs", import.meta.url), "utf8"), context);
context.installInwardTatRecoveryTrigger = () => ({ hour: 10 });
triggers.push({ handler: "reminder", getHandlerFunction: () => "reminder" });
context.installInwardTatTrigger(8);
const result = context.installDailyInwardTatPipelineTrigger();
assert.deepEqual(Array.from(result.hours), [8, 12, 16]);
const scheduled = () => triggers.filter(trigger => trigger.handler === "runInwardTatPipeline");
assert.deepEqual(scheduled().map(trigger => trigger.hour), [8, 12, 16]);
for (const trigger of scheduled()) assert.deepEqual([trigger.days, trigger.minute, trigger.timeZone], [1, 30, "Asia/Kolkata"]);
context.installDailyInwardTatPipelineTrigger();
assert.equal(scheduled().length, 3);
assert.equal(triggers.filter(trigger => trigger.handler === "reminder").length, 1);
const before = triggers.slice();
failHour = 12;
assert.throws(() => context.installDailyInwardTatPipelineTrigger(), /quota/);
assert.deepEqual(triggers, before);
assert.equal(locked, false);
assert.throws(() => context.installInwardTatTrigger(24), /whole numbers/);
assert.deepEqual(triggers, before);
console.log("Daily pipeline schedule validated: 08:30, 12:30, 16:30 IST; idempotent installation, unrelated triggers preserved, creation-failure rollback.");
