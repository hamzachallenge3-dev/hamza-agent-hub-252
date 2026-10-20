// Cloudflare Worker entry (free plan). Deploy: npx wrangler deploy
import catalog from '../data/agents.json';
import { createMcp } from './core.js';
const mcp = createMcp(catalog);
export default { fetch: request => mcp.handleHttp(request) };
