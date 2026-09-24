import tempfile,unittest
from server import Store,Conflict
class BatteryCompatibilityTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name)
  self.a=self.s.save_catalog({'category':'battery','name':'Test A'})
  self.b=self.s.save_catalog({'category':'battery','name':'Test B'})
  self.c=self.s.save_catalog({'category':'battery','name':'Test C'})
 def tearDown(self):self.tmp.cleanup()
 def item(self,id):return next(e for e in self.s.all_data()['catalog'] if e['id']==id)
 def test_bidirectional_multiple_links_without_transitive_inference(self):
  a=self.s.save_catalog({**self.a,'compatible_batteries':[self.b['id'],self.c['id']]})
  self.assertEqual(set(a['compatible_batteries']),{self.b['id'],self.c['id']})
  self.assertEqual(self.item(self.b['id'])['compatible_batteries'],[self.a['id']])
  self.assertNotIn(self.c['id'],self.item(self.b['id'])['compatible_batteries'])
  with self.assertRaises(Conflict):self.s.save_catalog(self.b)
  self.s.save_catalog({**a,'compatible_batteries':[]})
  self.assertEqual(self.item(self.b['id'])['compatible_batteries'],[])
 def test_delete_and_rename_keep_relationships_consistent(self):
  a=self.s.save_catalog({**self.a,'compatible_batteries':[self.b['id']]})
  self.s.save_catalog({**a,'name':'Renamed A'})
  self.assertEqual(self.item(self.b['id'])['compatible_batteries'],[a['id']])
  self.s.delete_catalog(self.item(a['id']))
  self.assertEqual(self.item(self.b['id'])['compatible_batteries'],[])
 def test_invalid_links_rejected(self):
  charger=self.s.save_catalog({'category':'charger','name':'Test charger'})
  for links in [[self.a['id']],[charger['id']],['missing'],'bad']:
   with self.assertRaises(ValueError):self.s.save_catalog({**self.a,'compatible_batteries':links})
 def test_backup_preserves_links(self):
  self.s.save_catalog({**self.a,'compatible_batteries':[self.b['id']]})
  backup=self.s.backup();self.s.restore((self.s.backups/backup['name']).read_bytes())
  self.assertEqual(self.item(self.b['id'])['compatible_batteries'],[self.a['id']])
