import { useCallback, useEffect, useState } from 'react'
import { parseSide, type SideSelection } from './tracking/sideSelection'
import { parseFocus, type Focus } from './tracking/focus'
import { exerciseById } from './data/exercises'
import { balanceOf, GEAR, gearState, loadGear, SAMPLE_GEAR, saveGear, type GearId } from './data/gear'
import { levelOf, loadHistory, repsByHalf, SAMPLE_HISTORY, totalExp, type SessionRecord } from './data/history'
import { withProgressLock } from './data/progressLock'
import { useCollection } from './data/collectionStore'
import { Wardrobe } from './screens/Wardrobe'
import { LabelVideo } from './screens/LabelVideo'
import { RowLab } from './screens/RowLab'
import { ManualSet } from './screens/ManualSet'
import { StudySetup } from './screens/StudySetup'
import { TrainingHistory } from './screens/TrainingHistory'
import { Home } from './screens/Home'
import { Session } from './screens/Session'

const sessionParams = ['video','study','participant','period','growth','focus','side']
const routeOf = (url: URL) => url.hash.replace(/^#\/?/, '')

export function App() {
  const collection = useCollection()
  const [href, setHref] = useState(() => window.location.href)
  const location = new URL(href)
  const params = location.searchParams
  const clip = params.get('video')
  const showcase = clip === 'go4it-rear' ? '/showcase/go4it-rear.mp4'
    : clip === 'goblet-squat' ? '/showcase/goblet-squat.mp4' : null
  const bundledFile = showcase ?? (clip && /^[\w-]+(?:\.(?:mp4|webm))?$/.test(clip)
    ? `/demo/${clip.includes('.') ? clip : clip + '.webm'}` : null)
  const useCamera = !params.has('nocam')
  const preview = !useCamera && !bundledFile
  const route = routeOf(location)
  const [localClip, setLocalClip] = useState<{ id: string; url: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => () => { if (localClip) URL.revokeObjectURL(localClip.url) }, [localClip])
  useEffect(() => {
    if (localClip && route !== `review/${localClip.id}`) setLocalClip(null)
  }, [route, localClip])
  const [history, setHistory] = useState<SessionRecord[]>(() => preview ? SAMPLE_HISTORY : loadHistory())
  const [gear, setGear] = useState<GearId[]>(() => preview ? SAMPLE_GEAR : loadGear())

  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href)
      if (!routeOf(url)) {
        for (const param of sessionParams) url.searchParams.delete(param)
        if (url.href !== window.location.href) window.history.replaceState(null, '', url)
      }
      setHref(url.href)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const goHome = useCallback(() => {
    const current = new URL(window.location.href)
    const inTrial = Boolean(current.searchParams.get('study'))
    if (inTrial) {
      current.searchParams.delete('study')
      current.hash = '/study'
      window.location.assign(current)
    } else {
      window.location.hash = '/'
    }
  }, [])

  useEffect(() => {
    if (preview) return
    const sync = (e: StorageEvent) => {
      if (!e.key || e.key === 'fitpal.history.v3') setHistory(loadHistory())
      if (!e.key || e.key === 'fitpal.gear.v2') setGear(loadGear())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [preview])

  const buy = (id: GearId) => {
    const item = GEAR.find(g => g.id === id)
    if (!item) return
    void withProgressLock(() => {
      const owned = preview ? gear : loadGear()
      const sessions = preview ? history : loadHistory()
      const balance = balanceOf(levelOf(totalExp(sessions)).level, owned)
      if (gearState(item, owned, balance, repsByHalf(sessions)) !== 'ok') return
      const next = [...owned, id]
      if (!preview) saveGear(next)
      setGear(next)
    })
  }

  const [screen, id] = route.split('/')
  const reviewingLocal = screen === 'review' && id === localClip?.id
  const exercise = (screen === 'session' || reviewingLocal) ? exerciseById(id) : undefined
  const manualExercise = screen === 'manual' ? exerciseById(id) : undefined
  const videoFile = reviewingLocal ? localClip?.url ?? null : bundledFile
  const start = (id: string, file?: File) => {
    const next = new URL(window.location.href)
    for (const key of sessionParams) next.searchParams.delete(key)
    next.hash = `/${file ? 'review' : 'session'}/${id}`
    window.history.pushState(null, '', next)
    if (file) setLocalClip({ id, url: URL.createObjectURL(file) })
    setHref(next.href)
  }

  const focus = params.has('study') ? 'full' : parseFocus(params.get('focus'))
  const side = params.has('study') ? 'both' : parseSide(params.get('side'))
  const changeCameraSetting = (key: 'focus' | 'side', value: Focus | SideSelection) => {
    const next = new URL(window.location.href)
    if (value === 'full' || value === 'both') next.searchParams.delete(key)
    else next.searchParams.set(key, value)
    window.history.replaceState(null, '', next)
    setHref(next.href)
    setAttempt(n => n + 1)
  }

  let content
  if (route === 'wardrobe') {
    content = <Wardrobe collection={collection} gear={gear} preview={preview || Boolean(bundledFile) || params.has('study')} />
  } else if (route === 'study') {
    content = <StudySetup />
  } else if (route === 'lab/seated-row' && !params.has('study')) {
    content = <RowLab onExit={goHome} />
  } else if (route === 'label') {
    content = <LabelVideo />
  } else if (route === 'history') {
    content = <TrainingHistory history={history} preview={preview} />
  } else if (manualExercise) {
    content = <ManualSet exercise={manualExercise} preview={preview || Boolean(bundledFile) || params.has('study')} />
  } else if (exercise?.available) {
    content = <Session key={`${route}/${attempt}`} exercise={exercise} history={history} gear={gear}
      useCamera={useCamera} videoFile={videoFile} focus={focus} onFocus={f => changeCameraSetting('focus', f)}
      side={side} onSide={s => changeCameraSetting('side', s)}
      onRetry={() => setAttempt(n => n + 1)} onSaved={setHistory} onExit={goHome} />
  } else {
    content = <Home cosmetic={preview ? null : collection.state.equipped} history={history}
      gear={gear} onBuy={buy} onStart={start} />
  }

  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="#/" aria-label="FitPal 首页">
          <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
            <rect x="2" y="5" width="24" height="5" rx="2.5" fill="var(--accent)" />
            <circle cx="14" cy="19" r="6" fill="var(--accent)" />
          </svg>
          <span>FitPal</span>
        </a>
        {!exercise && <nav className="home-nav" aria-label="项目导航">
          <a href="#/wardrobe" aria-current={route === 'wardrobe' ? 'page' : undefined}>衣橱</a>
          <a href="#/history" aria-current={route === 'history' ? 'page' : undefined}>训练记录</a>
          <a href="#/study" aria-current={route === 'study' ? 'page' : undefined}>课堂试测</a>
        </nav>}
      </header>

      {content}
    </div>
  )
}
