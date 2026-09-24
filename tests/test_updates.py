import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from updater import stage,apply

def archive(bad=False,traversal=False):
    files={'server.py':b'new server','web/app.js':b'new app'}
    if traversal:files['../outside.py']=b'bad'
    manifest={'product':'MyPhoneLibrary','version':'1.0.1','files':{name:hashlib.sha256(b).hexdigest() for name,b in files.items()}}
    result=io.BytesIO()
    with zipfile.ZipFile(result,'w') as z:
        for name,b in files.items():z.writestr('release/'+name,b'changed' if bad and name=='server.py' else b)
        z.writestr('release/app-manifest.json',json.dumps(manifest))
    return result.getvalue()

class UpdateTests(unittest.TestCase):
    def test_staging_apply_and_data_preservation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'app';data=Path(temp)/'data';root.mkdir();data.mkdir()
            (root/'server.py').write_text('old server');(data/'library.sqlite3').write_bytes(b'important database')
            self.assertEqual(stage(archive(),data,'1.0.0'),'1.0.1')
            self.assertEqual((root/'server.py').read_text(),'old server')
            self.assertTrue(apply(root,data));self.assertEqual((root/'server.py').read_text(),'new server')
            self.assertEqual((data/'library.sqlite3').read_bytes(),b'important database')
            self.assertTrue(list(data.glob('program-before-update-*')))
    def test_corruption_and_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            for content in (archive(bad=True),archive(traversal=True)):
                with self.assertRaises(ValueError):stage(content,temp,'1.0.0')
            self.assertFalse((Path(temp)/'pending-update').exists())
    def test_old_release_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):stage(archive(),temp,'1.0.1')

if __name__=='__main__':unittest.main()
