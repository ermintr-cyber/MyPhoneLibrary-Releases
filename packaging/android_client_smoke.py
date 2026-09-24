"""Run real Android WebView checks against a disposable Windows server."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


def adb(*args):
    return subprocess.check_output(['adb', *args], text=True).strip()


def tap_node(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))


def connect_native():
    for _ in range(20):
        adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
        nodes = list(ET.fromstring(adb('shell', 'cat', '/sdcard/window.xml')).iter('node'))
        fields = [n for n in nodes if n.get('class') == 'android.widget.EditText']
        if fields:
            tap_node(fields[0])
            adb('shell', 'input', 'text', 'http://10.0.2.2:9000')
            adb('shell', 'input', 'keyevent', '4')
            for n in nodes:
                if n.get('text', '').lower() == 'save and connect':
                    tap_node(n)
                    return
        for n in nodes:
            if n.get('text', '').lower() == 'connection settings':
                tap_node(n)
                break
        time.sleep(1)
    raise AssertionError('Connection settings did not open')


class TestControl(BaseHTTPRequestHandler):
    """Host-only test control, never part of the production API."""
    def do_POST(self):
        if self.path != '/simulate-windows-update':
            self.send_error(404)
            return
        server.VERSION = '9.9.9'
        self.send_response(204)
        self.end_headers()


with tempfile.TemporaryDirectory() as folder:
    store = server.Store(folder)
    host = server.AppServer(('0.0.0.0', 9000), store)
    control = HTTPServer(('127.0.0.1', 0), TestControl)
    for instance in (host, control):
        threading.Thread(target=instance.serve_forever, daemon=True).start()
    out = Path.cwd()/'release'
    out.mkdir(exist_ok=True)
    try:
        adb('shell', 'am', 'start', '-n', 'com.myphonelibrary.app/.MainActivity')
        connect_native()
        subprocess.run(['node', str(ROOT/'packaging/android_client_smoke.cjs')], check=True,
                       env={**os.environ, 'ANDROID_TEST_CONTROL': f'http://127.0.0.1:{control.server_port}'})
    finally:
        # Keep diagnostics even when attaching to the WebView itself fails.
        with (out/'android-logcat.txt').open('w') as log:
            subprocess.run(['adb', 'logcat', '-d', '-t', '1500'], stdout=log, stderr=subprocess.STDOUT)
        with (out/'android-device.png').open('wb') as screenshot:
            subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=screenshot)
        adb('shell', 'am', 'force-stop', 'com.myphonelibrary.app')
        for instance in (host, control):
            instance.shutdown()
            instance.server_close()
