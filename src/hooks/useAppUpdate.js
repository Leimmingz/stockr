import { useState, useEffect } from 'react'

/**
 * Détecte quand une nouvelle version du service worker est disponible.
 * Retourne { updateAvailable, applyUpdate }
 */
export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [waitingWorker,   setWaitingWorker]   = useState(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.ready.then(reg => {
      // Vérifie immédiatement si un SW est déjà en attente
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

    // Quand le nouveau SW prend le contrôle → recharge
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })
  }, [])

  function applyUpdate() {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' })
    }
  }

  return { updateAvailable, applyUpdate }
}
