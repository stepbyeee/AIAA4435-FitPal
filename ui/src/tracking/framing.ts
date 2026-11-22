import type { PoseFrame } from '../contract'
import { inFrame, limbJoints, visibleLimb, type Limb, type Side } from './limbLandmarks'

export function describeFraming(frame: PoseFrame, limb: Limb = 'arm') {
  const joints = limb === 'arm' ? ['肩膀', '手肘', '手腕'] : ['髋部', '膝盖', '脚踝']
  const describe = (side: Side) => {
    if (!frame.landmarks) return '等待入镜'
    if (visibleLimb(frame, side, limb)) return '可用于校准'
    for (const [i, index] of limbJoints[limb][side].entries()) {
      const p = frame.landmarks[index]
      if (p && (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return joints[i] + '出框'
      if (!inFrame(p)) return joints[i] + '未看清'
    }
    return '关节投影重叠'
  }
  return { left: describe('left'), right: describe('right') }
}
