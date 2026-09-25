import copy
import tempfile
import unittest
from server import Store, Conflict

class UnitTrashTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name)
        self.r=self.s.save_record({'kind':'phone','brand':'Nokia','model':'6500 Slide','instances':[{'inv':str(i),'imei2':'legacy','serial':'serial','note':'note '+str(i),'photos':['/media/'+'a'*32+'.jpg'],'to_check':['os']} for i in range(1,4)]})
        self.r=self.s.records()[0]
    def tearDown(self):self.tmp.cleanup()
    def test_one_phone_removed_and_restored_with_data(self):
        original=copy.deepcopy(self.r['instances'][1]);tid=self.s.trash_unit(self.r['id'],original['id'],self.r['rev'])
        active=self.s.records()[0]
        self.assertEqual(active['instances'],[self.r['instances'][0],self.r['instances'][2]])
        with self.assertRaises(Conflict):self.s.save_record(self.r,self.r['rev'])
        self.s=Store(self.tmp.name);trash=self.s.records(trash=True)[0]
        self.assertEqual(trash['instances'][0]['previous_inv'],'2')
        self.s.trash(tid,trash['rev'],True)
        restored=self.s.records()[0]['instances'][-1]
        for key,value in original.items():self.assertEqual(restored[key],value)
        self.assertEqual(self.s.records(trash=True),[])
    def test_last_phone_keeps_model_and_inventory_collision_assigns_new_number(self):
        for unit in self.r['instances']:
            r=self.s.records()[0];self.s.trash_unit(r['id'],unit['id'],r['rev'])
        self.assertEqual(self.s.records()[0]['instances'],[])
        self.s.save_record({'kind':'phone','brand':'Nokia','model':'N95','instances':[{'inv':'1'}]})
        t=self.s.records(trash=True)[0];self.s.trash(t['id'],t['rev'],True)
        self.assertNotEqual(self.s.records()[0]['instances'][0]['inv'],'1')
    def test_parent_trash_restore_and_purge_guard(self):
        tid=self.s.trash_unit(self.r['id'],self.r['instances'][0]['id'],self.r['rev'])
        r=self.s.records()[0];self.s.trash(r['id'],r['rev'])
        t=next(x for x in self.s.records(trash=True) if x['id']==tid)
        with self.assertRaises(Conflict):self.s.trash(tid,t['rev'],True)
        parent=next(x for x in self.s.records(trash=True) if x['id']==r['id'])
        with self.assertRaises(ValueError):self.s.purge(parent['id'],parent['rev'])
        self.s.trash(parent['id'],parent['rev'],True);self.s.trash(tid,t['rev'],True)
        self.assertEqual(len(self.s.records()[0]['instances']),3)
    def test_invalid_or_stale_target_changes_nothing(self):
        with self.assertRaises(ValueError):self.s.trash_unit(self.r['id'],'missing',self.r['rev'])
        with self.assertRaises(Conflict):self.s.trash_unit(self.r['id'],self.r['instances'][0]['id'],0)
        self.assertEqual(self.s.records()[0],self.r)
        self.assertEqual(self.s.records(trash=True),[])
