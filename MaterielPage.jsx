import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { compressAndUpload } from '../lib/imageUtils'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const AUDIO_TYPES  = ['Ampli','Enceinte','Caisson','Console / Mixeur','Processeur','Micro','Câble','Autre']

// ── Shelf picker (shared) ─────────────────────────────────────
function useShelves() {
  const [shelves, setShelves] = useState([])
  useEffect(() => {
    supabase.from('shelves').select('id, name').order('name').then(({ data }) => setShelves(data || []))
  }, [])
  return shelves
}

function ShelfPickerField({ shelves, value, onChange }) {
  return (
    <div className="form-group">
      <label className="label">Ajouter directement dans une étagère (optionnel)</label>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Ne pas ajouter à une étagère</option>
        {shelves.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  )
}

// Creates a linked product row on the chosen shelf for a newly-created catalogue item
async function addCatalogueItemToShelf(shelfId, item, kind) {
  if (!shelfId) return
  const payload = {
    name: item.name, reference: item.model || null, quantity: 1, min_quantity: 0,
    unit: 'pcs', description: [item.brand, kind === 'light' ? (item.watts && `${item.watts}W`) : item.type].filter(Boolean).join(' · '),
    tags: [kind === 'light' ? 'lumière' : 'son'], image_url: item.image_url || null,
    shelf_id: shelfId, section_id: null,
  }
  await supabase.from('products').insert(payload)
}

// ── Extract specs via Claude proxy ───────────────────────────
async function extractSpecs(file, kind) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Fichier trop volumineux (max 10 Mo)')
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload  = () => res(r.result.split(',')[1])
    r.onerror = () => rej(new Error('Lecture fichier échouée'))
    r.readAsDataURL(file)
  })
  const isPdf = file.type === 'application/pdf'
  const prompt = kind === 'light'
    ? `Extrais les infos techniques de ce projecteur/appareil d'éclairage.\nRéponds UNIQUEMENT en JSON valide sans backticks :\n{"name":"nom","brand":"marque","model":"ref","watts":nombre,"voltage":nombre,"power_factor":nombre,"dmx_channels":nombre_ou_null,"weight_kg":nombre_ou_null}`
    : `Extrais les infos techniques de cet équipement audio.\nRéponds UNIQUEMENT en JSON valide sans backticks :\n{"name":"nom","brand":"marque","model":"ref","type":"Ampli/Enceinte/Caisson/Console/Processeur/Micro/Câble/Autre","power_watts":nombre_ou_null,"impedance_ohms":nombre_ou_null,"channels":nombre_ou_null,"weight_kg":nombre_ou_null}`
  const body = {
    model: 'claude-sonnet-4-6', max_tokens: 800,
    messages: [{ role: 'user', content: [
      { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type: isPdf ? 'application/pdf' : file.type, data: base64 } },
      { type: 'text', text: prompt }
    ]}]
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Non connecté')
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/anthropic-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify(body)
  })
  if (!resp.ok) throw new Error(`Erreur API: ${resp.status}`)
  const data = await resp.json()
  const text = data.content?.find(b => b.type === 'text')?.text || ''
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

