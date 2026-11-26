"""Check actual packaged video seeks and the classroom flow; run on a compute host."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('archive', type=Path)
parser.add_argument('--artifacts', required=True)
parser.add_argument('--http-only', action='store_true')
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix='fitpal-demo-check-') as folder:
    with zipfile.ZipFile(args.archive) as archive:
        archive.extractall(folder)
    root = Path(folder) / 'FitPal'
    server = subprocess.Popen(['python3', str(root / 'start-fitpal.py'), '--port', '0', '--no-open'],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        banner = server.stdout.readline()
        origin = re.search(r'http://127\.0\.0\.1:\d+', banner).group()
        path = '/showcase/go4it-rear.mp4'
        source = (root / 'site' / path.lstrip('/')).read_bytes()
        for value, start, end in [('bytes=0-31', 0, 31), ('bytes=5000-5099', 5000, 5099),
                                  ('bytes=-16', len(source)-16, len(source)-1),
                                  (f'bytes={len(source)-16}-', len(source)-16, len(source)-1)]:
            with urlopen(Request(origin + path, headers={'Range': value}), timeout=5) as response:
                assert response.status == 206, (value, response.status)
                assert response.headers['Content-Range'] == f'bytes {start}-{end}/{len(source)}'
                assert response.read() == source[start:end+1]
        try:
            urlopen(Request(origin + path, headers={'Range': f'bytes={len(source)}-'}), timeout=5)
            raise AssertionError('Out-of-bounds range was accepted')
        except HTTPError as error:
            assert error.code == 416
            assert error.headers['Content-Range'] == f'bytes */{len(source)}'
        with urlopen(Request(origin + path, method='HEAD', headers={'Range': 'bytes=0-31'}), timeout=5) as response:
            assert response.status == 200 and int(response.headers['Content-Length']) == len(source)
            assert response.read() == b''
        with urlopen(origin + path, timeout=5) as response:
            assert response.status == 200 and response.read() == source
        print('PASS: packaged full, bounded, open-ended, suffix, invalid and HEAD responses', flush=True)
        if not args.http_only:
            subprocess.run(['node', 'scripts/check-session.mjs', '--only', 'facilitator', '--artifacts', args.artifacts],
                           env={**os.environ, 'FITPAL_URL': origin}, check=True)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
