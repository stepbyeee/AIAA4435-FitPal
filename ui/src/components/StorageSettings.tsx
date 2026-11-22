import { useState } from 'react'
import { clearLocalProgress, keepSummaries, setKeepSummaries } from '../data/privacy'

export function StorageSettings() {
  const [keep, setKeep] = useState(keepSummaries)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const erase = async () => {
    setBusy(true)
    try {
      await clearLocalProgress()
      window.location.reload()
    } catch { setError(true); setBusy(false) }
  }
  return <details className="storage-settings">
    <summary>本机数据设置</summary>
    <label><input type="checkbox" checked={keep} onChange={e => {
      const enabled = e.target.checked
      if (setKeepSummaries(enabled)) { setKeep(enabled); setError(false) } else setError(true)
    }} />保存今后的摄像头训练摘要</label>
    <p>关闭后仍可在当次训练里看回顾，结束后不累计 EXP 或收藏券。录像和逐帧关键点仅在本次回顾期间使用。</p>
    {confirming ? <div role="group" aria-label="确认清除进度">
      <p>清除本浏览器里的训练历史、手动记录、衣橱和签到后，无法恢复。</p>
      <button className="manual-start" disabled={busy} onClick={() => setConfirming(false)}>取消</button>
      <button className="manual-start" disabled={busy} onClick={erase}>{busy ? '正在清除…' : '确认清除全部进度'}</button>
    </div> : <button className="manual-start" onClick={() => setConfirming(true)}>清除本机进度</button>}
    {error && <p role="alert">本机存储操作未完成，请检查浏览器的存储权限。</p>}
  </details>
}
