# Interactive training experience

FitPal now connects a chosen training goal to live evidence, an inspectable set review, one next-set focus, bounded rewards and saved progress. This layer consumes the existing perception outputs; it does not replace the calibrated counters or claim a newly trained pose model.

## Walkthrough

On the home screen, open **训练计划**. Choose 1–8 sets, 1–30 repetitions, an optional self-reported load, and a focus: personal range, return timing or experimental bilateral observation. Range remains the default. A selected repetition count is a target, not an automatic stop or a reason to continue beyond comfort. The original three calibration repetitions remain separate from training.

During training, the quiet view retains the counter. **分析** and **画中分析** add projected joint angles, their signed rates in degrees per second, completed-repetition return time and bottom dwell. Existing wrist/hip trails and angle curves remain available. The rate is an image-plane angle derivative, not bar speed in metres per second. Load is never inferred or verified from the picture. A stalled, paused or unavailable stream clears the new live readings until a fresh frame arrives.

After a set, select a repetition to inspect its range, angle curve, movement trail and bilateral evidence. Uploaded or included video has a separate review player: selecting a repetition and scrubbing its time changes only that player. The original source timestamp identifies the frame. Camera sessions do not record video, so their review contains curves but no purported source footage.

The set overview shows median cycle/return time, return-time variability, median personal range, selected-side visibility and experimental bilateral timing. The coach offers four evidence-bound questions: what to focus on next, how timing varied, what bilateral evidence means and why EXP was awarded. Local speech is optional and only offered when a local Chinese voice is available. Existing optional local-model wording remains separate; the question answers do not invoke a remote model or produce unsupported diagnoses.

Between sets, choose the next focus. Each completed set keeps the plan that actually applied to it. Comparison requires at least three measured repetitions in each set, at least 90% selected-side frame coverage, comparable neutral-position view signatures, unchanged goal/load and no material range reduction. A longer return time is a change, not inherently an improvement.

History retains compact set summaries and plans alongside the original repetitions, EXP, levels and equipment. Existing history remains readable; malformed optional measurements are discarded without erasing valid old progress. Explicit downloads export either a session report or history. They contain no video, raw landmarks or replayable progress credits. Storage errors are visible and retryable. Disabling local summaries prevents future persistent plan/history updates; clearing local progress also clears the plan.

## Measurements and limits

Timing starts at the counter's tracked movement onset. Return time ends when the counter confirms return. These are observed angle phases, not anatomical contraction phases. Bottom dwell is the contiguous interval within three projected degrees of the observed minimum. Detailed curves retain the existing 32-repetition limit; compact measurements are captured as each attempt settles so older metrics do not disappear with evicted curves.

Bilateral timing is the right-minus-left crossing time of each side's own return-angle midpoint. Positive means the right side crossed later. Both sides must remain visible, show sufficient excursion, and have continuous synchronized samples and a compatible viewing orientation. No bilateral grade, strength imbalance claim, medical inference or EXP is generated. The orientation heuristic and thresholds still require validation against independent real-video labels. A missing value is deliberate abstention, not a zero delay.

Selected-side coverage is a fraction of processed frames, not elapsed time and not bilateral confidence. Saved cross-session charts show descriptive values only: uncontrolled cameras, targets and load do not support causal improvement claims.

## Reward policy

Each verified repetition contributes one base EXP, preserving the existing count and equipment progression. Each set has one quality pool of at most 5 EXP and one improvement pool of at most 5 EXP. Adding displays does not multiply rewards.

All three observation focuses retain the original range quality rule: at least eight verified repetitions meet the personal range target, comprising at least 80% of all attempts. Focus and user-selected timing targets only affect displays and suggestions; they cannot change EXP. Short planned sets can earn base EXP but do not satisfy this eight-repetition quality minimum. The original improvement reward remains tied to resolving the previous range or visibility issue, not a change in timing.

Replay and classroom-study sessions do not write personal training progress. The original classroom study conditions and settlement policy stay isolated from this product extension.

## Validation

Run from `ui/` in an environment with Node and the local pose/demo assets:

