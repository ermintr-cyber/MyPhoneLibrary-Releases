import tempfile,unittest
from server import Store,Conflict,dump

class CollectionChanges(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def phone(self,name='N73',inv='2'):
  return self.s.save_record({'brand':'Nokia','model':name,'os':'Symbian','instances':[{'inv':inv,'product_code':'0590123','imei':'123456789012345'}]})
 def test_trash_releases_number_and_restore_avoids_collision(self):
  a=self.phone();self.s.trash(a['id'],a['rev']);t=self.s.records(trash=True)[0]
  self.assertEqual(t['instances'][0]['inv'],'')
  b=self.phone('N97');self.assertEqual(b['instances'][0]['inv'],'2')
  self.s.trash(t['id'],t['rev'],True)
  a=next(r for r in self.s.records() if r['id']==a['id'])
  self.assertNotEqual(a['instances'][0]['inv'],'2');self.assertEqual(a['instances'][0]['product_code'],'0590123')
  self.assertEqual(a['instances'][0]['imei'],'123456789012345')
 def test_restore_reuses_available_number(self):
  a=self.phone();self.s.trash(a['id'],a['rev']);t=self.s.records(trash=True)[0]
  self.s.trash(t['id'],t['rev'],True);self.assertEqual(self.s.records()[0]['instances'][0]['inv'],'2')
 def test_legacy_trash_numbers_migrate_once(self):
  a=self.phone()
  with self.s.connect() as c:c.execute('UPDATE records SET deleted=1 WHERE id=?',(a['id'],))
  t=Store(self.tmp.name).records(trash=True)[0];self.assertEqual(t['instances'][0]['inv'],'')
  self.assertEqual(Store(self.tmp.name).records(trash=True)[0]['rev'],t['rev'])
  self.phone('6600')
 def test_permanent_delete_requires_trash_and_revision(self):
  a=self.phone()
  with self.assertRaises(ValueError):self.s.purge(a['id'],a['rev'])
  p=self.s.save_record({'kind':'part','model':'Battery','quantity':2,'compatible':[a['id']]})
  self.s.trash(a['id'],a['rev']);t=self.s.records(trash=True)[0]
  with self.assertRaises(Conflict):self.s.purge(t['id'],t['rev']-1)
  self.s.purge(t['id'],t['rev']);self.assertEqual(self.s.records(trash=True),[])
  self.assertEqual(self.s.records()[0]['compatible'],[]);self.assertEqual(self.s.records()[0]['quantity'],2)
 def test_catalog_deletion_keeps_text_and_does_not_reappear(self):
  a=self.phone();d=self.s.all_data();e=next(x for x in d['catalog'] if x['category']=='os' and x['name']=='Symbian')
  with self.assertRaises(Conflict):self.s.delete_catalog(e)
  self.s.delete_catalog({**e,'confirm_linked':True})
  for store in [self.s,Store(self.tmp.name)]:
   d=store.all_data();self.assertFalse(any(x['id']==e['id'] for x in d['catalog']))
   self.assertNotIn('Symbian',d['settings']['options']['os']);self.assertEqual(d['records'][0]['os'],'Symbian')
   self.assertNotIn('os',d['records'][0]['catalog_refs'])
  new=self.s.save_catalog({'category':'os','name':'Symbian','specs':{'Version':'9.4'}})
  self.assertEqual(self.s.all_data()['records'][0]['catalog_refs']['os'],new['id'])
 def test_delete_supported_in_every_catalog(self):
  for category in ['brand','battery','charger','color','location','os','part_category']:
   e=self.s.save_catalog({'category':category,'name':'Test removable'})
   self.s.delete_catalog(e)
   self.assertFalse(any(x['id']==e['id'] for x in Store(self.tmp.name).all_data()['catalog']))
 def test_product_code_string_survives_save_and_backup(self):
  a=self.phone();a['instances'][0]['color']='Black';a=self.s.save_record(a,a['rev'])
  b=self.s.backup();self.s.restore((self.s.backups/b['name']).read_bytes())
  self.assertEqual(self.s.records()[0]['instances'][0]['product_code'],'0590123')
