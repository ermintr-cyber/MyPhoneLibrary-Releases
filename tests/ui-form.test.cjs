const {chromium}=require('playwright');
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1500,height:1000}});await page.route('**/*',r=>r.abort());
await page.setContent(fs.readFileSync('web/index.html','utf8').replace(/<script[^>]*><\/script>/g,'').replace(/<link[^>]*>/g,''));
await page.addStyleTag({content:fs.readFileSync('web/style.css','utf8')});
let source=fs.readFileSync('web/app.js','utf8');source=source.slice(0,source.lastIndexOf('restoreSidebar();'));
await page.addScriptTag({content:source});
await page.evaluate(()=>{db={version:UI_VERSION,settings:{columns:['image','brand','model','inv'],custom_fields:[],options:{},views:[]},records:[],catalog:[{id:'nokia',category:'brand',name:'Nokia',description:'',specs:{}},{id:'os',category:'os',name:'Symbian OS 9.2',description:'',specs:{}}],trash:[]};document.getElementById('application').hidden=false;addPhone();});
assert.equal(await page.locator('[data-effective=type]').count(),1);assert.equal(await page.locator('[data-effective=alias]').count(),1);assert.equal(await page.locator('[data-effective=gsm]').count(),1);assert.equal(await page.locator('[data-u=note]').count(),1);assert.equal(await page.locator('#gallery-upload').count(),0);
const os=page.locator('.catalog-combo[data-category=os] [data-combo-query]');await os.fill('Symbian OS 9.');assert.equal(await page.locator('.catalog-combo[data-category=os] [role=option]').first().textContent(),'Symbian OS 9.2');await page.locator('.catalog-combo[data-category=os] [role=option]').first().click();assert.equal(await page.locator('[data-effective=os]').inputValue(),'Symbian OS 9.2');await os.fill('Symbian OS 9.1');assert.equal(await os.evaluate(el=>el.checkValidity()),false);await os.fill('Symbian OS 9.2');await page.keyboard.press('Escape');assert.equal(await page.locator('#editor').evaluate(el=>el.open),true);
await page.evaluate(()=>{readDraft();});assert.equal(await page.evaluate(()=>draft.os),'Symbian OS 9.2');
// Existing model edits keep sibling overrides and legacy gallery data.
await page.evaluate(()=>{document.getElementById('editor').close();db.records=[{id:'a',kind:'phone',brand:'Nokia',model:'N73',alias:'N73-1',type:'RM-133',os:'Symbian OS 9.2',photos:['/media/old.jpg'],custom:{},instances:[{id:'u1',inv:'1',photos:[],type:''},{id:'u2',inv:'2',photos:[],type:'RM-ME'}]}];showEditor('a',1);});
await page.locator('[data-effective=type]').fill('RM-new');await page.locator('#editor-unit-select').selectOption('0');assert.equal(await page.locator('[data-effective=type]').inputValue(),'RM-133');assert.equal(await page.evaluate(()=>draft.instances[1].type),'RM-new');assert.equal(await page.evaluate(()=>draft.photos[0]),'/media/old.jpg');
await page.evaluate(()=>{dirty=false;closeEditor();sidebarState(true);});assert.equal(await page.locator('main').evaluate(el=>getComputedStyle(el).marginLeft),'0px');
// Empty and cleared phone forms must not block installation; real drafts must.
await page.evaluate(()=>{phoneDraft=null;catalogReturn=null;panelDirty=false;addPhone();closeEditor();});assert.equal(await page.evaluate(()=>hasUnsavedWork()),false);
await page.evaluate(()=>addPhone());await page.locator('[data-r=model]').fill('Unsaved test phone');await page.evaluate(()=>closeEditor());assert.equal(await page.evaluate(()=>hasUnsavedWork()),true);assert.match(await page.evaluate(()=>unsavedWorkReasons().join(' ')),/Add phone draft/);
page.once('dialog',d=>d.accept());await page.evaluate(()=>{addPhone();clearPhoneDraft();closeEditor();});assert.equal(await page.evaluate(()=>hasUnsavedWork()),false);assert.equal(await page.evaluate(()=>phoneDraft),null);
console.log('Update guard: untouched and cleared forms allow updates; real drafts identify Add phone as the source.');
// A long catalog must scroll inside Settings with aligned compact columns.
await page.evaluate(()=>{db.catalog.push(...Array.from({length:50},(_,i)=>({id:'brand'+i,category:'brand',name:i%2?'Sony Ericsson '+i:'Nokia '+i,description:i%2?'A description':'',specs:i%2?{Origin:'Test'}:{}})));catalogList('brand');});
await page.locator('[data-catalog-section=brand] .catalog-item-row').last().scrollIntoViewIfNeeded();
assert.equal(await page.locator('#panel-body').evaluate(el=>el.scrollTop>0&&el.scrollHeight>el.clientHeight),true);
const positions=await page.locator('[data-catalog-section=brand] .catalog-item-row').evaluateAll(rows=>rows.slice(0,3).map(r=>({height:r.getBoundingClientRect().height,x:[...r.children].map(c=>c.getBoundingClientRect().x)})));
assert.deepEqual(positions[0].x,positions[1].x);assert.deepEqual(positions[1].x,positions[2].x);assert.ok(positions.every(r=>r.height<=38));
await page.locator('[data-action=catalog-toggle][data-category=os]').click();assert.equal(await page.locator('[data-catalog-section=brand]').isVisible(),false);assert.equal(await page.locator('[data-catalog-section=os]').isVisible(),true);
console.log('Catalog DOM: long list scrolls, columns align, compact rows and single expanded category passed.');
console.log('DOM: one field per property, search/select/reject, Escape, effective unit switching, retained gallery, collapsed layout passed.');await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
