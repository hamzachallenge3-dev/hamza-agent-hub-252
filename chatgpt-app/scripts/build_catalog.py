#!/usr/bin/env python3
"""Bundle the 252-agent roster into data/agents.json (no network, no secrets)."""
import json, os, re
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'chatgpt-app', 'data', 'agents.json')
CATS = {
 'planning': 'Planning & coordination', 'test': 'Testing & QA', 'general': 'General helpers',
 'review': 'Code review', 'perf': 'Performance & optimization', 'architecture': 'Architecture & design',
 'security': 'Security', 'code': 'Coding', 'memory': 'Memory & knowledge', 'docs': 'Documentation',
 'trading': 'Trading & market data (prompts only, not financial advice)', 'research': 'Research',
 'git': 'Git & GitHub', 'music': 'Music'}
# The bench roster files these three under trading. Their sources are research, marketing, and SEO.
FIX_KIND = {
 'deep-researcher': 'research',
 'ecc-marketing-agent': 'general',
 'tool13-seo-audit': 'general',
}
DESC_OVERRIDE = {
 'tool13-seo-audit': 'Free SEO audit of an HTML page: titles, meta tags, headings, links and accessibility basics.',
}
MAX = 24000  # cap per agent so one response stays small

def split_front(md):
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n', md, re.S)
    if not m: return {}, md
    lines = m.group(1).splitlines()
    meta, i = {}, 0
    while i < len(lines):
        mm = re.match(r'^([A-Za-z_-]+):\s*(.*)$', lines[i])
        if not mm:
            i += 1
            continue
        key, val = mm.group(1), mm.group(2).strip().strip('"\'')
        if val in ('|', '>'):
            block = []
            i += 1
            while i < len(lines) and (lines[i].startswith((' ', '\t')) or lines[i].strip() == ''):
                block.append(lines[i].strip())
                i += 1
            meta[key] = re.sub(r'\s+', ' ', ' '.join(x for x in block if x)).strip()
            continue
        meta[key] = val
        i += 1
    return meta, md[m.end():]

def first_text(body):
    for line in body.splitlines():
        t = line.strip().lstrip('#').strip()
        if t and not t.startswith(('```', '|', '-', '*', '>')) and len(t) > 25: return t[:300]
    return ''

def clean_desc(desc, body):
    desc = re.sub(r'\s+', ' ', desc or '').strip()
    desc = re.split(r'\s+Source:\s+', desc, maxsplit=1)[0]
    desc = re.split(r'\s+Tested:\s+', desc, maxsplit=1)[0]
    desc = desc.strip(' -—|')
    if desc in ('', '|', '>'):
        desc = first_text(body)
    return desc[:400]

roster = json.load(open(os.path.join(ROOT, 'docs/bench/agent-tasks.json')))['agents']
hub = {x['id']: x for x in json.load(open(os.path.join(ROOT, 'hub/hamza-agent-hub/src/runtime/catalog.json')))}
agents, seen = [], set()
for a in roster:
    src, name, kind = a['source'], a['name'], FIX_KIND.get(a['name'], a['kind'])
    if kind not in CATS:
        raise SystemExit(f'unknown category {kind} for {name}')
    meta, body, desc = {}, '', ''
    if '#' in src:
        h = hub[src.split('#', 1)[1]]
        desc = h.get('description', '')
        p = h.get('profile') and os.path.join(ROOT, 'hub/hamza-agent-hub', h['profile'])
        if p and os.path.exists(p):
            meta, body = split_front(open(p, encoding='utf-8').read())
        else:
            body = f"# {name}\n\nYou are **{name}**, a specialist from the Hamza Agent Hub ({h.get('pack','hub')} pack, {h.get('category','')}).\n\n{desc}\n\nWork step by step, ask for missing inputs, and state clearly what you could not verify.\n"
            src = src + ' (generated from catalog description)'
    else:
        meta, body = split_front(open(os.path.join(ROOT, src), encoding='utf-8').read())
    desc = DESC_OVERRIDE.get(name) or clean_desc(meta.get('description') or desc, body)
    if not desc or desc in ('|', '>'):
        raise SystemExit(f'empty description for {name}')
    body = body.strip()
    truncated = len(body) > MAX
    if truncated: body = body[:MAX] + '\n\n[... truncated; full file in the GitHub repo at ' + src + ']'
    assert name not in seen, name
    seen.add(name)
    agents.append({'id': name, 'category': kind, 'categoryLabel': CATS[kind],
                   'description': desc, 'source': src,
                   'instructions': body, 'truncated': truncated})
if len(agents) != 252:
    raise SystemExit(f'expected 252 agents, got {len(agents)}')
cats = {}
for a in agents: cats[a['category']] = cats.get(a['category'], 0) + 1
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump({'generated': 'build_catalog.py', 'count': len(agents),
               'categories': [{'id': k, 'label': CATS[k], 'count': v} for k, v in sorted(cats.items(), key=lambda kv: -kv[1])],
               'agents': agents}, f, ensure_ascii=False, indent=0)
    f.write('\n')
print(len(agents), 'agents,', len(cats), 'categories ->', OUT, os.path.getsize(OUT), 'bytes')
for k, v in sorted(cats.items(), key=lambda kv: -kv[1]):
    print(f'  {k}: {v}')
