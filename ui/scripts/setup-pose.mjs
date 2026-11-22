// Install the local runtime and the official v1 FP16 Full model.
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'mediapipe')
const name = 'pose_landmarker_full.task'
const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/${name}`
const expected = '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'
const matches = bytes => createHash('sha256').update(bytes).digest('hex') === expected

await mkdir(out, { recursive: true })
await cp(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'), join(out, 'wasm'), { recursive: true })
const dest = join(out, name)
if (await readFile(dest).then(matches, () => false)) {
  console.log('Full model verified')
} else {
  const staging = join(out, name + '.' + randomUUID() + '.tmp')
  try {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw Error(`Model download failed (${response.status})`)
      await writeFile(staging, Buffer.from(await response.arrayBuffer()))
    } catch (cause) {
      // curl also handles system HTTPS proxy settings on machines where Node's fetch cannot connect.
      try {
        execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2',
          '--max-time', '90', '--proto', '=https', '--proto-redir', '=https', '--output', staging, url])
      } catch {
        throw new Error('Could not download the official model with fetch or curl. Check your HTTPS connection.', { cause })
      }
    }
    if (!matches(await readFile(staging))) throw Error('Unexpected model checksum')
    await rename(staging, dest)
  } finally { await rm(staging, { force: true }) }
  console.log('Full model downloaded and verified')
}
