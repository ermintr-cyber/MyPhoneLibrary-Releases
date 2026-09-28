"""Authenticated loopback bridge; also vendored in MyPhoneLibrary."""
import base64
import hashlib
import hmac
import ipaddress
import json
import time


def sign(key, session, method, path):
    payload = base64.urlsafe_b64encode(json.dumps({'id': session['id'], 'csrf': session['csrf'],
        'expires': min(time.time()+30, session['expires']), 'method': method, 'path': path}, separators=(',', ':')).encode()).decode()
    return payload + '.' + hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()


def verify(key, value, peer, method, path):
    try:
        if not ipaddress.ip_address(peer).is_loopback or len(value)>8192:
            return None
        payload, mac = value.split('.', 1)
        expected = hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(mac, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload))
        if not time.time() < data['expires'] <= time.time()+35 or data['method'] != method or data['path'] != path:
            return None
        if len(data['id']) != 32 or not 20 <= len(data['csrf']) <= 128:
            return None
        return 'toolbox:'+data['id'], {'csrf': data['csrf'], 'expires': data['expires']}
    except (ValueError, TypeError, KeyError, UnicodeError):
        return None
