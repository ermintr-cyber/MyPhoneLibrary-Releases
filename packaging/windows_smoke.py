"""Exercise the shipped GUI runtime on a Windows build runner, with isolated data."""
import http.cookiejar,json,os,subprocess,tempfile,time,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1]
if os.name!='nt':raise SystemExit('This verification runs on Windows.')
installer=next((root/'dist').glob('MyPhoneLibrary_Setup_*.exe'))
data=Path(os.environ['LOCALAPPDATA'])/'MyPhoneLibrary';data.mkdir(exist_ok=True)
marker=data/'installer-preservation-test.txt';marker.write_text('preserve this collection marker',encoding='utf-8')
for attempt in range(2):
    subprocess.run([str(installer),'/S'],check=True,timeout=90)
    assert marker.read_text(encoding='utf-8')=='preserve this collection marker'
installed=Path(os.environ['LOCALAPPDATA'])/'Programs/MyPhoneLibrary'
assert (installed/'MyPhoneLibrary.exe').is_file()
command="$r=Get-NetFirewallRule -DisplayName 'MyPhoneLibrary - TCP 8091' -ErrorAction Stop; if(@($r).Count -ne 1) { exit 1 }; $p=$r|Get-NetFirewallPortFilter; if($p.LocalPort -ne '8091') { exit 2 }"
subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],check=True,timeout=15)
print('Installer ran twice; collection marker preserved; exactly one firewall rule remains.')
with tempfile.TemporaryDirectory(prefix='mpl-smoke-') as folder:
    port=18097;base=f'http://127.0.0.1:{port}'
    proc=subprocess.Popen([str(installed/'runtime/pythonw.exe'),str(installed/'server.py'),'--host','127.0.0.1','--port',str(port),'--data',folder,'--no-browser'])
    opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    csrf=''
    def request(path,data=None):
        raw=None if data is None else json.dumps(data).encode()
        req=urllib.request.Request(base+path,data=raw,headers={'X-MPL-Client':'1','X-MPL-CSRF':csrf,'Content-Type':'application/json'})
        with opener.open(req,timeout=3) as response:return json.load(response)
    try:
        for attempt in range(40):
            try:status=request('/api/status');break
            except OSError:time.sleep(.25)
        else:raise RuntimeError('Background server did not start')
        assert status['version']==json.loads((installed/'app-manifest.json').read_text(encoding='utf-8'))['version']
        login=request('/api/setup',{'password':'temporary-build-test-password'});csrf=login['csrf']
        assert request('/api/data')['settings']['update_repo']=='ermintr-cyber/MyPhoneLibrary-Releases'
        assert (Path(folder)/'server.log').exists()
        request('/api/server-control',{'action':'stop'});proc.wait(timeout=10)
        assert proc.returncode==0
        assert not (Path(folder)/'server-running.json').exists()
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=5)
print('Windows GUI runtime started, authenticated, loaded data and stopped cleanly without a console.')
