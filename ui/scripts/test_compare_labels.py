import json
import unittest
from pathlib import Path

from compare_labels import compare

SHA = 'a' * 64


def clip(rater, entries, **changes):
    return {'schema': 'fitpal.manual-labels.v1', 'clips': [{
        'file': 'P01.webm', 'exercise': 'squat', 'sha256': SHA, 'rater': rater,
        'durationSec': 20, 'reviewed': True, 'annotations': entries, **changes,
    }]}


def rep(start, end, status='visible'):
    return {'kind': 'cycle', 'startSec': start, 'bottomSec': (start + end) / 2, 'topSec': end, 'status': status}


class ComparisonTest(unittest.TestCase):
    def test_missing_extra_and_offsets_use_event_matching_even_if_counts_agree(self):
        a = clip('A', [rep(0, 2), rep(3, 5), rep(8, 10), rep(11, 13)])
        b = clip('B', [rep(0, 2.1), rep(5.4, 6.9), rep(8, 9.7, 'short'), rep(11, 13.4)])
        result = compare(b, a, .5)
        self.assertTrue(result['comparableCounts']['equal'])
        self.assertEqual(result['onlyA'], [2])
        self.assertEqual(result['onlyB'], [2])
        self.assertEqual(result['matchedCount'], 3)
        self.assertAlmostEqual(result['medianAbsoluteReturnDifferenceSec'], .3)
        self.assertAlmostEqual(result['medianSignedReturnDifferenceSec'], .1)
        self.assertEqual(result['matchedLabelDisagreements'], 1)

    def test_uncertain_and_excluded_regions_suppress_both_raters_and_touching_is_allowed(self):
        a = clip('A', [rep(0, 2), rep(2, 4), {'kind': 'excluded', 'startSec': 5, 'endSec': 7, 'reason': 'cut'}])
        b = clip('B', [rep(0, 2), rep(2, 4, 'uncertain'), rep(5, 7)])
        result = compare(a, b)
        self.assertEqual(result['matchedCount'], 1)
        self.assertEqual(result['maskedVisibleEntries'], {'A': [2], 'B': [3]})
        self.assertEqual(result['mutuallyObservableDurationSec'], 16)
        self.assertEqual(result['onlyA'], [])
        self.assertEqual(result['onlyB'], [])

    def test_no_overlap_is_unscored_and_fully_reviewed_static_can_agree_at_zero(self):
        none = compare(clip('A', [{'kind':'excluded', 'startSec':0,'endSec':20,'reason':'occluded'}]), clip('B', []))
        self.assertIsNone(none['comparableCounts']['equal'])
        self.assertIsNone(none['medianAbsoluteReturnDifferenceSec'])
        self.assertTrue(compare(clip('A', []), clip('B', []))['comparableCounts']['equal'])

    def test_chooses_closest_ordered_match_and_respects_tolerance(self):
        # A2 and B1 overlap and have the closest eligible return times.
        a = clip('A', [rep(0, .5), rep(.5, 1.0)])
        b = clip('B', [rep(.45, .85)])
        self.assertEqual(compare(a, b, .5)['matches'][0]['entryA'], 2)
        self.assertEqual(compare(a, b, .1)['matchedCount'], 0)

    def test_documented_synthetic_example_reproduces_from_both_exports(self):
        example_path = Path(__file__).resolve().parents[2] / 'docs/results/label-agreement-synthetic.json'
        example = json.loads(example_path.read_text())
        result = compare(example['exampleExports']['A'], example['exampleExports']['B'])
        self.assertEqual(json.loads(json.dumps(result)), example['comparison'])
        self.assertEqual(result['medianAbsoluteReturnDifferenceSec'], .15)

    def test_rejects_mismatched_clips_raters_drafts_and_invalid_timestamps(self):
        a = clip('A', [])
        for b in [clip('A', []), clip('B', [], sha256='b'*64), clip('B', [], exercise='lat-pulldown'),
                  clip('B', [], reviewed=False), clip('B', [rep(3, 2)]), clip('B', [rep(0, 2), rep(1, 3)])]:
            with self.assertRaises(ValueError): compare(a,b)


if __name__ == '__main__':
    unittest.main()
