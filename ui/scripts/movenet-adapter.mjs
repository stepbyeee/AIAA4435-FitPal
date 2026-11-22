// Only loaded by the offline benchmark. The product stays on MediaPipe Full.
import { join } from 'node:path'

const prefix = '/__fitpal_movenet__/'
export async function loadMoveNet(page, directory, threshold) {
  const scripts = ['tf.min.js', 'tf-backend-wasm.min.js', 'pose-detection.min.js']
  const assets = new Set([...scripts, 'model.json', 'group1-shard1of2.bin', 'group1-shard2of2.bin',
    'tfjs-backend-wasm.wasm', 'tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-threaded-simd.wasm'])
  await page.route('**' + prefix + '*', route => {
    const name = new URL(route.request().url()).pathname.slice(prefix.length)
    if (!assets.has(name)) return route.abort()
    return route.fulfill({ path: join(directory, name) })
  })
  for (const name of scripts) await page.addScriptTag({ url: prefix + name })
  await page.evaluate(async ({ prefix, threshold }) => {
    const { tf, poseDetection } = window
    tf.wasm.setWasmPaths(prefix)
    tf.wasm.setThreadsCount(1)
    if (!await tf.setBackend('wasm')) throw Error('MoveNet benchmark needs TFJS WASM')
    await tf.ready()
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      modelUrl: prefix + 'model.json', enableSmoothing: true,
    })
    const { LM, LANDMARK_COUNT } = await import('/src/contract.ts')
    const map = [LM.nose, 2, 5, LM.leftEar, LM.rightEar, LM.leftShoulder, LM.rightShoulder,
      LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip,
      LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle]
    // The product gates its visibility field at .6. This monotonic remap lets the
    // offline sensitivity check use another MoveNet score without changing fit
    // geometry, relative side confidence, or the production state machine.
    function visibility(score) {
      if (threshold === 0.6) return score
      return score < threshold ? 0.6 * score / threshold : 0.6 + 0.4 * (score - threshold) / (1 - threshold)
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    window.estimateMoveNet = async (bitmap, time) => {
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width
        canvas.height = bitmap.height
      }
      ctx.drawImage(bitmap, 0, 0)
      const [pose] = await detector.estimatePoses(canvas, { flipHorizontal: false }, time)
      if (!pose) return null
      const points = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 }))
      for (const [index, point] of pose.keypoints.entries()) {
        points[map[index]] = { x: point.x / bitmap.width, y: point.y / bitmap.height, visibility: visibility(point.score ?? 0) }
      }
      return points
    }
    window.closeMoveNet = () => detector.dispose()
  }, { prefix, threshold })
}
