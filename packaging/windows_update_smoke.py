"""Real independent updater -> silent EXE install -> restart on Windows."""
import http.cookiejar,json,os,shutil,subprocess,time,urllib.request,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
installed=Path(os.environ['LOCALAPPDATA'])/'Programs/MyPhoneLibrary'
installer=next((root/'dist').glob('MyPhoneLibrary_Setup_*.exe'))
version=json.loads((root/'app-manifest.json').read_text(encoding='utf-8'))['version']
with tempfile.TemporaryDirectory(prefix='mpl-independent-') as tmp:
    folder=Path(tmp);data=folder/'data';data.mkdir();worker=folder/'worker';worker.mkdir()
    shutil.copytree(installed/'runtime',worker/'runtime');shutil.copy2(installed/'updater.py',worker/'updater.py')
    port=18098;base=f'http://127.0.0.1:{port}';csrf=''
    cookies=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    def request(path,payload=None):
        req=urllib.request.Request(base+path,data=None if payload is None else json.dumps(payload).encode(),headers={'X-MPL-Client':'1','X-MPL-CSRF':csrf,'Content-Type':'application/json'})
        with opener.open(req,timeout=10) as response:return json.load(response)
    def ready():
        for _ in range(100):
            try:return request('/api/status')
            except OSError:time.sleep(.1)
        raise RuntimeError('Server did not start')
    proc=subprocess.Popen([str(installed/'runtime/pythonw.exe'),str(installed/'server.py'),'--no-browser','--port',str(port),'--host','127.0.0.1','--data',str(data)])
    child_pid=None
    try:
        initial=ready();csrf=request('/api/setup',{'password':'independent-update-test'})['csrf']
        request('/api/record',{'record':{'brand':'Nokia','model':'Preserve me','instances':[{'inv':'1'}]}})
        photo=data/'media/preserve.jpg';photo.write_bytes(b'preserve photo')
        job={'root':str(installed),'data':str(data),'version':version,'artifact':{},'pid':proc.pid,'port':port,'host':'127.0.0.1','instance':initial['instance'],'session':next(c.value for c in cookies if c.name=='mpl_session'),'csrf':csrf,'status_path':str(data/'updates/status.json')}
        path=worker/'job.json';path.write_text(json.dumps(job),encoding='utf-8')
        # Feed the EXE built in this very workflow into the normal worker. The
        # verified HTTPS downloader is covered separately; everything after
        # download (backup, stop, installer, new runtime, verification) is real.
        test_script=worker/'test_worker.py'
        test_script.write_text('import sys\nfrom pathlib import Path\nsys.path.insert(0,str(Path(__file__).resolve().parent))\nimport updater,shutil\nfrom pathlib import Path\ndef download(info,destination,progress):\n shutil.copy2('+repr(str(installer))+',destination);progress(100)\nupdater.download_installer=download\nupdater.run_job('+repr(str(path))+')\n',encoding='utf-8')
        started=time.monotonic()
        update=subprocess.Popen([str(worker/'runtime/pythonw.exe'),str(test_script)],cwd=worker)
        update.wait(timeout=240)
        state=json.loads(Path(job['status_path']).read_text(encoding='utf-8'))
        assert state['status']=='completed',state
        proc.wait(timeout=10)
        current=ready();assert current['version']==version and current['instance']!=initial['instance']
        child_pid=json.loads((data/'server-running.json').read_text())['pid']
        csrf=request('/api/login',{'password':'independent-update-test'})['csrf']
        assert request('/api/data')['records'][0]['model']=='Preserve me'
        assert photo.read_bytes()==b'preserve photo'
        assert list((data/'backups').glob('*.zip'))
        request('/api/server-control',{'action':'stop'})
        subprocess.run(['powershell.exe','-NoProfile','-Command',f'Wait-Process -Id {child_pid} -Timeout 15 -ErrorAction SilentlyContinue'],timeout=20)
        print('Independent worker -> actual silent EXE install -> verified new server passed in',round(time.monotonic()-started,1),'seconds; collection and photos preserved.')
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=5)
