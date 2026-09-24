"""Exercise HTTP staging and real process restart with a non-default data folder."""
import hashlib,io,json,os,shutil,socket,subprocess,sys,tempfile,time,unittest,urllib.request,http.cookiejar,http.client,zipfile
from pathlib import Path
from unittest.mock import patch
from updater import apply,stage
from server import restart_server
ROOT=Path(__file__).resolve().parents[1]
class RestartTests(unittest.TestCase):
 def test_http_stage_restart_reports_new_version_and_keeps_data(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'program';root.mkdir();data=Path(tmp)/'custom collection';data.mkdir()
   for name in ['server.py','updater.py','battery_catalog.py']:shutil.copy2(ROOT/name,root/name)
   shutil.copytree(ROOT/'data',root/'data')
   with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
   proc=subprocess.Popen([sys.executable,str(root/'server.py'),'--port',str(port),'--host','127.0.0.1','--data',str(data),'--no-browser'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));csrf=''
   def request(path,value=None):
    raw=None if value is None else value if isinstance(value,bytes) else json.dumps(value).encode()
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=raw,headers={'X-MPL-Client':'1','X-MPL-CSRF':csrf,'Content-Type':'application/json'})
    with opener.open(req,timeout=1) as response:return json.load(response)
   def wait_version(expected=None):
    for _ in range(100):
     try:
      status=request('/api/status')
      if expected is None or status['version']==expected:return status
     except OSError:pass
     time.sleep(.1)
    self.fail('Server did not return the expected version after restart')
   try:
    status=wait_version();csrf=request('/api/setup',{'password':'restart-test-password'})['csrf']
    request('/api/record',{'record':{'brand':'Nokia','model':'N73','instances':[{'inv':'2','imei':'123456789012345'}]}})
    code=(root/'server.py').read_text(encoding='utf-8').replace("VERSION = '"+status['version']+"'","VERSION = '9.9.9'").encode()
    manifest={'product':'MyPhoneLibrary','version':'9.9.9','files':{'server.py':hashlib.sha256(code).hexdigest(),'web/app.js':hashlib.sha256(b'// restart test').hexdigest()}}
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z:z.writestr('server.py',code);z.writestr('web/app.js',b'// restart test');z.writestr('app-manifest.json',json.dumps(manifest))
    self.assertEqual(request('/api/update',stream.getvalue())['version'],'9.9.9')
    self.assertEqual(request('/api/update-state')['pending'],'9.9.9')
    # A browser can leave an HTTP/1.1 keep-alive socket open. It must not
    # keep the old server alive while applying an update.
    idle=http.client.HTTPConnection('127.0.0.1',port,timeout=2)
    idle.request('GET','/api/status',headers={'Connection':'keep-alive'})
    response=idle.getresponse();response.read()
    self.assertEqual(response.getheader('Connection'),'close')
    request('/api/server-control',{'action':'restart'});proc.wait(timeout=15)
    idle.close()
    wait_version('9.9.9');csrf=request('/api/login',{'password':'restart-test-password'})['csrf']
    self.assertEqual(request('/api/data')['records'][0]['instances'][0]['imei'],'123456789012345')
    self.assertIsNone(request('/api/update-state')['pending'])
   finally:
    child_pid=None
    try:child_pid=json.loads((data/'server-running.json').read_text())['pid']
    except (OSError,ValueError):pass
    try:
     csrf=request('/api/login',{'password':'restart-test-password'})['csrf'];request('/api/server-control',{'action':'stop'})
    except OSError:pass
    if proc.poll() is None:proc.terminate()
    proc.wait(timeout=10)
    if os.name=='nt' and child_pid and child_pid!=proc.pid:
     subprocess.run(['powershell.exe','-NoProfile','-Command',f'Wait-Process -Id {child_pid} -Timeout 15 -ErrorAction SilentlyContinue'],timeout=20,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for _ in range(100):
     if not (data/'server-running.json').exists():break
     time.sleep(.1)
 def test_new_installer_does_not_apply_older_pending_package(self):
  from test_updates import archive
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'app';data=Path(tmp)/'data';root.mkdir();data.mkdir()
   (root/'app-manifest.json').write_text(json.dumps({'version':'1.4.1'}))
   (root/'server.py').write_text('new installed server')
   stage(archive(),data,'1.0.0');self.assertFalse(apply(root,data))
   self.assertEqual((root/'server.py').read_text(),'new installed server');self.assertFalse((data/'pending-update').exists())
 def test_apply_failure_keeps_error_and_restarts_same_directory(self):
  with tempfile.TemporaryDirectory() as tmp,patch('updater.apply',side_effect=ValueError('Checksum failed')),patch('server.subprocess.Popen') as popen:
   restart_server(ROOT,tmp,8091,'127.0.0.1')
   self.assertEqual((Path(tmp)/'update-error.txt').read_text(),'Checksum failed')
   args=popen.call_args.args[0];self.assertEqual(args[args.index('--data')+1],tmp)
