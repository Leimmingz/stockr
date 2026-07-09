import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import QRCode from 'qrcode'

// ── Constants ─────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
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

// ── Helpers ────────────────────────────────────────────────────
async function uploadImage(file, bucket, path) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) throw new Error('Format non supporté (jpg, png, webp, gif)')
  if (file.size > MAX_IMAGE_SIZE) throw new Error('Image trop lourde (max 5 Mo)')
  const ext = file.name.split('.').pop().toLowerCase()
  const name = `${path}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(name, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(name)
  return data.publicUrl
}

async function generateQR(shelfId) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const url = `${window.location.origin}${base}/shelf/${shelfId}`
  return await QRCode.toDataURL(url, { width: 256, margin: 2, color: { dark: '#1E1B4B', light: '#FFFFFF' } })
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
    onApply()
    onClose()
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

// ── Shelf Modal (add / edit) ───────────────────────────────────
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

  function handleImg(e) {
    const f = e.target.files[0]
    if (!f) return
    setImgFile(f)
    setImgPrev(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })
  }

  async function handleSave() {
    if (!name.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      let imageUrl = shelf?.image_url || null
      if (imgFile) imageUrl = await uploadImage(imgFile, 'depot-images', `shelf_${name.replace(/\s/g,'_')}`)
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
        const qrUrl = await uploadImage(new File([blob], 'qr.png', { type: 'image/png' }), 'qr-codes', `qr_${savedShelf.id}`)
        await supabase.from('shelves').update({ qr_code_url: qrUrl }).eq('id', savedShelf.id)
        savedShelf.qr_code_url = qrUrl
      }
      onSave(savedShelf)
      toast(shelf?.id ? 'Étagère mise à jour' : 'Étagère créée', 'success')
      onClose()
    } catch(err) {
      toast(err.message, 'error')
    } finally {
      setLoading(false)
    }
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
          {(+gridW > 1 || +gridH > 1) && (
            <p style={{fontSize:12,color:'var(--text3)',marginTop:4}}>
              Occupe {+gridW} × {+gridH} cases — utile pour représenter une grande étagère
            </p>
          )}
        </div>

        <div className="form-group">
          <label className="label">Description</label>
          <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Contenu, notes..."/>
        </div>

        <div className="form-group">
          <label className="label">Photo</label>
          <label className="upload-zone">
            <input type="file" accept="image/*" style={{display:'none'}} onChange={handleImg}/>
            {imgPrev
              ? <img src={imgPrev} className="upload-preview" alt="preview"/>
              : <><div style={{fontSize:32}}>📷</div><div style={{marginTop:8,fontSize:13}}>Choisir une photo</div></>}
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
function ProductCard({ product, sections, isEditor, onRefresh }) {
  const toast = useToast()
  const section = sections.find(s => s.id === product.section_id)

  async function handleDelete() {
    if (!confirm('Supprimer ce produit ?')) return
    const { error } = await supabase.from('products').delete().eq('id', product.id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    toast('Produit supprimé', 'success')
    onRefresh()
  }

  return (
    <div style={{display:'flex',gap:12,alignItems:'center',padding:'10px 14px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
      {product.image_url && <img src={product.image_url} style={{width:48,height:48,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={product.name}/>}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontWeight:600,fontSize:14}}>{product.name}</div>
        {section && <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>🗂 {section.name}</div>}
        {product.reference && <div style={{fontSize:12,color:'var(--text3)'}}>Réf: {product.reference}</div>}
        <div style={{fontSize:13,color:'var(--text2)',marginTop:2}}>Qté: <strong>{product.quantity} {product.unit}</strong></div>
      </div>
      {isEditor && <button className="btn btn-ghost btn-icon btn-sm" onClick={handleDelete} style={{color:'var(--red)',fontSize:16}}>🗑️</button>}
    </div>
  )
}

// ── Add Product Form ───────────────────────────────────────────
function AddProductForm({ shelfId, sections, onSave, onCancel }) {
  const [name,      setName]      = useState('')
  const [ref,       setRef]       = useState('')
  const [qty,       setQty]       = useState(1)
  const [unit,      setUnit]      = useState('pcs')
  const [desc,      setDesc]      = useState('')
  const [sectionId, setSectionId] = useState('')
  const [imgFile,   setImgFile]   = useState(null)
  const [imgPrev,   setImgPrev]   = useState(null)
  const [loading,   setLoading]   = useState(false)
  const toast = useToast()

  async function handleSave() {
    if (!name.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      let imageUrl = null
      if (imgFile) imageUrl = await uploadImage(imgFile, 'depot-images', `product_${name.replace(/\s/g,'_')}`)
      await supabase.from('products').insert({
        name: name.trim(), reference: ref, quantity: +qty, unit,
        description: desc, shelf_id: shelfId, section_id: sectionId || null, image_url: imageUrl,
      })
      toast('Produit ajouté', 'success')
      onSave()
    } catch(err) {
      toast(err.message, 'error')
    } finally {
      setLoading(false)
    }
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
  const [products,        setProducts]        = useState([])
  const [sections,        setSections]        = useState([])
  const [showAddProduct,  setShowAddProduct]  = useState(false)
  const [showAddSection,  setShowAddSection]  = useState(false)
  const [newSectionName,  setNewSectionName]  = useState('')
  const [showQR,          setShowQR]          = useState(false)
  const [qrData,          setQrData]          = useState(null)
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
    loadSections()
    toast('Étage ajouté', 'success')
  }

  async function deleteSection(id) {
    if (!confirm('Supprimer cet étage ?')) return
    const { error } = await supabase.from('shelf_sections').delete().eq('id', id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    loadSections()
  }

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
          <AddProductForm shelfId={shelf.id} sections={sections}
            onSave={() => { loadProducts(); setShowAddProduct(false) }}
            onCancel={() => setShowAddProduct(false)}/>
        ) : (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
              <div>
                <h3 style={{fontSize:20,fontWeight:700}}>{shelf.name}</h3>
                {shelf.description && <p style={{color:'var(--text2)',fontSize:14,marginTop:4}}>{shelf.description}</p>}
              </div>
              <button className="btn btn-ghost btn-icon" onClick={onClose} style={{fontSize:20}}>✕</button>
            </div>

            {shelf.image_url && <img src={shelf.image_url} style={{width:'100%',borderRadius:10,marginBottom:16,maxHeight:200,objectFit:'cover'}} alt={shelf.name}/>}

            <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
              <button className="btn btn-secondary btn-sm" onClick={handleShowQR}>📱 QR Code</button>
              {isEditor && <button className="btn btn-secondary btn-sm" onClick={onEdit}>✏️ Modifier</button>}
              {isEditor && <button className="btn btn-danger btn-sm" onClick={onDelete}>🗑️ Supprimer</button>}
            </div>

            {/* Étages / Sections */}
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

            {/* Products */}
            <div className="section-header">
              <span className="section-title">Produits ({products.length})</span>
              {isEditor && <button className="btn btn-primary btn-sm" onClick={() => setShowAddProduct(true)}>+ Ajouter</button>}
            </div>
            {products.length === 0 ? (
              <div className="empty"><div className="empty-icon">📦</div><p>Aucun produit</p></div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {products.map(p => (
                  <ProductCard key={p.id} product={p} sections={sections} isEditor={isEditor} onRefresh={loadProducts}/>
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
    setExportData(result)
    setLoading(false)
  }

  function handlePrint() {
    const totalProducts = exportData.reduce((a, d) => a + d.products.length, 0)
    const win = window.open('', '_blank')
    const doc = win.document
    doc.open()
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Stockr — Export Dépôt</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; padding: 20px; color: #111; font-size: 13px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
  .subtitle { color: #666; font-size: 12px; margin-bottom: 24px; }
  .shelf { page-break-inside: avoid; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
  .shelf-header { display: flex; align-items: center; gap: 16px; padding: 14px 16px; background: #f9f9f9; border-bottom: 1px solid #ddd; }
  .qr { width: 80px; height: 80px; flex-shrink: 0; }
  .shelf-name { font-size: 16px; font-weight: 700; }
  .shelf-desc { font-size: 12px; color: #666; margin-top: 3px; }
  .shelf-meta { font-size: 11px; color: #999; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f0f0f0; text-align: left; padding: 7px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #ddd; }
  td { padding: 7px 12px; border-bottom: 1px solid #eee; }
  .no-products { padding: 12px 16px; color: #999; font-style: italic; }
  @media print { body { padding: 10px; } }
</style>
</head>
<body>
<h1>📦 Export Dépôt — Stockr</h1>
<p class="subtitle">Généré le ${new Date().toLocaleDateString('fr')} · ${shelves.length} étagère${shelves.length>1?'s':''} · ${totalProducts} produit${totalProducts>1?'s':''}</p>
${exportData.map(({ shelf, products, sections, qrUrl }) => {
  const sectionMap = Object.fromEntries(sections.map(s => [s.id, s.name]))
  return `
