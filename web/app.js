'use strict';
const UI_VERSION='1.22.0';
const IS_ANDROID_APP=typeof navigator!=='undefined'&&/MyPhoneLibraryAndroid/i.test(navigator.userAgent);
const BUNDLED_ANDROID_UI=IS_ANDROID_APP&&window.MyPhoneLibraryAndroid?.hasBundledUi?.()===true;
function androidVersion(){
 try{return window.MyPhoneLibraryAndroid?.getAppVersion?.()||navigator.userAgent.match(/MyPhoneLibraryAndroid\/(\d+\.\d+\.\d+)/)?.[1]||'';}catch{return '';}
}

let serverInstance=null,versionMismatch=false,connectionCheckBusy=false,catalogReturn=null;
let editorUnitIndex=0,openCatalogCategory=null,comboSerial=0;
let showWanted=false;
let settingsTab='appearance',currentView='all',dragColumn=null,ignoreSortUntil=0;
const $=id=>document.getElementById(id), clone=x=>JSON.parse(JSON.stringify(x));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normal=s=>String(s??'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
const enumLabel=v=>({"Izmjena":"Updated","Dodavanje":"Added","U kolekciji": "In collection", "Posuđen": "On loan", "Prodan": "Sold", "Poklonjen": "Gifted", "Rastavljen": "Dismantled", "Rashodovan": "Retired", "Netestiran": "Untested", "Ispravan": "Working", "Djelimično ispravan": "Partly working", "Neispravan": "Not working", "Kolekcija": "Collection", "Za popravak": "For repair", "Donor": "Donor", "Za prodaju": "For sale", "Za razmjenu": "For trade", "Obična": "Standard", "Music Edition": "Music Edition", "Limited Edition": "Limited Edition", "Nepoznato": "Unknown", "Original": "Original", "Zamjenski": "Replacement", "Miješano": "Mixed", "Otključan": "Unlocked", "SIM-lock": "SIM lock", "Drugi lock": "Other lock", "Dodaj": "Add", "Rezerviši": "Reserve", "Oslobodi": "Release", "Ugradi": "Install", "Ugradi rezervisano": "Install reserved", "Otpiši": "Write off", "Otvoren": "Open", "U radu": "In progress", "Čeka dijelove": "Waiting for parts", "Završen": "Completed", "Netestirano": "Untested", "Ispravno": "Working", "Neispravno": "Not working", "Novo": "New", "Korišteno": "Used"})[v]||v;
const ACTIVE=['U kolekciji','Posuđen'];
let uploadCount=0,phoneDraft=null,panelRoute=null,panelDirty=false;
let db=null,csrf='',draft=null,mode='edit',addUnit=null,dirty=false,expanded=new Set(),sort={key:'brand',dir:1},importRows=null,preview=null,toastTimer;
const columns=[['select','Select'],['completeness','Completeness'],['image','Image'],['inv','Inv. no.'],['brand','Brand'],['model','Model name'],['alias','Mod. nr.'],['type','Type code'],['product_code','Product code'],['colors','Colors'],['editions','Editions'],['battery','Battery'],['charger','Charger'],['state','Condition'],['rating','Cosmetic'],['owned','Owned'],['box','Box'],['os','Operating system'],['released','Released'],['introduced','Introduced'],['qty','Qty'],['parts','Parts'],['location','Location'],['value','Value'],['gsm','GSM'],['wiki','Wiki'],['note','Note'],['actions','Actions']];
const opts={state:['Netestiran','Ispravan','Djelimično ispravan','Neispravan'],condition:['U kolekciji','Wanted'],purpose:['Kolekcija','Za popravak','Donor','Za prodaju','Za razmjenu'],edition:['Standard','Music Edition','Limited Edition'],currency:['KM'],originality:['Nepoznato','Original','Zamjenski','Miješano'],lock:['Nepoznato','Otključan','SIM-lock','Drugi lock']};
const live=r=>(r.instances||[]).filter(u=>ACTIVE.includes(u.condition));
const isWanted=r=>r.kind==='phone'&&(r.wishlist||(r.instances||[]).some(u=>u.condition==='Wanted'));
const wantedOnly=r=>isWanted(r)&&!live(r).length;
function acquireButton(r){return isWanted(r)?`<button type="button" data-action="acquire-wanted" data-id="${r.id}">Acquired — add to collection</button>`:'';}
const unique=a=>[...new Set(a.filter(Boolean))];
const name=r=>[r.brand,r.model].filter(Boolean).join(' ');
function toast(msg){const dialog=[...document.querySelectorAll('dialog[open]')].at(-1);let node=$('toast');if(dialog){node=dialog.querySelector('.dialog-notice');if(!node){node=document.createElement('p');node.className='dialog-notice hint';node.setAttribute('role','status');dialog.prepend(node);}}node.textContent=msg;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,9000);}
async function api(path,data,binary=false){
 if(data!==undefined&&versionMismatch&&!['/api/login','/api/logout'].includes(path))throw Error('A newer application version is active. Reload this page before saving changes.');
 const init={headers:{'X-MPL-Client':'1'}};
 if(data!==undefined){init.method='POST';init.headers['X-MPL-CSRF']=csrf;if(!binary)init.headers['Content-Type']='application/json';init.body=binary?data:JSON.stringify(data);}
 const response=await fetch(path,init);let result;try{result=await response.json();}catch{throw Error('The server returned an invalid response.');}
 if(!response.ok){if(response.status===401&&!path.endsWith('login')){await boot();}throw Error(result.error||'The operation failed.');}
 return result;
}
function updateMessage(message,busy=false){
 const el=$('update-result');if(el){el.hidden=false;el.textContent=message;el.setAttribute('aria-busy',String(busy));}
}
let reconnecting=false;
function startupStatus(message,detail='',failed=false){
 const el=$('startup-status');el.style.display='grid';
 $('startup-message').textContent=message;$('startup-detail').textContent=detail;
 $('startup-progress').hidden=failed;$('startup-retry').hidden=!failed;$('startup-dismiss').hidden=!failed;
}
function hideStartup(){$('startup-status').style.display='none';}
async function reconnectAfterRestart(previousInstance=serverInstance){
 if(reconnecting)return;reconnecting=true;
 const target=sessionStorage.getItem('mpl-update-target');
 const message='Restarting server…';
 updateMessage(message,true);startupStatus(message,'Waiting for '+(target?'version '+target:'the server')+'. Keep this page open.');
 try{
 for(let attempt=0;attempt<60;attempt++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  $('startup-detail').textContent='Reconnecting'+(target?' to version '+target:'')+' · attempt '+(attempt+1)+' of 60';
  try{
   const options={cache:'no-store'};
   if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)options.signal=AbortSignal.timeout(2000);
   const response=await fetch('/api/status',options);const status=await response.json();
   if(response.ok&&(!target||status.version===target)&&(!previousInstance||status.instance!==previousInstance)){
    if(target)sessionStorage.setItem('mpl-update-complete',target);
    startupStatus('Server is ready. Loading MyPhoneLibrary…',target?'Version '+target+' confirmed.':'Connection restored.');
    location.reload();return;
   }
  }catch{}
 }
 const failure='Restart could not be confirmed'+(target?' for version '+target:'')+'. The update is not confirmed as installed. Reopen My Phone Library or check the installed version.';
 updateMessage(failure);startupStatus('Still unable to reconnect',failure,true);
 }finally{reconnecting=false;}
}
async function watchInstallation(){
 if(reconnecting)return;reconnecting=true;
 const target=sessionStorage.getItem('mpl-install-target');
 startupStatus('Updating MyPhoneLibrary…','The independent updater is working. Keep this page open.');
 try{
  for(let attempt=0;attempt<450;attempt++){
   try{
    const options={cache:'no-store'};if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)options.signal=AbortSignal.timeout(2000);
    const response=await fetch('/api/status',options);
    if(response.ok){
     const status=await response.json(),job=status.update_job||{};
     if(job.version===target&&job.status==='failed'){
      updateMessage(job.message);startupStatus('Update could not be completed',job.message,true);return;
     }
     if(job.version===target&&job.status==='completed'&&status.version===target){
      sessionStorage.removeItem('mpl-install-target');sessionStorage.setItem('mpl-update-complete',target);
      startupStatus('Update completed','Opening version '+target+'…');location.reload();return;
     }
     if(job.version===target){
      const detail=job.message||'Waiting for the update worker…';
      startupStatus(job.status==='downloading'?'Downloading update…':job.status==='installing'?'Installing update…':job.status==='verifying'?'Starting the updated server…':'Updating MyPhoneLibrary…',detail+(Number.isFinite(job.progress)?' '+job.progress+'%':''));
      updateMessage(detail,true);
     }
    }
   }catch{startupStatus('Installing and reconnecting…','The server is temporarily offline while the Windows updater replaces the application.');}
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  startupStatus('Update status is unavailable','The updater may still be working. Try again to reconnect; no second installation will be started.',true);
 }finally{reconnecting=false;}
}
async function boot(){
 try{const status=await api('/api/status');serverInstance=status.instance||null;csrf=status.csrf||'';$('login').hidden=status.authenticated;$('application').hidden=!status.authenticated;
 $('login-description').textContent=status.setup?'Set a password for your collection.':'Sign in to access your phones.';
 $('login-submit').textContent=status.setup?'Create collection':'Sign in';$('login-form').dataset.setup=String(status.setup);
 if(status.authenticated){await refresh();currentView=db.settings.default_page||'all';render();}
 const completed=sessionStorage.getItem('mpl-update-complete');
 if(completed&&status.version===completed){
  $('update-banner').hidden=false;$('update-banner').textContent='Update completed successfully. Installed version: '+completed;
  sessionStorage.removeItem('mpl-update-complete');sessionStorage.removeItem('mpl-update-target');
  setTimeout(()=>$('update-banner').hidden=true,5000);
 }
 }catch(e){$('login').hidden=false;$('login-error').textContent='Server unavailable. Start MyPhoneLibrary on your computer.';}finally{hideStartup();}
}
function unsavedWorkReasons(){
 const reasons=[];
 if(phoneDraft||(dirty&&mode==='add')||(catalogReturn?.dirty&&catalogReturn.mode==='add'))reasons.push('Add phone draft: open Add phone, then save it or use Clear data and close the form.');
 if((dirty&&mode!=='add')||(catalogReturn?.dirty&&catalogReturn.mode!=='add'))reasons.push('Phone / part details: save or discard the open editor changes.');
 if(quickEdit)reasons.push('Quick cell edit: use Save or Cancel in the collection table.');
 if(panelDirty)reasons.push(panelRoute?.kind==='item'?'Catalog item: save the item or close it and discard its changes.':panelRoute?.kind==='bulk'?'Bulk edit: apply the changes or close the editor and discard them.':'Settings: use Save settings (or Save source for the update repository), or close Settings and discard the changes.');
 if(uploadCount)reasons.push('Photos are uploading: wait for uploads to finish.');
 return reasons;
}
function hasUnsavedWork(){return unsavedWorkReasons().length>0;}
function connectionBanner(message){const el=$('connection-banner');el.hidden=false;$('connection-message').textContent=message;}
async function checkConnection(){
 if(connectionCheckBusy||reconnecting)return;connectionCheckBusy=true;
 try{
  const options={cache:'no-store'};if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)options.signal=AbortSignal.timeout(4000);
  const response=await fetch('/api/status',options);if(!response.ok)throw Error('unavailable');
  const status=await response.json();
  versionMismatch=!BUNDLED_ANDROID_UI&&status.version!==UI_VERSION;
  if(versionMismatch){
   $('connection').textContent='New version available';
   connectionBanner('Version '+status.version+' is active on the server. This page is using '+UI_VERSION+'.'+(hasUnsavedWork()?' Your unsaved draft is retained. Finish or copy your changes before reloading.':' Reloading…'));
   if(!hasUnsavedWork()){startupStatus('Loading version '+status.version+'…');location.reload();}
   return;
  }
  if(db&&!status.authenticated){
   connectionBanner('The server restarted or your session expired. Sign in again.'+(hasUnsavedWork()?' Copy your unsaved details before reloading.':''));
   $('connection').textContent='Sign in required';
   if(!hasUnsavedWork())location.reload();
   return;
  }
  serverInstance=status.instance||serverInstance;$('connection').textContent='Connected';$('connection-banner').hidden=true;
 }catch{
  $('connection').textContent='Offline — server unavailable';
  connectionBanner('Connection to MyPhoneLibrary is lost. Displayed data may be out of date; changes cannot be saved until the server returns.');
 }finally{connectionCheckBusy=false;}
}
async function monitorConnection(){await checkConnection();setTimeout(monitorConnection,10000);}
function returnToPhone(){
 if(!catalogReturn||!allowPanelLeave())return;
 const state=catalogReturn;catalogReturn=null;$('panel').close();panelRoute=null;panelDirty=false;
 draft=state.draft;mode=state.mode;dirty=state.dirty;addUnit=mode==='add'?draft.instances.at(-1):null;
 lists();editorRender(state.index);$('editor').showModal();
}
async function refresh(){db=await api('/api/data');document.documentElement.dataset.theme=db.settings.theme||'dark';document.documentElement.dataset.density=db.settings.density||'compact';$('connection').textContent='Connected';lists();render();}
function lists(){
 const values={...db.settings.options,edition:opts.edition};
 for(const key of Object.keys(values))values[key]=unique(values[key]);
 $('datalists').innerHTML=Object.entries(values).map(([key,a])=>`<datalist id="options-${esc(key)}">${a.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist>`).join('');
 refreshModelOptions();

}
let selectedUnits=new Set(),quickEdit=null,bulkTargets=[];
const unitOnlyColumns=['location','box','state','rating','note'];
const forParts=u=>u.for_parts===true||u.purpose==='Donor';
const needsCompletion=u=>!forParts(u)&&completeness(u).missing.length>0;
function stateHTML(state){const cls=state==='Ispravan'?'working':state==='Neispravan'?'broken':'untested';return `<span class="state-${cls}">${esc(enumLabel(state)||'Untested')}</span>`;}
function shownUnits(r){return (r.instances||[]).filter(u=>currentView==='wish'?u.condition==='Wanted':currentView==='donors'?forParts(u):showWanted||u.condition!=='Wanted');}
const unitFields={color:'Color',edition:'Edition',location:'Location',state:'Working condition',condition:'Ownership status',box:'Box',battery_present:'Battery',charger_present:'Charger',manual:'Manual',headphones:'Headphones',os:'Operating system'};
const accessoryFields=['battery_present','charger_present','box','manual','headphones'];
function completeness(u){return {missing:accessoryFields.filter(k=>u[k]===false),unknown:accessoryFields.filter(k=>u[k]==null)};}
function completenessHTML(u){const c=completeness(u);return `<span class="${c.missing.length?'error':c.unknown.length?'muted':'good'}">${c.missing.length?'Missing: '+c.missing.map(k=>unitFields[k]).join(', '):c.unknown.length?'Not checked':'Complete'}</span>${c.unknown.length?`<small>Unchecked: ${esc(c.unknown.map(k=>unitFields[k]).join(', '))}</small>`:''}`;}
function selectionBox(r,u=null){const units=u?[u]:shownUnits(r);return units.length?`<input type="checkbox" aria-label="Select ${u?'unit '+esc(u.inv):'all units of '+esc(name(r))}" data-select-record="${r.id}" ${u?`data-select-unit="${u.id}"`:''} ${units.every(x=>selectedUnits.has(x.id))?'checked':''}>`:'';}
function quickButton(r,u,i,key,label){return `<button class="link quick-edit" data-action="quick-start" data-id="${r.id}" data-index="${i}" data-field="${key}" title="Edit ${esc(unitFields[key])}">${label||'—'}</button>`;}
function unitControl(key,value,id){const tri=accessoryFields.includes(key),choices=tri?[["null","Not checked"],["true","Yes"],["false","No"]]:key==='state'?opts.state.map(v=>[v,enumLabel(v)]):key==='condition'?opts.condition.map(v=>[v,enumLabel(v)]):null;
 if(choices)return `<select id="${id}">${choices.map(([v,l])=>`<option value="${v}" ${String(value??'null')===v?'selected':''}>${l}</option>`).join('')}</select>`;
 if(catalogNames[key])return catalogCombo(key,value,`id="${id}"`);
 return `<input id="${id}" value="${esc(value||'')}" list="options-${key}">`;
}
function controlValue(key,el){const c=el.closest?.('.catalog-combo');if(c&&!syncCombo(c))throw Error('Select an existing catalog item.');return accessoryFields.includes(key)?el.value==='true'?true:el.value==='false'?false:null:el.value;}
function startQuick(target){if(quickEdit)throw Error('Save or cancel the current cell first.');const r=record(target.dataset.id),u=r.instances[Number(target.dataset.index)],key=target.dataset.field;
 quickEdit={record_id:r.id,unit_id:u.id,rev:r.rev,key};const td=target.closest('td,.unit-field');td.innerHTML=`<div class="quick-control">${unitControl(key,u[key],'quick-value')}<label class="field-check-toggle"><input id="quick-check" type="checkbox" ${checkFields(u).includes(key)?'checked':''}>To check</label><button data-action="quick-save">Save</button><button data-action="quick-cancel">Cancel</button></div>`;($('quick-value').closest?.('.catalog-combo')?.querySelector('[data-combo-query]')||$('quick-value')).focus();}
async function saveQuick(){if(!quickEdit)return;const q=quickEdit,changes={[q.key]:controlValue(q.key,$('quick-value'))},r=record(q.record_id),u=r.instances.find(u=>u.id===q.unit_id);if($('quick-check')?.type==='checkbox'){const keys=new Set(checkFields(u));if($('quick-check').checked)keys.add(q.key);else keys.delete(q.key);changes.to_check=[...keys];}await api('/api/bulk-units',{targets:[q],changes});quickEdit=null;await refresh();toast('Unit updated.');}
function openBulk(){bulkTargets=db.records.flatMap(r=>(r.instances||[]).filter(u=>selectedUnits.has(u.id)).map(u=>({record_id:r.id,unit_id:u.id,rev:r.rev})));if(!bulkTargets.length)throw Error('Select at least one phone unit.');
 panel('Edit '+bulkTargets.length+' selected units',`<p>Only checked fields will change. Other details stay as they are.</p><div class="settings-list">${Object.entries(unitFields).map(([k,label])=>`<div class="setting-row"><label class="check"><input type="checkbox" data-bulk-field="${k}">${label}</label>${unitControl(k,null,'bulk-'+k)}</div>`).join('')}</div><button class="primary" data-action="bulk-save">Apply changes</button>`,{kind:'bulk'});}
async function saveBulk(){const changes={};document.querySelectorAll('[data-bulk-field]:checked').forEach(el=>{changes[el.dataset.bulkField]=controlValue(el.dataset.bulkField,$('bulk-'+el.dataset.bulkField));});if(!Object.keys(changes).length)throw Error('Check at least one field.');if(!confirm('Apply these changes to '+bulkTargets.length+' units?'))return;const result=await api('/api/bulk-units',{targets:bulkTargets,changes});selectedUnits.clear();panelDirty=false;panelRoute=null;$('panel').close();await refresh();toast(result.updated+' units updated.');}
function locationPath(item){const names=[],seen=new Set();while(item&&!seen.has(item.id)){seen.add(item.id);names.unshift(item.name);item=db.catalog.find(x=>x.id===item.parent_id);}return names.join(' / ');}
function inLocation(value,id){let item=db.catalog.find(x=>x.category==='location'&&normal(x.name)===normal(value));const seen=new Set();while(item&&!seen.has(item.id)){if(item.id===id)return true;seen.add(item.id);item=db.catalog.find(x=>x.id===item.parent_id);}return false;}
function locationContents(id){const item=db.catalog.find(x=>x.id===id);const rows=db.records.flatMap(r=>r.kind==='part'?(inLocation(r.location,id)?[{r,u:null}]:[]):live(r).filter(u=>inLocation(u.location,id)).map(u=>({r,u})));
 panel('Location: '+locationPath(item),`<div class="actions"><button data-action="locations">All locations</button><button data-action="catalog-item" data-id="${id}">Location details</button></div><p>${rows.length} records, including nested locations.</p><div class="settings-list">${rows.map(({r,u})=>`<div class="setting-row"><span>${esc(name(r))} · ${esc(u?u.inv:r.quantity+' parts')}<small>${esc(u?u.location:r.location)}</small></span><button data-action="${u?'unit-details':'edit'}" data-id="${r.id}" data-index="${u?r.instances.indexOf(u):0}">View</button></div>`).join('')||'<p>This location is empty.</p>'}</div>`,{kind:'location'});}
