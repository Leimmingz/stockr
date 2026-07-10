import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast }   from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'
import QRCode from 'qrcode'
import { compressAndUpload } from '../lib/imageUtils'

const PRESET_COLORS = ['#4F46E5','#7C3AED','#DB2777','#DC2626','#EA580C','#D97706','#65A30D','#16A34A','#0891B2','#0284C7','#6B7280','#374151']

function getGridSettings() {
  try {
    return {
      cols: Math.max(2, parseInt(localStorage.getItem('gridCols') || '12')),
      rows: Math.max(2, parseInt(localStorage.getItem('gridRows') || '8')),
    }
  } catch { return { cols: 12, rows: 8 } }
}

async function generateQR(shelfId) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const url = `${window.location.origin}${base}/shelf/${shelfId}`
  return await QRCode.toDataURL(url, { width: 256, margin: 2, color: { dark: '#1E1B4B', light: '#FFFFFF' } })
}

async function logMovement(action, productName, shelfName, shelfId, quantityChange = null) {
  try {
    await supabase.from('product_movements').insert({
      action,
      product_name: String(productName || '').slice(0, 255),
      shelf_name: String(shelfName || '').slice(0, 255),
      shelf_id: shelfId,
      quantity_change: quantityChange,
    })
  } catch (_) {} // non-blocking — historique best-effort
}

// Escape HTML to prevent XSS in print windows
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function ColorPicker({ value, onChange }) {
  return (
    <div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
        {PRESET_COLORS.map(c => (
          <button key={c} type="button"
            style={{width:28,height:28,borderRadius:6,background:c,border:value===c?'3px solid #fff':'2px solid transparent',
              boxShadow:value===c?`0 0 0 2px ${c}`:'none',cursor:'pointer',padding:0,flexShrink:0}}
            onClick={() => onChange(c)}/>
        ))}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <input type="color" value={value||'#4F46E5'} onChange={e => onChange(e.target.value)}
          style={{width:36,height:36,border:'none',borderRadius:6,cursor:'pointer',padding:2,background:'var(--bg3)'}}/>
        <span style={{fontSize:13,color:'var(--text2)'}}>Couleur libre</span>
        {value && <button className="btn btn-ghost btn-sm" style={{fontSize:12}} onClick={() => onChange('')}>↩ Zone</button>}
      </div>
    </div>
  )
}

