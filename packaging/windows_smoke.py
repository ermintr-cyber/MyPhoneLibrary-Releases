"""Exercise the shipped GUI runtime on a Windows build runner, with isolated data."""
import http.cookiejar,json,os,subprocess,tempfile,time,urllib.request,hashlib,io,zipfile
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
command="$r=Get-NetFirewallRule -DisplayName 'MyPhoneLibrary - TCP 9000' -ErrorAction Stop; if(@($r).Count -ne 1) { exit 1 }; $p=$r|Get-NetFirewallPortFilter; if($p.LocalPort -ne '9000') { exit 2 }"
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
        original=status['version']
        code=(installed/'server.py').read_text(encoding='utf-8').replace("VERSION = '"+original+"'","VERSION = '9.9.9'").encode()
        manifest={'product':'MyPhoneLibrary','version':'9.9.9','files':{'server.py':hashlib.sha256(code).hexdigest(),'web/app.js':hashlib.sha256(b'// restart test').hexdigest()}}
        archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w') as z:z.writestr('server.py',code);z.writestr('web/app.js',b'// restart test');z.writestr('app-manifest.json',json.dumps(manifest))
        req=urllib.request.Request(base+'/api/update',data=archive.getvalue(),headers={'X-MPL-Client':'1','X-MPL-CSRF':csrf})
        with opener.open(req,timeout=10) as response:assert json.load(response)['version']=='9.9.9'
        request('/api/server-control',{'action':'restart'});proc.wait(timeout=15)
        for attempt in range(100):
            try:
                if request('/api/status')['version']=='9.9.9':break
            except OSError:pass
            time.sleep(.2)
        else:raise RuntimeError('Installed pythonw server did not apply the staged update on restart')
        csrf=request('/api/login',{'password':'temporary-build-test-password'})['csrf']
        assert request('/api/update-state')['pending'] is None
        child_pid=json.loads((Path(folder)/'server-running.json').read_text())['pid']
        request('/api/server-control',{'action':'stop'})
        subprocess.run(['powershell.exe','-NoProfile','-Command',f'Wait-Process -Id {child_pid} -Timeout 15 -ErrorAction SilentlyContinue'],timeout=20)
        for attempt in range(100):
            if not (Path(folder)/'server-running.json').exists():break
            time.sleep(.1)
        print('Installed pythonw HTTP update + restart reached version 9.9.9 using a custom data folder.')
        assert proc.returncode==0
        assert not (Path(folder)/'server-running.json').exists()
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=5)
print('Windows GUI runtime started, authenticated, loaded data and stopped cleanly without a console.')

# Exercise actual migration from the old launch argument, plus busy-port fallback.
import socket
for busy in (False,True):
    blocker=None
    if busy:
        blocker=socket.socket();blocker.bind(('0.0.0.0',9000));blocker.listen()
    with tempfile.TemporaryDirectory(prefix='mpl-port-') as folder:
        expected=8091 if busy else 9000;base=f'http://127.0.0.1:{expected}'
        proc=subprocess.Popen([str(installed/'runtime/pythonw.exe'),str(installed/'server.py'),'--port','8091','--host','127.0.0.1','--data',folder,'--no-browser'])
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));csrf=''
        try:
            for attempt in range(100):
                try:
                    if request('/api/status')['product']=='MyPhoneLibrary':break
                except OSError:pass
                time.sleep(.2)
            else:raise RuntimeError('Port selection failed')
            csrf=request('/api/setup',{'password':'port-migration-test-password'})['csrf']
            assert request('/api/network')['port']==expected
            folders=request('/api/folders',{'path':folder});assert Path(folders['path'])==Path(folder).resolve()
            if not busy:
                with urllib.request.urlopen('http://127.0.0.1:8091/api/status') as response:assert json.load(response)['port']==9000
            request('/api/server-control',{'action':'stop'});proc.wait(timeout=15)
            print('Windows port selection passed:',expected,'9000 occupied:',busy)
        finally:
            if proc.poll() is None:proc.terminate();proc.wait(timeout=5)
            if blocker:blocker.close()
