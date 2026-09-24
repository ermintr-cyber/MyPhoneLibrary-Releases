import json,tempfile,unittest,urllib.request,urllib.error
from pathlib import Path
from unittest.mock import patch,Mock
from http.server import ThreadingHTTPServer
from server import gsm_address,gsm_preview,folder_listing,bind_server,start_legacy_redirect,Store
class Version15Tests(unittest.TestCase):
 def test_user_gsm_link_and_known_variants(self):
  link='https://www.gsmarena.com/nokia_6500_slide-1996.php'
  self.assertEqual(gsm_address(' '+link+'\n'),link)
  self.assertEqual(gsm_address(link.replace('www.','m.')),link)
  self.assertEqual(gsm_address(link.replace('https:','http:'),redirect=True),link)
  self.assertEqual(gsm_address('https://m.gsmarena.com/nokia_6500_slide-1996.php',redirect=True),'https://m.gsmarena.com/nokia_6500_slide-1996.php')
  with patch('server.remote_get',return_value=b'<h1 data-spec="modelname">Nokia 6500 slide</h1><td data-spec="os">Test OS</td>') as remote:
   result=gsm_preview(' '+link+' ')
  self.assertEqual(result['name'],'Nokia 6500 slide');self.assertEqual(result['fields']['os'],'Test OS');remote.assert_called_once_with(link)
 def test_external_redirects_and_insecure_input_still_rejected(self):
  for link in ['http://www.gsmarena.com/nokia-1.php','https://www.gsmarena.com.evil.test/nokia-1.php','https://127.0.0.1/nokia-1.php','https://user:password@www.gsmarena.com/nokia-1.php','https://www.gsmarena.com:8080/nokia-1.php']:
   with self.assertRaises(ValueError):gsm_address(link)
  with self.assertRaises(ValueError):gsm_address('https://outside.test/path',redirect=True)
 def test_folder_picker_lists_only_directories_and_preserves_unicode(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve();(root/'Čuvanje slika').mkdir();(root/'file.txt').write_text('private')
   result=folder_listing(tmp)
   self.assertEqual(result['folders'],[{'name':'Čuvanje slika','path':str(root/'Čuvanje slika')}]);self.assertEqual(result['parent'],str(root.parent))
   with self.assertRaises(ValueError):folder_listing(str(root/'missing'))
 def test_port_prefers_9000_and_falls_back_if_busy(self):
  sentinel=Mock()
  with patch('server.port_in_use',return_value=False),patch('server.AppServer',return_value=sentinel) as create:
   self.assertIs(bind_server('0.0.0.0',8091,None),sentinel);create.assert_called_once_with(('0.0.0.0',9000),None)
  with patch('server.port_in_use',return_value=False),patch('server.AppServer',side_effect=[OSError('busy'),sentinel]) as create:
   self.assertIs(bind_server('0.0.0.0',None,None),sentinel);self.assertEqual(create.call_args.args[0],('0.0.0.0',8091))
  with patch('server.port_in_use',return_value=False),patch('server.AppServer',return_value=sentinel) as create:
   bind_server('127.0.0.1',18097,None);create.assert_called_once_with(('127.0.0.1',18097),None)
 def test_active_listener_is_skipped_before_windows_binding(self):
  with patch('server.port_in_use',side_effect=[True,False]),patch('server.AppServer') as create:
   bind_server('0.0.0.0',9000,None);create.assert_called_once_with(('0.0.0.0',8091),None)
 def test_legacy_status_allows_old_updater_to_finish_and_root_redirects(self):
  with patch('server.port_in_use',return_value=False),patch('server.HostHTTPServer',side_effect=lambda addr,handler:ThreadingHTTPServer(('127.0.0.1',0),handler)):
   legacy=start_legacy_redirect('127.0.0.1',9000)
  class NoRedirect(urllib.request.HTTPRedirectHandler):
   def redirect_request(self,*args):return None
  try:
   base='http://127.0.0.1:'+str(legacy.server_port)
   with urllib.request.urlopen(base+'/api/status') as r:info=json.load(r)
   self.assertEqual(info['port'],9000);self.assertEqual(info['product'],'MyPhoneLibrary')
   with self.assertRaises(urllib.error.HTTPError) as caught:urllib.request.build_opener(NoRedirect()).open(base)
   self.assertEqual(caught.exception.code,302);self.assertEqual(caught.exception.headers['Location'],'http://127.0.0.1:9000/')
  finally:legacy.shutdown();legacy.server_close()
 def test_wanted_status_and_km_default_survive_restart(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=Store(tmp);r=s.save_record({'brand':'Nokia','model':'Test','instances':[{'condition':'Wanted'}]})
   u=Store(tmp).records()[0]['instances'][0];self.assertEqual(u['condition'],'Wanted');self.assertEqual(u['currency'],'KM')
   check=s.inventory({});self.assertEqual(check['expected'],{})
