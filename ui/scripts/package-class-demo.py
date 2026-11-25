"""Pack a built, local-only class demo with its runtime, licensed examples and attributions."""
import argparse
from pathlib import Path
import zipfile

ui = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
args = parser.parse_args()
dist = ui / 'dist'
if {p.name for p in dist.iterdir()} != {'assets','index.html','mediapipe','showcase'}:
    raise SystemExit('Run npm run setup:pose and npm run build first, then package the clean production output.')
for asset in ['mediapipe/pose_landmarker_full.task', 'showcase/go4it-rear.mp4','showcase/goblet-squat.mp4','showcase/go4it-seated-row.mp4']:
    if not (dist/asset).is_file():
        raise SystemExit('Missing built asset: '+asset)

launcher = '''from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import webbrowser

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=8765)
parser.add_argument('--no-open', action='store_true')
args = parser.parse_args()
site = Path(__file__).resolve().parent / 'site'
server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(SimpleHTTPRequestHandler, directory=str(site)))
url = 'http://127.0.0.1:' + str(server.server_port) + '/'
print('FitPal · ' + url + '  (Ctrl+C to stop)', flush=True)
if not args.no_open:
    webbrowser.open(url)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
'''
readme = '''FitPal 课堂离线演示

解压后，在本目录运行 python3 start-fitpal.py（Windows 可用 py start-fitpal.py）。
Mac 上也可以双击 Start FitPal.command。浏览器会打开 http://127.0.0.1:8765/。
需要 Python 3 和现代浏览器。启动后所有模型、字体与示范都从本机提供，无需安装 npm。

首页「录像回放」可体验高位下拉和深蹲，选「画中分析」看叠加在视频上的轨迹和指标。
首页「坐姿划船 → 侧面计数 · 实验」包含另一个真实视频。摄像头由使用者主动开启。
课堂试测、匿名评分汇总和本地视频标注在「课堂试测」。实时反馈默认采用本地规则。
结束演示时在终端按 Ctrl+C。同一浏览器及同一端口用于保存训练记录。
完整视频来源与授权见 site/showcase/CREDITS.txt，其他组件和素材署名见 notices/。
'''
notices = '''MediaPipe Tasks Vision runtime and Pose Landmarker Full, The MediaPipe Authors / Google LLC. Apache 2.0.
https://github.com/google-ai-edge/mediapipe
https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf
The unmodified official FP16 v1 Full model is bundled, SHA-256 5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1.
React, React DOM and Scheduler: Meta Platforms, Inc. and affiliates. See the included MIT licenses.
Inter variable font: see the included SIL Open Font License.
The source and adaptation details for the character are in bones-CREDITS.md.
'''
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for f in sorted(dist.rglob('*')):
        if f.is_file():
            z.write(f, 'FitPal/site/' + f.relative_to(dist).as_posix())
    z.writestr('FitPal/start-fitpal.py', launcher)
    z.writestr('FitPal/先读我.txt', readme)
    z.writestr('FitPal/notices/README.txt', notices)
    script = zipfile.ZipInfo('FitPal/Start FitPal.command')
    script.create_system = 3
    script.external_attr = 0o100755 << 16
    z.writestr(script, '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec python3 start-fitpal.py\n')
    for package,name in [('react','react'),('react-dom','react-dom'),('scheduler','scheduler'),('@fontsource-variable/inter','inter'),('playwright','Apache-2.0')]:
        z.write(ui/'node_modules'/package/'LICENSE', 'FitPal/notices/'+name+'.txt')
    z.write(ui/'src/assets/bones/CREDITS.md','FitPal/notices/bones-CREDITS.md')
print(args.output, args.output.stat().st_size, 'bytes')
