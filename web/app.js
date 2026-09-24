'use strict';
const UI_VERSION='1.6.1';
let serverInstance=null,versionMismatch=false,connectionCheckBusy=false,catalogReturn=null;
let settingsTab='appearance',currentView='all',dragColumn=null,ignoreSortUntil=0;
const $=id=>document.getElementById(id), clone=x=>JSON.parse(JSON.stringify(x));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normal=s=>String(s??'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
const enumLabel=v=>({"U kolekciji": "In collection", "Posuđen": "On loan", "Prodan": "Sold", "Poklonjen": "Gifted", "Rastavljen": "Dismantled", "Rashodovan": "Retired", "Netestiran": "Untested", "Ispravan": "Working", "Djelimično ispravan": "Partly working", "Neispravan": "Not working", "Kolekcija": "Collection", "Za popravak": "For repair", "Donor": "Donor", "Za prodaju": "For sale", "Za razmjenu": "For trade", "Obična": "Standard", "Music Edition": "Music Edition", "Limited Edition": "Limited Edition", "Nepoznato": "Unknown", "Original": "Original", "Zamjenski": "Replacement", "Miješano": "Mixed", "Otključan": "Unlocked", "SIM-lock": "SIM lock", "Drugi lock": "Other lock", "Dodaj": "Add", "Rezerviši": "Reserve", "Oslobodi": "Release", "Ugradi": "Install", "Ugradi rezervisano": "Install reserved", "Otpiši": "Write off", "Otvoren": "Open", "U radu": "In progress", "Čeka dijelove": "Waiting for parts", "Završen": "Completed", "Netestirano": "Untested", "Ispravno": "Working", "Neispravno": "Not working", "Novo": "New", "Korišteno": "Used"})[v]||v;
const ACTIVE=['U kolekciji','Posuđen'];
let uploadCount=0,phoneDraft=null,panelRoute=null,panelDirty=false;
let db=null,csrf='',draft=null,mode='edit',addUnit=null,dirty=false,expanded=new Set(),sort={key:'brand',dir:1},importRows=null,preview=null,toastTimer;
const columns=[['image','Image'],['inv','Inv. no.'],['brand','Brand'],['model','Model name'],['alias','Model number / Variant'],['type','Type code'],['product_code','Product code'],['colors','Colors'],['editions','Editions'],['battery','Battery'],['charger','Charger'],['state','Condition'],['rating','Cosmetic'],['owned','Owned'],['box','Box'],['os','Operating system'],['released','Released'],['introduced','Introduced'],['qty','Qty'],['parts','Parts'],['location','Location'],['value','Value'],['gsm','GSM'],['wiki','Wiki'],['note','Note'],['actions','Actions']];
const opts={state:['Netestiran','Ispravan','Djelimično ispravan','Neispravan'],condition:['U kolekciji','Wanted'],purpose:['Kolekcija','Za popravak','Donor','Za prodaju','Za razmjenu'],edition:['Standard','Music Edition','Limited Edition'],currency:['KM'],originality:['Nepoznato','Original','Zamjenski','Miješano'],lock:['Nepoznato','Otključan','SIM-lock','Drugi lock']};
const live=r=>(r.instances||[]).filter(u=>ACTIVE.includes(u.condition));
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
async function boot(){
 try{const status=await api('/api/status');serverInstance=status.instance||null;csrf=status.csrf||'';$('login').hidden=status.authenticated;$('application').hidden=!status.authenticated;
 $('login-description').textContent=status.setup?'Set a password for your collection.':'Sign in to access your phones.';
 $('login-submit').textContent=status.setup?'Create collection':'Sign in';$('login-form').dataset.setup=String(status.setup);
 if(status.authenticated)await refresh();
 const completed=sessionStorage.getItem('mpl-update-complete');
 if(completed&&status.version===completed){
  $('update-banner').hidden=false;$('update-banner').textContent='Update completed successfully. Installed version: '+completed;
  sessionStorage.removeItem('mpl-update-complete');sessionStorage.removeItem('mpl-update-target');
 }
 }catch(e){$('login').hidden=false;$('login-error').textContent='Server unavailable. Start MyPhoneLibrary on your computer.';}finally{hideStartup();}
}
function hasUnsavedWork(){return !!(dirty||phoneDraft||panelDirty||catalogReturn||uploadCount);}
function connectionBanner(message){const el=$('connection-banner');el.hidden=false;$('connection-message').textContent=message;}
async function checkConnection(){
 if(connectionCheckBusy||reconnecting)return;connectionCheckBusy=true;
 try{
  const options={cache:'no-store'};if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)options.signal=AbortSignal.timeout(4000);
  const response=await fetch('/api/status',options);if(!response.ok)throw Error('unavailable');
  const status=await response.json();
  versionMismatch=status.version!==UI_VERSION;
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
async function refresh(){db=await api('/api/data');document.documentElement.dataset.theme=db.settings.theme||'dark';$('connection').textContent='Connected';lists();render();}
function lists(){
 const values={...db.settings.options,edition:opts.edition};
 for(const key of Object.keys(values))values[key]=unique(values[key]);
 $('datalists').innerHTML=Object.entries(values).map(([key,a])=>`<datalist id="options-${esc(key)}">${a.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist>`).join('');
 $('model-suggestions').innerHTML=db.records.filter(r=>r.kind==='phone').map(r=>`<option value="${esc(r.model)}">${esc(r.brand)}</option>`).join('');

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
 case 'type':return r.type||'';
 default:return r[key]??'';
}}
function filtered(){
 let q=normal($('search').value),view=currentView;
 if(view.startsWith('saved-')){const v=db.settings.views[Number(view.slice(6))];if(v){view=v.filter;q=normal($('search').value||v.query);}}
 let rows=db.records.filter(r=>{if(view==='phone'||view==='part'){if(r.kind!==view)return false;}if(view==='wish'&&!r.wishlist&&!(r.instances||[]).some(u=>u.condition==='Wanted'))return false;if(view==='duplicates'&&live(r).length<2)return false;if(view==='untested'&&!live(r).some(u=>u.state==='Netestiran'))return false;if(view==='repair'&&!live(r).some(u=>u.purpose==='Za popravak'||u.state==='Neispravan'||u.state==='Djelimično ispravan'))return false;return !q||normal(JSON.stringify(r)).includes(q);});
 return rows.sort((a,b)=>{const av=value(a,sort.key),bv=value(b,sort.key);return sort.dir*(typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'bs',{numeric:true}));});
}
function image(r){const src=r.image||(r.photos||[])[0];return src?`<img class="thumb" src="${esc(src)}" alt="${esc(name(r))}" loading="lazy" data-action="photo" data-url="${esc(src)}">`:'<span class="thumb-placeholder" aria-label="No photo">▯</span>';}
function cell(r,key){const v=value(r,key);if(catalogNames[key])return catalogLink(key,v);if(key==='colors')return unique(live(r).map(u=>u.color)).map(v=>catalogLink('color',v)).join(', ');if(key==='state')return esc(unique(live(r).map(u=>enumLabel(u.state))).join(', ')||enumLabel(r.condition)||'—');if(key==='editions')return esc(unique(live(r).map(u=>enumLabel(u.edition))).join(', '));if(key==='image')return `<div class="model-image-cell">${r.kind==='phone'?`<button class="expand-model" data-action="expand" data-id="${r.id}" aria-label="Show or hide units" aria-expanded="${expanded.has(r.id)}">${expanded.has(r.id)?'▾':'▸'}</button>`:'<span class="expand-spacer"></span>'}${image(r)}</div>`;
 if(key==='model')return `<strong>${esc(r.model)}</strong><small>${r.kind==='part'?'Part / accessory':(r.wishlist||(r.instances||[]).some(u=>u.condition==='Wanted'))?'Wanted':''}</small>`;
 if(key==='qty')return `<button class="number-pill" data-action="${r.kind==='part'?'move':'expand'}" data-id="${r.id}">${esc(v)}</button>${r.declared_qty?`<small class="muted"> To verify: ${esc(r.declared_qty)}</small>`:''}`;
 if(key==='parts')return r.kind==='phone'?`${v}${r.declared_parts?` <span class="muted">(${esc(r.declared_parts)} ?)</span>`:''}`:`${r.quantity-r.reserved} available / ${r.reserved} reserved`;
 if(key==='owned')return v?'<span class="good">✓</span>':'<span class="muted">—</span>';
 if(key==='rating')return v?`<span class="stars">★ ${esc(v)}</span>`:'—';
 if(key==='inv')return live(r).length>1?`<button class="link" data-action="expand" data-id="${r.id}">${live(r).length} numbers ▾</button>`:esc(v)||'—';
 if(key==='gsm'||key==='wiki')return v?`<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${key==='gsm'?'GSM ↗':'Wiki ↗'}</a>`:'—';
 if(key==='note')return v?`<button class="quiet" data-action="note" data-id="${r.id}" aria-label="View note">☷</button>`:'—';
 if(key==='actions')return `<button data-action="edit" data-id="${r.id}">Edit</button>`;
 return esc(v)||'—';}
