#!/usr/bin/env python3
"""Read-only-ish source retriever, leaves existing directories untouched.

No agent or workflow activation; no paid services.
"""
from pathlib import Path
import argparse, subprocess, sys, json

REPOS = {
    'lapian-notes': 'https://github.com/bkingfilm/lapian-notes',
    'nanomuse': 'https://github.com/nano-muse/nanoMuse',
    'n8n-library': 'https://github.com/Zie619/n8n-workflows',
    'ecc-68': 'https://github.com/affaan-m/ECC',
    'munder-difflin': 'https://github.com/HarnessMD/munder-difflin',
    'scrapling': 'https://github.com/D4Vinci/Scrapling',
    'goose': 'https://github.com/aaif-goose/goose',
    'headroom': 'https://github.com/headroomlabs-ai/headroom',
    'open-generative-ai': 'https://github.com/Anil-matcha/Open-Generative-AI',
    'agent-reach': 'https://github.com/Panniantong/Agent-Reach',
}
def main():
    ap=argparse.ArgumentParser(description='Download upstream sources only: no install, no execution')
    ap.add_argument('--all', action='store_true',help='Download all 10 public repositories. Large downloads!')
    ap.add_argument('--only',choices=list(REPOS))
    ap.add_argument('--list',action='store_true')
    ap.add_argument('--dest',type=Path,default=Path(__file__).resolve().parent.parent/'downloaded_public_sources')
    args=ap.parse_args()
    if args.list:
        for k,v in REPOS.items():print(k,v)
        return 0
    if not args.all and not args.only:
        ap.error('Choose --list, --only NAME, or --all')
    if subprocess.run(['git','--version'],capture_output=True).returncode:
        print('ERROR: git not installed',file=sys.stderr);return 2
    args.dest.mkdir(parents=True,exist_ok=True)
    selections=list(REPOS) if args.all else [args.only]
    status={}
    for key in selections:
        dest=args.dest/key
        if dest.exists():
            print(f'SKIPPED: {key} destination exists, leaving unchanged: {dest}')
            status[key]='exists_not_touched';continue
        print(f'FETCHING {key}: {REPOS[key]}',flush=True)
        cp=subprocess.run(['git','clone','--depth','1','--filter=blob:none',REPOS[key],str(dest)],check=False)
        status[key]='downloaded' if cp.returncode==0 else 'clone_failed'
        if cp.returncode:print(f'ERROR: {key} clone failed; inspect logs and network',file=sys.stderr)
    path=args.dest/'FETCH_RESULTS.json';path.write_text(json.dumps(status,indent=2)+'\n')
    return 0 if all(v!='clone_failed' for v in status.values()) else 1
if __name__=='__main__':raise SystemExit(main())