function catalogConnections(e){const parts=db.records.filter(r=>r.kind==='part'&&(r.catalog_item===e.id||r.catalog_refs?.[e.category]===e.id));const compatible=db.records.filter(r=>r.kind==='phone'&&((e.compatible||[]).includes(r.id)||r.catalog_refs?.[e.category]===e.id||parts.some(p=>(p.compatible||[]).includes(r.id))));
 return `<h3>Stock and locations</h3><div class="settings-list">${parts.map(p=>`<div class="setting-row"><button class="link" data-action="edit" data-id="${p.id}">${esc(name(p))}</button><span>${p.quantity} total · ${p.quantity-p.reserved} available · ${esc(p.location)||'No location'}</span><button data-action="move" data-id="${p.id}">Stock</button></div>`).join('')||'<p>No stock linked. Add a part and choose this catalog item.</p>'}</div><h3>Compatible models</h3><p>${compatible.map(r=>esc(name(r))).join(' · ')||'No compatibility recorded.'}</p>`;}
function duplicateImeis(candidate){const norm=v=>String(v||'').replace(/[\s-]/g,'').toUpperCase(),seen=new Map(),hits=[];
 for(const r of [...db.records,...db.trash||[]]){if(r.id===candidate.id)continue;for(const u of r.instances||[])for(const k of ['imei','imei2']){const key=norm(u[k]);if(key)seen.set(key,{r,u,trash:r.deleted});}}
 for(const u of candidate.instances||[])for(const k of ['imei','imei2']){const key=norm(u[k]);if(!key)continue;const other=seen.get(key);if(other)hits.push({imei:u[k],...other});else seen.set(key,{r:candidate,u,local:true});}
 return hits;
}
function imeiWarnings(){if(!draft||draft.kind!=='phone')return;readDraft();const hits=duplicateImeis(draft),el=$('imei-warning');if(el){el.innerHTML=hits.length?`<strong>Duplicate IMEI</strong>${hits.map(h=>`<div>${esc(h.imei)} — ${esc(name(h.r))}, inventory ${esc(h.u.inv)||'new unit'} ${h.trash?'(Trash)':''}${!h.local&&!h.trash?` <button type="button" data-action="duplicate-open" data-id="${h.r.id}" data-unit="${h.u.id}">Open existing unit</button>`:''}</div>`).join('')}`:'';el.hidden=!hits.length;}return hits;}
async function unitDetails(id,index){const r=record(id),u=r?.instances[index];if(!u)return;const history=await api('/api/history?id='+encodeURIComponent(id));const effective=k=>u[k]||r[k]||'—';
 const pairs=[['Brand',r.brand],['Model',r.model],['Inventory number',u.inv],['Model number / Variant',effective('alias')],['Type code',effective('type')],['Product code',u.product_code],['Color',u.color],['Edition',enumLabel(u.edition)],['Operating system',effective('os')],['Firmware',u.firmware],['Battery',[r.battery,...batteryAlternatives(r.battery).map(x=>x.name+' (compatible)')].filter(Boolean).join(' · ')],['Charger',r.charger],['IMEI',u.imei],['IMEI 2',u.imei2],['Serial number',u.serial],['Condition',enumLabel(u.state)],['Location',u.location],['Purchased',u.purchase_date],['Source',u.source],['Purchase price',u.price+' '+amountCurrency(u)],['Estimated value',u.value+' '+amountCurrency(u)]];
 panel(name(r)+' · '+(u.inv||'Unit'),`<div class="actions"><button data-action="edit-unit" data-id="${id}" data-index="${index}">Edit unit</button><button data-action="copy-unit" data-id="${id}" data-index="${index}">Copy unit</button></div><div class="gallery">${(u.photos?.length?u.photos:[r.image,...r.photos||[]]).filter(Boolean).map(src=>`<img src="${esc(src)}" alt="Phone photo" data-action="photo" data-url="${esc(src)}">`).join('')}</div><div class="unit-detail-grid">${pairs.map(([k,v])=>`<div><small>${k}</small><strong>${esc(v)||'—'}</strong></div>`).join('')}</div><h3>Completeness</h3>${completenessHTML(u)}<h3>Links</h3>${['gsm','wiki'].map(k=>{const v=u[k]||r[k];return v?`<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${k==='gsm'?'GSMArena':'Wikipedia'} ↗</a>`:'';}).join(' · ')}<h3>Notes</h3><p class="detail-note">${esc(u.note)||'No unit notes.'}</p><h3>Repairs</h3>${db.repairs.filter(x=>x.instance_id===u.id).map(x=>`<p>${esc(x.at)} · ${esc(enumLabel(x.status))} · ${esc(x.note)}</p>`).join('')||'<p>No repairs recorded.</p>'}<h3>History</h3><p class="subtle">Model history includes changes to its individual units.</p>${history.slice(0,30).map(x=>`<p>${esc(x.at)} · ${esc(enumLabel(x.action))}</p>`).join('')}`,{kind:'unit'});
}
function value(r,key){const us=live(r);switch(key){
 case 'product_code':return unique(us.map(u=>u.product_code)).join(', ');
 case 'inv':return us.map(u=>u.inv).join(', ');
 case 'qty':return r.kind==='part'?r.quantity:us.length;
 case 'parts':return db.records.filter(p=>p.kind==='part'&&(p.compatible||[]).includes(r.id)).reduce((sum,p)=>sum+p.quantity,0);
 case 'colors':return unique(us.map(u=>u.color)).join(', ');
 case 'editions':return unique(us.map(u=>u.edition)).join(', ');
 case 'state':return r.kind==='part'?r.condition:unique(us.map(u=>u.state)).join(', ');
 case 'location':return r.kind==='part'?r.location:unique(us.map(u=>u.location)).join(', ');
 case 'rating':{const ratings=unique(us.map(u=>u.rating).filter(Boolean)).sort((a,b)=>a-b);return ratings.length>1?ratings[0]+'–'+ratings.at(-1):ratings[0]||r.rating||'';}
 case 'owned':return r.kind==='part'?r.quantity>0:us.length>0;
 case 'box':{const yes=us.filter(u=>u.box===true).length,unknown=us.filter(u=>u.box==null).length;return us.length?yes+'/'+us.length+(unknown?' · '+unknown+' ?':''):'—';}
 case 'value':return r.kind==='part'?r.value+' '+r.currency:unique(us.filter(u=>u.value).map(u=>u.value+' '+u.currency)).join(', ');
 case 'alias':case 'type':case 'os':return r.kind==='phone'?unique(us.map(u=>u[key]||r[key]).filter(Boolean)).join(', ')||r[key]||'':r[key]||'';
 default:return r[key]??'';
}}
let quickFilters={brand:'',color:'',os:'',location:'',state:''};
const filterLabels={brand:'Brand',color:'Color',os:'Operating system',location:'Location',state:'Condition',battery_present:'Battery included'};
function renderFilters(){const root=$('quick-filters');if(!root)return;root.innerHTML=Object.entries(filterLabels).map(([k,label])=>{if(k==='battery_present')return `<label>${label}<select data-quick-filter="${k}"><option value="">All</option>${[['true','Yes'],['false','No'],['unknown','Not checked']].map(([v,l])=>`<option value="${v}" ${quickFilters[k]===v?'selected':''}>${l}</option>`).join('')}</select></label>`;const values=unique(db.records.flatMap(r=>k==='brand'?[r.brand]:r.kind==='part'?[k==='state'?r.condition:r[k]]:(r.instances||[]).map(u=>u[k]||(k==='os'?r.os:'')))).sort((a,b)=>a.localeCompare(b));if(quickFilters[k]&&!values.includes(quickFilters[k]))values.push(quickFilters[k]);return `<label>${label}<select data-quick-filter="${k}"><option value="">All</option>${values.map(v=>`<option value="${esc(v)}" ${v===quickFilters[k]?'selected':''}>${esc(enumLabel(v))}</option>`).join('')}</select></label>`;}).join('')+'<button data-action="clear-filters">Clear filters</button><button data-action="saved-filters">Save / open filters</button>';}
function matchesFilters(r,u){return Object.entries(quickFilters).every(([k,v])=>!v||(k==='battery_present'?(r.kind==='phone'&&!!u&&(v==='unknown'?u.battery_present==null:String(u.battery_present)===v)):normal(k==='brand'?r.brand:k==='os'?(u?.os||r.os):u?u[k]:k==='state'?r.condition:r[k])===normal(v)));}
function searchMatches(r,q){const norm=v=>normal(v).replace(/[^\p{L}\p{N}]/gu,''),tokens=normal(q).split(/\s+/).filter(Boolean).map(norm).filter(Boolean);const common=['brand','model','alias','type','battery','charger','os','note'].map(k=>r[k]||'').join(' ');return (r.kind==='phone'&&r.instances?.length?r.instances:[null]).some(u=>{if(!matchesFilters(r,u))return false;const text=norm(common+' '+(u?['inv','alias','type','product_code','color','edition','os','imei','imei2','serial','firmware','memory','location','note'].map(k=>u[k]||'').join(' '):[r.location,r.part_category,r.color].join(' ')));return tokens.every(t=>text.includes(t));});}
function filtered(){
 let q=normal($('search').value),view=currentView;
 if(view.startsWith('saved-')){const v=db.settings.views[Number(view.slice(6))];if(v){view=v.filter;q=normal($('search').value||v.query);}}
 let rows=db.records.filter(r=>{if(view==='donors'&&!live(r).some(forParts))return false;if(view==='incomplete'&&!live(r).some(needsCompletion))return false;if(view==='phone'||view==='part'){if(r.kind!==view)return false;}if(view==='wish'&&!isWanted(r))return false;if(['all','phone'].includes(view)&&!showWanted&&wantedOnly(r))return false;if(view==='duplicates'&&live(r).length<2)return false;if(view==='untested'&&!live(r).some(u=>u.state==='Netestiran'))return false;if(view==='repair'&&!live(r).some(u=>u.purpose==='Za popravak'||u.state==='Neispravan'||u.state==='Djelimično ispravan'))return false;return searchMatches(r,q);});
 return rows.sort((a,b)=>{const av=value(a,sort.key),bv=value(b,sort.key);return sort.dir*(typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'bs',{numeric:true}));});
}
function image(r){const src=r.image||(r.photos||[])[0];return src?`<img class="thumb" src="${esc(src)}" alt="${esc(name(r))}" loading="lazy" data-action="photo" data-url="${esc(src)}">`:'<span class="thumb-placeholder" aria-label="No photo">▯</span>';}
function cell(r,key){return checkCell(r,null,key,rawCell(r,key));}
function rawCell(r,key){if(key==='select')return selectionBox(r);if(key==='completeness')return r.kind==='phone'?unique(live(r).map(u=>completeness(u).missing.length?'Incomplete':completeness(u).unknown.length?'Not checked':'Complete')).join(', '):'—';const v=value(r,key);if(key==='os'&&r.kind==='phone')return unique(live(r).map(u=>u.os||r.os).filter(Boolean)).map(x=>catalogLink('os',x)).join(', ')||catalogLink('os',r.os);if(key==='battery')return batteryCell(v);if(catalogNames[key])return catalogLink(key,v);if(key==='colors')return unique(live(r).map(u=>u.color)).map(v=>catalogLink('color',v)).join(', ');if(key==='state')return esc(unique(live(r).map(u=>enumLabel(u.state))).join(', ')||enumLabel(r.condition)||'—');if(key==='editions')return esc(unique(live(r).map(u=>enumLabel(u.edition))).join(', '));if(key==='image')return `<div class="model-image-cell">${r.kind==='phone'?`<button class="expand-model" data-action="expand" data-id="${r.id}" aria-label="Show or hide units" aria-expanded="${expanded.has(r.id)}">${expanded.has(r.id)?'▾':'▸'}</button>`:'<span class="expand-spacer"></span>'}${image(r)}</div>`;
 if(key==='model')return `<strong>${esc(r.model)}</strong>${checkSummary(r)}<small>${r.kind==='part'?'Part / accessory':(r.wishlist||(r.instances||[]).some(u=>u.condition==='Wanted'))?'Wanted':''}</small>`;
 if(key==='qty')return `<button class="number-pill" data-action="${r.kind==='part'?'move':'expand'}" data-id="${r.id}">${esc(v)}</button>`;
 if(key==='parts')return r.kind==='phone'?`${v}${r.declared_parts?` <span class="muted">(${esc(r.declared_parts)} ?)</span>`:''}`:`${r.quantity-r.reserved} available / ${r.reserved} reserved`;
 if(key==='owned')return v?'<span class="good">✓</span>':'<span class="muted">—</span>';
 if(key==='rating')return v?`<span class="stars">★ ${esc(v)}</span>`:'—';
 if(key==='inv')return r.kind==='phone'?'—':esc(v)||'—';
 if(key==='gsm'||key==='wiki'){const links=r.kind==='phone'?unique(live(r).map(u=>u[key]||r[key]).filter(Boolean)):[];if(links.length)return links.map((x,i)=>`<a href="${esc(x)}" target="_blank" rel="noopener noreferrer">${key==='gsm'?'GSM':'Wiki'}${links.length>1?' '+(i+1):''}</a>`).join(' · ');}if(key==='gsm'||key==='wiki')return v?`<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${key==='gsm'?'GSM':'Wiki'}</a>`:'—';
 if(key==='note')return noteIcon(v);
 if(key==='actions')return actionButton(r)+acquireButton(r);
 return esc(v)||'—';}
