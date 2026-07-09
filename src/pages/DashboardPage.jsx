import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function DashboardPage() {
  const [stats,    setStats]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [movements,setMovements]= useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [
      { data: shelves },
      { data: products },
      { data: moves },
    ] = await Promise.all([
      supabase.from('shelves').select('id, name'),
      supabase.from('products').select('id, quantity, min_quantity, shelf_id'),
      supabase.from('product_movements').select('*').order('created_at', { ascending: false }).limit(20),
    ])
    const allProds = products || []
    const lowStock = allProds.filter(p => p.min_quantity > 0 && p.quantity <= p.min_quantity)
    const totalQty = allProds.reduce((s, p) => s + (p.quantity || 0), 0)
    setStats({
      shelves:   (shelves  || []).length,
      products:  allProds.length,
      lowStock:  lowStock.length,
      totalQty,
    })
    setMovements(moves || [])
    setLoading(false)
  }

  const ACTION_ICON  = { add:'✅', delete:'🗑️', edit:'✏️', import:'📥' }
  const ACTION_LABEL = { add:'Ajouté', delete:'Supprimé', edit:'Modifié', import:'Importé' }

  return (
    <div className="page">
      <div className="page-header">
        <h1>📊 Stats</h1>
      </div>
      <div className="page-content">
        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:60}}><span className="spinner" style={{width:32,height:32}}/></div>
        ) : (
          <>
            {/* Stat cards */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
              {[
                { icon:'📦', label:'Étagères',       value: stats.shelves,  color:'var(--indigo2)' },
                { icon:'🗂️', label:'Produits',       value: stats.products, color:'var(--violet)'  },
                { icon:'🔢', label:'Qté totale',     value: stats.totalQty, color:'var(--green)'   },
                { icon:'⚠️', label:'Stock bas',      value: stats.lowStock, color: stats.lowStock > 0 ? 'var(--amber)' : 'var(--green)' },
              ].map(s => (
                <div key={s.label} className="card" style={{textAlign:'center',padding:'18px 12px'}}>
                  <div style={{fontSize:28,marginBottom:6}}>{s.icon}</div>
                  <div style={{fontSize:26,fontWeight:800,color:s.color,lineHeight:1}}>{s.value}</div>
                  <div style={{fontSize:12,color:'var(--text3)',marginTop:4}}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Low stock alert */}
            {stats.lowStock > 0 && (
              <div style={{marginBottom:20,padding:'12px 16px',background:'rgba(217,119,6,0.1)',border:'1px solid rgba(217,119,6,0.3)',borderRadius:'var(--radius)',display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:22}}>⚠️</span>
                <div>
                  <div style={{fontWeight:700,color:'var(--amber)',fontSize:14}}>{stats.lowStock} produit{stats.lowStock>1?'s':''} en stock bas</div>
                  <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Utilise la recherche globale (🔍) pour les localiser</div>
                </div>
              </div>
            )}

            {/* Recent movements */}
            <div className="section-header" style={{marginBottom:12}}>
              <span className="section-title">Activité récente</span>
              <span style={{fontSize:12,color:'var(--text3)'}}>{movements.length} derniers mouvements</span>
            </div>
            {movements.length === 0 ? (
              <div className="empty"><div className="empty-icon">📋</div><p>Aucune activité enregistrée</p></div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {movements.map(m => (
                  <div key={m.id} style={{display:'flex',gap:12,alignItems:'center',padding:'10px 14px',background:'var(--bg2)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                    <span style={{fontSize:20,flexShrink:0}}>{ACTION_ICON[m.action] || '📦'}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.product_name}</div>
                      <div style={{fontSize:12,color:'var(--text2)',marginTop:1}}>
                        {ACTION_LABEL[m.action] || m.action}
                        {m.shelf_name && <span style={{color:'var(--text3)'}}> · {m.shelf_name}</span>}
                        {m.quantity_change != null && m.action !== 'delete' && m.action !== 'import' && (
                          <span style={{marginLeft:4,color: m.quantity_change > 0 ? 'var(--green)' : 'var(--red)',fontWeight:700}}>
                            {m.quantity_change > 0 ? '+' : ''}{m.quantity_change}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{fontSize:11,color:'var(--text3)',flexShrink:0,textAlign:'right'}}>
                      {new Date(m.created_at).toLocaleDateString('fr', { day:'numeric', month:'short' })}
                      <div>{new Date(m.created_at).toLocaleTimeString('fr', { hour:'2-digit', minute:'2-digit' })}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
