// Puts what pose tracking needs under public/mediapipe: the WASM runtime from the npm package and
// the pose model from Google's model store. Both are served by the app itself, so nothing is
// fetched from a CDN at runtime. Run once after `npm install`: `npm run setup:pose`.
import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'mediapipe')
const MODEL = 'pose_landmarker_full.task'
const MODEL_URL = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/${MODEL}`

await mkdir(out, { recursive: true })
await cp(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(out, 'wasm'), { recursive: true })
console.log('copied wasm runtime')

const modelPath = join(out, MODEL)
const have = await stat(modelPath).then((s) => s.size > 1_000_000, () => false)
if (have) {
  console.log('model already present')
} else {
  const res = await fetch(MODEL_URL)
  if (!res.ok) throw new Error(`model download failed: ${res.status}`)
  await writeFile(modelPath, Buffer.from(await res.arrayBuffer()))
  console.log('downloaded', MODEL)
}
