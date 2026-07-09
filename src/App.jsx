import { useState, useEffect } from 'react'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useAuth, AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './hooks/useToast'
import { useTheme } from './hooks/useTheme'
import { ConfirmProvider } from './hooks/useConfirm'
import AuthPage     from './pages/AuthPage'
import DepotPage    from './pages/DepotPage'
import MaterielPage from './pages/MaterielPage'
import AdminPage         from './pages/AdminPage'
import ShelfPublicPage   from './pages/ShelfPublicPage'
import DashboardPage     from './pages/DashboardPage'
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
  if (!shelf)   return <div className="page"><div className="page-content" style={{display:'flex',justifyContent:'center',paddingTop:80}}><span className="spinner" style={{width:40,height:40}}/></div></div>
  return <DepotPage initialShelfId={shelfId}/>
}

// ── Navigation ────────────────────────────────────────────────
const TABS = [
  { id: 'depot',     icon: '🏭', label: 'Dépôt'    },
  { id: 'materiel',  icon: '🎛️', label: 'Matériel' },
  { id: 'stats',     icon: '📊', label: 'Stats'    },
  { id: 'admin',     icon: '👤', label: 'Compte'   },
]

function BottomNav({ active, onChange, themeIcon, onTheme }) {
  return (
    <nav className="bottom-nav">
      {TABS.map(t => (
        <button key={t.id} className={`nav-item ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          <span className="nav-icon">{t.icon}</span>
          {t.label}
        </button>
      ))}
      <button className="nav-item" onClick={onTheme} title="Changer le thème (clair / sombre / système)">
        <span className="nav-icon">{themeIcon}</span>
        Thème
      </button>
    </nav>
  )
}

// ── App shell ─────────────────────────────────────────────────
function AppShell() {
  const { user, loading }  = useAuth()
  const [tab, setTab]      = useState('depot')
  const { updateAvailable, applyUpdate } = useAppUpdate()
  const { themeIcon, cycleTheme } = useTheme()

  useEffect(() => {
    const path = window.location.pathname
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = path.match(new RegExp(`^${escapedBase}/shelf/([a-f0-9-]{36})$`, 'i'))
    if (m) {
      setTab('depot')
      window.__pendingShelfId = m[1]
      window.history.replaceState(null, '', base + '/')
    }
  }, [])

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg2)' }}>
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
          <text x="36" y="28" fontSize="18" fontWeight="800" fill="var(--text)" fontFamily="Inter,system-ui,sans-serif">Stock<tspan fill="url(#lg2)">r</tspan></text>
        </svg>
        <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto' }}/>
      </div>
    </div>
  )

  if (!user) return <AuthPage/>

  return (
    <div className="app-shell">
      {updateAvailable && (
        <div style={{
          position:'fixed', top:0, left:0, right:0, zIndex:9999,
          background:'var(--indigo2)', color:'#fff', padding:'10px 16px',
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
          fontSize:14, fontWeight:600, boxShadow:'0 2px 16px rgba(0,0,0,0.4)',
        }}>
          <span>🚀 Nouvelle version disponible !</span>
          <button onClick={applyUpdate} style={{
            background:'#fff', color:'var(--indigo)', border:'none', borderRadius:8,
            padding:'6px 14px', fontWeight:700, fontSize:13, cursor:'pointer',
          }}>Mettre à jour</button>
        </div>
      )}
      <BottomNav active={tab} onChange={setTab} themeIcon={themeIcon} onTheme={cycleTheme}/>
      <div className="app-content">
        {tab === 'depot'    && <DepotPage/>}
        {tab === 'materiel' && <MaterielPage/>}
        {tab === 'stats'    && <DashboardPage/>}
        {tab === 'admin'    && <AdminPage/>}
      </div>
    </div>
  )
}

export default
function App() {
  // Detect /shelf/:id BEFORE auth — public read-only view
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = window.location.pathname.match(new RegExp(`^${escapedBase}/shelf/([a-f0-9-]{36})$`, 'i'))
  if (m) return (
    <ToastProvider>
      <ShelfPublicPage shelfId={m[1]}/>
    </ToastProvider>
  )

  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AppShell/>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