function GridSettingsModal({ onClose, onApply }) {
  const { cols, rows } = getGridSettings()
  const [c, setC] = useState(cols)
  const [r, setR] = useState(rows)
  function save() {
    localStorage.setItem('gridCols', String(Math.max(2, Math.min(30, c))))
    localStorage.setItem('gridRows', String(Math.max(2, Math.min(30, r))))
    onApply(); onClose()
  }
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">⚙️ Taille de la grille</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="label">Colonnes (2–30)</label>
            <input className="input" type="number" min={2} max={30} value={c} onChange={e => setC(+e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="label">Rangées (2–30)</label>
            <input className="input" type="number" min={2} max={30} value={r} onChange={e => setR(+e.target.value)}/>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={save}>Appliquer</button>
        </div>
      </div>
    </div>
  )
}

function ShelfModal({ shelf, zones, gridCols, gridRows, onClose, onSave }) {
  const [name,    setName]    = useState(shelf?.name || '')
  const [zoneId,  setZoneId]  = useState(shelf?.zone_id || '')
  const [desc,    setDesc]    = useState(shelf?.description || '')
  const [gridX,   setGridX]   = useState(shelf?.grid_x ?? 0)
  const [gridY,   setGridY]   = useState(shelf?.grid_y ?? 0)
  const [gridW,   setGridW]   = useState(shelf?.grid_w ?? 1)
  const [gridH,   setGridH]   = useState(shelf?.grid_h ?? 1)
  const [color,   setColor]   = useState(shelf?.color || '')
  const [imgFile, setImgFile] = useState(null)
  const [imgPrev, setImgPrev] = useState(shelf?.image_url || null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  async function handleSave() {
    if (!name.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      let imageUrl = shelf?.image_url || null
      if (imgFile) imageUrl = await compressAndUpload(imgFile, 'depot-images', `shelf_${name.replace(/\s/g,'_')}`)
      const payload = {
        name: name.trim(), zone_id: zoneId || null, description: desc,
        grid_x: +gridX, grid_y: +gridY, grid_w: Math.max(1,+gridW), grid_h: Math.max(1,+gridH),
        color: color || null, image_url: imageUrl,
      }
      let savedShelf
      if (shelf?.id) {
        const { data, error } = await supabase.from('shelves').update(payload).eq('id', shelf.id).select().single()
        if (error) throw error
        savedShelf = data
      } else {
        const { data, error } = await supabase.from('shelves').insert(payload).select().single()
        if (error) throw error
        savedShelf = data
        const qrData = await generateQR(savedShelf.id)
        const blob = await fetch(qrData).then(r => r.blob())
        const qrUrl = await compressAndUpload(new File([blob], 'qr.png', { type: 'image/png' }), 'qr-codes', `qr_${savedShelf.id}`)
        await supabase.from('shelves').update({ qr_code_url: qrUrl }).eq('id', savedShelf.id)
        savedShelf.qr_code_url = qrUrl
      }
      onSave(savedShelf)
      toast(shelf?.id ? 'Étagère mise à jour' : 'Étagère créée', 'success')
      onClose()
    } catch(err) { toast(err.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">{shelf?.id ? 'Modifier' : 'Nouvelle'} étagère</h3>
        <div className="form-group">
          <label className="label">Nom</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Étagère A1" maxLength={100}/>
        </div>
        <div className="form-group">
          <label className="label">Zone</label>
          <select className="input" value={zoneId} onChange={e => setZoneId(e.target.value)}>
            <option value="">Sans zone</option>
            {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Couleur personnalisée</label>
          <ColorPicker value={color} onChange={setColor}/>
        </div>
        <div className="form-group">
          <label className="label">Position dans la grille</label>
          <div className="form-row">
            <div className="form-group">
              <label className="label" style={{fontSize:11,color:'var(--text3)'}}>X — colonne (0 à {gridCols-1})</label>
              <input className="input" type="number" min={0} max={gridCols-1} value={gridX} onChange={e => setGridX(e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="label" style={{fontSize:11,color:'var(--text3)'}}>Y — rangée (0 à {gridRows-1})</label>
              <input className="input" type="number" min={0} max={gridRows-1} value={gridY} onChange={e => setGridY(e.target.value)}/>
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="label">Taille (groupe de cases)</label>
          <div className="form-row">
            <div className="form-group">
              <label className="label" style={{fontSize:11,color:'var(--text3)'}}>Largeur</label>
              <input className="input" type="number" min={1} max={gridCols} value={gridW} onChange={e => setGridW(e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="label" style={{fontSize:11,color:'var(--text3)'}}>Hauteur</label>
              <input className="input" type="number" min={1} max={gridRows} value={gridH} onChange={e => setGridH(e.target.value)}/>
            </div>
          </div>
          {(+gridW > 1 || +gridH > 1) && <p style={{fontSize:12,color:'var(--text3)',marginTop:4}}>Occupe {+gridW} × {+gridH} cases</p>}
        </div>
        <div className="form-group">
          <label className="label">Description</label>
          <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Contenu, notes..."/>
        </div>
        <div className="form-group">
          <label className="label">Photo</label>
          <label className="upload-zone">
            <input type="file" accept="image/*" style={{display:'none'}} onChange={e => {
              const f = e.target.files[0]
              if (f) { setImgFile(f); setImgPrev(prev => { if(prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f) }) }
            }}/>
            {imgPrev ? <img src={imgPrev} className="upload-preview" alt="preview"/> : <><div style={{fontSize:32}}>📷</div><div style={{marginTop:8,fontSize:13}}>Choisir une photo</div></>}
          </label>
        </div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? <span className="spinner" style={{borderTopColor:'#fff'}}/> : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Product Card ───────────────────────────────────────────────
function ProductCard({ product, sections, isEditor, shelfName, onRefresh }) {
  const toast    = useToast()
  const confirmFn = useConfirm()
  const section = sections.find(s => s.id === product.section_id)
  const [localQty, setLocalQty] = useState(product.quantity)
  const [qtyLoading, setQtyLoading] = useState(false)
  const pendingDelta = useRef(0)
  const flushTimer   = useRef(null)
  const tags = product.tags ? (Array.isArray(product.tags) ? product.tags : product.tags.split(',')).map(t => t.trim()).filter(Boolean) : []

  // Keep local qty in sync when parent refreshes (from another client, etc.)
  useEffect(() => { setLocalQty(product.quantity) }, [product.quantity])

  // Debounced flush: accumulates rapid clicks, sends ONE DB write after 600ms idle
  function handleQtyChange(delta) {
    if (!isEditor) return
    const next = Math.max(0, localQty + pendingDelta.current + delta)
    if (next === localQty + pendingDelta.current) return // already at 0, ignore −
    pendingDelta.current += delta
    setLocalQty(Math.max(0, product.quantity + pendingDelta.current))
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(async () => {
      const d = pendingDelta.current
      pendingDelta.current = 0
      if (d === 0) return
      setQtyLoading(true)
      const { error } = await supabase.rpc('increment_product_qty', { product_id: product.id, delta: d })
      if (error) {
        const newQty = Math.max(0, product.quantity + d)
        const { error: e2 } = await supabase.from('products').update({ quantity: newQty }).eq('id', product.id)
        if (e2) { toast('Erreur : ' + e2.message, 'error'); setQtyLoading(false); onRefresh(); return }
      }
      await logMovement('edit', product.name, shelfName, product.shelf_id, d)
      setQtyLoading(false)
      onRefresh()
    }, 600)
  }

  const [showMove, setShowMove] = useState(false)
  const [showHist, setShowHist] = useState(false)
  const [moveTarget, setMoveTarget] = useState('')
  const [moveShelves, setMoveShelves] = useState([])
  const [movingProd, setMovingProd] = useState(false)
  const [prodHistory, setProdHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)

  async function handleDelete() {
    if (!await confirmFn('Supprimer ce produit ?', { confirmLabel: 'Supprimer' })) return
    await logMovement('delete', product.name, shelfName, product.shelf_id)
    const { error } = await supabase.from('products').delete().eq('id', product.id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    toast('Produit supprimé', 'success')
    onRefresh()
  }

  async function openMove() {
    const { data } = await supabase.from('shelves').select('id, name').order('name')
    setMoveShelves((data || []).filter(s => s.id !== product.shelf_id))
    setMoveTarget('')
    setShowMove(true)
  }

  async function handleMove() {
    if (!moveTarget) return
    setMovingProd(true)
    const dest = moveShelves.find(s => s.id === moveTarget)
    const { error } = await supabase.from('products').update({ shelf_id: moveTarget, section_id: null }).eq('id', product.id)
    if (error) { toast(error.message, 'error'); setMovingProd(false); return }
    await logMovement('edit', product.name, `${shelfName} → ${dest?.name}`, product.shelf_id)
    toast(`Déplacé vers ${dest?.name}`, 'success')
    setMovingProd(false); setShowMove(false); onRefresh()
  }

  async function openHistory() {
    setShowHist(true); setHistLoading(true)
    const { data } = await supabase.from('product_movements').select('*')
      .eq('product_name', product.name).order('created_at', { ascending: false }).limit(30)
    setProdHistory(data || []); setHistLoading(false)
  }

  const isLow = product.min_quantity > 0 && product.quantity <= product.min_quantity

  return (
    <div style={{display:'flex',gap:12,alignItems:'flex-start',padding:'10px 14px',
      background: isLow ? 'rgba(220,38,38,0.06)' : 'var(--bg3)',
      borderRadius:'var(--radius)',border: isLow ? '1px solid rgba(220,38,38,0.3)' : '1px solid var(--border)'}}>
      {product.image_url && <img src={product.image_url} style={{width:48,height:48,borderRadius:8,objectFit:'cover',flexShrink:0,marginTop:2}} alt={product.name}/>}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:14,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          {product.name}
          {isLow && <span title="Stock bas !">⚠️</span>}
        </div>
        {section && <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>🗂 {section.name}</div>}
        {product.reference && <div style={{fontSize:12,color:'var(--text3)'}}>Réf: {product.reference}</div>}
        {tags.length > 0 && (
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>
            {tags.map(t => (
              <span key={t} style={{fontSize:10,background:'var(--bg)',borderRadius:10,padding:'1px 7px',border:'1px solid var(--border)',color:'var(--text2)'}}>
                {t}
              </span>
            ))}
          </div>
        )}
        <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6,flexWrap:'wrap'}}>
          <span style={{fontSize:13,color: isLow ? 'var(--red)' : 'var(--text2)',fontWeight: isLow ? 700 : 400}}>
            Qté: <strong>{localQty} {product.unit}</strong>
            {product.min_quantity > 0 && <span style={{fontSize:11,color:'var(--text3)',marginLeft:6}}>min {product.min_quantity}</span>}
          </span>
          {isEditor && (
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              <button className="btn btn-secondary btn-sm" style={{padding:'2px 10px',fontSize:16,lineHeight:1,minWidth:28}}
                onClick={() => handleQtyChange(-1)} disabled={qtyLoading || localQty <= 0}>−</button>
              <button className="btn btn-primary btn-sm" style={{padding:'2px 10px',fontSize:16,lineHeight:1,minWidth:28}}
                onClick={() => handleQtyChange(1)} disabled={qtyLoading}>+</button>
            </div>
          )}
        </div>
        {isLow && <div style={{fontSize:12,color:'var(--red)',marginTop:2,fontWeight:600}}>⚠️ Stock bas — réapprovisionner</div>}
      </div>
      {isEditor && (
        <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={handleDelete} style={{color:'var(--red)',fontSize:16}} title="Supprimer">🗑️</button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={openMove}    style={{fontSize:14}} title="Déplacer vers une autre étagère">↕️</button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={openHistory} style={{fontSize:14}} title="Historique de ce produit">📋</button>
        </div>
      )}

      {/* Move modal */}
      {showMove && (
        <div className="modal-overlay" style={{zIndex:2100}} onClick={e => e.target===e.currentTarget && setShowMove(false)}>
          <div className="modal" style={{maxWidth:360}}>
            <h3 className="modal-title">↕️ Déplacer — {product.name}</h3>
            <div className="form-group">
              <label className="label">Étagère de destination</label>
              <select className="input" value={moveTarget} onChange={e => setMoveTarget(e.target.value)}>
                <option value="">Choisir...</option>
                {moveShelves.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowMove(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleMove} disabled={!moveTarget || movingProd}>
                {movingProd ? <span className="spinner" style={{borderTopColor:'#fff'}}/> : 'Déplacer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {showHist && (
        <div className="modal-overlay" style={{zIndex:2100}} onClick={e => e.target===e.currentTarget && setShowHist(false)}>
          <div className="modal" style={{maxWidth:400}}>
            <h3 className="modal-title">📋 Historique — {product.name}</h3>
            {histLoading ? (
              <div style={{display:'flex',justifyContent:'center',padding:32}}><span className="spinner" style={{width:28,height:28}}/></div>
            ) : prodHistory.length === 0 ? (
              <div className="empty" style={{padding:'20px 0'}}><div className="empty-icon" style={{fontSize:32}}>📋</div><p>Aucun mouvement enregistré</p></div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:'55vh',overflowY:'auto'}}>
                {prodHistory.map(m => (
                  <div key={m.id} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'9px 12px',background:'var(--bg3)',borderRadius:8,border:'1px solid var(--border)'}}>
                    <span style={{fontSize:16,flexShrink:0}}>
                      {{add:'✅',delete:'🗑️',edit:'✏️',import:'📥'}[m.action] || '📦'}
                    </span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600}}>
                        {{add:'Ajouté',delete:'Supprimé',edit:'Modifié',import:'Importé'}[m.action] || m.action}
                        {m.quantity_change != null && m.action !== 'delete' && (
                          <span style={{marginLeft:6,color: m.quantity_change > 0 ? 'var(--green)' : 'var(--red)',fontWeight:700}}>
                            {m.quantity_change > 0 ? '+' : ''}{m.quantity_change}
                          </span>
                        )}
                      </div>
                      {m.shelf_name && <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{m.shelf_name}</div>}
                      <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>{new Date(m.created_at).toLocaleString('fr-FR')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="form-actions" style={{marginTop:16}}>
              <button className="btn btn-secondary" onClick={() => setShowHist(false)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add Product Form ───────────────────────────────────────────
function AddProductForm({ shelfId, shelfName, sections, onSave, onCancel }) {
  const [mode,        setMode]        = useState('new') // 'new' | 'existing'
  const [name,        setName]        = useState('')
  const [ref,         setRef]         = useState('')
  const [qty,         setQty]         = useState(1)
  const [minQty,      setMinQty]      = useState(0)
  const [unit,        setUnit]        = useState('pcs')
  const [desc,        setDesc]        = useState('')
  const [tags,        setTags]        = useState('')
  const [sectionId,   setSectionId]   = useState('')
  const [imgFile,     setImgFile]     = useState(null)
  const [imgPrev,     setImgPrev]     = useState(null)
  const [loading,     setLoading]     = useState(false)
  // existing stock picker
  const [stockSearch,  setStockSearch]  = useState('')
  const [stockResults, setStockResults] = useState([])
  const [stockLoading, setStockLoading] = useState(false)
  const stockTimer = useRef(null)
  const toast = useToast()

  useEffect(() => {
    if (mode !== 'existing') return
    clearTimeout(stockTimer.current)
    stockTimer.current = setTimeout(async () => {
      setStockLoading(true)
      let q = supabase.from('products').select('*, shelves(name)')
        .neq('shelf_id', shelfId).order('name').limit(40)
      const s = stockSearch.trim()
      if (s) q = q.or(`name.ilike.%${s}%,reference.ilike.%${s}%`)
      const { data, error } = await q
      if (error) console.error('stock search error', error)
      setStockResults(data || [])
      setStockLoading(false)
    }, 250)
    return () => clearTimeout(stockTimer.current)
  }, [stockSearch, mode])

  async function handlePickExisting(product) {
    setLoading(true)
    try {
      const { error: insErr } = await supabase.from('products').insert({
        name: product.name, reference: product.reference,
        quantity: product.quantity, min_quantity: product.min_quantity,
        unit: product.unit, description: product.description,
        tags: product.tags, image_url: product.image_url,
        shelf_id: shelfId, section_id: null,
      })
      if (insErr) throw insErr
      await logMovement('add', product.name, shelfName, shelfId, product.quantity)
      toast(`${product.name} ajouté depuis le stock`, 'success')
      onSave()
    } catch(err) { toast(err.message, 'error') }
    finally { setLoading(false) }
  }

  async function handleSave() {
    if (!name.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      let imageUrl = null
      if (imgFile) imageUrl = await compressAndUpload(imgFile, 'depot-images', `product_${name.replace(/\s/g,'_')}`)
      const { error: insErr } = await supabase.from('products').insert({
        name: name.trim(), reference: ref, quantity: +qty, min_quantity: +minQty,
        unit, description: desc, tags: tags.trim() ? tags.trim().split(',').map(t=>t.trim()).filter(Boolean) : null,
        shelf_id: shelfId, section_id: sectionId || null, image_url: imageUrl,
      })
      if (insErr) throw insErr
      await logMovement('add', name.trim(), shelfName, shelfId, +qty)
      toast('Produit ajouté', 'success')
      onSave()
    } catch(err) { toast(err.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <>
      <h3 className="modal-title">{mode === 'existing' ? '📦 Depuis le stock' : 'Nouveau produit'}</h3>

      {/* Mode toggle */}
      <div style={{display:'flex',gap:6,marginBottom:16}}>
        <button className={`btn btn-sm ${mode==='new'?'btn-primary':'btn-secondary'}`} onClick={() => setMode('new')}>✨ Nouveau</button>
        <button className={`btn btn-sm ${mode==='existing'?'btn-primary':'btn-secondary'}`} onClick={() => { setMode('existing'); setStockSearch('') }}>📦 Depuis le stock</button>
      </div>

      {mode === 'existing' ? (
        <div>
          <input className="input" placeholder="Rechercher dans tout le stock..." value={stockSearch}
            onChange={e => setStockSearch(e.target.value)} style={{marginBottom:12}} autoFocus/>
          {stockLoading ? (
            <div style={{display:'flex',justifyContent:'center',padding:24}}><span className="spinner"/></div>
          ) : stockResults.length === 0 ? (
            <div className="empty" style={{padding:'20px 0'}}>
              <div className="empty-icon" style={{fontSize:32}}>📦</div>
              <p>{stockSearch ? 'Aucun résultat' : 'Aucun produit dans les autres étagères'}</p>
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:'50vh',overflowY:'auto'}}>
              {stockResults.map(p => (
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                  {p.image_url
                    ? <img src={p.image_url} style={{width:40,height:40,borderRadius:6,objectFit:'cover',flexShrink:0}} alt=""/>
                    : <div style={{width:40,height:40,borderRadius:6,background:'var(--bg2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>📦</div>
                  }
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                    <div style={{fontSize:12,color:'var(--text3)'}}>
                      {p.shelves?.name && <span>📍 {p.shelves.name} · </span>}
                      Qté: {p.quantity} {p.unit}
                      {p.reference && <span> · {p.reference}</span>}
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => handlePickExisting(p)} disabled={loading}>+ Ajouter</button>
                </div>
              ))}
            </div>
          )}
          <div className="form-actions" style={{marginTop:16}}>
            <button className="btn btn-secondary" onClick={onCancel}>Annuler</button>
          </div>
        </div>
      ) : (
      <>
      <div className="form-group"><label className="label">Nom</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Machine à fumée" maxLength={255}/>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="label">Référence</label>
          <input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="REF-001" maxLength={100}/>
        </div>
        <div className="form-group"><label className="label">Étage / Section</label>
          <select className="input" value={sectionId} onChange={e => setSectionId(e.target.value)}>
            <option value="">Aucun</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="label">Quantité</label>
          <input className="input" type="number" min={0} max={99999} value={qty} onChange={e => setQty(e.target.value)}/>
        </div>
        <div className="form-group"><label className="label">Unité</label>
          <select className="input" value={unit} onChange={e => setUnit(e.target.value)}>
            {['pcs','boîte','kg','m','lot','câble','rouleau'].map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="label">Quantité minimum (alerte stock bas)</label>
        <input className="input" type="number" min={0} value={minQty} onChange={e => setMinQty(e.target.value)} placeholder="0 = pas d'alerte"/>
      </div>
      <div className="form-group">
        <label className="label">Tags / Catégories</label>
        <input className="input" value={tags} onChange={e => setTags(e.target.value)}
          placeholder="lumière, câble, sono  (séparés par des virgules)" maxLength={500}/>
        <p style={{fontSize:12,color:'var(--text3)',marginTop:4}}>Permets de filtrer et retrouver les produits par catégorie</p>
      </div>
      <div className="form-group"><label className="label">Description</label>
        <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Notes..."/>
      </div>
      <div className="form-group">
        <label className="label">Photo</label>
        <label className="upload-zone">
          <input type="file" accept="image/*" style={{display:'none'}} onChange={e => {
            const f = e.target.files[0]
            if (f) { setImgFile(f); setImgPrev(prev => { if(prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f) }) }
          }}/>
          {imgPrev ? <img src={imgPrev} className="upload-preview" alt="preview"/> : <><div style={{fontSize:28}}>📷</div><div style={{fontSize:13,marginTop:6}}>Ajouter une photo</div></>}
        </label>
      </div>
      <div className="form-actions">
        <button className="btn btn-secondary" onClick={onCancel}>Annuler</button>
        <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
          {loading ? <span className="spinner" style={{borderTopColor:'#fff'}}/> : 'Ajouter'}
        </button>
      </div>
      </>
      )}
    </>
  )
}

// ── Shelf Detail Modal ─────────────────────────────────────────
function ShelfDetailModal({ shelf, onClose, onEdit, onDelete, isEditor }) {
  const [products,       setProducts]       = useState([])
  const [sections,       setSections]       = useState([])
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showAddSection, setShowAddSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')
  const [showQR,         setShowQR]         = useState(false)
  const [qrData,         setQrData]         = useState(null)
  const [tagFilter,      setTagFilter]      = useState('')
  const toast = useToast()

  useEffect(() => { loadProducts(); loadSections() }, [shelf.id])

  async function loadProducts() {
    const { data, error } = await supabase.from('products').select('*').eq('shelf_id', shelf.id).order('name')
    if (!error) setProducts(data || [])
  }
  async function loadSections() {
    const { data, error } = await supabase.from('shelf_sections').select('*').eq('shelf_id', shelf.id).order('position')
    if (!error) setSections(data || [])
  }

  async function handleShowQR() {
    if (shelf.qr_code_url) { setQrData(shelf.qr_code_url); setShowQR(true); return }
    const d = await generateQR(shelf.id)
    setQrData(d); setShowQR(true)
  }

  function printQR() {
    const win = window.open('', '_blank')
    const doc = win.document
    doc.open()
    doc.write('<html><head><meta charset="utf-8"></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#fff"><img id="qr" style="width:200px"/><p id="nm" style="margin-top:12px;font-weight:700;font-size:18px"></p><p id="ds" style="color:#666;font-size:14px"></p></body></html>')
    doc.close()
    doc.getElementById('qr').src = qrData  // qrData is a data: URL generated by us
    doc.getElementById('nm').textContent = shelf.name         // textContent is safe (no HTML injection)
    doc.getElementById('ds').textContent = shelf.description || ''
    win.print()
  }

  async function addSection() {
    const trimmed = newSectionName.trim().slice(0, 100)
    if (!trimmed) return
    const { error } = await supabase.from('shelf_sections').insert({
      shelf_id: shelf.id, name: trimmed, position: sections.length,
    })
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    setNewSectionName(''); setShowAddSection(false)
    loadSections(); toast('Étage ajouté', 'success')
  }

  async function deleteSection(id) {
    if (!confirm('Supprimer cet étage ?')) return
    const { error } = await supabase.from('shelf_sections').delete().eq('id', id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    loadSections()
  }

  // Collect all unique tags in this shelf
  const allTags = [...new Set(products.flatMap(p => p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : []))]
  const filteredProducts = tagFilter
    ? products.filter(p => p.tags && p.tags.toLowerCase().includes(tagFilter.toLowerCase()))
    : products
  const lowStockCount = products.filter(p => p.min_quantity > 0 && p.quantity <= p.min_quantity).length

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        {showQR ? (
          <>
            <h3 className="modal-title">QR Code — {shelf.name}</h3>
            <div style={{textAlign:'center',padding:'20px 0'}}>
              <img src={qrData} style={{width:200,height:200,borderRadius:12}} alt="QR"/>
              <p style={{color:'var(--text2)',fontSize:13,marginTop:8}}>Scanner = ouvre la fiche directement</p>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowQR(false)}>Retour</button>
              <button className="btn btn-primary" onClick={printQR}>🖨️ Imprimer</button>
            </div>
          </>
        ) : showAddProduct ? (
          <AddProductForm shelfId={shelf.id} shelfName={shelf.name} sections={sections}
            onSave={() => { loadProducts(); setShowAddProduct(false) }}
            onCancel={() => setShowAddProduct(false)}/>
        ) : (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
              <div>
                <h3 style={{fontSize:20,fontWeight:700}}>{shelf.name}</h3>
                {shelf.description && <p style={{color:'var(--text2)',fontSize:14,marginTop:4}}>{shelf.description}</p>}
                {lowStockCount > 0 && (
                  <div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:6,background:'rgba(220,38,38,0.1)',borderRadius:20,padding:'3px 10px',fontSize:12,color:'var(--red)',fontWeight:600}}>
                    ⚠️ {lowStockCount} produit{lowStockCount>1?'s':''} en stock bas
                  </div>
                )}
              </div>
              <button className="btn btn-ghost btn-icon" onClick={onClose} style={{fontSize:20}}>✕</button>
            </div>

            {shelf.image_url && <img src={shelf.image_url} style={{width:'100%',borderRadius:10,marginBottom:16,maxHeight:200,objectFit:'cover'}} alt={shelf.name}/>}

            <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
              <button className="btn btn-secondary btn-sm" onClick={handleShowQR}>📱 QR Code</button>
              {isEditor && <button className="btn btn-secondary btn-sm" onClick={onEdit}>✏️ Modifier</button>}
              {isEditor && <button className="btn btn-danger btn-sm" onClick={onDelete}>🗑️ Supprimer</button>}
            </div>

            <div className="section-header" style={{marginBottom:8}}>
              <span className="section-title">🗂 Étages ({sections.length})</span>
              {isEditor && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAddSection(s => !s)}>
                  {showAddSection ? 'Annuler' : '+ Étage'}
                </button>
              )}
            </div>
            {showAddSection && (
              <div style={{display:'flex',gap:8,marginBottom:12}}>
                <input className="input" style={{flex:1}} value={newSectionName}
                  onChange={e => setNewSectionName(e.target.value)}
                  placeholder="Étage 1, Haut, Bas, Tiroir..." maxLength={100}
                  onKeyDown={e => e.key === 'Enter' && addSection()}/>
                <button className="btn btn-primary btn-sm" onClick={addSection}>OK</button>
              </div>
            )}
            {sections.length > 0 && (
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
                {sections.map(s => (
                  <div key={s.id} style={{display:'flex',alignItems:'center',gap:4,background:'var(--bg3)',borderRadius:20,padding:'4px 12px',fontSize:13,border:'1px solid var(--border)'}}>
                    <span>{s.name}</span>
                    {isEditor && (
                      <button onClick={() => deleteSection(s.id)}
                        style={{background:'none',border:'none',cursor:'pointer',color:'var(--text3)',fontSize:15,padding:'0 0 0 4px',lineHeight:1}}>×</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="section-header">
              <span className="section-title">Produits ({filteredProducts.length}{tagFilter ? `/${products.length}` : ''})</span>
              {isEditor && <button className="btn btn-primary btn-sm" onClick={() => setShowAddProduct(true)}>+ Ajouter</button>}
            </div>

            {/* Tag filter */}
            {allTags.length > 0 && (
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12,marginTop:8}}>
                <button
                  className={`btn btn-sm ${!tagFilter ? 'btn-primary' : 'btn-secondary'}`}
                  style={{fontSize:11,padding:'3px 10px'}}
                  onClick={() => setTagFilter('')}>Tous</button>
                {allTags.map(t => (
                  <button key={t}
                    className={`btn btn-sm ${tagFilter===t ? 'btn-primary' : 'btn-secondary'}`}
                    style={{fontSize:11,padding:'3px 10px'}}
                    onClick={() => setTagFilter(tagFilter === t ? '' : t)}>{t}</button>
                ))}
              </div>
            )}

            {filteredProducts.length === 0 ? (
              <div className="empty"><div className="empty-icon">📦</div><p>{tagFilter ? `Aucun produit avec le tag "${tagFilter}"` : 'Aucun produit'}</p></div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {filteredProducts.map(p => (
                  <ProductCard key={p.id} product={p} sections={sections} isEditor={isEditor}
                    shelfName={shelf.name} onRefresh={loadProducts}/>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Export / Print Modal ───────────────────────────────────────
function ExportModal({ shelves, onClose }) {
  const [loading, setLoading] = useState(true)
  const [exportData, setExportData] = useState([])

  useEffect(() => { buildData() }, [])

  async function buildData() {
    setLoading(true)
    const result = []
    for (const shelf of shelves) {
      const { data: products } = await supabase.from('products').select('*').eq('shelf_id', shelf.id).order('name')
      const { data: sections } = await supabase.from('shelf_sections').select('*').eq('shelf_id', shelf.id).order('position')
      const qrUrl = shelf.qr_code_url || await generateQR(shelf.id)
      result.push({ shelf, products: products || [], sections: sections || [], qrUrl })
    }
    setExportData(result); setLoading(false)
  }

  function handlePrint() {
    const totalProducts = exportData.reduce((a, d) => a + d.products.length, 0)
    const win = window.open('', '_blank')
    const doc = win.document
    doc.open()
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Stockr — Export</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:20px;color:#111;font-size:13px}
h1{font-size:20px;font-weight:700;margin-bottom:6px}.subtitle{color:#666;font-size:12px;margin-bottom:24px}
.shelf{page-break-inside:avoid;margin-bottom:20px;border:1px solid #ddd;border-radius:8px;overflow:hidden}
.shelf-header{display:flex;align-items:center;gap:16px;padding:14px 16px;background:#f9f9f9;border-bottom:1px solid #ddd}
.qr{width:80px;height:80px;flex-shrink:0}.shelf-name{font-size:16px;font-weight:700}
.shelf-desc{font-size:12px;color:#666;margin-top:3px}.shelf-meta{font-size:11px;color:#999;margin-top:3px}
table{width:100%;border-collapse:collapse}th{background:#f0f0f0;text-align:left;padding:7px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #ddd}
td{padding:7px 12px;border-bottom:1px solid #eee}.low{color:#dc2626;font-weight:700}.tag{display:inline-block;background:#f0f0f0;border-radius:10px;padding:1px 7px;font-size:10px;margin:1px}
.no-products{padding:12px 16px;color:#999;font-style:italic}@media print{body{padding:10px}}</style>
</head><body>
<h1>📦 Export Dépôt — Stockr</h1>
<p class="subtitle">Généré le ${new Date().toLocaleDateString('fr')} · ${shelves.length} étagère${shelves.length>1?'s':''} · ${totalProducts} produit${totalProducts>1?'s':''}</p>
${exportData.map(({ shelf, products, sections, qrUrl }) => {
  const sectionMap = Object.fromEntries(sections.map(s => [s.id, s.name]))
  return `<div class="shelf"><div class="shelf-header"><img class="qr" src="${esc(qrUrl)}" alt="QR"/><div>
<div class="shelf-name">${esc(shelf.name)}</div>
${shelf.description ? `<div class="shelf-desc">${esc(shelf.description)}</div>` : ''}
<div class="shelf-meta">${products.length} produit${products.length!==1?'s':''}</div></div></div>
${products.length === 0 ? '<p class="no-products">Aucun produit</p>' :
`<table><thead><tr><th>Produit</th><th>Réf.</th><th>Tags</th><th>Étage</th><th>Quantité</th><th>Min</th></tr></thead><tbody>
${products.map(p => {
  const isLow = p.min_quantity > 0 && p.quantity <= p.min_quantity
  const tagHtml = p.tags ? p.tags.split(',').map(t => `<span class="tag">${esc(t.trim())}</span>`).join('') : '—'
  return `<tr><td${isLow?' class="low"':''}>${esc(p.name)}${isLow?' ⚠️':''}</td><td>${esc(p.reference)||'—'}</td>
<td>${tagHtml}</td><td>${p.section_id && sectionMap[p.section_id] ? esc(sectionMap[p.section_id]) : '—'}</td>
<td${isLow?' class="low"':''}>${esc(p.quantity)} ${esc(p.unit)}</td><td>${p.min_quantity||'—'}</td></tr>`}).join('')}
</tbody></table>`}</div>`}).join('')}
</body></html>`
    doc.write(html); doc.close()
    setTimeout(() => win.print(), 600)
  }

  const totalProducts = exportData.reduce((a, d) => a + d.products.length, 0)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">📄 Export & Impression</h3>
        {loading ? (
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12,padding:'32px 0'}}>
            <span className="spinner" style={{width:32,height:32}}/>
            <p style={{color:'var(--text2)',fontSize:13}}>Chargement...</p>
          </div>
        ) : (
          <div style={{marginBottom:20}}>
            <p style={{color:'var(--text2)',fontSize:14,marginBottom:8}}>
              <strong>{shelves.length}</strong> étagère{shelves.length>1?'s':''} · <strong>{totalProducts}</strong> produit{totalProducts>1?'s':''}
            </p>
            <p style={{fontSize:13,color:'var(--text3)'}}>Le document inclut QR codes, tags, étages et alertes stock bas.</p>
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
          <button className="btn btn-primary" onClick={handlePrint} disabled={loading}>🖨️ Imprimer / PDF</button>
        </div>
      </div>
    </div>
  )
}

// ── Room Modal ─────────────────────────────────────────────────
function RoomModal({ room, gridCols, gridRows, onClose, onSave }) {
  const [name,    setName]    = useState(room?.name    || '')
  const [color,   setColor]   = useState(room?.color   || '#7C3AED')
  const [gridX,   setGridX]   = useState(room?.grid_x  ?? 0)
  const [gridY,   setGridY]   = useState(room?.grid_y  ?? 0)
  const [gridW,   setGridW]   = useState(room?.grid_w  ?? 4)
  const [gridH,   setGridH]   = useState(room?.grid_h  ?? 3)
  const [desc,    setDesc]    = useState(room?.description || '')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  async function handleSave() {
    if (!name.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      const payload = { name: name.trim(), color, grid_x: +gridX, grid_y: +gridY, grid_w: Math.max(1,+gridW), grid_h: Math.max(1,+gridH), description: desc }
      if (room?.id) {
        const { error } = await supabase.from('depot_rooms').update(payload).eq('id', room.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('depot_rooms').insert(payload)
        if (error) throw error
      }
      onSave(); toast(room?.id ? 'Pièce mise à jour' : 'Pièce créée', 'success'); onClose()
    } catch(err) { toast(err.message, 'error') }
    finally { setLoading(false) }
  }

  async function handleDelete() {
    if (!confirm('Supprimer cette pièce du plan ?')) return
    const { error } = await supabase.from('depot_rooms').delete().eq('id', room.id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    onSave(); onClose(); toast('Pièce supprimée', 'success')
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">🏠 {room?.id ? 'Modifier' : 'Nouvelle'} pièce</h3>
        <div className="form-group">
          <label className="label">Nom</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Réserve, Scène, Coulisses..." maxLength={100}/>
        </div>
        <div className="form-group">
          <label className="label">Couleur</label>
          <ColorPicker value={color} onChange={setColor}/>
        </div>
        <div className="form-group">
          <label className="label">Position dans la grille</label>
          <div className="form-row">
            <div className="form-group">
              <label className="label" style={{fontSize:11,color:'var(--text3)'}}>X (0 à {gridCols-1})</label>
              <input className="input" type="number" min={0} max={gridCols-1} value={gridX} onChange={e => setGridX(e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="label" style={{fontSize:11,color:'var(--text3)'}}>Y (0 à {gridRows-1})</label>
              <input className="input" type="number" min={0} max={gridRows-1} value={gridY} onChange={e => setGridY(e.target.value)}/>
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="label">Taille</label>
          <div className="form-row">
            <div className="form-group">
              <label className="label" style={{fontSize:11,color:'var(--text3)'}}>Largeur (colonnes)</label>
              <input className="input" type="number" min={1} max={gridCols} value={gridW} onChange={e => setGridW(e.target.value)}/>
            </div>
            <div className="form-group">
              <label className="label" style={{fontSize:11,color:'var(--text3)'}}>Hauteur (rangées)</label>
              <input className="input" type="number" min={1} max={gridRows} value={gridH} onChange={e => setGridH(e.target.value)}/>
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="label">Description</label>
          <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Notes sur cette zone..."/>
        </div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          {room?.id && <button className="btn btn-danger" onClick={handleDelete}>🗑️ Supprimer</button>}
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? <span className="spinner" style={{borderTopColor:'#fff'}}/> : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── QR Scanner Modal — caméra live via getUserMedia + jsQR ──
function QRScannerModal({ shelves, onFound, onClose }) {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const animRef   = useRef(null)
  const jsqrRef   = useRef(null)
  const foundRef  = useRef(false)
  const [status,  setStatus]  = useState('Démarrage de la caméra...')
  const [camErr,  setCamErr]  = useState(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const mod = await import('jsqr')
        jsqrRef.current = mod.default
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
        })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setStatus('Pointez vers un QR code Stockr...')
          animRef.current = requestAnimationFrame(scan)
        }
      } catch(err) {
        if (!cancelled) setCamErr(err.message)
      }
    }
    init()
    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  function scan() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || foundRef.current) return
    if (video.readyState >= video.HAVE_ENOUGH_DATA) {
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsqrRef.current?.(imageData.data, imageData.width, imageData.height)
      if (code) {
        const match = code.data.match(/\/shelf\/([a-f0-9-]{36})/i)
        if (match) {
          const shelf = shelves.find(s => s.id === match[1])
          if (shelf) {
            foundRef.current = true
            setStatus('✅ Étagère trouvée !')
            navigator.vibrate?.(100)
            cancelAnimationFrame(animRef.current)
            streamRef.current?.getTracks().forEach(t => t.stop())
            setTimeout(() => { onFound(shelf); onClose() }, 600)
            return
          }
        }
      }
    }
    animRef.current = requestAnimationFrame(scan)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:400,padding:0,overflow:'hidden'}}>
        <div style={{padding:'16px 16px 12px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <h3 className="modal-title" style={{margin:0}}>📷 Scanner un QR Code</h3>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>
        {camErr ? (
          <div style={{padding:'24px 20px',textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:12}}>📷</div>
            <p style={{fontWeight:600,marginBottom:6}}>Caméra inaccessible</p>
            <p style={{fontSize:13,color:'var(--text2)',marginBottom:16}}>{camErr}</p>
            <p style={{fontSize:12,color:'var(--text3)'}}>Autorisez l'accès à la caméra dans les paramètres de votre navigateur.</p>
          </div>
        ) : (
          <div style={{position:'relative',background:'#000',aspectRatio:'4/3'}}>
            <video ref={videoRef} playsInline muted style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
            <canvas ref={canvasRef} style={{display:'none'}}/>
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
              <div style={{width:200,height:200,border:'3px solid rgba(255,255,255,0.9)',borderRadius:16,boxShadow:'0 0 0 9999px rgba(0,0,0,0.4)'}}/>
            </div>
            <div style={{position:'absolute',bottom:0,left:0,right:0,background:'rgba(0,0,0,0.65)',color:'#fff',fontSize:13,fontWeight:500,padding:'10px 16px',textAlign:'center'}}>
              {status}
            </div>
          </div>
        )}
        <div style={{padding:'12px 16px'}}>
          <button className="btn btn-secondary" style={{width:'100%'}} onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

// ── Import CSV Modal ───────────────────────────────────────────
function ImportCSVModal({ shelves, onClose, onDone }) {
  const [file,     setFile]     = useState(null)
  const [shelfId,  setShelfId]  = useState('')
  const [preview,  setPreview]  = useState([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(false)
  const [parseErr, setParseErr] = useState('')
  const [parsedRows, setParsedRows] = useState([])
  const toast = useToast()

  function splitCSVLine(line) {
    const result = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQ = !inQ }
      else if ((ch === ',' || ch === ';') && !inQ) { result.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    result.push(cur.trim())
    return result
  }
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/)
    const headers = splitCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').toLowerCase().trim())
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = splitCSVLine(line).map(v => v.replace(/^"|"$/g, ''))
      const obj = {}
      headers.forEach((h, i) => { obj[h] = vals[i] || '' })
      return obj
    })
  }

  const CSV_ROW_LIMIT = 500

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { setParseErr('Fichier trop volumineux (max 5 Mo)'); return }
    setFile(f); setParseErr('')
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const rows = parseCSV(evt.target.result)
        if (rows.length > CSV_ROW_LIMIT) { setParseErr(`Trop de lignes (max ${CSV_ROW_LIMIT}, fichier : ${rows.length})`); setFile(null); return }
        setParsedRows(rows); setTotal(rows.length); setPreview(rows.slice(0, 5))
      } catch { setParseErr('Fichier CSV invalide') }
    }
    reader.readAsText(f, 'utf-8')
  }

  async function handleImport() {
    if (!shelfId) { toast('Choisir une étagère', 'error'); return }
    if (!file || parsedRows.length === 0) return
    setLoading(true)
    try {
      {
        const rows = parsedRows
        const shelf = shelves.find(s => s.id === shelfId)
        const products = rows.map(r => ({
          shelf_id: shelfId,
          name: String(r.name || r.nom || 'Sans nom').slice(0, 255),
          reference: String(r.reference || r.ref || '').slice(0, 100),
          quantity: Math.max(0, parseInt(r.quantity || r.quantite || r.qte || '0') || 0),
          unit: String(r.unit || r.unite || 'pcs').slice(0, 50),
          description: String(r.description || r.notes || '').slice(0, 1000),
          min_quantity: Math.max(0, parseInt(r.min_quantity || r.min || '0') || 0),
          tags: String(r.tags || r.categories || r.cat || '').trim() ? String(r.tags || r.categories || r.cat || '').trim().split(',').map(t => t.trim()).filter(Boolean) : null,
        }))
        const { error } = await supabase.from('products').insert(products)
        if (error) throw error
        await logMovement('import', `${products.length} produits importés`, shelf?.name, shelfId, products.length)
        toast(`${products.length} produit${products.length>1?'s':''} importé${products.length>1?'s':''}`, 'success')
        onDone(); onClose()
      }
    } catch(err) { toast('Erreur import : ' + err.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">📥 Import CSV</h3>
        <div className="form-group">
          <label className="label">Étagère de destination</label>
          <select className="input" value={shelfId} onChange={e => setShelfId(e.target.value)}>
            <option value="">Choisir...</option>
            {shelves.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Fichier CSV</label>
          <p style={{fontSize:12,color:'var(--text3)',marginBottom:6}}>Colonnes : <code>name</code> (requis), <code>reference</code>, <code>quantity</code>, <code>unit</code>, <code>min_quantity</code>, <code>tags</code>, <code>description</code></p>
          <label className="upload-zone" style={{cursor:'pointer'}}>
            <input type="file" accept=".csv,text/csv,text/plain" style={{display:'none'}} onChange={handleFile}/>
            <div style={{fontSize:28}}>📄</div>
            <div style={{fontSize:13,marginTop:6}}>{file ? file.name : 'Choisir un fichier CSV'}</div>
          </label>
        </div>
        {parseErr && <p style={{color:'var(--red)',fontSize:13,marginBottom:12}}>{parseErr}</p>}
        {preview.length > 0 && (
          <div style={{marginBottom:16}}>
            <p style={{fontSize:13,color:'var(--text2)',marginBottom:8}}>Aperçu — {total} ligne{total>1?'s':''} :</p>
            <div style={{background:'var(--bg3)',borderRadius:8,padding:10,fontSize:12,overflowX:'auto',border:'1px solid var(--border)'}}>
              {preview.map((r, i) => (
                <div key={i} style={{borderBottom:'1px solid var(--border)',paddingBottom:4,marginBottom:4}}>
                  <strong>{r.name || r.nom || '?'}</strong>
                  <span style={{color:'var(--text3)',marginLeft:8}}>Qté: {r.quantity || 0} {r.unit || 'pcs'}</span>
                  {(r.tags || r.categories) && <span style={{color:'var(--indigo)',marginLeft:8}}>🏷 {r.tags || r.categories}</span>}
                </div>
              ))}
              {total > 5 && <p style={{color:'var(--text3)',fontSize:11,marginTop:4}}>... et {total-5} autre{total-5>1?'s':''}</p>}
            </div>
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={loading || !file || !shelfId || !!parseErr}>
            {loading ? <span className="spinner" style={{borderTopColor:'#fff'}}/> : `📥 Importer ${total > 0 ? total + ' produits' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── History Modal ──────────────────────────────────────────────
function HistoryModal({ onClose }) {
  const [movements, setMovements] = useState([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('product_movements').select('*').order('created_at', { ascending: false }).limit(100)
      setMovements(data || []); setLoading(false)
    }
    load()
  }, [])

  const icons  = { add: '✅', delete: '🗑️', edit: '✏️', import: '📥' }
  const labels = { add: 'Ajouté', delete: 'Supprimé', edit: 'Modifié', import: 'Import CSV' }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">📋 Historique des mouvements</h3>
        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:32}}><span className="spinner" style={{width:32,height:32}}/></div>
        ) : movements.length === 0 ? (
          <div className="empty"><div className="empty-icon">📋</div><p>Aucun mouvement enregistré</p></div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:'60vh',overflowY:'auto'}}>
            {movements.map(m => (
              <div key={m.id} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'10px 12px',background:'var(--bg3)',borderRadius:8,border:'1px solid var(--border)'}}>
                <span style={{fontSize:18,flexShrink:0,marginTop:1}}>{icons[m.action] || '📦'}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.product_name}</div>
                  <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>
                    {labels[m.action] || m.action}
                    {m.shelf_name && <span style={{color:'var(--text3)'}}> · {m.shelf_name}</span>}
                    {m.quantity_change != null && m.action !== 'import' && <span style={{color:'var(--text3)'}}> · {m.quantity_change > 0 ? '+' : ''}{m.quantity_change}</span>}
                  </div>
                  <div style={{fontSize:11,color:'var(--text3)',marginTop:3}}>{new Date(m.created_at).toLocaleString('fr-FR')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="form-actions" style={{marginTop:16}}>
          <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

// ── Global Search Modal ────────────────────────────────────────
function GlobalSearchModal({ onShelfSelect, onClose }) {
  const [q,        setQ]        = useState('')
  const [results,  setResults]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [tagFilter,setTagFilter]= useState('')
  const [allTags,  setAllTags]  = useState([])
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (q.length >= 1 || tagFilter) search()
      else setResults([])
    }, 250)
    return () => clearTimeout(timer)
  }, [q, tagFilter])

  async function search() {
    setLoading(true)
    let query = supabase.from('products').select('*, shelves(name, id)')
    const safeQ = q.replace(/[()%,]/g, ' ').trim()
    if (safeQ.length >= 1) query = query.or(`name.ilike.%${safeQ}%,reference.ilike.%${safeQ}%,tags.ilike.%${safeQ}%,description.ilike.%${safeQ}%`)
    if (tagFilter) query = query.ilike('tags', `%${tagFilter}%`)
    const { data } = await query.limit(40).order('name')
    setResults(data || [])
    // collect tags from first load
    if (!tagFilter && q.length < 1) {
      const tags = [...new Set((data || []).flatMap(p => p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : []))]
      setAllTags(tags)
    }
    setLoading(false)
  }

  // Load all tags on open
  useEffect(() => {
    supabase.from('products').select('tags').then(({ data }) => {
      const tags = [...new Set((data || []).flatMap(p => p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : []))]
      setAllTags(tags)
    })
  }, [])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:560}}>
        <h3 className="modal-title">🔍 Recherche globale</h3>
        <input ref={inputRef} className="input" value={q} onChange={e => setQ(e.target.value.slice(0, 200))}
          placeholder="Nom, référence, tag, description..." style={{marginBottom:10}}/>

        {allTags.length > 0 && (
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
            <button className={`btn btn-sm ${!tagFilter?'btn-primary':'btn-secondary'}`} style={{fontSize:11,padding:'3px 10px'}}
              onClick={() => setTagFilter('')}>Tous</button>
            {allTags.map(t => (
              <button key={t} className={`btn btn-sm ${tagFilter===t?'btn-primary':'btn-secondary'}`}
                style={{fontSize:11,padding:'3px 10px'}} onClick={() => setTagFilter(tagFilter===t?'':t)}>🏷 {t}</button>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:24}}><span className="spinner"/></div>
        ) : results.length === 0 && (q || tagFilter) ? (
          <div className="empty" style={{padding:'24px 0'}}><div className="empty-icon">🔍</div><p>Aucun résultat</p></div>
        ) : results.length > 0 ? (
          <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:'55vh',overflowY:'auto'}}>
            {results.map(p => {
              const isLow = p.min_quantity > 0 && p.quantity <= p.min_quantity
              const tags = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : []
              return (
                <div key={p.id}
                  style={{display:'flex',gap:12,alignItems:'flex-start',padding:'10px 12px',
                    background: isLow ? 'rgba(220,38,38,0.06)' : 'var(--bg3)',
                    borderRadius:8,border: isLow ? '1px solid rgba(220,38,38,0.3)' : '1px solid var(--border)',
                    cursor:'pointer'}}
                  onClick={() => { if (p.shelves) { onShelfSelect({ id: p.shelves.id, name: p.shelves.name }); onClose() } }}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:14,display:'flex',alignItems:'center',gap:6}}>
                      {p.name} {isLow && '⚠️'}
                    </div>
                    {p.shelves && <div style={{fontSize:12,color:'var(--indigo)',marginTop:2}}>📦 {p.shelves.name}</div>}
                    {p.reference && <div style={{fontSize:12,color:'var(--text3)'}}>Réf: {p.reference}</div>}
                    <div style={{fontSize:12,color: isLow ? 'var(--red)' : 'var(--text2)',marginTop:2,fontWeight: isLow ? 700 : 400}}>
                      Qté: {p.quantity} {p.unit}
                      {p.min_quantity > 0 && <span style={{color:'var(--text3)',fontWeight:400}}> / min {p.min_quantity}</span>}
                    </div>
                    {tags.length > 0 && (
                      <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>
                        {tags.map(t => <span key={t} style={{fontSize:10,background:'var(--bg)',borderRadius:10,padding:'1px 7px',border:'1px solid var(--border)',color:'var(--text2)'}}>{t}</span>)}
                      </div>
                    )}
                  </div>
                  <span style={{color:'var(--text3)',fontSize:18,flexShrink:0,marginTop:2}}>›</span>
                </div>
              )
            })}
          </div>
        ) : (
          <p style={{color:'var(--text3)',fontSize:13,textAlign:'center',padding:'16px 0'}}>Tape pour chercher dans tous les produits du dépôt</p>
        )}

        <div className="form-actions" style={{marginTop:16}}>
          <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

// ── Main DepotPage ─────────────────────────────────────────────
export default function DepotPage() {
  const { isEditor } = useAuth()
  const toast      = useToast()
  const confirmFn  = useConfirm()

  const { cols: initCols, rows: initRows } = getGridSettings()
  const [gridCols, setGridCols] = useState(initCols)
  const [gridRows, setGridRows] = useState(initRows)

  const [shelves,          setShelves]          = useState([])
  const [zones,            setZones]            = useState([])
  const [rooms,            setRooms]            = useState([])
  const [productCounts,    setProductCounts]    = useState({})
  const [loading,          setLoading]          = useState(true)
  const [view,             setView]             = useState('grid')
  const [search,           setSearch]           = useState('')
  const [selectedShelf,    setSelectedShelf]    = useState(null)
  const [editShelf,        setEditShelf]        = useState(null)
  const [showAddShelf,     setShowAddShelf]     = useState(false)
  const [showGridSettings, setShowGridSettings] = useState(false)
  const [showExport,       setShowExport]       = useState(false)
  const [showScanner,      setShowScanner]      = useState(false)
  const [showImportCSV,    setShowImportCSV]    = useState(false)
  const [showHistory,      setShowHistory]      = useState(false)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [dragMode,         setDragMode]         = useState(false)
  const [dragShelfId,      setDragShelfId]      = useState(null)
  const [wiggleId,         setWiggleId]         = useState(null)
  const [dropTarget,       setDropTarget]       = useState(null)
  const longPressRef  = useRef(null)
  const gridRef       = useRef(null)
  const pointerIdRef  = useRef(null)
  const [showRoomModal,    setShowRoomModal]    = useState(false)
  const [editRoom,         setEditRoom]         = useState(null)
  const [gridZoom,         setGridZoom]         = useState(() => {
    try { return parseFloat(localStorage.getItem('gridZoom') || '1') } catch { return 1 }
  })
  const [showMore,         setShowMore]         = useState(false)

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    const ch = supabase.channel('depot')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shelves' }, () => loadAll())
      .subscribe()
    return () => ch.unsubscribe()
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { /* handled by modals */ }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault(); setShowGlobalSearch(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function loadAll() {
    setLoading(true)
    const [shelvesRes, zonesRes, roomsRes, prodsRes] = await Promise.all([
      supabase.from('shelves').select('*').order('name'),
      supabase.from('depot_zones').select('*').order('name'),
      supabase.from('depot_rooms').select('*').order('name'),
      supabase.from('products').select('shelf_id, quantity, min_quantity'),
    ])
    const [{ data: s, error: sErr }, { data: z }, { data: r }, { data: allProds }] =
      [shelvesRes, zonesRes, roomsRes, prodsRes]
    if (sErr) { toast('Erreur chargement : ' + sErr.message, 'error') }
    const shelvesList = s || []
    setShelves(shelvesList); setZones(z || []); setRooms(r || [])
    const counts = {}
    ;(allProds || []).forEach(p => {
      if (!counts[p.shelf_id]) counts[p.shelf_id] = { total: 0, lowStock: 0 }
      counts[p.shelf_id].total++
      if (p.min_quantity > 0 && p.quantity <= p.min_quantity) counts[p.shelf_id].lowStock++
    })
    setProductCounts(counts); setLoading(false)
    if (window.__pendingShelfId) {
      const target = shelvesList.find(sh => sh.id === window.__pendingShelfId)
      if (target) setSelectedShelf(target)
      window.__pendingShelfId = null
    }
  }

  async function handleDelete(shelfId) {
    if (!await confirmFn('Supprimer cette étagère et tous ses produits ?', { confirmLabel: 'Supprimer' })) return
    const { error } = await supabase.from('shelves').delete().eq('id', shelfId)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    toast('Étagère supprimée', 'success')
    setSelectedShelf(null); loadAll()
  }

  async function handleDrop(x, y) {
    if (!dragShelfId) return
    const { error } = await supabase.from('shelves').update({ grid_x: x, grid_y: y }).eq('id', dragShelfId)
    if (error) { toast('Erreur déplacement : ' + error.message, 'error') }
    setDragShelfId(null); loadAll()
  }

  function getCellCoords(clientX, clientY) {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return null
    const pad = 10, gap = 4
    const cx = Math.floor((clientX - rect.left  - pad) / (cellSize + gap))
    const cy = Math.floor((clientY - rect.top   - pad) / (cellSize + gap))
    if (cx < 0 || cx >= gridCols || cy < 0 || cy >= gridRows) return null
    return { x: cx, y: cy }
  }

  function buildGrid() {
    const grid = Array.from({ length: gridRows }, () => Array(gridCols).fill(null))
    const occupied = new Set()
    shelves.forEach(s => {
      const w = Math.max(1, s.grid_w || 1)
      const h = Math.max(1, s.grid_h || 1)
      if (s.grid_y >= 0 && s.grid_y < gridRows && s.grid_x >= 0 && s.grid_x < gridCols) {
        grid[s.grid_y][s.grid_x] = s
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = s.grid_x + dx
            const ny = s.grid_y + dy
            if (nx < gridCols && ny < gridRows) occupied.add(`${nx}-${ny}`)
          }
        }
      }
    })
    return { grid, occupied }
  }

  function cellColor(shelf) {
    if (shelf.color) return shelf.color
    const z = zones.find(z => z.id === shelf.zone_id)
    return z?.color || '#4F46E5'
  }

  const filtered = shelves.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
  const { grid, occupied } = buildGrid()
  const clampedZoom = Math.max(0.6, Math.min(2.0, gridZoom))
  const baseCellSize = Math.max(36, Math.min(52, Math.floor((Math.min(window.innerWidth, 900) - 60) / gridCols)))
  const cellSize = Math.round(baseCellSize * clampedZoom)
  const cells = []
  for (let y = 0; y < gridRows; y++) {
    for (let x = 0; x < gridCols; x++) {
      if (!occupied.has(`${x}-${y}`)) cells.push({ x, y, shelf: grid[y][x] })
    }
  }

  const totalLowStock = Object.values(productCounts).reduce((a, c) => a + c.lowStock, 0)

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <h1>🏭 Dépôt</h1>
            {totalLowStock > 0 && (
              <div style={{background:'var(--red)',color:'#fff',borderRadius:20,padding:'2px 10px',fontSize:12,fontWeight:700,cursor:'pointer'}}
                onClick={() => setView('list')} title="Voir les stocks bas">
                ⚠️ {totalLowStock} bas
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            {/* Vue */}
            <button className={`btn btn-sm ${view==='grid'?'btn-primary':'btn-secondary'}`}
              onClick={() => setView(v => v==='grid'?'list':'grid')} title={view==='grid'?'Vue liste':'Vue grille'}>
              {view === 'grid' ? '☰' : '⊞'}
            </button>

            {/* Recherche globale */}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowGlobalSearch(true)} title="Recherche globale (Ctrl+K)">🔍</button>

            {/* Zoom */}
            <div style={{display:'flex',alignItems:'center',gap:1,background:'var(--bg3)',borderRadius:8,border:'1.5px solid var(--border)',padding:'2px 3px'}}>
              <button className="btn btn-ghost btn-sm" style={{padding:'2px 7px',fontSize:14,lineHeight:1}} title="Zoom −"
                onClick={() => { const z = Math.max(0.6, clampedZoom - 0.2); setGridZoom(z); try { localStorage.setItem('gridZoom', z) } catch {} }}>−</button>
              <span style={{fontSize:11,fontWeight:600,color:'var(--text2)',minWidth:30,textAlign:'center'}}>{Math.round(clampedZoom * 100)}%</span>
              <button className="btn btn-ghost btn-sm" style={{padding:'2px 7px',fontSize:14,lineHeight:1}} title="Zoom +"
                onClick={() => { const z = Math.min(2.0, clampedZoom + 0.2); setGridZoom(z); try { localStorage.setItem('gridZoom', z) } catch {} }}>+</button>
            </div>

            {/* Menu ⋯ */}
            <div style={{position:'relative'}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowMore(m => !m)} title="Plus d'options">⋯</button>
              {showMore && (
                <>
                  <div style={{position:'fixed',inset:0,zIndex:99}} onClick={() => setShowMore(false)}/>
                  <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',background:'var(--bg2)',border:'1.5px solid var(--border)',borderRadius:'var(--radius)',boxShadow:'var(--shadow-md)',zIndex:100,minWidth:210,padding:'6px 0'}}>
                    {[
                      { label:'📷 Scanner QR',        action:() => { setShowScanner(true); setShowMore(false) } },
                      { label:'📄 Exporter PDF',       action:() => { setShowExport(true);  setShowMore(false) } },
                      ...(isEditor ? [{ label:'📥 Importer CSV', action:() => { setShowImportCSV(true); setShowMore(false) } }] : []),
                      { label:'📋 Historique',         action:() => { setShowHistory(true); setShowMore(false) } },
                      { label:'⚙️ Réglages grille',   action:() => { setShowGridSettings(true); setShowMore(false) } },
                      ...(isEditor ? [
                        { label:`↕️ Mode déplacement ${dragMode?'(actif)':''}`, action:() => { setDragMode(m => !m); setRoomDrawMode(false); setShowMore(false) }, active: dragMode },
{ label:'🏠 Ajouter une pièce', action:() => { setEditRoom(null); setShowRoomModal(true); setShowMore(false) } },
                      ] : []),
                    ].map((item, i) => (
                      <button key={i} onClick={item.action} style={{
                        display:'block', width:'100%', textAlign:'left', padding:'10px 16px',
                        background: item.active ? 'rgba(124,58,237,0.08)' : 'transparent',
                        color: item.active ? 'var(--indigo2)' : 'var(--text)',
                        border:'none', cursor:'pointer', fontSize:14, fontWeight: item.active ? 600 : 400,
                        fontFamily:'inherit',
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = item.active ? 'rgba(124,58,237,0.12)' : 'var(--bg3)'}
                        onMouseLeave={e => e.currentTarget.style.background = item.active ? 'rgba(124,58,237,0.08)' : 'transparent'}
                      >{item.label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Ajouter étagère */}
            {isEditor && <button className="btn btn-primary btn-sm" onClick={() => setShowAddShelf(true)}>+ Étagère</button>}
          </div>
        </div>
        {dragMode && <p style={{fontSize:12,color:'var(--indigo)',marginTop:6,fontWeight:500}}>↕️ Glisse une étagère vers une case vide · clique ↕️ pour quitter</p>}
        <input className="input" style={{marginTop:12}} placeholder="🔍 Rechercher une étagère... · Ctrl+K pour chercher les produits" value={search} onChange={e => setSearch(e.target.value.slice(0, 200))}/>
      </div>

      <div className="page-content">
        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:60}}>
            <span className="spinner" style={{width:32,height:32}}/>
          </div>
        ) : view === 'grid' ? (
          <>
            {(zones.length > 0 || rooms.length > 0) && (
              <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16,alignItems:'center'}}>
                {zones.map(z => (
                  <div key={z.id} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--text2)'}}>
                    <div style={{width:12,height:12,borderRadius:3,background:z.color}}/>{z.name}
                  </div>
                ))}
                {rooms.length > 0 && <span style={{width:1,height:14,background:'var(--border)',display:'inline-block'}}/>}
                {rooms.map(r => (
                  <div key={r.id} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--text2)',cursor:isEditor?'pointer':'default'}}
                    onClick={isEditor ? () => { setEditRoom(r); setShowRoomModal(true) } : undefined}>
                    <div style={{width:12,height:12,borderRadius:3,background:r.color}}/>🏠 {r.name}
                  </div>
                ))}
              </div>
            )}

            <div style={{overflowX:'auto',paddingBottom:8}}
>
              <div style={{position:'relative',width:'fit-content',userSelect:'auto'}}>
                {(() => {
                  const gap = 4, pad = 10
                  const totalW = gridCols * cellSize + (gridCols - 1) * gap + pad * 2
                  const totalH = gridRows * cellSize + (gridRows - 1) * gap + pad * 2
                  if (rooms.length === 0) return null
                  return (
                    <svg width={totalW} height={totalH} style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:2,borderRadius:'var(--radius-lg)'}}>
                      {rooms.map(room => {
                        const rx = pad + room.grid_x * (cellSize + gap)
                        const ry = pad + room.grid_y * (cellSize + gap)
                        const rw = room.grid_w * cellSize + (room.grid_w - 1) * gap
                        const rh = room.grid_h * cellSize + (room.grid_h - 1) * gap
                        return (
                          <g key={room.id} onClick={isEditor ? () => { setEditRoom(room); setShowRoomModal(true) } : undefined}
                            style={{pointerEvents:isEditor?'auto':'none',cursor:isEditor?'pointer':'default'}}>
                            <rect x={rx} y={ry} width={rw} height={rh} fill={room.color+'18'} stroke={room.color} strokeWidth={2} rx={8}/>
                            <rect x={rx+4} y={ry+2} width={Math.min(rw-8,room.name.length*7+12)} height={17} fill={room.color+'CC'} rx={4}/>
                            <text x={rx+10} y={ry+13} fill="#fff" fontSize={10} fontWeight="700" fontFamily="Inter,system-ui,sans-serif">{room.name}</text>
                          </g>
                        )
                      })}
  
                    </svg>
                  )
                })()}

                <div ref={gridRef}
                  style={{display:'grid',gridTemplateColumns:`repeat(${gridCols}, ${cellSize}px)`,gridTemplateRows:`repeat(${gridRows}, ${cellSize}px)`,gap:4,background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:10,width:'fit-content',touchAction:'none'}}
                  onPointerMove={e => {
                    if (!wiggleId) return
                    const pos = getCellCoords(e.clientX, e.clientY)
                    setDropTarget(pos)
                  }}
                  onPointerUp={async () => {
                    clearTimeout(longPressRef.current)
                    if (wiggleId && dropTarget) {
                      const cell = grid[dropTarget.y]?.[dropTarget.x]
                      if (!cell) await handleDrop(dropTarget.x, dropTarget.y)
                    }
                    setWiggleId(null); setDropTarget(null)
                  }}
                  onPointerLeave={() => { if (wiggleId) setDropTarget(null) }}
                >
                {cells.map(({ x, y, shelf: cell }) => {
                  const w = Math.max(1, cell?.grid_w || 1)
                  const h = Math.max(1, cell?.grid_h || 1)
                  const bg = cell ? cellColor(cell) : undefined
                  const isDragging = dragShelfId === cell?.id
                  const counts = cell ? (productCounts[cell.id] || { total: 0, lowStock: 0 }) : null
                  return (
                    <div key={`${x}-${y}`} className={`grid-cell ${cell ? 'occupied' : 'empty-cell'} ${wiggleId && wiggleId===cell?.id ? 'wiggling' : ''} ${dropTarget && dropTarget.x===x && dropTarget.y===y && !cell && wiggleId ? 'drag-target' : ''}`}
                      style={{
                        gridColumnStart:x+1,gridRowStart:y+1,gridColumnEnd:`span ${w}`,gridRowEnd:`span ${h}`,
                        ...(cell ? {background:bg,border:`1px solid ${bg}`,opacity:(isDragging||wiggleId===cell?.id)?0.85:1} : {}),
                        cursor:wiggleId?(cell&&wiggleId!==cell?.id?'default':'grabbing'):(dragMode?(cell?'grab':'copy'):'pointer'),
                        touchAction: cell && isEditor ? 'none' : 'auto',
                        fontSize:cellSize<44?9:11,display:'flex',flexDirection:'column',alignItems:'center',
                        justifyContent:'center',textAlign:'center',overflow:'hidden',position:'relative',
                      }}
                      draggable={dragMode && !!cell}
                      onDragStart={cell ? () => setDragShelfId(cell.id) : undefined}
                      onDragEnd={() => setDragShelfId(null)}
                      onDragOver={e => { if (dragMode) e.preventDefault() }}
                      onDrop={() => { if (dragMode && !cell) handleDrop(x, y) }}
                      onPointerDown={e => {
                        if (!cell || !isEditor) return
                        e.preventDefault()
                        pointerIdRef.current = e.pointerId
                        longPressRef.current = setTimeout(() => {
                          setWiggleId(cell.id)
                          navigator.vibrate?.(40)
                          try { gridRef.current?.setPointerCapture(pointerIdRef.current) } catch {}
                        }, 480)
                      }}
                      onPointerUp={e => {
                        clearTimeout(longPressRef.current)
                        if (wiggleId) return // handled by grid container
                        if (!dragMode) {
                          if (cell) setSelectedShelf(cell)
                          else if (isEditor) setShowAddShelf(true)
                        }
                      }}
                      onPointerCancel={() => { clearTimeout(longPressRef.current); setWiggleId(null); setDropTarget(null) }}
                      onClick={() => { if (dragMode || wiggleId) return; if (cell) setSelectedShelf(cell); else if (isEditor) setShowAddShelf(true) }}
                      title={cell ? cell.name : `Ajouter en (${x}, ${y})`}
                    >
                      {cell ? (
                        <>
                          <span style={{overflow:'hidden',display:'block',padding:'0 2px',lineHeight:1.2,wordBreak:'break-word'}}>
                            {cell.name.substring(0, cellSize<44?4:7)}
                            {(w>1||h>1) && <span style={{display:'block',fontSize:8,opacity:0.7}}>{w}×{h}</span>}
                          </span>
                          {counts && counts.total > 0 && (
                            <div style={{position:'absolute',bottom:2,right:2,display:'flex',gap:2,alignItems:'center'}}>
                              {counts.lowStock > 0 && <span style={{fontSize:8,lineHeight:1,background:'rgba(220,38,38,0.9)',color:'#fff',borderRadius:4,padding:'1px 3px',fontWeight:700}}>⚠️</span>}
                              <span style={{fontSize:8,lineHeight:1,background:'rgba(0,0,0,0.55)',color:'#fff',borderRadius:4,padding:'1px 4px',fontWeight:700}}>{counts.total}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{opacity:0.25,fontSize:16}}>+</span>
                      )}
                    </div>
                  )
                })}
                </div>
              </div>
            </div>
            <p style={{color:'var(--text3)',fontSize:12,marginTop:10,textAlign:'center'}}>
              {dragMode?'↕️ Glisse les étagères pour les repositionner':'Case = contenu · badge = nb produits · 🔍 pour chercher dans tous les produits'}
            </p>
          </>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {filtered.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🏭</div>
                <p>{search ? 'Aucun résultat' : 'Aucune étagère'}</p>
                {isEditor && !search && <button className="btn btn-primary" onClick={() => setShowAddShelf(true)}>Créer la première</button>}
              </div>
            ) : filtered.map(s => {
              const counts = productCounts[s.id] || { total: 0, lowStock: 0 }
              return (
                <div key={s.id} className="card card-hover" onClick={() => setSelectedShelf(s)} style={{display:'flex',gap:14,alignItems:'center'}}>
                  <div style={{width:10,height:44,borderRadius:4,background:cellColor(s),flexShrink:0}}/>
                  {s.image_url
                    ? <img src={s.image_url} style={{width:48,height:48,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={s.name}/>
                    : <div style={{width:48,height:48,borderRadius:8,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>📦</div>
                  }
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                      {s.name}
                      {counts.lowStock > 0 && <span style={{fontSize:11,background:'rgba(220,38,38,0.1)',color:'var(--red)',borderRadius:12,padding:'1px 7px',fontWeight:700}}>⚠️ {counts.lowStock} bas</span>}
                    </div>
                    {s.description && <div style={{color:'var(--text2)',fontSize:13,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.description}</div>}
                    <div style={{display:'flex',gap:10,marginTop:4,alignItems:'center'}}>
                      {s.zone_id && <span style={{fontSize:12,color:'var(--text3)'}}>{zones.find(z=>z.id===s.zone_id)?.name}</span>}
                      {counts.total > 0 && <span style={{fontSize:12,color:'var(--text3)'}}>📦 {counts.total} produit{counts.total>1?'s':''}</span>}
                    </div>
                  </div>
                  <span style={{color:'var(--text3)',fontSize:20}}>›</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showRoomModal && <RoomModal room={editRoom} onClose={() => { setShowRoomModal(false); setEditRoom(null) }} onSave={loadAll}/>}

      {showGridSettings && (
        <div className="modal-overlay" onClick={e => e.target===e.currentTarget && setShowGridSettings(false)}>
          <div className="modal">
            <h3 className="modal-title">⚙️ Réglages de la grille</h3>
            <div className="form-group">
              <label className="label">Colonnes ({gridCols})</label>
              <input className="input" type="range" min={4} max={40} value={gridCols} onChange={e => { const v=+e.target.value; setGridCols(v); try{localStorage.setItem('gridCols',v)}catch{} }}/>
            </div>
            <div className="form-group">
              <label className="label">Lignes ({gridRows})</label>
              <input className="input" type="range" min={4} max={40} value={gridRows} onChange={e => { const v=+e.target.value; setGridRows(v); try{localStorage.setItem('gridRows',v)}catch{} }}/>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowGridSettings(false)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {showExport    && <ExportModal   shelves={filtered} onClose={() => setShowExport(false)}/>}
      {showScanner   && <ScannerModal  onClose={() => setShowScanner(false)} onFound={id => { setShowScanner(false); const s=shelves.find(x=>x.id===id); if(s) setSelectedShelf(s); else alert('Étagère non trouvée') }}/>}
      {showImportCSV && <ImportCSVModal shelves={shelves} onClose={() => setShowImportCSV(false)} onDone={loadAll}/>}
      {showHistory   && <HistoryModal    onClose={() => setShowHistory(false)}/>}
      {showGlobalSearch && <GlobalSearchModal onClose={() => setShowGlobalSearch(false)} onSelect={shelf => { setShowGlobalSearch(false); setSelectedShelf(shelf) }}/>}

      {(showAddShelf || editShelf) && (
        <ShelfModal
          shelf={editShelf}
          zones={zones}
          gridCols={gridCols}
          gridRows={gridRows}
          onClose={() => { setShowAddShelf(false); setEditShelf(null) }}
          onSave={loadAll}
        />
      )}

      {selectedShelf && (
        <ShelfDetailModal
          shelf={selectedShelf}
          isEditor={isEditor}
          onClose={() => setSelectedShelf(null)}
          onEdit={() => { setEditShelf(selectedShelf); setSelectedShelf(null) }}
          onDelete={() => handleDelete(selectedShelf.id)}
          onRefresh={loadAll}
        />
      )}
    </div>
  )
}
