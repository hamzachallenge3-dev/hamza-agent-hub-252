// Self-host entry (Node 18+), zero dependencies: PORT=8791 node src/server.js
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createMcp } from './core.js';
const catalog = JSON.parse(readFileSync(new URL('../data/agents.json', import.meta.url), 'utf8'));
const mcp = createMcp(catalog);
const port = Number(process.env.PORT || 8791), host = process.env.HOST || '127.0.0.1';
http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const r = await mcp.handleHttp(new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers: req.headers, body }), process.env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } catch { res.writeHead(500); res.end('{"error":"internal"}'); }
}).listen(port, host, () => console.log(`hamza-agent-hub MCP on http://${host}:${port}/mcp (${catalog.count} agents)`));