// ── Projecteur modal ──────────────────────────────────────────
function LightModal({ item, onClose, onSave }) {
  const [form, setForm]       = useState({ name:'', brand:'', model:'', watts:'', voltage:230, power_factor:1, dmx_channels:'', weight_kg:'', ...item })
  const [imgFile, setImgFile] = useState(null)
  const [imgPrev, setImgPrev] = useState(item?.image_url || null)
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [shelfId, setShelfId]   = useState('')
  const shelves = useShelves()
  const toast = useToast()

  function set(k, v) { setForm(f => ({...f, [k]: v})) }

  async function handleScan(e) {
    const f = e.target.files[0]; if (!f) return
    setScanning(true)
    try {
      const s = await extractSpecs(f, 'light')
      setForm(p => ({...p, name: s.name||p.name, brand: s.brand||p.brand, model: s.model||p.model, watts: s.watts??p.watts, voltage: s.voltage||230, power_factor: s.power_factor||1, dmx_channels: s.dmx_channels??'', weight_kg: s.weight_kg??''}))
      toast('Fiche lue !', 'success')
    } catch(err) { toast(err.message, 'error') }
    finally { setScanning(false) }
  }

  async function handleSave() {
    if (!form.name?.trim()) { toast('Nom requis', 'error'); return }
    if (!form.watts || +form.watts <= 0) { toast('Puissance (W) requise', 'error'); return }
    setLoading(true)
    try {
      let image_url = item?.image_url || null
      if (imgFile) image_url = await compressAndUpload(imgFile, 'projector-images', `proj_${Date.now()}`)
      const payload = {
        name: form.name.trim().slice(0,200), brand: (form.brand||'').slice(0,100)||null,
        model: (form.model||'').slice(0,100)||null, watts: Math.min(100000, +form.watts),
        voltage: Math.max(1, Math.min(1000, +form.voltage||230)),
        power_factor: Math.max(0, Math.min(1, +form.power_factor||1)),
        dmx_channels: form.dmx_channels ? Math.min(512, +form.dmx_channels) : null,
        weight_kg: form.weight_kg ? Math.min(9999, +form.weight_kg) : null, image_url
      }
      if (item?.id) {
        const { error } = await supabase.from('projectors').update(payload).eq('id', item.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('projectors').insert(payload)
        if (error) throw error
        if (shelfId) await addCatalogueItemToShelf(shelfId, payload, 'light')
      }
      toast(item?.id ? 'Projecteur mis à jour' : 'Projecteur ajouté', 'success')
      onSave(); onClose()
    } catch(err) { toast(err.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">💡 {item?.id ? 'Modifier' : 'Nouveau'} projecteur</h3>

        <div style={{marginBottom:16,padding:'12px',background:'rgba(79,70,229,0.08)',border:'1px solid rgba(79,70,229,0.2)',borderRadius:'var(--radius)'}}>
          <div style={{fontWeight:600,fontSize:13,marginBottom:8,color:'var(--indigo2)'}}>✨ Lecture auto de fiche technique</div>
          <label className="btn btn-secondary btn-sm" style={{cursor:'pointer',display:'inline-flex'}}>
            <input type="file" accept="image/*,application/pdf" style={{display:'none'}} onChange={handleScan}/>
            {scanning ? <><span className="spinner" style={{width:14,height:14}}/> Lecture...</> : '📄 PDF ou photo'}
          </label>
        </div>

        <div className="form-row">
          <div className="form-group"><label className="label">Nom *</label><input className="input" value={form.name||''} onChange={e=>set('name',e.target.value)} maxLength={200} placeholder="PAR LED 64"/></div>
          <div className="form-group"><label className="label">Marque</label><input className="input" value={form.brand||''} onChange={e=>set('brand',e.target.value)} maxLength={100} placeholder="Chauvet"/></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Modèle</label><input className="input" value={form.model||''} onChange={e=>set('model',e.target.value)} maxLength={100}/></div>
          <div className="form-group"><label className="label">Puissance (W) *</label><input className="input" type="number" min={1} value={form.watts||''} onChange={e=>set('watts',e.target.value)} placeholder="150"/></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Tension (V)</label><input className="input" type="number" value={form.voltage||230} onChange={e=>set('voltage',e.target.value)}/></div>
          <div className="form-group"><label className="label">Cos φ (0–1)</label><input className="input" type="number" step="0.01" min={0} max={1} value={form.power_factor||1} onChange={e=>set('power_factor',e.target.value)}/></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Canaux DMX</label><input className="input" type="number" value={form.dmx_channels||''} onChange={e=>set('dmx_channels',e.target.value)} placeholder="16"/></div>
          <div className="form-group"><label className="label">Poids (kg)</label><input className="input" type="number" step="0.1" value={form.weight_kg||''} onChange={e=>set('weight_kg',e.target.value)}/></div>
        </div>
        <div className="form-group">
          <label className="label">Photo</label>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <label className="upload-zone" style={{flex:1,minWidth:120}}>
              <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setImgFile(f);setImgPrev(URL.createObjectURL(f))}}}/>
              {imgPrev ? <img src={imgPrev} className="upload-preview" alt=""/> : <><div style={{fontSize:28}}>📸</div><div style={{fontSize:13,marginTop:6}}>Prendre une photo</div></>}
            </label>
            <label className="upload-zone" style={{flex:1,minWidth:120}}>
              <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setImgFile(f);setImgPrev(URL.createObjectURL(f))}}}/>
              <div style={{fontSize:28}}>🖼️</div><div style={{fontSize:13,marginTop:6}}>Depuis la galerie</div>
            </label>
          </div>
        </div>
        {!item?.id && <ShelfPickerField shelves={shelves} value={shelfId} onChange={setShelfId}/>}
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>{loading?<span className="spinner" style={{borderTopColor:'#fff'}}/>:'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Audio modal ───────────────────────────────────────────────
function AudioModal({ item, onClose, onSave }) {
  const [form, setForm]       = useState({ name:'', brand:'', model:'', type:'Enceinte', power_watts:'', impedance_ohms:'', channels:'', weight_kg:'', notes:'', ...item })
  const [imgFile, setImgFile] = useState(null)
  const [imgPrev, setImgPrev] = useState(item?.image_url || null)
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [shelfId, setShelfId]   = useState('')
  const shelves = useShelves()
  const toast = useToast()

  function set(k, v) { setForm(f => ({...f, [k]: v})) }

  async function handleScan(e) {
    const f = e.target.files[0]; if (!f) return
    setScanning(true)
    try {
      const s = await extractSpecs(f, 'audio')
      setForm(p => ({...p, name: s.name||p.name, brand: s.brand||p.brand, model: s.model||p.model, type: s.type||p.type, power_watts: s.power_watts??p.power_watts, impedance_ohms: s.impedance_ohms??p.impedance_ohms, channels: s.channels??p.channels, weight_kg: s.weight_kg??p.weight_kg}))
      toast('Fiche lue !', 'success')
    } catch(err) { toast(err.message, 'error') }
    finally { setScanning(false) }
  }

  async function handleSave() {
    if (!form.name?.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      let image_url = item?.image_url || null
      if (imgFile) image_url = await compressAndUpload(imgFile, 'audio-images', `audio_${Date.now()}`)
      const payload = {
        name: form.name.trim().slice(0,200), brand: (form.brand||'').slice(0,100)||null,
        model: (form.model||'').slice(0,100)||null, type: form.type||'Autre',
        power_watts: form.power_watts ? Math.min(100000, +form.power_watts) : null,
        impedance_ohms: form.impedance_ohms ? Math.min(9999, +form.impedance_ohms) : null,
        channels: form.channels ? Math.min(999, +form.channels) : null,
        weight_kg: form.weight_kg ? Math.min(9999, +form.weight_kg) : null,
        notes: (form.notes||'').slice(0,500)||null, image_url
      }
      if (item?.id) {
        const { error } = await supabase.from('audio_equipment').update(payload).eq('id', item.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('audio_equipment').insert(payload)
        if (error) throw error
        if (shelfId) await addCatalogueItemToShelf(shelfId, payload, 'audio')
      }
      toast(item?.id ? 'Équipement mis à jour' : 'Équipement ajouté', 'success')
      onSave(); onClose()
    } catch(err) { toast(err.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">🔊 {item?.id ? 'Modifier' : 'Nouveau'} équipement audio</h3>

        <div style={{marginBottom:16,padding:'12px',background:'rgba(79,70,229,0.08)',border:'1px solid rgba(79,70,229,0.2)',borderRadius:'var(--radius)'}}>
          <div style={{fontWeight:600,fontSize:13,marginBottom:8,color:'var(--indigo2)'}}>✨ Lecture auto de fiche technique</div>
          <label className="btn btn-secondary btn-sm" style={{cursor:'pointer',display:'inline-flex'}}>
            <input type="file" accept="image/*,application/pdf" style={{display:'none'}} onChange={handleScan}/>
            {scanning ? <><span className="spinner" style={{width:14,height:14}}/> Lecture...</> : '📄 PDF ou photo'}
          </label>
        </div>

        <div className="form-row">
          <div className="form-group"><label className="label">Nom *</label><input className="input" value={form.name||''} onChange={e=>set('name',e.target.value)} maxLength={200}/></div>
          <div className="form-group">
            <label className="label">Type</label>
            <select className="input" value={form.type||'Autre'} onChange={e=>set('type',e.target.value)}>
              {AUDIO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Marque</label><input className="input" value={form.brand||''} onChange={e=>set('brand',e.target.value)} maxLength={100}/></div>
          <div className="form-group"><label className="label">Modèle</label><input className="input" value={form.model||''} onChange={e=>set('model',e.target.value)} maxLength={100}/></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Puissance (W)</label><input className="input" type="number" value={form.power_watts||''} onChange={e=>set('power_watts',e.target.value)}/></div>
          <div className="form-group"><label className="label">Impédance (Ω)</label><input className="input" type="number" value={form.impedance_ohms||''} onChange={e=>set('impedance_ohms',e.target.value)}/></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Canaux</label><input className="input" type="number" value={form.channels||''} onChange={e=>set('channels',e.target.value)}/></div>
          <div className="form-group"><label className="label">Poids (kg)</label><input className="input" type="number" step="0.1" value={form.weight_kg||''} onChange={e=>set('weight_kg',e.target.value)}/></div>
        </div>
        <div className="form-group">
          <label className="label">Photo</label>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <label className="upload-zone" style={{flex:1,minWidth:120}}>
              <input type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setImgFile(f);setImgPrev(URL.createObjectURL(f))}}}/>
              {imgPrev ? <img src={imgPrev} className="upload-preview" alt=""/> : <><div style={{fontSize:28}}>📸</div><div style={{fontSize:13,marginTop:6}}>Prendre une photo</div></>}
            </label>
            <label className="upload-zone" style={{flex:1,minWidth:120}}>
              <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setImgFile(f);setImgPrev(URL.createObjectURL(f))}}}/>
              <div style={{fontSize:28}}>🖼️</div><div style={{fontSize:13,marginTop:6}}>Depuis la galerie</div>
            </label>
          </div>
        </div>
        {!item?.id && <ShelfPickerField shelves={shelves} value={shelfId} onChange={setShelfId}/>}
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>{loading?<span className="spinner" style={{borderTopColor:'#fff'}}/>:'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Calculateur unifié ────────────────────────────────────────
function UnifiedCalc({ lights, audios }) {
  const [items, setItems]       = useState([]) // {key, id, name, watts, qty, kind}
  const [circuitA, setCircuitA] = useState(16)
  const [circuitV, setCircuitV] = useState(230)
  const [calcName, setCalcName] = useState('')
  const [saving, setSaving]     = useState(false)
  const { user } = useAuth()
  const toast = useToast()

  function addItem(eq, kind) {
    setItems(prev => {
      const key = `${kind}_${eq.id}`
      const existing = prev.find(i => i.key === key)
      if (existing) return prev.map(i => i.key === key ? {...i, qty: Math.min(999, i.qty+1)} : i)
      if (prev.length >= 50) { toast('Maximum 50 types par calcul', 'error'); return prev }
      const watts = kind === 'light' ? (eq.watts || 0) : (eq.power_watts || 0)
      return [...prev, { key, id: eq.id, name: eq.name, watts, qty: 1, kind }]
    })
  }

  function updateQty(key, qty) {
    if (+qty <= 0) { setItems(prev => prev.filter(i => i.key !== key)); return }
    setItems(prev => prev.map(i => i.key === key ? {...i, qty: Math.min(999, +qty)} : i))
  }

  const safeV    = Math.max(1, circuitV)
  const safeA    = Math.max(1, circuitA)
  const totalW   = items.reduce((s, i) => s + i.watts * i.qty, 0)
  const totalA   = totalW / safeV
  const maxW     = safeA * safeV
  const pct      = Math.min((totalA / safeA) * 100, 100)
  const isDanger = totalA > safeA
  const isWarn   = totalA > safeA * 0.8 && !isDanger
  const fillClass = isDanger ? 'power-danger' : isWarn ? 'power-warn' : 'power-safe'
  const status   = isDanger ? '🔴 SURCHARGE' : isWarn ? '🟡 Proche limite' : '🟢 OK'

  async function handleSave() {
    if (!calcName.trim()) { toast('Nom du calcul requis', 'error'); return }
    if (items.length === 0) { toast('Aucun équipement ajouté', 'error'); return }
    setSaving(true)
    try {
      await supabase.from('power_calculations').insert({
        name: calcName.trim().slice(0,100),
        circuit_amperage: safeA, circuit_voltage: safeV,
        items: items.map(i => ({ item_id: i.id, item_name: i.name, item_type: i.kind, watts: i.watts, qty: i.qty })),
        total_watts: totalW, total_amperage: totalA, is_safe: !isDanger, created_by: user.id
      })
      toast('Calcul sauvegardé', 'success'); setCalcName('')
    } catch(err) { toast(err.message, 'error') }
    finally { setSaving(false) }
  }

  return (
    <div>
      {/* Circuit */}
      <div className="card" style={{marginBottom:16}}>
        <div className="section-title" style={{marginBottom:12}}>⚡ Circuit électrique</div>
        <div className="form-row">
          <div className="form-group"><label className="label">Disjoncteur (A)</label><input className="input" type="number" min={1} value={circuitA} onChange={e=>setCircuitA(+e.target.value)}/></div>
          <div className="form-group"><label className="label">Tension (V)</label><input className="input" type="number" value={circuitV} onChange={e=>setCircuitV(+e.target.value)}/></div>
        </div>
        <div style={{fontSize:13,color:'var(--text2)'}}>Capacité max : <strong>{maxW} W / {safeA} A</strong></div>
      </div>

      {/* Résultat */}
      {items.length > 0 && (
        <div className="card" style={{marginBottom:16,border:`1px solid ${isDanger?'var(--red)':isWarn?'var(--amber)':'var(--border)'}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{fontWeight:700,fontSize:16}}>{status}</span>
            <span className="mono" style={{fontSize:13,color:'var(--text2)'}}>{totalW}W / {totalA.toFixed(1)}A</span>
          </div>
          <div className="power-bar"><div className={`power-fill ${fillClass}`} style={{width:`${pct}%`}}/></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text3)',marginTop:4}}>
            <span>0W</span><span>{Math.round(maxW*0.8)}W (80%)</span><span>{maxW}W</span>
          </div>
          {isDanger && <div style={{marginTop:10,padding:'8px 12px',background:'rgba(239,68,68,0.1)',borderRadius:'var(--radius)',fontSize:13,color:'var(--red)'}}>⚠️ Dépasse la capacité de {(totalA-safeA).toFixed(1)}A — risque de disjonction</div>}
        </div>
      )}

      {/* Sélection */}
      {items.length > 0 && (
        <div style={{marginBottom:16}}>
          <div className="section-header">
            <span className="section-title">Sélection ({items.length})</span>
            <button className="btn btn-ghost btn-sm" style={{color:'var(--text3)',fontSize:12}} onClick={() => setItems([])}>Tout vider</button>
          </div>
          {items.map(i => (
            <div key={i.key} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,padding:'10px 14px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
              <span style={{fontSize:18,flexShrink:0}}>{i.kind==='light'?'💡':'🔊'}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{i.name}</div>
                <div style={{fontSize:12,color:'var(--text3)'}}>{i.watts}W × {i.qty} = <strong>{i.watts*i.qty}W</strong></div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => updateQty(i.key, i.qty-1)} style={{fontSize:16,fontWeight:700,padding:'2px 8px'}}>−</button>
                <span style={{minWidth:24,textAlign:'center',fontWeight:700,fontSize:14}}>{i.qty}</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => updateQty(i.key, i.qty+1)} style={{fontSize:16,fontWeight:700,padding:'2px 8px'}}>+</button>
              </div>
            </div>
          ))}
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <input className="input" placeholder="Nom du calcul (ex: Scène Gala)" value={calcName} onChange={e=>setCalcName(e.target.value)} maxLength={100} style={{flex:1}}/>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <span className="spinner" style={{borderTopColor:'#fff'}}/> : '💾 Sauver'}
            </button>
          </div>
        </div>
      )}

      {/* Picker équipements */}
      {lights.length === 0 && audios.length === 0 ? (
        <div className="empty"><div className="empty-icon">🎛️</div><p>Aucun équipement dans le catalogue</p><p style={{fontSize:13}}>Ajoute des appareils dans l'onglet Catalogue</p></div>
      ) : (
        <>
          {lights.length > 0 && (
            <>
              <div className="section-header" style={{marginBottom:10}}><span className="section-title">💡 Lumière</span><span style={{fontSize:13,color:'var(--text3)'}}>{lights.length} appareil(s)</span></div>
              <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:20}}>
                {lights.map(p => (
                  <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                    {p.image_url
                      ? <img src={p.image_url} style={{width:40,height:40,borderRadius:8,objectFit:'cover',flexShrink:0}} alt=""/>
                      : <div style={{width:40,height:40,borderRadius:8,background:'var(--bg2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>💡</div>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                      <div style={{fontSize:12,color:'var(--text3)'}}>{p.watts}W{p.dmx_channels ? ` · ${p.dmx_channels}ch DMX` : ''}</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => addItem(p, 'light')}>+</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {audios.length > 0 && (
            <>
              <div className="section-header" style={{marginBottom:10}}><span className="section-title">🔊 Son</span><span style={{fontSize:13,color:'var(--text3)'}}>{audios.length} appareil(s)</span></div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {audios.map(a => (
                  <div key={a.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                    {a.image_url
                      ? <img src={a.image_url} style={{width:40,height:40,borderRadius:8,objectFit:'cover',flexShrink:0}} alt=""/>
                      : <div style={{width:40,height:40,borderRadius:8,background:'var(--bg2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>🔊</div>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name}</div>
                      <div style={{fontSize:12,color:'var(--text3)'}}>{a.type}{a.power_watts ? ` · ${a.power_watts}W` : ''}</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => addItem(a, 'audio')}>+</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Catalogue ────────────────────────────────────────────────
function CatalogueView({ lights, audios, filter, search, sortBy, isEditor, onEdit, onDelete }) {
  const q = (search || '').toLowerCase()
  let items = [
    ...(filter !== 'audio' ? lights.map(i => ({...i, _kind:'light'})) : []),
    ...(filter !== 'light' ? audios.map(i => ({...i, _kind:'audio'})) : []),
  ]
  if (q) items = items.filter(i =>
    i.name?.toLowerCase().includes(q) ||
    i.brand?.toLowerCase().includes(q) ||
    i.model?.toLowerCase().includes(q) ||
    i.type?.toLowerCase().includes(q)
  )
  if (sortBy === 'watts') {
    items = items.sort((a, b) => {
      const wa = a._kind === 'light' ? (a.watts||0) : (a.power_watts||0)
      const wb = b._kind === 'light' ? (b.watts||0) : (b.power_watts||0)
      return wb - wa
    })
  }

  const totalW = items.reduce((s,i) => s + (i._kind==='light' ? (i.watts||0) : (i.power_watts||0)), 0)

  if (items.length === 0) return (
    <div className="empty">
      <div className="empty-icon">{filter==='light'?'💡':filter==='audio'?'🔊':'🎛️'}</div>
      <p>Aucun équipement dans ce catalogue</p>
    </div>
  )

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,fontSize:13,color:'var(--text3)'}}>
        <span>{items.length} appareil{items.length!==1?'s':''}</span>
        {totalW > 0 && <span>⚡ {totalW} W total</span>}
      </div>
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {items.map(item => {
        const k = item._kind
        return (
          <div key={`${k}_${item.id}`} className="card" style={{display:'flex',gap:12,alignItems:'center'}}>
            {item.image_url
              ? <img src={item.image_url} style={{width:56,height:56,borderRadius:8,objectFit:'cover',flexShrink:0}} alt=""/>
              : <div style={{width:56,height:56,borderRadius:8,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,flexShrink:0}}>{k==='light'?'💡':'🔊'}</div>
            }
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2,flexWrap:'wrap'}}>
                <span style={{fontWeight:700,fontSize:15}}>{item.name}</span>
                <span style={{fontSize:10,padding:'2px 7px',borderRadius:20,background:'var(--bg3)',color:'var(--text3)',fontWeight:600,border:'1px solid var(--border)'}}>{k==='light'?'💡 Lumière':'🔊 Son'}</span>
              </div>
              {(item.brand||item.model) && <div style={{fontSize:13,color:'var(--text2)',marginBottom:4}}>{[item.brand,item.model].filter(Boolean).join(' · ')}</div>}
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {k === 'light' ? (
                  <>
                    <span className="chip">⚡ {item.watts}W</span>
                    {item.dmx_channels && <span className="chip">DMX {item.dmx_channels}ch</span>}
                    {item.weight_kg && <span className="chip">⚖️ {item.weight_kg}kg</span>}
                  </>
                ) : (
                  <>
                    {item.type && <span className="chip">{item.type}</span>}
                    {item.power_watts && <span className="chip">⚡ {item.power_watts}W</span>}
                    {item.impedance_ohms && <span className="chip">{item.impedance_ohms}Ω</span>}
                    {item.channels && <span className="chip">{item.channels}ch</span>}
                    {item.weight_kg && <span className="chip">⚖️ {item.weight_kg}kg</span>}
                  </>
                )}
              </div>
            </div>
            {isEditor && (
              <div style={{display:'flex',flexDirection:'column',gap:6,flexShrink:0}}>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onEdit(item, k)}>✏️</button>
                <button className="btn btn-ghost btn-icon btn-sm" style={{color:'var(--red)'}} onClick={() => onDelete(item.id, k)}>🗑️</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
    </div>
  )
}

// ── Historique ────────────────────────────────────────────────
function CalcHistory() {
  const [history, setHistory] = useState([])
  const toast = useToast()

  useEffect(() => {
    supabase.from('power_calculations').select('*').order('created_at',{ascending:false}).limit(30)
      .then(({ data }) => setHistory(data || []))
  }, [])

  const confirm = useConfirm()
  async function handleDelete(id) {
    if (!await confirm('Supprimer ce calcul ?', { confirmLabel: 'Supprimer' })) return
    const { error } = await supabase.from('power_calculations').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setHistory(h => h.filter(c => c.id !== id))
    toast('Supprimé', 'success')
  }

  if (history.length === 0) return <div className="empty"><div className="empty-icon">📋</div><p>Aucun calcul sauvegardé</p></div>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {history.map(c => {
        const hasLight = c.items?.some(i => i.item_type==='light' || i.projector_id)
        const hasAudio = c.items?.some(i => i.item_type==='audio')
        return (
          <div key={c.id} className="card" style={{border:`1px solid ${c.is_safe?'var(--border)':'rgba(239,68,68,0.3)'}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontWeight:700}}>{c.name}</div>
                <div style={{fontSize:13,color:'var(--text2)',marginTop:4}}>
                  {c.total_watts}W · {c.total_amperage?.toFixed(1)}A / {c.circuit_amperage}A @ {c.circuit_voltage}V
                </div>
                <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
                  {hasLight && '💡 '}{hasAudio && '🔊 '}{c.items?.length} type(s) · {new Date(c.created_at).toLocaleDateString('fr')}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:18}}>{c.is_safe?'🟢':'🔴'}</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDelete(c.id)} style={{color:'var(--red)'}}>🗑️</button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Page principale ───────────────────────────────────────────
export default function MaterielPage() {
  const { isEditor }    = useAuth()
  const toast           = useToast()
  const [tab, setTab]   = useState('calc')
  const [filter, setFilter] = useState('all')
  const confirm = useConfirm()
  const [lights, setLights]     = useState([])
  const [audios, setAudios]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [editItem, setEditItem] = useState(null)
  const [showAdd, setShowAdd]   = useState(null)
  const [catSearch, setCatSearch] = useState('')
  const [catSort, setCatSort]     = useState('name') // 'name' | 'watts'

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: l, error: le }, { data: a, error: ae }] = await Promise.all([
      supabase.from('projectors').select('*').order('name'),
      supabase.from('audio_equipment').select('*').order('name')
    ])
    if (!le) setLights(l || []); else console.warn('projectors load error:', le.message)
    if (!ae) setAudios(a || []); else console.warn('audio_equipment load error:', ae.message)
    setLoading(false)
  }

  async function handleDelete(id, kind) {
    const table = kind === 'light' ? 'projectors' : 'audio_equipment'
    if (!await confirm('Supprimer cet équipement ?')) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    toast('Supprimé', 'success'); loadAll()
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h1>🎛️ Matériel</h1>
          {isEditor && tab === 'catalogue' && (
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd('light')}>+ 💡</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd('audio')}>+ 🔊</button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:6,marginTop:12,flexWrap:'wrap'}}>
          {[['calc','🔢 Calculer'],['catalogue','📦 Catalogue'],['historique','📋 Historique']].map(([id,label]) => (
            <button key={id} className={`btn btn-sm ${tab===id?'btn-primary':'btn-secondary'}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {/* Catalogue controls */}
        {tab === 'catalogue' && (
          <>
            <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap',alignItems:'center'}}>
              {[['all','Tout'],['light','💡 Lumière'],['audio','🔊 Son']].map(([v,l]) => (
                  <button key={v} className={`btn btn-sm ${filter===v?'btn-primary':'btn-secondary'}`} onClick={() => setFilter(v)}>{l}</button>
                ))}
              </div>
            <div style={{display:'flex',gap:8,alignItems:'center',marginTop:8,flexWrap:'wrap'}}>
              <input className="input" placeholder="Rechercher..." value={catSearch} onChange={e=>setCatSearch(e.target.value)} style={{flex:1,minWidth:140}}/>
              <select className="input" value={catSort} onChange={e=>setCatSort(e.target.value)} style={{width:'auto',padding:'8px 10px'}}>
                <option value="name">A–Z</option>
                <option value="watts">Puissance ↓</option>
              </select>
            </div>
          </>
        )}
      </div>

      <div className="page-content">
        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:60}}><span className="spinner" style={{width:32,height:32}}/></div>
        ) : (
          <>
            {tab === 'calc'       && <UnifiedCalc lights={lights} audios={audios}/>}
            {tab === 'catalogue'  && (
              <CatalogueView
                lights={lights} audios={audios}
                filter={filter} search={catSearch} sortBy={catSort}
                isEditor={isEditor}
                onEdit={(item, kind) => setEditItem({...item, _kind: kind})}
                onDelete={handleDelete}
              />
            )}
            {tab === 'historique' && <CalcHistory/>}
          </>
        )}
      </div>

      {(showAdd === 'light' || editItem?._kind === 'light') && (
        <LightModal
          item={editItem?._kind === 'light' ? editItem : null}
          onClose={() => { setShowAdd(null); setEditItem(null) }}
          onSave={loadAll}
        />
      )}
      {(showAdd === 'audio' || editItem?._kind === 'audio') && (
        <AudioModal
          item={editItem?._kind === 'audio' ? editItem : null}
          onClose={() => { setShowAdd(null); setEditItem(null) }}
          onSave={loadAll}
        />
      )}
    </div>
  )
}
