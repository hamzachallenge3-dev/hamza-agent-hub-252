#!/usr/bin/env python3
"""Original CPU-only companion for Lapian Notes: frame pack, not automatic AI analysis."""
import argparse, json, math, subprocess, tempfile, zipfile
from pathlib import Path


def ffprobe(path):
    cp=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',str(path)],capture_output=True,text=True,timeout=30,check=True)
    info=json.loads(cp.stdout)
    videos=[s for s in info.get('streams',[]) if s.get('codec_type')=='video']
    if not videos:raise ValueError('No video stream')
    duration=float(info.get('format',{}).get('duration',0))
    if duration<=0 or not math.isfinite(duration):raise ValueError('Invalid video duration')
    return {'duration_seconds':round(duration,3),'width':videos[0].get('width'),'height':videos[0].get('height')}


def create_pack(video,out,interval=2,max_frames=36,subtitle=None):
    video=Path(video).resolve();out=Path(out).resolve()
    if not video.is_file():raise FileNotFoundError(video)
    if not 1<=interval<=1800 or not 1<=max_frames<=120:raise ValueError('Unsafe interval/max_frames')
    meta=ffprobe(video)
    samples=[min(i*interval, max(0,meta['duration_seconds']-0.05)) for i in range(max_frames) if i*interval<meta['duration_seconds']]
    out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='lapian-') as td:
        directory=Path(td)
        images=[]
        for i,t in enumerate(samples):
            name=f'frames/frame_{i+1:04d}_at_{t:09.2f}s.jpg'
            jpg=directory/name;jpg.parent.mkdir(parents=True,exist_ok=True)
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(t),'-i',str(video),'-frames:v','1','-q:v','4','-y',str(jpg)],timeout=40,check=True,capture_output=True)
            if not jpg.is_file() or jpg.stat().st_size<30:raise RuntimeError('Frame extraction failed')
            images.append((name,jpg))
        meta.update({'source_filename':video.name,'frame_interval_seconds':interval,'frames_extracted':len(images),'sampling_limited':len(images)<math.ceil(meta['duration_seconds']/interval),'analysis_status':'Frames only; no AI model was called'})
        instruction="""# Film study task (only provided frames/subtitles, never guess unseen content)\nCreate an editable story timeline, shot notes, mood/engagement curve and factual evidence tied to the exact timestamps in metadata.json. Clearly distinguish observations from inferences, never claim exhaustive frame-by-frame coverage if samples were capped. Return JSON containing segments [{start_s,end_s,visible_action,mood,reasoning_confidence}], storylines [] and summary.\n"""
        with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr('metadata.json',json.dumps(meta,ensure_ascii=False,indent=2))
            z.writestr('prompt.md',instruction)
            for name,p in images:z.write(p,name)
            if subtitle:
                sub=Path(subtitle).resolve()
                if not sub.is_file() or sub.suffix.lower() not in ('.srt','.vtt','.ass'):raise ValueError('Subtitle must be valid SRT/VTT/ASS')
                z.write(sub,'subtitles/'+sub.name)
    return {'ok':True,'output':str(out),'metadata':meta,'warning':'This prepares samples for a model; it does not itself perform AI scene/emotion analysis or run upstream Lapian UI.'}


def main():
    p=argparse.ArgumentParser(description='Local CPU-only companion for Lapian Notes')
    p.add_argument('video');p.add_argument('--out',required=True);p.add_argument('--interval',type=int,default=2);p.add_argument('--max-frames',type=int,default=36);p.add_argument('--subtitle')
    a=p.parse_args()
    try:print(json.dumps(create_pack(a.video,a.out,a.interval,a.max_frames,a.subtitle),ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'ok':False,'error':str(e),'error_type':type(e).__name__}));raise SystemExit(2)
if __name__=='__main__':main()
