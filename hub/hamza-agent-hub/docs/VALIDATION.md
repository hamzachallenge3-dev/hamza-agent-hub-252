# Release 1.2.0 validation

Checks run on 2026-10-13 with Node 24.19.0 and Python 3.12.14 (minimum target Node 22). No production URL containing a capability was probed; no production service was changed.

- `npm run build`: TypeScript compile.
- `npm test`: 31 tests passed across three files; real MCP annotation/catalog/resource/prompt checks, 5 positive + 3 negative store cases, 92-profile loading, five pack missions, Worker proxy/security contracts, HTTP auth/origin/rate-limit tests, retry/dead-letter/cancellation and path/redaction regressions.
- `python -m unittest discover -s tests -p 'test_*.py' -v`: 4 tests passed; real Python-to-Node MCP integration, auth/body/origin limits, deterministic ZIP, secret and symlink rejection, public capability export rejection.
- `python3 packs/tools13/scripts/verify_bundle.py`: original upstream attribution/archive verification.
- `npm run pack:chatgpt`: deterministic private scaffold rebuilt, archive members allowlisted and scanned for secrets.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at check time.
- `pip-audit -r runtime/requirements.txt`: initial Starlette pin had advisories; upgraded to patched 1.3.1, integration re-tested, and audit reports zero known vulnerabilities.

- Wrangler 4.150.0 `deploy --dry-run`: configuration and Worker bundle validated without deploying. Rate-limit bindings use the experimental Wrangler metadata interface; verify account support before deployment.
- Gitleaks v8.30.0 source scan: checked before commit; documentation examples use environment references and sanitized endpoint output.

Local evidence does not certify live Cloudflare configuration, Docker image execution (build attempted, dependency downloads stalled in this environment), Kaggle reliability, a live FreeLLMAPI provider, public policy URLs on main, or ChatGPT portal acceptance. Those require the live environment and private account credentials. See `CHATGPT-STORE.md` for every remaining blocker.
