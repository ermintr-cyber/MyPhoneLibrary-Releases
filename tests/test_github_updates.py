import hashlib,json,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from updater import latest_release,download_release,stage,repository,check_download_url
from test_updates import archive

class GitHubUpdates(unittest.TestCase):
    def release(self,content):
        return {'tag_name':'v1.0.1','assets':[{'name':'MyPhoneLibrary-1.0.1-Windows-x64.zip','state':'uploaded','size':len(content),'digest':'sha256:'+hashlib.sha256(content).hexdigest(),'browser_download_url':'https://github.com/owner/phones/releases/download/v1.0.1/MyPhoneLibrary-1.0.1-Windows-x64.zip'}]}
    def test_download_and_stage(self):
        content=archive();release=self.release(content)
        with patch('updater.github_bytes',side_effect=[json.dumps(release).encode(),content]):
            with tempfile.TemporaryDirectory() as d:
                self.assertEqual(stage(download_release('owner/phones','1.0.0'),d,'1.0.0'),'1.0.1')
    def test_corrupt_download_does_not_stage(self):
        content=archive();release=self.release(content)
        with patch('updater.github_bytes',side_effect=[json.dumps(release).encode(),content[:-1]+b'x']):
            with self.assertRaisesRegex(ValueError,'verification'):download_release('owner/phones','1.0.0')
    def test_no_digest_foreign_repo_and_prerelease_refused(self):
        for change in ('digest','url','prerelease'):
            r=self.release(archive())
            if change=='digest':r['assets'][0]['digest']=None
            if change=='url':r['assets'][0]['browser_download_url']='https://github.com/other/repo/releases/download/v1.0.1/package.zip'
            if change=='prerelease':r['prerelease']=True
            with patch('updater.github_bytes',return_value=json.dumps(r).encode()):
                with self.assertRaises(ValueError):latest_release('owner/phones','1.0.0')
    def test_repository_and_redirect_validation(self):
        for r in ('','https://github.com/a/b','a/b/../../','a/b?x=1'):
            with self.assertRaises(ValueError):repository(r)
        for u in ('http://github.com/a','https://127.0.0.1/','https://github.com.evil.org/a','https://github.com:444/a','https://user@github.com/a'):
            with self.assertRaises(ValueError):check_download_url(u)
    def test_current_release(self):
        with patch('updater.github_bytes',return_value=json.dumps(self.release(archive())).encode()):
            self.assertFalse(latest_release('owner/phones','1.0.1')['available'])
