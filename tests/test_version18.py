import hashlib,json,sqlite3,tempfile,threading,time,unittest,urllib.request,http.cookiejar
from pathlib import Path
from unittest.mock import patch
from server import Store,AppServer
from updater import migrate_data,resolve_data_directory,read_update_status

class Version18Tests(unittest.TestCase):
 def test_unit_overrides_roundtrip_and_url_validation(self):
  with tempfile.TemporaryDirectory() as tmp:
   store=Store(tmp)
   phone=store.save_record({'kind':'phone','brand':'Nokia','model':'6500 Slide','alias':'6500s-1','type':'RM-240','os':'S40','instances':[{'color':'Silver'},{'color':'Black','alias':'variant 2','type':'RM-241','os':'S40 second','gsm':'https://www.gsmarena.com/test.php','wiki':'https://en.wikipedia.org/wiki/Test'}]})
   reloaded=Store(tmp).records()[0];self.assertEqual(reloaded['instances'][0]['color'],'Silver')
   self.assertEqual(reloaded['instances'][1]['os'],'S40 second');self.assertEqual(reloaded['type'],'RM-240')
   phone['instances'][1]['wiki']='javascript:alert(1)'
   with self.assertRaises(ValueError):store.save_record(phone,phone['rev'])
 def test_migration_preserves_collection_photos_backups_and_sessions(self):
  with tempfile.TemporaryDirectory() as tmp:
   source,target=Path(tmp).resolve()/'legacy',Path(tmp).resolve()/'ProgramData'
   store=Store(source);store.save_record({'kind':'phone','brand':'Nokia','model':'N73','instances':[{'color':'Silver'}]})
   photo=store.media/('a'*32+'.jpg');photo.write_bytes(b'photo contents')
   settings=store.meta('settings');settings['backup_primary']=str(source/'backups');store.settings(settings)
   backup=store.backup();store.remember('private-token',time.time()+100)
   original=hashlib.sha256(store.path.read_bytes()).hexdigest()
   migrate_data(source,target)
   dest=Store(target);self.assertEqual(dest.records(),store.records());self.assertEqual((dest.media/photo.name).read_bytes(),photo.read_bytes())
   self.assertTrue((dest.backups/backup['name']).exists());self.assertTrue(dest.remembered('private-token'))
   self.assertEqual(dest.meta('settings')['backup_primary'],str(target/'backups'))
   self.assertEqual(hashlib.sha256(store.path.read_bytes()).hexdigest(),original)
   dest.save_record({'kind':'phone','brand':'Nokia','model':'N95','instances':[{}]});migrate_data(source,target);self.assertEqual(len(dest.records()),2)
   with patch('updater.data_locations',return_value=(source,target)):
    self.assertEqual(resolve_data_directory(source),target)
    self.assertEqual(resolve_data_directory(Path(tmp).resolve()/'custom'),Path(tmp).resolve()/'custom')
   (source/'updates').mkdir();(source/'updates/status.json').write_text(json.dumps({'status':'completed','version':'1.8.0'}))
   self.assertEqual(read_update_status(target)['status'],'completed')
 def test_migration_refuses_conflicts_and_leaves_source(self):
  with tempfile.TemporaryDirectory() as tmp:
   source,target=Path(tmp).resolve()/'legacy',Path(tmp).resolve()/'new';Store(source);target.mkdir();(target/'existing.txt').write_text('keep')
   with self.assertRaises(ValueError):migrate_data(source,target)
   self.assertEqual((target/'existing.txt').read_text(),'keep');self.assertTrue((source/'library.sqlite3').exists())
 def test_remember_token_excluded_from_backup_and_revoked_on_restore(self):
  with tempfile.TemporaryDirectory() as tmp:
   store=Store(tmp);store.remember('secret',time.time()+100);backup=store.backup()
   store.restore((store.backups/backup['name']).read_bytes());self.assertIsNone(store.remembered('secret'))
   store.remember('expired',time.time()-1);self.assertIsNone(store.remembered('expired'))
 def test_remember_cookie_survives_actual_server_recreation_and_logout_revokes(self):
  with tempfile.TemporaryDirectory() as tmp:
   jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
   server=AppServer(('127.0.0.1',0),Store(tmp));port=server.server_port
   thread=threading.Thread(target=server.serve_forever);thread.start()
   csrf=''
   def request(path,data=None):
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(data).encode() if data is not None else None,headers={'X-MPL-Client':'1','X-MPL-CSRF':csrf,'Content-Type':'application/json'})
    with opener.open(req) as response:return json.load(response)
   try:
    csrf=request('/api/setup',{'password':'test-password','remember':True})['csrf']
    cookie=next(iter(jar));self.assertIsNotNone(cookie.expires)
    token=cookie.value;server.shutdown();server.server_close();thread.join()
    server=AppServer(('127.0.0.1',port),Store(tmp));thread=threading.Thread(target=server.serve_forever);thread.start()
    status=request('/api/status');self.assertTrue(status['authenticated']);csrf=status['csrf']
    self.assertEqual(request('/api/data')['records'],[])
    request('/api/logout',{});self.assertIsNone(server.store.remembered(token))
    csrf=request('/api/login',{'password':'test-password','remember':False})['csrf'];self.assertIsNone(next(iter(jar)).expires)
    server.sessions.clear();self.assertFalse(request('/api/status')['authenticated'])
   finally:server.shutdown();server.server_close();thread.join()

class WindowsMigrationTests(unittest.TestCase):
 @unittest.skipUnless(__import__('os').name=='nt','Windows ProgramData startup')
 def test_old_updater_launches_new_server_into_programdata(self):
  import os,sys,subprocess,socket
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve();legacy=root/'LocalAppData'/'MyPhoneLibrary';target=root/'ProgramData'/'MyPhoneLibrary'
   store=Store(legacy);store.save_record({'kind':'phone','brand':'Nokia','model':'6500 Slide','instances':[{'color':'Silver'}]})
   store.remember('migration-cookie',time.time()+120)
   (legacy/'updates').mkdir();(legacy/'updates/status.json').write_text(json.dumps({'status':'verifying','version':'1.8.0'}))
   with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
   env=dict(os.environ,LOCALAPPDATA=str(legacy.parent),PROGRAMDATA=str(target.parent))
   with (root/'startup.log').open('w') as log:
    proc=subprocess.Popen([sys.executable,str(Path(__file__).resolve().parents[1]/'server.py'),'--no-browser','--host','127.0.0.1','--port',str(port),'--data',str(legacy)],env=env,stdout=log,stderr=log)
    def get(path,data=None,csrf=''):
     request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Cookie':'mpl_session=migration-cookie','X-MPL-Client':'1','X-MPL-CSRF':csrf})
     with urllib.request.urlopen(request,timeout=2) as response:return json.load(response)
    try:
     for _ in range(100):
      try:status=get('/api/status');break
      except OSError:
       if proc.poll() is not None:self.fail('Migrated server exited: '+(root/'startup.log').read_text())
       time.sleep(.1)
     else:self.fail('Migrated server did not start')
     self.assertTrue(status['authenticated']);self.assertEqual(status['update_job']['status'],'verifying')
     data=get('/api/data');self.assertEqual(Path(data['data_directory']),target);self.assertEqual(data['records'][0]['instances'][0]['color'],'Silver')
     (legacy/'updates/status.json').write_text(json.dumps({'status':'completed','version':'1.8.0'}))
     self.assertEqual(get('/api/status')['update_job']['status'],'completed')
     get('/api/server-control',{'action':'stop'},status['csrf']);proc.wait(timeout=15)
    finally:
     if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
