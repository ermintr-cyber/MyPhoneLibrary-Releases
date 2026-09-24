import json
import tempfile
import unittest
from pathlib import Path
import server
from battery_catalog import apply_battery_catalog, DATA

class BatteryCatalogTests(unittest.TestCase):
    def test_import_preserves_ids_and_runs_once(self):
        with tempfile.TemporaryDirectory() as folder:
            store=server.Store(folder)
            old=store.save_catalog({'category':'battery','name':'Nokia BL-5J','description':'old','specs':{'Voltage':'wrong','Custom property':'keep'}})
            result=apply_battery_catalog(store)
            self.assertEqual(result['entries'],53)
            self.assertTrue(list((Path(folder)/'backups').glob('*.zip')))
            with store.connect() as c: items=store.catalog(c)
            battery=next(x for x in items if x['id']==old['id'])
            self.assertEqual(battery['specs']['Voltage'],'3.7 V')
            self.assertEqual(battery['specs']['Custom property'],'keep')
            self.assertTrue(battery['supported_models'])
            updated=store.save_catalog({**battery,'description':'My edited notes'})
            self.assertIsNone(apply_battery_catalog(store))
            with store.connect() as c: after=next(x for x in store.catalog(c) if x['id']==old['id'])
            self.assertEqual(after['description'],'My edited notes')
            self.assertEqual(after['supported_models'],battery['supported_models'])
            self.assertEqual(after['rev'],updated['rev'])

    def test_source_coverage_and_qualified_compatibility(self):
        data=json.loads(DATA.read_text())
        self.assertEqual(data['category_count'],49)
        entries={e['name']:e for e in data['entries']}
        self.assertEqual(len(entries),53)
        self.assertIn('BL-5J',entries['BL-4J']['compatible_names'])
        self.assertNotIn('BL-4UL',entries['BL-4U']['compatible_names'])
        self.assertFalse(entries['BP-6M']['compatible_names'])
        self.assertFalse(entries['BP-6MT']['compatible_names'])
        self.assertTrue(entries['LRW-1']['suggestion_excluded'])
        self.assertTrue(all(m['warning'] for m in entries['BMC-3']['supported_models']))
        for e in entries.values():
            for other in e['compatible_names']:
                self.assertIn(e['name'],entries[other]['compatible_names'])
            self.assertTrue(e['description'])
            self.assertTrue(e['specs'])

if __name__=='__main__':unittest.main()
