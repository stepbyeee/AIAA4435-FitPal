# FitPal real pulldown implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Use the checkboxes to track the implementation and verification.

**Goal:** Run the original FitPal coaching loop on real webcam or replay frames using the existing BlazePose Full model.

**Architecture:** Share one on-device stream of timestamped 2D landmarks between the skeleton and a testable TypeScript pulldown state machine. Feed the original UI contracts from real perception and settle each group with one auditable, evidence-based cue and EXP. The recorded-video path uses the same perception and presentation and ends at EOF.

**Tech stack:** React, Vite, TypeScript, MediaPipe Tasks Vision Full, Vitest, Chromium.

## Design and acceptance

- Reuse the tracker and the existing 33-point contract. Running another pose model for perception would consume more browser time and introduce differing skeletons and decisions.
- Use aspect-corrected 2D elbow angle, fixed camera position, side selection based on landmark quality, and a per-side calibration from three visible cycles. A missed or occluded endpoint cannot establish range. Camera frames stay on-device and transient.
- Separate a visible partial-range cycle from an interrupted or unverifiable cycle. Count completed visible cycles and score depth independently. Settle at a verified idle top, explicit end, or video EOF. No form cue during the set.
- Reuse the original animated joint target, one focused cue and earned EXP. The cue and reward must reflect observed events. Support missing camera, loss of tracking, early EOF, and short recordings with clear status. Keep the stand-in preview isolated in the explicit no-camera mode.
- Estimate performance and accuracy on the two repository-listed demos. Use the first three clean cycles for calibration and evaluate the remaining cycles separately. Report edits and insufficient calibration as properties of the mistakes clip. Keep audio/video assets out of commits. Compare results with the README's thresholds and distinguish a small replay from a course pilot.

## Sequence

- [x] Confirm branch baseline `fc94ed9`, install pinned dependencies, find the two source videos, and check the imported midterm proposal. The official Canvas rubric remains unverified.
- [x] Implement geometry, calibration, phase transitions, range and coverage in `ui/src/perception/pulldown.ts`. Test non-square frames, jitter, a visible short rep, occlusion near turnaround, and partial cycles.
- [x] Connect one tracker to calibration and sets in `ui/src/screens/Session.tsx`. Handle stream closure and model failure, and terminate video playback without wrapping a partial rep.
- [x] Connect deterministic issue selection, set evidence and verified rewards in `ui/src/feedback/settle.ts`. Keep an unresolved issue across inconclusive sets.
- [x] Replay both originals through BlazePose Full in Chromium with `ui/scripts/replay-pulldown.mjs`. Annotate cycles independently and record results, coverage, timing and hardware.
- [x] Verify unit suite, production build and browser replay. Document protocol and limitations in [replay and pilot notes](../../pulldown-validation.md).

## After the working demo

- [ ] Freeze the setup and the per-rep annotation rules. Make the independent technical test cover several new people, viewpoints, occlusions and shortened reps. Use the proposal's ≥90% precision/recall and ≥90% valid-frame coverage targets, and separately define and measure the ≤200 ms end-to-end result latency.
- [ ] Read the formal Canvas assignment and align the presentation and participant materials to it. Prepare equal-content text and joint-card feedback and a per-rep timing control. Confirm what is logged and who can access it.
- [ ] Run the proposed 8–12 person exploratory study once the technical gates and course protocol are ready. Compare interruption and workload, record target matching and motivation measures for the corresponding research questions, and report failures with their camera setups.
- [ ] Test the integrated cue language pathway and write the final demo script. Show one confirmed cycle, one withheld judgment and one post-set cue backed by visible evidence.
