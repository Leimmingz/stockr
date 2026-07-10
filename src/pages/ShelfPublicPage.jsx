import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// ── Public shelf view — no auth required ─────────────────────
export default function ShelfPublicPage({ shelfId }) {
  const [shelf,    setShelf]    = useState(null)
  const [products, setProducts] = useState([])
  const [sections, setSections] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: s }, { data: p }, { data: sec }] = await Promise.all([
        supabase.from('shelves').select('*').eq('id', shelfId).single(),
        supabase.from('products').select('*').eq('shelf_id', shelfId).order('name'),
        supabase.from('shelf_sections').select('*').eq('shelf_id', shelfId).order('position'),
      ])
      if (!s) { setNotFound(true); setLoading(false); return }
      setShelf(s)
      setProducts(p || [])
      setSections(sec || [])
      setLoading(false)
    }
    load()
  }, [shelfId])

  const base = import.meta.env.BASE_URL.replace(/\/$/, '')

  if (loading) return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)'}}>
      <span className="spinner" style={{width:36,height:36}}/>
    </div>
  )

  if (notFound) return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,background:'var(--bg)',color:'var(--text2)'}}>
      <div style={{fontSize:56}}>❓</div>
      <div style={{fontSize:18,fontWeight:700,color:'var(--text)'}}>Étagère introuvable</div>
      <a href={base + '/'} className="btn btn-primary">Ouvrir Stockr</a>
    </div>
  )

  // Group products by section
  const sectionMap = {}
  sections.forEach(s => { sectionMap[s.id] = { ...s, items: [] } })
  const unsectioned = []
  products.forEach(p => {
    if (p.section_id && sectionMap[p.section_id]) sectionMap[p.section_id].items.push(p)
    else unsectioned.push(p)
  })
  const sectionList = Object.values(sectionMap)
  const lowStock = products.filter(p => p.min_quantity > 0 && p.quantity <= p.min_quantity)

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',paddingBottom:40}}>
      {/* Header */}
      <div style={{background:'var(--bg2)',borderBottom:'1px solid var(--border)',padding:'16px 20px',position:'sticky',top:0,zIndex:10}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',maxWidth:600,margin:'0 auto'}}>
          <div>
            <div style={{fontWeight:800,fontSize:18,color:'var(--text)'}}>{shelf.name}</div>
            {shelf.description && <div style={{fontSize:13,color:'var(--text2)',marginTop:2}}>{shelf.description}</div>}
          </div>
          <a href={base + '/'} style={{textDecoration:'none'}}>
            <svg viewBox="0 0 60 30" width="48" height="24" xmlns="http://www.w3.org/2000/svg">
              <defs><linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#4F46E5"/><stop offset="100%" stopColor="#7C3AED"/></linearGradient></defs>
              <rect x="1" y="1" width="2.5" height="28" rx="1.2" fill="url(#lg)"/>
              <rect x="21" y="1" width="2.5" height="28" rx="1.2" fill="url(#lg)"/>
              <rect x="1" y="1" width="23" height="3.5" rx="1.75" fill="url(#lg)"/>
              <rect x="1" y="14" width="23" height="3.5" rx="1.75" fill="url(#lg)"/>
              <rect x="1" y="26.5" width="23" height="3.5" rx="1.75" fill="url(#lg)"/>
              <text x="27" y="22" fontSize="14" fontWeight="800" fill="var(--text)" fontFamily="Inter,system-ui,sans-serif">Stock<tspan fill="url(#lg)">r</tspan></text>
            </svg>
          </a>
        </div>
      </div>

      <div style={{maxWidth:600,margin:'0 auto',padding:'20px 16px'}}>

        {/* Stats */}
        <div style={{display:'flex',gap:10,marginBottom:20,flexWrap:'wrap'}}>
          {[
            { label:'Produits',   value: products.length,  color:'var(--indigo2)' },
            { label:'Sections',   value: sections.length,  color:'var(--text2)' },
            { label:'Stock bas',  value: lowStock.length,  color: lowStock.length > 0 ? 'var(--amber)' : 'var(--green)' },
          ].map(s => (
            <div key={s.label} className="card" style={{flex:'1 1 80px',textAlign:'center',padding:'12px 8px'}}>
              <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.value}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Low stock alert */}
        {lowStock.length > 0 && (
          <div style={{marginBottom:20,padding:'12px 16px',background:'rgba(217,119,6,0.1)',border:'1px solid rgba(217,119,6,0.3)',borderRadius:'var(--radius)',display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:20}}>⚠️</span>
            <div>
              <div style={{fontWeight:600,fontSize:14,color:'var(--amber)'}}>Stock bas</div>
              <div style={{fontSize:13,color:'var(--text2)'}}>{lowStock.map(p => p.name).join(', ')}</div>
            </div>
          </div>
        )}

        {/* Shelf image */}
        {shelf.image_url && (
          <img src={shelf.image_url} style={{width:'100%',maxHeight:200,objectFit:'cover',borderRadius:'var(--radius-lg)',marginBottom:20,border:'1px solid var(--border)'}} alt={shelf.name}/>
        )}

        {products.length === 0 ? (
          <div className="empty"><div className="empty-icon">📦</div><p>Aucun produit dans cette étagère</p></div>
        ) : (
          <>
            {/* Sections */}
            {sectionList.map(sec => sec.items.length > 0 && (
              <div key={sec.id} style={{marginBottom:20}}>
                <div style={{fontWeight:700,fontSize:14,color:'var(--text2)',marginBottom:10,paddingBottom:6,borderBottom:'1px solid var(--border)',textTransform:'uppercase',letterSpacing:0.5}}>
                  {sec.name}
                </div>
                <ProductList products={sec.items}/>
              </div>
            ))}
            {/* Unsectioned */}
            {unsectioned.length > 0 && (
              <div>
                {sectionList.length > 0 && (
                  <div style={{fontWeight:700,fontSize:14,color:'var(--text2)',marginBottom:10,paddingBottom:6,borderBottom:'1px solid var(--border)',textTransform:'uppercase',letterSpacing:0.5}}>
                    Autres
                  </div>
                )}
                <ProductList products={unsectioned}/>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{marginTop:32,textAlign:'center',fontSize:13,color:'var(--text3)'}}>
          Vue en lecture seule · <a href={base + '/'} style={{color:'var(--indigo2)',textDecoration:'none',fontWeight:600}}>Ouvrir dans Stockr</a>
        </div>
      </div>
    </div>
  )
}

function ProductList({ products }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {products.map(p => {
        const isLow = p.min_quantity > 0 && p.quantity <= p.min_quantity
        return (
          <div key={p.id} className="card" style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',border: isLow ? '1px solid rgba(217,119,6,0.35)' : undefined}}>
            {p.image_url
              ? <img src={p.image_url} style={{width:48,height:48,borderRadius:8,objectFit:'cover',flexShrink:0}} alt=""/>
              : <div style={{width:48,height:48,borderRadius:8,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>📦</div>
            }
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
              {p.description && <div style={{fontSize:12,color:'var(--text2)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.description}</div>}
              {p.tags && (
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>
                  {(Array.isArray(p.tags) ? p.tags : p.tags.split(',')).map(t => t.trim()).filter(Boolean).map(t => (
                    <span key={t} className="chip" style={{fontSize:11,padding:'2px 8px'}}>{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontWeight:800,fontSize:18,color: isLow ? 'var(--amber)' : 'var(--text)'}}>
                {p.quantity}{p.unit ? ` ${p.unit}` : ''}
              </div>
              {isLow && <div style={{fontSize:11,color:'var(--amber)',fontWeight:600}}>⚠️ bas</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
