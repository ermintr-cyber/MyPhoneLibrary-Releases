import base64
import json
import unittest
from unittest.mock import patch
from updater import latest_android


class AndroidUpdateTests(unittest.TestCase):
    def payload(self, **overrides):
        payload={'platform':'android','version':'1.16.0','android':{
            'url':'https://github.com/ermintr-cyber/MyMediaLibrary-Releases/releases/download/phone-android-v1.16.0/MyPhoneLibrary_Android_1.16.0.apk',
            'size':123,'sha256':'b'*64}}
        payload.update(overrides)
        return json.dumps({'content':base64.b64encode(json.dumps(payload).encode()).decode()}).encode()

    def test_compares_installed_apk_and_never_returns_windows(self):
        with patch('updater.github_bytes',return_value=self.payload()):
            result=latest_android('1.15.0')
            self.assertTrue(result['available'])
            self.assertEqual(result['platform'],'android')
            self.assertTrue(result['url'].endswith('.apk'))
            self.assertFalse(latest_android('1.16.0')['available'])
            self.assertFalse(latest_android('2.0.0')['available'])

    def test_wrong_channel_and_asset_are_rejected(self):
        for payload in [self.payload(platform='windows'),self.payload(android={'url':'https://example.test/setup.exe','size':100,'sha256':'b'*64})]:
            with patch('updater.github_bytes',return_value=payload),self.assertRaises(ValueError):latest_android('1.15.0')

    def test_missing_installed_android_version_is_rejected(self):
        with self.assertRaises(ValueError):latest_android('')
