const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'web/app.js'),'utf8');
const entries=JSON.parse(fs.readFileSync(path.join(root,'data/nokia-batteries.json'),'utf8')).entries;
const catalog=entries.map(e=>({...e,id:e.name,category:'battery',compatible_batteries:e.compatible_names}));
const context=vm.createContext({db:{catalog},normal:s=>String(s||'').trim().toLowerCase()});
for(const name of ['batteryAlternatives','batteryModelKey','batterySuggestions']){
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end),context);
}
function suggestions(brand,model){context.brand=brand;context.model=model;return vm.runInContext('batterySuggestions(brand,model)',context);}
assert.deepEqual(Array.from(suggestions('Nokia','N95 8GB'),x=>x.battery.name),['BL-6F']);
assert.deepEqual(Array.from(suggestions('Nokia','N95'),x=>x.battery.name),['BL-5F']);
assert(suggestions('Nokia','6500 Slide').some(x=>x.battery.name==='BP-5M'));
assert(suggestions('Nokia','6500 classic').some(x=>x.battery.name==='BL-6P'));
assert(!suggestions('Nokia','6500 classic').some(x=>x.battery.name==='BP-5M'));
assert.equal(suggestions('Samsung','N95').length,0);
assert.equal(suggestions('Nokia','N9').length,0);
assert(suggestions('Nokia','Asha 500').every(x=>x.warning));
assert(suggestions('Nokia','C6-00').some(x=>x.battery.name==='BL-4J'));
assert(!suggestions('Nokia','6210').some(x=>x.battery.name==='LRW-1'));
assert(suggestions('Nokia','N82').some(x=>x.battery.name==='BL-6Q'&&x.warning));
console.log('Battery suggestions: exact variants, brand isolation, source conflicts, directional alternatives passed.');
