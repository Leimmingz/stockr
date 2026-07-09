import { useState, useCallback, createContext, useContext } from 'react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { message, confirmLabel, cancelLabel, resolve }

  const confirm = useCallback((message, opts = {}) => {
    const confirmLabel = opts.confirmLabel || 'Supprimer'
    const cancelLabel  = opts.cancelLabel  || 'Annuler'
    return new Promise(resolve => setState({ message, confirmLabel, cancelLabel, resolve }))
  }, [])

  function handleResponse(answer) {
    state?.resolve(answer)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="modal-overlay" style={{zIndex:2000}} onClick={e => e.target===e.currentTarget && handleResponse(false)}>
          <div className="modal" style={{maxWidth:380}}>
            <p style={{fontSize:15,fontWeight:500,color:'var(--text)',lineHeight:1.5,marginBottom:24}}>
              {state.message}
            </p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => handleResponse(false)}>{state.cancelLabel}</button>
              <button className="btn btn-danger"    onClick={() => handleResponse(true)}  style={{background:'var(--red)',color:'#fff',border:'none'}}>{state.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
