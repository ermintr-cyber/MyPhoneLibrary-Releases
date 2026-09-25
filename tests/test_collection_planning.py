import tempfile
import unittest
from server import Store

class CollectionPlanningTests(unittest.TestCase):
    def test_wishlist_fields_survive_reopen_and_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(directory)
            r=store.save_record(dict(kind='phone',brand='Nokia',model='8800',wishlist=True,instances=[],wish_priority='High',wish_price='125.50',wish_note='Gold, original box'))
            r=Store(directory).records()[0]
            self.assertEqual(r['wish_price'],125.5)
            self.assertEqual(r['wish_priority'],'High')
            r['wishlist']=False
            r['instances']=[{'condition':'U kolekciji'}]
            r=store.save_record(r,r['rev'])
            self.assertEqual(r['wish_note'],'Gold, original box')
            self.assertEqual(len(r['instances']),1)
    def test_blank_price_and_saved_filter_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(directory)
            r=store.save_record(dict(kind='phone',brand='Nokia',model='N73',instances=[],wish_price=''))
            self.assertIsNone(r['wish_price'])
            views=[dict(name='Missing battery',filter='phone',query='Nokia',quickFilters={'battery_present':'false','location':'Box 1'},showWanted=False,sort={'key':'model','dir':-1})]
            store.settings({'views':views})
            self.assertEqual(Store(directory).meta('settings')['views'],views)
    def test_field_checks_persist_clear_and_survive_older_clients(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(directory)
            r=store.save_record(dict(kind='phone',brand='Nokia',model='N95',to_check=['os','battery','custom:example'],instances=[{'to_check':['imei','box'],'condition':'U kolekciji'}]))
            reopened=Store(directory).records()[0]
            self.assertEqual(reopened['to_check'],['os','battery','custom:example'])
            self.assertEqual(reopened['instances'][0]['to_check'],['imei','box'])
            del reopened['to_check'];del reopened['instances'][0]['to_check']
            r=store.save_record(reopened,reopened['rev'])
            self.assertEqual(r['to_check'],['os','battery','custom:example'])
            self.assertEqual(r['instances'][0]['to_check'],['imei','box'])
            r['to_check']=[];r['instances'][0]['to_check']=[]
            r=store.save_record(r,r['rev'])
            self.assertEqual(r['to_check'],[]);self.assertEqual(r['instances'][0]['to_check'],[])
            r['to_check']={'os':True}
            with self.assertRaises(ValueError):store.save_record(r,r['rev'])
