# FitPal

**A webcam AI workout companion that knows when to speak.**

FitPal watches a set through an ordinary laptop webcam, counts your reps, and gives you **one** focused cue **after** the set — never in the middle of a rep. Feedback that arrives between reps is the thing that makes workout AI annoying; FitPal's core claim is that a well-timed silent agent beats a chatty one.

> Course project · AIAA4435 Interactive AI Systems · built from the midterm proposal below.

| | |
|---|---|
| **Team** | Jiaqi Li · Ray · Yueran Qiu | 
| **Instructor** | Yenchi Tseng |
| **Status** | Week 1 — proof of concept / go-no-go |
| **Scope** | Lat pulldown first, webcam only |

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
| **FitPal** | **Live form check, webcam only — quiet during the set, one cue after it — tuned for Chinese users (fine-tuned on Chinese data, calibrated per user)** | |

## Research questions

- **RQ1** — Is matching a joint target easier for a user than reading text feedback?
- **RQ2** — Does post-set feedback interrupt less than per-rep feedback?
- **RQ3** — Does visible growth (EXP, level) raise motivation?

---

## How it works

The coaching loop is a single pipeline with an explicit constraint on each layer:

```
frames ──► Perception ──► Decision policy ──► Explanation ──► Reward
             (MediaPipe)    (interpretable       (LLM:           (verified
                             rules)               explains,       reps only)
                                                  never judges)

Constraint: if the camera can't see the joint clearly, no judgment is issued at all.
```

### Layer 1 — Perception: frames → rep result

Pose landmarks come from MediaPipe Pose. Each rep is scored on a **normalized elbow angle** so that absolute flexibility does not decide pass/fail:

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

The LLM only **explains** a cue the decision layer already chose. It does not judge the user and does not decide whether to speak. The call happens once per set; the prompt carries the set summary, not the video stream.

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

Video is processed **on device**. Only a set summary — angles, counts, labels — reaches the LLM. No clip upload, no frame storage. This is a design constraint, not a setting.

## Limits we state up front

- **Not medical or load advice.** EXP is a game stat, not a health metric; FitPal never advises on weight or injury.
- **Short pilot, exploratory.** User-study findings are expected to be short-term and directional, not causal or generalizable.
- **Webcam-only geometry.** Single fixed camera, one exercise first (lat pulldown); occlusion is the main failure mode.

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

Illustrative shape of one result, used here only to show the reporting format (per-user calibration values, then visibility and accuracy for the set — **not a final result**):

```
Elbow      116° / 149°
Visibility 1.00 · 8/8
Accuracy   80/100
```

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

Not runnable yet — this repo is currently the proposal and the implementation plan. The W1 proof of concept lands here first; the scaffold below is the intended layout and will appear with real code rather than as empty placeholders:

```
fitpal/
├── perception/     # pose tracking, calibration, rep state machine
├── decision/       # interpretable rule policy, action log
├── language/       # LLM cue explanation (set summary in, one cue out)
├── reward/         # EXP settlement, level, session history
├── ui/             # camera setup, live view, post-set card
└── eval/           # technical gates + user-study harness
```

## Contributing

Feature branches with a PR into the default branch; no direct pushes to it. Every decision-layer action stays logged so policy changes can be compared against recorded triggers.
