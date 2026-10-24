"""Prevent focus/visibility reload loops caused by mismatched release versions."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class FrontendVersionTests(unittest.TestCase):
    def test_frontend_version_matches_server(self):
        server = re.search(r"^VERSION = ['\"]([^'\"]+)", (ROOT / 'server.py').read_text(encoding='utf-8'), re.M).group(1)
        frontend = re.search(r"const UI_VERSION=['\"]([^'\"]+)", (ROOT / 'web/app.js').read_text(encoding='utf-8')).group(1)
        self.assertEqual(frontend, server, 'Version drift causes automatic reload on every tab focus')
