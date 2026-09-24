const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map(),handlers={};
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',dataset:{},style:{},hidden:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){},querySelector(){return null},querySelectorAll(){return []},addEventListener(k,f){handlers[id+':'+k]=f;},show(){this.open=true},showModal(){this.open=true},close(){this.open=false}});return nodes.get(id);}
const context=vm.createContext({console,URLSearchParams,location:{hash:''},confirm:()=>true,setTimeout:()=>0,clearTimeout(){},window:{addEventListener(){}},document:{getElementById:node,documentElement:{dataset:{}},querySelectorAll(){return []},addEventListener(k,f){handlers[k]=f;}}});
let code=fs.readFileSync(__dirname+'/../web/app.js','utf8');vm.runInContext(code.slice(0,code.lastIndexOf('boot().then(')),context);
vm.runInContext(`db={version:UI_VERSION,settings:{layout:'list',columns:['image','inv','model','colors','editions','os','actions'],options:{},views:[],custom_fields:[]},trash:[],repairs:[],catalog:[{id:'room',category:'location',name:'Room',specs:{},description:''},{id:'box',category:'location',parent_id:'room',name:'Box 1',specs:{},description:''},{id:'bat',category:'battery',name:'BL-4D',specs:{Capacity:'1200 mAh'},description:'',compatible:['a']}],records:[{id:'a',rev:3,kind:'phone',brand:'Nokia',model:'N73',alias:'N73-1',os:'Symbian',instances:[{id:'u1',inv:'1',color:'Silver',edition:'Standard',condition:'U kolekciji',imei:'12345',location:'Box 1',box:false,photos:[]},{id:'u2',inv:'2',color:'Black',condition:'U kolekciji',photos:[]}]},{id:'p',rev:1,kind:'part',model:'Spare battery',quantity:3,reserved:1,location:'Box 1',catalog_item:'bat',compatible:['a'],instances:[]}]};`,context);
assert.equal(vm.runInContext("cell(db.records[0],'inv')",context),'—');
assert.equal(vm.runInContext("inLocation('Box 1','room')",context),true);
assert.equal(vm.runInContext("locationPath(db.catalog[1])",context),'Room / Box 1');
assert.equal(vm.runInContext('completeness(db.records[0].instances[0]).missing.length',context),1);
assert.equal(vm.runInContext('completeness(db.records[0].instances[1]).missing.length',context),0);
assert.match(vm.runInContext("unitCell(db.records[0],db.records[0].instances[0],0,'colors')",context),/quick-start/);
assert.match(vm.runInContext("unitCell(db.records[0],db.records[0].instances[0],0,'image')",context),/unit-details/);
assert.match(vm.runInContext("catalogConnections(db.catalog[2])",context),/3 total · 2 available/);
assert.match(vm.runInContext("catalogConnections(db.catalog[2])",context),/Nokia N73/);
assert.equal(vm.runInContext("duplicateImeis({instances:[{imei:'12 345'}]}).length",context),1);
assert.equal(vm.runInContext("duplicateImeis(db.records[0]).length",context),0);
vm.runInContext("selectedUnits.add('u2');openBulk()",context);assert.equal(vm.runInContext('bulkTargets[0].rev',context),3);assert.equal(vm.runInContext('bulkTargets[0].unit_id',context),'u2');assert.match(node('panel-body').innerHTML,/data-bulk-field="location"/);
vm.runInContext("locationContents('room')",context);assert.match(node('panel-body').innerHTML,/Spare battery/);assert.match(node('panel-body').innerHTML,/Nokia N73/);
vm.runInContext("currentView='incomplete';render()",context);assert.match(node('collection-table').innerHTML,/N73/);assert.doesNotMatch(node('collection-table').innerHTML,/Spare battery/);
vm.runInContext("catalogEditor('location','box')",context);assert.match(node('panel-body').innerHTML,/location-parent/);
vm.runInContext("catalogEditor('battery','bat')",context);assert.match(node('panel-body').innerHTML,/data-catalog-compatible="a"/);
let submitted;context.fetch=async(path,init)=>({ok:true,json:async()=>{if(path==='/api/bulk-units'){submitted=JSON.parse(init.body);return {updated:1};}if(path==='/api/data')return vm.runInContext('db',context);if(path.startsWith('/api/history'))return [];return {};}});
(async()=>{
 vm.runInContext("quickEdit={record_id:'a',unit_id:'u2',rev:3,key:'color'}",context);node('quick-value').value='Blue';await vm.runInContext('saveQuick()',context);assert.equal(submitted.changes.color,'Blue');assert.equal(submitted.targets[0].unit_id,'u2');assert.equal(vm.runInContext('quickEdit',context),null);
 await vm.runInContext("unitDetails('a',0)",context);assert.match(node('panel-body').innerHTML,/12345/);assert.match(node('panel-body').innerHTML,/Completeness/);assert.match(node('panel-body').innerHTML,/History/);
 console.log('Collection workflows: quick save targets, bulk selection, duplicate IMEI, missing vs unchecked, nested locations, linked stock and unit details passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
