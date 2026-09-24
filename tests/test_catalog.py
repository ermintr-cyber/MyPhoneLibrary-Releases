import tempfile,unittest,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Store,Conflict,network_info
class CatalogTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def test_migration_rename_and_restore(self):
  r=self.s.save_record({'brand':'Nokia','model':'N97','battery':'BL-4D','instances':[{'color':'Silver'}]})
  d=self.s.all_data();e=next(e for e in d['catalog'] if e['category']=='battery' and e['name']=='BL-4D')
  self.assertEqual(d['records'][0]['catalog_refs']['battery'],e['id'])
  saved=self.s.save_catalog({**e,'name':'BL-4D revised','specs':{'Test property':'test value'},'description':'Test description'})
  self.assertEqual(saved['id'],e['id']);self.assertEqual(self.s.records()[0]['battery'],'BL-4D revised')
  with self.assertRaises(Conflict):self.s.save_record(r,r['rev'])
  with self.assertRaises(Conflict):self.s.save_catalog(e)
  b=self.s.backup();self.s.save_catalog({**saved,'description':'changed'})
  self.s.restore((self.s.backups/b['name']).read_bytes())
  d=self.s.all_data();self.assertEqual(next(x for x in d['catalog'] if x['id']==e['id'])['description'],'Test description')
  self.assertNotIn('BL-4D',d['settings']['options']['battery'])
 def test_same_name_in_separate_catalogs(self):
  e=self.s.save_catalog({'category':'charger','name':'Example','specs':{}})
  self.s.save_catalog({'category':'battery','name':'Example','specs':{}})
  with self.assertRaises(Conflict):self.s.save_catalog({'category':'charger','name':'example'})
 def test_two_backups_independent_failure(self):
  root=Path(self.tmp.name);a=root/'first';b=root/'second'
  self.s.settings({'backup_primary':str(a),'backup_directory':str(b)})
  result=self.s.backup();self.assertEqual((a/result['name']).read_bytes(),(b/result['name']).read_bytes())
  invalid=root/'file';invalid.write_text('not a directory');self.s.settings({'backup_primary':str(invalid)})
  result=self.s.backup();self.assertIn('First backup location failed',result['warning']);self.assertTrue((b/result['name']).exists())
 def test_network_uses_actual_port(self):
  with patch('server.socket.getaddrinfo',return_value=[(None,None,None,None,('192.168.1.7',0))]),patch('server.shutil.which',return_value=None):
   info=network_info(8091)
  self.assertTrue(any(x['url']=='http://192.168.1.7:8091' for x in info['endpoints']))
if __name__=='__main__':unittest.main()
