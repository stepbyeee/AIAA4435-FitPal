"""Render the synchronized trace from paired-pulldown.mjs on the corresponding real source frames."""
import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__)
for name in ('manifest', 'media', 'trace', 'output', 'font'):
    parser.add_argument('--' + name, type=Path, required=True)
parser.add_argument('--clip', required=True)
parser.add_argument('--title', required=True)
args = parser.parse_args()
clip = next(c for c in json.loads(args.manifest.read_text())['clips'] if c['file'] == args.clip)
if clip.get('usage') == 'local-only':
    raise SystemExit('Select footage cleared for the shareable comparison')
source = args.media / clip.get('asset', clip['file'])
if hashlib.sha256(source.read_bytes()).hexdigest() != clip['sha256']:
    raise ValueError('Source checksum mismatch')
traces = json.loads(args.trace.read_text())
assert len(traces['before']) == len(traces['after']) > 1
fps, pane_w, pane_h = 15, 560, 325
w, h = 1120, 494
fg, hint, mint = '#eff5f4', '#aac0c2', '#64e6ba'
ink = '#122124'
colors = {'left': '#59e7cb', 'right': '#ffbb69'}
fonts = {n: ImageFont.truetype(str(args.font), n) for n in (13, 16, 18, 22, 26)}
histories = {v: {s: deque(maxlen=19) for s in colors} for v in traces}
# ffmpeg's padding keeps portrait / landscape source geometry intact inside each panel.
seek = ['-ss', str(clip['startSec'])] if 'startSec' in clip else []
duration = ['-t', str(clip['durationSec'])] if seek else []
probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0',
    '-show_entries','stream=width,height:stream_side_data=rotation','-of','json',str(source)]))['streams'][0]
sw, sh = probe['width'], probe['height']
if any(abs(row.get('rotation',0)) % 180 == 90 for row in probe.get('side_data_list',[])):
    sw, sh = sh, sw
scale = min(pane_w/sw, pane_h/sh)
dw, dh = round(sw*scale), round(sh*scale)
scale_filter = f'fps={fps},scale=640:640:force_original_aspect_ratio=decrease,scale={dw}:{dh}'
decoder = subprocess.Popen(['ffmpeg','-v','error',*seek,'-i',str(source),*duration,'-an','-vf',scale_filter,
    '-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
encoder = subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}',
    '-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-pix_fmt','yuv420p','-preset','fast','-crf','19',
    '-movflags','+faststart','-metadata',f"comment={clip['source']} | {clip['terms']} | synchronized evaluation overlay",str(args.output)],stdin=subprocess.PIPE)
try:
    for i,(old,new) in enumerate(zip(traces['before'],traces['after'],strict=True)):
        assert old['sec'] == new['sec'] and abs(new['sec']-i/fps)<0.001
        raw = decoder.stdout.read(dw*dh*3)
        frame = Image.frombytes('RGB',(dw,dh),raw)
        image = Image.new('RGB',(w,h),ink)
        draw = ImageDraw.Draw(image)
        draw.text((18,7),'FitPal   /   '+args.title,font=fonts[26],fill=fg)
        draw.text((w-174,15),f"同帧回放    {new['sec']:05.2f} s",font=fonts[16],fill=hint)
        y = 79+(pane_h-dh)//2
        for j,(v,row) in enumerate(zip(('before','after'),(old,new))):
            base = j*pane_w
            x = base+(pane_w-dw)//2
            draw.rounded_rectangle((base+8,44,base+pane_w-8,76),radius=7,fill='#223639')
            draw.text((base+18,46),'改前' if j==0 else '改后 · 自动双侧追踪',font=fonts[22],fill=fg if j==0 else mint)
            image.paste(frame,(x,y))
            for side,col in colors.items():
                pts = row['arms'].get(side)
                trail = histories[v][side]
                if not pts or row['arms'].get(side+'Break'):
                    trail.clear()
                if not pts:
                    continue
                p = [(x+round(a*dw),y+round(b*dh)) for a,b in pts]
                trail.append(p)
                draw.line(p,fill=col,width=2)
                for k in (1,2):
                    if len(trail)>1:
                        draw.line([p0[k] for p0 in trail],fill=col,width=k+1)
                    a,b=p[k]
                    draw.ellipse((a-3,b-3,a+3,b+3),fill=col,outline='white')
            draw.text((base+18,407),f"校准 {row['cal']}/3     正式计数 {row['count']} 下",font=fonts[22],fill=fg if j==0 else mint)
        draw.line((pane_w,44,pane_w,434),fill='#4d6667',width=1)
        draw.text((18,445),'● 左臂',font=fonts[16],fill=colors['left'])
        draw.text((90,445),'● 右臂',font=fonts[16],fill=colors['right'])
        seen=sum(1 for _,top in clip['windows'] if top<=new['sec'])
        draw.text((185,445),f'人工参考已回顶 {seen} 次（前三次校准）',font=fonts[16],fill=hint)
        credit = 'Mixkit · stock video '+clip['file'].split('-')[-1].split('.')[0] if 'mixkit' in clip['source'] else clip['author']
        draw.text((18,473),f'{credit}   /   {clip["source"].split("?")[0][:99]}',font=fonts[13],fill=hint)
        encoder.stdin.write(image.tobytes())
    if decoder.stdout.read(1):
        raise RuntimeError('Trace ended before the selected source video')
finally:
    decoder.stdout.close()
    encoder.stdin.close()
    decode_status, encode_status = decoder.wait(), encoder.wait()
if decode_status or encode_status:
    raise RuntimeError(f'ffmpeg failed ({decode_status}, {encode_status})')
