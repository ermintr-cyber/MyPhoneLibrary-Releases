const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const elements=new Map(),handlers={};
function node(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',hidden:false,classList:{toggle(){},remove(){},add(){}},setAttribute(){},addEventListener(type,fn){handlers[id+':'+type]=fn;},querySelectorAll(){return []}});return elements.get(id);}
const context=vm.createContext({document:{getElementById:node,querySelectorAll(){return []},addEventListener(){},documentElement:{dataset:{}}},window:{addEventListener(){}},location:{hash:''},console,setTimeout,clearTimeout,URLSearchParams});
let source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');source=source.slice(0,source.lastIndexOf('boot().then('));vm.runInContext(source,context);
vm.runInContext(`db={version:'1.3.0',settings:{layout:'cards',columns:['brand','model','inv'],options:{},views:[]},catalog:[],records:[{id:'a',kind:'phone',brand:'Nokia',model:'N73',battery:'BL-5J',charger:'2mm',instances:[{id:'u1',inv:'1',condition:'U kolekciji',state:'Ispravan',color:'Silver',edition:'Standard',imei:'123456789012345',photos:[]}]}]};`,context);
vm.runInContext('render()',context);assert.equal(node('table-wrap').hidden,true);assert.equal(node('card-grid').hidden,false);assert.match(node('card-grid').innerHTML,/View units/);assert.match(node('card-grid').innerHTML,/N73/);
const units=vm.runInContext('unitTiles(db.records[0])',context);assert.ok(!units.includes('<thead>'));assert.ok(!units.includes('123456789012345'));assert.match(units,/Copy/);
vm.runInContext("currentView='part';render()",context);assert.equal(node('card-grid').hidden,true);
vm.runInContext("currentView='all';db.settings.layout='list';render()",context);assert.equal(node('table-wrap').hidden,false);assert.match(node('collection-table').innerHTML,/draggable="true"/);
console.log('UI: cards/list, sidebar filter, masked IMEI, unit details and draggable headers passed.');
