import base64
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import server

class Version16Tests(unittest.TestCase):
    def test_native_folder_cancel_and_unicode(self):
        with patch.object(server.os,'name','nt'), patch.object(server.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'')) as run:
            self.assertEqual(server.choose_backup_folder('C:\\Backup'),{'path':None})
            args=run.call_args.args[0]
            self.assertIn('-STA',args)
            script=base64.b64decode(args[-1]).decode('utf-16le')
            self.assertIn('$dialog.ShowDialog($owner)',script)
            self.assertIn('$owner.TopMost=$true',script)
        selected='C:\\Telefoni čć'
        with patch.object(server.os,'name','nt'), patch.object(server,'Path') as path, patch.object(server.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=base64.b64encode(selected.encode()))):
            path.return_value.is_dir.return_value=True
            self.assertEqual(server.choose_backup_folder(''),{'path':selected})

    def test_native_folder_failure_releases_lock(self):
        with patch.object(server.os,'name','nt'), patch.object(server.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout=b'')):
            with self.assertRaisesRegex(ValueError,'could not open'):server.choose_backup_folder()
        self.assertFalse(server._folder_picker_lock.locked())

    def test_gsm_nested_markup_and_attribute_order(self):
        fields,image=server.parse_gsm_html('''<meta content="https://fdn2.gsmarena.com/a.jpg" property="og:image"><h1 data-spec = 'modelname'><span>Nokia</span> 6500 Slide</h1><td data-spec = "os">Series 40<br>5th edition</td>''')
        self.assertEqual(fields['modelname'],'Nokia 6500 Slide')
        self.assertEqual(fields['os'],'Series 40 5th edition')
        self.assertTrue(image.endswith('a.jpg'))

    def test_gsm_heading_and_metadata_fallback(self):
        self.assertEqual(server.parse_gsm_html('<h1 class="specs-phone-name-title">Nokia N73</h1>')[0]['modelname'],'Nokia N73')
        fields,_=server.parse_gsm_html('<meta property="og:title" content="Nokia N73 - Full phone specifications"><td data-spec="os">Symbian</td>')
        self.assertEqual(fields['modelname'],'Nokia N73')
        with patch.object(server,'remote_get',return_value=b'<title>Just a moment</title>'):
            with self.assertRaisesRegex(ValueError,'access check'):server.gsm_preview('https://www.gsmarena.com/nokia_6500_slide-1996.php')
