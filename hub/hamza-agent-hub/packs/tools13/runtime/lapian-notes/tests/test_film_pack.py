import json, subprocess,sys,tempfile,zipfile,pathlib
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts'/'film_pack.py'
def test():
    with tempfile.TemporaryDirectory() as td:
        d=pathlib.Path(td);video=d/'sample.mp4';dst=d/'notes.zip'
        ff=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=128x72:rate=2','-t','3','-c:v','mpeg4','-y',str(video)],capture_output=True,text=True)
        assert ff.returncode==0,ff.stderr
        r=subprocess.run([sys.executable,str(SCRIPT),str(video),'--out',str(dst),'--interval','1','--max-frames','4'],text=True,capture_output=True)
        assert r.returncode==0,r.stderr+' '+r.stdout
        o=json.loads(r.stdout);assert o['ok'] and o['metadata']['frames_extracted']==3,o
        with zipfile.ZipFile(dst) as z:
            names=z.namelist();assert len([n for n in names if n.endswith('.jpg')])==3,names
            assert 'prompt.md' in names and 'metadata.json' in names
            assert 'no AI model was called' in z.read('metadata.json').decode()
        p=subprocess.run([sys.executable,str(SCRIPT),str(d/'nope.mp4'),'--out',str(dst)],capture_output=True,text=True)
        assert p.returncode!=0
        print('PASS lapian: video->3 JPG timestamps + ZIP, metadata, prompt; invalid input rejected')
if __name__=='__main__':test()
