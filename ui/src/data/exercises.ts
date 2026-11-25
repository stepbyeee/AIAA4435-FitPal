export type Half = 'upper' | 'lower'

export type Exercise = {
  id: string
  name: string
  /** Which half of the body it trains. Gear for a half opens once that half has been trained. */
  half: Half
  available: boolean
}

export const EXERCISES: Exercise[] = [
  { id: 'lat-pulldown', name: '高位下拉', half: 'upper', available: true },
  { id: 'seated-row', name: '坐姿划船', half: 'upper', available: false },
  { id: 'shoulder-press', name: '肩上推举', half: 'upper', available: false },
  { id: 'squat', name: '深蹲', half: 'lower', available: true },
]

export const exerciseById = (id: string) => EXERCISES.find((e) => e.id === id)