function unitImage(r,u){const own=(u.photos||[])[0],src=own||r.image||(r.photos||[])[0];return src?`<img class="thumb" src="${esc(src)}" alt="${esc(u.inv)}" title="${own?'Unit photo':'Model catalog image'}" data-action="photo" data-url="${esc(src)}">${own?`<small>${u.photos.length} ${u.photos.length===1?'photo':'photos'}</small>`:'<small>Catalog</small>'}`:'<span class="thumb-placeholder" aria-label="No photo">▯</span>';}
function copyUnit(id,index){if(phoneDraft&&!confirm('Replace the saved phone draft with this copy?'))return;phoneDraft=null;mode='add';draft=clone(record(id));addUnit=clone(draft.instances[index]);for(const key of ['id','inv','imei','imei2','serial'])delete addUnit[key];addUnit.photos=[];draft.instances.push(addUnit);dirty=true;editorRender(draft.instances.length-1);$('editor').showModal();$('editor').scrollTop=0;toast('Copy ready. Enter the IMEI and review the new unit details.');}
function unitTiles(r){return `<div class="unit-list">${(r.instances||[]).map((u,i)=>`<article class="unit-line"><div class="unit-photo">${unitImage(r,u)}</div><div class="unit-overview"><strong>${esc(u.inv)}</strong><span>${catalogLink('color',u.color)} · ${esc(enumLabel(u.edition))||'Standard'}</span></div><div><small>Condition</small>${esc(enumLabel(u.state))}<small>${esc(enumLabel(u.condition))}</small></div><div><small>IMEI</small>${u.imei?esc(u.imei.slice(0,3)+'••••'+u.imei.slice(-4)):'—'}</div><div><small>Box / battery</small>${triLabel(u.box)} / ${triLabel(u.battery_present)}</div><div><small>Location</small>${catalogLink('location',u.location)}</div><div class="unit-actions"><button data-action="edit-unit" data-id="${r.id}" data-index="${i}">Edit</button><button data-action="copy-unit" data-id="${r.id}" data-index="${i}">Copy</button></div></article>`).join('')||'<p>No units yet.</p>'}</div>`;}
function modelActions(r){return `<div class="row-actions"><button class="primary" data-action="add-existing" data-id="${r.id}">+ Add another</button><button data-action="repairs" data-id="${r.id}">Repairs</button><button data-action="labels" data-id="${r.id}">QR labels</button><button data-action="history" data-id="${r.id}">History</button><button data-action="edit" data-id="${r.id}">Model details and images</button></div>`;}
function expandedRow(r,count){return r.kind==='phone'?`<tr class="row-expanded"><td colspan="${count}">${unitTiles(r)}${modelActions(r)}</td></tr>`:'';}
function phoneCard(r){return `<article class="phone-card"><div class="card-image">${image(r)}<span class="card-qty">${esc(value(r,'qty'))} ${r.kind==='phone'?'units':'parts'}</span></div><div class="card-content"><small>${catalogLink('brand',r.brand)}</small><h2>${esc(r.model)}</h2><p>${esc(value(r,'colors')||r.part_category||'—')}</p><p class="subtle">${esc(value(r,'editions').split(', ').map(enumLabel).join(', '))}</p><dl><div><dt>Battery</dt><dd>${catalogLink('battery',r.battery)}</dd></div><div><dt>Charger</dt><dd>${catalogLink('charger',r.charger)}</dd></div><div><dt>Condition</dt><dd>${esc(value(r,'state').split(', ').map(enumLabel).join(', '))||'—'}</dd></div></dl><div class="actions"><button data-action="edit" data-id="${r.id}">Edit model</button>${r.kind==='phone'?`<button class="primary" data-action="card-units" data-id="${r.id}">View units</button>`:`<button data-action="move" data-id="${r.id}">Stock</button>`}</div></div></article>`;}

