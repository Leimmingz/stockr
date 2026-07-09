import { useState, useEffect } from 'react'
import { useAuth, AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './hooks/useToast'
import AuthPage   from './pages/AuthPage'
import DepotPage  from './pages/DepotPage'
import PowerPage  from './pages/PowerPage'
import AdminPage  from './pages/AdminPage'
import { supabase } from './lib/supabase'

// ── Shelf deep-link handler ────────────────────────────
function ShelfRedirect({ shelfId, onBack }) {
  const [shelf, setShelf] = useState(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    supabase.from('shelves').select('*').eq('id', shelfId).single().then(({ data }) => {
      if (data) setShelf(data)
      else setNotFound(true)
    })
  }, [shelfId])

  if (notFound) return <div className="page"><div className="page-content empty"><div className="empty-icon">❓</div><p>Étagère introuvable</p><button className="btn btn-primary" onClick={onBack}>Retour</button></div></div>
  if (!shelf) return <div className="page"><div className="page-content" style={{display:'flex',justifyContent:'center',paddingTop:80}}><span className="spinner" style={{width:40,height:40}}/></div></div>
  return <DepotPage initialShelfId={shelfId}/>
}

// ── Bottom navigation ──────────────────────────────────────────
function BottomNav({ active, onChange }) {
  const tabs = [
    { id: 'depot',  icon: '🏭', label: 'Dépôt'  },
    { id: 'power',  icon: '⚡', label: 'Watts'  },
    { id: 'admin',  icon: '👤', label: 'Compte' },
  ]
  return (
    <nav className="bottom-nav">
      {tabs.map(t => (
        <button key={t.id} className={`nav-item ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          <span className="nav-icon">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  )
}

// ── App shell ────────────────────────────────────────────────────────
function AppShell() {
  const { user, loading } = useAuth()
  const [tab, setTab] = useState('depot')

  useEffect(() => {
    const path = window.location.pathname
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const m    = path.match(new RegExp(`^${base}/shelf/(.+)$`))
    if (m) {
      setTab('depot')
      window.__pendingShelfId = m[1]
      window.history.replaceState(null, '', base + '/')
    }
  }, [])

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <svg viewBox="0 0 80 40" width="80" height="40" xmlns="http://www.w3.org/2000/svg" style={{marginBottom:16}}>
          <defs><linearGradient id="lg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#4F46E5"/><stop offset="100%" stopColor="#7C3AED"/></linearGradient></defs>
          <rect x="1" y="1" width="3" height="38" rx="1.5" fill="url(#lg2)"/>
          <rect x="28" y="1" width="3" height="38" rx="1.5" fill="url(#lg2)"/>
          <rect x="1" y="1" width="30" height="4" rx="2" fill="url(#lg2)"/>
          <rect x="1" y="19" width="30" height="4" rx="2" fill="url(#lg2)"/>
          <rect x="1" y="36" width="30" height="4" rx="2" fill="url(#lg2)"/>
          <rect x="5" y="7" width="8" height="10" rx="1.5" fill="#818CF8" opacity="0.9"/>
          <rect x="16" y="9" width="7" height="8" rx="1.5" fill="#A78BFA" opacity="0.8"/>
          <rect x="5" y="25" width="10" height="9" rx="1.5" fill="#A78BFA" opacity="0.9"/>
          <rect x="18" y="27" width="6" height="7" rx="1.5" fill="#818CF8" opacity="0.8"/>
          <text x="36" y="28" fontSize="18" fontWeight="800" fill="#E8E6F0" fontFamily="Inter,system-ui,sans-serif">Stock<tspan fill="url(#lg2)">r</tspan></text>
        </svg>
        <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto' }}/>
      </div>
    </div>
  )

  if (!user) return <AuthPage/>

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'depot' && <DepotPage/>}
        {tab === 'power' && <PowerPage/>}
        {tab === 'admin' && <AdminPage/>}
      </div>
      <BottomNav active={tab} onChange={setTab}/>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppShell/>
      </ToastProvider>
    </AuthProvider>
  )
}