let rowMenuSerial=0;
function noteIcon(value){if(!value)return '—';return `<button type="button" class="note-icon" data-action="note-popup" data-note="${esc(value)}" aria-label="View note">▤</button>`;}
function actionButton(r,index=null){const menu='row-menu-'+(++rowMenuSerial),unit=index!==null,attr=`data-id="${r.id}"${unit?` data-index="${index}"`:''}`;return `<button type="button" class="row-menu-toggle" popovertarget="${menu}" aria-label="Actions for ${esc(unit?'phone '+r.instances[index].inv:name(r))}">⋯</button><div id="${menu}" popover class="row-menu"><strong>${esc(unit?'Phone #'+r.instances[index].inv:name(r))}</strong><button data-action="${unit?'edit-unit':'edit'}" ${attr}>Edit</button><button data-action="${unit?'copy-unit':'copy-model'}" ${attr}>Copy</button><button class="danger" data-action="${unit?'delete-unit':'delete-record'}" ${attr}>${unit?'Move this phone to trash':r.kind==='phone'?'Move entire model to trash':'Move part to trash'}</button></div>`;}
function showNotePopup(target){let tip=$('note-tooltip');if(!tip){tip=document.createElement('div');tip.id='note-tooltip';tip.setAttribute('popover','manual');tip.setAttribute('role','tooltip');document.body.append(tip);}tip.textContent=target.dataset.note;tip.showPopover();const rect=target.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-tip.offsetWidth-8))+'px';tip.style.top=Math.max(8,Math.min(rect.bottom+6,window.innerHeight-tip.offsetHeight-8))+'px';}
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideNotePopup();});
window.addEventListener('resize',()=>hideNotePopup());
document.addEventListener('scroll',()=>hideNotePopup(),true);
function hideNotePopup(){const tip=$('note-tooltip');if(tip?.hidePopover)tip.hidePopover();}
document.addEventListener('pointerover',e=>{const t=e.target.closest?.('.note-icon');if(t)showNotePopup(t);});
document.addEventListener('pointerout',e=>{if(e.target.closest?.('.note-icon'))hideNotePopup();});
document.addEventListener('focusin',e=>{if(e.target.closest?.('.note-icon'))showNotePopup(e.target);});
document.addEventListener('focusout',e=>{if(e.target.closest?.('.note-icon'))hideNotePopup();});
document.addEventListener('click',e=>{if(!e.target.closest?.('.note-icon'))hideNotePopup();});
function copyModel(id){if(phoneDraft&&!confirm('Replace the saved phone draft with this model?'))return;draft=clone(record(id));delete draft.id;delete draft.rev;draft.model='';draft.declared_qty=0;draft.instances=draft.kind==='phone'?[blankUnit()]:[];draft.quantity=0;draft.reserved=0;mode=draft.kind==='phone'?'add':'part';phoneDraft=null;dirty=true;editorRender(0);$('editor').showModal();toast('Copy ready. Enter a different model name.');}
function unitImage(r,u){const own=(u.photos||[])[0],src=own||r.image||(r.photos||[])[0];return src?`<img class="thumb" src="${esc(src)}" alt="${esc(u.inv)}" title="${own?'Unit photo':'Model catalog image'}" data-action="photo" data-url="${esc(src)}">${own?`<small>${u.photos.length} ${u.photos.length===1?'photo':'photos'}</small>`:'<small>Catalog</small>'}`:'<span class="thumb-placeholder" aria-label="No photo">▯</span>';}
function copyUnit(id,index){if(phoneDraft&&!confirm('Replace the saved phone draft with this copy?'))return;phoneDraft=null;mode='add';draft=clone(record(id));addUnit=clone(draft.instances[index]);for(const key of ['id','inv','imei','imei2','serial'])delete addUnit[key];addUnit.inv=nextInventoryNumber();addUnit.photos=[];draft.instances.push(addUnit);dirty=true;editorRender(draft.instances.length-1);$('editor').showModal();$('editor').scrollTop=0;toast('Copy ready. Enter the IMEI and review the new unit details.');}
function unitTiles(r){return `<div class="unit-list">${(r.instances||[]).map((u,i)=>`<article class="unit-line"><div class="unit-photo">${unitImage(r,u)}</div><div class="unit-overview">${selectionBox(r,u)}<strong>${esc(u.inv)}</strong>${checkSummary(r,u)}<span>${catalogLink('color',u.color)} · ${esc(enumLabel(u.edition))||'Standard'}</span></div><div><small>Condition</small>${stateHTML(u.state)}<small>${esc(enumLabel(u.condition))}</small></div><div><small>IMEI</small>${u.imei?esc(u.imei.slice(0,3)+'••••'+u.imei.slice(-4)):'—'}</div><div><small>Box / battery</small>${triLabel(u.box)} / ${triLabel(u.battery_present)}</div><div><small>Location</small>${catalogLink('location',u.location)}</div><div class="unit-actions">${actionButton(r,i)}</div></article>`).join('')||'<p>No units yet.</p>'}</div>`;}
function modelActions(r,showAcquire=true){return `<div class="row-actions">${showAcquire?acquireButton(r):''}<button class="primary" data-action="add-existing" data-id="${r.id}">+ Add another</button><button data-action="repairs" data-id="${r.id}">Repairs</button><button data-action="labels" data-id="${r.id}">QR labels</button><button data-action="history" data-id="${r.id}">History</button>${actionButton(r)}</div>`;}
function unitCell(r,u,i,key){return checkCell(r,u,key,rawUnitCell(r,u,i,key));}
function rawUnitCell(r,u,i,key){
 if(key==='select')return selectionBox(r,u);if(key==='completeness')return completenessHTML(u);
 const quickKey={colors:'color',editions:'edition',state:'state',location:'location',box:'box',os:'os'}[key];
 if(quickKey)return quickButton(r,u,i,quickKey,key==='box'?triLabel(u.box):key==='state'?stateHTML(u.state):esc(enumLabel(u[quickKey]||(key==='os'?r.os:''))));
 const effective={...r,...Object.fromEntries(['alias','type','os','gsm','wiki'].map(k=>[k,u[k]||r[k]||''])),instances:[u]};
 if(key==='image')return `<div class="model-image-cell"><span class="expand-spacer"></span><button class="unit-photo unit-open" data-action="unit-details" data-id="${r.id}" data-index="${i}">${unitImage(r,u).replace(/data-action="photo"/g,'')}</button></div>`;
 if(key==='model')return `<strong>${esc(r.model)}</strong>${checkSummary(r,u)}<small>${esc(forParts(u)?'For parts':enumLabel(u.condition))}</small>`;
 if(key==='actions')return `<div class="unit-actions">${actionButton(r,i)}</div>`;
 if(key==='colors')return catalogLink('color',u.color);
 if(key==='editions')return esc(enumLabel(u.edition)||'Standard');
 if(key==='inv')return `<button class="link" data-action="unit-details" data-id="${r.id}" data-index="${i}">${esc(u.inv)||'—'}</button>${u.imei?`<small title="IMEI">${esc(u.imei.slice(0,3)+'••••'+u.imei.slice(-4))}</small>`:''}`;
 if(key==='box')return triLabel(u.box);
 if(key==='qty')return '1';
 if(key==='parts')return '—';
 if(key==='rating')return u.rating?`<span class="stars">★ ${esc(u.rating)}</span>`:'—';
 if(key==='state')return esc(enumLabel(u.state))||'—';
 if(key==='location')return catalogLink('location',u.location);
 if(key==='product_code')return esc(u.product_code)||'—';
 if(key==='note')return noteIcon(u.note);
 if(key==='owned')return ACTIVE.includes(u.condition)?'<span class="good">✓</span>':'—';
 return rawCell(effective,key);
}
function unitExtra(r,u,i){return `<div class="unit-extra">${unitOnlyColumns.map(k=>`<div class="unit-field"><small>${esc(columns.find(c=>c[0]===k)[1])}</small>${unitCell(r,u,i,k)}</div>`).join('')}${forParts(u)?'<span class="parts-tag">For parts</span>':''}</div>`;}
function expandedRow(r,visible){
 if(r.kind!=='phone')return '';
 const keys=unique([...visible.filter(k=>k!=='actions'),...unitOnlyColumns,'actions']);
 return `<tr class="row-expanded"><td colspan="${visible.length}"><div class="unit-scroll" role="region" aria-label="Individual phones for ${esc(name(r))}" tabindex="0"><table class="unit-details-table"><thead><tr>${keys.map(k=>`<th>${esc(columns.find(c=>c[0]===k)?.[1]||k)}</th>`).join('')}</tr></thead><tbody>${shownUnits(r).map(u=>{const i=r.instances.indexOf(u);return `<tr class="unit-table-row">${keys.map(k=>`<td data-column="${k}">${unitCell(r,u,i,k)}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div>${modelActions(r)}</td></tr>`;
}
function mobileModel(r){return `<article class="mobile-model"><div class="mobile-model-heading">${cell(r,'image')}<button class="mobile-model-name" data-action="${r.kind==='phone'?'expand':'edit'}" data-id="${r.id}"><strong>${esc(name(r))}</strong>${isWanted(r)?'<small class="wanted-tag">Wanted</small>':''}<small>${esc([r.alias,r.type].filter(Boolean).join(' · '))}</small></button><span class="number-pill">${value(r,'qty')}</span></div>${checkSummary(r)}${acquireButton(r)}<p class="mobile-model-meta">${esc([value(r,'colors'),value(r,'editions')].filter(Boolean).join(' · '))}</p>${expanded.has(r.id)&&r.kind==='phone'?`<div class="mobile-units">${shownUnits(r).map(u=>{const i=r.instances.indexOf(u),keys=unique(['inv','colors','editions','state','location','box','rating','alias','type','os','battery','charger','gsm','wiki','note',...db.settings.columns]).filter(k=>!['select','image','model','brand','actions','qty','parts','owned','completeness'].includes(k));return `<section class="mobile-unit"><div class="mobile-unit-heading">${unitImage(r,u)}${selectionBox(r,u)}<strong>Unit ${esc(u.inv)||'—'}</strong>${forParts(u)?'<span>For parts</span>':''}</div>${checkSummary(r,u)}<div class="mobile-unit-fields">${keys.map(k=>`<div class="unit-field"><small>${esc(columns.find(c=>c[0]===k)?.[1]||k)}</small>${unitCell(r,u,i,k)}</div>`).join('')}</div>${unitCell(r,u,i,'actions')}</section>`;}).join('')}${modelActions(r,false)}</div>`:''}</article>`;}
function accessoryOptions(r,key){
 if(key==='battery_present')return unique([r.battery,...batteryAlternatives(r.battery).map(x=>x.name),...batterySuggestions(r.brand,r.model).filter(x=>!x.warning).map(x=>x.battery.name)]);
 if(key==='charger_present')return unique([r.charger,...chargerSuggestions(r).map(x=>x.name)]);
 return [];
}
function accessoryStock(r,key){
 const category=key==='battery_present'?'battery':key==='charger_present'?'charger':null;
 const codes=accessoryOptions(r,key).map(normal);
 return db.records.filter(p=>{if(p.kind!=='part'||!category)return false;const item=(db.catalog||[]).find(x=>x.id===p.catalog_item);
 return item?.category===category&&(codes.includes(normal(item.name))||(p.compatible||[]).includes(r.id)||(item.compatible||[]).includes(r.id));});
}
function completionReport(rows){const entries=rows.flatMap(r=>live(r).filter(needsCompletion).map(u=>({r,u})));return `<h2>What is missing?</h2><p class="subtle">Confirmed missing items for collection phones. Donor phones are excluded. Unknown fields are not treated as missing.</p><div class="completion-list">${entries.map(({r,u})=>{const c=completeness(u);return `<article><div>${unitImage(r,u)}</div><div><strong>${esc(name(r))} · ${esc(u.inv)}</strong><small>${esc([u.color,enumLabel(u.edition)].filter(Boolean).join(' · '))}</small><p>Missing: ${esc(c.missing.map(k=>unitFields[k]).join(', '))}</p>${c.missing.map(k=>{const options=accessoryOptions(r,k),stock=accessoryStock(r,k);return `<div class="missing-accessory"><strong>${esc(unitFields[k])}</strong>${options.length?`<p>Suitable: ${esc(options.join(' · '))}</p>`:'<p class="subtle">No compatible model recorded.</p>'}${stock.length?stock.map(p=>`<p><button class="link" data-action="edit" data-id="${p.id}">${esc(name(p))}</button> · ${Math.max(0,p.quantity-(p.reserved||0))} available · ${esc(p.location||'No location')}</p>`).join(''):'<p class="subtle">No matching linked stock recorded.</p>'}</div>`;}).join('')}<p class="subtle">To check: ${esc(c.unknown.map(k=>unitFields[k]).join(', ')||'None')}</p></div><button data-action="edit-unit" data-id="${r.id}" data-index="${r.instances.indexOf(u)}">Edit</button></article>`;}).join('')||'<p>No confirmed missing items. Mark an accessory as No in a phone’s details to include it here.</p>'}</div>`;}

function phoneCard(r){return `<article class="phone-card"><div class="card-image">${image(r)}<span class="card-qty">${esc(value(r,'qty'))} ${r.kind==='phone'?'units':'parts'}</span></div><div class="card-content"><small>${catalogLink('brand',r.brand)}</small><h2>${esc(r.model)}</h2>${checkSummary(r)}${isWanted(r)?'<small class="wanted-tag">Wanted</small>':''}${acquireButton(r)}<p>${esc(value(r,'colors')||r.part_category||'—')}</p><p class="subtle">${esc(value(r,'editions').split(', ').map(enumLabel).join(', '))}</p><dl><div><dt>Battery</dt><dd>${batteryCell(r.battery)}</dd></div><div><dt>Charger</dt><dd>${catalogLink('charger',r.charger)}</dd></div></dl><div class="actions">${actionButton(r)}${r.kind==='phone'?`<button class="primary" data-action="card-units" data-id="${r.id}">View units</button>`:`<button data-action="move" data-id="${r.id}">Stock</button>`}</div></div></article>`;}

function tableColumns(visible){
 const fixed={select:25,image:62,inv:48,actions:52},weights={model:1.3,alias:1.5,type:1,product_code:1.1,colors:1,editions:1.2,os:1.7,released:1.1,introduced:1.1,qty:.5,parts:.5,owned:.65,box:.8,gsm:.7,wiki:.7,note:.6};
 const pixels=visible.reduce((n,k)=>n+(fixed[k]||0),0),total=visible.reduce((n,k)=>n+(fixed[k]?0:weights[k]||1),0);
 return `<colgroup>${visible.map(k=>{const share=(weights[k]||1)/total;return `<col style="width:${fixed[k]?fixed[k]+'px':`calc(${share*100}% - ${share*pixels}px)`}">`;}).join('')}</colgroup>`;
}
const collectionLayouts=[['list','Classic','Original table and mobile list.'],['grouped','Grouped','Model specifications once, with individual phones underneath.'],['split','Split view','Choose a model on the left and inspect its phones on the right.'],['model-cards','Model cards','A card per model with expandable phone details.'],['compact','Compact groups','Short model headers and dense rows for larger collections.'],['gallery','Photo gallery','Large personal photos of individual phones, grouped by model.'],['cards','Classic cards','The original card layout.']];
let collectionLayout='list',splitModelId=null;
try{const savedLayout=localStorage.getItem('mpl-collection-layout');if(collectionLayouts.some(([key])=>key===savedLayout))collectionLayout=savedLayout;}catch{}
function setCollectionLayout(value){
 if(!collectionLayouts.some(([key])=>key===value))return;
 if(quickEdit)throw Error('Save or cancel the current cell edit before changing layout.');
 collectionLayout=value;try{localStorage.setItem('mpl-collection-layout',value);}catch{toast('Layout changed for this session. Device storage is unavailable.');}
 render();
}
function layoutPicker(){return `<label>Collection layout — this device<select id="default-layout">${collectionLayouts.map(([key,label])=>`<option value="${key}" ${collectionLayout===key?'selected':''}>${label}</option>`).join('')}</select></label><p class="subtle">Applies immediately on this device only. Classic is the default. Your collection data is unchanged.</p><div class="layout-choices">${collectionLayouts.map(([key,label,description])=>`<button type="button" data-action="layout" data-layout="${key}" aria-pressed="${collectionLayout===key}"><span class="layout-sketch sketch-${key}" aria-hidden="true"><i></i><i></i><i></i></span><strong>${label}</strong><small>${description}</small></button>`).join('')}</div>`;}
function modelSpecifications(r){return `<div class="model-specifications">${[['Variant',r.alias],['Type',r.type],['Battery',r.battery],['Charger',r.charger],['OS',r.os]].filter(([,v])=>v).map(([k,v])=>`<span><small>${k}</small>${checkCell(r,null,{Variant:"alias",Type:"type",Battery:"battery",Charger:"charger",OS:"os"}[k],esc(v))}</span>`).join('')}</div>`;}
function layoutUnit(r,u){const i=r.instances.indexOf(u),overrides=['alias','type','os'].filter(k=>u[k]&&u[k]!==r[k]);return `<article class="layout-unit"><div class="layout-unit-photo">${unitImage(r,u)}</div><div class="layout-unit-name">${selectionBox(r,u)} <button class="link" data-action="unit-details" data-id="${r.id}" data-index="${i}">#${esc(u.inv)||'—'} · ${checkCell(r,u,"color",esc(u.color||"No color"))}</button><small>${esc(enumLabel(u.edition)||'Standard')} · ${esc(enumLabel(u.condition))}</small>${overrides.map(k=>`<small>${esc(k)}: ${checkCell(r,u,k,esc(u[k]))}</small>`).join('')}</div><div>${checkCell(r,u,"state",stateHTML(u.state))}<small>${checkCell(r,u,"location",esc(u.location||"No location"))}</small></div><div class="layout-unit-accessories"><small>Box ${checkCell(r,u,"box",triLabel(u.box))}</small><small>Battery ${checkCell(r,u,"battery_present",triLabel(u.battery_present))}</small></div><div class="layout-unit-actions">${checkSummary(r,u)}${actionButton(r,i)}</div></article>`;}
function layoutModel(r,style,forceOpen=false){
 if(r.kind==='part')return `<section class="layout-model"><div class="layout-model-heading">${image(r)}<div class="layout-model-title"><small>PART / ACCESSORY</small><strong>${esc(name(r))}</strong></div>${checkSummary(r)}<span class="number-pill">${r.quantity} parts</span><button data-action="edit" data-id="${r.id}">Edit</button><button data-action="move" data-id="${r.id}">Stock</button></div><div class="model-specifications"><span><small>Available</small>${r.quantity-(r.reserved||0)}</span><span><small>Location</small>${esc(r.location)||'—'}</span><span><small>Condition</small>${esc(enumLabel(r.condition))||'—'}</span></div></section>`;
 const units=shownUnits(r),open=forceOpen||expanded.has(r.id);
 return `<section class="layout-model ${style==='gallery'?'photo-model':''}"><div class="layout-model-heading">${image(r)}<button class="layout-model-title" data-action="expand" data-id="${r.id}" aria-expanded="${open}"><small>${esc(r.brand)} · MODEL${isWanted(r)?' · Wanted':''}</small><strong>${esc(r.model)}</strong></button><span class="number-pill">${live(r).length} phones</span><button data-action="edit" data-id="${r.id}">Model details</button></div>${checkSummary(r)}${modelSpecifications(r)}${acquireButton(r)}${open?`<div class="layout-model-units ${style==='gallery'?'photo-units':''}">${units.map(u=>layoutUnit(r,u)).join('')||'<p class="subtle">No individual phones yet.</p>'}</div><div class="layout-model-tools"><button class="primary" data-action="add-existing" data-id="${r.id}">${isWanted(r)?'Acquire phone':'+ Add phone'}</button><button data-action="history" data-id="${r.id}">History</button></div>`:`<button class="layout-open" data-action="expand" data-id="${r.id}">Show ${units.length} individual phones ▾</button>`}</section>`;
}
function renderCollectionLayouts(rows){const host=$('alternative-layout');if(!host)return;
 const alternative=!['list','cards'].includes(collectionLayout)&&currentView!=='incomplete';host.hidden=!alternative||!rows.length;
 if(!alternative){host.innerHTML='';return;}
 $('table-wrap').hidden=true;$('card-grid').hidden=true;$('mobile-list').hidden=true;
 host.className='collection-layout layout-'+collectionLayout;
 if(collectionLayout==='split'){
  if(!rows.some(r=>r.id===splitModelId))splitModelId=rows[0]?.id;
  const chosen=rows.find(r=>r.id===splitModelId);
  host.innerHTML=`<nav class="model-browser" aria-label="Choose model">${rows.map(r=>`<button data-action="split-model" data-id="${r.id}" aria-pressed="${r.id===splitModelId}">${esc(name(r))}<small>${r.kind==='phone'?live(r).length+' phones':r.quantity+' parts'}${isWanted(r)?' · Wanted':''}</small></button>`).join('')}</nav><div class="model-browser-detail">${chosen?layoutModel(chosen,'grouped',true):''}</div>`;
 }else host.innerHTML=rows.map(r=>layoutModel(r,collectionLayout)).join('');
}

function savedFiltersPanel(){panel('Saved filters',`<p>Save the current search, filters, wishlist visibility and sorting.</p><div class="actions"><label>Filter name<input id="saved-filter-name" maxlength="100" placeholder="e.g. Nokia on shelf"></label><button data-action="save-view">Save current filter</button></div><div class="settings-list">${(db.settings.views||[]).map((v,i)=>`<div class="setting-row"><span>${esc(v.name)}<small>${esc(v.query||v.filter||'All phones')}</small></span><button data-action="apply-saved-filter" data-index="${i}">Open</button><button data-action="delete-saved-filter" data-index="${i}">Delete</button></div>`).join('')||'<p>No saved filters yet.</p>'}</div>`,{kind:'saved-filters'});}
function applySavedFilter(i){const v=db.settings.views?.[i];if(!v)return;currentView=v.filter||'all';quickFilters={...(v.quickFilters||{})};showWanted=!!v.showWanted;sort=v.sort&&columns.some(c=>c[0]===v.sort.key)?{key:v.sort.key,dir:v.sort.dir===-1?-1:1}:{key:'brand',dir:1};$('search').value=v.query||'';panelDirty=false;$('panel').close();panelRoute=null;render();}
function locationEntries(id){return db.records.flatMap(r=>r.kind==='part'?(inLocation(r.location,id)?[{r,u:null}]:[]):live(r).filter(u=>inLocation(u.location,id)).map(u=>({r,u})));}
function locationsPanel(){const locations=(db.catalog||[]).filter(x=>x.category==='location').sort((a,b)=>locationPath(a).localeCompare(locationPath(b)));panel('Locations',`<p>Counts include nested locations and phones in your collection.</p><div class="actions"><button data-action="catalog-list" data-category="location">Manage locations</button><button data-action="location-unassigned">Without a location</button></div><div class="settings-list">${locations.map(l=>{const rows=locationEntries(l.id);return `<div class="setting-row"><span><strong>${esc(locationPath(l))}</strong><small>${rows.filter(x=>x.u).length} phones · ${rows.filter(x=>!x.u).reduce((n,x)=>n+Number(x.r.quantity||0),0)} parts</small></span><button data-action="location-contents" data-id="${l.id}">View contents</button></div>`;}).join('')||'<p>No locations yet. Add a location through Manage locations.</p>'}</div>`,{kind:'locations'});}
function locationUnassigned(){const rows=db.records.flatMap(r=>r.kind==='part'?(!r.location?[{r,u:null}]:[]):live(r).filter(u=>!u.location).map(u=>({r,u})));panel('Without a location',`<button data-action="locations">All locations</button><div class="settings-list">${rows.map(({r,u})=>`<div class="setting-row"><span>${esc(name(r))} · ${esc(u?u.inv:r.quantity+' parts')}</span><button data-action="${u?'edit-unit':'edit'}" data-id="${r.id}" data-index="${u?r.instances.indexOf(u):0}">Edit</button></div>`).join('')||'<p>Everything has a location.</p>'}</div>`);}
function compareUnits(){const entries=db.records.flatMap(r=>(r.instances||[]).filter(u=>selectedUnits.has(u.id)).map(u=>({r,u})));if(entries.length<2||entries.length>20)throw Error('Select 2 to 20 phones to compare. Different models are welcome.');const fields=[['Brand',(u,r)=>r.brand],['Model',(u,r)=>r.model],['Battery',(u,r)=>r.battery],['Charger',(u,r)=>r.charger],['Color',u=>u.color],['Edition',u=>enumLabel(u.edition)],['Condition',u=>enumLabel(u.state)],['Ownership',u=>enumLabel(u.condition)],['Cosmetic rating',u=>u.rating],['Location',u=>u.location],['Variant',(u,r)=>u.alias||r.alias],['Type code',(u,r)=>u.type||r.type],['Operating system',(u,r)=>u.os||r.os],...accessoryFields.map(k=>[unitFields[k],u=>u[k]===true?'Yes':u[k]===false?'No':'Not checked']),['Purchased',u=>u.purchase_date],['Source',u=>u.source],['Purchase price',u=>u.price+' '+amountCurrency(u)],['Estimated value',u=>u.value+' '+amountCurrency(u)],['Notes',u=>u.note]];panel('Compare — '+entries.length+' phones',`<p>Differences are highlighted.</p><div class="comparison-scroll"><table class="comparison-table"><thead><tr><th>Property</th>${entries.map(({r,u})=>`<th>${unitImage(r,u)}<strong>${esc(name(r))}</strong><strong>#${esc(u.inv)}</strong><button data-action="edit-unit" data-id="${r.id}" data-index="${r.instances.indexOf(u)}">Edit</button></th>`).join('')}</tr></thead><tbody>${fields.map(([label,get])=>{const values=entries.map(({u,r})=>String(get(u,r)??''));return `<tr class="${new Set(values).size>1?'comparison-different':''}"><th>${esc(label)}</th>${values.map(v=>`<td>${esc(v)||'—'}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div>`,{kind:'compare'});}
function renderWishlistOverview(){const host=$('wishlist-overview');if(!host)return;host.hidden=currentView!=='wish';if(host.hidden)return;const priorities={High:0,Medium:1,Low:2};const rows=filtered().filter(isWanted).sort((a,b)=>(priorities[a.wish_priority]??3)-(priorities[b.wish_priority]??3));host.innerHTML=`<div class="wishlist-plans">${rows.map(r=>`<article><strong>${esc(name(r))}</strong><span>${esc(r.wish_priority||'Priority not set')}</span><span>${r.wish_price!=null&&r.wish_price!==''?'Target: '+esc(r.wish_price)+' '+esc(amountCurrency(r)):'Target price not set'}</span><p>${esc(r.wish_note||'')}</p><button data-action="edit" data-id="${r.id}">Edit wishlist details</button>${acquireButton(r)}</article>`).join('')}</div>`;}

function render(){renderFilters();renderWishlistOverview();document.documentElement.dataset.checkFocus=String(checkFocus);if($('check-toggle')){$('check-toggle').setAttribute('aria-pressed',String(checkFocus));$('check-toggle').textContent='To check'+(checkFocus?' · ON':'');}
 if($('wanted-toggle')){$('wanted-toggle').hidden=!['all','phone'].includes(currentView);$('wanted-toggle').textContent=showWanted?'Hide wanted list':'Show wanted list';$('wanted-toggle').setAttribute('aria-pressed',String(showWanted));}
 if($('add-wanted'))$('add-wanted').hidden=currentView!=='wish';
 if($('heading-add-phone'))$('heading-add-phone').hidden=currentView==='wish';
 if($('page-title'))$('page-title').textContent=currentView==='wish'?'Wishlist':currentView==='incomplete'?'What is missing?':'My collection';
 const activeFilters=Object.values(quickFilters).filter(Boolean).length;if($('filter-toggle'))$('filter-toggle').textContent='Filters'+(activeFilters?' ('+activeFilters+')':'');
 if(quickEdit)return;
 selectedUnits=new Set([...selectedUnits].filter(id=>db.records.some(r=>(r.instances||[]).some(u=>u.id===id))));
 if($('bulk-count'))$('bulk-count').textContent=selectedUnits.size+' selected';
 document.querySelectorAll('[data-action="nav-view"]').forEach(el=>el.classList.toggle('active',el.dataset.view===currentView));
 const rows=filtered(), visible=db.settings.columns.filter(k=>columns.some(c=>c[0]===k)&&!unitOnlyColumns.includes(k));
 for(const mandatory of ['select','image','model','qty','actions'])if(!visible.includes(mandatory))visible.push(mandatory);
 visible.splice(visible.indexOf('image'),1);visible.unshift('image');visible.splice(visible.indexOf('select'),1);visible.unshift('select');
 $('collection-table').innerHTML=`${tableColumns(visible)}<thead><tr>${visible.map(k=>`<th scope="col" draggable="${k!=='image'}" data-column-key="${k}" title="${k==='image'?'Image and expand control stay first':'Drag to reorder; click to sort'}" data-sort="${k}">${esc(columns.find(c=>c[0]===k)[1])}${sort.key===k?(sort.dir===1?' ↑':' ↓'):''}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${visible.map(k=>`<td data-column="${k}" class="${k==='model'?'model-cell':['colors','editions','state','note','location','type'].includes(k)?'wrap':''}">${cell(r,k)}</td>`).join('')}</tr>${expanded.has(r.id)?expandedRow(r,visible):''}`).join('')}</tbody>`;
 $('table-wrap').hidden=!rows.length||collectionLayout==='cards';$('card-grid').hidden=collectionLayout!=='cards'||!rows.length;$('card-grid').innerHTML=collectionLayout==='cards'?rows.map(phoneCard).join(''):'';document.querySelectorAll('[data-action="layout"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layout===(collectionLayout||'list'))));$('empty').hidden=rows.length>0;if(!rows.length&&$('empty').querySelector('h2')){$('empty').querySelector('h2').textContent=currentView==='wish'?'Your wishlist is empty':'No matching collection entries';$('empty').querySelector('p').textContent=currentView==='wish'?'Add a phone you would like to own. It stays separate until you acquire it.':'Add a phone, change the filters or show the wanted list.';}
 if($('mobile-list')){$('mobile-list').innerHTML=rows.map(mobileModel).join('');$('mobile-list').hidden=collectionLayout==='cards'||!rows.length||currentView==='incomplete';}
 if($('completion-report')){$('completion-report').hidden=currentView!=='incomplete';if(currentView==='incomplete'){$('completion-report').innerHTML=completionReport(rows);$('table-wrap').hidden=true;$('card-grid').hidden=true;}}
 renderCollectionLayouts(rows);
 const phones=db.records.filter(r=>r.kind==='phone'&&!wantedOnly(r)), units=phones.flatMap(live),parts=db.records.filter(r=>r.kind==='part');
 $('summary').innerHTML=[[phones.length,'models'],[units.length,'phones'],[parts.reduce((s,r)=>s+r.quantity,0),'parts / accessories'],[units.filter(u=>u.state==='Ispravan').length,'working'],[units.filter(u=>u.state==='Netestiran').length,'untested']].map(([v,l])=>`<div><strong>${v}</strong><span>${l}</span></div>`).join('');
 $('results').textContent=`${rows.length} / ${db.records.length} rows`;$('footer-count').textContent='MyPhoneLibrary '+db.version+' · '+new Date().toLocaleTimeString('en-GB');
}
function triLabel(v){return v===true?'✓ Yes':v===false?'No':'?';}
function catalogCombo(category,value,attr='',required=false){
 const id='catalog-options-'+(++comboSerial);
 return `<div class="catalog-combo" data-category="${esc(category)}" data-original="${esc(value||'')}"><input type="hidden" ${attr} value="${esc(value||'')}"><div class="combo-input"><input placeholder="${esc(fieldExamples[category]?'e.g. '+fieldExamples[category]:'Choose '+catalogNames[category])}" data-combo-query role="combobox" aria-label="${esc(catalogNames[category])}" aria-autocomplete="list" aria-controls="${id}" aria-expanded="false" autocomplete="off" value="${esc(value||'')}" ${required?'required':''}><button type="button" data-action="combo-toggle" aria-label="Show ${esc(catalogNames[category])}">▾</button></div><div id="${id}" class="combo-menu" role="listbox" hidden></div></div>`;
}
function closeCombos(){document.querySelectorAll('.catalog-combo').forEach(c=>{c.querySelector('.combo-menu').hidden=true;c.querySelector('[data-combo-query]').setAttribute('aria-expanded','false');});}
function openCombo(c,all=false){closeCombos();const q=c.querySelector('[data-combo-query]'),menu=c.querySelector('.combo-menu'),items=(db.catalog||[]).filter(x=>x.category===c.dataset.category&&(all||normal(x.name).includes(normal(q.value))));menu.innerHTML=items.map(x=>`<button type="button" role="option" data-action="combo-select" data-value="${esc(x.name)}">${esc(x.name)}</button>`).join('')||'<p class="subtle">No matching catalog items. Add an item to Catalogs first.</p>';if(!q.required)menu.innerHTML+='<button type="button" role="option" data-action="combo-select" data-value="">— None</button>';menu.hidden=false;q.setAttribute('aria-expanded','true');}
function syncCombo(c){const q=c.querySelector('[data-combo-query]'),bound=c.querySelector('input[type="hidden"]'),item=(db.catalog||[]).find(x=>x.category===c.dataset.category&&normal(x.name)===normal(q.value));const valid=!q.value.trim()||!!item||q.value===c.dataset.original;q.setCustomValidity(valid?'':'Select an existing catalog item. Add new items to Catalogs first.');if(valid)bound.value=item?item.name:q.value.trim();return valid;}
function validateCombos(root){for(const c of root.querySelectorAll('.catalog-combo'))if(!syncCombo(c)){c.querySelector('[data-combo-query]').reportValidity();return false;}return true;}
function sidebarState(collapsed){document.documentElement.dataset.sidebar=collapsed?'collapsed':'expanded';document.querySelectorAll('[data-action="toggle-sidebar"]').forEach(b=>{b.setAttribute('aria-expanded',String(!collapsed));b.title=collapsed?'Show navigation':'Hide navigation';});try{localStorage.setItem('mpl-sidebar',collapsed?'collapsed':'expanded');}catch{}}
function restoreSidebar(){try{sidebarState(localStorage.getItem('mpl-sidebar')==='collapsed');}catch{sidebarState(false);}}
let checkFocus=false;
const checkNames={brand:'Brand',model:'Model',alias:'Model number / Variant',type:'Type code',os:'Operating system',battery:'Battery',charger:'Charger',color:'Color',edition:'Edition',inv:'Inventory number',product_code:'Product code',imei:'IMEI',imei2:'IMEI 2',serial:'Serial number',firmware:'Firmware',memory:'Memory',state:'Working condition',condition:'Ownership / condition',purpose:'Purpose',for_parts:'Donor phone',rating:'Cosmetic rating',location:'Location',box:'Box',battery_present:'Battery included',charger_present:'Charger included',manual:'Manual',headphones:'Headphones',matching_box:'Matching box IMEI',purchase_date:'Acquisition date',source:'Source',price:'Purchase price',value:'Estimated value',currency:'Currency',lock:'Lock status',note:'Notes',image:'Model image',photos:'Photos',gsm:'GSMArena',wiki:'Wikipedia',introduced:'Introduced',released:'Released',favorite:'Favorite',wishlist:'Wishlist',wish_priority:'Wishlist priority',wish_price:'Target price',wish_note:'Wishlist notes',part_category:'Part category',catalog_item:'Catalog item',quantity:'Quantity',compatible:'Compatibility',declared_qty:'Declared quantity',declared_parts:'Declared parts'};
const checkFields=o=>Array.isArray(o?.to_check)?o.to_check:[];
function checkLabel(key){return key.startsWith('custom:')?db.settings.custom_fields?.find(f=>f.id===key.slice(7))?.label||key.slice(7):checkNames[key]||key;}
function checkSummary(r,u=null){const fields=u?checkFields(u):unique([...checkFields(r),...(r.instances||[]).flatMap(checkFields)]);if(!fields.length)return '';return `<button type="button" class="check-badge" data-action="review-checks" data-id="${r.id}" ${u?`data-unit="${u.id}"`:''} title="${esc(fields.map(checkLabel).join(', '))}">To check · ${fields.length}</button>`;}
function checkCell(r,u,key,html){const field={colors:'color',editions:'edition',owned:'condition',image:u?'photos':'image',qty:'quantity'}[key]||key;const marked=(u?checkFields(u):checkFields(r)).includes(field)||(!u&&(r.instances||[]).some(x=>checkFields(x).includes(field)))||(u&&['brand','model','battery','charger','alias','type','os','gsm','wiki','introduced','released'].includes(field)&&checkFields(r).includes(field));return marked?`<span class="check-value" title="To check: ${esc(checkLabel(field))}">${html}<small class="check-label">To check</small></span>`:html;}
function reviewChecks(id,unitId){const r=record(id);if(!r)return;const entries=[...(!unitId?[{o:r,u:null}]:[]),...(r.instances||[]).filter(u=>!unitId||u.id===unitId).map(u=>({o:u,u}))].filter(({o})=>checkFields(o).length);panel('To check — '+name(r),`<p>Open the entry, verify the marked fields, uncheck To check and save. The toolbar button only changes highlighting.</p>${entries.map(({o,u})=>`<section class="check-review"><h3>${u?'Phone #'+esc(u.inv):'Model / part'}</h3><ul>${checkFields(o).map(k=>`<li>${esc(checkLabel(k))}</li>`).join('')}</ul><button data-action="${u?'edit-unit':'edit'}" data-id="${r.id}" data-index="${u?r.instances.indexOf(u):0}">Open marked fields</button></section>`).join('')||'<p>No fields need checking.</p>'}`,{kind:'checks'});}
function installCheckControls(){const root=$('editor-content');if(!root?.querySelectorAll)return;const controls=[...root.querySelectorAll('[data-r],[data-u],[data-effective],[data-custom]')];if(!controls.length)return;for(const input of controls){const label=input.closest('label');if(!label||label.closest('.checkable-field'))continue;const key=input.dataset.custom?'custom:'+input.dataset.custom:input.dataset.r||input.dataset.u||input.dataset.effective;let index=input.dataset.u!==undefined?Number(input.dataset.index):null;if(input.dataset.effective&&draft.id&&mode!=='wish')index=checkFields(draft).includes(key)&&!checkFields(draft.instances[editorUnitIndex]).includes(key)?null:editorUnitIndex;const owner=index===null?draft:draft.instances[index];if(!owner)continue;const wrapper=document.createElement('div');wrapper.className='checkable-field';label.before(wrapper);wrapper.append(label);const marker=document.createElement('label');marker.className='field-check-toggle';marker.innerHTML=`<input type="checkbox" data-check-field="${esc(key)}" data-check-index="${index===null?'model':index}" aria-label="To check: ${esc(checkLabel(key))}" ${checkFields(owner).includes(key)?'checked':''}>To check`;wrapper.append(marker);}
 const extra=document.createElement('div');extra.className='extra-check-fields';extra.innerHTML='<strong>Other checks</strong>'+[['image',null],['photos',draft.kind==='phone'&&mode!=='wish'&&draft.instances[editorUnitIndex]?editorUnitIndex:null],...(draft.kind==='part'?[['compatible',null],['quantity',null]]:[])].filter(([key,index])=>!controls.some(c=>(c.dataset.r===key&&index===null)||(c.dataset.u===key&&Number(c.dataset.index)===index))).map(([key,index])=>`<label class="field-check-toggle"><input type="checkbox" data-check-field="${key}" data-check-index="${index===null?'model':index}" ${checkFields(index===null?draft:draft.instances[index]).includes(key)?'checked':''}>To check: ${esc(checkLabel(key))}</label>`).join('');root.append(extra);
 // Keep inherited or currently hidden model flags editable after acquisition.
 const represented=new Set([...root.querySelectorAll('[data-check-field]')].map(el=>el.dataset.checkIndex+':'+el.dataset.checkField));
 const owners=[['model',draft],...(draft.instances[editorUnitIndex]?[[String(editorUnitIndex),draft.instances[editorUnitIndex]]]:[])];
 for(const [index,owner] of owners)for(const key of checkFields(owner)){if(represented.has(index+':'+key))continue;const marker=document.createElement('label');marker.className='field-check-toggle';marker.innerHTML=`<input type="checkbox" data-check-field="${esc(key)}" data-check-index="${index}" checked>To check: ${index==='model'?'Model — ':''}${esc(checkLabel(key))}`;extra.append(marker);represented.add(index+':'+key);}
}
function readCheckControls(){for(const el of $('editor-content').querySelectorAll('[data-check-field]')){const owner=el.dataset.checkIndex==='model'?draft:draft.instances[Number(el.dataset.checkIndex)];if(!owner)continue;const keys=new Set(checkFields(owner));if(el.checked)keys.add(el.dataset.checkField);else keys.delete(el.dataset.checkField);owner.to_check=[...keys];}}

const fieldExamples={brand:'Nokia',model:'6500 Slide',alias:'6500s-1',type:'RM-240',os:'S40 5th Edition',battery:'BP-5M',charger:'2mm',color:'Silver',edition:'Music Edition',released:'2007',introduced:'2007-08-29',product_code:'0551234',imei:'123456789012345',memory:'20 MB',firmware:'V 10.00',location:'Shelf 1',source:'Local seller',note:'Small scratch on the back cover',wish_note:'Silver, with original box',gsm:'https://www.gsmarena.com/...',wiki:'https://en.wikipedia.org/wiki/...',image:'https://example.com/phone.jpg',price:'25',value:'40',wish_price:'50',inv:'1'};
function field(label,key,val,{index=null,type='text',list='',choices=null,required=false}={}){
 const attr=index===null?`data-r="${esc(key)}"`:`data-u="${esc(key)}" data-index="${index}"`;
 let control;
 if(choices){const a=choices.map(v=>Array.isArray(v)?v:[v,v]);if(val!==undefined&&val!==null&&val!==''&&!a.some(([v])=>String(v)===String(val)))a.unshift([val,val]);control=`<select ${attr}>${a.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(val??'')?'selected':''}>${esc(enumLabel(l))}</option>`).join('')}</select>`;}
 else if(type==='textarea')control=`<textarea ${attr} placeholder="${esc(fieldExamples[key]?'e.g. '+fieldExamples[key]:'Enter '+label.toLowerCase())}">${esc(val)}</textarea>`;
 else if(type==='checkbox')return `<label class="check"><input ${attr} type="checkbox" ${val?'checked':''}>${esc(label)}</label>`;
 else control=`<input ${attr} type="${type}" placeholder="${esc(fieldExamples[key]?(type==='number'?fieldExamples[key]:'e.g. '+fieldExamples[key]):'')}" value="${esc(val)}" ${list?`list="${esc(list)}"`:''} ${required?'required':''} ${type==='number'?'min="0" step="any"':''}>`;
 const category=list.startsWith('options-')?list.slice(8):null;
 if(category&&catalogNames[category])control=catalogCombo(category,val,attr,required);
 const heading=category&&catalogNames[category]?`<button type="button" class="link catalog-field-label" data-action="field-catalog" data-category="${category}">${esc(label)} ↗</button>`:esc(label);
 return `<label>${heading}${control}</label>`;
}
function triField(label,key,val,index){return field(label,key,val===true?'true':val===false?'false':'',{index,choices:[['','Nepoznato'],['true','Yes'],['false','No']]});}
function amountCurrency(obj){return !['KM','BAM',''].includes(obj.currency||'')&&(Number(obj.price)||Number(obj.value))?obj.currency:'KM';}
function nextInventoryNumber(){const used=new Set([...(db?.records||[]),...(draft?[draft]:[])].flatMap(r=>(r.instances||[]).map(u=>Number(u.inv))).filter(n=>Number.isInteger(n)&&n>0));let n=1;while(used.has(n))n++;return String(n);}
function blankUnit(){return {inv:nextInventoryNumber(),color:'',edition:'Standard',state:'Netestiran',condition:'U kolekciji',purpose:'Kolekcija',rating:0,location:'',currency:'KM',photos:[],box:null,battery_present:null,charger_present:null,manual:null,headphones:null,matching_box:null};}
function newRecord(kind='phone'){return {kind,brand:'',model:'',image:'',instances:[],photos:[],compatible:[],quantity:0,reserved:0,custom:{},specs:{},currency:'KM',rating:0};}
function record(id){return db.records.find(r=>r.id===id);}
function showEditor(id,unitIndex=null){editorUnitIndex=unitIndex??0;draft=clone(record(id));mode=isWanted(draft)&&unitIndex===null?'wish':'edit';addUnit=null;dirty=false;editorRender(unitIndex);$('editor').showModal();$('editor').scrollTop=0;}
function addPhone(id=null){
 if(id&&isWanted(record(id))){acquireWanted(id);return;}
 mode='add';
 if(phoneDraft&&(!id||phoneDraft.id===id)){draft=clone(phoneDraft);dirty=true;}
 else {if(phoneDraft&&!confirm('Replace the saved phone draft?'))return;draft=id?clone(record(id)):newRecord();draft.instances.push(blankUnit());dirty=false;}
 addUnit=draft.instances.at(-1);lists();editorRender(draft.instances.length-1);$('editor').showModal();$('editor').scrollTop=0;
}
function addWanted(){
 mode='wish';draft=newRecord();draft.wishlist=true;dirty=false;addUnit=null;lists();editorRender();$('editor').showModal();
}
function acquireWanted(id){
 draft=clone(record(id));mode='acquire';dirty=false;addUnit=null;
 const index=draft.instances.findIndex(u=>u.condition==='Wanted');
 if(index>=0){draft.instances[index].condition='U kolekciji';editorUnitIndex=index;}
 else{draft.instances.push(blankUnit());editorUnitIndex=draft.instances.length-1;}
 draft.wishlist=draft.instances.some(u=>u.condition==='Wanted');
 editorRender(editorUnitIndex);$('editor').showModal();$('editor').scrollTop=0;
}
function clearPhoneDraft(){
 if(uploadCount){toast('Wait for photos to finish uploading.');return;}
 if(!confirm('Clear all entered data and photos from this unsaved phone?'))return;
 phoneDraft=null;draft=newRecord();draft.instances.push(blankUnit());addUnit=draft.instances[0];dirty=false;editorRender(0);
}
function addPart(){mode='part';draft=newRecord('part');dirty=false;editorRender();$('editor').showModal();$('editor').scrollTop=0;}
function readDraft(){
 if(draft)readCheckControls();
 if(!draft)return;
 $('editor-content').querySelectorAll('[data-r]').forEach(el=>{const k=el.dataset.r;draft[k]=el.type==='checkbox'?el.checked:el.value;});
 $('editor-content').querySelectorAll('[data-u]').forEach(el=>{const u=draft.instances[Number(el.dataset.index)],k=el.dataset.u;if(!u)return;let v=el.type==='checkbox'?el.checked:el.value;if(['box','battery_present','charger_present','manual','headphones','matching_box'].includes(k))v=v==='true'?true:v==='false'?false:null;u[k]=v;if(k==='for_parts'){if(v)u.purpose='Donor';else if(u.purpose==='Donor')u.purpose='Kolekcija';}});
 $('editor-content').querySelectorAll('[data-effective]').forEach(el=>{const key=el.dataset.effective,u=draft.instances[editorUnitIndex];if(!u||mode==='wish'){draft[key]=el.value;return;}if(!draft.id){draft[key]=el.value;u[key]='';}else if(el.value!==(u[key]||draft[key]||'')){u[key]=el.value===draft[key]?'':el.value;}});
 $('editor-content').querySelectorAll('[data-custom]').forEach(el=>{draft.custom[el.dataset.custom]=el.type==='checkbox'?el.checked:el.value;});
 const compatibility=$('compatibility');if(compatibility)draft.compatible=[...compatibility.querySelectorAll('input:checked')].map(el=>el.value);
 if(mode==='add')addUnit=draft.instances.at(-1);
}
function matchModel(){
 if(!['add','wish'].includes(mode))return;readDraft();const b=draft.brand,m=draft.model;
 const match=db.records.find(r=>r.kind==='phone'&&normal(r.brand)===normal(b)&&normal(r.model)===normal(m));
 if((match?.id||null)===(draft.id||null))return;
 if(mode==='wish'){if(match){draft=clone(match);draft.wishlist=true;editorRender();dirty=true;}return;}
 const unit=clone(addUnit);draft=match?clone(match):Object.assign(newRecord(),{brand:b,model:m});draft.instances.push(unit);if(isWanted(draft)&&!draft.instances.some(u=>u.condition==='Wanted'))draft.wishlist=false;addUnit=unit;editorRender(draft.instances.length-1);dirty=true;
}
function unitHTML(u,i,open){return `
${field('Inventory number (blank = automatic)','inv',u.inv,{index:i})}${field('Color','color',u.color,{index:i,list:'options-color'})}${field('Edition','edition',u.edition,{index:i,list:'options-edition'})}
${field('IMEI','imei',u.imei,{index:i})}
${field('Product code','product_code',u.product_code,{index:i})}${field('Memory variant','memory',u.memory,{index:i})}${field('Installed firmware / OS','firmware',u.firmware,{index:i})}
${field('Working condition','state',u.state,{index:i,choices:opts.state})}${field('Cosmetic condition','rating',u.rating,{index:i,choices:[[0,'Not rated'],[1,'★ 1 / 5'],[2,'★★ 2 / 5'],[3,'★★★ 3 / 5'],[4,'★★★★ 4 / 5'],[5,'★★★★★ 5 / 5']]})}${field('Location','location',u.location,{index:i,list:'options-location'})}
${field('Purpose','purpose',u.purpose,{index:i,choices:opts.purpose})}<label class="check"><input type="checkbox" data-u="for_parts" data-index="${i}" ${forParts(u)?'checked':''}>For parts / donor phone</label>${field('Ownership status','condition',u.condition,{index:i,choices:opts.condition})}
${triField('Box','box',u.box,i)}${triField('Battery included','battery_present',u.battery_present,i)}${triField('Charger included','charger_present',u.charger_present,i)}${triField('Manual','manual',u.manual,i)}${triField('Headphones','headphones',u.headphones,i)}${triField('Box IMEI matches','matching_box',u.matching_box,i)}
${field('Acquisition date','purchase_date',u.purchase_date,{index:i,type:'date'})}${field('Purchased from / source','source',u.source,{index:i})}${field('Lock status','lock',u.lock||'Nepoznato',{index:i,choices:opts.lock})}
${field('Purchase price ('+amountCurrency(u)+')','price',u.price||0,{index:i,type:'number'})}${field('Estimated value ('+amountCurrency(u)+')','value',u.value||0,{index:i,type:'number'})}
<div class="span-all">${field('Notes','note',u.note,{index:i,type:'textarea'})}</div><div class="span-all phone-photos"><h3>Photos of this phone</h3>
<div class="gallery">${(u.photos||[]).map((src,j)=>`<figure><img src="${esc(src)}" alt="Unit photo" data-action="photo" data-url="${esc(src)}">${j===0?'<small class="good">Main photo</small>':`<button type="button" data-action="main-unit-photo" data-index="${i}" data-photo="${j}">Use as main</button>`}<button type="button" data-action="remove-unit-photo" data-index="${i}" data-photo="${j}">Remove</button></figure>`).join('')}</div><div class="actions" id="unit-photos-${i}"><button type="button" data-action="camera-unit" data-index="${i}">Take photo</button><button type="button" data-action="gallery-unit" data-index="${i}">From gallery</button><span class="subtle">Personal photos of this physical phone · ${(u.photos||[]).length}</span></div><input hidden id="camera-unit-${i}" type="file" accept="image/*" capture="environment" data-unit-upload="${i}"><input hidden id="gallery-unit-${i}" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple data-unit-upload="${i}">
<div class="completeness-summary">${completenessHTML(u)}</div></div>`;}
function editorRender(unitIndex=null){
 const part=draft.kind==='part',wish=mode==='wish';if(unitIndex!==null)editorUnitIndex=unitIndex;editorUnitIndex=Math.max(0,Math.min(editorUnitIndex,draft.instances.length-1));
 const u=draft.instances[editorUnitIndex];
 $('editor-title').textContent=part?(draft.id?'Edit part / accessory':'Add part / accessory'):mode==='add'?'Add phone':name(draft);
 $('save-add-another').hidden=part||wish||mode==='acquire';
 if(wish)$('editor-title').textContent=draft.id?'Wishlist — '+name(draft):'Add to wishlist';if(mode==='acquire')$('editor-title').textContent='Acquired — '+name(draft);
 $('editor-kicker').textContent=wish?'Wanted phone · no physical unit added':mode==='acquire'?'Moves to collection only after saving':'';$('record-save').textContent=mode==='add'?'Add phone':wish?'Save to wishlist':mode==='acquire'?'Add to collection':'Save changes';$('editor-error').textContent='';
 const rf=(l,k,o={})=>field(l,k,draft[k],o);
 const ef=(l,k,o={})=>part||wish||!u?rf(l,k,o):field(l,k,u?.[k]||draft[k]||'',o).replace(`data-r="${k}"`,`data-effective="${k}"`);
 const selector=!part&&!wish&&mode!=='add'&&draft.instances.length>1?`<label class="span-all">Phone<select id="editor-unit-select">${draft.instances.map((x,i)=>`<option value="${i}" ${i===editorUnitIndex?'selected':''}>${esc([x.inv,x.color,x.edition].filter(Boolean).join(' · '))}</option>`).join('')}</select></label>`:'';
 $('editor-content').innerHTML=`${mode==='add'?'<div class="actions"><button type="button" data-action="draft-catalogs">Catalogs</button><button type="button" data-action="clear-phone-data">Clear data</button></div>':''}
 <div class="phone-form-grid grid">${selector}<div class="photo-box">${draft.image?`<img src="${esc(draft.image)}" alt="Model image" data-action="photo" data-url="${esc(draft.image)}">`:'<span class="thumb-placeholder">▯</span>'}<label>Model image — list and cards<input id="main-image-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>${rf('Model image URL','image')}${draft.image?'<button type="button" data-action="remove-image">Remove model image</button>':''}</div>
 ${rf('Brand','brand',{list:'options-brand',required:!part})}${rf(part?'Part name':'Model name','model',{list:part?'':'model-suggestions',required:true})}
 ${ef('Model number / Variant','alias')}${ef('Type code','type')}
 ${part?rf('Catalog item','catalog_item',{choices:[['','None'],...(db.catalog||[]).filter(x=>['battery','charger','part_category'].includes(x.category)).map(x=>[x.id,x.name])]}):ef('Operating system','os',{list:'options-os'})}
 ${part?rf('Part category','part_category',{list:'options-part_category'}):''}${rf('Battery / code','battery',{list:'options-battery'})}${rf('Charger / connector','charger',{list:'options-charger'})}<div id="editor-battery-suggestions" class="span-all">${part?'':batterySuggestionsHTML(draft.brand,draft.model)}</div><div id="editor-charger-suggestions" class="span-all">${part?'':chargerSuggestionsHTML(draft)}</div><div id="editor-battery-alternatives" class="span-all subtle">${batteryAlternatives(draft.battery).length?'Compatible batteries: '+batteryAlternatives(draft.battery).map(x=>esc(x.name)).join(' · '):''}</div>
 ${rf('Released — year, month or date','released')}${rf('Introduced','introduced')}${ef('GSMArena link','gsm',{type:'url'})}${ef('Wikipedia link','wiki',{type:'url'})}
 ${!part?'<div class="span-all"><button type="button" data-action="gsm-preview">Get data from GSMArena</button></div>':''}
 <div class="span-all checks">${rf('Favorite','favorite',{type:'checkbox'})}${!wish&&mode!=='acquire'?rf('Wishlist','wishlist',{type:'checkbox'}):''}</div>
 ${!part&&(wish||isWanted(draft))?`${rf('Wishlist priority','wish_priority',{choices:[['','Not set'],'High','Medium','Low']})}${rf('Target price ('+amountCurrency(draft)+')','wish_price',{type:'number'})}${rf('Wishlist requirements / notes','wish_note',{type:'textarea'})}`:''}
 ${part?`${rf('Location','location',{list:'options-location'})}${draft.id?`<p class="hint">Total ${draft.quantity}; reserved ${draft.reserved}. Change quantities using Stock movements.</p>`:rf('Initial quantity','quantity',{type:'number'})}${rf('Part condition','condition',{choices:['Netestirano','Ispravno','Neispravno','Novo','Korišteno']})}${rf('Color','color',{list:'options-color'})}${rf('Purchase price per item ('+amountCurrency(draft)+')','price',{type:'number'})}${rf('Estimated value per item ('+amountCurrency(draft)+')','value',{type:'number'})}<div class="span-all">${rf('Notes','note',{type:'textarea'})}</div><div class="span-all checks" id="compatibility">${db.records.filter(r=>r.kind==='phone').map(r=>`<label class="check"><input type="checkbox" value="${r.id}" ${(draft.compatible||[]).includes(r.id)?'checked':''}>${esc(name(r))}</label>`).join('')}</div><div class="span-all"><h3>Photos of this part</h3><div class="gallery">${(draft.photos||[]).map((src,i)=>`<figure><img src="${esc(src)}" alt="Part photo"><button type="button" data-action="remove-photo" data-photo="${i}">Remove</button></figure>`).join('')}</div><input id="gallery-upload" type="file" multiple accept="image/*"></div>`:`<div class="span-all hint" id="imei-warning" hidden></div>${wish||!u?rf('Model notes','note',{type:'textarea'}):unitHTML(u,editorUnitIndex,true)}`}
 ${(db.settings.custom_fields||[]).map(f=>customHTML(f,draft.custom?.[f.id])).join('')}</div>
 ${Object.keys(draft.specs||{}).length?`<details class="section"><summary>Imported specifications</summary><div class="pre">${esc(Object.entries(draft.specs).filter(([,v])=>v).map(([k,v])=>k+': '+v).join('\n'))}</div></details>`:''}
 ${draft.id&&mode!=='add'&&mode!=='acquire'?`<div class="actions"><button type="button" data-action="history" data-id="${draft.id}">History</button>${part?`<button type="button" data-action="move" data-id="${draft.id}">Stock movements</button>`:wish?acquireButton(draft):'<button type="button" data-action="append-unit">+ Another unit</button>'}<button type="button" class="danger" data-action="${!part&&!wish&&u?'delete-unit':'delete-record'}" data-id="${draft.id}" data-index="${editorUnitIndex}">${!part&&!wish&&u?'Move this phone to trash':part?'Move part to trash':'Move entire model to trash'}</button></div>`:''}`;
 installCheckControls();
}
function customHTML(f,v){let control;const attr=`data-custom="${esc(f.id)}"`;
 if(f.type==='select')control=`<select ${attr}><option value="">—</option>${(f.options||[]).map(s=>`<option ${s===v?'selected':''}>${esc(s)}</option>`).join('')}</select>`;
 else if(f.type==='checkbox')return `<label class="check"><input type="checkbox" ${attr} ${v?'checked':''}>${esc(f.label)}</label>`;
 else control=`<input ${attr} type="${esc(f.type)}" value="${esc(v)}">`;
 return `<label>${esc(f.label)}${control}</label>`;
}
function panel(title,html,route=null){
 const el=$('panel');if(el.open)el.close();el.querySelector('.dialog-notice')?.remove();el.classList.remove('settings-page');el.querySelector('[data-action="toggle-sidebar"]')?.toggleAttribute('hidden',!route);
 if(catalogReturn)html='<div class="actions"><button data-action="return-phone">← Return to phone</button></div>'+html;
 panelRoute=route;panelDirty=false;$('panel-title').textContent=title;$('panel-body').innerHTML=html;
 if(route){el.classList.add('settings-page');el.show();}else el.showModal();
}
function allowPanelLeave(){return !panelDirty||confirm('Discard unsaved settings or catalog changes?');}
function closePanel(){
 if(!allowPanelLeave())return;const route=panelRoute;
 if(route?.kind==='item'){catalogList(route.category);return;}
 if(route?.kind==='settings'&&catalogReturn){returnToPhone();return;}
 if(route?.kind==='catalog'){settingsTab='options';settingsPanel();return;}
 $('panel').close();panelRoute=null;panelDirty=false;
}
function closeEditor(){
 if(uploadCount){toast('Wait for photos to finish uploading.');return false;}
 if(mode==='add'){readDraft();phoneDraft=dirty?clone(draft):null;}
 else if(dirty&&!confirm('Discard unsaved changes?'))return false;
 $('editor').close();draft=null;dirty=false;return true;
}
function download(text,filename,type='application/json'){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([text],{type}));a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function exportPanel(){panel('Export collection',`<p>JSON contains models and individual units. Open CSV in a spreadsheet. Use a ZIP backup for complete recovery including photos.</p><div class="actions"><button data-action="export-json" class="primary">JSON — all data</button><button data-action="export-csv">CSV — all units</button><button data-action="export-table">CSV — current table</button><button data-action="offline-export">Offline view</button></div>`);}
function csvText(rows){return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');}
function exportCSV(table=false){let rows;if(table){const keys=db.settings.columns.filter(k=>!['image','actions'].includes(k));rows=[keys.map(k=>columns.find(c=>c[0]===k)?.[1]||k),...filtered().map(r=>keys.map(k=>value(r,k)))];}else{const keys=['inv','color','edition','alias','type','os','gsm','wiki','product_code','imei','imei2','serial','state','rating','box','battery_present','charger_present','condition','purpose','location','price','value','currency','note'];rows=[['Brand','Model name','Model number / Variant','Type code',...keys],...db.records.filter(r=>r.kind==='phone').flatMap(r=>(r.instances||[]).map(u=>[r.brand,r.model,r.alias,r.type,...keys.map(k=>u[k])]))];}download(csvText(rows),table?'MyPhoneLibrary-tabela.csv':'MyPhoneLibrary-units.csv','text/csv;charset=utf-8');}
function offlineExport(){
 const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyPhoneLibrary — offline view</title><style>body{font:14px/1.6 system-ui;background:#101720;color:#e4ecf5;padding:20px;max-width:1100px;margin:auto}details{border:1px solid #3a475a;border-radius:9px;margin:12px 0;padding:14px}summary{cursor:pointer;font-weight:600}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #3a475a;padding:9px}p{color:#a5b5ca}.scroll{overflow:auto}small{color:#a5b5ca}</style><h1>MyPhoneLibrary</h1><p>Offline view · '+esc(new Date().toLocaleString('en-GB'))+' · read only, without photos. This private file contains inventory numbers and IMEI data.</p>'+db.records.map(r=>'<details><summary>'+esc(name(r))+' · '+value(r,'qty')+(r.kind==='phone'?' phones':' parts')+'</summary><p>'+esc([r.type,r.battery,r.charger,r.os].filter(Boolean).join(' · '))+'</p><p>'+esc(r.note)+'</p>'+(r.kind==='phone'?'<div class="scroll"><table><thead><tr><th>Inventory no.</th><th>Color / edicija</th><th>IMEI</th><th>Condition / status</th><th>Location</th><th>Note</th></tr></thead><tbody>'+r.instances.map(u=>'<tr><td>'+esc(u.inv)+'</td><td>'+esc([u.color,u.edition].filter(Boolean).join(' / '))+'</td><td>'+esc(u.imei)+'</td><td>'+esc(u.state+' / '+u.condition)+'</td><td>'+esc(u.location)+'</td><td>'+esc(u.note)+'</td></tr>').join('')+'</tbody></table></div>':'<p>Location: '+esc(r.location)+' · Available: '+(r.quantity-r.reserved)+'</p>')+'</details>').join('')+'</html>';
 download(html,'MyPhoneLibrary-offline.html','text/html;charset=utf-8');toast('Offline view downloaded.');
}
function columnsPanel(){panel('Table columns',`<p class="subtle">Hiding a column keeps its data. Selection, image, model, quantity and actions remain visible.</p><div class="settings-list">${unique([...db.settings.columns,...columns.map(c=>c[0])]).map(k=>{const c=columns.find(c=>c[0]===k);return c?`<div class="setting-row"><label class="check"><input type="checkbox" data-column="${k}" ${db.settings.columns.includes(k)?'checked':''} ${['select','image','model','qty','actions'].includes(k)?'disabled':''}>${esc(c[1])}</label><button data-action="column-up" data-key="${k}" aria-label="Move up">↑</button><button data-action="column-down" data-key="${k}" aria-label="Move down">↓</button></div>`:'';}).join('')}</div>`);}
const catalogNames={brand:'Brands',color:'Colors',location:'Locations',battery:'Batteries',charger:'Chargers',os:'Operating systems',part_category:'Part categories'};
function catalogLink(category,value){const item=(db.catalog||[]).find(x=>x.category===category&&x.name.toLowerCase()===String(value||'').toLowerCase());return item?`<button class="link catalog-link" data-action="catalog-item" data-id="${item.id}">${esc(value)}</button>`:esc(value)||'—';}
function catalogItems(category){return `<div class="actions"><button class="primary" data-action="catalog-new" data-category="${category}">+ Add item</button></div><div class="catalog-items">${(db.catalog||[]).filter(x=>x.category===category).map(x=>`<div class="catalog-item-row ${category==='battery'?'battery-catalog-row':''}"><div class="catalog-item-name">${catalogLink(category,x.name)}${category==='location'?`<small>${esc(locationPath(x))}</small><button data-action="location-contents" data-id="${x.id}">View contents</button>`:''}</div>${category==='battery'?`<div class="battery-summary">${batterySummary(x)}</div>`:`<span class="catalog-item-description">${esc((x.description||'').slice(0,100))||'No description yet'}</span><span class="catalog-item-specs">${Object.keys(x.specs||{}).length} specifications</span>`}<button class="danger catalog-row-delete" data-action="catalog-delete" data-id="${x.id}">Delete</button></div>`).join('')||'<p>No items yet.</p>'}</div>`;}
function catalogAccordion(){return Object.entries(catalogNames).map(([k,label])=>`<section class="catalog-section"><button class="catalog-heading" data-action="catalog-toggle" data-category="${k}" aria-expanded="${openCatalogCategory===k}"><strong>${label}</strong><span>${(db.catalog||[]).filter(x=>x.category===k).length} items ▾</span></button><div data-catalog-section="${k}" ${openCatalogCategory===k?'':'hidden'}>${catalogItems(k)}</div></section>`).join('');}
function catalogList(category){openCatalogCategory=category;settingsTab='options';settingsPanel();}
let catalogDraft=null;
function specRow(key='',value=''){return `<div class="spec-row"><input data-spec-key value="${esc(key)}" placeholder="Property — e.g. Capacity (mAh)" aria-label="Property name"><input data-spec-value value="${esc(value)}" placeholder="Value" aria-label="Property value"><button data-action="remove-spec" aria-label="Remove property">×</button></div>`;}
const batteryFields=[['Chemistry','Lithium Ion (Li-Ion)'],['Voltage','3.7V'],['Nominal Capacity','1.3Ah'],['Watt Hour','4.8Wh'],['Width','39.6mm'],['Height','6.4mm'],['Length/Breadth/Depth','45.9mm'],['Weight','19g']];
function batteryAlternatives(code){const primary=(db.catalog||[]).find(x=>x.category==='battery'&&normal(x.name)===normal(code));return primary?(db.catalog||[]).filter(x=>x.category==='battery'&&x.id!==primary.id&&((primary.compatible_batteries||[]).includes(x.id)||(x.compatible_batteries||[]).includes(primary.id))):[];}
function batteryCell(code){const alternatives=batteryAlternatives(code);return catalogLink('battery',code)+(alternatives.length?`<small class="battery-alternatives" title="Compatible alternatives from your catalog">${alternatives.map(x=>catalogLink('battery',x.name)).join(' · ')} <span class="muted">(compatible)</span></small>`:'');}
function batterySummary(e){return ['Chemistry','Voltage','Nominal Capacity'].map(k=>`<span><small>${k}</small>${esc(e.specs?.[k]||'—')}</span>`).join('');}
// Exact, variant-aware matching; never infer compatibility from a model prefix.
function batteryModelKey(value){return String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9+]/g,'');}
function batterySuggestions(brand,model){
 const b=batteryModelKey(brand),m=batteryModelKey(model);if(!b||!m)return [];
 const batteries=(db.catalog||[]).filter(x=>x.category==='battery'&&!x.suggestion_excluded),found=new Map();
 for(const battery of batteries){const match=(battery.supported_models||[]).find(x=>batteryModelKey(x.brand)===b&&(batteryModelKey(x.model)===m||batteryModelKey(x.brand+' '+x.model)===m));if(match)found.set(battery.id,{battery,kind:'Listed for this model',note:match.note||'',warning:match.warning||''});}
 for(const item of [...found.values()])for(const alternative of batteryAlternatives(item.battery.name)){if(!alternative.suggestion_excluded&&!found.has(alternative.id))found.set(alternative.id,{battery:alternative,kind:'Compatible alternative to '+item.battery.name,note:item.note,warning:item.warning});}
 return [...found.values()];
}
function refreshModelOptions(brand=''){
 const models=[...db.records.filter(r=>r.kind==='phone'),...(db.catalog||[]).filter(x=>x.category==='battery'&&!x.suggestion_excluded).flatMap(x=>x.supported_models||[])];
 const choices=new Map();for(const r of models)if(!brand||normal(r.brand)===normal(brand))choices.set(normal(r.brand)+'|'+normal(r.model),r);
 $('model-suggestions').innerHTML=[...choices.values()].map(r=>`<option value="${esc(r.model)}">${esc(r.brand)}</option>`).join('');
}
function chargerSuggestions(r){return (db.catalog||[]).filter(x=>x.category==='charger'&&(normal(x.name)===normal(r.charger)||(r.id&&(x.compatible||[]).includes(r.id))));}
function chargerSuggestionsHTML(r){const items=chargerSuggestions(r);return `<strong>Charger suggestions</strong>${items.length?items.map(x=>`<button type="button" data-action="choose-charger-suggestion" data-value="${esc(x.name)}">${esc(x.name)}</button>`).join(' '):'<p class="subtle">No known charger for this model. Choose one manually or add a compatibility link in Catalogs.</p>'}`;}
function batterySuggestionsHTML(brand,model){const matches=batterySuggestions(brand,model);return `<strong>Battery suggestions</strong>${matches.length?matches.map(x=>`<div class="setting-row"><button type="button" data-action="choose-battery-suggestion" data-value="${esc(x.battery.name)}">${esc(x.battery.name)}</button><div><small>${esc(x.kind)}</small>${x.note?`<p>${esc(x.note)}</p>`:''}${x.warning?`<p class="error">${esc(x.warning)}</p>`:''}</div></div>`).join(''):'<p class="subtle">No exact match in the battery catalog. Check the full model/variant or choose a battery manually.</p>'}`;}
function refreshBatterySuggestions(){const host=$('editor-battery-suggestions');if(!host)return;const root=$('editor-content'),brand=root.querySelector('[data-r="brand"]')?.value||draft?.brand,model=root.querySelector('[data-r="model"]')?.value||draft?.model;host.innerHTML=batterySuggestionsHTML(brand,model);}
function batteryEditor(e){const models=db.records.filter(r=>r.kind==='phone'&&(r.catalog_refs?.battery===e.id||normal(r.battery)===normal(e.name)||batteryAlternatives(r.battery).some(x=>x.id===e.id)));return `<div class="actions"><button data-action="catalog-list" data-category="battery">← Batteries</button></div><div class="settings-fields"><label>Name<input id="catalog-name" value="${esc(e.name)}"></label>${[...batteryFields,...Object.keys(e.specs||{}).filter(k=>!batteryFields.some(([f])=>f===k)).map(k=>[k,''])].map(([key,hint])=>`<label>${key}<input data-battery-spec="${key}" value="${esc(e.specs[key]||'')}" placeholder="e.g. ${hint}"></label>`).join('')}</div><label>Source link<input id="catalog-source" type="url" value="${esc(e.source||'')}"></label><label>Notes and warnings<textarea id="catalog-description" rows="8">${esc(e.description||'')}</textarea></label><details class="section"><summary>Phones listed by the source (${(e.supported_models||[]).length})</summary><p class="subtle">Exact model variants are kept separate. Entries marked for verification are suggestions only.</p><div class="settings-list">${(e.supported_models||[]).map(m=>`<div class="setting-row"><div><strong>${esc(m.brand+' '+m.model)}</strong><p>${esc(m.note||'')}</p>${m.warning?`<p class="error">${esc(m.warning)}</p>`:''}</div></div>`).join('')||'<p>No source phone list.</p>'}</div></details><h3 class="section">Compatible with</h3><p class="subtle">Select compatible battery models. These alternatives appear on linked phones. Only direct links are used.</p><div class="battery-choices">${(db.catalog||[]).filter(x=>x.category==='battery'&&x.id!==e.id).map(x=>`<label class="check"><input type="checkbox" data-battery-compatible="${x.id}" ${(e.compatible_batteries||[]).includes(x.id)?'checked':''}>${esc(x.name)}</label>`).join('')||'<p>Add other batteries to the catalog first.</p>'}</div><h3 class="section">Compatible models</h3><p class="subtle">Models in your library using this battery or a directly linked compatible alternative.</p><div class="settings-list">${models.map(r=>`<div class="setting-row"><button class="link" data-action="edit" data-id="${r.id}">${esc(name(r))}</button><span>${live(r).length} phones</span></div>`).join('')||'<p>No models currently use this battery.</p>'}</div><div class="actions settings-save"><button class="primary" data-action="catalog-save">Save item</button>${e.id?'<button class="danger" data-action="catalog-delete">Delete item</button>':''}</div>`;}
function catalogEditor(category,id){catalogDraft=clone((db.catalog||[]).find(x=>x.id===id)||{category,name:'',description:'',specs:{},source:''});const e=catalogDraft;if(category==='battery'){panel(e.name||'New battery',batteryEditor(e),{kind:'item',category});return;}const related=db.records.filter(r=>[r,...r.instances||[]].some(o=>o.catalog_refs?.[category]===id));panel(e.name||'New '+catalogNames[category]+ ' item',`<div class="actions"><button data-action="catalog-list" data-category="${category}">← ${catalogNames[category]}</button></div><div class="grid two"><label>Name<input id="catalog-name" value="${esc(e.name)}"></label><label>Source link<input id="catalog-source" type="url" value="${esc(e.source)}"></label><label class="wide">Description<textarea id="catalog-description">${esc(e.description)}</textarea></label></div>${category==='location'?`<label>Parent location<select id="location-parent"><option value="">None — top level</option>${db.catalog.filter(x=>x.category==='location'&&x.id!==e.id).map(x=>`<option value="${x.id}" ${e.parent_id===x.id?'selected':''}>${esc(locationPath(x))}</option>`).join('')}</select></label>${e.id?`<button data-action="location-contents" data-id="${e.id}">View contents including nested locations</button>`:''}`:''}
${['battery','charger','part_category'].includes(category)?`<h3>Additional compatible models</h3><div class="checks">${db.records.filter(r=>r.kind==='phone').map(r=>`<label class="check"><input type="checkbox" data-catalog-compatible="${r.id}" ${(e.compatible||[]).includes(r.id)?'checked':''}>${esc(name(r))}</label>`).join('')}</div>${catalogConnections(e)}`:''}<h3>Specifications</h3><div id="catalog-specs">${Object.entries(e.specs).map(([k,v])=>specRow(k,v)).join('')}</div><button data-action="add-spec">+ Add property</button><h3>Linked models and parts</h3><p>${related.map(r=>esc(name(r))).join(' · ')||'No linked records yet.'}</p><div class="actions"><button class="primary" data-action="catalog-save">Save item</button>${e.id?'<button class="danger" data-action="catalog-delete">Delete item</button>':''}</div>`,{kind:'item',category});}
async function loadNetwork(test=false){const info=await api(test?'/api/network-test':'/api/network',test?{}:undefined);if(!$('network-status'))return;const endpoints=info.endpoints;$('network-status').innerHTML=`<p>Server port: <strong>${info.port}</strong> · Tailscale: ${esc(info.tailscale)}</p><div class="network-grid">${endpoints.map(e=>`<div class="network-card"><strong>${esc(e.label)}</strong><small class="network-result ${e.status==='Reachable from server'?'reachable':e.status==='Not reachable from server'?'unreachable':''}">${e.status.includes('eachable from server')?'● ':''}${esc(e.status)}</small><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a></div>`).join('')}</div>${info.error?`<p>${esc(info.error)}</p>`:''}`;const local=$('network-local').value||endpoints.find(e=>e.label==='Local network')?.url;const remote=$('network-remote').value||endpoints.find(e=>e.label==='Tailscale MagicDNS')?.url||endpoints.find(e=>e.label==='Tailscale IP')?.url;$('network-qr').innerHTML=unique([local,remote].filter(Boolean)).map(address=>{const qr=qrcode(0,'M');qr.addData(address);qr.make();return `<div><img alt="Connection QR code" src="${qr.createDataURL(4,8)}"><p>${esc(address)}</p></div>`;}).join('')||'<p>No LAN or Tailscale address detected. Enter a preferred address and save it.</p>';}
const interfaceThemes=[['dark','Plex Dark','#e5a000'],['oled','OLED Black','#eee'],['red','Cinema Red','#e8414f'],['blue','Ocean Blue','#08a8d5'],['purple','Royal Purple','#a956cb'],['emerald','Emerald Noir','#24b885'],['navy','Midnight Navy','#638fff'],['sepia','Warm Sepia','#c58c55'],['light','Light','#eee']];
function appearanceSettings(){return `<h2>Appearance</h2><p class="subtle">Choose how your library looks when it opens.</p><h3 class="settings-group-title">Interface theme</h3><input type="hidden" id="theme" value="${esc(db.settings.theme||'dark')}"><div class="theme-picker">${interfaceThemes.map(([k,n,c])=>`<button data-action="theme-select" data-theme-choice="${k}" aria-pressed="${(db.settings.theme||'dark')===k}"><span style="background:${c}"></span>${n}</button>`).join('')}</div><div class="settings-fields"><label>Default page<select id="default-page">${[['all','My collection'],['phone','Phones'],['part','Parts and accessories'],['wish','Wishlist']].map(([k,n])=>`<option value="${k}" ${(db.settings.default_page||'all')===k?'selected':''}>${n}</option>`).join('')}</select></label>${layoutPicker()}<label>Display density<select id="display-density"><option value="compact" ${db.settings.density!=='comfortable'?'selected':''}>Compact</option><option value="comfortable" ${db.settings.density==='comfortable'?'selected':''}>Comfortable</option></select></label></div><div class="settings-tool-row"><span>Visible columns and their order</span><button data-action="columns">Columns and order</button></div>`;}
async function settingsPanel(){
 const tabs=[['appearance','✦ Appearance'],['options','☷ Catalogs'],['backup','▣ Backup'],['network','⌁ Network'],['maintenance','⚒ Maintenance'],['about','ⓘ About']];
 const section=(key,html)=>`<section data-settings-section="${key}" ${settingsTab===key?'':'hidden'}>${html}</section>`;
 panel('Settings',`<p class="settings-intro subtle">Appearance, data, backup and network access</p><div class="settings-layout"><nav class="settings-tabs">${tabs.map(([key,label])=>`<button class="${settingsTab===key?'active':''}" data-action="settings-tab" data-tab="${key}">${label}</button>`).join('')}</nav><div class="settings-content">
 ${section('appearance',appearanceSettings())}
 ${section('options',`<h2>Catalogs</h2><p class="subtle">Each item is a reusable object with its own description and specifications.</p><div class="catalog-accordion">${catalogAccordion()}</div>`)}
 ${section('backup',`<h2>Backup &amp; recovery</h2><p class="subtle">Automatic and manual backups with your phone photographs.</p><div class="settings-fields"><label>Automatic backup — interval in days<input id="backup-days" type="number" min="1" max="30" value="${db.settings.backup_days}"></label><label>Number of local backups<input id="backup-copies" type="number" min="2" max="100" value="${db.settings.backup_copies}"></label><label>First backup location<div class="folder-control"><input id="backup-primary" value="${esc(db.settings.backup_primary||'')}" placeholder="${esc(db.backup_default)}"><button data-action="browse-backup" data-field="backup-primary">Browse…</button></div></label><label>Second backup location<div class="folder-control"><input id="backup-directory" value="${esc(db.settings.backup_directory)}"><button data-action="browse-backup" data-field="backup-directory">Browse…</button></div></label><p class="subtle">Locations are folders on the host computer. Leave the first location blank to use ${esc(db.backup_default)}. A local recovery copy is also retained.</p></div>${backupContents()}`)}
 ${section('network',`<h2>Network access</h2><p class="subtle">One server for this computer, your local network and Tailscale.</p><div id="network-status">Loading network adapters…</div><div class="actions"><button data-action="network-refresh">Refresh connection status</button><button data-action="network-test">Test all connections</button></div><div class="settings-fields"><label>Preferred local address<input id="network-local" value="${esc(db.settings.network_local||'')}" placeholder="Automatic — detected local address"></label><label>Preferred remote address<input id="network-remote" value="${esc(db.settings.network_remote||'')}" placeholder="Automatic — Tailscale MagicDNS or IP"></label></div><p class="subtle">Leave blank for automatic selection. Status is detected on the server; access from your phone also depends on its network and the Windows firewall.</p><details><summary>Connect a phone</summary><div id="network-qr" class="network-grid"></div><p>Scan an address reachable from your phone and sign in with your library password.</p></details><p class="hint">Use a private LAN or Tailscale. Keep the application port closed on your router.</p><h3>Change password</h3><div class="grid two"><label>Current password<input type="password" id="old-password" autocomplete="current-password"></label><label>New password<input type="password" id="new-password" minlength="8" autocomplete="new-password"></label></div><div class="actions"><button class="primary" data-action="save-password">Save new password</button></div>`)}
 ${section('maintenance',`<h2>Collection maintenance</h2><div class="actions"><button data-action="server-restart">Restart server</button><button data-action="server-stop">Stop server</button></div><div class="actions"><button data-action="import">Import</button><button data-action="export">Export</button><button data-action="trash">Trash</button><button data-action="inventory">Inventory check</button></div><h3>Custom fields</h3><div id="custom-fields-inline">${customFieldsContents()}</div>`)}
 ${section('about',`<h2>About</h2><p class="subtle">Version, updates and application data.</p>${updateContents()}`)}
 <div class="actions settings-save"><button data-action="save-settings" class="primary">Save changes</button></div></div></div>`,{kind:'settings'});loadBackups().catch(e=>{if($('backup-files'))$('backup-files').textContent=e.message;});loadNetwork().catch(e=>{if($('network-status'))$('network-status').textContent=e.message;});loadUpdateState().catch(e=>updateMessage(e.message));
}
let folderPickerRequest=0;
async function openFolderPicker(field){
 const input=$(field),request=++folderPickerRequest;
 try{
  const result=await api('/api/backup-folder',{path:input.value||db.backup_default});
  if(request===folderPickerRequest&&result.path&&input===$(field)){input.value=result.path;panelDirty=true;}
 }catch(error){if(request===folderPickerRequest)throw error;}
}
function outsideDialog(event,dialog){
 if(event.target!==dialog)return false;const r=dialog.getBoundingClientRect();
 return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;
}
function customFieldsContents(){return `<p class="subtle">Fields appear in the model or part editor. Existing values are preserved.</p><div class="settings-list">${db.settings.custom_fields.map(f=>`<div class="setting-row"><span>${esc(f.label)} <small>${esc(f.type)}</small></span></div>`).join('')}</div><div class="grid" style="margin-top:18px"><label>Field name<input id="custom-label" placeholder="e.g. Country of manufacture"></label><label>Type<select id="custom-type"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="checkbox">Checkbox</option><option value="select">Dropdown</option></select></label><label>Options (comma-separated)<input id="custom-options"></label></div><div class="actions"><button class="primary" data-action="add-custom">Add field</button></div>`;}
function customFieldsPanel(){if($('custom-fields-inline'))$('custom-fields-inline').innerHTML=customFieldsContents();else {settingsTab='maintenance';settingsPanel();}}
function backupContents(){return `<h3>Backups and recovery</h3><p class="subtle">Data folder: ${esc(db.data_directory||'')}</p><p>The ZIP contains your database, photos and settings. Current data is backed up before restoring.</p><div class="actions"><button class="primary" data-action="create-backup">Create backup</button><label>Restore from ZIP backup<input id="restore-file" type="file" accept=".zip"></label></div><div id="backup-status" role="status"></div><div id="backup-files" class="settings-list"></div>`;}
async function loadBackupStatus(){const result=await api('/api/backup-status');if($('backup-status'))$('backup-status').innerHTML=result.map(x=>`<div class="backup-status-row"><strong>${esc(x.label)}</strong><span class="${x.status==='success'?'good':x.status==='failed'?'error':'muted'}">${esc(x.message)}</span><small>${esc(x.path||'Not configured')}</small><small>Last successful backup: ${x.last_success?esc(new Date(x.last_success).toLocaleString('en-GB')):'Never recorded'}</small></div>`).join('');}
async function loadBackups(){loadBackupStatus().catch(e=>{if($('backup-status'))$('backup-status').textContent='Backup status unavailable: '+e.message;});const files=await api('/api/backups');if($('backup-files'))$('backup-files').innerHTML=files.map(f=>`<div class="setting-row"><span>${esc(f.name)} <small>${(f.bytes/1024/1024).toFixed(2)} MB</small></span><a href="/api/download-backup?name=${encodeURIComponent(f.name)}" download>Download</a></div>`).join('')||'<p class="subtle">No backups yet.</p>';}
async function backupsPanel(){settingsTab='backup';await settingsPanel();}

function importPanel(){importRows=null;panel('Import collection',`<p>Upload a JSON export or legacy CSV. Preview records and errors before importing. Uncertain quantities such as 2??? remain unverified.</p><p class="hint">Use ZIP backup for full recovery. The all-units CSV is a report; legacy import expects one row per model.</p><label style="margin-top:15px">File<input id="import-file" type="file" accept=".json,.csv"></label><div id="import-preview"></div>`);}
function parseCSV(text){text=text.replace(/^\ufeff/,'');const delim=(text.split(/\r?\n/)[0].match(/;/g)||[]).length>(text.split(/\r?\n/)[0].match(/,/g)||[]).length?';':',';let rows=[],row=[],v='',quote=false;for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){v+='"';i++;}else quote=!quote;}else if(c===delim&&!quote){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(Boolean))rows.push(row);row=[];v='';}else v+=c;}if(quote)throw Error('CSV contains an unclosed quote.');if(v||row.length){row.push(v);rows.push(row);}const headers=rows.shift()||[];if(new Set(headers).size!==headers.length)throw Error('CSV has duplicate column names.');return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h.trim(),r[i]||''])));}
async function importPreview(file){const text=await file.text();if(file.name.toLowerCase().endsWith('.json')){const x=JSON.parse(text);importRows=Array.isArray(x)?x:x.records;if(!Array.isArray(importRows))throw Error('JSON must contain a records array.');}else importRows=parseCSV(text);const p=await api('/api/import',{rows:importRows});$('import-preview').innerHTML=`<p class="hint">To import: ${p.rows.length} · Duplicates skipped: ${p.skipped} · Errors: ${p.errors.length}</p><div class="import-table"><table><thead><tr><th>Row</th><th>Model</th><th>Units / quantity</th><th>To verify</th></tr></thead><tbody>${p.rows.map(r=>`<tr><td>${r.row}</td><td>${esc(r.brand+' '+r.model)}</td><td>${r.quantity}</td><td>${esc(r.uncertain)}</td></tr>`).join('')}</tbody></table></div>${p.errors.map(e=>`<p class="error">Row ${e.row}: ${esc(e.error)}</p>`).join('')}<div class="actions"><button class="primary" data-action="commit-import" ${p.rows.length?'':'disabled'}>Import ${p.rows.length} valid rows</button></div>`;}
function movePanel(id){const p=record(id);panel('Stock movements — '+p.model,`<p>Total: <strong>${p.quantity}</strong> · Available: <strong>${p.quantity-p.reserved}</strong> · Reserved: <strong>${p.reserved}</strong></p><div class="grid two" style="margin-top:16px"><label>Action<select id="move-action">${['Dodaj','Rezerviši','Oslobodi','Ugradi','Ugradi rezervisano','Otpiši'].map(s=>`<option value="${esc(s)}">${esc(enumLabel(s))}</option>`).join('')}</select></label><label>Quantity<input id="move-qty" type="number" min="1" step="1" value="1"></label><label>Target unit<select id="move-unit"><option value="">Select when installing</option>${db.records.filter(r=>r.kind==='phone').flatMap(r=>live(r).map(u=>`<option value="${r.id}:${u.id}">${esc(name(r)+' · '+u.inv+' · '+u.color)}</option>`)).join('')}</select></label><label>Note<input id="move-note"></label></div><div class="actions"><button class="primary" data-action="save-move" data-id="${id}">Save movement</button></div><h3 class="section">Stock history</h3>${db.movements.filter(m=>m.part_id===id).map(m=>`<div class="setting-row"><span>${esc(enumLabel(m.action))} · ${m.quantity} items <small>${esc(m.at)}</small></span><span>${esc(m.note)}</span></div>`).join('')||'<p class="subtle">No movements yet.</p>'}`);}
function repairsPanel(id){const r=record(id),repairs=db.repairs.filter(x=>x.record_id===id);panel('Repairs — '+name(r),`<div class="grid two"><label>Unit<select id="repair-unit">${r.instances.map(u=>`<option value="${u.id}">${esc(u.inv+' · '+u.color+' · '+u.edition)}</option>`).join('')}</select></label><label>Status<select id="repair-status">${['Otvoren','U radu','Čeka dijelove','Završen'].map(s=>`<option value="${esc(s)}">${esc(enumLabel(s))}</option>`).join('')}</select></label><label>Cost<input id="repair-cost" type="number" value="0" min="0" step="0.01"></label><label>Currency<select id="repair-currency">${opts.currency.map(s=>`<option value="${esc(s)}">${esc(enumLabel(s))}</option>`).join('')}</select></label><label class="span-all">Fault / work performed<textarea id="repair-note"></textarea></label></div><div class="actions"><button class="primary" data-action="save-repair" data-id="${id}" ${r.instances.length?'':'disabled'}>Add repair record</button></div><h3 class="section">Records</h3>${repairs.map(x=>`<div class="setting-row"><div><strong>${esc(r.instances.find(u=>u.id===x.instance_id)?.inv||'Unit')} · ${esc(enumLabel(x.status))}</strong><p>${esc(x.note)}</p><small>${x.cost} ${esc(x.currency)} · ${esc(x.at)}</small></div>${x.status!=='Završen'?`<button data-action="finish-repair" data-id="${x.id}">Complete</button>`:''}</div>`).join('')||'<p class="subtle">No repairs yet.</p>'}<p class="hint">Record installed parts through Stock movements to update quantities correctly.</p>`);}
function inventoryPanel(id=null){const inv=id?db.inventories.find(x=>x.id===id):null;if(inv){const entries=Object.entries(inv.expected);panel('Inventory check — '+(inv.location||'Entire collection'),`<p>Found ${Object.keys(inv.found).length} / ${entries.length} · ${inv.closed?'Completed':'In progress'}</p><p class="hint">Unconfirmed phones remain in the collection. Loaned units are marked separately.</p>${entries.map(([uid,u])=>`<label class="inventory-row ${inv.found[uid]?'found':''}"><input type="checkbox" data-inventory="${inv.id}" data-unit="${uid}" ${inv.found[uid]?'checked':''} ${inv.closed?'disabled':''}><span>${esc(u.inv+' · '+u.model)}<small>${esc(u.location||'No location')} · ${esc(enumLabel(u.condition))}</small></span></label>`).join('')}<div class="actions">${!inv.closed?`<button class="primary" data-action="close-inventory" data-id="${inv.id}">Complete inventory check</button>`:''}<button data-action="export-inventory" data-id="${inv.id}">Export results</button><button data-action="inventory">All inventory checks</button></div>`);return;}
 const locations=unique(db.records.flatMap(r=>live(r).map(u=>u.location)));
 panel('Inventory check',`<p>Check the phones at a selected location.</p><div class="actions"><select id="inventory-location"><option value="">Entire collection</option>${locations.map(l=>`<option>${esc(enumLabel(l))}</option>`).join('')}</select><button class="primary" data-action="start-inventory">Start inventory check</button></div><div class="settings-list" style="margin-top:18px">${db.inventories.map(i=>`<div class="setting-row"><div>${esc(i.location||'Entire collection')}<small> · ${esc(i.at)} · ${i.closed?'Completed':'In progress'} · ${Object.keys(i.found).length}/${Object.keys(i.expected).length}</small></div><button data-action="open-inventory" data-id="${i.id}">Open</button></div>`).join('')}</div>`);}
async function historyPanel(id){const history=await api('/api/history?id='+id);panel('Change history',history.map(h=>`<details class="setting-row" style="display:block"><summary>${esc(h.action)} · ${esc(h.at)}</summary><pre class="pre">${esc(JSON.stringify(JSON.parse(h.data),null,2))}</pre></details>`).join('')||'<p>No records yet.</p>');}
function trashPanel(){panel('Trash',`<p class="subtle">Records are retained and can be restored. Inventory numbers are released. Restore reuses the old number if available, otherwise assigns a new one. Permanent deletion removes the collection entry; historical audit records and backups are retained.</p><div class="settings-list">${db.trash.map(r=>`<div class="setting-row"><span>${esc(name(r))} · ${r._unit_parent?'Phone #'+esc(r.instances[0]?.previous_inv||'')+' (individual)':r.kind==='phone'?(r.instances||[]).length+' units':'part'}</span><div class="actions"><button data-action="untrash" data-id="${r.id}">Restore</button><button class="danger" data-action="purge" data-id="${r.id}">Delete permanently</button></div></div>`).join('')||'<p>Trash is empty.</p>'}</div>`);}
function updateContents(){
 if(IS_ANDROID_APP)return `<div class="about-rows"><div><span>Android app</span><strong>${esc(androidVersion())||'Unknown'}</strong></div><div><span>Android interface</span><strong>${UI_VERSION}</strong></div><div><span>Windows server</span><strong>${esc(db.version)}</strong></div><div><span>Update channel</span><strong>Android · manual checks</strong></div></div><h3 class="settings-group-title">Android updates</h3><div class="actions"><button class="primary" data-action="check-update">Check for Android updates</button><a id="android-download" hidden target="_blank" rel="noopener noreferrer">Download Android APK</a></div><p id="update-result" class="hint" role="status">Android updates are installed on this phone. Your collection stays on the server.</p>`;
 return `<div class="about-rows"><div><span>My Phone Library</span><strong>Version ${esc(db.version)}</strong></div><div><span>Frontend build</span><strong>${UI_VERSION}</strong></div><div><span>Update channel</span><strong>Stable · manual checks</strong></div><div><span>Data storage</span><strong>Persistent and upgrade-safe</strong></div><div><span>Data folder</span><strong>${esc(db.data_directory||'')}</strong></div></div><h3 class="settings-group-title">Application updates</h3><label>GitHub release repository (owner/name)<input id="update-repo" value="${esc(db.settings.update_repo||'')}" placeholder="owner/MyPhoneLibrary-Releases"></label><div class="actions"><button data-action="save-update-repo">Save source</button><button class="primary" data-action="check-update">Check for updates</button><button id="install-update" data-action="install-update" hidden>Update</button></div><p id="update-result" class="hint" role="status">${db.settings.update_repo?'Check GitHub for a new version.':'A GitHub release source has not been connected yet.'}</p><p class="subtle">Update downloads the verified Windows installer, installs it in the background and restarts the server automatically.</p><h3 class="section">Manual update from file</h3><button data-action="server-restart">Restart server to apply a manual package</button><label>New release package (.zip)<input type="file" id="update-file" accept=".zip"></label><p class="hint">A backup is created before staging. Updates are applied on the next server start.</p>`;}
async function loadUpdateState(){
 if(IS_ANDROID_APP)return;
 const state=await api('/api/update-state');
 if(state.job&&['starting','downloading','installing','verifying'].includes(state.job.status)){sessionStorage.setItem('mpl-install-target',state.job.version);watchInstallation();return;}
 if(state.job?.status==='failed'){updateMessage(state.job.message);return;}
 if(state.pending){sessionStorage.setItem('mpl-update-target',state.pending);updateMessage('Version '+state.pending+' is ready. Click Restart server to apply it.');}
 if(state.error)updateMessage('Update failed: '+state.error);
}
async function updatePanel(){settingsTab='about';await settingsPanel();}
async function gsmPanel(){readDraft();const link=draft.instances[editorUnitIndex]?.gsm||draft.gsm;if(!link)throw Error('Enter a GSMArena model link first.');toast('Fetching model details…');preview=await api('/api/gsm',{url:link});panel('GSMArena details — '+preview.name,`<p>Select the details to import. Existing values are replaced only for selected fields.</p><div class="settings-list">${Object.entries(preview.fields).filter(([,v])=>v).map(([k,v])=>`<label class="check setting-row"><input type="checkbox" data-gsm="${k}" ${!draft[k]&&k!=='image'?'checked':''}><span><strong>${esc(({os:'Operating system',introduced:'Introduced',released:'Released / status',charger:'Connector',gsm:'Source',image:'Image'})[k])}</strong><br><small>${esc(v)}</small>${draft[k]?`<br><small>Current: ${esc(draft[k])}</small>`:''}</span></label>`).join('')}<label class="check setting-row"><input type="checkbox" id="gsm-specs" checked>All available extra specifications</label></div><p class="hint">Use your own photos or a permitted image source. Physical unit details are not imported.</p><div class="actions"><button class="primary" data-action="apply-gsm">Apply selected</button></div>`);}
function labelsPanel(id){const r=record(id);panel('Labels — '+name(r),`<label class="no-print">Application address accessible from your phone<input id="qr-base" value="${esc(location.origin)}"></label><div class="actions no-print"><button data-action="generate-labels" data-id="${id}">Generate QR</button><button data-action="print">Print</button></div><p class="hint no-print">Replace localhost with your computer’s LAN or Tailscale address. QR labels do not contain IMEI.</p><div id="labels" class="qr-print" style="margin-top:15px"></div>`);}
function generateLabels(id){const r=record(id),base=$('qr-base').value.trim();const parsed=new URL(base);if(!['http:','https:'].includes(parsed.protocol))throw Error('Invalid address.');if(typeof qrcode!=='function')throw Error('QR module unavailable.');$('labels').innerHTML=live(r).map(u=>{const qr=qrcode(0,'M');qr.addData(base.replace(/\/$/,'')+'/#record='+r.id+'&unit='+u.id);qr.make();return `<div class="label-print"><img src="${qr.createDataURL(4,8)}" alt="QR for ${esc(u.inv)}"><strong>${esc(name(r))}</strong><span>${esc(u.inv)}</span><small>${esc([u.color,u.edition].filter(Boolean).join(' · '))}</small></div>`;}).join('');}
async function uploadFiles(files,index=null){readDraft();uploadCount++;$('record-save').disabled=true;try{for(const file of files){if(file.size>10*1024*1024)throw Error('Photo exceeds 10 MB.');const p=await api('/api/upload',file,true);if(index==='main')draft.image=p.url;else if(index===null)draft.photos.push(p.url);else draft.instances[index].photos.push(p.url);}dirty=true;editorRender(typeof index==='number'?index:null);}finally{uploadCount--;$('record-save').disabled=uploadCount>0;}}

document.addEventListener('input',e=>{if(e.target.matches?.('[data-combo-query]')){const c=e.target.closest('.catalog-combo');syncCombo(c);openCombo(c);}});
document.addEventListener('click',e=>{if(e.target.matches?.('[data-combo-query]'))openCombo(e.target.closest('.catalog-combo'),true);else if(!e.target.closest?.('.catalog-combo'))closeCombos();});
document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-action]');if(!target)return;const action=target.dataset.action,id=target.dataset.id;
 try{
 document.querySelectorAll('.row-menu').forEach(m=>m.hidePopover?.());
 if(quickEdit&&!['quick-start','quick-save','quick-cancel','combo-toggle','combo-select'].includes(action)){if(!confirm('Discard the unsaved cell change?'))return;quickEdit=null;render();}
 const leavesPanel=['review-checks','saved-filters','locations','compare-units','unit-details','location-contents','bulk-edit','nav-view','settings','catalogs','catalog-list','catalog-item','catalog-new','add-phone','add-part','trash','backups','inventory','columns','custom-fields','password','update-info','import','export'];
 if($('panel').open&&leavesPanel.includes(action)){
  if(!allowPanelLeave())return;panelDirty=false;
  if(['nav-view','add-phone','add-part'].includes(action)){$('panel').close();panelRoute=null;}
 }
 switch(action){
 case 'quick-start':startQuick(target);break;
 case 'quick-save':await saveQuick();break;
 case 'quick-cancel':quickEdit=null;render();break;
 case 'select-visible':for(const r of filtered())for(const u of shownUnits(r))selectedUnits.add(u.id);render();break;
 case 'select-clear':selectedUnits.clear();render();break;
 case 'toggle-check-focus':checkFocus=!checkFocus;render();break;
 case 'review-checks':reviewChecks(id,target.dataset.unit);break;
 case 'bulk-edit':openBulk();break;
 case 'compare-units':compareUnits();break;
 case 'locations':locationsPanel();break;
 case 'saved-filters':savedFiltersPanel();break;
 case 'apply-saved-filter':applySavedFilter(Number(target.dataset.index));break;
 case 'delete-saved-filter':{const views=[...(db.settings.views||[])];views.splice(Number(target.dataset.index),1);await api('/api/settings',{views});await refresh();savedFiltersPanel();break;}
 case 'location-unassigned':locationUnassigned();break;
 case 'bulk-save':await saveBulk();break;
 case 'unit-details':await unitDetails(id,Number(target.dataset.index));break;
 case 'location-contents':locationContents(id);break;
 case 'duplicate-open':if(closeEditor()){const r=record(id);await unitDetails(id,r.instances.findIndex(u=>u.id===target.dataset.unit));}break;

 case 'retry-reconnect':if(sessionStorage.getItem('mpl-install-target'))await watchInstallation();else await reconnectAfterRestart();break;
 case 'dismiss-reconnect':hideStartup();break;
 case 'reload-current':if(!hasUnsavedWork()||confirm('Reload and discard unsaved changes?')){dirty=false;phoneDraft=null;panelDirty=false;catalogReturn=null;location.reload();}break;
 case 'return-phone':returnToPhone();break;
 case 'toggle-sidebar':sidebarState(document.documentElement.dataset.sidebar!=='collapsed');break;
 case 'combo-toggle':{const c=target.closest('.catalog-combo');if(c.querySelector('.combo-menu').hidden)openCombo(c,true);else closeCombos();break;}
 case 'choose-charger-suggestion':case 'choose-battery-suggestion':{const bound=$('editor-content').querySelector(action==='choose-charger-suggestion'?'[data-r="charger"]':'[data-r="battery"]');if(!bound)break;bound.value=target.dataset.value;const combo=bound.closest('.catalog-combo');if(combo)combo.querySelector('[data-combo-query]').value=bound.value;dirty=true;bound.dispatchEvent(new Event('change',{bubbles:true}));break;}
 case 'combo-select':{const c=target.closest('.catalog-combo'),q=c.querySelector('[data-combo-query]'),bound=c.querySelector('input[type="hidden"]');q.value=target.dataset.value;syncCombo(c);closeCombos();if($('editor').open)dirty=true;else if(panelRoute)panelDirty=true;bound.dispatchEvent(new Event('change',{bubbles:true}));break;}
 case 'catalog-toggle':openCatalogCategory=openCatalogCategory===target.dataset.category?null:target.dataset.category;document.querySelectorAll('[data-catalog-section]').forEach(el=>el.hidden=el.dataset.catalogSection!==openCatalogCategory);document.querySelectorAll('[data-action="catalog-toggle"]').forEach(el=>el.setAttribute('aria-expanded',String(el.dataset.category===openCatalogCategory)));break;
 case 'field-catalog':{if(uploadCount)throw Error('Wait for photos to finish uploading.');readDraft();catalogReturn={draft:clone(draft),mode,dirty,index:editorUnitIndex};if(mode==='add')phoneDraft=dirty?clone(draft):null;$('editor').close();catalogList(target.dataset.category);break;}
 case 'toggle-filters':$('quick-filters').hidden=!$('quick-filters').hidden;target.setAttribute('aria-expanded',String(!$('quick-filters').hidden));break;
 case 'mobile-more':panel('More',`<div class="mobile-more-menu">${$('navigation').querySelector('nav').innerHTML}<button data-action="settings">Settings</button><button data-action="logout">Sign out</button></div>`);break;
 case 'mobile-search':$('search').focus();$('search').scrollIntoView({block:'center'});break;
 case 'clear-filters':quickFilters={brand:'',color:'',os:'',location:'',state:''};render();break;
 case 'refresh':await refresh();toast('Table refreshed.');break;
 case 'logout':if((dirty||phoneDraft||panelDirty)&&!confirm('Sign out and discard unsaved changes?'))break;await api('/api/logout',{});$('editor').close();$('panel').close();draft=null;phoneDraft=null;db=null;dirty=false;await boot();break;
 case 'toggle-wanted':showWanted=!showWanted;render();break;
 case 'add-wanted':addWanted();break;
 case 'acquire-wanted':if($('editor').open&&!closeEditor())break;$('panel').close();acquireWanted(id);break;
 case 'add-phone':if(currentView==='wish')addWanted();else addPhone();break;case 'add-part':addPart();break;case 'add-existing':addPhone(id);break;
 case 'edit':showEditor(id);break;case 'edit-unit':showEditor(id,Number(target.dataset.index));break;
 case 'expand':expanded.has(id)?expanded.delete(id):expanded.add(id);render();break;
 case 'close-editor':closeEditor();break;case 'close-panel':closePanel();break;
 case 'clear-phone-data':clearPhoneDraft();break;
 case 'draft-catalogs':if(closeEditor()){settingsTab='options';await settingsPanel();}break;
 case 'append-unit':readDraft();draft.instances.push(blankUnit());dirty=true;editorRender(draft.instances.length-1);break;
 case 'camera-unit':$('camera-unit-'+target.dataset.index).click();break;
 case 'gallery-unit':$('gallery-unit-'+target.dataset.index).click();break;
 case 'remove-image':readDraft();draft.image='';dirty=true;editorRender();break;
 case 'remove-photo':readDraft();draft.photos.splice(Number(target.dataset.photo),1);dirty=true;editorRender();break;
 case 'main-unit-photo':{readDraft();const photos=draft.instances[Number(target.dataset.index)].photos;photos.unshift(photos.splice(Number(target.dataset.photo),1)[0]);dirty=true;editorRender(Number(target.dataset.index));break;}
 case 'remove-unit-photo':readDraft();draft.instances[Number(target.dataset.index)].photos.splice(Number(target.dataset.photo),1);dirty=true;editorRender(Number(target.dataset.index));break;
 case 'photo':panel('Photo',`<img class="photo-full" src="${esc(target.dataset.url)}" alt="Phone photo">`);break;
 case 'note':panel('Note — '+name(record(id)),`<div class="pre">${esc(record(id).note)}</div>`);break;
 case 'columns':columnsPanel();break;
 case 'column-up':case 'column-down':{const k=target.dataset.key,a=unique([...db.settings.columns,...columns.map(c=>c[0])]),i=a.indexOf(k),j=i+(action==='column-up'?-1:1);if(j<0||j>=a.length)break;[a[i],a[j]]=[a[j],a[i]];db.settings.columns=a.filter(k=>db.settings.columns.includes(k));await api('/api/settings',db.settings);columnsPanel();render();break;}
 case 'copy-unit':copyUnit(id,Number(target.dataset.index));break;
 case 'card-units':{const r=record(id);panel(name(r),unitTiles(r)+modelActions(r));break;}
 case 'split-model':splitModelId=id;render();break;
 case 'layout':setCollectionLayout(target.dataset.layout);if($('default-layout'))$('default-layout').value=collectionLayout;break;
 case 'server-stop':case 'server-restart':{
 if(dirty||uploadCount||catalogReturn)throw Error('Save or discard your current edits first.');
 if(action==='server-stop'&&!confirm('Stop MyPhoneLibrary on this computer?'))break;
 const before=await api('/api/status');
 if(action==='server-restart'){reconnecting=true;startupStatus('Restarting server…','Applying the staged update. Keep this page open.');}
 try{await api('/api/server-control',{action:action==='server-stop'?'stop':'restart'});}catch(error){reconnecting=false;startupStatus('Restart request failed',error.message,true);throw error;}
 reconnecting=false;
 if(action==='server-restart')await reconnectAfterRestart(before.instance||null);
 else toast('Server stopped. Open My Phone Library to start it again.');break;
 }
 case 'nav-view':currentView=target.dataset.view;$('search').value='';quickFilters={};render();break;
 case 'settings-tab':settingsTab=target.dataset.tab;document.querySelectorAll('[data-settings-section]').forEach(el=>el.hidden=el.dataset.settingsSection!==settingsTab);document.querySelectorAll('[data-action="settings-tab"]').forEach(el=>el.classList.toggle('active',el.dataset.tab===settingsTab));break;
 case 'catalogs':settingsTab='options';await settingsPanel();break;
 case 'catalog-list':catalogList(target.dataset.category);break;
 case 'catalog-item':{const item=db.catalog.find(x=>x.id===id);catalogEditor(item.category,id);break;}
 case 'catalog-new':catalogEditor(target.dataset.category);break;
 case 'add-spec':panelDirty=true;$('catalog-specs').insertAdjacentHTML('beforeend',specRow());break;
 case 'remove-spec':panelDirty=true;target.closest('.spec-row').remove();break;
 case 'catalog-delete':{
 const item=id?db.catalog.find(x=>x.id===id):catalogDraft;
 const related=[...db.records,...db.trash].filter(r=>[r,...r.instances||[]].some(o=>o.catalog_refs?.[item.category]===item.id));
 if(!confirm('Delete '+item.name+'?'+(related.length?' Used by '+related.length+' records. Their text is kept, but the catalog link and specifications are removed.':'')))break;
 await api('/api/catalog-delete',{id:item.id,rev:item.rev,confirm_linked:true});await refresh();catalogList(item.category);toast('Catalog item deleted.');break;
 }
 case 'catalog-save':{const specs=catalogDraft.category==='battery'?{...catalogDraft.specs}:{};document.querySelectorAll('[data-battery-spec]').forEach(el=>{if(el.value.trim())specs[el.dataset.batterySpec]=el.value.trim();else delete specs[el.dataset.batterySpec];});for(const row of document.querySelectorAll('.spec-row')){const key=row.querySelector('[data-spec-key]').value.trim(),value=row.querySelector('[data-spec-value]').value;if(!key&&value)throw Error('Enter a property name.');if(key){if(key in specs)throw Error('Property names must be unique.');specs[key]=value;}}const saved=await api('/api/catalog',{...catalogDraft,name:$('catalog-name').value,description:$('catalog-description')?.value??catalogDraft.description,source:$('catalog-source')?.value??catalogDraft.source,parent_id:$('location-parent')?.value||'',compatible_batteries:catalogDraft.category==='battery'?[...document.querySelectorAll('[data-battery-compatible]:checked')].map(x=>x.dataset.batteryCompatible):[],compatible:catalogDraft.category==='battery'?(catalogDraft.compatible||[]):[...document.querySelectorAll('[data-catalog-compatible]:checked')].map(x=>x.dataset.catalogCompatible),specs});await refresh();catalogEditor(saved.category,saved.id);toast('Catalog item saved. Linked records updated.');break;}
 case 'browse-backup':await openFolderPicker(target.dataset.field);break;

 case 'network-test':target.disabled=true;try{await loadNetwork(true);}finally{target.disabled=false;}break;
 case 'network-refresh':target.disabled=true;try{await loadNetwork();}finally{target.disabled=false;}break;
 case 'settings':await settingsPanel();break;
 case 'theme-select':$('theme').value=target.dataset.themeChoice;panelDirty=true;document.querySelectorAll('[data-theme-choice]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.themeChoice===$('theme').value)));break;
 case 'save-settings':{db.settings.default_page=$('default-page').value;db.settings.density=$('display-density').value;db.settings.theme=$('theme').value;db.settings.backup_days=Number($('backup-days').value);db.settings.backup_copies=Number($('backup-copies').value);db.settings.backup_directory=$('backup-directory').value;db.settings.backup_primary=$('backup-primary').value;db.settings.network_local=$('network-local').value;db.settings.network_remote=$('network-remote').value;document.querySelectorAll('[data-options]').forEach(el=>db.settings.options[el.dataset.options]=unique(el.value.split('\n').map(s=>s.trim())));await api('/api/settings',db.settings);await refresh();panelDirty=false;await loadBackupStatus();toast('Settings saved.');break;}
 case 'custom-fields':customFieldsPanel();break;
 case 'add-custom':{const label=$('custom-label').value.trim();if(!label)throw Error('Enter a field name.');db.settings.custom_fields.push({id:crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):'field'+Date.now(),label,type:$('custom-type').value,options:unique($('custom-options').value.split(',').map(s=>s.trim()))});await api('/api/settings',db.settings);customFieldsPanel();break;}
 case 'save-view':{const label=$('saved-filter-name')?.value.trim();if(!label)throw Error('Enter a name for this filter.');const views=[...(db.settings.views||[]),{name:label.slice(0,100),filter:currentView,query:$('search').value,quickFilters:{...quickFilters},showWanted,sort:{...sort}}];await api('/api/settings',{views});await refresh();savedFiltersPanel();toast('Filter saved.');break;}
 case 'offline-export':offlineExport();break;
 case 'export':exportPanel();break;case 'export-json':download(JSON.stringify(db,null,2),'MyPhoneLibrary-export.json');break;case 'export-csv':exportCSV();break;case 'export-table':exportCSV(true);break;
 case 'import':importPanel();break;
 case 'commit-import':{if(!importRows)break;if(!confirm('Import these records? A backup will be created first.'))break;const p=await api('/api/import',{rows:importRows,commit:true});await refresh();$('panel').close();toast(`Imported ${p.imported} rows; errors ${p.errors.length}; skipped ${p.skipped}.`);break;}
 case 'backups':await backupsPanel();break;
 case 'create-backup':{const p=await api('/api/backup',{});await loadBackups();toast(p.warning||'Backup created and verified.');break;}
 case 'trash':trashPanel();break;
 case 'note-popup':showNotePopup(target);break;
 case 'copy-model':copyModel(id);break;
 case 'delete-unit':{const r=record(id),u=r.instances[Number(target.dataset.index)];if(!u)throw Error('Phone not found. Refresh the collection.');if(!confirm('Move only phone #'+u.inv+' ('+name(r)+') to trash? Other phones and the model will remain.'))break;await api('/api/trash-unit',{id,unit:u.id,rev:r.rev});selectedUnits.delete(u.id);dirty=false;$('editor').close();draft=null;await refresh();toast('Phone moved to trash.');break;}
 case 'delete-record':{const r=record(id);if(!confirm(r.kind==='phone'?'Move '+name(r)+' and ALL '+r.instances.length+' phones to trash?':'Move this part to trash?'))break;await api('/api/trash',{id,rev:record(id).rev});dirty=false;$('editor').close();draft=null;await refresh();toast('Record moved to trash.');break;}
 case 'purge':{const r=db.trash.find(r=>r.id===id);if(!confirm('Permanently delete '+name(r)+' and all its units? This cannot be undone from Trash.'))break;await api('/api/purge',{id,rev:r.rev});await refresh();trashPanel();break;}
 case 'untrash':{const r=db.trash.find(r=>r.id===id);await api('/api/untrash',{id,rev:r.rev});await refresh();trashPanel();break;}
 case 'move':movePanel(id);break;
 case 'save-move':{const [rid,uid]=$('move-unit').value.split(':');await api('/api/move',{part_id:id,action:$('move-action').value,quantity:Number($('move-qty').value),record_id:rid,instance_id:uid,note:$('move-note').value});await refresh();if(draft?.id===id){draft=clone(record(id));editorRender();}movePanel(id);toast('Stock movement saved.');break;}
 case 'repairs':repairsPanel(id);break;
 case 'save-repair':await api('/api/repair',{record_id:id,instance_id:$('repair-unit').value,status:$('repair-status').value,cost:Number($('repair-cost').value),currency:$('repair-currency').value,note:$('repair-note').value});await refresh();repairsPanel(id);break;
 case 'finish-repair':{const r=db.repairs.find(r=>r.id===id);await api('/api/repair',{...r,status:'Završen'});await refresh();repairsPanel(r.record_id);break;}
 case 'inventory':inventoryPanel();break;
 case 'start-inventory':{const i=await api('/api/inventory',{location:$('inventory-location').value});await refresh();inventoryPanel(i.id);break;}
 case 'open-inventory':inventoryPanel(id);break;
 case 'close-inventory':if(!confirm('Complete this inventory check and save its results?'))break;await api('/api/inventory',{id,action:'close'});await refresh();inventoryPanel(id);break;
 case 'export-inventory':{const i=db.inventories.find(x=>x.id===id);download(csvText([['Inventory no.','Model','Location','Found','Time'],...Object.entries(i.expected).map(([uid,u])=>[u.inv,u.model,u.location,i.found[uid]?'Yes':'No',i.found[uid]||''])]),'Inventory check.csv','text/csv;charset=utf-8');break;}
 case 'history':await historyPanel(id);break;
 case 'gsm-preview':target.disabled=true;try{await gsmPanel();}finally{target.disabled=false;}break;
 case 'apply-gsm':{document.querySelectorAll('[data-gsm]:checked').forEach(el=>{const k=el.dataset.gsm,v=preview.fields[k];if(catalogNames[k]&&!(db.catalog||[]).some(x=>x.category===k&&normal(x.name)===normal(v)))throw Error('Add '+v+' to '+catalogNames[k]+' first.');if(draft.id&&['alias','type','os','gsm','wiki'].includes(k)&&draft.instances[editorUnitIndex])draft.instances[editorUnitIndex][k]=v;else draft[k]=v;});if($('gsm-specs').checked)draft.specs={...(draft.specs||{}),...preview.specs};draft.provenance={source:preview.source,at:preview.at};dirty=true;$('panel').close();editorRender(mode==='add'?draft.instances.length-1:null);break;}
 case 'labels':labelsPanel(id);break;case 'generate-labels':generateLabels(id);break;case 'print':window.print();break;
 case 'password':panel('Change password','<div class="grid two"><label>Current password<input type="password" id="old-password" autocomplete="current-password"></label><label>New password<input type="password" id="new-password" minlength="8" autocomplete="new-password"></label></div><div class="actions"><button class="primary" data-action="save-password">Save new password</button></div>');break;
 case 'save-password':await api('/api/password',{old:$('old-password').value,password:$('new-password').value});$('panel').close();await boot();toast('Password changed. Sign in again.');break;
 case 'update-info':await updatePanel();break;
 case 'save-update-repo':{db.settings.update_repo=$('update-repo').value.trim();await api('/api/settings',db.settings);panelDirty=false;toast('Update source saved.');break;}
 case 'check-update':{target.disabled=true;try{const result=await api('/api/update-check',IS_ANDROID_APP?{platform:'android',current_version:androidVersion()}:{});
 if(IS_ANDROID_APP){
  if(result.platform!=='android')throw Error('Update the Windows server to 1.16.0 or newer to check the Android channel.');
  const link=$('android-download');link.hidden=!result.available;
  if(result.available){const url=new URL(result.url);if(url.origin!=='https://github.com'||!url.pathname.startsWith('/ermintr-cyber/MyMediaLibrary-Releases/releases/download/phone-android-v')||!url.pathname.endsWith('.apk'))throw Error('Invalid Android download.');link.href=url.href;}
 }else{$('install-update').hidden=!result.available;}
 $('update-result').textContent=result.available?'Available '+(IS_ANDROID_APP?'Android ':'Windows ')+'version '+result.version:'The latest '+(IS_ANDROID_APP?'Android':'Windows')+' version is installed.';}finally{target.disabled=false;}break;}
 case 'install-update':{if(IS_ANDROID_APP)throw Error('Install Windows updates from the Windows app.');const pending=unsavedWorkReasons();if(pending.length)throw Error('Unsaved changes — '+pending.join(' '));target.disabled=true;try{updateMessage('Starting updater…',true);const result=await api('/api/update-install',{});sessionStorage.setItem('mpl-install-target',result.version);await watchInstallation();}finally{target.disabled=false;}break;}

 }}catch(e){toast(e.message);if(['check-update','install-update','server-restart','save-update-repo'].includes(action))updateMessage('Update operation failed: '+e.message);if($('editor').open)$('editor-error').textContent=e.message;}
});
document.addEventListener('change',async e=>{const el=e.target;try{
 if(el.dataset.checkField){readCheckControls();dirty=true;return;}
 if(el.dataset.r==='battery'&&$('editor-battery-alternatives')){$('editor-battery-alternatives').textContent=batteryAlternatives(el.value).length?'Compatible batteries: '+batteryAlternatives(el.value).map(x=>x.name).join(' · '):'';}
 if(el.matches?.('[data-combo-query]')){const c=el.closest('.catalog-combo');if(syncCombo(c))c.querySelector('input[type="hidden"]').dispatchEvent(new Event('change',{bubbles:true}));}
 if(el.id==='default-layout'){setCollectionLayout(el.value);return;}
 if(el.dataset.quickFilter){quickFilters[el.dataset.quickFilter]=el.value;render();return;}
 if(el.id==='editor-unit-select'){readDraft();editorRender(Number(el.value));return;}
 if(el.dataset.selectRecord){const r=record(el.dataset.selectRecord);for(const u of shownUnits(r))if(!el.dataset.selectUnit||u.id===el.dataset.selectUnit){if(el.checked)selectedUnits.add(u.id);else selectedUnits.delete(u.id);}render();return;}
 if(['imei','imei2'].includes(el.dataset.u))imeiWarnings();
 if(el.matches('[data-r="brand"],[data-r="model"]')){matchModel();refreshBatterySuggestions();refreshModelOptions(draft?.brand);if($('editor-charger-suggestions'))$('editor-charger-suggestions').innerHTML=chargerSuggestionsHTML(draft);}
 if(el.id==='view'){const v=el.value;if(v.startsWith('saved-'))$('search').value=db.settings.views[Number(v.slice(6))]?.query||'';render();}
 if(el.dataset.column){const k=el.dataset.column;if(el.checked&&!db.settings.columns.includes(k))db.settings.columns.push(k);if(!el.checked)db.settings.columns=db.settings.columns.filter(x=>x!==k);await api('/api/settings',db.settings);render();}
 if(el.id==='main-image-upload'&&el.files.length)await uploadFiles(el.files,'main');
 if(el.id==='gallery-upload'&&el.files.length)await uploadFiles(el.files);
 if(el.dataset.unitUpload!==undefined&&el.files.length)await uploadFiles(el.files,Number(el.dataset.unitUpload));
 if(el.id==='update-file'&&el.files.length){const r=await api('/api/update',el.files[0],true);sessionStorage.setItem('mpl-update-target',r.version);updateMessage('Version '+r.version+' is ready. Click Restart server to apply it.');}
 if(el.id==='import-file'&&el.files.length)await importPreview(el.files[0]);
 if(el.id==='restore-file'&&el.files.length){if(!confirm('Replace the collection with this backup? Current data will be backed up first.')){el.value='';return;}await api('/api/restore',el.files[0],true);$('panel').close();await boot();toast('Data restored. Sign in using the password from the backup.');}
 if(el.dataset.inventory){await api('/api/inventory',{id:el.dataset.inventory,instance_id:el.dataset.unit,found:el.checked});await refresh();if($('panel').open&&$('panel-body').querySelector('[data-inventory="'+el.dataset.inventory+'"]'))inventoryPanel(el.dataset.inventory);}
 }catch(error){toast(error.message);if($('editor').open)$('editor-error').textContent=error.message;}
});
function prepareNextPhone(saved,previous){phoneDraft=null;draft=clone(saved);mode='add';const u=blankUnit();for(const k of ['color','edition','alias','type','os','gsm','wiki','memory'])if(previous[k])u[k]=previous[k];draft.instances.push(u);addUnit=u;dirty=false;editorRender(draft.instances.length-1);$('editor').scrollTop=0;}
$('record-form').addEventListener('submit',async e=>{e.preventDefault();if(uploadCount){toast('Photos are still uploading.');return;}if(!validateCombos($('editor-content')))return;readDraft();if(mode==='acquire'&&!ACTIVE.includes(draft.instances[editorUnitIndex]?.condition)){$('editor-error').textContent='Choose In collection or On loan for the acquired phone.';return;}const duplicates=imeiWarnings()||[];if(duplicates.length&&!confirm('Duplicate IMEI detected. Review the warning above. Save anyway?'))return;const another=e.submitter?.id==='save-add-another',previous=clone(draft.instances[editorUnitIndex]||{});$('record-save').disabled=true;$('save-add-another').disabled=true;try{const r=await api('/api/record',{record:draft,rev:draft.rev});await refresh();if(mode==='add')phoneDraft=null;dirty=false;expanded.add(r.id);render();if(another){prepareNextPhone(r,previous);toast('Phone saved. Ready for the next unit.');}else{$('editor').close();draft=null;toast('Phone / record saved.');}}catch(error){$('editor-error').textContent=error.message;}finally{$('record-save').disabled=false;$('save-add-another').disabled=false;}});
$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-error').textContent='';$('login-submit').disabled=true;try{await api($('login-form').dataset.setup==='true'?'/api/setup':'/api/login',{password:$('password').value,remember:$('remember-me').checked});$('password').value='';window.MyPhoneLibraryAndroid?.sessionChanged?.();await boot();}catch(error){$('login-error').textContent=error.message;}finally{$('login-submit').disabled=false;}});
$('editor-content').addEventListener('input',e=>{dirty=true;if(e.target?.dataset?.r==='model')refreshBatterySuggestions();});
$('editor-content').addEventListener('change',()=>dirty=true);
$('panel-body').addEventListener('input',e=>{if(panelRoute&&e.target.id!=='default-layout')panelDirty=true;});
$('panel-body').addEventListener('change',e=>{if(panelRoute&&e.target.id!=='default-layout')panelDirty=true;});
$('panel').addEventListener('cancel',e=>{e.preventDefault();closePanel();});
$('editor').addEventListener('click',e=>{if(outsideDialog(e,$('editor')))closeEditor();});
$('panel').addEventListener('click',e=>{if(!panelRoute&&outsideDialog(e,$('panel')))closePanel();});
document.addEventListener('keydown',e=>{
 const c=e.target?.closest?.('.catalog-combo');if(c){const menu=c.querySelector('.combo-menu');if(e.key==='Escape'&&!menu.hidden){e.preventDefault();closeCombos();c.querySelector('[data-combo-query]').focus();return;}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(menu.hidden)openCombo(c,true);const a=[...menu.querySelectorAll('[role=option]')],i=a.indexOf(e.target);a[(i+(e.key==='ArrowDown'?1:-1)+a.length)%a.length]?.focus();return;}if(e.key==='Enter'&&e.target.matches('[data-combo-query]')&&!menu.hidden){e.preventDefault();menu.querySelector('[role=option]')?.click();return;}}

 if(quickEdit&&e.key==='Enter'&&e.target?.id==='quick-value'){e.preventDefault();saveQuick().catch(e=>toast(e.message));return;}
 if(e.key!=='Escape'||e.defaultPrevented)return;
 if(quickEdit){e.preventDefault();quickEdit=null;render();return;}
 if($('editor').open){e.preventDefault();closeEditor();}
 else if($('panel').open){e.preventDefault();closePanel();}
});
$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
$('search').addEventListener('input',render);
$('collection-table').addEventListener('click',e=>{const th=e.target.closest('[data-sort]');if(!th||Date.now()<ignoreSortUntil||['select','image','actions'].includes(th.dataset.sort))return;sort={key:th.dataset.sort,dir:sort.key===th.dataset.sort?-sort.dir:1};render();});
$('collection-table').addEventListener('dragstart',e=>{const th=e.target.closest('[data-column-key]');if(!th||th.dataset.columnKey==='image')return;dragColumn=th.dataset.columnKey;e.dataTransfer.setData('text/plain',dragColumn);e.dataTransfer.effectAllowed='move';th.classList.add('dragging');});
$('collection-table').addEventListener('dragover',e=>{const th=e.target.closest('[data-column-key]');if(th&&dragColumn){e.preventDefault();e.dataTransfer.dropEffect='move';}});
$('collection-table').addEventListener('drop',async e=>{const th=e.target.closest('[data-column-key]');if(!th||!dragColumn||th.dataset.columnKey==='image')return;e.preventDefault();const keys=[...$('collection-table').querySelectorAll('[data-column-key]')].map(t=>t.dataset.columnKey);const from=dragColumn,to=th.dataset.columnKey;dragColumn=null;ignoreSortUntil=Date.now()+400;if(from===to)return;keys.splice(keys.indexOf(from),1);keys.splice(keys.indexOf(to),0,from);try{await api('/api/settings',{columns:keys});db.settings.columns=keys;render();}catch(error){toast(error.message);}});
$('collection-table').addEventListener('dragend',()=>{dragColumn=null;document.querySelectorAll('.dragging').forEach(e=>e.classList.remove('dragging'));});
window.addEventListener('beforeunload',e=>{if(quickEdit||dirty||phoneDraft||panelDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('offline',checkConnection);
window.addEventListener('online',checkConnection);
window.addEventListener('focus',checkConnection);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkConnection();});
window.addEventListener('hashchange',()=>{if(!db)return;const params=new URLSearchParams(location.hash.slice(1));const id=params.get('record'),unit=params.get('unit'),r=record(id);if(r)showEditor(id,r.instances.findIndex(u=>u.id===unit));});
document.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.alt='Image unavailable';e.target.style.background='var(--surface2)';}},true);
restoreSidebar();
boot().then(()=>{if(!IS_ANDROID_APP&&sessionStorage.getItem('mpl-install-target'))watchInstallation();setTimeout(monitorConnection,10000);if(location.hash&&db)window.dispatchEvent(new Event('hashchange'));});

window.mplHandleAndroidBack=function(){if($('editor').open){closeEditor();return true;}if($('panel').open){closePanel();return true;}return false;};