function render(){
 document.querySelectorAll('[data-action="nav-view"]').forEach(el=>el.classList.toggle('active',el.dataset.view===currentView));
 const rows=filtered(), visible=db.settings.columns.filter(k=>columns.some(c=>c[0]===k));
 for(const mandatory of ['image','model','qty','actions'])if(!visible.includes(mandatory))visible.push(mandatory);
 visible.splice(visible.indexOf('image'),1);visible.unshift('image');
 $('collection-table').innerHTML=`<thead><tr>${visible.map(k=>`<th scope="col" draggable="${k!=='image'}" data-column-key="${k}" title="${k==='image'?'Image and expand control stay first':'Drag to reorder; click to sort'}" data-sort="${k}">${esc(columns.find(c=>c[0]===k)[1])}${sort.key===k?(sort.dir===1?' ↑':' ↓'):''}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${visible.map(k=>`<td class="${k==='model'?'model-cell':['colors','editions','state','note','location','type'].includes(k)?'wrap':''}">${cell(r,k)}</td>`).join('')}</tr>${expanded.has(r.id)?expandedRow(r,visible.length):''}`).join('')}</tbody>`;
 $('table-wrap').hidden=!rows.length||db.settings.layout==='cards';$('card-grid').hidden=db.settings.layout!=='cards'||!rows.length;$('card-grid').innerHTML=db.settings.layout==='cards'?rows.map(phoneCard).join(''):'';document.querySelectorAll('[data-action="layout"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.layout===(db.settings.layout||'list'))));$('empty').hidden=db.records.length>0;
 const phones=db.records.filter(r=>r.kind==='phone'), units=phones.flatMap(live),parts=db.records.filter(r=>r.kind==='part');
 $('summary').innerHTML=[[phones.length,'models'],[units.length,'phones'],[parts.reduce((s,r)=>s+r.quantity,0),'parts / accessories'],[units.filter(u=>u.state==='Ispravan').length,'working'],[units.filter(u=>u.state==='Netestiran').length,'untested']].map(([v,l])=>`<div><strong>${v}</strong><span>${l}</span></div>`).join('');
 $('results').textContent=`${rows.length} / ${db.records.length} rows`;$('footer-count').textContent='MyPhoneLibrary '+db.version+' · '+new Date().toLocaleTimeString('en-GB');
}
function triLabel(v){return v===true?'✓ Yes':v===false?'No':'?';}
function field(label,key,val,{index=null,type='text',list='',choices=null,required=false}={}){
 const attr=index===null?`data-r="${esc(key)}"`:`data-u="${esc(key)}" data-index="${index}"`;
 let control;
 if(choices){const a=choices.map(v=>Array.isArray(v)?v:[v,v]);if(val!==undefined&&val!==null&&val!==''&&!a.some(([v])=>String(v)===String(val)))a.unshift([val,val]);control=`<select ${attr}>${a.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(val??'')?'selected':''}>${esc(enumLabel(l))}</option>`).join('')}</select>`;}
 else if(type==='textarea')control=`<textarea ${attr}>${esc(val)}</textarea>`;
 else if(type==='checkbox')return `<label class="check"><input ${attr} type="checkbox" ${val?'checked':''}>${esc(label)}</label>`;
 else control=`<input ${attr} type="${type}" value="${esc(val)}" ${list?`list="${esc(list)}"`:''} ${required?'required':''} ${type==='number'?'min="0" step="any"':''}>`;
 const category=list.startsWith('options-')?list.slice(8):null;
 const heading=category&&catalogNames[category]?`<button type="button" class="link catalog-field-label" data-action="field-catalog" data-category="${category}">${esc(label)} ↗</button>`:esc(label);
 return `<label>${heading}${control}</label>`;
}
function triField(label,key,val,index){return field(label,key,val===true?'true':val===false?'false':'',{index,choices:[['','Nepoznato'],['true','Yes'],['false','No']]});}
function amountCurrency(obj){return !['KM','BAM',''].includes(obj.currency||'')&&(Number(obj.price)||Number(obj.value))?obj.currency:'KM';}
function blankUnit(){return {inv:'',color:'',edition:'Standard',state:'Netestiran',condition:'U kolekciji',purpose:'Kolekcija',rating:0,location:'',currency:'KM',photos:[],box:null,battery_present:null,charger_present:null,manual:null,headphones:null,matching_box:null};}
function newRecord(kind='phone'){return {kind,brand:'',model:'',image:'',instances:[],photos:[],compatible:[],quantity:0,reserved:0,custom:{},specs:{},currency:'KM',rating:0};}
function record(id){return db.records.find(r=>r.id===id);}
function showEditor(id,unitIndex=null){draft=clone(record(id));mode='edit';addUnit=null;dirty=false;editorRender(unitIndex);$('editor').showModal();$('editor').scrollTop=0;}
function addPhone(id=null){
 mode='add';
 if(phoneDraft&&(!id||phoneDraft.id===id)){draft=clone(phoneDraft);dirty=true;}
 else {if(phoneDraft&&!confirm('Replace the saved phone draft?'))return;draft=id?clone(record(id)):newRecord();draft.instances.push(blankUnit());dirty=false;}
 addUnit=draft.instances.at(-1);lists();editorRender(draft.instances.length-1);$('editor').showModal();$('editor').scrollTop=0;
}
function clearPhoneDraft(){
 if(uploadCount){toast('Wait for photos to finish uploading.');return;}
 if(!confirm('Clear all entered data and photos from this unsaved phone?'))return;
 phoneDraft=null;draft=newRecord();draft.instances.push(blankUnit());addUnit=draft.instances[0];dirty=false;editorRender(0);
}
function addPart(){mode='part';draft=newRecord('part');dirty=false;editorRender();$('editor').showModal();$('editor').scrollTop=0;}
function readDraft(){
 if(!draft)return;
 $('editor-content').querySelectorAll('[data-r]').forEach(el=>{const k=el.dataset.r;draft[k]=el.type==='checkbox'?el.checked:el.value;});
 $('editor-content').querySelectorAll('[data-u]').forEach(el=>{const u=draft.instances[Number(el.dataset.index)],k=el.dataset.u;if(!u)return;let v=el.type==='checkbox'?el.checked:el.value;if(['box','battery_present','charger_present','manual','headphones','matching_box'].includes(k))v=v==='true'?true:v==='false'?false:null;u[k]=v;});
 $('editor-content').querySelectorAll('[data-custom]').forEach(el=>{draft.custom[el.dataset.custom]=el.type==='checkbox'?el.checked:el.value;});
 const compatibility=$('compatibility');if(compatibility)draft.compatible=[...compatibility.querySelectorAll('input:checked')].map(el=>el.value);
 if(mode==='add')addUnit=draft.instances.at(-1);
}
function matchModel(){
 if(mode!=='add')return;readDraft();const b=draft.brand,m=draft.model;
 const match=db.records.find(r=>r.kind==='phone'&&normal(r.brand)===normal(b)&&normal(r.model)===normal(m));
 if((match?.id||null)===(draft.id||null))return;
 const unit=clone(addUnit);draft=match?clone(match):Object.assign(newRecord(),{brand:b,model:m});draft.instances.push(unit);addUnit=unit;editorRender(draft.instances.length-1);dirty=true;
}
function unitHTML(u,i,open){return `<details class="instance" ${open?'open':''}><summary><strong>${esc(u.inv)||'New unit'}</strong><span>${esc([u.color,u.edition].filter(Boolean).join(' · '))}</span><span class="muted">${esc(enumLabel(u.state))}</span></summary><div class="instance-body"><div class="grid">
${field('Inventory number (blank = automatic)','inv',u.inv,{index:i})}${field('Color','color',u.color,{index:i,list:'options-color'})}${field('Edition','edition',u.edition,{index:i,list:'options-edition'})}
${field('IMEI 1','imei',u.imei,{index:i})}${field('IMEI 2','imei2',u.imei2,{index:i})}${field('Serial number','serial',u.serial,{index:i})}
${field('Product code','product_code',u.product_code,{index:i})}${field('Memory variant','memory',u.memory,{index:i})}${field('Installed firmware / OS','firmware',u.firmware,{index:i})}
${field('Working condition','state',u.state,{index:i,choices:opts.state})}${field('Cosmetic condition','rating',u.rating,{index:i,choices:[[0,'Not rated'],[1,'★ 1 / 5'],[2,'★★ 2 / 5'],[3,'★★★ 3 / 5'],[4,'★★★★ 4 / 5'],[5,'★★★★★ 5 / 5']]})}${field('Location','location',u.location,{index:i,list:'options-location'})}
${field('Purpose','purpose',u.purpose,{index:i,choices:opts.purpose})}${field('Ownership status','condition',u.condition,{index:i,choices:opts.condition})}
${triField('Box','box',u.box,i)}${triField('Battery included','battery_present',u.battery_present,i)}${triField('Charger included','charger_present',u.charger_present,i)}${triField('Manual','manual',u.manual,i)}${triField('Headphones','headphones',u.headphones,i)}${triField('Box IMEI matches','matching_box',u.matching_box,i)}
${field('Acquisition date','purchase_date',u.purchase_date,{index:i,type:'date'})}${field('Purchased from / source','source',u.source,{index:i})}${field('Lock status','lock',u.lock||'Nepoznato',{index:i,choices:opts.lock})}
${field('Purchase price ('+amountCurrency(u)+')','price',u.price||0,{index:i,type:'number'})}${field('Estimated value ('+amountCurrency(u)+')','value',u.value||0,{index:i,type:'number'})}
<div class="span-all">${field('Unit notes / faults','note',u.note,{index:i,type:'textarea'})}</div></div>
<div class="gallery">${(u.photos||[]).map((src,j)=>`<figure><img src="${esc(src)}" alt="Unit photo" data-action="photo" data-url="${esc(src)}"><button type="button" data-action="remove-unit-photo" data-index="${i}" data-photo="${j}">Remove</button></figure>`).join('')}</div><div class="actions" id="unit-photos-${i}"><button type="button" data-action="camera-unit" data-index="${i}">Take photo</button><button type="button" data-action="gallery-unit" data-index="${i}">From gallery</button><span class="subtle">Personal photos of this physical phone · ${(u.photos||[]).length}</span></div><input hidden id="camera-unit-${i}" type="file" accept="image/*" capture="environment" data-unit-upload="${i}"><input hidden id="gallery-unit-${i}" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple data-unit-upload="${i}">
<small>These details belong to this physical unit only. IMEI is optional.</small></div></details>`;}
function editorRender(unitIndex=null){
 const part=draft.kind==='part';$('editor-title').textContent=part?(draft.id?'Edit part / accessory':'Add part / accessory'):mode==='add'?'Add phone':name(draft);
 $('editor-kicker').textContent=part?'PART IN COLLECTION':mode==='add'?'ONE NEW UNIT':'MODEL AND INDIVIDUAL UNITS';$('record-save').textContent=mode==='add'?'Add phone':'Save changes';$('editor-error').textContent='';
 const rf=(l,k,o={})=>field(l,k,draft[k],o);
 const indices=part?[]:mode==='add'?[draft.instances.length-1]:draft.instances.map((_,i)=>i);
 const addIndex=draft.instances.length-1;
 const displayImage=draft.image;
 $('editor-content').innerHTML=`${mode==='add'?'<div class="actions"><button type="button" data-action="draft-catalogs">Catalogs</button><button type="button" data-action="clear-phone-data">Clear data</button><small>Close keeps this draft until you save or clear it.</small></div>':''}<div class="editor-overview"><div class="photo-box">${displayImage?`<img src="${esc(displayImage)}" alt="Phone photo" data-action="photo" data-url="${esc(displayImage)}">`:'<span class="thumb-placeholder">▯</span>'}<label>Model image — list and cards<input id="main-image-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><small>Shared catalog image for this model. Add your own unit photos below.</small>${draft.image?'<button type="button" data-action="remove-image">Remove model image</button>':''}</div><div class="grid two">
${rf('Brand','brand',{list:'options-brand',required:!part})}${rf(part?'Part name':'Model name','model',{list:part?'':'model-suggestions',required:true})}${rf('Model number / Variant','alias')}${rf('Type code','type')}
${part?rf('Part category','part_category',{list:'options-part_category'}):rf('Operating system','os',{list:'options-os'})}${rf('Battery / code','battery',{list:'options-battery'})}${rf('Charger / connector','charger',{list:'options-charger'})}
${part?rf('Location','location',{list:'options-location'}):''}</div></div>
${mode==='add'?`<p class="hint" id="match-message">${draft.id?`Existing model <strong>${esc(name(draft))}</strong>. The new unit will join this row. Current units: ${(record(draft.id)?live(record(draft.id)).length:0)} .`:'Enter brand and model. An existing model will receive this new unit in the same row.'}</p>`:''}
<details class="section" ${part?'open':''}><summary>Additional model details ${part?' / part':''}</summary><div class="grid" style="margin-top:15px">
${rf('Released — year, month or date','released')}${rf('Introduced','introduced')}${rf('GSMArena link','gsm',{type:'url'})}${rf('Wikipedia link','wiki',{type:'url'})}${rf('Model image URL — list and cards','image')}
${part?`${draft.id?`<p class="hint">Total ${draft.quantity}; reserved ${draft.reserved}. Change quantities using Stock movements.</p>`:rf('Initial quantity','quantity',{type:'number'})}${rf('Part condition','condition',{choices:['Netestirano','Ispravno','Neispravno','Novo','Korišteno']})}${rf('Color','color',{list:'options-color'})}${rf('Purchase price per item ('+amountCurrency(draft)+')','price',{type:'number'})}${rf('Estimated value per item ('+amountCurrency(draft)+')','value',{type:'number'})}`:''}
${rf('Unverified quantity (e.g. 2???)','declared_qty')}${rf('Unverified legacy parts count','declared_parts')}
<div class="span-all">${rf('Model / part notes','note',{type:'textarea'})}</div></div><div class="checks">${rf('Favorite','favorite',{type:'checkbox'})}${rf('Wishlist','wishlist',{type:'checkbox'})}</div>
${!part?'<button type="button" data-action="gsm-preview">Get data from GSMArena</button>':''}</details>
${part?`<section class="section"><h3>Compatible models</h3><div class="checks" id="compatibility">${db.records.filter(r=>r.kind==='phone').map(r=>`<label class="check"><input type="checkbox" value="${r.id}" ${(draft.compatible||[]).includes(r.id)?'checked':''}>${esc(name(r))}</label>`).join('')||'<p class="subtle">Add a phone model first.</p>'}</div></section>`:`<section class="section"><div class="section-header"><h3>${mode==='add'?'New unit details':'Individual units — '+draft.instances.length}</h3>${mode!=='add'?'<button type="button" data-action="append-unit">+ Another unit</button>':''}</div>${indices.map(i=>unitHTML(draft.instances[i],i,i===unitIndex||indices.length===1)).join('')}</section>`}
${db.settings.custom_fields.length?`<section class="section"><h3>Custom fields</h3><div class="grid" style="margin-top:12px">${db.settings.custom_fields.map(f=>customHTML(f,draft.custom[f.id])).join('')}</div></section>`:''}
<section class="section"><h3>Model gallery</h3><div class="gallery">${(draft.photos||[]).map((src,i)=>`<figure><img src="${esc(src)}" alt="Photo" data-action="photo" data-url="${esc(src)}"><button type="button" data-action="remove-photo" data-photo="${i}">Remove</button></figure>`).join('')}</div><label>Add photos<input id="gallery-upload" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif"></label></section>
${Object.keys(draft.specs||{}).length?`<details class="section"><summary>Imported specifications</summary><div class="pre">${esc(Object.entries(draft.specs).filter(([,v])=>v).map(([k,v])=>k+': '+v).join('\n'))}</div></details>`:''}
${draft.id&&mode!=='add'?`<div class="actions"><button type="button" data-action="history" data-id="${draft.id}">History</button>${part?`<button type="button" data-action="move" data-id="${draft.id}">Stock movements</button>`:''}<button type="button" class="danger" data-action="delete-record" data-id="${draft.id}">Move to trash</button></div>`:''}`;
}
function customHTML(f,v){let control;const attr=`data-custom="${esc(f.id)}"`;
 if(f.type==='select')control=`<select ${attr}><option value="">—</option>${(f.options||[]).map(s=>`<option ${s===v?'selected':''}>${esc(s)}</option>`).join('')}</select>`;
 else if(f.type==='checkbox')return `<label class="check"><input type="checkbox" ${attr} ${v?'checked':''}>${esc(f.label)}</label>`;
 else control=`<input ${attr} type="${esc(f.type)}" value="${esc(v)}">`;
 return `<label>${esc(f.label)}${control}</label>`;
}
function panel(title,html,route=null){
 const el=$('panel');if(el.open)el.close();el.querySelector('.dialog-notice')?.remove();el.classList.remove('settings-page');
 if(catalogReturn)html='<div class="actions"><button data-action="return-phone">← Return to phone</button></div>'+html;
 panelRoute=route;panelDirty=false;$('panel-title').textContent=title;$('panel-body').innerHTML=html;
 if(route){el.classList.add('settings-page');el.show();}else el.showModal();
}
function allowPanelLeave(){return !panelDirty||confirm('Discard unsaved settings or catalog changes?');}
function closePanel(){
 if(!allowPanelLeave())return;const route=panelRoute;
 if(route?.kind==='item'){catalogList(route.category);return;}
 if(route?.kind==='catalog'&&catalogReturn){returnToPhone();return;}
 if(route?.kind==='catalog'){settingsTab='options';settingsPanel();return;}
 $('panel').close();panelRoute=null;panelDirty=false;
}
function closeEditor(){
 if(uploadCount){toast('Wait for photos to finish uploading.');return false;}
 if(mode==='add'){readDraft();phoneDraft=clone(draft);}
 else if(dirty&&!confirm('Discard unsaved changes?'))return false;
 $('editor').close();draft=null;dirty=false;return true;
}
function download(text,filename,type='application/json'){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([text],{type}));a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function exportPanel(){panel('Export collection',`<p>JSON contains models and individual units. Open CSV in a spreadsheet. Use a ZIP backup for complete recovery including photos.</p><div class="actions"><button data-action="export-json" class="primary">JSON — all data</button><button data-action="export-csv">CSV — all units</button><button data-action="export-table">CSV — current table</button><button data-action="offline-export">Offline view</button></div>`);}
function csvText(rows){return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');}
function exportCSV(table=false){let rows;if(table){const keys=db.settings.columns.filter(k=>!['image','actions'].includes(k));rows=[keys.map(k=>columns.find(c=>c[0]===k)?.[1]||k),...filtered().map(r=>keys.map(k=>value(r,k)))];}else{const keys=['inv','color','edition','type','product_code','imei','imei2','serial','state','rating','box','battery_present','charger_present','condition','purpose','location','price','value','currency','note'];rows=[['Brand','Model name','Model number / Variant','Type code',...keys],...db.records.filter(r=>r.kind==='phone').flatMap(r=>(r.instances||[]).map(u=>[r.brand,r.model,r.alias,r.type,...keys.map(k=>u[k])]))];}download(csvText(rows),table?'MyPhoneLibrary-tabela.csv':'MyPhoneLibrary-units.csv','text/csv;charset=utf-8');}
function offlineExport(){
 const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyPhoneLibrary — offline view</title><style>body{font:14px/1.6 system-ui;background:#101720;color:#e4ecf5;padding:20px;max-width:1100px;margin:auto}details{border:1px solid #3a475a;border-radius:9px;margin:12px 0;padding:14px}summary{cursor:pointer;font-weight:600}table{width:100%;border-collapse:collapse}td,th{text-align:left;border-bottom:1px solid #3a475a;padding:9px}p{color:#a5b5ca}.scroll{overflow:auto}small{color:#a5b5ca}</style><h1>MyPhoneLibrary</h1><p>Offline view · '+esc(new Date().toLocaleString('en-GB'))+' · read only, without photos. This private file contains inventory numbers and IMEI data.</p>'+db.records.map(r=>'<details><summary>'+esc(name(r))+' · '+value(r,'qty')+(r.kind==='phone'?' phones':' parts')+'</summary><p>'+esc([r.type,r.battery,r.charger,r.os].filter(Boolean).join(' · '))+'</p><p>'+esc(r.note)+'</p>'+(r.kind==='phone'?'<div class="scroll"><table><thead><tr><th>Inventory no.</th><th>Color / edicija</th><th>IMEI</th><th>Condition / status</th><th>Location</th><th>Note</th></tr></thead><tbody>'+r.instances.map(u=>'<tr><td>'+esc(u.inv)+'</td><td>'+esc([u.color,u.edition].filter(Boolean).join(' / '))+'</td><td>'+esc(u.imei)+'</td><td>'+esc(u.state+' / '+u.condition)+'</td><td>'+esc(u.location)+'</td><td>'+esc(u.note)+'</td></tr>').join('')+'</tbody></table></div>':'<p>Location: '+esc(r.location)+' · Available: '+(r.quantity-r.reserved)+'</p>')+'</details>').join('')+'</html>';
 download(html,'MyPhoneLibrary-offline.html','text/html;charset=utf-8');toast('Offline view downloaded.');
}
function columnsPanel(){panel('Table columns',`<p class="subtle">Hiding a column keeps its data. Image, model, quantity and actions remain visible.</p><div class="settings-list">${unique([...db.settings.columns,...columns.map(c=>c[0])]).map(k=>{const c=columns.find(c=>c[0]===k);return c?`<div class="setting-row"><label class="check"><input type="checkbox" data-column="${k}" ${db.settings.columns.includes(k)?'checked':''} ${['image','model','qty','actions'].includes(k)?'disabled':''}>${esc(c[1])}</label><button data-action="column-up" data-key="${k}" aria-label="Move up">↑</button><button data-action="column-down" data-key="${k}" aria-label="Move down">↓</button></div>`:'';}).join('')}</div>`);}
const catalogNames={brand:'Brands',color:'Colors',location:'Locations',battery:'Batteries',charger:'Chargers',os:'Operating systems',part_category:'Part categories'};
function catalogLink(category,value){const item=(db.catalog||[]).find(x=>x.category===category&&x.name.toLowerCase()===String(value||'').toLowerCase());return item?`<button class="link catalog-link" data-action="catalog-item" data-id="${item.id}">${esc(item.name)}</button>`:esc(value)||'—';}
function catalogList(category){settingsTab='options';panel(catalogNames[category],`<div class="actions"><button data-action="settings">Back to settings</button><button class="primary" data-action="catalog-new" data-category="${category}">+ Add item</button></div><div class="settings-list">${(db.catalog||[]).filter(x=>x.category===category).map(x=>`<div class="setting-row"><div>${catalogLink(category,x.name)}<small>${esc(x.description.slice(0,100))||'No description yet'}</small></div><span>${Object.keys(x.specs).length} specifications</span><button class="danger catalog-row-delete" data-action="catalog-delete" data-id="${x.id}">Delete</button></div>`).join('')||'<p>No items yet.</p>'}</div>`,{kind:'catalog',category});}
let catalogDraft=null;
function specRow(key='',value=''){return `<div class="spec-row"><input data-spec-key value="${esc(key)}" placeholder="Property — e.g. Capacity (mAh)" aria-label="Property name"><input data-spec-value value="${esc(value)}" placeholder="Value" aria-label="Property value"><button data-action="remove-spec" aria-label="Remove property">×</button></div>`;}
function catalogEditor(category,id){catalogDraft=clone((db.catalog||[]).find(x=>x.id===id)||{category,name:'',description:'',specs:{},source:''});const e=catalogDraft;const related=db.records.filter(r=>[r,...r.instances||[]].some(o=>o.catalog_refs?.[category]===id));panel(e.name||'New '+catalogNames[category]+ ' item',`<div class="actions"><button data-action="catalog-list" data-category="${category}">← ${catalogNames[category]}</button></div><div class="grid two"><label>Name<input id="catalog-name" value="${esc(e.name)}"></label><label>Source link<input id="catalog-source" type="url" value="${esc(e.source)}"></label><label class="wide">Description<textarea id="catalog-description">${esc(e.description)}</textarea></label></div><h3>Specifications</h3><div id="catalog-specs">${Object.entries(e.specs).map(([k,v])=>specRow(k,v)).join('')}</div><button data-action="add-spec">+ Add property</button><h3>Linked models and parts</h3><p>${related.map(r=>esc(name(r))).join(' · ')||'No linked records yet.'}</p><div class="actions"><button class="primary" data-action="catalog-save">Save item</button>${e.id?'<button class="danger" data-action="catalog-delete">Delete item</button>':''}</div>`,{kind:'item',category});}
async function loadNetwork(test=false){const info=await api(test?'/api/network-test':'/api/network',test?{}:undefined);if(!$('network-status'))return;const endpoints=info.endpoints;$('network-status').innerHTML=`<p>Server port: <strong>${info.port}</strong> · Tailscale: ${esc(info.tailscale)}</p><div class="network-grid">${endpoints.map(e=>`<div class="network-card"><strong>${esc(e.label)}</strong><small class="network-result ${e.status==='Reachable from server'?'reachable':e.status==='Not reachable from server'?'unreachable':''}">${e.status.includes('eachable from server')?'● ':''}${esc(e.status)}</small><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a></div>`).join('')}</div>${info.error?`<p>${esc(info.error)}</p>`:''}`;const local=$('network-local').value||endpoints.find(e=>e.label==='Local network')?.url;const remote=$('network-remote').value||endpoints.find(e=>e.label==='Tailscale MagicDNS')?.url||endpoints.find(e=>e.label==='Tailscale IP')?.url;$('network-qr').innerHTML=unique([local,remote].filter(Boolean)).map(address=>{const qr=qrcode(0,'M');qr.addData(address);qr.make();return `<div><img alt="Connection QR code" src="${qr.createDataURL(4,8)}"><p>${esc(address)}</p></div>`;}).join('')||'<p>No LAN or Tailscale address detected. Enter a preferred address and save it.</p>';}
async function settingsPanel(){
 const tabs=[['appearance','✦ Appearance'],['options','☷ Catalogs'],['backup','▣ Backup'],['network','⌁ Network'],['maintenance','⚒ Maintenance'],['about','ⓘ About']];
 const section=(key,html)=>`<section data-settings-section="${key}" ${settingsTab===key?'':'hidden'}>${html}</section>`;
 panel('Settings',`<div class="settings-layout"><nav class="settings-tabs">${tabs.map(([key,label])=>`<button class="${settingsTab===key?'active':''}" data-action="settings-tab" data-tab="${key}">${label}</button>`).join('')}</nav><div class="settings-content">
 ${section('appearance',`<h2>Appearance and layout</h2><p class="subtle">A compact collection workspace, styled like MyMediaLibrary.</p><div class="settings-fields"><label>Theme<select id="theme"><option value="dark" ${db.settings.theme!=='light'?'selected':''}>Dark / gold</option><option value="light" ${db.settings.theme==='light'?'selected':''}>Light / gold</option></select></label></div><div class="actions"><button data-action="columns">Columns and order</button></div>`)}
 ${section('options',`<h2>Catalogs</h2><p class="subtle">Each item is a reusable object with its own description and specifications.</p><div class="catalog-grid">${Object.entries(catalogNames).map(([k,label])=>`<button data-action="catalog-list" data-category="${k}"><strong>${label}</strong><small>${(db.catalog||[]).filter(x=>x.category===k).length} items</small></button>`).join('')}</div>`)}
 ${section('backup',`<h2>Backup and recovery</h2><div class="settings-fields"><label>Automatic backup — interval in days<input id="backup-days" type="number" min="1" max="30" value="${db.settings.backup_days}"></label><label>Number of local backups<input id="backup-copies" type="number" min="2" max="100" value="${db.settings.backup_copies}"></label><label>First backup location<div class="folder-control"><input id="backup-primary" value="${esc(db.settings.backup_primary||'')}" placeholder="${esc(db.backup_default)}"><button data-action="browse-backup" data-field="backup-primary">Browse…</button></div></label><label>Second backup location<div class="folder-control"><input id="backup-directory" value="${esc(db.settings.backup_directory)}"><button data-action="browse-backup" data-field="backup-directory">Browse…</button></div></label><p class="subtle">Locations are folders on the host computer. Leave the first location blank to use ${esc(db.backup_default)}. A local recovery copy is also retained.</p></div><div class="actions"><button data-action="backups">Backups and restore</button></div>`)}
 ${section('network',`<h2>Network access</h2><p class="subtle">One server for this computer, your local network and Tailscale.</p><div id="network-status">Loading network adapters…</div><div class="actions"><button data-action="network-refresh">Refresh connection status</button><button data-action="network-test">Test all connections</button></div><div class="settings-fields"><label>Preferred local address<input id="network-local" value="${esc(db.settings.network_local||'')}" placeholder="Automatic — detected local address"></label><label>Preferred remote address<input id="network-remote" value="${esc(db.settings.network_remote||'')}" placeholder="Automatic — Tailscale MagicDNS or IP"></label></div><p class="subtle">Leave blank for automatic selection. Status is detected on the server; access from your phone also depends on its network and the Windows firewall.</p><details><summary>Connect a phone</summary><div id="network-qr" class="network-grid"></div><p>Scan an address reachable from your phone and sign in with your library password.</p></details><p class="hint">Use a private LAN or Tailscale. Keep the application port closed on your router.</p><button data-action="password">Change password</button>`)}
 ${section('maintenance',`<h2>Collection maintenance</h2><div class="actions"><button data-action="server-restart">Restart server</button><button data-action="server-stop">Stop server</button></div><div class="actions"><button data-action="import">Import</button><button data-action="export">Export</button><button data-action="trash">Trash</button><button data-action="custom-fields">Custom fields</button><button data-action="inventory">Inventory check</button></div>`)}
 ${section('about',`<h2>MyPhoneLibrary</h2><p>Version ${esc(db.version)}</p><p class="subtle">Your personal phone, unit and parts collection.</p>${updateContents()}`)}
 <div class="actions settings-save"><button data-action="save-settings" class="primary">Save settings</button></div></div></div>`,{kind:'settings'});loadNetwork().catch(e=>{if($('network-status'))$('network-status').textContent=e.message;});loadUpdateState().catch(e=>updateMessage(e.message));
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
function customFieldsPanel(){panel('Custom fields',`<p class="subtle">Fields appear in the model or part editor. Existing values are preserved.</p><div class="settings-list">${db.settings.custom_fields.map(f=>`<div class="setting-row"><span>${esc(f.label)} <small>${esc(f.type)}</small></span></div>`).join('')}</div><div class="grid" style="margin-top:18px"><label>Field name<input id="custom-label" placeholder="e.g. Country of manufacture"></label><label>Type<select id="custom-type"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="checkbox">Checkbox</option><option value="select">Dropdown</option></select></label><label>Options (comma-separated)<input id="custom-options"></label></div><div class="actions"><button class="primary" data-action="add-custom">Add field</button></div>`);}
async function backupsPanel(){const files=await api('/api/backups');panel('Backup and restore',`<p>The ZIP contains your database, photos and settings. Current data is backed up before restoring.</p><div class="actions"><button class="primary" data-action="create-backup">Create backup</button><label>Restore from ZIP backup<input id="restore-file" type="file" accept=".zip"></label></div><div class="settings-list" style="margin-top:18px">${files.map(f=>`<div class="setting-row"><span>${esc(f.name)} <small>${(f.bytes/1024/1024).toFixed(2)} MB</small></span><a href="/api/download-backup?name=${encodeURIComponent(f.name)}" download>Download</a></div>`).join('')||'<p class="subtle">No backups yet.</p>'}</div>`);}
function importPanel(){importRows=null;panel('Import collection',`<p>Upload a JSON export or legacy CSV. Preview records and errors before importing. Uncertain quantities such as 2??? remain unverified.</p><p class="hint">Use ZIP backup for full recovery. The all-units CSV is a report; legacy import expects one row per model.</p><label style="margin-top:15px">File<input id="import-file" type="file" accept=".json,.csv"></label><div id="import-preview"></div>`);}
function parseCSV(text){text=text.replace(/^\ufeff/,'');const delim=(text.split(/\r?\n/)[0].match(/;/g)||[]).length>(text.split(/\r?\n/)[0].match(/,/g)||[]).length?';':',';let rows=[],row=[],v='',quote=false;for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){v+='"';i++;}else quote=!quote;}else if(c===delim&&!quote){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(Boolean))rows.push(row);row=[];v='';}else v+=c;}if(quote)throw Error('CSV contains an unclosed quote.');if(v||row.length){row.push(v);rows.push(row);}const headers=rows.shift()||[];if(new Set(headers).size!==headers.length)throw Error('CSV has duplicate column names.');return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h.trim(),r[i]||''])));}
async function importPreview(file){const text=await file.text();if(file.name.toLowerCase().endsWith('.json')){const x=JSON.parse(text);importRows=Array.isArray(x)?x:x.records;if(!Array.isArray(importRows))throw Error('JSON must contain a records array.');}else importRows=parseCSV(text);const p=await api('/api/import',{rows:importRows});$('import-preview').innerHTML=`<p class="hint">To import: ${p.rows.length} · Duplicates skipped: ${p.skipped} · Errors: ${p.errors.length}</p><div class="import-table"><table><thead><tr><th>Row</th><th>Model</th><th>Units / quantity</th><th>To verify</th></tr></thead><tbody>${p.rows.map(r=>`<tr><td>${r.row}</td><td>${esc(r.brand+' '+r.model)}</td><td>${r.quantity}</td><td>${esc(r.uncertain)}</td></tr>`).join('')}</tbody></table></div>${p.errors.map(e=>`<p class="error">Row ${e.row}: ${esc(e.error)}</p>`).join('')}<div class="actions"><button class="primary" data-action="commit-import" ${p.rows.length?'':'disabled'}>Import ${p.rows.length} valid rows</button></div>`;}
function movePanel(id){const p=record(id);panel('Stock movements — '+p.model,`<p>Total: <strong>${p.quantity}</strong> · Available: <strong>${p.quantity-p.reserved}</strong> · Reserved: <strong>${p.reserved}</strong></p><div class="grid two" style="margin-top:16px"><label>Action<select id="move-action">${['Dodaj','Rezerviši','Oslobodi','Ugradi','Ugradi rezervisano','Otpiši'].map(s=>`<option value="${esc(s)}">${esc(enumLabel(s))}</option>`).join('')}</select></label><label>Quantity<input id="move-qty" type="number" min="1" step="1" value="1"></label><label>Target unit<select id="move-unit"><option value="">Select when installing</option>${db.records.filter(r=>r.kind==='phone').flatMap(r=>live(r).map(u=>`<option value="${r.id}:${u.id}">${esc(name(r)+' · '+u.inv+' · '+u.color)}</option>`)).join('')}</select></label><label>Note<input id="move-note"></label></div><div class="actions"><button class="primary" data-action="save-move" data-id="${id}">Save movement</button></div><h3 class="section">Stock history</h3>${db.movements.filter(m=>m.part_id===id).map(m=>`<div class="setting-row"><span>${esc(enumLabel(m.action))} · ${m.quantity} items <small>${esc(m.at)}</small></span><span>${esc(m.note)}</span></div>`).join('')||'<p class="subtle">No movements yet.</p>'}`);}
function repairsPanel(id){const r=record(id),repairs=db.repairs.filter(x=>x.record_id===id);panel('Repairs — '+name(r),`<div class="grid two"><label>Unit<select id="repair-unit">${r.instances.map(u=>`<option value="${u.id}">${esc(u.inv+' · '+u.color+' · '+u.edition)}</option>`).join('')}</select></label><label>Status<select id="repair-status">${['Otvoren','U radu','Čeka dijelove','Završen'].map(s=>`<option value="${esc(s)}">${esc(enumLabel(s))}</option>`).join('')}</select></label><label>Cost<input id="repair-cost" type="number" value="0" min="0" step="0.01"></label><label>Currency<select id="repair-currency">${opts.currency.map(s=>`<option value="${esc(s)}">${esc(enumLabel(s))}</option>`).join('')}</select></label><label class="span-all">Fault / work performed<textarea id="repair-note"></textarea></label></div><div class="actions"><button class="primary" data-action="save-repair" data-id="${id}" ${r.instances.length?'':'disabled'}>Add repair record</button></div><h3 class="section">Records</h3>${repairs.map(x=>`<div class="setting-row"><div><strong>${esc(r.instances.find(u=>u.id===x.instance_id)?.inv||'Unit')} · ${esc(enumLabel(x.status))}</strong><p>${esc(x.note)}</p><small>${x.cost} ${esc(x.currency)} · ${esc(x.at)}</small></div>${x.status!=='Završen'?`<button data-action="finish-repair" data-id="${x.id}">Complete</button>`:''}</div>`).join('')||'<p class="subtle">No repairs yet.</p>'}<p class="hint">Record installed parts through Stock movements to update quantities correctly.</p>`);}
function inventoryPanel(id=null){const inv=id?db.inventories.find(x=>x.id===id):null;if(inv){const entries=Object.entries(inv.expected);panel('Inventory check — '+(inv.location||'Entire collection'),`<p>Found ${Object.keys(inv.found).length} / ${entries.length} · ${inv.closed?'Completed':'In progress'}</p><p class="hint">Unconfirmed phones remain in the collection. Loaned units are marked separately.</p>${entries.map(([uid,u])=>`<label class="inventory-row ${inv.found[uid]?'found':''}"><input type="checkbox" data-inventory="${inv.id}" data-unit="${uid}" ${inv.found[uid]?'checked':''} ${inv.closed?'disabled':''}><span>${esc(u.inv+' · '+u.model)}<small>${esc(u.location||'No location')} · ${esc(enumLabel(u.condition))}</small></span></label>`).join('')}<div class="actions">${!inv.closed?`<button class="primary" data-action="close-inventory" data-id="${inv.id}">Complete inventory check</button>`:''}<button data-action="export-inventory" data-id="${inv.id}">Export results</button><button data-action="inventory">All inventory checks</button></div>`);return;}
 const locations=unique(db.records.flatMap(r=>live(r).map(u=>u.location)));
 panel('Inventory check',`<p>Check the phones at a selected location.</p><div class="actions"><select id="inventory-location"><option value="">Entire collection</option>${locations.map(l=>`<option>${esc(enumLabel(l))}</option>`).join('')}</select><button class="primary" data-action="start-inventory">Start inventory check</button></div><div class="settings-list" style="margin-top:18px">${db.inventories.map(i=>`<div class="setting-row"><div>${esc(i.location||'Entire collection')}<small> · ${esc(i.at)} · ${i.closed?'Completed':'In progress'} · ${Object.keys(i.found).length}/${Object.keys(i.expected).length}</small></div><button data-action="open-inventory" data-id="${i.id}">Open</button></div>`).join('')}</div>`);}
async function historyPanel(id){const history=await api('/api/history?id='+id);panel('Change history',history.map(h=>`<details class="setting-row" style="display:block"><summary>${esc(h.action)} · ${esc(h.at)}</summary><pre class="pre">${esc(JSON.stringify(JSON.parse(h.data),null,2))}</pre></details>`).join('')||'<p>No records yet.</p>');}
function trashPanel(){panel('Trash',`<p class="subtle">Records are retained and can be restored. Inventory numbers are released. Restore reuses the old number if available, otherwise assigns a new one. Permanent deletion removes the collection entry; historical audit records and backups are retained.</p><div class="settings-list">${db.trash.map(r=>`<div class="setting-row"><span>${esc(name(r))} · ${r.kind==='phone'?(r.instances||[]).length+' units':'part'}</span><div class="actions"><button data-action="untrash" data-id="${r.id}">Restore</button><button class="danger" data-action="purge" data-id="${r.id}">Delete permanently</button></div></div>`).join('')||'<p>Trash is empty.</p>'}</div>`);}
function updateContents(){return `<p>Installed version: <strong>${esc(db.version)}</strong></p><label>GitHub release repository (owner/name)<input id="update-repo" value="${esc(db.settings.update_repo||'')}" placeholder="owner/MyPhoneLibrary-Releases"></label><div class="actions"><button data-action="save-update-repo">Save source</button><button class="primary" data-action="check-update">Check for updates</button><button id="install-update" data-action="install-update" hidden>Download and stage update</button></div><p id="update-result" class="hint" role="status">${db.settings.update_repo?'Check GitHub for a new version.':'A GitHub release source has not been connected yet.'}</p><button data-action="server-restart">Restart server</button><h3 class="section">Update from file</h3><label>New release package (.zip)<input type="file" id="update-file" accept=".zip"></label><p class="hint">A backup is created before staging. Updates are applied on the next server start.</p>`;}
async function loadUpdateState(){
 const state=await api('/api/update-state');
 if(state.pending){sessionStorage.setItem('mpl-update-target',state.pending);updateMessage('Version '+state.pending+' is ready. Click Restart server to apply it.');}
 if(state.error)updateMessage('Update failed: '+state.error);
}
async function updatePanel(){settingsTab='about';await settingsPanel();}
async function gsmPanel(){readDraft();if(!draft.gsm)throw Error('Enter a GSMArena model link first.');toast('Fetching model details…');preview=await api('/api/gsm',{url:draft.gsm});panel('GSMArena details — '+preview.name,`<p>Select the details to import. Existing values are replaced only for selected fields.</p><div class="settings-list">${Object.entries(preview.fields).filter(([,v])=>v).map(([k,v])=>`<label class="check setting-row"><input type="checkbox" data-gsm="${k}" ${!draft[k]&&k!=='image'?'checked':''}><span><strong>${esc(({os:'Operating system',introduced:'Introduced',released:'Released / status',charger:'Connector',gsm:'Source',image:'Image'})[k])}</strong><br><small>${esc(v)}</small>${draft[k]?`<br><small>Current: ${esc(draft[k])}</small>`:''}</span></label>`).join('')}<label class="check setting-row"><input type="checkbox" id="gsm-specs" checked>All available extra specifications</label></div><p class="hint">Use your own photos or a permitted image source. Physical unit details are not imported.</p><div class="actions"><button class="primary" data-action="apply-gsm">Apply selected</button></div>`);}
function labelsPanel(id){const r=record(id);panel('Labels — '+name(r),`<label class="no-print">Application address accessible from your phone<input id="qr-base" value="${esc(location.origin)}"></label><div class="actions no-print"><button data-action="generate-labels" data-id="${id}">Generate QR</button><button data-action="print">Print</button></div><p class="hint no-print">Replace localhost with your computer’s LAN or Tailscale address. QR labels do not contain IMEI.</p><div id="labels" class="qr-print" style="margin-top:15px"></div>`);}
function generateLabels(id){const r=record(id),base=$('qr-base').value.trim();const parsed=new URL(base);if(!['http:','https:'].includes(parsed.protocol))throw Error('Invalid address.');if(typeof qrcode!=='function')throw Error('QR module unavailable.');$('labels').innerHTML=live(r).map(u=>{const qr=qrcode(0,'M');qr.addData(base.replace(/\/$/,'')+'/#record='+r.id+'&unit='+u.id);qr.make();return `<div class="label-print"><img src="${qr.createDataURL(4,8)}" alt="QR for ${esc(u.inv)}"><strong>${esc(name(r))}</strong><span>${esc(u.inv)}</span><small>${esc([u.color,u.edition].filter(Boolean).join(' · '))}</small></div>`;}).join('');}
async function uploadFiles(files,index=null){readDraft();uploadCount++;$('record-save').disabled=true;try{for(const file of files){if(file.size>10*1024*1024)throw Error('Photo exceeds 10 MB.');const p=await api('/api/upload',file,true);if(index==='main')draft.image=p.url;else if(index===null)draft.photos.push(p.url);else draft.instances[index].photos.push(p.url);}dirty=true;editorRender(typeof index==='number'?index:null);}finally{uploadCount--;$('record-save').disabled=uploadCount>0;}}

document.addEventListener('click',async event=>{
 const target=event.target.closest('[data-action]');if(!target)return;const action=target.dataset.action,id=target.dataset.id;
 try{
 const leavesPanel=['nav-view','settings','catalogs','catalog-list','catalog-item','catalog-new','add-phone','add-part','trash','backups','inventory','columns','custom-fields','password','update-info','import','export'];
 if($('panel').open&&leavesPanel.includes(action)){
  if(!allowPanelLeave())return;panelDirty=false;
  if(['nav-view','add-phone','add-part'].includes(action)){$('panel').close();panelRoute=null;}
 }
 switch(action){
 case 'retry-reconnect':await reconnectAfterRestart();break;
 case 'dismiss-reconnect':hideStartup();break;
 case 'reload-current':if(!hasUnsavedWork()||confirm('Reload and discard unsaved changes?')){dirty=false;phoneDraft=null;panelDirty=false;catalogReturn=null;location.reload();}break;
 case 'return-phone':returnToPhone();break;
 case 'field-catalog':{if(uploadCount)throw Error('Wait for photos to finish uploading.');readDraft();catalogReturn={draft:clone(draft),mode,dirty,index:mode==='add'?draft.instances.length-1:null};if(mode==='add')phoneDraft=clone(draft);$('editor').close();catalogList(target.dataset.category);break;}
 case 'refresh':await refresh();toast('Table refreshed.');break;
 case 'logout':if((dirty||phoneDraft||panelDirty)&&!confirm('Sign out and discard unsaved changes?'))break;await api('/api/logout',{});$('editor').close();$('panel').close();draft=null;phoneDraft=null;db=null;dirty=false;await boot();break;
 case 'add-phone':addPhone();break;case 'add-part':addPart();break;case 'add-existing':addPhone(id);break;
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
 case 'remove-unit-photo':readDraft();draft.instances[Number(target.dataset.index)].photos.splice(Number(target.dataset.photo),1);dirty=true;editorRender(Number(target.dataset.index));break;
 case 'photo':panel('Photo',`<img class="photo-full" src="${esc(target.dataset.url)}" alt="Phone photo">`);break;
 case 'note':panel('Note — '+name(record(id)),`<div class="pre">${esc(record(id).note)}</div>`);break;
 case 'columns':columnsPanel();break;
 case 'column-up':case 'column-down':{const k=target.dataset.key,a=unique([...db.settings.columns,...columns.map(c=>c[0])]),i=a.indexOf(k),j=i+(action==='column-up'?-1:1);if(j<0||j>=a.length)break;[a[i],a[j]]=[a[j],a[i]];db.settings.columns=a.filter(k=>db.settings.columns.includes(k));await api('/api/settings',db.settings);columnsPanel();render();break;}
 case 'copy-unit':copyUnit(id,Number(target.dataset.index));break;
 case 'card-units':{const r=record(id);panel(name(r),unitTiles(r)+modelActions(r));break;}
 case 'layout':await api('/api/settings',{layout:target.dataset.layout});db.settings.layout=target.dataset.layout;render();break;
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
 case 'nav-view':currentView=target.dataset.view;$('search').value='';render();break;
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
 case 'catalog-save':{const specs={};for(const row of document.querySelectorAll('.spec-row')){const key=row.querySelector('[data-spec-key]').value.trim(),value=row.querySelector('[data-spec-value]').value;if(!key&&value)throw Error('Enter a property name.');if(key){if(key in specs)throw Error('Property names must be unique.');specs[key]=value;}}const saved=await api('/api/catalog',{...catalogDraft,name:$('catalog-name').value,description:$('catalog-description').value,source:$('catalog-source').value,specs});await refresh();catalogEditor(saved.category,saved.id);toast('Catalog item saved. Linked records updated.');break;}
 case 'browse-backup':await openFolderPicker(target.dataset.field);break;

 case 'network-test':target.disabled=true;try{await loadNetwork(true);}finally{target.disabled=false;}break;
 case 'network-refresh':target.disabled=true;try{await loadNetwork();}finally{target.disabled=false;}break;
 case 'settings':await settingsPanel();break;
 case 'save-settings':{db.settings.theme=$('theme').value;db.settings.backup_days=Number($('backup-days').value);db.settings.backup_copies=Number($('backup-copies').value);db.settings.backup_directory=$('backup-directory').value;db.settings.backup_primary=$('backup-primary').value;db.settings.network_local=$('network-local').value;db.settings.network_remote=$('network-remote').value;document.querySelectorAll('[data-options]').forEach(el=>db.settings.options[el.dataset.options]=unique(el.value.split('\n').map(s=>s.trim())));await api('/api/settings',db.settings);await refresh();panelDirty=false;toast('Settings saved.');break;}
 case 'custom-fields':customFieldsPanel();break;
 case 'add-custom':{const label=$('custom-label').value.trim();if(!label)throw Error('Enter a field name.');db.settings.custom_fields.push({id:crypto.randomUUID?crypto.randomUUID().replace(/-/g,''):'field'+Date.now(),label,type:$('custom-type').value,options:unique($('custom-options').value.split(',').map(s=>s.trim()))});await api('/api/settings',db.settings);customFieldsPanel();break;}
 case 'save-view':{const label=prompt('Saved view name:');if(!label)break;let filter=currentView;if(filter.startsWith('saved-'))filter=db.settings.views[Number(filter.slice(6))]?.filter||'all';db.settings.views.push({name:label,filter,query:$('search').value});await api('/api/settings',db.settings);lists();toast('View saved.');break;}
 case 'offline-export':offlineExport();break;
 case 'export':exportPanel();break;case 'export-json':download(JSON.stringify(db,null,2),'MyPhoneLibrary-export.json');break;case 'export-csv':exportCSV();break;case 'export-table':exportCSV(true);break;
 case 'import':importPanel();break;
 case 'commit-import':{if(!importRows)break;if(!confirm('Import these records? A backup will be created first.'))break;const p=await api('/api/import',{rows:importRows,commit:true});await refresh();$('panel').close();toast(`Imported ${p.imported} rows; errors ${p.errors.length}; skipped ${p.skipped}.`);break;}
 case 'backups':await backupsPanel();break;
 case 'create-backup':{const p=await api('/api/backup',{});await backupsPanel();toast(p.warning||'Backup created and verified.');break;}
 case 'trash':trashPanel();break;
 case 'delete-record':{if(!confirm('Move this model and all its units to trash?'))break;await api('/api/trash',{id,rev:record(id).rev});dirty=false;$('editor').close();draft=null;await refresh();toast('Record moved to trash.');break;}
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
 case 'apply-gsm':{document.querySelectorAll('[data-gsm]:checked').forEach(el=>draft[el.dataset.gsm]=preview.fields[el.dataset.gsm]);if($('gsm-specs').checked)draft.specs={...(draft.specs||{}),...preview.specs};draft.provenance={source:preview.source,at:preview.at};dirty=true;$('panel').close();editorRender(mode==='add'?draft.instances.length-1:null);break;}
 case 'labels':labelsPanel(id);break;case 'generate-labels':generateLabels(id);break;case 'print':window.print();break;
 case 'password':panel('Change password','<div class="grid two"><label>Current password<input type="password" id="old-password" autocomplete="current-password"></label><label>New password<input type="password" id="new-password" minlength="8" autocomplete="new-password"></label></div><div class="actions"><button class="primary" data-action="save-password">Save new password</button></div>');break;
 case 'save-password':await api('/api/password',{old:$('old-password').value,password:$('new-password').value});$('panel').close();await boot();toast('Password changed. Sign in again.');break;
 case 'update-info':await updatePanel();break;
 case 'save-update-repo':{db.settings.update_repo=$('update-repo').value.trim();await api('/api/settings',db.settings);toast('Update source saved.');break;}
 case 'check-update':{target.disabled=true;try{const result=await api('/api/update-check',{});$('update-result').textContent=result.available?'Available version '+result.version:'The latest version is installed.';$('install-update').hidden=!result.available;}finally{target.disabled=false;}break;}
 case 'install-update':{target.disabled=true;try{updateMessage('Downloading and verifying update… Please wait.',true);const result=await api('/api/update-download',{});sessionStorage.setItem('mpl-update-target',result.version);updateMessage('Version '+result.version+' is ready. Click Restart server to apply it.');}finally{target.disabled=false;}break;}

 }}catch(e){toast(e.message);if(['check-update','install-update','server-restart','save-update-repo'].includes(action))updateMessage('Update operation failed: '+e.message);if($('editor').open)$('editor-error').textContent=e.message;}
});
document.addEventListener('change',async e=>{const el=e.target;try{
 if(el.matches('[data-r="brand"],[data-r="model"]'))matchModel();
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
$('record-form').addEventListener('submit',async e=>{e.preventDefault();if(uploadCount){toast('Photos are still uploading.');return;}readDraft();$('record-save').disabled=true;try{const r=await api('/api/record',{record:draft,rev:draft.rev});await refresh();if(mode==='add')phoneDraft=null;dirty=false;$('editor').close();draft=null;expanded.add(r.id);render();toast('Phone / record saved.');}catch(error){$('editor-error').textContent=error.message;}finally{$('record-save').disabled=false;}});
$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-error').textContent='';$('login-submit').disabled=true;try{await api($('login-form').dataset.setup==='true'?'/api/setup':'/api/login',{password:$('password').value});$('password').value='';await boot();}catch(error){$('login-error').textContent=error.message;}finally{$('login-submit').disabled=false;}});
$('editor-content').addEventListener('input',()=>dirty=true);
$('panel-body').addEventListener('input',()=>{if(panelRoute)panelDirty=true;});
$('panel-body').addEventListener('change',()=>{if(panelRoute)panelDirty=true;});
$('panel').addEventListener('cancel',e=>{e.preventDefault();closePanel();});
$('editor').addEventListener('click',e=>{if(outsideDialog(e,$('editor')))closeEditor();});
$('panel').addEventListener('click',e=>{if(!panelRoute&&outsideDialog(e,$('panel')))closePanel();});
document.addEventListener('keydown',e=>{
 if(e.key!=='Escape'||e.defaultPrevented)return;
 if($('editor').open){e.preventDefault();closeEditor();}
 else if($('panel').open){e.preventDefault();closePanel();}
});
$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
$('search').addEventListener('input',render);
$('collection-table').addEventListener('click',e=>{const th=e.target.closest('[data-sort]');if(!th||Date.now()<ignoreSortUntil||['image','actions'].includes(th.dataset.sort))return;sort={key:th.dataset.sort,dir:sort.key===th.dataset.sort?-sort.dir:1};render();});
$('collection-table').addEventListener('dragstart',e=>{const th=e.target.closest('[data-column-key]');if(!th||th.dataset.columnKey==='image')return;dragColumn=th.dataset.columnKey;e.dataTransfer.setData('text/plain',dragColumn);e.dataTransfer.effectAllowed='move';th.classList.add('dragging');});
$('collection-table').addEventListener('dragover',e=>{const th=e.target.closest('[data-column-key]');if(th&&dragColumn){e.preventDefault();e.dataTransfer.dropEffect='move';}});
$('collection-table').addEventListener('drop',async e=>{const th=e.target.closest('[data-column-key]');if(!th||!dragColumn||th.dataset.columnKey==='image')return;e.preventDefault();const keys=[...$('collection-table').querySelectorAll('[data-column-key]')].map(t=>t.dataset.columnKey);const from=dragColumn,to=th.dataset.columnKey;dragColumn=null;ignoreSortUntil=Date.now()+400;if(from===to)return;keys.splice(keys.indexOf(from),1);keys.splice(keys.indexOf(to),0,from);try{await api('/api/settings',{columns:keys});db.settings.columns=keys;render();}catch(error){toast(error.message);}});
$('collection-table').addEventListener('dragend',()=>{dragColumn=null;document.querySelectorAll('.dragging').forEach(e=>e.classList.remove('dragging'));});
window.addEventListener('beforeunload',e=>{if(dirty||phoneDraft||panelDirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('offline',checkConnection);
window.addEventListener('online',checkConnection);
window.addEventListener('focus',checkConnection);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkConnection();});
window.addEventListener('hashchange',()=>{if(!db)return;const params=new URLSearchParams(location.hash.slice(1));const id=params.get('record'),unit=params.get('unit'),r=record(id);if(r)showEditor(id,r.instances.findIndex(u=>u.id===unit));});
document.addEventListener('error',e=>{if(e.target.tagName==='IMG'){e.target.alt='Image unavailable';e.target.style.background='var(--surface2)';}},true);
boot().then(()=>{setTimeout(monitorConnection,10000);if(location.hash&&db)window.dispatchEvent(new Event('hashchange'));});
