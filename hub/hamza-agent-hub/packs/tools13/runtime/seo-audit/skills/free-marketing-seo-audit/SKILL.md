---
name: free-marketing-seo-audit
description: Free original Okara-style technical SEO audit, with honest GEO notes. Uses local HTML or public web page, no paid provider, posts or guarantees.
---
# Free Marketing SEO Audit (independent, not official Okara)
Source inspiration: https://okara.ai/agent. Okara is proprietary hosted software; public page includes a free analysis tier but its broader AI agent service may require paid access. This **separate open implementation does not access Okara's backend**, Reddit accounts or private site analytics.

## Use
- Run with local fixture HTML: `python3 scripts/seo_audit.py --html-file /tmp/site.html`
- For a public page on an authorized runtime with internet: `python3 scripts/seo_audit.py --url https://example.com/`
- Outputs JSON for key title, description, canonical, H1, image alt, HTML language, OpenGraph, JSON-LD, advisory and numeric basic-technical score. This score is **NOT search ranking, GEO citation or marketing performance.**
- For a user's company website, turn findings into a prioritized SEO fix checklist. Use public search tools to research Reddit discussions manually and draft on-topic replies for approval. Never auto-post, fabricate testimonials, spam, or promise ChatGPT citation placement.
- Security: no credentials or paid API; no private IP / localhost fetches, no account activity. Local HTML test is read-only.
- Before claiming Hamza Agent Hub integration is working, run `run_command` on its Linux CPU and demonstrate actual invocation and live public site fetch. A skill-only plugin is not a backend connection.
