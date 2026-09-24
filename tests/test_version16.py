import base64
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import server

class Version16Tests(unittest.TestCase):
    def test_native_folder_cancel_and_unicode(self):
        from unittest.mock import Mock
        process=Mock(returncode=0)
        process.communicate.return_value=(b'',b'')
        with patch.object(server.os,'name','nt'), patch.object(server.subprocess,'Popen',return_value=process) as run:
            self.assertEqual(server.choose_backup_folder('C:\\Backup'),{'path':None})
            self.assertIn('--folder-picker',run.call_args.args[0])
        selected='C:\\Telefoni čć'
        process.communicate.return_value=(base64.b64encode(selected.encode()),b'')
        with patch.object(server.os,'name','nt'), patch.object(server,'Path') as path, patch.object(server.subprocess,'Popen',return_value=process):
            path.return_value.is_dir.return_value=True
            self.assertEqual(server.choose_backup_folder(''),{'path':selected})

    def test_native_folder_failure_releases_lock(self):
        from unittest.mock import Mock
        process=Mock(returncode=1)
        process.communicate.return_value=(b'',b'failed')
        with patch.object(server.os,'name','nt'), patch.object(server.subprocess,'Popen',return_value=process):
            with self.assertRaisesRegex(ValueError,'could not open'):server.choose_backup_folder()
        self.assertIsNone(server._folder_picker_process)

    def test_stale_picker_replaced_and_restart_cancels(self):
        from unittest.mock import Mock
        old=Mock();old.poll.return_value=None
        process=Mock(returncode=0);process.communicate.return_value=(b'',b'')
        server._folder_picker_process=old
        with patch.object(server.os,'name','nt'), patch.object(server.subprocess,'Popen',return_value=process):
            server.choose_backup_folder()
        old.terminate.assert_called_once()
        process.poll.return_value=None;server._folder_picker_process=process
        server.cancel_folder_picker();process.terminate.assert_called_once()
        self.assertIsNone(server._folder_picker_process)

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

    @unittest.skipUnless(server.os.name=='nt','Windows shell dialog')
    def test_real_windows_dialog_opens_and_closes(self):
        import ctypes, subprocess, sys, time
        from ctypes import wintypes as w
        user=ctypes.WinDLL('user32')
        callback_type=ctypes.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
        user.EnumWindows.argtypes=[callback_type,w.LPARAM]
        user.GetWindowThreadProcessId.argtypes=[w.HWND,ctypes.POINTER(w.DWORD)]
        user.IsWindowVisible.argtypes=[w.HWND]
        user.PostMessageW.argtypes=[w.HWND,w.UINT,w.WPARAM,w.LPARAM]
        process=subprocess.Popen([sys.executable,'-c',"import server; assert server.native_folder_dialog('') is None; print('CANCELLED')"],cwd=server.BASE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
        found=[]
        @callback_type
        def inspect(hwnd,param):
            pid=w.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
            if pid.value==process.pid and user.IsWindowVisible(hwnd):found.append(hwnd)
            return True
        try:
            for _ in range(100):
                user.EnumWindows(inspect,0)
                if found or process.poll() is not None:break
                time.sleep(.1)
            if found:user.PostMessageW(found[0],0x10,0,0)
            else:
                process.kill()
            out,err=process.communicate(timeout=10)
            self.assertTrue(found,err.decode(errors='replace'))
            self.assertEqual(process.returncode,0,err.decode(errors='replace'))
            self.assertIn(b'CANCELLED',out)
        finally:
            if process.poll() is None:process.kill();process.communicate()
