const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const elements=new Map();let reloads=0,requests=0;
function node(id){if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',dataset:{},classList:{toggle(){},remove(){},add(){}},setAttribute(){},addEventListener(){},querySelector(){return null}});return elements.get(id);}
const bridge={hasBundledUi:()=>true,getAppVersion:()=> '1.16.0'};
const context=vm.createContext({navigator:{userAgent:'Android MyPhoneLibraryAndroid/1.16.0'},document:{getElementById:node,querySelectorAll:()=>[],addEventListener(){},documentElement:{dataset:{}}},window:{MyPhoneLibraryAndroid:bridge,addEventListener(){}},location:{hash:'',reload(){reloads++;}},fetch:async()=>{requests++;return {ok:true,json:async()=>({version:'9.9.9',authenticated:true})}},console,setTimeout,clearTimeout,URLSearchParams});
let source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
source=source.slice(0,source.lastIndexOf('boot().then('));vm.runInContext(source,context);
vm.runInContext("db={version:'9.9.9',settings:{}}",context);
(async()=>{
 await vm.runInContext('checkConnection()',context);
 assert.equal(vm.runInContext('BUNDLED_ANDROID_UI',context),true);
 assert.equal(vm.runInContext('versionMismatch',context),false);
 assert.equal(reloads,0,'A Windows update must not reload the APK frontend');
 const html=vm.runInContext('updateContents()',context);
 assert.match(html,/Android app/);assert.match(html,/1.16.0/);assert.match(html,/Windows server/);assert.match(html,/9.9.9/);
 assert.doesNotMatch(html,/data-action="install-update"|id="update-file"|data-action="save-update-repo"/);
 const before=requests;await vm.runInContext('loadUpdateState()',context);
 assert.equal(requests,before,'Android must not start polling the Windows installation job');
 console.log('Android: immutable UI across server upgrades, separate versions, APK-only updates and no Windows job polling passed.');
})().catch(e=>{console.error(e);process.exit(1)});
