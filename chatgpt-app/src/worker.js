// Cloudflare Worker entry (free plan). Deploy: npx wrangler deploy
import catalog from '../data/agents.json';
import { createMcp } from './core.js';
import { PAGES } from './pages.js';
const mcp = createMcp(catalog);
export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (pathname === '/.well-known/openai-apps-challenge') {
        const t = (env && env.OPENAI_APPS_CHALLENGE) || '';
        return t ? new Response(t.trim(), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
                 : new Response('not configured', { status: 404 });
      }
      const page = PAGES[pathname.replace(/\/$/, '')];
      if (page) return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return mcp.handleHttp(request);
  },
};
