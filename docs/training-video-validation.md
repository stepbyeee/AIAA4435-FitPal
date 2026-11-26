# Expanded recorded-video validation

This report preserves the pre-repair result. The latest [recorded-pose recovery](recording-recovery.md) reaches 22/36 on the same development cohort and reports a separate four-source comparison. The subsequent [recognition repair and six-source held-out check](recognition-reliability.md) recovered two development repetitions (20/36) but did not improve held-out matching (2/10 in both versions).

The application processed all 18 declared recordings without a runtime/UI-check error, but matched only 18 of 36 post-calibration reference repetitions. This is evidence of substantial recognition failure, not a broad accuracy claim. Nine clips entered set review; nine ended before completing calibration. Four of those nine contain at most three reference cycles and cannot supply formal training repetitions; one close-up has no reliable count reference. The remaining failures are retained in the scored denominator.

## Selection and reference limits

The [source manifest](results/training-video-cohort-sources.json) contains 12 pulldown and six squat clips, including the two existing app controls and 16 additional known project clips. Sources span Dynamic Fitness, Life Time, Future Fitness, City of Adelaide, Mixkit, Pexels, YMove and Wikimedia-hosted videos. The choice was frozen before inference. These are reused project sources, not an unseen dataset or 18 independent participants. The two Szat excerpts share an original video; YMove clips may share performers. Media were retained for local evaluation, not added to the repository.

Reference bottom/return windows come from existing project single-review/agent annotations, without independent human verification. The first three complete reference cycles are reserved for calibration. Thirteen clips contain 36 subsequent reference cycles, four have zero subsequent cycles, and one close-up is unscorable. The unscorable clip remains in the runtime and abstention report. A completion matches at most one reference interval from the labelled bottom through return plus 0.35 seconds. This is a provisional reference-matching measure, not clinical validation or population accuracy.

Original acquired framing and playback time were retained. Declared excerpts were prepared with FFmpeg 7.0.2, one encoder thread, libx264 veryfast CRF 19 and no audio; other files were copied without further transformation. Prepared-file and original-file hashes are recorded separately. Historical excerpts made with different encoders or resolutions are not byte-identical controls, so no paired improvement against those historical scores is claimed.

## Application path and count audit

Each clip was uploaded through Home and analyzed with the current 15 Hz source-position delivery, CPU pose fallback and unchanged perception thresholds. The evaluator records the actual pose callbacks delivered to the application. All source gaps were below 67 ms. Completed sets were checked for count/review/export consistency, all four coach answers, measurement eligibility, source-linked seeking where available, no persistent replay rewards and mobile width. Clips ending in calibration were retained as that outcome, not reported as completed set reviews. An explicit pose-model error is a runtime failure, not an ordinary calibration miss.

The [counter audit](results/training-video-counter-audit.json) then feeds these exact captured frames through the unchanged counter, including the calibration handoff frame. Calibration outcome and verified count must equal the actual UI for every clip before source-time completion events are matched. This prevents a confirmed count without retained wrist curves from being silently dropped or automatically called a false positive. All 18 UI outcomes reproduced. The earlier trace-based counts remain in the [full report](results/training-video-cohort-check.json) for transparency; the audited count matches are primary.

The first two worker groups did not embed source hashes; the later groups did. The audit records the counter dependencies it actually replayed. No perception, analytic or reward policy changed during this run. Rest-plan formatting and shorter reward labels were checked separately in the final production build; the cohort Session hash predates the reward-label shortening.

## Findings

Six of the 13 clips with formal reference movements matched every formal repetition, one matched partially and six matched none. The aggregate is 18 matched, 18 missed and zero unmatched confirmed events against the available reference windows. Nine clips failed to finish calibration; calling all 18 successful because their pages rendered would conceal this result.

The four previously reserved pulldown clips matched 1 of 8 formal reference repetitions: Dynamic 0/2, Life Time 0/2, Future Fitness 1/2 and Adelaide 0/2. Dynamic completed calibration only at 16.40 s, near the fourth reference return; the portrait Pexels 35585697 clip completed it at 14.60 s, near the eighth return, leaving no formal repetitions. Life Time and Adelaide ended at two recognized calibration cycles, Mixkit at zero, and the front-oblique Szat squat at one. The side-view Szat excerpt, in contrast, matched all six formal cycles. These diagnoses identify calibration/view dependence; they do not establish that simply lowering thresholds is a valid fix.

Eighteen confirmed repetitions across seven clips had eligible phase measurements. Their exports, nonnegative phase values and duration decomposition were consistent. This checks delivery and arithmetic, not agreement with independent frame-by-frame timing labels. Only three repetitions, all in the existing GO4IT control, produced bilateral measurements. None of the 16 additional clips produced bilateral timing. The new recordings therefore do not validate broad bilateral availability or accuracy. Missing bilateral evidence remained null instead of becoming a purported zero lag.

All nine completed-calibration clips exercised the coach and set-report flow; eight with recorded attempts exercised source review. Replay did not write personal progress in any of the 18 contexts. These are software-behavior results, separate from the recognition failures and from user benefit. No real-camera participant study was conducted.

## Reproduction

From `ui/`, provide local model assets and the prepared files matching the source manifest, then run a Vite development server. `check-real-video-cohort.mjs` accepts a clip-array manifest, a media directory and an output directory; it uses `FITPAL_URL` and optionally `FITPAL_CHROME`. Split the declared array by `index % 4` into groups 0–3 and write outputs under `expanded-0` through `expanded-3`. Each group used bounded CPU resources. Use a separate Vite cache when running independent workspaces concurrently.

```sh
node scripts/check-real-video-cohort.mjs group-0.json /path/to/prepared-media /path/to/results/expanded-0
# Repeat for groups 1, 2 and 3 with the same source manifest and build.
node scripts/audit-cohort-counts.mjs ../docs/results/training-video-cohort-sources.json /path/to/results /path/to/counter-audit.json
```

The [next-set check](results/next-set-check.json) is separate: 174 unit tests and the production build passed, followed by keyboard clearing/decimal-entry checks and a three-set camera-stream scenario with targets 10/8/6, preserved per-set plans and desktop/mobile styling. It uses prerecorded video as a camera stream; it does not establish live-camera throughput.

The next empirical priority is calibration and counting on independent, fixed-view recordings with human-reviewed boundaries, followed by independently labelled bilateral crossing times and participant comparison of the old/new interaction. Reward thresholds and wardrobe currencies remain unchanged pending separate product decisions.
