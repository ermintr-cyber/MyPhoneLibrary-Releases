const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map(),handlers={};
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},style:{},hidden:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},querySelector(){return null},querySelectorAll(){return []},addEventListener(k,f){handlers[id+':'+k]=f;},show(){this.open=true},showModal(){this.open=true},close(){this.open=false}});return nodes.get(id);}
const context=vm.createContext({console,URLSearchParams,location:{hash:''},confirm:()=>true,setTimeout:()=>0,clearTimeout(){},window:{addEventListener(){}},document:{getElementById:node,documentElement:{dataset:{}},querySelectorAll(){return []},addEventListener(k,f){handlers[k]=f;}}});
const code=fs.readFileSync(__dirname+'/../web/app.js','utf8');vm.runInContext(code.slice(0,code.lastIndexOf('boot().then(')),context);
vm.runInContext(`db={version:'1.26.7',settings:{columns:['model'],options:{},views:[],custom_fields:[]},records:[{id:'p',kind:'phone',brand:'Nokia',model:'N73',instances:[{id:'u',inv:'1',photos:[],condition:'U kolekciji',location:'Shelf A'}]}],trash:[],inventories:[],repairs:[{id:'r',record_id:'p',instance_id:'u',rev:3,status:'Otvoren',note:'Current note',cost:24,currency:'KM'}],catalog:[{id:'room',category:'location',name:'Room'},{id:'shelf',category:'location',name:'Shelf A',parent_id:'room'}]};`,context);
const titles={phone:'Phones',part:'Parts and accessories',donors:'Donor phones',repair:'For repair',untested:'Untested',duplicates:'Multiple units'};
for(const [view,title] of Object.entries(titles)){
 vm.runInContext(`currentView=${JSON.stringify(view)};render()`,context);
 assert.equal(node('page-title').textContent,title);
}
assert.equal(node('sidebar-version').textContent,'MyPhoneLibrary 1.26.7');
const html=fs.readFileSync(__dirname+'/../web/index.html','utf8');
assert.match(html,/id="sidebar-version"/);assert.doesNotMatch(html,/MyPhoneLibrary 1\.26\.2/);
vm.runInContext('inventoryPanel()',context);
assert.match(node('panel-body').innerHTML,/<option value="Room">Room<\/option>/);
assert.match(node('panel-body').innerHTML,/<option value="Shelf A">Room \/ Shelf A<\/option>/);
assert.match(node('panel-body').innerHTML,/id="inventory-sublocations" checked/);
let repairPayload,inventoryPayload;
context.fetch=async(path,init)=>({ok:true,json:async()=>{
 if(path==='/api/repair'){repairPayload=JSON.parse(init.body);return {};}
 if(path==='/api/inventory'){inventoryPayload=JSON.parse(init.body);return {id:'inventory'};}
 if(path==='/api/data')return vm.runInContext('db',context);
 return {};
}});
function click(action,id){return handlers.click({target:{closest(){return {dataset:{action,id}};}}});}
(async()=>{
 await click('finish-repair','r');
 assert.deepEqual(repairPayload,{id:'r',record_id:'p',rev:3,action:'status',status:'Završen'});
 vm.runInContext('inventoryPanel=()=>{}',context);
 node('inventory-location').value='Room';node('inventory-sublocations').checked=false;
 await click('start-inventory');
 assert.deepEqual(inventoryPayload,{location:'Room',include_sublocations:false});
 console.log('Reliability UI: dynamic version, view titles, parent inventory scope and status-only repair payload passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
