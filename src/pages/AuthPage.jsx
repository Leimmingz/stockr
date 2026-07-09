import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'

export default function AuthPage() {
  const [mode, setMode]       = useState('login') // login | register
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [cooldown, setCooldown] = useState(0)
  const { signIn, signUp }    = useAuth()
  const toast                 = useToast()

  // Client-side rate limit: after 5 failed attempts, 30s cooldown
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => { if (c <= 1) { clearInterval(t); return 0 } return c - 1 }), 1000)
    return () => clearInterval(t)
  }, [cooldown > 0])

  async function handleSubmit(e) {
    e.preventDefault()
    if (cooldown > 0) return
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
        toast('Bienvenue !', 'success')
      } else {
        if (!username.trim()) { toast('Pseudo requis', 'error'); setLoading(false); return }
        await signUp(email, password, username.trim())
        toast('Compte créé — connecte-toi', 'success')
        setMode('login')
      }
    } catch (err) {
      toast(err.message || 'Erreur', 'error')
      if (mode === 'login') {
        const next = attempts + 1
        setAttempts(next)
        if (next >= 5) { setCooldown(30); setAttempts(0); toast('Trop de tentatives — attends 30s', 'error') }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--bg)' /* light gray */ }}>
      {/* Logo */}
      <div style={{ marginBottom: 36, textAlign: 'center' }}>
        <svg viewBox="0 0 120 60" width="120" height="60" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4F46E5"/>
              <stop offset="100%" stopColor="#7C3AED"/>
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="4" height="56" rx="2" fill="url(#lg)"/>
          <rect x="42" y="2" width="4" height="56" rx="2" fill="url(#lg)"/>
          <rect x="2" y="2" width="44" height="5" rx="2.5" fill="url(#lg)"/>
          <rect x="2" y="29" width="44" height="5" rx="2.5" fill="url(#lg)"/>
          <rect x="2" y="55" width="44" height="5" rx="2.5" fill="url(#lg)"/>
          <rect x="8" y="10" width="12" height="17" rx="2" fill="#818CF8" opacity="0.9"/>
          <rect x="23" y="14" width="10" height="13" rx="2" fill="#A78BFA" opacity="0.8"/>
          <rect x="35" y="11" width="8" height="16" rx="2" fill="#818CF8" opacity="0.7"/>
          <rect x="8" y="37" width="14" height="16" rx="2" fill="#A78BFA" opacity="0.9"/>
          <rect x="26" y="40" width="9" height="13" rx="2" fill="#818CF8" opacity="0.8"/>
          <text x="52" y="42" fontSize="26" fontWeight="800" fill="#111118" fontFamily="Inter,system-ui,sans-serif">Stock<tspan fill="url(#lg)">r</tspan></text>
        </svg>
        <p style={{ color: 'var(--text2)', fontSize: 12, letterSpacing: 2, marginTop: 6, textTransform: 'uppercase' }}>Gestion de dépôt</p>
      </div>

      {/* Card */}
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>
          {mode === 'login' ? 'Connexion' : 'Créer un compte'}
        </h2>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label className="label">Pseudo</label>
              <input className="input" type="text" placeholder="ton_pseudo" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username"/>
            </div>
          )}
          <div className="form-group">
            <label className="label">Email</label>
            <input className="input" type="email" placeholder="email@exemple.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"/>
          </div>
          <div className="form-group">
            <label className="label">Mot de passe</label>
            <input className="input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/>
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading || cooldown > 0} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
            {loading ? <span className="spinner" style={{ borderTopColor: '#fff' }}/> : cooldown > 0 ? `Attends ${cooldown}s...` : mode === 'login' ? 'Se connecter' : "Créer le compte"}
          </button>
        </form>

        <div className="divider"/>
        <p style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 14 }}>
          {mode === 'login' ? "Pas encore de compte ?" : "Déjà un compte ?"}{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ display: 'inline', padding: '2px 6px', color: 'var(--indigo2)', fontWeight: 600 }}>
            {mode === 'login' ? "S'inscrire" : "Se connecter"}
          </button>
        </p>
      </div>
    </div>
  )
}
