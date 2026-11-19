import { useCallback, useEffect, useState } from 'react'
import { exerciseById } from './data/exercises'
import { loadGear, saveGear, type GearId } from './data/gear'
import { loadHistory, type SessionRecord } from './data/history'
import { Home } from './screens/Home'
import { Session } from './screens/Session'

const routeOf = () => window.location.hash.replace(/^#\/?/, '')

export function App() {
  const [route, setRoute] = useState(routeOf)
  const [history, setHistory] = useState<SessionRecord[]>(loadHistory)
  const [gear, setGear] = useState<GearId[]>(loadGear)

  useEffect(() => {
    const onHash = () => setRoute(routeOf())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const goHome = useCallback(() => {
    window.location.hash = '/'
  }, [])

  const buy = useCallback((id: GearId) => {
    setGear((owned) => {
      if (owned.includes(id)) return owned
      const next = [...owned, id]
      saveGear(next)
      return next
    })
  }, [])

  const exercise = route.startsWith('session/') ? exerciseById(route.slice('session/'.length)) : undefined
  // `?nocam` keeps the camera off, for demos and screenshots.
  const params = new URLSearchParams(window.location.search)
  const useCamera = !params.has('nocam')
  // `?video=pulldown` plays public/demo/pulldown.webm on the stage instead of the camera.
  const clip = params.get('video')
  const videoFile = clip && /^[\w-]+$/.test(clip) ? `/demo/${clip}.webm` : null

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
      </header>

      {exercise?.available ? (
        <Session key={exercise.id} exercise={exercise} history={history} gear={gear} useCamera={useCamera} videoFile={videoFile} onSaved={setHistory} onExit={goHome} />
      ) : (
        <Home history={history} gear={gear} onBuy={buy} onStart={(id) => (window.location.hash = `/session/${id}`)} />
      )}
    </div>
  )
}
