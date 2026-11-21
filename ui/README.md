# FitPal UI

```bash
npm ci
npm run setup:pose   # copies the MediaPipe runtime and downloads the pose model into public/mediapipe
npm run dev          # http://localhost:5190
```

| URL | What the stage shows |
|---|---|
| `/` | Your camera, with the tracked body drawn as bones |
| `/?nocam` | Character and wardrobe preview |
| `/?video=NAME#/session/lat-pulldown` | Single playback of `public/demo/NAME.webm` |

For webcam training, frame the shoulder, elbow and wrist of the nearer arm, including the entire overhead return. Keep the camera fixed after doing three complete calibration reps. A gym set ends after five seconds in a visible top pose or when you press Space or **结束这一组**. Open **查看这一组的动作依据** to see the projected calibration angles, observed depth per rep and set-end trigger. An incomplete calibration at video EOF prompts a retry. Playback scores do not enter training history.

Pose Landmarker Full and WASM are served by the app. Local storage keeps session summaries and wardrobe choices. The live app starts in a fresh training store because the previous UI stored simulated results. Existing data under the old keys stays available in browser storage. The browser releases the webcam between sets and at session end.

`public/mediapipe/` and `public/demo/` are ignored. Copy the originals into `public/demo/` with these filenames to reproduce the demo. The Commons pages show the license and current review status.

- `pulldown.webm` — [Lat pulldown exercise demonstration by Your Move](https://commons.wikimedia.org/wiki/File:Lat_pulldown_exercise_demonstration.webm)
- `pulldown-mistakes.webm` — [Common Lat Pulldown Mistakes by Andrew Kwong](https://commons.wikimedia.org/wiki/File:Common_Lat_Pulldown_Mistakes.webm)

With the dev server running and Playwright available, run `node scripts/replay-pulldown.mjs --check`. Run with `--help` for options. See [replay and pilot notes](../docs/pulldown-validation.md) for the annotated protocol and observed results.
