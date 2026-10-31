import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
process.env.TZ = 'Asia/Kolkata';
const month = '2026-10', date = new Date('2026-10-30T07:00:00Z');
const user = {email:'owner@example.com'};
const config = {MONTHLY_WORKFLOW_ENABLED:'TRUE',MONTHLY_ARCHIVE_FOLDER_ID:'archive',LAST_SUCCESSFUL_REFRESH:'2026-10-31T05:00:00Z'};
const names = {FACT:'Fact',RAW_GOODS:'Goods',RAW_GRN:'GRN',RAW_PUTAWAY:'Putaway',MANUAL_TASKS:'Actions'};
const factHeaders = Array.from({length:29}, (_,i)=>'Header'+i);
function fact(key, status, bucket) {
  const row = Array(29).fill(''); Object.assign(row,{0:key,1:'SL Mother Hub',2:'SKU1',3:key.split('|')[1],4:date,5:new Date(date.getTime()+3600000),
    6:new Date(date.getTime()+15*3600000),7:1,8:14,9:15,13:status,16:2,17:2,18:2,19:new Date('2026-10-31T05:00:00Z'),27:bucket,28:'Saved remark'});
  if(status==='MANUALLY_CLOSED') {row[22]='MANUALLY_CLOSED';row[23]=user.email;row[24]=date;row[25]='Reviewed duplicate';}
  return row;
}
const f1=fact('SL Mother Hub|G1|SKU1','COMPLETE','Invoice issue');
const f2=fact('SL Mother Hub|G2|SKU1','MANUALLY_CLOSED','WH delay');
const sheets = new Map();
function sheet(name, headers, rows) {
  const data=[headers,...rows]; const s={getName:()=>name,getLastColumn:()=>headers.length,getLastRow:()=>data.length,
    getRange:(r,c,n,w)=>({getValues:()=>data.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w))})};
  sheets.set(name,s); return data;
}
const factData=sheet('Fact',factHeaders,[f1,f2]);
sheet('Goods',['Source Spreadsheet Id','Source Sheet','Source Row','SKU','GRN no.','Received at','Invoice number','Unloading Date','Unloading Time','No. of Boxes Recd'],
  [['receiving-book','FG-Oct-26',2,'SKU1','G1','SL Mother Hub','INV1','2026-10-30','12:30:00',10]]);
sheet('GRN',['GRN Code','Item SkuCode','Facility','GRN Received Timestamp'],[['G1','SKU1','SL Mother Hub',new Date(date.getTime()+3600000)]]);
sheet('Putaway',['GRN Number','SKU Code','Facility','Last Updated'],[['G1','SKU1','SL Mother Hub',new Date(date.getTime()+15*3600000)]]);
sheet('Actions',['Record Key','Action Type','Action By','Action At','Reason'],[[f2[0],'CLOSE',user.email,date,'Reviewed duplicate']]);
const files=new Map(), props=new Map([['INWARD_TAT_MONTHLY_STATE_'+month,'seed']]);
const previous=f1.slice();previous[13]='INCOMPLETE';
files.set('seed',{text:JSON.stringify({schemaVersion:1,month,revision:1,status:'PROVISIONAL',records:[],sources:[],calculations:{facts:[previous],summary:{},daily:[],facilities:[],sourceExceptions:[]}})});
let number=0, corrupt=false, busy=false;
const context=vm.createContext({console:{log(){}},Date,Map,Set,Number,String,Array,JSON,Math,
  INWARD_TAT:{SHEETS:names},SHEET_DEFINITIONS:[{name:'Fact',headers:factHeaders}],
  getConfig_:()=>config,isManualTaskUser_:email=>email===user.email,
  openInwardTatSpreadsheet_:()=>({getId:()=> 'daily-book',getSheetByName:name=>sheets.get(name)}),
  LockService:{getScriptLock:()=>({tryLock:()=>!busy,releaseLock(){}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)})},
  Utilities:{formatDate:(d,_,format)=>{const iso=new Date(d.getTime()+330*60000).toISOString();return format==='HH:mm:ss'?iso.slice(11,19):iso.slice(0,10)},
    getUuid:()=>String(number+1),newBlob:(text,type,name)=>({text,name}),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
    computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()]},
});
for(const file of ['Pipeline.gs','MonthlyClosure.gs','MonthlyIngestion.gs','MonthlyReport.gs','ExceptionHandling.gs','MonthlyDailySync.gs','MonthlyBackfillBatch.gs'])
  vm.runInContext(fs.readFileSync(new URL('../apps-script/'+file,import.meta.url),'utf8'),context);
