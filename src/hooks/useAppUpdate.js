import { useState, useEffect } from 'react'

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [waitingWorker,   setWaitingWorker]   = useState(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.ready.then(reg => {
      if (reg.waiting) {
        setWaitingWorker(reg.waiting)
        setUpdateAvailable(true)
      }
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setWaitingWorker(newWorker)
            setUpdateAvailable(true)
          }
        })
      })
    })

    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload() }
    })
  }, [])

  function applyUpdate() {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' })
      setTimeout(() => window.location.reload(), 2000)
    } else {
      window.location.reload()
    }
  }

  return { updateAvailable, applyUpdate }
}
