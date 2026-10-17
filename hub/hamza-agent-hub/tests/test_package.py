import importlib.util
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("pack",ROOT/"scripts/package_plugin.py")
pack=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)

class PackageContract(unittest.TestCase):
    def test_deterministic_secret_free_scaffold(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(pack,"OUT",Path(directory)/"plugin.zip"):
            output=pack.build()
            first=output.read_bytes()
            pack.build()
            self.assertEqual(first,output.read_bytes())
            with zipfile.ZipFile(output) as archive:
                names=archive.namelist()
                self.assertFalse(any(".env" in name or ".app.json" in name or "node_modules" in name for name in names))
                self.assertIn("hamza-agent-hub/SETUP-REQUIRED.txt",names)
                manifest=json.loads(archive.read("hamza-agent-hub/plugin.json"))
                self.assertLessEqual(len(manifest["extensions"]["com.openai"]["interface"]["shortDescription"]),30)
                for name in names:
                    pack.check_content(archive.read(name))
    def test_secret_and_capability_export_rejected(self):
        with patch.dict(os.environ,{"HUB_SECRET":"test-secret-that-must-not-ship"}):
            with self.assertRaises(ValueError):pack.check_content(b"test-secret-that-must-not-ship")
        with patch.dict(os.environ,{"HAH_PUBLIC_MCP_URL":"https://hub.imdifferent01.com/test-capability/mcp","HAH_PUBLIC_ENDPOINT_VERIFIED":"1"}):
            with self.assertRaises(ValueError):pack.build(public=True)
        with self.assertRaises(ValueError):pack.check_content(b"-----BEGIN PRIVATE KEY-----")
    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(pack,"SOURCE",Path(directory)):
            (Path(directory)/"link").symlink_to(ROOT/"package.json")
            with self.assertRaises(ValueError):pack.build()

if __name__=="__main__":unittest.main()
