import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import QRCode from 'qrcode'
import { compressAndUpload } from '../lib/imageUtils'

// ── Constants ─────────────────────────────────────────────────
const PRESET_COLORS = ['#4F46E5','#7C3AED','#DB2777','#DC2626','#EA580C','#D97706','#65A30D','#16A34A','#0891B2','#0284C7','#6B7280','#374151']

// ── Grid settings (localStorage) ─────────────────────────────
function getGridSettings() {
  try {
    return {
      cols: Math.max(2, parseInt(localStorage.getItem('gridCols') || '12')),
      rows: Math.max(2, parseInt(localStorage.getItem('gridRows') || '8')),
    }
  } catch { return { cols: 12, rows: 8 } }
}

// ── Helpers ───────────────────────────────────────────────────
async function generateQR(shelfId) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const url = `${window.location.origin}${base}/shelf/${shelfId}`
  return await QRCode.toDataURL(url, { width: 256, margin: 2, color: { dark: '#1E1B4B', light: '#FFFFFF' } })
}

async function logMovement(action, productName, shelfName, shelfId, quantityChange = null) {
  try {
    await supabase.from('product_movements').insert({
      action, product_name: productName, shelf_name: shelfName,
      shelf_id: shelfId, quantity_change: quantityChange,
    })
  } catch (_) { /* non-blocking */ }
}

// ── Color Picker ──────────────────────────────────────────────
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

// ── Grid Settings Modal ───────────────────────────────────────
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

// ── Shelf Modal ───────────────────────────────────────────────
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
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Étagère A1"/>
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
  const toast = useToast()
  const section = sections.find(s => s.id === product.section_id)
  const isLow = product.min_quantity > 0 && product.quantity <= product.min_quantity

  async function handleDelete() {
    if (!confirm('Supprimer ce produit ?')) return
    await logMovement('delete', product.name, shelfName, product.shelf_id)
    const { error } = await supabase.from('products').delete().eq('id', product.id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    toast('Produit supprimé', 'success')
    onRefresh()
  }

  return (
    <div style={{display:'flex',gap:12,alignItems:'center',padding:'10px 14px',
      background: isLow ? 'rgba(220,38,38,0.06)' : 'var(--bg3)',
      borderRadius:'var(--radius)',border: isLow ? '1px solid rgba(220,38,38,0.3)' : '1px solid var(--border)'}}>
      {product.image_url && <img src={product.image_url} style={{width:48,height:48,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={product.name}/>}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:14,display:'flex',alignItems:'center',gap:6}}>
          {product.name}
          {isLow && <span title="Stock bas !" style={{fontSize:13}}>⚠️</span>}
        </div>
        {section && <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>🗂 {section.name}</div>}
        {product.reference && <div style={{fontSize:12,color:'var(--text3)'}}>Réf: {product.reference}</div>}
        <div style={{fontSize:13,color: isLow ? 'var(--red)' : 'var(--text2)',marginTop:2,fontWeight: isLow ? 700 : 400}}>
          Qté: <strong>{product.quantity} {product.unit}</strong>
          {product.min_quantity > 0 && <span style={{fontSize:11,color:'var(--text3)',marginLeft:6}}>min {product.min_quantity}</span>}
        </div>
        {isLow && <div style={{fontSize:12,color:'var(--red)',marginTop:2,fontWeight:600}}>⚠️ Stock bas — réapprovisionner</div>}
      </div>
      {isEditor && <button className="btn btn-ghost btn-icon btn-sm" onClick={handleDelete} style={{color:'var(--red)',fontSize:16}}>🗑️</button>}
    </div>
  )
}

