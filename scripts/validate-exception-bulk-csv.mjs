import assert from "node:assert/strict";
import { parseExceptionBulkCsv, bulkExceptionTemplate } from "../src/exception-bulk.mjs";
const header = "Record Key,Exception Bucket,Remarks\r\n";
const rows = parseExceptionBulkCsv('\uFEFF' + header + '"OWN|G1|S1","WH delay","Delay, see ""note""\r\nGujarati ગુજરાતી"\r\n');
assert.equal(rows[0].exceptionBucket, "WH delay");
assert.equal(rows[0].exceptionRemarks, 'Delay, see "note"\r\nGujarati ગુજરાતી');
assert.deepEqual(parseExceptionBulkCsv(bulkExceptionTemplate([{ recordKey: "OWN|G1|S1", exceptionBucket: "", exceptionRemarks: "" }])),
  [{ recordKey: "OWN|G1|S1", exceptionBucket: "", exceptionRemarks: "" }]);
for (const bad of ["", header, "Key,Bucket,Remarks\na,b,c", header + '"unclosed,b,c', header + '"closed"extra,b,c', header + 'a,b,c,d', header + '"a\0",b,c']) assert.throws(() => parseExceptionBulkCsv(bad));
assert.throws(() => parseExceptionBulkCsv(header + "K,B,R\n".repeat(1001)), /1,000/);
assert.throws(() => parseExceptionBulkCsv("x".repeat(2000001)), /2 MB/);
assert.equal(parseExceptionBulkCsv(header + 'K,,\n')[0].exceptionRemarks, "");
console.log("Bulk exception CSV validated: exact three-column schema, BOM, multiline/quoted Unicode, blank clearing, binary/size/row limits and malformed inputs.");
