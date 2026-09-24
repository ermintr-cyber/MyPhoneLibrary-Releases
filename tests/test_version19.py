import tempfile,unittest
from server import Store,Conflict
class CollectionWorkflowTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def phone(self,name='N73'):
  return self.s.save_record({'kind':'phone','brand':'Nokia','model':name,'instances':[{'color':'Silver','imei':'12345'},{'color':'Black','imei':'67890'}]})
 def target(self,r,i=0):return {'record_id':r['id'],'unit_id':r['instances'][i]['id'],'rev':r['rev']}
 def test_bulk_changes_only_checked_fields_on_selected_units(self):
  a=self.phone();b=self.phone('6600')
  result=self.s.bulk_units({'targets':[self.target(a),self.target(b,1)],'changes':{'location':'Box 1','box':True}})
  self.assertEqual(result['updated'],2)
  records={r['id']:r for r in self.s.records()};a2=records[a['id']];b2=records[b['id']]
  self.assertEqual(a2['instances'][0]['location'],'Box 1');self.assertEqual(a2['instances'][0]['imei'],'12345');self.assertEqual(a2['instances'][1]['location'],'')
  self.assertEqual(b2['instances'][1]['color'],'Black');self.assertTrue(b2['instances'][1]['box'])
 def test_stale_bulk_rolls_back_every_record(self):
  a=self.phone();b=self.phone('6600');self.s.save_record(b,b['rev'])
  with self.assertRaises(Conflict):self.s.bulk_units({'targets':[self.target(a),self.target(b)],'changes':{'color':'Red'}})
  self.assertEqual(next(r for r in self.s.records() if r['id']==a['id'])['instances'][0]['color'],'Silver')
 def test_bulk_rejects_arbitrary_fields_invalid_status_and_duplicate_targets(self):
  r=self.phone()
  for changes in [{'imei':'999'},{'state':'Invalid'},{'box':'yes'}]:
   with self.assertRaises(ValueError):self.s.bulk_units({'targets':[self.target(r)],'changes':changes})
  with self.assertRaises(ValueError):self.s.bulk_units({'targets':[self.target(r),self.target(r)],'changes':{'box':True}})
 def test_location_hierarchy_cycle_and_parent_delete(self):
  a=self.s.save_catalog({'category':'location','name':'Room'});b=self.s.save_catalog({'category':'location','name':'Shelf','parent_id':a['id']});c=self.s.save_catalog({'category':'location','name':'Box 1','parent_id':b['id']})
  with self.assertRaises(ValueError):self.s.save_catalog({**a,'parent_id':c['id']})
  self.s.delete_catalog({'id':b['id'],'rev':b['rev']})
  item=next(x for x in self.s.all_data()['catalog'] if x['id']==c['id']);self.assertEqual(item['parent_id'],a['id'])
 def test_catalog_stock_and_compatibility_survive_reopen(self):
  phone=self.phone();item=self.s.save_catalog({'category':'battery','name':'Test BL-4D','compatible':[phone['id']]})
  part=self.s.save_record({'kind':'part','model':'Loose battery','quantity':3,'catalog_item':item['id'],'compatible':[phone['id']]})
  data=Store(self.tmp.name).all_data();self.assertEqual(next(r for r in data['records'] if r['id']==part['id'])['catalog_item'],item['id'])
  self.assertEqual(next(x for x in data['catalog'] if x['id']==item['id'])['compatible'],[phone['id']])
  self.s.delete_catalog({'id':item['id'],'rev':item['rev'],'confirm_linked':True})
  self.assertEqual(next(r for r in self.s.records() if r['id']==part['id'])['catalog_item'],'')
