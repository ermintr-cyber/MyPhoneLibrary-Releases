"""Cross-device writes, nested inventory and restore failure preservation."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from server import Conflict, Store, dump
import server


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(self.tmp.name)
        self.phone = self.store.save_record({
            'kind': 'phone', 'brand': 'Nokia', 'model': 'N73',
            'instances': [{'location': 'Room'}],
        })

    def tearDown(self):
        self.tmp.cleanup()

    def new_repair(self):
        return self.store.repair({
            'record_id': self.phone['id'],
            'instance_id': self.phone['instances'][0]['id'],
            'note': 'Original diagnosis', 'cost': 15, 'currency': 'KM',
        })

    def test_stale_completion_cannot_overwrite_newer_repair(self):
        old = self.new_repair()
        newer = self.store.repair({**old, 'note': 'New diagnosis', 'cost': 27})
        with self.assertRaises(Conflict):
            self.store.repair({**old, 'action': 'status', 'status': 'Završen'})
        current = self.store.all_data()['repairs'][0]
        self.assertEqual(current, newer)
        self.assertEqual(current['note'], 'New diagnosis')
        self.assertEqual(current['cost'], 27)

    def test_scoped_completion_keeps_note_cost_unit_and_created_time(self):
        old = self.new_repair()
        complete = self.store.repair({
            'id': old['id'], 'record_id': old['record_id'], 'rev': old['rev'],
            'action': 'status', 'status': 'Završen',
            'note': 'Must not replace', 'cost': 999, 'instance_id': 'other',
        })
        for field in ('note', 'cost', 'currency', 'instance_id', 'at'):
            self.assertEqual(complete[field], old[field])
        self.assertEqual(complete['status'], 'Završen')
        self.assertEqual(complete['rev'], old['rev'] + 1)
        self.assertIsNotNone(complete['completed_at'])
        with self.assertRaises(Conflict):
            self.store.repair({**old, 'note': 'Stale full update'})

    def test_old_repair_without_revision_supports_explicit_current_revision(self):
        old = self.new_repair()
        del old['rev']
        with self.store.connect() as c:
            c.execute('UPDATE repairs SET data=? WHERE id=?', (dump(old), old['id']))
        complete = self.store.repair({
            'id': old['id'], 'record_id': old['record_id'], 'rev': 1,
            'action': 'status', 'status': 'Završen',
        })
        self.assertEqual(complete['note'], old['note'])
        self.assertEqual(complete['rev'], 2)

    def test_legacy_bundled_client_completion_preserves_newer_fields(self):
        old = self.new_repair()
        legacy = {k: v for k, v in old.items() if k != 'rev'}
        newer = self.store.repair({**old, 'note': 'New diagnosis', 'cost': 27})
        complete = self.store.repair({**legacy, 'status': 'Završen'})
        self.assertEqual(complete['note'], newer['note'])
        self.assertEqual(complete['cost'], newer['cost'])
        self.assertEqual(complete['rev'], newer['rev'] + 1)
        self.assertEqual(complete['status'], 'Završen')
        with self.assertRaises(Conflict):
            self.store.repair({**legacy, 'note': 'Unsafe legacy edit'})

    def test_parent_inventory_includes_nested_active_units_and_can_opt_out(self):
        room = next(x for x in self.store.all_data()['catalog'] if x['category'] == 'location' and x['name'] == 'Room')
        shelf = self.store.save_catalog({'category': 'location', 'name': 'Shelf A', 'parent_id': room['id']})
        self.store.save_catalog({'category': 'location', 'name': 'Box 1', 'parent_id': shelf['id']})
        phone = self.phone
        phone['instances'].extend([
            {'location': 'Shelf A'}, {'location': 'Box 1', 'condition': 'Posuđen'},
            {'location': 'Box 1', 'condition': 'Prodan'}, {'location': 'Other'},
        ])
        self.store.save_record(phone, phone['rev'])
        nested = self.store.inventory({'location': ' room '})
        self.assertEqual(len(nested['expected']), 3)
        direct = self.store.inventory({'location': 'Room', 'include_sublocations': False})
        self.assertEqual(len(direct['expected']), 1)
        self.assertEqual(len(self.store.inventory({'location': 'Shelf A'})['expected']), 2)
        self.assertEqual(len(self.store.inventory({'location': ''})['expected']), 4)
        self.store.inventory({'id': nested['id'], 'action': 'close'})
        closed = next(x for x in self.store.all_data()['inventories'] if x['id'] == nested['id'])
        self.assertEqual(len(closed['expected']), 3)

    def restore_fixture(self):
        old_image = self.store.media / ('a' * 32 + '.png')
        new_image = self.store.media / ('b' * 32 + '.png')
        old_image.write_bytes(b'backup image')
        new_image.write_bytes(b'backup-only image')
        backup = self.store.backup()
        content = (self.store.backups / backup['name']).read_bytes()
        old_image.write_bytes(b'current image')
        new_image.unlink()
        phone = self.store.records()[0]
        phone['note'] = 'Current database'
        self.store.save_record(phone, phone['rev'])
        return content, old_image, new_image

    def test_database_replace_failure_rolls_back_overwrites_and_new_photos(self):
        content, old_image, new_image = self.restore_fixture()
        replace = server.os.replace

        def fail_database(source, target):
            if Path(target) == self.store.path:
                raise OSError('Database busy')
            return replace(source, target)

        with patch.object(server.os, 'replace', side_effect=fail_database):
            with self.assertRaisesRegex(ValueError, 'previous database and photos were kept'):
                self.store.restore(content)
        self.assertEqual(self.store.records()[0]['note'], 'Current database')
        self.assertEqual(old_image.read_bytes(), b'current image')
        self.assertFalse(new_image.exists())
        self.assertEqual(list(self.store.directory.glob('restore-rollback-*')), [])

    def test_second_photo_failure_rolls_back_first_photo(self):
        content, old_image, new_image = self.restore_fixture()
        replace = server.os.replace

        def fail_second(source, target):
            if Path(target) == new_image:
                raise OSError('Media folder full')
            return replace(source, target)

        with patch.object(server.os, 'replace', side_effect=fail_second):
            with self.assertRaisesRegex(ValueError, 'previous database and photos were kept'):
                self.store.restore(content)
        self.assertEqual(old_image.read_bytes(), b'current image')
        self.assertFalse(new_image.exists())
        self.assertEqual(self.store.records()[0]['note'], 'Current database')

    def test_failed_rollback_retains_originals_and_names_recovery_backup(self):
        content, old_image, new_image = self.restore_fixture()
        replace = server.os.replace

        def fail_commit_and_rollback(source, target):
            if Path(target) == self.store.path or Path(source).parent.name.startswith('restore-rollback-'):
                raise OSError('Folder locked')
            return replace(source, target)

        with patch.object(server.os, 'replace', side_effect=fail_commit_and_rollback):
            with self.assertRaisesRegex(ValueError, 'Previous complete backup:'):
                self.store.restore(content)
        recovery = list(self.store.directory.glob('restore-rollback-*'))
        self.assertEqual(len(recovery), 1)
        self.assertEqual((recovery[0] / old_image.name).read_bytes(), b'current image')
        self.assertEqual(self.store.records()[0]['note'], 'Current database')

    def test_successful_restore_preserves_unrelated_media_and_cleans_rollback(self):
        content, old_image, new_image = self.restore_fixture()
        unrelated = self.store.media / ('c' * 32 + '.png')
        unrelated.write_bytes(b'preserved unrelated image')
        self.store.restore(content)
        self.assertEqual(old_image.read_bytes(), b'backup image')
        self.assertEqual(new_image.read_bytes(), b'backup-only image')
        self.assertEqual(unrelated.read_bytes(), b'preserved unrelated image')
        self.assertNotEqual(self.store.records()[0]['note'], 'Current database')
        self.assertEqual(list(self.store.directory.glob('restore-rollback-*')), [])


if __name__ == '__main__':
    unittest.main()
