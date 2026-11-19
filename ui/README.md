# FitPal UI

```bash
npm install
npm run setup:pose   # copies the MediaPipe runtime and downloads the pose model into public/mediapipe
npm run dev          # http://localhost:5190
```

| URL | What the stage shows |
|---|---|
| `/` | Your camera, with the tracked body drawn as bones |
| `/?nocam` | No camera: a stand-in body, for demos and screenshots |
| `/?video=NAME` | `public/demo/NAME.webm` instead of the camera |

Rep counts, cues and EXP still come from the stand-ins in `src/mock/`. The real modules replace those
two files and speak the types in `src/contract.ts`. During a set, Space ends it and V hides the
stand-in body from the stand-in camera.

`public/mediapipe/` and `public/demo/` are not committed. Demo clips used so far, both from Wikimedia Commons:

- `pulldown-mistakes.webm`: "Common Lat Pulldown Mistakes" by Andrew Kwong, CC BY 3.0
- `pulldown.webm`: "Lat pulldown exercise demonstration" by Your Move, CC BY-SA 4.0
