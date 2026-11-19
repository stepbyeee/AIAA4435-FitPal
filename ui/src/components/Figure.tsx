import { useEffect, useId, useState } from 'react'
import type { GearId } from '../data/gear'
import { jointsFor, type Pt } from '../pose'

// FitPal's character. Its body is plain; what it has earned is what it wears.

type Props = {
  /** 0 to 1 pulls the bar from the top of the range to the bottom; null stands at rest. */
  q: number | null
  /** What the character is wearing. */
  gear: readonly GearId[]
  label: string
}

const along = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

export function Figure({ q, gear, label }: Props) {
  const clip = useId()
  const j = jointsFor(q)
  const pulling = j.barY !== null
  const has = (id: GearId) => gear.includes(id)
  const body = 'var(--body)'
  const worn = 'var(--accent)'

  // Every part sits on a halo in the card's colour, so the joints read as joints.
  const limb = (a: Pt, b: Pt, width: number, colour: string) => (
    <>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--surface)" strokeWidth={width + 10} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colour} strokeWidth={width} />
    </>
  )
  const block = (d: string, colour: string) => (
    <>
      <path d={d} fill="var(--surface)" stroke="var(--surface)" strokeWidth="50" strokeLinejoin="round" />
      <path d={d} fill={colour} stroke={colour} strokeWidth="40" strokeLinejoin="round" />
    </>
  )

  return (
    <svg className="figure" viewBox="0 0 400 640" role="img" aria-label={label}>
      <ellipse cx="200" cy="614" rx="118" ry="10" fill="var(--floor)" />

      {([0, 1] as const).map((i) => {
        const side = i === 0 ? -1 : 1
        const thighEnd = along(j.hip[i], j.knee[i], 0.94)
        const shinStart = along(j.knee[i], j.ankle[i], 0.06)
        return (
          <g key={i} strokeLinecap="round">
            {limb({ x: 200 + side * 46, y: 602 }, j.toe[i], has('shoes') ? 28 : 24, has('shoes') ? worn : body)}
            {limb(shinStart, j.ankle[i], 34, body)}
            {limb(j.hip[i], thighEnd, 42, body)}
            {has('kneeSleeves') && limb(along(j.hip[i], j.knee[i], 0.74), along(j.knee[i], j.ankle[i], 0.26), 40, worn)}
            {has('shorts') && limb(j.hip[i], along(j.hip[i], j.knee[i], 0.44), 46, worn)}
          </g>
        )
      })}

      <g className={pulling ? undefined : 'figure-breath'}>
        {block('M176 308 L224 308 L222 352 L178 352 Z', has('shorts') ? worn : body)}
        <line x1="200" y1="146" x2="200" y2="182" stroke={body} strokeWidth="26" strokeLinecap="round" />
        {block('M160 198 L240 198 L230 276 L170 276 Z', has('tank') ? worn : body)}

        {j.barY !== null && <line x1="200" y1="0" x2="200" y2={j.barY} stroke={body} strokeWidth="4" />}

        {([0, 1] as const).map((i) => (
          <g key={i} strokeLinecap="round">
            {limb(j.shoulder[i], j.elbow[i], 34, body)}
            {limb(j.elbow[i], j.hand[i], 28, body)}
            {has('wristbands') && limb(along(j.elbow[i], j.hand[i], 0.52), along(j.elbow[i], j.hand[i], 0.74), 30, worn)}
          </g>
        ))}

        <circle cx={j.head.x} cy={j.head.y} r={j.headRadius + 5} fill="var(--surface)" />
        <circle cx={j.head.x} cy={j.head.y} r={j.headRadius} fill="var(--head)" />
        {has('headband') && (
          <>
            <clipPath id={clip}>
              <circle cx={j.head.x} cy={j.head.y} r={j.headRadius} />
            </clipPath>
            <rect x="140" y="62" width="120" height="19" fill={worn} clipPath={`url(#${clip})`} />
          </>
        )}
        <g className="figure-eyes" fill="var(--surface)">
          <circle cx="182" cy="102" r="6" />
          <circle cx="218" cy="102" r="6" />
        </g>

        {j.barY !== null && <line x1="58" y1={j.barY} x2="342" y2={j.barY} stroke="var(--bar)" strokeWidth="10" strokeLinecap="round" />}
        {([0, 1] as const).map((i) => (
          <g key={i}>
            <circle cx={j.hand[i].x} cy={j.hand[i].y} r="22" fill="var(--surface)" />
            <circle cx={j.hand[i].x} cy={j.hand[i].y} r="17" fill={has('gloves') ? worn : 'var(--head)'} />
          </g>
        ))}
      </g>
    </svg>
  )
}

/** A looping pull for previews. Holds the pulled pose when the user prefers reduced motion. */
export function useDemoPull(active: boolean): number | null {
  const [q, setQ] = useState<number | null>(null)
  useEffect(() => {
    if (!active) {
      setQ(null)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setQ(0.9)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      setQ((1 - Math.cos(((now - t0) / 2600) * 2 * Math.PI)) / 2)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
  return q
}