```sh
npm test -- --maxWorkers=1
npm run build
node scripts/check-training-metrics.mjs analytic-timing.json
npm run preview -- --host 127.0.0.1
# In a second shell, set FITPAL_CHROME if a browser executable is not installed by Playwright.
node scripts/check-training-experience.mjs artifacts/training-experience
# For a headless compute node without a hardware WebGL device:
FITPAL_CPU_ONLY=1 FITPAL_REPLAY_RATE=0.25 node scripts/check-training-experience.mjs artifacts/training-experience-cpu
```

The analytic sweep uses known angle trajectories across sampling rates, movement durations, signed delays, angular noise and missing-side observations. It verifies the arithmetic and abstention behavior, not the accuracy of the pose model. Browser checks exercise the real bundled clips, source-linked seeking, export, history and responsive layouts. These are different evidence levels and must be reported separately.

### Recorded checks on 2026-11-25

The final unit suite passed 168 tests across 30 files and the production build passed. Seven existing browser scenarios also passed: mobile overlay/side selection, demo exit, manual history, privacy, camera denial, pilot summary and facilitator flow. Reward regressions cover unchanged EXP across focus/target choices and missing timing measurements. Per-repetition review also withholds phase timing when the new analyzer rejects sparse samples; the classroom fallback remains unchanged.

The [analytic sweep](results/training-metrics-analytic.json) contains 270 deterministic angle-input cases and the analyzer SHA-256. Across 45 complete cases per noise level, mean absolute lag error was 4.4 ms without noise, 17.4 ms at 1 degree noise and 38.9 ms at 3 degrees noise. All 135 missing-side cases abstained. These figures describe arithmetic on synthetic angles, not pose-estimation accuracy.

The [browser flow report](results/training-experience-check.json) records CPU-only Chromium 151 with video playback at 0.25×: four pulldown repetitions and two squat repetitions, source seeking, all four coach questions, report export, history, responsive layouts, pause invalidation and two simulated-camera sets including storage failure/retry. Source timestamps, rather than wall-clock playback time, drive replay metrics. The simulated-camera trace was too sparse for phase timing; those fields correctly remained unavailable. A final focused browser check confirmed all observation explanations, the unchanged-EXP notice, matching original card backgrounds and mobile width after the final copy/style update.

The [natural-speed comparison](results/training-runtime-profile.json) is a single paired run, not a statistical performance benchmark. The baseline and extended version both processed 133 frames and counted three of the expected four repetitions on the same CPU-only compute environment; median callback work was 299.0 and 297.4 ms respectively. Slow-playback success therefore does not establish real-time accuracy. A later UI walkthrough at 0.25× recovered three rather than four repetitions; the earlier successful replay is therefore not evidence of repeatable count accuracy on this environment. Device-level repeatability checks and independently labelled bilateral video remain required.

## Next empirical evaluation

Keep the existing four-condition classroom pilot unchanged. Evaluate this extension separately: counter-only baseline versus goal → evidence review → next-set focus, with balanced order and identical exercise/load where appropriate. Record target understanding, ability to locate the relevant repetition, chosen next-set focus, interruption, perceived control and willingness to continue. Timing/range changes are secondary descriptive measures and require comparable evidence. Record which recommendations were actually read, rather than treating display as compliance.

For bilateral validation, independently label each side's return midpoint in consented fixed-view clips, including synchronized movement, deliberate timing differences, partial occlusion, view changes and low excursion. Use two annotators, report their disagreement, retain abstentions in the denominator, and split by person/source rather than adjacent frames. Report measurable coverage and timing error together. Do not select thresholds on the same participants used for final reporting. No participant study result is claimed by the software checks.

### Interface follow-up

Training plan typography now matches the existing exercise labels, body text and primary controls. One contextual hint replaces the three explanatory paragraphs. The [UI walkthrough](results/training-ui-walkthrough.json) records the computed font matches, plan persistence, mobile width and the repeated replay result separately from counting accuracy. Replay attribution now follows the review content instead of overlapping the source player.
