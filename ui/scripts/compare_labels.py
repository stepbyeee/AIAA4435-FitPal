"""Compare two independently reviewed FitPal label exports for the same local video."""
import argparse
import json
import math
import re
import statistics
from pathlib import Path


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def read_clip(document):
    if not isinstance(document, dict) or document.get('schema') != 'fitpal.manual-labels.v1':
        raise ValueError('Expected a FitPal v1 annotation export.')
    clips = document.get('clips')
    if not isinstance(clips, list) or len(clips) != 1 or not isinstance(clips[0], dict):
        raise ValueError('Each export must contain one clip.')
    c = clips[0]
    if c.get('rater') not in ('A', 'B') or c.get('reviewed') is not True:
        raise ValueError('Use a reviewed A export and a reviewed B export; drafts and consensus versions are not paired.')
    if not re.fullmatch(r'[a-f0-9]{64}', str(c.get('sha256'))) or c.get('exercise') not in ('squat', 'lat-pulldown'):
        raise ValueError('Invalid video digest or exercise.')
    duration = c.get('durationSec')
    entries = c.get('annotations')
    if not finite(duration) or duration <= 0 or not isinstance(entries, list):
        raise ValueError('Invalid duration or missing annotation list.')
    cycles, masked = [], []
    previous = 0
    for index, entry in enumerate(entries, 1):
        if not isinstance(entry, dict):
            raise ValueError(f'Invalid annotation entry {index}.')
        start = entry.get('startSec')
        cycle = entry.get('kind') == 'cycle'
        end = entry.get('topSec' if cycle else 'endSec')
        if not finite(start) or not finite(end) or not previous <= start < end <= duration:
            raise ValueError(f'Out-of-order or out-of-bounds annotation entry {index}.')
        previous = end
        if cycle:
            bottom, status = entry.get('bottomSec'), entry.get('status')
            if not finite(bottom) or not start < bottom < end or status not in ('visible', 'short', 'uncertain'):
                raise ValueError(f'Invalid cycle in annotation entry {index}.')
        else:
            status = entry.get('reason')
            if entry.get('kind') != 'excluded' or status not in ('partial', 'occluded', 'cut'):
                raise ValueError(f'Invalid exclusion in annotation entry {index}.')
        row = {'entry': index, 'startSec': start, 'endSec': end, 'label': status}
        if cycle and status != 'uncertain':
            cycles.append(row)
        else:
            masked.append(row)
    return {'rater': c['rater'], 'sha256': c['sha256'], 'exercise': c['exercise'],
            'duration': duration, 'cycles': cycles, 'masked': masked}


def union_intervals(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def ordered_matches(a, b, tolerance):
    # First maximize one-to-one matches, then minimize the sum of absolute return-time offsets.
    # Rolling score rows plus byte backpointers keep the alignment compact for long videos.
    previous = [(0, 0)] * (len(b) + 1)
    moves = [bytearray(len(b) + 1) for _ in range(len(a) + 1)]
    for i, first in enumerate(a, 1):
        current = [(0, 0)]
        for j, second in enumerate(b, 1):
            best, move = previous[j], 1
            if current[j - 1] > best:
                best, move = current[j - 1], 2
            delta = abs(first['endSec'] - second['endSec'])
            overlap = min(first['endSec'], second['endSec']) > max(first['startSec'], second['startSec'])
            if overlap and delta <= tolerance + 1e-9:
                matched, distance = previous[j - 1]
                candidate = matched + 1, distance - delta
                if candidate >= best:
                    best, move = candidate, 3
            moves[i][j] = move
            current.append(best)
        previous = current
    i, j = len(a), len(b)
    result = []
    while i and j:
        move = moves[i][j]
        if move == 3:
            result.append((a[i-1], b[j-1]))
            i -= 1
            j -= 1
        elif move == 1:
            i -= 1
        else:
            j -= 1
    return result[::-1]


def compare(first, second, tolerance=.5):
    if not finite(tolerance) or tolerance < 0:
        raise ValueError('Return tolerance must be finite and nonnegative.')
    clips = {c['rater']: c for c in (read_clip(first), read_clip(second))}
    if set(clips) != {'A', 'B'}:
        raise ValueError('Use one A export and one B export.')
    a, b = clips['A'], clips['B']
    if a['sha256'] != b['sha256'] or a['exercise'] != b['exercise'] or abs(a['duration'] - b['duration']) > .05:
        raise ValueError('Video SHA-256, exercise and duration must match.')
    shared_duration = min(a['duration'], b['duration'])
    ranges = union_intervals((m['startSec'], min(shared_duration, m['endSec']))
                             for c in clips.values() for m in c['masked'] if m['startSec'] < shared_duration)
    available = max(0, shared_duration - sum(end - start for start, end in ranges))
    kept, skipped = {}, {}
    for rater, c in clips.items():
        kept[rater], skipped[rater] = [], []
        for cycle in c['cycles']:
            if any(start < cycle['endSec'] and cycle['startSec'] < end for start, end in ranges):
                skipped[rater].append(cycle['entry'])
            else:
                kept[rater].append(cycle)
    pairs = ordered_matches(kept['A'], kept['B'], tolerance)
    matches = [{'entryA': x['entry'], 'entryB': y['entry'], 'returnA': x['endSec'], 'returnB': y['endSec'],
                'returnDifferenceSec': round(y['endSec'] - x['endSec'], 3), 'labelA': x['label'], 'labelB': y['label']}
               for x, y in pairs]
    offsets = [y['endSec'] - x['endSec'] for x,y in pairs]
    median = lambda values: round(statistics.median(values), 3) if values else None
    unmatched = {}
    for rater, side in [('A', 0), ('B', 1)]:
        matched_ids = {p[side]['entry'] for p in pairs}
        unmatched[rater] = [c['entry'] for c in kept[rater] if c['entry'] not in matched_ids]
    ca, cb = len(kept['A']), len(kept['B'])
    return {
        'sourceSha256': a['sha256'], 'exercise': a['exercise'], 'returnToleranceSec': tolerance,
        'mutuallyObservableDurationSec': round(available, 3), 'maskedWindowsSec': ranges,
        'uncertainOrExcludedEntries': {r: c['masked'] for r,c in clips.items()},
        'maskedVisibleEntries': skipped,
        'comparableCounts': {'A': ca, 'B': cb, 'absoluteDifference': abs(ca-cb), 'equal': ca == cb if available > 0 else None},
        'matchedCount': len(matches), 'matches': matches, 'onlyA': unmatched['A'], 'onlyB': unmatched['B'],
        'medianAbsoluteReturnDifferenceSec': median([abs(d) for d in offsets]),
        'medianSignedReturnDifferenceSec': median(offsets),
        'matchedLabelDisagreements': sum(m['labelA'] != m['labelB'] for m in matches),
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('first', type=Path)
    parser.add_argument('second', type=Path)
    parser.add_argument('--return-tolerance', type=float, default=.5, help='Maximum difference between matched return times in seconds (default 0.5).')
    args = parser.parse_args()
    try:
        result = compare(json.loads(args.first.read_text()), json.loads(args.second.read_text()), args.return_tolerance)
    except (OSError, ValueError) as exc:
        parser.exit(2, f'{exc}\n')
    print(json.dumps(result, indent=2, ensure_ascii=False))
