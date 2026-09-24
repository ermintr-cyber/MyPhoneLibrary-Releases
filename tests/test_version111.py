import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from server import Store
class BackupStatusTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.s=Store(self.tmp.name)
 def tearDown(self):self.tmp.cleanup()
 def test_each_destination_success_failure_and_changed_path(self):
  second=Path(self.tmp.name)/'second';self.s.settings({'backup_directory':str(second)})
  self.s.backup();a,b=self.s.backup_status();self.assertEqual(a['status'],'success');self.assertEqual(b['status'],'success');last=b['last_success']
  with patch('server.shutil.copy2',side_effect=OSError('Destination unavailable')):
   result=self.s.backup()
  a,b=self.s.backup_status();self.assertEqual(a['status'],'success');self.assertEqual(b['status'],'failed');self.assertEqual(b['last_success'],last);self.assertIn('Destination unavailable',b['message']);self.assertIn('Second',result['warning'])
  self.assertEqual(Store(self.tmp.name).backup_status()[1]['status'],'failed')
  self.s.settings({'backup_directory':str(Path(self.tmp.name)/'new')});self.assertEqual(self.s.backup_status()[1]['status'],'pending');self.assertIsNone(self.s.backup_status()[1]['last_success'])
 def test_disabled_second_location(self):
  self.assertEqual(self.s.backup_status()[1]['status'],'disabled')
