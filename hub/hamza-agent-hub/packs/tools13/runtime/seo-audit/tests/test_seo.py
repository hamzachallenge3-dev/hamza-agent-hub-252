import subprocess,sys,json,tempfile,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/seo_audit.py'

def test():
  with tempfile.TemporaryDirectory() as td:
    p=pathlib.Path(td)/'web.html'
    p.write_text('<html lang="en"><head><title>Sample Business</title><meta name="description" content="A test site"><link rel="canonical" href="https://example.com/"><meta property="og:title" content="Sample Business"><script type="application/ld+json">{}</script></head><body><h1>Business</h1><img alt="Nice work" src="a.jpg"><a href="/about">About</a></body></html>')
    r=subprocess.run([sys.executable,str(SCRIPT),'--html-file',str(p)],capture_output=True,text=True)
    assert r.returncode==0,r.stderr+r.stdout
    data=json.loads(r.stdout);assert data['basic_technical_score']==100,data
    p.write_text('<html><body><img src="bad.png"></body></html>')
    r=subprocess.run([sys.executable,str(SCRIPT),'--html-file',str(p)],capture_output=True,text=True)
    assert 0<json.loads(r.stdout)['basic_technical_score']<100 or json.loads(r.stdout)['basic_technical_score']==0
    r=subprocess.run([sys.executable,str(SCRIPT),'--url','http://127.0.0.1/admin'],capture_output=True,text=True)
    assert r.returncode!=0 and 'Not a public' in r.stdout
    print('PASS SEO: valid HTML 100/100; empty/broken warnings; private IP URL blocked')
if __name__=='__main__':test()
