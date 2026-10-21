"""Gracefully stop this installation before NSIS replaces its runtime.

Runs from the installer temporary directory using the existing Python runtime.
Only the local owner with the Toolbox bridge key can authorize the stop. No
process is killed, and the process handle is held until outstanding writes exit.
Exit 10 means a running server was stopped; 0 means nothing needed stopping.
"""
import argparse
import base64
import ctypes
from ctypes import wintypes as w
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import time
from urllib.request import Request, build_opener, ProxyHandler

OPENER = build_opener(ProxyHandler({}))


def request(port, path, body=None, headers=None):
    req = Request(f'http://127.0.0.1:{port}{path}', data=body, headers=headers or {})
    with OPENER.open(req, timeout=15) as response:
        return json.load(response)


def stop_headers(key):
    csrf = secrets.token_urlsafe(24)
    claims = dict(id=secrets.token_hex(16), csrf=csrf, expires=time.time()+30,
                  method='POST', path='/api/server-control')
    payload = base64.urlsafe_b64encode(json.dumps(claims, separators=(',', ':')).encode()).decode()
    signature = hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()
    return {'Content-Type':'application/json', 'X-MPL-Client':'1',
            'X-MPL-CSRF':csrf, 'X-Toolbox-Bridge':payload+'.'+signature}


def bridge_key():
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\MyToolbox') as reg:
        path = Path(winreg.QueryValueEx(reg, 'BridgeKeyFile')[0])
    key = path.read_bytes()
    if len(key) != 32:
        raise ValueError('Invalid Toolbox bridge key. Nothing was overwritten.')
    return key


def process_handle(pid, root):
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    kernel.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, ctypes.POINTER(w.DWORD)]
    kernel.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
    kernel.WaitForSingleObject.restype = w.DWORD
    handle = kernel.OpenProcess(0x100000 | 0x1000, False, pid)
    if not handle:
        error = ctypes.get_last_error()
        if error == 87:  # PID no longer exists.
            return kernel, None
        raise ctypes.WinError(error)
    size = w.DWORD(32768)
    name = ctypes.create_unicode_buffer(size.value)
    if not kernel.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)):
        kernel.CloseHandle(handle)
        raise ctypes.WinError(ctypes.get_last_error())
    expected = {str((root/'runtime'/n).resolve()).casefold() for n in ('python.exe','pythonw.exe')}
    if str(Path(name.value).resolve()).casefold() not in expected:
        kernel.CloseHandle(handle)
        return kernel, None  # A stale marker or another installation; never stop it.
    return kernel, handle


def stop(root):
    folders = {Path(os.environ['LOCALAPPDATA'])/'MyPhoneLibrary',
               Path(os.environ.get('PROGRAMDATA', 'C:/ProgramData'))/'MyPhoneLibrary'}
    stopped = False
    seen = set()
    for folder in folders:
        marker = folder/'server-running.json'
        if not marker.is_file():
            continue
        record = json.loads(marker.read_text(encoding='utf-8'))
        pid, port = int(record['pid']), int(record['port'])
        if pid <= 0 or not 1 <= port <= 65535:
            raise ValueError('Invalid running-server record. Nothing was overwritten.')
        if pid in seen:
            continue
        seen.add(pid)
        kernel, handle = process_handle(pid, root)
        if handle is None:
            continue
        try:
            if kernel.WaitForSingleObject(handle, 0) == 0:
                continue
            status = request(port, '/api/status')
            if status.get('product') != 'MyPhoneLibrary':
                raise ValueError('The running application could not be identified. Nothing was overwritten.')
            response = request(port, '/api/server-control', b'{"action":"stop"}', stop_headers(bridge_key()))
            if response.get('ok') is not True:
                raise ValueError('Phone did not accept a graceful stop. Nothing was overwritten.')
            if kernel.WaitForSingleObject(handle, 120000) != 0:
                raise TimeoutError('Phone is still finishing work. No files were replaced. Try the update again later.')
            stopped = True
        finally:
            kernel.CloseHandle(handle)
    return 10 if stopped else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    try:
        return stop(args.root.resolve())
    except Exception as error:
        folder = Path(os.environ['LOCALAPPDATA'])/'MyPhoneLibrary'
        folder.mkdir(parents=True, exist_ok=True)
        (folder/'installer-stop.log').write_text(str(error), encoding='utf-8')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
