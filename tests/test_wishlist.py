import copy
import tempfile
import unittest
from server import Store, Conflict

class WishlistTests(unittest.TestCase):
    def test_model_only_acquisition_is_persistent_and_revision_protected(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(folder)
            wanted = store.save_record({'kind':'phone','brand':'Nokia','model':'8800','wishlist':True,'battery':'BL-5X','instances':[]})
            self.assertEqual(wanted['instances'], [])
            reopened = Store(folder).records()[0]
            self.assertTrue(reopened['wishlist'])
            acquired = copy.deepcopy(reopened)
            acquired['wishlist'] = False
            acquired['instances'] = [{'condition':'U kolekciji','imei':'123456789012345'}]
            saved = store.save_record(acquired, acquired['rev'])
            self.assertEqual(saved['id'], wanted['id'])
            self.assertEqual(saved['battery'], 'BL-5X')
            self.assertEqual(saved['instances'][0]['inv'], '1')
            with self.assertRaises(Conflict):
                store.save_record(acquired, acquired['rev'])
            self.assertEqual(len(Store(folder).records()[0]['instances']), 1)
            self.assertFalse(Store(folder).records()[0]['wishlist'])
