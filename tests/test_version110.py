import copy,tempfile,unittest
from server import Store

class PhoneFormTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def phone(self,model,units):return self.s.save_record({'kind':'phone','brand':'Nokia','model':model,'instances':units},strict_catalog=True)
 def test_next_number_and_gaps(self):
  a=self.phone('6500',[{'inv':'1'},{'inv':'2'},{'inv':'3'}]);b=self.phone('6600',[{}]);self.assertEqual(b['instances'][0]['inv'],'4')
  a['instances'][1]['inv']='6';self.s.save_record(a,a['rev']);c=self.phone('N73',[{},{}]);self.assertEqual([u['inv'] for u in c['instances']],['2','5'])
 def test_blank_before_existing_number_never_steals_it(self):
  a=self.phone('N73',[{}, {'inv':'1'}]);self.assertEqual([u['inv'] for u in a['instances']],['2','1'])
 def test_strict_catalog_rejects_new_typing_and_accepts_catalog_item(self):
  with self.assertRaises(ValueError):self.phone('N73',[{'os':'Symbian OS 9.1'}])
  self.s.save_catalog({'category':'os','name':'Symbian OS 9.2'})
  a=self.phone('N73',[{'os':'Symbian OS 9.2'}]);self.assertEqual(a['instances'][0]['os'],'Symbian OS 9.2')
  original=copy.deepcopy(a);a['instances'][0]['os']='Symbian OS 9.1'
  with self.assertRaises(ValueError):self.s.save_record(a,a['rev'],strict_catalog=True)
  self.assertEqual(self.s.records()[0]['instances'][0]['os'],original['instances'][0]['os'])
 def test_bulk_cannot_create_catalog_values(self):
  a=self.phone('N73',[{}]);target={'record_id':a['id'],'unit_id':a['instances'][0]['id'],'rev':a['rev']}
  with self.assertRaises(ValueError):self.s.bulk_units({'targets':[target],'changes':{'location':'Invented shelf'}},strict_catalog=True)
  self.assertFalse(any(i['name']=='Invented shelf' for i in self.s.all_data()['catalog']))
 def test_overrides_and_old_photos_retained(self):
  a=self.phone('N73',[{'type':'RM-133'},{'type':'RM-other'}]);a['photos']=['https://example.com/old.jpg'];a['note']='Legacy model note';a=self.s.save_record(a,a['rev'],strict_catalog=True)
  a['instances'][1]['type']='RM-new';b=self.s.save_record(a,a['rev'],strict_catalog=True)
  self.assertEqual(b['instances'][0]['type'],'RM-133');self.assertEqual(b['photos'],['https://example.com/old.jpg']);self.assertEqual(b['note'],'Legacy model note')
