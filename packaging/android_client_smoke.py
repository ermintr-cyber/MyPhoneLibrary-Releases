"""Run real Android WebView checks against a disposable Windows server."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import threading
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


def adb(*args):
    return subprocess.check_output(['adb', *args], text=True, timeout=20).strip()


def configure_debug_client():
    # Seed only this disposable debug APK's connection settings. Android's run-as
    # requires a debuggable package; no production app data or device permissions change.
    preferences = '<map><string name="local_url">http://10.0.2.2:9000</string></map>'
    subprocess.run(['adb', 'shell', "run-as com.myphonelibrary.app sh -c 'mkdir -p shared_prefs; cat > shared_prefs/mpl_connections.xml'"],
                   input=preferences, text=True, check=True, timeout=20)


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
    # WebView/emulator may leave idle preconnect sockets until the emulator exits.
    # They must not make this disposable fixture wait forever in server_close().
    host.daemon_threads = True
    control = HTTPServer(('127.0.0.1', 0), TestControl)
    for instance in (host, control):
        threading.Thread(target=instance.serve_forever, daemon=True).start()
    out = Path.cwd()/'release'
    out.mkdir(exist_ok=True)
    try:
        # Initial collection setup is deliberately restricted to the host computer.
        request = urllib.request.Request('http://127.0.0.1:9000/api/setup',
            data=b'{"password":"Android-test-password"}',
            headers={'Content-Type': 'application/json', 'X-MPL-Client': '1'})
        with urllib.request.urlopen(request) as response:
            assert response.status == 200
        configure_debug_client()
        adb('shell', 'am', 'start', '-n', 'com.myphonelibrary.app/.MainActivity')
        subprocess.run(['node', str(ROOT/'packaging/android_client_smoke.cjs')], check=True, timeout=180,
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
