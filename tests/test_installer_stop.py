import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'packaging'))
import stop_for_install as worker

class StopForInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        folder=self.root/'MyPhoneLibrary';folder.mkdir()
        (folder/'server-running.json').write_text(json.dumps({'pid':123,'port':9000}))
        self.env=patch.dict(os.environ,{'LOCALAPPDATA':str(self.root),'PROGRAMDATA':str(self.root)})
        self.env.start()
    def tearDown(self):
        self.env.stop();self.tmp.cleanup()
    def test_waits_for_graceful_exit_without_killing(self):
        kernel=Mock();kernel.WaitForSingleObject.side_effect=[258,0]
        with patch.object(worker,'process_handle',return_value=(kernel,42)),patch.object(worker,'bridge_key',return_value=b'x'*32),patch.object(worker,'request',side_effect=[{'product':'MyPhoneLibrary'},{'ok':True}]) as req:
            self.assertEqual(worker.stop(self.root),10)
            self.assertEqual(req.call_args.args[1:3],('/api/server-control',b'{"action":"stop"}'))
            self.assertIn('X-Toolbox-Bridge',req.call_args.args[3])
            kernel.WaitForSingleObject.assert_called_with(42,120000)
            kernel.CloseHandle.assert_called_once_with(42)
    def test_busy_server_aborts_before_installation(self):
        kernel=Mock();kernel.WaitForSingleObject.return_value=258
        with patch.object(worker,'process_handle',return_value=(kernel,42)),patch.object(worker,'bridge_key',return_value=b'x'*32),patch.object(worker,'request',side_effect=[{'product':'MyPhoneLibrary'},{'ok':True}]):
            with self.assertRaises(TimeoutError):worker.stop(self.root)
            kernel.CloseHandle.assert_called_once_with(42)
    def test_wrong_service_never_receives_stop_or_key(self):
        kernel=Mock();kernel.WaitForSingleObject.return_value=258
        with patch.object(worker,'process_handle',return_value=(kernel,42)),patch.object(worker,'bridge_key') as key,patch.object(worker,'request',return_value={'product':'Other'}) as req:
            with self.assertRaises(ValueError):worker.stop(self.root)
            key.assert_not_called();self.assertEqual(req.call_count,1)
    def test_stale_or_foreign_process_is_not_contacted(self):
        with patch.object(worker,'process_handle',return_value=(Mock(),None)),patch.object(worker,'request') as req:
            self.assertEqual(worker.stop(self.root),0);req.assert_not_called()
if __name__=='__main__':unittest.main()
