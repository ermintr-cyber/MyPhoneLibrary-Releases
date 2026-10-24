import base64
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import server

class ToolboxBridgeTests(unittest.TestCase):
    def test_bridge_sso_is_opt_in_and_does_not_open_direct_access(self):
        with tempfile.TemporaryDirectory() as directory:
            key=secrets.token_bytes(32);path=Path(directory)/'bridge.key';path.write_bytes(key)
            app=server.AppServer(('127.0.0.1',0),server.Store(Path(directory)/'data'))
            threading.Thread(target=app.serve_forever,daemon=True).start()
            def request(endpoint,bridge=''):
                c=http.client.HTTPConnection('127.0.0.1',app.server_port,timeout=5)
                c.request('GET',endpoint,headers={'X-Toolbox-Bridge':bridge});r=c.getresponse();result=(r.status,json.loads(r.read()));c.close();return result
            def signed(endpoint):
                payload=base64.urlsafe_b64encode(json.dumps({'id':'a'*32,'csrf':'b'*32,'expires':time.time()+25,'method':'GET','path':endpoint}).encode()).decode()
                return payload+'.'+hmac.new(key,payload.encode(),hashlib.sha256).hexdigest()
            try:
                with patch.dict(os.environ,{'MPL_TOOLBOX_KEY_FILE':''}):
                    self.assertFalse(request('/api/status',signed('/api/status'))[1]['authenticated'])
                with patch.dict(os.environ,{'MPL_TOOLBOX_KEY_FILE':str(path)}):
                    self.assertFalse(request('/api/status','forged')[1]['authenticated'])
                    self.assertTrue(request('/api/status',signed('/api/status'))[1]['authenticated'])
                    self.assertEqual(request('/api/data',signed('/api/data'))[0],200)
                    self.assertEqual(request('/api/data')[0],401)
                    self.assertEqual(request('/api/data',signed('/api/status'))[0],401)
            finally:app.shutdown();app.server_close()
