import hashlib,io,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
import updater

class InstallWorkerTests(unittest.TestCase):
    def test_verified_installer_and_progress(self):
        data=b'verified installer';info={'url':'https://github.com/a/b/releases/download/v1.7.0/setup.exe','size':len(data),'digest':hashlib.sha256(data).hexdigest()}
        opener=Mock();opener.open.return_value=io.BytesIO(data);progress=[]
        with tempfile.TemporaryDirectory() as tmp,patch.object(updater.urllib.request,'build_opener',return_value=opener):
            target=Path(tmp)/'setup.exe';updater.download_installer(info,target,progress.append)
            self.assertEqual(target.read_bytes(),data);self.assertEqual(progress[-1],100)
    def test_wrong_digest_never_creates_installer(self):
        info={'url':'https://github.com/a/b/releases/download/v1.7.0/setup.exe','size':3,'digest':'0'*64}
        opener=Mock();opener.open.return_value=io.BytesIO(b'bad')
        with tempfile.TemporaryDirectory() as tmp,patch.object(updater.urllib.request,'build_opener',return_value=opener):
            target=Path(tmp)/'setup.exe'
            with self.assertRaisesRegex(ValueError,'checksum'):updater.download_installer(info,target,lambda p:None)
            self.assertFalse(target.exists());self.assertFalse(target.with_suffix('.partial').exists())
    def job(self,tmp):
        root=Path(tmp)/'application';root.mkdir();data=Path(tmp)/'collection';data.mkdir()
        (data/'photos').mkdir();(data/'photos/picture.jpg').write_bytes(b'photo')
        (root/'app-manifest.json').write_text(json.dumps({'version':'1.7.0'}))
        job={'root':str(root),'data':str(data),'version':'1.7.0','artifact':{},'pid':123,'port':9000,'host':'0.0.0.0','session':'private','csrf':'private','status_path':str(data/'updates/status.json')}
        path=Path(tmp)/'job.json';path.write_text(json.dumps(job));return path,job
    def test_worker_order_completion_and_preservation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path,job=self.job(tmp);events=[]
            def download(info,dest,cb):events.append('download');dest.write_bytes(b'exe');cb(100)
            with patch.object(updater,'download_installer',side_effect=download),patch.object(updater,'worker_request',side_effect=lambda *a:events.append('backup-stop')),patch.object(updater,'wait_for_exit',side_effect=lambda *a:events.append('wait-exit')),patch('subprocess.run',side_effect=lambda *a,**kw:(events.append('install') or Mock(returncode=0))),patch.object(updater,'launch_server',side_effect=lambda *a:events.append('start')),patch.object(updater,'wait_for_version',side_effect=lambda *a:events.append('verify')):
                updater.run_job(path)
            self.assertEqual(events,['download','backup-stop','wait-exit','install','start','verify'])
            self.assertEqual(updater.read_status(job['status_path'])['status'],'completed')
            self.assertEqual((Path(job['data'])/'photos/picture.jpg').read_bytes(),b'photo')
            self.assertNotIn('session',json.loads(path.read_text()))
    def test_busy_server_prevents_installation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path,job=self.job(tmp)
            with patch.object(updater,'download_installer'),patch.object(updater,'worker_request'),patch.object(updater,'wait_for_exit',side_effect=RuntimeError('server busy')),patch('subprocess.run') as installer:
                updater.run_job(path);installer.assert_not_called()
            self.assertEqual(updater.read_status(job['status_path'])['status'],'failed')
    def test_failed_install_reopens_server(self):
        with tempfile.TemporaryDirectory() as tmp:
            path,job=self.job(tmp)
            with patch.object(updater,'download_installer'),patch.object(updater,'worker_request'),patch.object(updater,'wait_for_exit'),patch('subprocess.run',return_value=Mock(returncode=7)),patch.object(updater,'launch_server') as launch:
                updater.run_job(path);launch.assert_called_once()
            self.assertEqual(updater.read_status(job['status_path'])['status'],'failed')
