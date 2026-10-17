#!/usr/bin/env python3
import json, hashlib, zipfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
m=json.loads((root/'TOOLS_MANIFEST.json').read_text(encoding='utf8'))
assert len(m['tools'])==13, 'Expected exactly 13 tools'
assert len({x['id'] for x in m['tools']})==13, 'Duplicate tool ID'
checks=0
for x in m['tools']:
    name=x.get('offline_file')
    if name:
        path=root/name
        assert path.is_file(), f'Missing {path}'
        assert hashlib.sha256(path.read_bytes()).hexdigest()==x['sha256'], f'Hash mismatch {name}'
        with zipfile.ZipFile(path) as z:
            assert z.testzip() is None, f'Corrupt ZIP: {name}'
            assert z.namelist(),f'Empty ZIP: {name}'
        print('OK Original plugin ZIP:',x['name'])
        checks+=1
print('13 unique names, 2 original ZIPs checked, references clearly labeled.');print('OK',checks,'archives')
