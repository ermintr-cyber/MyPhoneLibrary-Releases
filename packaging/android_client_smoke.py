"""Real WebView acceptance checks against disposable data and the packaged UI."""
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright

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


def webview(playwright):
    pid = adb('shell', 'pidof', 'com.myphonelibrary.app').split()[0]
    adb('forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + pid)
    for _ in range(30):
        try:
            browser = playwright.chromium.connect_over_cdp('http://127.0.0.1:9222')
            pages = browser.contexts[0].pages
            if pages:
                return browser, pages[0]
        except Exception:
            pass
        time.sleep(1)
    raise AssertionError('Debug WebView did not become available')


with tempfile.TemporaryDirectory() as folder, sync_playwright() as playwright:
    store = server.Store(folder)
    host = server.AppServer(('0.0.0.0', 9000), store)
    threading.Thread(target=host.serve_forever, daemon=True).start()
    try:
        adb('shell', 'am', 'start', '-n', 'com.myphonelibrary.app/.MainActivity')
        connect_native()
        browser, page = webview(playwright)
        page.locator('#password').fill('Android-test-password')
        page.locator('#remember-me').check()
        page.locator('#login-submit').click()
        page.locator('#application').wait_for(state='visible')
        assert page.evaluate('BUNDLED_ANDROID_UI'), 'APK must use its packaged frontend'
        installed_ui = page.evaluate('UI_VERSION')
        assert installed_ui == (ROOT/'android/VERSION').read_text().strip()
        page.evaluate('settingsPanel()')
        save = page.locator('[data-action=save-settings]')
        save.scroll_into_view_if_needed()
        bounds, nav = save.bounding_box(), page.locator('.mobile-primary-nav').bounding_box()
        assert bounds['y']+bounds['height'] <= nav['y']+1, 'Save is covered by bottom navigation'
        # Real touch events pass through the native wrapper, unlike DOM scroll tests.
        page.evaluate("$('panel-body').scrollTop=300")
        before = page.evaluate("$('panel-body').scrollTop")
        assert before > 0
        page.evaluate('window.__reloadProbe=123')
        width, height = map(int, re.findall(r'\d+', adb('shell', 'wm', 'size'))[-2:])
        adb('shell', 'input', 'swipe', str(width//2), str(int(height*.45)), str(width//2), str(int(height*.8)), '1000')
        page.wait_for_timeout(1200)
        assert page.evaluate("$('panel-body').scrollTop") < before, 'Settings cannot scroll toward the top'
        assert page.evaluate('window.__reloadProbe') == 123, 'Scrolling caused a page reload'
        # Updating Windows must not replace/reload the Android UI.
        server.VERSION = '9.9.9'
        page.evaluate('checkConnection()')
        assert not page.evaluate('versionMismatch')
        assert page.evaluate('window.__reloadProbe') == 123
        page.reload()
        page.locator('#application').wait_for(state='visible')
        assert page.evaluate('UI_VERSION') == installed_ui, 'Server update replaced APK frontend'
        page.evaluate("settingsTab='about';settingsPanel()")
        assert page.locator('[data-action=install-update]').count() == 0
        assert page.locator('#update-file').count() == 0
        out = Path.cwd()/'release'
        out.mkdir(exist_ok=True)
        page.screenshot(path=str(out/'android-about.png'))
        adb('shell', 'input', 'keyevent', '3')
        adb('shell', 'am', 'force-stop', 'com.myphonelibrary.app')
        adb('shell', 'am', 'start', '-n', 'com.myphonelibrary.app/.MainActivity')
        browser, page = webview(playwright)
        page.locator('#application').wait_for(state='visible', timeout=30000)
        assert not page.locator('#login').is_visible(), 'Remembered login was lost'
        assert page.evaluate('UI_VERSION') == installed_ui
        print('PASS: APK UI isolation, native scrolling, reachable Save, Android-only updates, persistent login.')
    finally:
        host.shutdown()