context.getConfig_=()=>config;
context.monthlyDrive_=()=>({getFileById:id=>({getBlob:()=>({getDataAsString:()=>files.get(id).text})}),getFolderById:()=>({createFile:blob=>{
  const id='file'+(++number);files.set(id,{text:corrupt&&blob.name.includes('-revision-')?'corrupt':blob.text,name:blob.name});
  return {getId:()=>id,getBlob:()=>({getDataAsString:()=>files.get(id).text})};
}})});
const request={month,apply:'false'};
assert.throws(()=>context.syncMonthlyDaily_(request,{email:'other@example.com'}),/authorised/);
busy=true;assert.throws(()=>context.syncMonthlyDaily_(request,user),/running/);busy=false;
const preview=context.syncMonthlyDaily_(request,user);
assert.equal(preview.sync.transactions,2);assert.equal(preview.sync.becameComplete,1);assert.equal(preview.sync.manuallyClosed,1);
assert.equal(number,0);assert.equal(props.get('INWARD_TAT_MONTHLY_STATE_'+month),'seed');
const apply={month,apply:'true',expectedRevision:String(preview.revision),captureHash:preview.captureHash};
factData[1][28]='Changed after preview';assert.throws(()=>context.syncMonthlyDaily_(apply,user),/changed after preview/);factData[1][28]='Saved remark';
corrupt=true;assert.throws(()=>context.syncMonthlyDaily_(apply,user),/verification failed/);assert.equal(props.get('INWARD_TAT_MONTHLY_STATE_'+month),'seed');corrupt=false;
const saved=context.syncMonthlyDaily_(apply,user);assert.equal(saved.revision,2);
const state=context.readMonthlyState_(month);
assert.equal(state.calculations.summary.completeRecords,1);assert.equal(state.calculations.summary.manuallyClosedRecords,1);assert.equal(state.calculations.summary.pendingRecords,0);
assert.equal(state.calculations.summary.excludingExceptions.records,0);
const model=context.monthlyReportModel_(state,config);
assert.equal(model.headers.length,model.details[0].length);assert.equal(model.details[0][26],'Saved remark');
assert.equal(model.details[1][27],'MANUALLY_CLOSED');assert.equal(model.totalBoxes,10);
const legacyGoods = {key:JSON.stringify(['GOODS_INWARD','receiving-book:123','ROW',2]),sourceId:'old',extractedAt:'2026-10-30T00:00:00Z',
  values:{_sourceType:'GOODS_INWARD','Received at':'SL Mother Hub',SKU:'SKU1','GRN no.':'G1','Unloading Date':'2026-10-30','Unloading Time':'12:30:00','No. of Boxes Recd':99}};
const volumeState = {...state,records:state.records.concat([legacyGoods]),sources:state.sources.concat([{type:'GOODS_INWARD',sheetId:'receiving-book:123',filename:'FG-Oct-26'}])};
assert.equal(context.monthlyReportModel_(volumeState,config).totalBoxes,10); // Daily correction replaces source volume, never doubles it.
assert.equal(context.monthlyReportPreview_(state,config).pending.length,0);
assert.ok(files.get(state.lastDailySync.fileId).text.includes('Reviewed duplicate'));
const again=context.syncMonthlyDaily_({month,apply:'false'},user);assert.equal(again.duplicate,true);
const capture=context.monthlyDailyCapture_(month,config);const retained=context.monthlyDailyMerge_({...state,records:state.records.concat([{key:'unrelated',sourceId:'old',extractedAt:date.toISOString(),values:{_sourceType:'GRN'}}])},capture,'new',new Date().toISOString());
assert.ok(retained.records.some(r=>r.key==='unrelated'));
const wh=state.calculations.facts[0].slice();wh[27]='WH delay';
const overlay=context.monthlyDailyFactOverlay_([{key:'d',sourceId:'s',extractedAt:date.toISOString(),values:{_sourceType:'DAILY_FACT',fact:wh}}],[],month);
assert.equal(overlay[0][26],'N');
console.log('Daily-to-monthly sync validated: read-only preview, authorisation/locks, stale preview rejection, failed-write recovery, provenance, remarks, manual closure, exception rules and idempotency.');