<div class="shelf">
  <div class="shelf-header">
    <img class="qr" src="${qrUrl}" alt="QR"/>
    <div>
      <div class="shelf-name">${shelf.name}</div>
      ${shelf.description ? `<div class="shelf-desc">${shelf.description}</div>` : ''}
      <div class="shelf-meta">${products.length} produit${products.length!==1?'s':''} · ${sections.length} étage${sections.length!==1?'s':''}</div>
    </div>
  </div>
  ${products.length === 0
    ? '<p class="no-products">Aucun produit</p>'
    : `<table>
    <thead><tr><th>Produit</th><th>Réf.</th><th>Étage</th><th>Quantité</th><th>Description</th></tr></thead>
    <tbody>${products.map(p => `
      <tr>
        <td>${p.name}</td>
        <td>${p.reference || '—'}</td>
        <td>${p.section_id && sectionMap[p.section_id] ? sectionMap[p.section_id] : '—'}</td>
        <td>${p.quantity} ${p.unit}</td>
        <td>${p.description || ''}</td>
      </tr>`).join('')}
    </tbody>
  </table>`}
</div>`}).join('')}
</body>
</html>`
    doc.write(html)
    doc.close()
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
            <p style={{color:'var(--text2)',fontSize:13}}>Chargement des produits et QR codes...</p>
          </div>
        ) : (
          <div style={{marginBottom:20}}>
            <p style={{color:'var(--text2)',fontSize:14,marginBottom:8}}>
              <strong>{shelves.length}</strong> étagère{shelves.length>1?'s':''} · <strong>{totalProducts}</strong> produit{totalProducts>1?'s':''}
            </p>
            <p style={{fontSize:13,color:'var(--text3)'}}>
              Le document inclut chaque étagère avec son QR code, ses étages et la liste complète de ses produits.
              Utilise "Enregistrer en PDF" dans la boîte d'impression pour obtenir un fichier PDF.
            </p>
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>Fermer</button>
          <button className="btn btn-primary" onClick={handlePrint} disabled={loading}>
            🖨️ Imprimer / PDF
          </button>
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

  const [shelves,       setShelves]       = useState([])
  const [zones,         setZones]         = useState([])
  const [loading,       setLoading]       = useState(true)
  const [view,          setView]          = useState('grid')
  const [search,        setSearch]        = useState('')
  const [selectedShelf, setSelectedShelf] = useState(null)
  const [editShelf,     setEditShelf]     = useState(null)
  const [showAddShelf,  setShowAddShelf]  = useState(false)
  const [showGridSettings, setShowGridSettings] = useState(false)
  const [showExport,    setShowExport]    = useState(false)
  const [dragMode,      setDragMode]      = useState(false)
  const [dragShelfId,   setDragShelfId]   = useState(null)

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    const ch = supabase.channel('depot')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shelves' }, () => loadAll())
      .subscribe()
    return () => ch.unsubscribe()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: s }, { data: z }] = await Promise.all([
      supabase.from('shelves').select('*').order('name'),
      supabase.from('depot_zones').select('*').order('name'),
    ])
    const shelvesList = s || []
    setShelves(shelvesList)
    setZones(z || [])
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
    setSelectedShelf(null)
    loadAll()
  }

  async function handleDrop(x, y) {
    if (!dragShelfId) return
    const { error } = await supabase.from('shelves').update({ grid_x: x, grid_y: y }).eq('id', dragShelfId)
    if (error) { toast('Erreur déplacement : ' + error.message, 'error') }
    setDragShelfId(null)
    loadAll()
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

  const filtered = shelves.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
  const { grid, occupied } = buildGrid()

  // Responsive cell size
  const cellSize = Math.max(36, Math.min(52, Math.floor((Math.min(window.innerWidth, 900) - 60) / gridCols)))

  // Collect cells to render (exclude consumed by spanning shelves)
  const cells = []
  for (let y = 0; y < gridRows; y++) {
    for (let x = 0; x < gridCols; x++) {
      if (!occupied.has(`${x}-${y}`)) cells.push({ x, y, shelf: grid[y][x] })
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <h1>🏭 Dépôt</h1>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <button className={`btn btn-sm ${view==='grid'?'btn-primary':'btn-secondary'}`} onClick={() => setView('grid')}>Grille</button>
            <button className={`btn btn-sm ${view==='list'?'btn-primary':'btn-secondary'}`} onClick={() => setView('list')}>Liste</button>
            {isEditor && (
              <button
                className={`btn btn-sm ${dragMode?'btn-primary':'btn-secondary'}`}
                onClick={() => setDragMode(m => !m)}
                title="Mode déplacement">↕️</button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => setShowGridSettings(true)} title="Réglages grille">⚙️</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowExport(true)} title="Exporter PDF">📄</button>
            {isEditor && <button className="btn btn-primary btn-sm" onClick={() => setShowAddShelf(true)}>+ Étagère</button>}
          </div>
        </div>
        {dragMode && <p style={{fontSize:12,color:'var(--indigo)',marginTop:6,fontWeight:500}}>↕️ Glisse une étagère vers une case vide pour la déplacer</p>}
        <input className="input" style={{marginTop:12}} placeholder="🔍 Rechercher une étagère..." value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      <div className="page-content">
        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:60}}>
            <span className="spinner" style={{width:32,height:32}}/>
          </div>
        ) : view === 'grid' ? (
          <>
            {zones.length > 0 && (
              <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:16}}>
                {zones.map(z => (
                  <div key={z.id} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--text2)'}}>
                    <div style={{width:12,height:12,borderRadius:3,background:z.color}}/>
                    {z.name}
                  </div>
                ))}
              </div>
            )}

            <div style={{overflowX:'auto',paddingBottom:8}}>
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
                  return (
                    <div
                      key={`${x}-${y}`}
                      className={`grid-cell ${cell ? 'occupied' : 'empty-cell'}`}
                      style={{
                        gridColumnStart: x+1, gridRowStart: y+1,
                        gridColumnEnd: `span ${w}`, gridRowEnd: `span ${h}`,
                        ...(cell ? { background: bg, border: `1px solid ${bg}`, opacity: isDragging ? 0.5 : 1 } : {}),
                        cursor: dragMode ? (cell ? 'grab' : 'copy') : 'pointer',
                        fontSize: cellSize < 44 ? 9 : 11,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        textAlign:'center', overflow:'hidden',
                      }}
                      draggable={dragMode && !!cell}
                      onDragStart={cell ? () => setDragShelfId(cell.id) : undefined}
                      onDragEnd={() => setDragShelfId(null)}
                      onDragOver={e => { if (dragMode) e.preventDefault() }}
                      onDrop={() => { if (dragMode && !cell) handleDrop(x, y) }}
                      onClick={() => {
                        if (dragMode) return
                        if (cell) setSelectedShelf(cell)
                        else if (isEditor) setShowAddShelf(true)
                      }}
                      title={cell ? cell.name : `Ajouter en (${x}, ${y})`}
                    >
                      {cell
                        ? <span style={{overflow:'hidden',display:'block',padding:'0 2px',lineHeight:1.2,wordBreak:'break-word'}}>
                            {cell.name.substring(0, cellSize < 44 ? 4 : 7)}
                            {(w > 1 || h > 1) && <span style={{display:'block',fontSize:8,opacity:0.7}}>{w}×{h}</span>}
                          </span>
                        : <span style={{opacity:0.25,fontSize:16}}>+</span>
                      }
                    </div>
                  )
                })}
              </div>
            </div>
            <p style={{color:'var(--text3)',fontSize:12,marginTop:10,textAlign:'center'}}>
              {dragMode ? '↕️ Glisse les étagères · clique ↕️ pour quitter' : 'Appuie sur une case pour voir son contenu · + pour ajouter'}
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
            ) : filtered.map(s => (
              <div key={s.id} className="card card-hover" onClick={() => setSelectedShelf(s)} style={{display:'flex',gap:14,alignItems:'center'}}>
                <div style={{width:10,height:44,borderRadius:4,background:cellColor(s),flexShrink:0}}/>
                {s.image_url
                  ? <img src={s.image_url} style={{width:48,height:48,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={s.name}/>
                  : <div style={{width:48,height:48,borderRadius:8,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>📦</div>
                }
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700}}>{s.name}</div>
                  {s.description && <div style={{color:'var(--text2)',fontSize:13,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.description}</div>}
                  {s.zone_id && <div style={{display:'flex',alignItems:'center',gap:5,marginTop:4}}>
                    <div style={{width:8,height:8,borderRadius:2,background:cellColor(s)}}/>
                    <span style={{fontSize:12,color:'var(--text3)'}}>{zones.find(z=>z.id===s.zone_id)?.name}</span>
                  </div>}
                </div>
                <span style={{color:'var(--text3)',fontSize:20}}>›</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {(showAddShelf || editShelf) && (
        <ShelfModal
          shelf={editShelf}
          zones={zones}
          gridCols={gridCols}
          gridRows={gridRows}
          onClose={() => { setShowAddShelf(false); setEditShelf(null) }}
          onSave={() => { loadAll(); setShowAddShelf(false); setEditShelf(null) }}
        />
      )}
      {selectedShelf && (
        <ShelfDetailModal
          shelf={selectedShelf}
          onClose={() => setSelectedShelf(null)}
          onEdit={() => { setEditShelf(selectedShelf); setSelectedShelf(null) }}
          onDelete={() => handleDelete(selectedShelf.id)}
          isEditor={isEditor}
        />
      )}
      {showGridSettings && (
        <GridSettingsModal
          onClose={() => setShowGridSettings(false)}
          onApply={() => {
            const { cols, rows } = getGridSettings()
            setGridCols(cols)
            setGridRows(rows)
          }}
        />
      )}
      {showExport && <ExportModal shelves={shelves} onClose={() => setShowExport(false)}/>}
    </div>
  )
}
