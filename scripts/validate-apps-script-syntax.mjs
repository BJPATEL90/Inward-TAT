import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const directory = new URL("../apps-script/", import.meta.url);
const files = fs.readdirSync(directory).filter((name) => name.endsWith(".gs"));
for (const file of files) {
  const source = fs.readFileSync(new URL(file, directory), "utf8");
  new vm.Script(source, { filename: path.join("apps-script", file) });
}
console.log(`Apps Script syntax validated (${files.length} files)`);
