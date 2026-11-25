"""Fetch exact video fixtures and comparison models for local testing (Python 3)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zlib

UI = Path(__file__).resolve().parents[1]
MANIFEST = UI.parent / 'docs/results/replay-sources.json'
MODEL_HASHES = {
    'lite': '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
    'full': '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
    'heavy': '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b',
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, max_bytes, headers=None):
    request = Request(url, headers={'User-Agent': 'FitPalCourseReplay/1.0 (https://github.com/stepbyeee/AIAA4435-FitPal)', **(headers or {})})
    try:
        result = urlopen(request, timeout=90)
    except HTTPError as err:
        retry = err.headers.get('Retry-After', '')
        if err.code != 429 or not retry.isdigit() or int(retry) > 30:
            raise
        time.sleep(int(retry))
        result = urlopen(request, timeout=90)
    with result as response:
        if headers and 'Range' in headers and response.status != 206:
            raise ValueError('Archive host must support byte ranges')
        data = response.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError('Downloaded asset exceeds the limit')
        return data


def archive_member(clip):
    # Read the local ZIP member record and payload only. No full archive allocation.
    start, size = clip['offset'], clip['compressedBytes']
    budget = size + 1024
    payload = fetch(clip['archive'] + '?member=' + str(start), budget,
                    {'Range': f'bytes={start}-{start+budget-1}'})
    signature, _, flags, method, _, _, crc, packed, _, name_len, extra_len = struct.unpack_from('<IHHHHHIIIHH', payload)
    name = payload[30:30+name_len].decode('utf8')
    if signature != 0x04034b50 or flags & 9 or method not in (0, 8) or packed != size or name != clip['member']:
        raise ValueError('Unexpected ZIP member header')
    beginning = 30 + name_len + extra_len
    data = payload[beginning:beginning+size]
    if method == 8:
        data = zlib.decompress(data, -15)
    if zlib.crc32(data) != crc or f'{crc:08x}' != clip['crc32']:
        raise ValueError('Archive CRC mismatch')
    return data


def install(path, checksum, get_data):
    if path.is_file() and sha256(path.read_bytes()) == checksum:
        print('Verified', path.name)
        return
    data = get_data()
    if sha256(data) != checksum:
        raise ValueError(f'Unexpected content for {path.name}; check the publisher or pinned source')
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        handle.write(data)
        temporary = Path(handle.name)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    print('Installed', path.name)


def pulldown_fixture(clip):
    if 'sourceSpanSec' not in clip:
        return fetch(clip['download'], 90_000_000)
    start, end = clip['sourceSpanSec']
    # Encoder differences across FFmpeg/libx264 builds are caught by install().
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / 'excerpt.mp4'
        if 'sourceSha256' in clip:
            # A single verified download avoids repeated range requests to short sources.
            data = fetch(clip['download'], 90_000_000)
            if sha256(data) != clip['sourceSha256']:
                raise ValueError(f"Unexpected original for {clip['file']}")
            original = Path(directory) / 'original'
            original.write_bytes(data)
            source_options = ['-i', str(original)]
        else:
            # Seek long archive films by range; the competition original is 1.45 GB.
            source_options = ['-rw_timeout', '90000000', '-i', clip['download']]
        subprocess.run([
            'ffmpeg', '-nostdin', '-v', 'error', '-ss', str(start),
            *source_options, '-t', str(end - start),
            '-map', '0:v:0', '-an', '-c:v', 'libx264', '-threads', '2',
            '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart', str(output),
        ], check=True)
        return output.read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-dataset', action='store_true',
                        help='Also fetch the separately indexed workout-vids clips for local evaluation. Redistribution rights unverified.')
    parser.add_argument('--app-only', action='store_true', help='Only fetch the three featured UI videos.')
    parser.add_argument('--supplementary', action='store_true', help='Use the independently annotated two-window gym squat supplement.')
    parser.add_argument('--seated-row', action='store_true', help='Fetch only the row experiment and its held-out stress clips.')
    parser.add_argument('--pulldown-holdout', action='store_true',
                        help='Fetch both held-out pulldown cohorts. Time excerpts use FFmpeg 8.1/libx264.')
    args = parser.parse_args()
    if args.pulldown_holdout:
        if args.seated_row or args.supplementary or args.app_only or args.include_dataset:
            parser.error('--pulldown-holdout selects a separate fixture set')
        for name, folder in [
            ('pulldown-r2-unseen-sources.json', 'pulldown-r2-unseen'),
            ('pulldown-r2-unseen-stock-sources.json', 'pulldown-r2-unseen'),
            ('pulldown-r3-reserve-sources.json', 'pulldown-r3-unseen'),
        ]:
            for clip in json.loads(MANIFEST.with_name(name).read_text())['clips']:
                path = UI / '.benchmark-assets' / folder / clip['file']
                install(path, clip['sha256'], lambda: pulldown_fixture(clip))
        return
    if args.seated_row:
        if args.supplementary or args.app_only or args.include_dataset:
            parser.error('--seated-row selects a separate fixture set')
        existing = {row['sha256']: row for row in json.loads(MANIFEST.read_text())['clips']}
        for manifest_name in ('seated-row-sources.json', 'seated-row-holdout-sources.json', 'seated-row-unseen-sources.json'):
            for clip in json.loads(MANIFEST.with_name(manifest_name).read_text())['clips']:
                upstream = existing.get(clip['sha256'], clip)
                url = upstream.get('download')
                if clip['id'] == 'ymove-side':
                    url = 'https://raw.githubusercontent.com/ymove-app/exercise-api/main/free-videos/seated-cable-row-close-v-bar-bccf4f.mp4'
                directory = UI / ('public/demo' if clip.get('appDemo') else '.benchmark-assets/video')
                install(directory / clip['file'], clip['sha256'], lambda: fetch(url, upstream.get('maxBytes', 35_000_000)))
        return
    manifest = MANIFEST.with_name('squat-supplement-sources.json') if args.supplementary else MANIFEST
    for clip in json.loads(manifest.read_text())['clips']:
        if args.app_only and not clip['appDemo']:
            continue
        if 'archive' in clip and not args.include_dataset:
            continue
        directory = UI / ('public/demo' if clip['appDemo'] else '.benchmark-assets/video')
        install(directory / clip.get('asset', clip['file']), clip['sha256'],
                lambda: archive_member(clip) if 'archive' in clip else fetch(clip['download'], clip.get('maxBytes', 90_000_000)))
    if not args.app_only:
        for model, checksum in MODEL_HASHES.items():
            file = f'pose_landmarker_{model}.task'
            directory = UI / ('public/mediapipe' if model == 'full' else '.benchmark-assets/models')
            url = f'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{model}/float16/1/{file}'
            install(directory / file, checksum, lambda: fetch(url, 35_000_000))


if __name__ == '__main__':
    main()
