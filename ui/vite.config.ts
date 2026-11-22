import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'fitpal-release-assets',
      apply: 'build',
      async writeBundle(output) {
        const out = resolve(output.dir ?? 'dist')
        await mkdir(out, { recursive: true })
        // The dev server also serves local evaluation clips. Release only the runtime and licensed demos.
        for (const name of ['mediapipe', 'showcase']) {
          await cp(resolve('public', name), resolve(out, name), { recursive: true })
        }
      },
    },
  ],
  build: { copyPublicDir: false },
  test: { environment: 'node' },
})
