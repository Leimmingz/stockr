import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import QRCode from 'qrcode'

const GRID_COLS = 12
const GRID_ROWS = 8

// ── Image upload helper ──────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5 MB

async function uploadImage(file, bucket, path) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) throw new Error('Format non supporté (jpg, png, webp, gif uniquement)')
  if (file.size > MAX_IMAGE_SIZE) throw new Error('Image trop lourde (max 5 Mo)')
  const ext = file.name.split('.').pop().toLowerCase()
  const name = `${path}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(name, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(name)
  return data.publicUrl
}

// ── QR Code generator ────────────────────────────────────────
async function generateQR(shelfId) {
  // BASE_URL = '/stockr/' en prod (défini dans vite.config.js), '/' en dev
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const url = `${window.location.origin}${base}/shelf/${shelfId}`
  return await QRCode.toDataURL(url, { width: 256, margin: 2, color: { dark: '#1E1B4B', light: '#FFFFFF' } })
}

// ── Modal: Add/Edit shelf ────────────────────────────────────
function ShelfModal({ shelf, zones, onClose, onSave }) {
  const [name, setName]       = useState(shelf?.name || '')
  const [zoneId, setZoneId]   = useState(shelf?.zone_id || '')
  const [desc, setDesc]       = useState(shelf?.description || '')
  const [gridX, setGridX]     = useState(shelf?.grid_x ?? 0)
  const [gridY, setGridY]     = useState(shelf?.grid_y ?? 0)
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

      const payload = { name: name.trim(), zone_id: zoneId || null, description: desc, grid_x: +gridX, grid_y: +gridY, image_url: imageUrl }

      let savedShelf
      if (shelf?.id) {
        const { data, error } = await supabase.from('shelves').update(payload).eq('id', shelf.id).select().single()
        if (error) throw error
        savedShelf = data
      } else {
        const { data, error } = await supabase.from('shelves').insert(payload).select().single()
        if (error) throw error
        savedShelf = data
        // Generate QR
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
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Étagère 12"/>
        </div>
        <div className="form-group">
          <label className="label">Zone</label>
          <select className="input" value={zoneId} onChange={e => setZoneId(e.target.value)}>
            <option value="">Sans zone</option>
            {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="label">Position X (colonne)</label>
            <input className="input" type="number" min={0} max={GRID_COLS-1} value={gridX} onChange={e => setGridX(e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="label">Position Y (rangée)</label>
            <input className="input" type="number" min={0} max={GRID_ROWS-1} value={gridY} onChange={e => setGridY(e.target.value)}/>
          </div>
        </div>
        <div className="form-group">
          <label className="label">Description</label>
          <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Contenu, notes..."/>
        </div>
        <div className="form-group">
          <label className="label">Photo</label>
          <label className="upload-zone">
            <input type="file" accept="image/*" style={{ display:'none' }} onChange={handleImg}/>
            {imgPrev ? <img src={imgPrev} className="upload-preview" alt="preview"/> : <><div style={{fontSize:32}}>📷</div><div style={{marginTop:8,fontSize:13}}>Appuyer pour choisir une photo</div></>}
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

// ── Modal: Shelf detail + products ──────────────────────────
function ShelfDetailModal({ shelf, onClose, onEdit, onDelete, isEditor }) {
  const [products, setProducts] = useState([])
  const [sections, setSections] = useState([])
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [qrData, setQrData] = useState(null)
  const toast = useToast()

  useEffect(() => {
    loadProducts()
    loadSections()
  }, [shelf.id])

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
    // Échappement XSS : on construit le DOM via textContent, pas innerHTML
    const doc = win.document
    doc.open()
    doc.write('<html><head><meta charset="utf-8"></head><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#fff"><img id="qr" style="width:200px"/><p id="nm" style="margin-top:12px;font-weight:700;font-size:18px"></p><p id="ds" style="color:#666;font-size:14px"></p></body></html>')
    doc.close()
    doc.getElementById('qr').src = qrData
    doc.getElementById('nm').textContent = shelf.name
    doc.getElementById('ds').textContent = shelf.description || ''
    win.print()
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
          <AddProductForm shelfId={shelf.id} sections={sections} onSave={() => { loadProducts(); setShowAddProduct(false) }} onCancel={() => setShowAddProduct(false)}/>
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
        {section && <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>📍 {section.name}</div>}
        {product.reference && <div style={{fontSize:12,color:'var(--text3)'}}>Réf: {product.reference}</div>}
        <div style={{fontSize:13,color:'var(--text2)',marginTop:2}}>Qté: <strong>{product.quantity} {product.unit}</strong></div>
      </div>
      {isEditor && <button className="btn btn-ghost btn-icon btn-sm" onClick={handleDelete} style={{color:'var(--red)',fontSize:16}}>🗑️</button>}
    </div>
  )
}

function AddProductForm({ shelfId, sections, onSave, onCancel }) {
  const [name, setName]         = useState('')
  const [ref, setRef]           = useState('')
  const [qty, setQty]           = useState(1)
  const [unit, setUnit]         = useState('pcs')
  const [desc, setDesc]         = useState('')
  const [sectionId, setSectionId] = useState('')
  const [imgFile, setImgFile]   = useState(null)
  const [imgPrev, setImgPrev]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const toast = useToast()

  async function handleSave() {
    if (!name.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      let imageUrl = null
      if (imgFile) imageUrl = await uploadImage(imgFile, 'depot-images', `product_${name.replace(/\s/g,'_')}`)
      await supabase.from('products').insert({ name: name.trim(), reference: ref, quantity: +qty, unit, description: desc, shelf_id: shelfId, section_id: sectionId || null, image_url: imageUrl })
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
      <div className="form-group"><label className="label">Nom</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Machine à fumée"/></div>
      <div className="form-row">
        <div className="form-group"><label className="label">Référence</label><input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="REF-001"/></div>
        <div className="form-group"><label className="label">Section</label>
          <select className="input" value={sectionId} onChange={e => setSectionId(e.target.value)}>
            <option value="">Aucune</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="label">Quantité</label><input className="input" type="number" min={0} value={qty} onChange={e => setQty(e.target.value)}/></div>
        <div className="form-group"><label className="label">Unité</label>
          <select className="input" value={unit} onChange={e => setUnit(e.target.value)}>
            {['pcs','boîte','kg','m','lot','câble','rouleau'].map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group"><label className="label">Description</label><textarea className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Notes..."/></div>
      <div className="form-group">
        <label className="label">Photo</label>
        <label className="upload-zone">
          <input type="file" accept="image/*" style={{display:'none'}} onChange={e => { const f=e.target.files[0]; if(f){ setImgFile(f); setImgPrev(prev => { if(prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f) }) }}}/>
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

// ── Main DepotPage ───────────────────────────────────────────
export default function DepotPage() {
  const { isEditor } = useAuth()
  const toast = useToast()

  const [shelves, setShelves]       = useState([])
  const [zones, setZones]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [view, setView]             = useState('grid') // grid | list
  const [search, setSearch]         = useState('')
  const [selectedShelf, setSelectedShelf] = useState(null)
  const [editShelf, setEditShelf]   = useState(null)
  const [showAddShelf, setShowAddShelf] = useState(false)

  useEffect(() => { loadAll() }, [])

  // Realtime sync
  useEffect(() => {
    const ch = supabase.channel('depot').on('postgres_changes', { event: '*', schema: 'public', table: 'shelves' }, () => loadAll()).subscribe()
    return () => ch.unsubscribe()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: s }, { data: z }] = await Promise.all([
      supabase.from('shelves').select('*').order('name'),
      supabase.from('depot_zones').select('*').order('name')
    ])
    const shelvesList = s || []
    setShelves(shelvesList)
    setZones(z || [])
    setLoading(false)
    // Consomme le deep link QR (scan → ouverture directe de l'étagère)
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

  // Build grid
  function buildGrid() {
    const grid = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(null))
    shelves.forEach(s => {
      if (s.grid_y >= 0 && s.grid_y < GRID_ROWS && s.grid_x >= 0 && s.grid_x < GRID_COLS) {
        grid[s.grid_y][s.grid_x] = s
      }
    })
    return grid
  }

  const filtered = shelves.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
  const grid = buildGrid()

  function zoneColor(zoneId) {
    const z = zones.find(z => z.id === zoneId)
    return z?.color || '#4F46E5'
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h1>🏭 Dépôt</h1>
          <div style={{display:'flex',gap:8}}>
            <button className={`btn btn-sm ${view==='grid'?'btn-primary':'btn-secondary'}`} onClick={() => setView('grid')}>Grille</button>
            <button className={`btn btn-sm ${view==='list'?'btn-primary':'btn-secondary'}`} onClick={() => setView('list')}>Liste</button>
            {isEditor && <button className="btn btn-primary btn-sm" onClick={() => setShowAddShelf(true)}>+ Étagère</button>}
          </div>
        </div>
        <input className="input" style={{marginTop:12}} placeholder="🔍 Rechercher une étagère..." value={search} onChange={e => setSearch(e.target.value)}/>
      </div>

      <div className="page-content">
        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:60}}><span className="spinner" style={{width:32,height:32}}/></div>
        ) : view === 'grid' ? (
          <>
            {/* Legend */}
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

            {/* Grid */}
            <div style={{overflowX:'auto',paddingBottom:8}}>
              <div style={{display:'grid',gridTemplateColumns:`repeat(${GRID_COLS}, 52px)`,gridTemplateRows:`repeat(${GRID_ROWS}, 52px)`,gap:4,background:'var(--bg3)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:12,width:'fit-content',minWidth:'100%'}}>
                {grid.map((row, y) => row.map((cell, x) => (
                  <div
                    key={`${x}-${y}`}
                    className={`grid-cell ${cell ? 'occupied' : 'empty-cell'}`}
                    style={cell ? { background: zoneColor(cell.zone_id), border: `1px solid ${zoneColor(cell.zone_id)}` } : {}}
                    onClick={() => cell ? setSelectedShelf(cell) : isEditor && setShowAddShelf(true)}
                    title={cell ? cell.name : `Ajouter en (${x}, ${y})`}
                  >
                    {cell ? cell.name.substring(0, 6) : <span style={{opacity:0.3}}>+</span>}
                  </div>
                )))}
              </div>
            </div>

            <p style={{color:'var(--text3)',fontSize:12,marginTop:10,textAlign:'center'}}>Appuyer sur une étagère pour voir son contenu · + pour ajouter</p>
          </>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {filtered.length === 0 ? (
              <div className="empty"><div className="empty-icon">🏭</div><p>{search ? 'Aucun résultat' : 'Aucune étagère'}</p>{isEditor && !search && <button className="btn btn-primary" onClick={() => setShowAddShelf(true)}>Créer la première</button>}</div>
            ) : filtered.map(s => (
              <div key={s.id} className="card card-hover" onClick={() => setSelectedShelf(s)} style={{display:'flex',gap:14,alignItems:'center'}}>
                {s.image_url
                  ? <img src={s.image_url} style={{width:56,height:56,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={s.name}/>
                  : <div style={{width:56,height:56,borderRadius:8,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,flexShrink:0}}>📦</div>
                
                }
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700}}>{s.name}</div>
                  {s.description && <div style={{color:'var(--text2)',fontSize:13,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.description}</div>}
                  {s.zone_id && <div style={{display:'flex',alignItems:'center',gap:5,marginTop:4}}><div style={{width:8,height:8,borderRadius:2,background:zoneColor(s.zone_id)}}/><span style={{fontSize:12,color:'var(--text3)'}}>{zones.find(z=>z.id===s.zone_id)?.name}</span></div>}
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
    </div>
  )
}
