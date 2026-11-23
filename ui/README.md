# FitPal UI

Run these commands in this directory using Node.js 22.12+ or 24 LTS and npm. The first setup downloads a checksum-verified MediaPipe Pose Landmarker Full model. The WASM runtime, model, fonts and three workout examples are then served locally.

```sh
npm ci
npm run setup:pose
npm run dev
```

Open the home page at http://127.0.0.1:5190. Camera capture requires a secure browser context such as localhost or HTTPS.

| What to try | Entry |
|---|---|
| Camera workout | Choose 高位下拉 or 深蹲 on the home screen |
| Included pulldown with two arm trails | `/?video=go4it-rear#/session/lat-pulldown` |
| Included goblet squat with leg tracking | `/?video=goblet-squat#/session/squat` |
| A recording from your own camera | Home → 录像回放 → select exercise and MP4/WebM |
| Review history or delete FitPal data | `/#/history` |
| Check in, unlock and equip a cosmetic | `/#/wardrobe` |
| Assign a pilot condition or summarize exported ratings | `/#/study` |
| Mark cycles in a local test video | `/#/label` |
| Try wardrobe and character with example records | `/?nocam` |

Keep the counting side's shoulder, elbow and wrist visible throughout a pulldown, or hip, knee and ankle for a squat. Complete three calibration cycles in the same camera position. These establish personal top and bottom angles. A subsequent return to the top completes a repetition. Each limb has its own trail and visibility state. **分析** shows projected joint angles over the latest six seconds. **画中分析** places the count, live range and angle plot directly over the camera view. During a pulldown both arms are monitored automatically. A lost side breaks its own overlay. With wrists cropped at the top, a clearly observed upper-arm cycle can count without a range grade. The optional side control is available for squats. The optional crop selects part of the displayed frame. It may cut off a joint or retain another person.

Complete a set with **结束这一组** or Space. A sustained visible top pose can also end the set. The review lets you select a rep and inspect its range, timing, path and visibility gaps. After each camera set, the browser releases its stream and can save a summary. Playback can be retried and earns no persistent EXP. Seated row and shoulder press have manual log entries. The seated-row experiment at `/#/lab/seated-row` also offers a camera, file and included demo. Its side-view counts do not award EXP.

## Verification

```sh
npm test
npm run build
npm run preview
```

To prepare a classroom copy that runs without npm or a network connection, run `python3 scripts/package-class-demo.py /tmp/FitPal-class-demo.zip` after building. The ZIP includes a loopback-only Python launcher.

The production build includes only the local MediaPipe runtime and the three licensed showcase videos from public assets. Dev-only test clips and benchmark weights are excluded. The video credits and adaptations are in [showcase/CREDITS.txt](public/showcase/CREDITS.txt).

For the expanded regression suite, run the dev server, install Chromium for Playwright (`npx playwright install chromium` or set `FITPAL_CHROME` to a system Chrome binary), and restore the original local fixtures with `npm run setup:demos`. Use these commands in another terminal in `ui/`. The test harness defaults to port 5190. Use `--fixtures` with `test:browser` to supply the original two recordings from disk when testing a production build. Set `FITPAL_URL` for a different local server. FFmpeg is used for controlled cases and file conversion.

```sh
ffmpeg -i public/demo/pulldown.webm -an -pix_fmt yuv420p -f yuv4mpegpipe /tmp/fitpal-camera.y4m
npm run test:browser -- --camera /tmp/fitpal-camera.y4m --artifacts /tmp/fitpal-session
npm run test:soak -- --camera /tmp/fitpal-camera.y4m --sessions 24 --output /tmp/fitpal-soak.json
node scripts/stress-pulldown.mjs --repeat 2 --output /tmp/fitpal-stress.json
node scripts/record-showcase.mjs --exercise squat --output /tmp/fitpal-squat.mp4
```

[Current validation report](../docs/validation.md) · [Replay dataset and model benchmark](../docs/model-comparison.md) · [Optional local language model](../docs/local-coach.md)
