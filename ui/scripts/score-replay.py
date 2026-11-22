"""Match calibration and scored events separately. Usage: python3 scripts/score-replay.py RESULTS.json"""
import argparse
import json
from pathlib import Path

MARGIN = 0.35  # Covers 2 Hz visual inspection granularity and threshold timing.


def match(windows, events):
    remaining = list(events)
    hits = []
    missed = []
    for bottom, top in windows:
        event = next((sec for sec in remaining if bottom <= sec <= top + MARGIN), None)
        if event is None:
            missed.append(top)
        else:
            remaining.remove(event)
            hits.append({'referenceTopSec': top, 'observedSec': event})
    return {'matched': hits, 'missedTopSec': missed, 'unmatchedSec': remaining}


def score(clips, runs):
    rows = []
    for r in runs:
        c = clips[r['clip']]
        windows = c['windows']
        result = {'clip': r['clip'], 'model': r['model']}
        if r.get('sourceSha256') and r['sourceSha256'] != c['sha256']:
            raise ValueError('Reference and evaluated source hash disagree')
        if windows is None:
            result.update(eligible=False, reason='no reliable cycle reference')
        else:
            if len(windows) != c['visualCycles']:
                raise ValueError(f"Mismatch in annotated cycle count for {c['file']}")
            calibration = match(windows[:3], r['calibrationEvents'])
            training = match(windows[3:], r['verifiedEvents'])
            result.update(eligible=len(windows) > 3,
                          calibration=calibration, training=training,
                          calibrationOnFirstThree=len(windows) >= 3 and len(calibration['matched']) == 3)
        rows.append(result)
    return rows


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('results', type=Path)
    reference = parser.add_mutually_exclusive_group()
    reference.add_argument('--supplementary', action='store_true')
    reference.add_argument('--manifest', type=Path, help='Use a private reference file exported from the local annotation screen.')
    args = parser.parse_args()
    name = 'squat-supplement-sources.json' if args.supplementary else 'replay-sources.json'
    manifest = args.manifest or (root / 'docs/results' / name)
    clips = json.loads(manifest.read_text())['clips']
    rows = score({c['file']: c for c in clips}, json.loads(args.results.read_text())['runs'])
    print(json.dumps({'matching': f'One-to-one, bottom <= event <= reference top + {MARGIN}s. Missing calibration retains all uncounted training cycles as misses.', 'scores': rows}, indent=2))
