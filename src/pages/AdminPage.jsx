import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'

export default function AdminPage() {
  const { user, profile, isAdmin, signOut, updateUserRole } = useAuth()
  const toast   = useToast()
  const confirm = useConfirm()
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [updating, setUpdating] = useState(null)
  const [tab, setTab] = useState(isAdmin ? 'users' : 'profile')
  const [pwForm, setPwForm]     = useState({ current: '', next: '', confirm: '' })
  const [pwLoading, setPwLoading] = useState(false)

  useEffect(() => { if (isAdmin) loadUsers() }, [isAdmin])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers(data || [])
    setLoading(false)
  }

  async function handleRoleChange(userId, newRole) {
    if (!['admin','editor','reader'].includes(newRole)) return
    setUpdating(userId)
    try {
      await updateUserRole(userId, newRole)
      setUsers(u => u.map(x => x.id === userId ? { ...x, role: newRole } : x))
      toast('Role mis a jour', 'success')
    } catch(err) { toast(err.message, 'error') }
    finally { setUpdating(null) }
  }

  async function handleDeleteUser(userId) {
    if (userId === profile?.id) { toast('Tu ne peux pas supprimer ton propre compte', 'error'); return }
    if (!await confirm("Revoquer l'acces de cet utilisateur ?", { confirmLabel: 'Revoquer', cancelLabel: 'Annuler' })) return
    const { error } = await supabase.from('profiles').delete().eq('id', userId)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    setUsers(u => u.filter(x => x.id !== userId))
    toast('Acces revoque', 'success')
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    if (pwForm.next.length < 6 || !/[a-zA-Z]/.test(pwForm.next) || !/[0-9]/.test(pwForm.next)) { toast('Mot de passe trop court ou invalide (min 6 caracteres, une lettre et un chiffre)', 'error'); return }
    if (pwForm.next !== pwForm.confirm) { toast('Les mots de passe ne correspondent pas', 'error'); return }
    setPwLoading(true)
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user?.email || profile?.email, password: pwForm.current })
      if (signInErr) { toast('Mot de passe actuel incorrect', 'error'); setPwLoading(false); return }
      const { error } = await supabase.auth.updateUser({ password: pwForm.next })
      if (error) throw error
      toast('Mot de passe mis a jour', 'success')
      setPwForm({ current: '', next: '', confirm: '' })
    } catch(err) { toast(err.message, 'error') }
    finally { setPwLoading(false) }
  }

  function roleLabel(role) {
    return { admin: 'Admin', editor: 'Editeur', reader: 'Lecteur' }[role] || role
  }
  function roleBadge(role) {
    return <span className={`badge badge-${role}`}>{roleLabel(role)}</span>
  }

  const PERMS = [
    { icon:'👁️', label:'Voir le depot et les equipements', ok: true },
    { icon:'✏️', label:'Modifier etageres et produits',    ok: ['admin','editor'].includes(profile?.role) },
    { icon:'🎛️', label:'Modifier le catalogue materiel',  ok: ['admin','editor'].includes(profile?.role) },
    { icon:'👑', label:'Gerer les utilisateurs',           ok: profile?.role === 'admin' },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h1>👤 Compte</h1>
          <button className="btn btn-secondary btn-sm" onClick={signOut}>Deconnexion</button>
        </div>
        <div style={{display:'flex',gap:6,marginTop:12,flexWrap:'wrap'}}>
          {isAdmin && (
            <button className={`btn btn-sm ${tab==='users'?'btn-primary':'btn-secondary'}`} onClick={() => setTab('users')}>
              👥 Utilisateurs
            </button>
          )}
          <button className={`btn btn-sm ${tab==='profile'?'btn-primary':'btn-secondary'}`} onClick={() => setTab('profile')}>Profil</button>
          <button className={`btn btn-sm ${tab==='security'?'btn-primary':'btn-secondary'}`} onClick={() => setTab('security')}>🔒 Securite</button>
        </div>
      </div>

      <div className="page-content">

        {tab === 'profile' && (
          <div>
            <div className="card" style={{marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:16}}>
                <div style={{width:60,height:60,borderRadius:'50%',background:'linear-gradient(135deg,var(--indigo),var(--violet))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,fontWeight:700,color:'#fff',flexShrink:0,boxShadow:'0 4px 16px rgba(109,40,217,0.3)'}}>
                  {profile?.username?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div style={{fontWeight:700,fontSize:18}}>{profile?.username}</div>
                  <div style={{color:'var(--text2)',fontSize:14,marginTop:2}}>{profile?.email}</div>
                  <div style={{marginTop:6}}>{roleBadge(profile?.role)}</div>
                </div>
              </div>
              <div className="divider"/>
              <div style={{fontSize:13,color:'var(--text3)'}}>
                Membre depuis le {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('fr',{day:'numeric',month:'long',year:'numeric'}) : '—'}
              </div>
            </div>
            <div className="card">
              <div style={{fontWeight:600,marginBottom:12,fontSize:14}}>Permissions</div>
              {PERMS.map((p, i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom: i < PERMS.length-1 ? '1px solid var(--border)' : 'none'}}>
                  <span style={{fontSize:16,flexShrink:0}}>{p.icon}</span>
                  <span style={{flex:1,fontSize:14,color:p.ok?'var(--text)':'var(--text3)'}}>{p.label}</span>
                  <span style={{fontSize:15}}>{p.ok ? '✅' : '🔒'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'security' && (
          <div className="card">
            <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>Changer le mot de passe</div>
            <p style={{fontSize:13,color:'var(--text2)',marginBottom:20}}>Minimum 6 caractères, au moins une lettre et un chiffre.</p>
            <form onSubmit={handlePasswordChange}>
              <div className="form-group">
                <label className="label">Mot de passe actuel</label>
                <input className="input" type="password" placeholder="••••••••" autoComplete="current-password"
                  value={pwForm.current} onChange={e => setPwForm(f => ({...f, current: e.target.value}))} required/>
              </div>
              <div className="form-group">
                <label className="label">Nouveau mot de passe</label>
                <input className="input" type="password" placeholder="••••••••" autoComplete="new-password" minLength={6}
                  value={pwForm.next} onChange={e => setPwForm(f => ({...f, next: e.target.value}))} required/>
                {pwForm.next.length > 0 && (
                  <div style={{display:'flex',gap:12,marginTop:6,fontSize:12}}>
                    <span style={{color: pwForm.next.length >= 6 ? 'var(--green)' : 'var(--text3)'}}>
                      {pwForm.next.length >= 6 ? '✅' : '○'} 6 caractères min
                    </span>
                    <span style={{color: /[a-zA-Z]/.test(pwForm.next) ? 'var(--green)' : 'var(--text3)'}}>
                      {/[a-zA-Z]/.test(pwForm.next) ? '✅' : '○'} une lettre
                    </span>
                    <span style={{color: /[0-9]/.test(pwForm.next) ? 'var(--green)' : 'var(--text3)'}}>
                      {/[0-9]/.test(pwForm.next) ? '✅' : '○'} un chiffre
                    </span>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="label">Confirmer le nouveau mot de passe</label>
                <input className="input" type="password" placeholder="••••••••" autoComplete="new-password"
                  value={pwForm.confirm} onChange={e => setPwForm(f => ({...f, confirm: e.target.value}))} required/>
              </div>
              {pwForm.next && pwForm.confirm && pwForm.next !== pwForm.confirm && (
                <p style={{fontSize:13,color:'var(--red)',marginBottom:8}}>Les mots de passe ne correspondent pas</p>
              )}
              <div className="form-actions" style={{marginTop:8}}>
                <button className="btn btn-primary" type="submit" disabled={pwLoading}>
                  {pwLoading ? <span className="spinner" style={{borderTopColor:'#fff'}}/> : '🔒 Mettre a jour'}
                </button>
              </div>
            </form>
          </div>
        )}

        {tab === 'users' && isAdmin && (
          <div>
            {loading ? (
              <div style={{display:'flex',justifyContent:'center',padding:60}}><span className="spinner" style={{width:32,height:32}}/></div>
            ) : (
              <>
                <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
                  {[
                    {label:'Total',    value: users.length,                              color:'var(--indigo2)'},
                    {label:'Editeurs', value: users.filter(u=>u.role==='editor').length, color:'var(--green)'},
                    {label:'Admins',   value: users.filter(u=>u.role==='admin').length,  color:'var(--amber)'},
                  ].map(s => (
                    <div key={s.label} className="card" style={{flex:'1 1 70px',textAlign:'center',padding:'12px 8px'}}>
                      <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.value}</div>
                      <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {users.map(u => (
                    <div key={u.id} className="card">
                      <div style={{display:'flex',alignItems:'center',gap:12}}>
                        <div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,var(--indigo),var(--violet))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'#fff',flexShrink:0}}>
                          {u.username?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600}}>
                            {u.username}
                            {u.id === profile?.id && <span style={{fontSize:11,color:'var(--text3)',marginLeft:6}}>(toi)</span>}
                          </div>
                          <div style={{fontSize:13,color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.email}</div>
                          <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>Depuis {new Date(u.created_at).toLocaleDateString('fr')}</div>
                        </div>
                      </div>
                      <div style={{marginTop:12,display:'flex',gap:8,alignItems:'center'}}>
                        <select className="input" value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}
                          disabled={updating === u.id || u.id === profile?.id} style={{flex:1,padding:'7px 10px'}}>
                          <option value="reader">👁️ Lecteur</option>
                          <option value="editor">✏️ Editeur</option>
                          <option value="admin">👑 Admin</option>
                        </select>
                        {updating === u.id && <span className="spinner" style={{width:16,height:16,flexShrink:0}}/>}
                        {u.id !== profile?.id && (
                          <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDeleteUser(u.id)} title="Revoquer">🗑️</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
