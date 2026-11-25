# FitPal

**A webcam AI workout companion that knows when to speak.**

FitPal tracks a workout on a laptop webcam. Its default coaching mode shows the movement live and offers at most one focused cue after a set. The classroom study compares this design with per-rep feedback.

> Course project · AIAA4435 Interactive AI Systems · built from the midterm proposal below.

The [interactive training experience](docs/interactive-training.md) adds personal goals, live motion metrics, source-linked repetition review, experimental bilateral timing, explanations of the existing EXP rules and compact history trends. Its calculations and interface have separate reproducible checks; bilateral observations remain descriptive and do not earn rewards.

| | |
|---|---|
| **Team** | Jiaqi Li · Ray · Yueran Qiu | 
| **Instructor** | Yenchi Tseng |
| **Status** | Local browser app with live tracking, three included video demos and a classroom pilot workflow |
| **Scope** | Lat pulldown is the proposal task. Squats also support personal calibration. Side-view seated rowing has an experimental counter. |

---

## The problem

Users training alone face three things at once:

1. **"Is my form right?"** — no coach, no mirror angle, no way to know if the rep actually worked.
2. **Feedback interrupts training.** A cue delivered mid-rep breaks rhythm and the user stops listening to it.
3. **Progress is invisible.** Without a record, a good week and a bad week feel identical, so motivation decays.

Existing products each solve one of these and none solves the timing problem:

| Product | What it does well | What it leaves open |
|---|---|---|
| Zing AI | Plans + camera form tips + coach chat | Form guidance is not a live check during the set |
| Abundant class library | Rich content; an AI coach builds plans | Follow-along video, no live form check |
| **FitPal** | **Webcam-based movement checks, quiet during the set, one Chinese-language cue after it, calibrated per person** | |

## Research questions

- **RQ1** — Is matching a joint target easier for a user than reading text feedback?
- **RQ2** — Does post-set feedback interrupt less than per-rep feedback?
- **RQ3** — Does visible growth (EXP, level) raise motivation?

---

## How it works

The midterm proposal defines the coaching loop below. The app runs pretrained MediaPipe Pose Landmarker Full on device. Rules select the feedback, with optional local language-model wording.

```
frames ──► Perception ──► Decision policy ──► Explanation ──► Reward
             (MediaPipe)    (interpretable       (LLM:           (verified
                             rules)               explains,       reps only)
                                                  never judges)

Constraint: if the camera can't see the joint clearly, no judgment is issued at all.
```

### Layer 1 — Perception: frames → rep result

FitPal uses the projected elbow angle for lat pulldowns and the projected knee angle for squats. Range is relative to three complete cycles from the same person and camera position:

```
q = (θtop − θ) / (θtop − θbottom)        0 = top of range, 1 = bottom of range
```

`θtop` and `θbottom` are **per-user**, measured during a short 3-rep calibration at the start of a session. A rep is a state machine:

`READY TO PULL → PULL DOWN → AT BOTTOM → RETURN UP → +1 REP`

**"Can't see" is not "wrong."** Occlusion, bad camera angle, or a body out of frame produce a `cannot verify` result, never a form error.

### Layer 2 — Decision: when to speak

Five initial actions, each one logged with its trigger so the policy can be audited later:

| Trigger | Action |
|---|---|
| Camera can't see you | Prompt to adjust the camera |
| Mid-rep | **Stay silent** |
| Form slips during a set | **Wait for set end** |
| Set ends | Give **one** focus cue (the most relevant issue from that set) |
| Set ends | Award EXP, update level |

### Layer 3 — Language: what to say

When enabled, local Qwen2.5-0.5B-Instruct selects one observation and one action from the phrases approved for the measured issue. Clean sets skip inference. Timeouts or invalid responses fall back to the rule text. The study uses fixed wording. [Optional local coach and checks](docs/local-coach.md)

### Reward

Only verified reps earn EXP — reward is settled once per set:

| Condition | Meaning | EXP |
|---|---|---|
| Rep seen by camera | Verified rep | **+1** |
| ≥ 8 of 10 reps in range | Good quality set | **+5** |
| Last set's issue is gone | Issue fixed | **+5** |
| Body out of view | Cannot verify | **0** |

History carries forward: today's cue is chosen against the previous session's outstanding issue.

---

## Privacy

Video is processed on device. The optional language model receives permitted observation and action phrases over loopback. Camera sessions can retain counts, EXP and summary labels locally. Users can turn this off and clear FitPal data from Training History. Playback, per-rep trajectories and study responses stay out of personal training history. Study and annotation files are downloaded explicitly.

## Limits we state up front

- **Not medical or load advice.** EXP is a game stat, not a health metric; FitPal never advises on weight or injury.
- **Short pilot, exploratory.** User-study findings are expected to be short-term and directional, not causal or generalizable.
- **Webcam-only geometry.** Keep the camera fixed with the returning limb in frame. Off-angle projection, multiple people and high-confidence landmark errors can cause misses or misleading traces.

---

## Evaluation

**Technical gates** — the system does not advance to the user study until these pass:

| Gate | Target |
|---|---|
| Rep cycle precision / recall | ≥ 90% |
| Valid coverage (usable frames) | ≥ 90% |
| Result latency | ≤ 200 ms |
| LLM faithfulness | Stays consistent, grounded, and in scope |

**User study**

1. **Participants** — 8–12 people
2. **Conditions** — text vs. joint-target cards; per-rep vs. post-set feedback
3. **Measures** — interruption, workload

The targets above are the team's proposal goals. Current performance varies by camera placement. The technical evaluation and classroom rehearsal are complete enough to reproduce; the human participant study remains open. [Validation report and limitations](docs/validation.md)

## Roadmap

| Week | Milestone |
|---|---|
| W1 | PoC — go / no-go on webcam rep counting |
| W2 | Camera setup & UI |
| W3 | **M1** demo |
| W4 | **M2** core flow (calibrate → set → cue) |
| W5 | **M3** integrated (perception + decision + language) |
| W6 | **M4** pilot |
| W7 | Final |

---

## Getting started

From `ui/`, run `npm ci`, `npm run setup:pose` and `npm run dev`. Open the replay library on the home screen to try the included real-video pulldown and squat examples without granting camera access. The seated-row experiment also has its own demo.

- [Browser usage and reproducible checks](ui/README.md)
- [Pretrained pose model comparison](docs/model-comparison.md) and [MoveNet Lightning](docs/movenet-benchmark.md)
- [Classroom pilot protocol](docs/pilot.md) and [local dataset annotation](docs/local-video-labeling.md)

## Contributing

Feature branches with a PR into the default branch; no direct pushes to it. Every decision-layer action stays logged so policy changes can be compared against recorded triggers.
