# A different detector on the same FitPal frames

This experiment tests whether a second, pretrained detector can drive FitPal's existing movement logic. It adds no runtime dependency to the workout app. The model is Google's single-person MoveNet Lightning, TensorFlow.js format v4, listed as Apache 2.0 in the Google/Kaggle model entry. The local benchmark uses TensorFlow.js 4.22.0, a single-thread CPU WASM backend and the official pose-detection wrapper 2.1.3 with temporal smoothing. [Model and weights](https://www.kaggle.com/models/google/movenet/tfJs/singlepose-lightning/4) · [Google’s 17-keypoint specification](https://www.tensorflow.org/hub/tutorials/movenet) · [MoveNet JavaScript wrapper](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection/src/movenet)

## What was held constant

The original fixed-frame runner decodes each source at 15 fps and scales its longest side to 640 pixels, retaining aspect ratio. The two development clips produced 360 × 640 PNGs, and both GO4IT windows produced 640 × 361 PNGs. Every detector receives the same timestamped PNG sequence, starts fresh on each clip, and uses the app's actual angle computation, three-cycle calibration, state transitions, visibility checks and wrist/hip return rules. The MoveNet wrapper takes RGB from that frame, tracks a person-centred crop and resamples it to 192 × 192. It returns 17 image-space coordinates and keypoint scores. The adapter normalizes x and y by image width and height.

| Joints | COCO / MoveNet | FitPal / MediaPipe |
| --- | --- | --- |
| Left and right shoulder | 5, 6 | 11, 12 |
| Left and right elbow | 7, 8 | 13, 14 |
| Left and right wrist | 9, 10 | 15, 16 |
| Left and right hip | 11, 12 | 23, 24 |
| Left and right knee | 13, 14 | 25, 26 |
| Left and right ankle | 15, 16 | 27, 28 |

Missing MediaPipe-only joints have zero visibility. The primary benchmark passes MoveNet's raw keypoint score through the unchanged 0.60 visibility gate. The sensitivity run applies a 0.30 MoveNet threshold via a monotonic score transformation that preserves order within and across sides. Neither score has been calibrated against human visibility labels. Lowering the threshold affects the abstention policy and does not change the loaded weights. The two runs use the same first three calibration requirement. Neither trains or fine-tunes a model.

The source manifest identifies two development clips and two held-out windows from one GO4IT recording. The latter show the same performer under different conditions. The coaching window includes a second person and serves as a stress test. [Source identities and human cycle windows](results/replay-sources.json)

## Results

Each count cell gives completed calibration cycles + verified training reps. Coverage is the share of inference frames on which FitPal's active tracking side passed its joint and geometry checks. A partial calibration followed by 0 verified reps means the user could not start a scored set in that run.

| Source | Frames / reference cycles | Score .60 count | .60 coverage | Score .30 count | .30 coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard pulldown (development) | 274 / 5 | 0+0 | 4.7% | 0+0 | 97.8% |
| Goblet squat (development) | 287 / 5 | 0+0 | 96.2% | 3+2 | 100.0% |
| GO4IT rear view | 600 / 7 | 0+0 | 60.7% | 2+0 | 96.7% |
| GO4IT with coach | 627 / 6 | 0+0 | 47.7% | 2+0 | 88.7% |

On the final engine, the rear-view GO4IT clip at .30 yielded two calibration events and zero training events. An earlier diagnostic on the same frames before the camera-cut guard produced three calibration and two training events. After the synthetic camera-cut regression revealed that a jump in both the shoulder and elbow could join an attempt across shots, both threshold runs were repeated on the corrected engine. The JSON reports identify the evaluated source hashes. On the standard pulldown, a .30 gate marked the largely obscured left arm usable on 79.2% of frames while the three calibration cycles never completed. On the development goblet squat, both scored events matched their human windows. Across these four selected clips, .30 matched 2 of 11 post-calibration reference cycles, including the second-person stress case. The .60 run produced zero scored events. These are FitPal pipeline results under the listed score settings and recording conditions, with no independently labelled ground-truth joint visibility. They support retaining Full as the product default; changing detectors would also need a model-specific, independently validated visibility and calibration policy.

Warm browser inference p95 across these clips was 15.5–22.4 ms at .60 and 24.2–31.4 ms at .30 on an Apple M5. Timing includes the per-frame canvas copy, MoveNet cropping, inference, smoothing and conversion to FitPal joints. It excludes PNG decoding, FitPal's counting rules and screen presentation. Other browser jobs ran on the same machine; the timing evidence indicates approximate feasibility. [Primary runs and model hashes](results/movenet-comparison.json) · [Score sensitivity runs](results/movenet-score-sensitivity.json)

## Reproduce

Start the FitPal dev server and prepare the video sources using the main benchmark setup. In `ui`, run the commands below. The setup script verifies SHA-256 for all four downloaded archives and extracts only the named weights and required JavaScript/WASM files to `.benchmark-assets/movenet`. Playwright and Chromium use the same `FITPAL_PLAYWRIGHT` and `FITPAL_CHROME` settings as the MediaPipe benchmark.

```sh
python3 scripts/setup-movenet.py
clips=pulldown.webm,ymove-dumbbell-goblet-squat-202e4f.mp4,go4it-rear.webm,go4it-coach.webm
node scripts/compare-models.mjs --models movenet --clip "$clips" --output ../docs/results/movenet-comparison.json
node scripts/compare-models.mjs --models movenet --movenet-score 0.3 --clip "$clips" --output ../docs/results/movenet-score-sensitivity.json
python3 scripts/score-replay.py ../docs/results/movenet-score-sensitivity.json
```
