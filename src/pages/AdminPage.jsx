import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'

export default function AdminPage() {
  const { profile, isAdmin, signOut, updateUserRole } = useAuth()
  const toast = useToast()
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [updating, setUpdating] = useState(null)
  const [tab, setTab]           = useState(isAdmin ? 'users' : 'profile')

  useEffect(() => { if (isAdmin) loadUsers() }, [isAdmin])

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setUsers(data || [])
    setLoading(false)
  }

  async function handleRoleChange(userId, newRole) {
    setUpdating(userId)
    try {
      await updateUserRole(userId, newRole)
      setUsers(u => u.map(x => x.id === userId ? { ...x, role: newRole } : x))
      toast('Rôle mis à jour', 'success')
    } catch(err) {
      toast(err.message, 'error')
    } finally {
      setUpdating(null)
    }
  }

  async function handleDeleteUser(userId) {
    if (userId === profile?.id) { toast('Tu ne peux pas supprimer ton propre compte', 'error'); return }
    if (!confirm('Révoquer l\'accès de cet utilisateur ?')) return
    const { error } = await supabase.from('profiles').delete().eq('id', userId)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    setUsers(u => u.filter(x => x.id !== userId))
    toast('Accès révoqué', 'success')
  }

  function roleLabel(role) {
    return { admin: '👑 Admin', editor: '✏️ Éditeur', reader: '👁️ Lecteur' }[role] || role
  }

  function roleBadge(role) {
    return <span className={`badge badge-${role}`}>{roleLabel(role)}</span>
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h1>👤 Compte</h1>
          <button className="btn btn-secondary btn-sm" onClick={signOut}>Déconnexion</button>
        </div>
        {isAdmin && (
          <div style={{display:'flex',gap:6,marginTop:12}}>
            <button className={`btn btn-sm ${tab==='users'?'btn-primary':'btn-secondary'}`} onClick={() => setTab('users')}>👥 Utilisateurs</button>
            <button className={`btn btn-sm ${tab==='profile'?'btn-primary':'btn-secondary'}`} onClick={() => setTab('profile')}>Profil</button>
          </div>
        )}
      </div>

      <div className="page-content">
        {tab === 'profile' && (
          <div>
            <div className="card" style={{marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:16}}>
                <div style={{width:56,height:56,borderRadius:'50%',background:'linear-gradient(135deg,var(--indigo),var(--violet))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,fontWeight:700,color:'#fff',flexShrink:0}}>
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
                Membre depuis le {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('fr') : '—'}
              </div>
            </div>

            <div className="card">
              <div style={{fontWeight:600,marginBottom:12}}>Permissions</div>
              {[
                { icon: '👁️', label: 'Voir le dépôt et les projecteurs', ok: true },
                { icon: '✏️', label: 'Modifier étagères et produits', ok: ['admin','editor'].includes(profile?.role) },
                { icon: '⚡', label: 'Modifier le catalogue projecteurs', ok: ['admin','editor'].includes(profile?.role) },
                { icon: '👑', label: 'Gérer les utilisateurs', ok: profile?.role === 'admin' },
              ].map((p, i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom: i < 3 ? '1px solid var(--border)' : 'none'}}>
                  <span style={{fontSize:16}}>{p.icon}</span>
                  <span style={{flex:1,fontSize:14,color:p.ok?'var(--text)':'var(--text3)'}}>{p.label}</span>
                  <span style={{fontSize:16}}>{p.ok ? '✅' : '🔒'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'users' && isAdmin && (
          <div>
            {loading ? (
              <div style={{display:'flex',justifyContent:'center',padding:60}}><span className="spinner" style={{width:32,height:32}}/></div>
            ) : (
              <>
                <p style={{color:'var(--text2)',fontSize:13,marginBottom:16}}>{users.length} utilisateur{users.length > 1 ? 's' : ''} enregistré{users.length > 1 ? 's' : ''}</p>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {users.map(u => (
                    <div key={u.id} className="card">
                      <div style={{display:'flex',alignItems:'center',gap:12}}>
                        <div style={{width:44,height:44,borderRadius:'50%',background:'linear-gradient(135deg,var(--indigo),var(--violet))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:700,color:'#fff',flexShrink:0}}>
                          {u.username?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600}}>{u.username} {u.id === profile?.id && <span style={{fontSize:11,color:'var(--text3)'}}>(toi)</span>}</div>
                          <div style={{fontSize:13,color:'var(--text2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.email}</div>
                        </div>
                      </div>

                      <div style={{marginTop:12,display:'flex',gap:8,alignItems:'center'}}>
                        <span style={{fontSize:13,color:'var(--text2)',flexShrink:0}}>Rôle :</span>
                        <select
                          className="input"
                          value={u.role}
                          onChange={e => handleRoleChange(u.id, e.target.value)}
                          disabled={updating === u.id || u.id === profile?.id}
                          style={{flex:1,padding:'7px 10px'}}
                        >
                          <option value="reader">👁️ Lecteur</option>
                          <option value="editor">✏️ Éditeur</option>
                          <option value="admin">👑 Admin</option>
                        </select>
                        {updating === u.id && <span className="spinner" style={{width:16,height:16,flexShrink:0}}/>}
                        {u.id !== profile?.id && (
                          <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDeleteUser(u.id)} title="Supprimer">🗑️</button>
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