// ── Add Product Form ───────────────────────────────────────────
function AddProductForm({ shelfId, shelfName, sections, onSave, onCancel }) {
  const [name,        setName]        = useState('')
  const [ref,         setRef]         = useState('')
  const [qty,         setQty]         = useState(1)
  const [minQty,      setMinQty]      = useState(0)
  const [unit,        setUnit]        = useState('pcs')
  const [desc,        setDesc]        = useState('')
  const [sectionId,   setSectionId]   = useState('')
  const [imgFile,     setImgFile]     = useState(null)
  const [imgPrev,     setImgPrev]     = useState(null)
  const [loading,     setLoading]     = useState(false)
  const toast = useToast()

  async function handleSave() {
    if (!name.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      let imageUrl = null
      if (imgFile) imageUrl = await compressAndUpload(imgFile, 'depot-images', `product_${name.replace(/\s/g,'_')}`)
      await supabase.from('products').insert({
        name: name.trim(), reference: ref, quantity: +qty, min_quantity: +minQty,
        unit, description: desc, shelf_id: shelfId, section_id: sectionId || null, image_url: imageUrl,
      })
      await logMovement('add', name.trim(), shelfName, shelfId, +qty)
      toast('Produit ajouté', 'success')
      onSave()
    } catch(err) { toast(err.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <>
      <h3 className="modal-title">Nouveau produit</h3>
      <div className="form-group"><label className="label">Nom</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Machine à fumée"/>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="label">Référence</label>
          <input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="REF-001"/>
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
          <input className="input" type="number" min={0} value={qty} onChange={e => setQty(e.target.value)}/>
        </div>
        <div className="form-group"><label className="label">Unité</label>
          <select className="input" value={unit} onChange={e => setUnit(e.target.value)}>
            {['pcs','boîte','kg','m','lot','câble','rouleau'].map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="label">Quantité minimum (alerte stock bas)</label>
        <input className="input" type="number" min={0} value={minQty} onChange={e => setMinQty(e.target.value)}
          placeholder="0 = pas d'alerte"/>
        <p style={{fontSize:12,color:'var(--text3)',marginTop:4}}>Une alerte ⚠️ s'affiche quand la quantité atteint ce seuil</p>
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
  const toast = useToast()

  useEffect(() => { loadProducts(); loadSections() }, [shelf.id])

  async function loadProducts() {
    const { data } = await supabase.from('products').select('*').eq('shelf_id', shelf.id).order('name')
    setProducts(data || [])
  }
  async function loadSections() {
    const { data } = await supabase.from('shelf_sections').select('*').eq('shelf_id', shelf.id).order('position')
    setSections(data || [])
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
    doc.getElementById('qr').src = qrData
    doc.getElementById('nm').textContent = shelf.name
    doc.getElementById('ds').textContent = shelf.description || ''
    win.print()
  }

  async function addSection() {
    if (!newSectionName.trim()) return
    const { error } = await supabase.from('shelf_sections').insert({
      shelf_id: shelf.id, name: newSectionName.trim(), position: sections.length,
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
                  placeholder="Étage 1, Haut, Bas, Tiroir..."
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
              <span className="section-title">Produits ({products.length})</span>
              {isEditor && <button className="btn btn-primary btn-sm" onClick={() => setShowAddProduct(true)}>+ Ajouter</button>}
            </div>
            {products.length === 0 ? (
              <div className="empty"><div className="empty-icon">📦</div><p>Aucun produit</p></div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {products.map(p => (
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
td{padding:7px 12px;border-bottom:1px solid #eee}.low{color:#dc2626;font-weight:700}
.no-products{padding:12px 16px;color:#999;font-style:italic}@media print{body{padding:10px}}</style>
</head><body>
<h1>📦 Export Dépôt — Stockr</h1>
<p class="subtitle">Généré le ${new Date().toLocaleDateString('fr')} · ${shelves.length} étagère${shelves.length>1?'s':''} · ${totalProducts} produit${totalProducts>1?'s':''}</p>
${exportData.map(({ shelf, products, sections, qrUrl }) => {
  const sectionMap = Object.fromEntries(sections.map(s => [s.id, s.name]))
  return `<div class="shelf"><div class="shelf-header"><img class="qr" src="${qrUrl}" alt="QR"/><div>
<div class="shelf-name">${shelf.name}</div>
${shelf.description ? `<div class="shelf-desc">${shelf.description}</div>` : ''}
<div class="shelf-meta">${products.length} produit${products.length!==1?'s':''}</div></div></div>
${products.length === 0 ? '<p class="no-products">Aucun produit</p>' :
`<table><thead><tr><th>Produit</th><th>Réf.</th><th>Étage</th><th>Quantité</th><th>Min</th><th>Description</th></tr></thead><tbody>
${products.map(p => {
  const isLow = p.min_quantity > 0 && p.quantity <= p.min_quantity
  return `<tr><td${isLow?' class="low"':''}>${p.name}${isLow?' ⚠️':''}</td><td>${p.reference||'—'}</td>
<td>${p.section_id && sectionMap[p.section_id] ? sectionMap[p.section_id] : '—'}</td>
<td${isLow?' class="low"':''}>${p.quantity} ${p.unit}</td>
<td>${p.min_quantity||'—'}</td><td>${p.description||''}</td></tr>`}).join('')}
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
            <p style={{fontSize:13,color:'var(--text3)'}}>Le document inclut QR codes, étages, produits et alertes stock bas. Utilise "Enregistrer en PDF" dans la boîte d'impression.</p>
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
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Réserve, Scène, Coulisses..."/>
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

// ── QR Scanner Modal ───────────────────────────────────────────
function QRScannerModal({ shelves, onFound, onClose }) {
  const [scanning, setScanning] = useState(false)
  const [status,   setStatus]   = useState('')
  const toast = useToast()

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setScanning(true)
    setStatus('Analyse du QR code...')
    try {
      if (!('BarcodeDetector' in window)) {
        toast('Scanner non disponible sur ce navigateur. Utilise Chrome ou Edge.', 'error')
        setStatus('')
        setScanning(false)
        return
      }
      const bitmap = await createImageBitmap(file)
      const detector = new BarcodeDetector({ formats: ['qr_code'] })
      const barcodes = await detector.detect(bitmap)
      if (barcodes.length === 0) {
        toast('Aucun QR code détecté dans cette image', 'error')
        setStatus('')
        setScanning(false)
        return
      }
      const value = barcodes[0].rawValue
      const match = value.match(/\/shelf\/([a-f0-9-]{36})/i)
      if (!match) { toast('QR code non reconnu (pas une étagère Stockr)', 'error'); setScanning(false); return }
      const shelf = shelves.find(s => s.id === match[1])
      if (!shelf) { toast('Étagère introuvable dans ce dépôt', 'error'); setScanning(false); return }
      setStatus('Étagère trouvée !')
      setTimeout(() => { onFound(shelf); onClose() }, 500)
    } catch(err) {
      toast('Erreur scan : ' + err.message, 'error')
      setScanning(false)
      setStatus('')
    }
  }

  const supported = 'BarcodeDetector' in window

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">📷 Scanner un QR Code</h3>
        {!supported ? (
          <div style={{padding:'20px 0',textAlign:'center'}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <p style={{color:'var(--text2)',fontSize:14}}>Le scanner QR nécessite Chrome ou Edge (Android/PC).</p>
            <p style={{color:'var(--text3)',fontSize:12,marginTop:8}}>Sur iOS, utilise l'appareil photo natif qui reconnaît les QR codes automatiquement.</p>
          </div>
        ) : (
          <>
            <p style={{color:'var(--text2)',fontSize:14,marginBottom:16}}>
              Prends une photo du QR code d'une étagère pour l'ouvrir directement.
            </p>
            <label style={{display:'block',cursor:'pointer'}}>
              <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={handleFile} disabled={scanning}/>
              <div style={{border:'2px dashed var(--border)',borderRadius:12,padding:'40px 20px',textAlign:'center',background:'var(--bg3)',transition:'border-color 0.2s'}}>
                {scanning
                  ? <><span className="spinner" style={{width:32,height:32}}/><p style={{marginTop:12,color:'var(--text2)',fontSize:13}}>{status}</p></>
                  : <><div style={{fontSize:48}}>📷</div>
                      <p style={{marginTop:8,fontWeight:600}}>Appuyer pour scanner</p>
                      <p style={{fontSize:12,color:'var(--text3)',marginTop:4}}>Ouvre la caméra ou la galerie</p>
                    </>}
              </div>
            </label>
          </>
        )}
        <div className="form-actions" style={{marginTop:16}}>
          <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

// ── Import CSV Modal ───────────────────────────────────────────
function ImportCSVModal({ shelves, onClose, onDone }) {
  const [file,    setFile]    = useState(null)
  const [shelfId, setShelfId] = useState('')
  const [preview, setPreview] = useState([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(false)
  const [parseErr,setParseErr]= useState('')
  const toast = useToast()

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/)
    const headers = lines[0].split(/[,;]/).map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = line.split(/[,;]/).map(v => v.trim().replace(/^"|"$/g, ''))
      const obj = {}
      headers.forEach((h, i) => { obj[h] = vals[i] || '' })
      return obj
    })
  }

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f); setParseErr('')
    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const rows = parseCSV(evt.target.result)
        setTotal(rows.length)
        setPreview(rows.slice(0, 5))
      } catch { setParseErr('Fichier CSV invalide') }
    }
    reader.readAsText(f, 'utf-8')
  }

  async function handleImport() {
    if (!shelfId) { toast('Choisir une étagère', 'error'); return }
    if (!file) return
    setLoading(true)
    const reader = new FileReader()
    reader.onload = async evt => {
      try {
        const rows = parseCSV(evt.target.result)
        const shelf = shelves.find(s => s.id === shelfId)
        const products = rows.map(r => ({
          shelf_id: shelfId,
          name: r.name || r.nom || r['produit'] || 'Sans nom',
          reference: r.reference || r.ref || r['réf'] || '',
          quantity: parseInt(r.quantity || r.quantite || r['quantité'] || r.qte || '0') || 0,
          unit: r.unit || r.unite || r['unité'] || 'pcs',
          description: r.description || r.notes || '',
          min_quantity: parseInt(r.min_quantity || r.min || r['min_qte'] || '0') || 0,
        }))
        const { error } = await supabase.from('products').insert(products)
        if (error) throw error
        await logMovement('import', `${products.length} produits importés`, shelf?.name, shelfId, products.length)
        toast(`${products.length} produit${products.length>1?'s':''} importé${products.length>1?'s':''}`, 'success')
        onDone(); onClose()
      } catch(err) { toast('Erreur import : ' + err.message, 'error') }
      finally { setLoading(false) }
    }
    reader.readAsText(file, 'utf-8')
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
          <p style={{fontSize:12,color:'var(--text3)',marginBottom:6}}>
            Colonnes acceptées : <code>name</code> (requis), <code>reference</code>, <code>quantity</code>, <code>unit</code>, <code>description</code>, <code>min_quantity</code><br/>
            Séparateur , ou ; · Encodage UTF-8
          </p>
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
                <div key={i} style={{borderBottom:'1px solid var(--border)',paddingBottom:4,marginBottom:4,lastChild:{borderBottom:'none'}}}>
                  <strong>{r.name || r.nom || '?'}</strong>
                  <span style={{color:'var(--text3)',marginLeft:8}}>Qté: {r.quantity || r.quantite || 0} {r.unit || r.unite || 'pcs'}</span>
                  {(r.reference || r.ref) && <span style={{color:'var(--text3)',marginLeft:8}}>· {r.reference || r.ref}</span>}
                  {(r.min_quantity || r.min) && <span style={{color:'var(--text3)',marginLeft:8}}>· min {r.min_quantity || r.min}</span>}
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
      const { data } = await supabase
        .from('product_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      setMovements(data || [])
      setLoading(false)
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
          <div className="empty"><div className="empty-icon">📋</div><p>Aucun mouvement enregistré</p><p style={{fontSize:13,color:'var(--text3)',marginTop:4}}>Les ajouts et suppressions de produits apparaissent ici.</p></div>
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
                    {m.quantity_change != null && m.action !== 'import' && <span style={{color:'var(--text3)'}}> · Qté {m.quantity_change > 0 ? '+' : ''}{m.quantity_change}</span>}
                  </div>
                  <div style={{fontSize:11,color:'var(--text3)',marginTop:3}}>
                    {new Date(m.created_at).toLocaleString('fr-FR')}
                  </div>
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

// ── Main DepotPage ─────────────────────────────────────────────
export default function DepotPage() {
  const { isEditor } = useAuth()
  const toast = useToast()

  const { cols: initCols, rows: initRows } = getGridSettings()
  const [gridCols, setGridCols] = useState(initCols)
  const [gridRows, setGridRows] = useState(initRows)

  const [shelves,         setShelves]         = useState([])
  const [zones,           setZones]           = useState([])
  const [rooms,           setRooms]           = useState([])
  const [productCounts,   setProductCounts]   = useState({})
  const [loading,         setLoading]         = useState(true)
  const [view,            setView]            = useState('grid')
  const [search,          setSearch]          = useState('')
  const [selectedShelf,   setSelectedShelf]   = useState(null)
  const [editShelf,       setEditShelf]       = useState(null)
  const [showAddShelf,    setShowAddShelf]    = useState(false)
  const [showGridSettings,setShowGridSettings]= useState(false)
  const [showExport,      setShowExport]      = useState(false)
  const [showScanner,     setShowScanner]     = useState(false)
  const [showImportCSV,   setShowImportCSV]   = useState(false)
  const [showHistory,     setShowHistory]     = useState(false)
  const [dragMode,        setDragMode]        = useState(false)
  const [dragShelfId,     setDragShelfId]     = useState(null)
  const [showRoomModal,   setShowRoomModal]   = useState(false)
  const [editRoom,        setEditRoom]        = useState(null)
  const [roomDrawMode,    setRoomDrawMode]    = useState(false)
  const [drawStart,       setDrawStart]       = useState(null)
  const [drawHover,       setDrawHover]       = useState(null)

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    const ch = supabase.channel('depot')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shelves' }, () => loadAll())
      .subscribe()
    return () => ch.unsubscribe()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: s }, { data: z }, { data: r }, { data: allProds }] = await Promise.all([
      supabase.from('shelves').select('*').order('name'),
      supabase.from('depot_zones').select('*').order('name'),
      supabase.from('depot_rooms').select('*').order('name'),
      supabase.from('products').select('shelf_id, quantity, min_quantity'),
    ])
    const shelvesList = s || []
    setShelves(shelvesList)
    setZones(z || [])
    setRooms(r || [])

    // Build product count + low stock info per shelf
    const counts = {}
    ;(allProds || []).forEach(p => {
      if (!counts[p.shelf_id]) counts[p.shelf_id] = { total: 0, lowStock: 0 }
      counts[p.shelf_id].total++
      if (p.min_quantity > 0 && p.quantity <= p.min_quantity) counts[p.shelf_id].lowStock++
    })
    setProductCounts(counts)
    setLoading(false)

    if (window.__pendingShelfId) {
      const target = shelvesList.find(sh => sh.id === window.__pendingShelfId)
      if (target) setSelectedShelf(target)
      window.__pendingShelfId = null
    }
  }

  async function handleDelete(shelfId) {
    if (!confirm('Supprimer cette étagère et tous ses produits ?')) return
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
            occupied.add(`${s.grid_x + dx}-${s.grid_y + dy}`)
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

  // Draw mode helpers
  function getDrawRect() {
    if (!drawStart || !drawHover) return null
    const x = Math.min(drawStart.x, drawHover.x)
    const y = Math.min(drawStart.y, drawHover.y)
    const w = Math.abs(drawHover.x - drawStart.x) + 1
    const h = Math.abs(drawHover.y - drawStart.y) + 1
    return { x, y, w, h }
  }

  function handleCellMouseDown(cx, cy, e) {
    if (!roomDrawMode) return
    e.preventDefault()
    setDrawStart({ x: cx, y: cy })
    setDrawHover({ x: cx, y: cy })
  }

  function handleCellMouseEnter(cx, cy) {
    if (!roomDrawMode || !drawStart) return
    setDrawHover({ x: cx, y: cy })
  }

  function handleCellMouseUp(cx, cy) {
    if (!roomDrawMode || !drawStart) return
    const rect = getDrawRect()
    if (rect) {
      setEditRoom({ grid_x: rect.x, grid_y: rect.y, grid_w: rect.w, grid_h: rect.h })
      setShowRoomModal(true)
    }
    setDrawStart(null); setDrawHover(null)
    setRoomDrawMode(false)
  }

  const filtered = shelves.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
  const { grid, occupied } = buildGrid()
  const cellSize = Math.max(36, Math.min(52, Math.floor((Math.min(window.innerWidth, 900) - 60) / gridCols)))

  const cells = []
  for (let y = 0; y < gridRows; y++) {
    for (let x = 0; x < gridCols; x++) {
      if (!occupied.has(`${x}-${y}`)) cells.push({ x, y, shelf: grid[y][x] })
    }
  }

  // Total low stock count for header badge
  const totalLowStock = Object.values(productCounts).reduce((a, c) => a + c.lowStock, 0)
  const drawRect = getDrawRect()

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <h1>🏭 Dépôt</h1>
            {totalLowStock > 0 && (
              <div style={{background:'var(--red)',color:'#fff',borderRadius:20,padding:'2px 10px',fontSize:12,fontWeight:700,cursor:'pointer'}}
                onClick={() => setView('list')} title="Voir les stocks bas">
                ⚠️ {totalLowStock} stock{totalLowStock>1?'s':''} bas
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <button className={`btn btn-sm ${view==='grid'?'btn-primary':'btn-secondary'}`} onClick={() => setView('grid')}>Grille</button>
            <button className={`btn btn-sm ${view==='list'?'btn-primary':'btn-secondary'}`} onClick={() => setView('list')}>Liste</button>
            {isEditor && (
              <button className={`btn btn-sm ${dragMode?'btn-primary':'btn-secondary'}`}
                onClick={() => { setDragMode(m => !m); setRoomDrawMode(false) }} title="Mode déplacement">↕️</button>
            )}
            {isEditor && (
              <button className={`btn btn-sm ${roomDrawMode?'btn-primary':'btn-secondary'}`}
                onClick={() => { setRoomDrawMode(m => !m); setDragMode(false) }} title="Dessiner une pièce">✏️🏠</button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowGridSettings(true)} title="Réglages grille">⚙️</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowExport(true)} title="Exporter PDF">📄</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowScanner(true)} title="Scanner QR">📷</button>
            {isEditor && <button className="btn btn-secondary btn-sm" onClick={() => setShowImportCSV(true)} title="Importer CSV">📥</button>}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowHistory(true)} title="Historique">📋</button>
            {isEditor && <button className="btn btn-secondary btn-sm" onClick={() => { setEditRoom(null); setShowRoomModal(true) }} title="Ajouter pièce">🏠</button>}
            {isEditor && <button className="btn btn-primary btn-sm" onClick={() => setShowAddShelf(true)}>+ Étagère</button>}
          </div>
        </div>
        {dragMode && <p style={{fontSize:12,color:'var(--indigo)',marginTop:6,fontWeight:500}}>↕️ Glisse une étagère vers une case vide pour la déplacer</p>}
        {roomDrawMode && <p style={{fontSize:12,color:'var(--violet)',marginTop:6,fontWeight:500}}>✏️ Clique et glisse sur la grille pour dessiner une pièce — Echap pour annuler</p>}
        <input className="input" style={{marginTop:12}} placeholder="🔍 Rechercher une étagère..." value={search} onChange={e => setSearch(e.target.value)}/>
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
                    <div style={{width:12,height:12,borderRadius:3,background:z.color}}/>
                    {z.name}
                  </div>
                ))}
                {rooms.length > 0 && <span style={{width:1,height:14,background:'var(--border)',display:'inline-block'}}/>}
                {rooms.map(r => (
                  <div key={r.id} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--text2)',cursor:isEditor?'pointer':'default'}}
                    onClick={isEditor ? () => { setEditRoom(r); setShowRoomModal(true) } : undefined}>
                    <div style={{width:12,height:12,borderRadius:3,background:r.color}}/>
                    🏠 {r.name}
                  </div>
                ))}
              </div>
            )}

            <div style={{overflowX:'auto',paddingBottom:8}}
              onMouseLeave={() => { if (roomDrawMode && drawStart) { setDrawStart(null); setDrawHover(null) } }}>
              <div style={{position:'relative',width:'fit-content',userSelect: roomDrawMode ? 'none' : 'auto'}}>
                {/* SVG overlay: rooms + draw preview */}
                {(() => {
                  const gap = 4, pad = 10
                  const totalW = gridCols * cellSize + (gridCols - 1) * gap + pad * 2
                  const totalH = gridRows * cellSize + (gridRows - 1) * gap + pad * 2
                  const showSVG = rooms.length > 0 || drawRect
                  if (!showSVG) return null
                  return (
                    <svg width={totalW} height={totalH} style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:2,borderRadius:'var(--radius-lg)'}}>
                      {rooms.map(room => {
                        const rx = pad + room.grid_x * (cellSize + gap)
                        const ry = pad + room.grid_y * (cellSize + gap)
                        const rw = room.grid_w * cellSize + (room.grid_w - 1) * gap
                        const rh = room.grid_h * cellSize + (room.grid_h - 1) * gap
                        return (
                          <g key={room.id} onClick={isEditor ? () => { setEditRoom(room); setShowRoomModal(true) } : undefined}
                            style={{pointerEvents: isEditor ? 'auto' : 'none', cursor: isEditor ? 'pointer' : 'default'}}>
                            <rect x={rx} y={ry} width={rw} height={rh} fill={room.color + '18'} stroke={room.color} strokeWidth={2} rx={8}/>
                            <rect x={rx+4} y={ry+2} width={Math.min(rw-8, room.name.length * 7 + 12)} height={17} fill={room.color + 'CC'} rx={4}/>
                            <text x={rx+10} y={ry+13} fill="#fff" fontSize={10} fontWeight="700" fontFamily="Inter,system-ui,sans-serif">{room.name}</text>
                          </g>
                        )
                      })}
                      {drawRect && (() => {
                        const rx = pad + drawRect.x * (cellSize + gap)
                        const ry = pad + drawRect.y * (cellSize + gap)
                        const rw = drawRect.w * cellSize + (drawRect.w - 1) * gap
                        const rh = drawRect.h * cellSize + (drawRect.h - 1) * gap
                        return (
                          <rect x={rx} y={ry} width={rw} height={rh}
                            fill="#7C3AED22" stroke="#7C3AED" strokeWidth={2} strokeDasharray="6 3" rx={8}/>
                        )
                      })()}
                    </svg>
                  )
                })()}

                <div style={{
                  display:'grid',
                  gridTemplateColumns:`repeat(${gridCols}, ${cellSize}px)`,
                  gridTemplateRows:`repeat(${gridRows}, ${cellSize}px)`,
                  gap:4,
                  background:'var(--bg3)',
                  border:'1px solid var(--border)',
                  borderRadius:'var(--radius-lg)',
                  padding:10,
                  width:'fit-content',
                }}>
                {cells.map(({ x, y, shelf: cell }) => {
                  const w = Math.max(1, cell?.grid_w || 1)
                  const h = Math.max(1, cell?.grid_h || 1)
                  const bg = cell ? cellColor(cell) : undefined
                  const isDragging = dragShelfId === cell?.id
                  const counts = cell ? (productCounts[cell.id] || { total: 0, lowStock: 0 }) : null
                  return (
                    <div
                      key={`${x}-${y}`}
                      className={`grid-cell ${cell ? 'occupied' : 'empty-cell'}`}
                      style={{
                        gridColumnStart: x+1, gridRowStart: y+1,
                        gridColumnEnd: `span ${w}`, gridRowEnd: `span ${h}`,
                        ...(cell ? { background: bg, border: `1px solid ${bg}`, opacity: isDragging ? 0.5 : 1 } : {}),
                        cursor: roomDrawMode ? 'crosshair' : dragMode ? (cell ? 'grab' : 'copy') : 'pointer',
                        fontSize: cellSize < 44 ? 9 : 11,
                        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                        textAlign:'center', overflow:'hidden', position:'relative',
                      }}
                      draggable={dragMode && !!cell && !roomDrawMode}
                      onDragStart={cell && !roomDrawMode ? () => setDragShelfId(cell.id) : undefined}
                      onDragEnd={() => setDragShelfId(null)}
                      onDragOver={e => { if (dragMode) e.preventDefault() }}
                      onDrop={() => { if (dragMode && !cell) handleDrop(x, y) }}
                      onMouseDown={e => handleCellMouseDown(x, y, e)}
                      onMouseEnter={() => handleCellMouseEnter(x, y)}
                      onMouseUp={() => handleCellMouseUp(x, y)}
                      onClick={() => {
                        if (dragMode || roomDrawMode) return
                        if (cell) setSelectedShelf(cell)
                        else if (isEditor) setShowAddShelf(true)
                      }}
                      title={cell ? cell.name : `Ajouter en (${x}, ${y})`}
                    >
                      {cell ? (
                        <>
                          <span style={{overflow:'hidden',display:'block',padding:'0 2px',lineHeight:1.2,wordBreak:'break-word'}}>
                            {cell.name.substring(0, cellSize < 44 ? 4 : 7)}
                            {(w > 1 || h > 1) && <span style={{display:'block',fontSize:8,opacity:0.7}}>{w}×{h}</span>}
                          </span>
                          {/* Product count badge */}
                          {counts && counts.total > 0 && (
                            <div style={{position:'absolute',bottom:2,right:2,display:'flex',gap:2,alignItems:'center'}}>
                              {counts.lowStock > 0 && (
                                <span style={{fontSize:8,lineHeight:1,background:'rgba(220,38,38,0.9)',color:'#fff',borderRadius:4,padding:'1px 3px',fontWeight:700}}>
                                  ⚠️
                                </span>
                              )}
                              <span style={{fontSize:8,lineHeight:1,background:'rgba(0,0,0,0.35)',color:'#fff',borderRadius:4,padding:'1px 4px',fontWeight:600}}>
                                {counts.total}
                              </span>
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
              {roomDrawMode ? '✏️ Clique et glisse pour dessiner une pièce'
                : dragMode ? '↕️ Glisse les étagères · clique ↕️ pour quitter'
                : 'Appuie sur une case pour voir son contenu · le badge = nombre de produits'}
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
                    <div style={{fontWeight:700,display:'flex',alignItems:'center',gap:6}}>
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

      {/* Modals */}
      {(showAddShelf || editShelf) && (
        <ShelfModal shelf={editShelf} zones={zones} gridCols={gridCols} gridRows={gridRows}
          onClose={() => { setShowAddShelf(false); setEditShelf(null) }}
          onSave={() => { loadAll(); setShowAddShelf(false); setEditShelf(null) }}/>
      )}
      {selectedShelf && (
        <ShelfDetailModal shelf={selectedShelf} onClose={() => setSelectedShelf(null)}
          onEdit={() => { setEditShelf(selectedShelf); setSelectedShelf(null) }}
          onDelete={() => handleDelete(selectedShelf.id)}
          isEditor={isEditor}/>
      )}
      {showGridSettings && (
        <GridSettingsModal onClose={() => setShowGridSettings(false)}
          onApply={() => { const { cols, rows } = getGridSettings(); setGridCols(cols); setGridRows(rows) }}/>
      )}
      {showExport && <ExportModal shelves={shelves} onClose={() => setShowExport(false)}/>}
      {showScanner && (
        <QRScannerModal shelves={shelves}
          onFound={shelf => { setSelectedShelf(shelf) }}
          onClose={() => setShowScanner(false)}/>
      )}
      {showImportCSV && (
        <ImportCSVModal shelves={shelves}
          onClose={() => setShowImportCSV(false)}
          onDone={loadAll}/>
      )}
      {showHistory && <HistoryModal onClose={() => setShowHistory(false)}/>}
      {showRoomModal && (
        <RoomModal room={editRoom} gridCols={gridCols} gridRows={gridRows}
          onClose={() => { setShowRoomModal(false); setEditRoom(null) }}
          onSave={loadAll}/>
      )}
    </div>
  )
}
