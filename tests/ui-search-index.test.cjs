const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = new Map();
function getElement(id) {
  if (!elements.has(id)) elements.set(id, {value:'', addEventListener(){}, style:{}, dataset:{}});
  return elements.get(id);
}
const ctx = vm.createContext({console,performance,location:{hash:''},window:{addEventListener(){}},
  document:{getElementById:getElement,documentElement:{dataset:{}},querySelectorAll(){return []},addEventListener(){}}});
const source = fs.readFileSync(__dirname + '/../web/app.js','utf8');
vm.runInContext(source.slice(0,source.lastIndexOf('boot().then(')),ctx);
for (const count of [250,1000,5000]) {
  ctx.count=count;
  const result=vm.runInContext(`
    db={settings:{views:[]},records:Array.from({length:count},(_,i)=>({
      kind:'phone',id:'m'+i,brand:'Nokia',model:'Model '+i,instances:[
        {id:'u'+i,inv:'INV-'+i,location:i%2?'Shelf B':'Shelf A',color:'Mint',photos:[]}
      ]}))};
    currentView='phone';quickFilters={};$('search').value='Nokia Mint inv-'+(count-1);
    (()=>{
      const start=performance.now(),cold=filtered(),indexed=performance.now();
      const warm=filtered(),end=performance.now();
      quickFilters={location:'Shelf A'};
      return {ids:warm.map(i=>i.id).join(','),cold:cold.length,filtered:filtered().length,
        coldMs:Math.round(indexed-start),warmMs:Math.round(end-indexed)};
    })()`,ctx);
  assert.equal(result.ids,'m'+(count-1));assert.equal(result.cold,1);assert.equal(result.filtered,0);
  console.log(count+' units: '+result.coldMs+' ms cold, '+result.warmMs+' ms cached');
}
