#!/usr/bin/env python3
"""Bundle the 252-agent roster into data/agents.json (no network, no secrets)."""
import json, os, re, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'chatgpt-app', 'data', 'agents.json')
CATS = {
 'planning': 'Planning & coordination', 'test': 'Testing & QA', 'general': 'General helpers',
 'review': 'Code review', 'perf': 'Performance & optimization', 'architecture': 'Architecture & design',
 'security': 'Security', 'code': 'Coding', 'memory': 'Memory & knowledge', 'docs': 'Documentation',
 'trading': 'Trading & market data (prompts only, not financial advice)', 'research': 'Research',
 'git': 'Git & GitHub', 'music': 'Music'}
MAX = 24000  # cap per agent so one response stays small

def split_front(md):
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n', md, re.S)
    if not m: return {}, md
    meta = {}
    for line in m.group(1).splitlines():
        mm = re.match(r'^([A-Za-z_-]+):\s*(.*)$', line)
        if mm: meta[mm.group(1)] = mm.group(2).strip().strip('"\'')
    return meta, md[m.end():]

def first_text(body):
    for line in body.splitlines():
        t = line.strip().lstrip('#').strip()
        if t and not t.startswith(('```', '|', '-', '*', '>')) and len(t) > 25: return t[:300]
    return ''

roster = json.load(open(os.path.join(ROOT, 'docs/bench/agent-tasks.json')))['agents']
hub = {x['id']: x for x in json.load(open(os.path.join(ROOT, 'hub/hamza-agent-hub/src/runtime/catalog.json')))}
agents, seen = [], set()
for a in roster:
    src, name, kind = a['source'], a['name'], a['kind']
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
    desc = meta.get('description') or desc or first_text(body)
    body = body.strip()
    truncated = len(body) > MAX
    if truncated: body = body[:MAX] + '\n\n[... truncated; full file in the GitHub repo at ' + src + ']'
    aid = name
    assert aid not in seen, aid
    seen.add(aid)
    agents.append({'id': aid, 'category': kind, 'categoryLabel': CATS[kind],
                   'description': re.sub(r'\s+', ' ', desc)[:400], 'source': src,
                   'instructions': body, 'truncated': truncated})
cats = {}
for a in agents: cats[a['category']] = cats.get(a['category'], 0) + 1
json.dump({'generated': 'build_catalog.py', 'count': len(agents),
           'categories': [{'id': k, 'label': CATS[k], 'count': v} for k, v in sorted(cats.items(), key=lambda kv: -kv[1])],
           'agents': agents}, open(OUT, 'w'), ensure_ascii=False, indent=0)
print(len(agents), 'agents,', len(cats), 'categories ->', OUT, os.path.getsize(OUT), 'bytes')
