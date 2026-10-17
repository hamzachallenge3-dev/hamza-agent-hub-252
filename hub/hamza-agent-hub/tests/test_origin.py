"""Loopback integration: Python entrypoint -> real Node MCP runtime."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("hub", ROOT / "runtime/hub.py")
hub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hub)

class OriginContract(unittest.TestCase):
    def test_real_python_node_mcp_bridge(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "HAH_AUTH_TOKEN": "test-only-origin-token-32-characters",
            "HAH_DB_PATH": str(Path(directory)/"db.sqlite"),
            "HAH_WORKSPACES_DIR": str(Path(directory)/"workspaces"),
            "HAH_AUTO_FREELLMAPI": "0",
        }):
            with TestClient(hub.app) as client:
                self.assertEqual(client.get("/healthz").status_code, 200)
                self.assertEqual(client.post("/mcp", json={}).status_code, 401)
                headers = {"Authorization": "Bearer "+os.environ["HAH_AUTH_TOKEN"],
                           "Accept": "application/json, text/event-stream"}
                self.assertEqual(client.get("/mcp", headers=headers).status_code, 405)
                init = client.post("/mcp",headers=headers,json={"jsonrpc":"2.0","id":1,"method":"initialize","params":{
                    "protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"python-contract","version":"1"}}})
                self.assertEqual(init.status_code,200)
                self.assertEqual(init.json()["result"]["serverInfo"]["name"],"hamza-agent-hub")
                tools = client.post("/mcp",headers=headers,json={"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
                self.assertEqual(tools.status_code,200)
                # Base surface (25) + run_command on authenticated HTTP secret-path hubs.
                self.assertEqual(len(tools.json()["result"]["tools"]),26)
                names={t["name"] for t in tools.json()["result"]["tools"]}
                self.assertIn("run_command", names)
                large=client.post("/mcp",headers=headers,content=b"x"*1_048_577)
                self.assertEqual(large.status_code,413)
                bad=client.post("/mcp",headers={**headers,"Origin":"http://localhost.evil"},json={})
                self.assertEqual(bad.status_code,403)

if __name__ == "__main__":
    unittest.main()
