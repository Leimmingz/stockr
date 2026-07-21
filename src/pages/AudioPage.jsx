import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { compressAndUpload } from '../lib/imageUtils'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../hooks/useConfirm'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const AUDIO_TYPES = ['Ampli', 'Enceinte', 'Caisson', 'Console / Mixeur', 'Processeur', 'Micro', 'Câble', 'Autre']

// ── Lecture fiche technique via Claude ───────────────────────
async function extractAudioSpecs(file) {
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = () => rej(new Error('Lecture fichier échouée'))
    r.readAsDataURL(file)
  })
  const isPdf = file.type === 'application/pdf'
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        {
          type: isPdf ? 'document' : 'image',
          source: { type: 'base64', media_type: isPdf ? 'application/pdf' : file.type, data: base64 }
        },
        {
          type: 'text',
          text: `Extrais les informations techniques de cet équipement audio depuis cette fiche technique.
Réponds UNIQUEMENT en JSON valide, sans backticks, sans texte autour :
{
  "name": "nom du modèle",
  "brand": "marque",
  "model": "référence modèle",
  "type": "Ampli|Enceinte|Caisson|Console / Mixeur|Processeur|Micro|Câble|Autre",
  "power_watts": nombre ou null (puissance en W),
  "impedance_ohms": nombre ou null (impédance en Ω, pour enceintes/amplis),
  "channels": nombre ou null (canaux),
  "weight_kg": nombre ou null,
  "notes": "infos pertinentes en une phrase ou null"
}
Si une valeur est inconnue, mets null.`
        }
      ]
    }]
  }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Non connecté')
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/anthropic-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`Erreur API: ${resp.status}`)
  const data = await resp.json()
  const text = data.content?.find(b => b.type === 'text')?.text || ''
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

// ── Formulaire équipement ────────────────────────────────────
function AudioModal({ equipment, onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', brand: '', model: '', type: 'Autre',
    power_watts: '', impedance_ohms: '', channels: '', weight_kg: '', notes: '',
    ...equipment
  })
  const [imgFile, setImgFile] = useState(null)
  const [imgPrev, setImgPrev] = useState(equipment?.image_url || null)
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading]   = useState(false)
  const toast = useToast()
  const { isEditor } = useAuth()

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleScan(e) {
    const f = e.target.files[0]
    if (!f) return
    if (f.size > 10 * 1024 * 1024) { toast('Fichier trop volumineux (max 10 Mo)', 'error'); return }
    setScanning(true)
    try {
      const specs = await extractAudioSpecs(f)
      setForm(prev => ({
        ...prev,
        name:            specs.name           || prev.name,
        brand:           specs.brand          || prev.brand,
        model:           specs.model          || prev.model,
        type:            AUDIO_TYPES.includes(specs.type) ? specs.type : prev.type,
        power_watts:     specs.power_watts    ?? prev.power_watts,
        impedance_ohms:  specs.impedance_ohms ?? prev.impedance_ohms,
        channels:        specs.channels       ?? prev.channels,
        weight_kg:       specs.weight_kg      ?? prev.weight_kg,
        notes:           specs.notes          || prev.notes,
      }))
      toast('Fiche lue avec succès !', 'success')
    } catch(err) {
      toast(err.message, 'error')
    } finally {
      setScanning(false)
    }
  }

  async function handleSave() {
    if (!form.name?.trim()) { toast('Nom requis', 'error'); return }
    setLoading(true)
    try {
      let imageUrl = equipment?.image_url || null
      if (imgFile) imageUrl = await compressAndUpload(imgFile, 'depot-images', `audio_${form.name.replace(/\s/g,'_')}`)
      const payload = {
        name:           form.name.trim().slice(0, 200),
        brand:          (form.brand  || '').slice(0, 100) || null,
        model:          (form.model  || '').slice(0, 100) || null,
        type:           AUDIO_TYPES.includes(form.type) ? form.type : 'Autre',
        power_watts:    form.power_watts    ? Math.min(100000, +form.power_watts)   : null,
        impedance_ohms: form.impedance_ohms ? Math.min(10000,  +form.impedance_ohms): null,
        channels:       form.channels       ? Math.min(1024,   +form.channels)      : null,
        weight_kg:      form.weight_kg      ? Math.min(9999,   +form.weight_kg)     : null,
        notes:          (form.notes || '').slice(0, 500) || null,
        image_url:      imageUrl,
      }
      if (equipment?.id) {
        const { error } = await supabase.from('audio_equipment').update(payload).eq('id', equipment.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('audio_equipment').insert(payload)
        if (error) throw error
      }
      toast(equipment?.id ? 'Équipement mis à jour' : 'Équipement ajouté', 'success')
      onSave(); onClose()
    } catch(err) { toast(err.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3 className="modal-title">{equipment?.id ? 'Modifier' : 'Nouvel'} équipement audio</h3>

        {/* Scan fiche */}
        <div style={{marginBottom:20,padding:'14px',background:'rgba(124,58,237,0.06)',border:'1px solid rgba(124,58,237,0.2)',borderRadius:'var(--radius)'}}>
          <div style={{fontWeight:600,fontSize:13,marginBottom:8,color:'var(--indigo2)'}}>✨ Lecture automatique de fiche</div>
          <label className="btn btn-secondary btn-sm" style={{cursor:'pointer',display:'inline-flex'}}>
            <input type="file" accept="image/*,application/pdf" style={{display:'none'}} onChange={handleScan}/>
            {scanning ? <><span className="spinner" style={{width:14,height:14}}/> Lecture...</> : '📄 Charger PDF ou photo'}
          </label>
          <span style={{color:'var(--text3)',fontSize:12,marginLeft:10}}>Remplit les champs auto</span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="label">Nom *</label>
            <input className="input" value={form.name||''} onChange={e => set('name',e.target.value)} placeholder="QSC K12.2" maxLength={200}/>
          </div>
          <div className="form-group">
            <label className="label">Type</label>
            <select className="input" value={form.type||'Autre'} onChange={e => set('type',e.target.value)}>
              {AUDIO_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="label">Marque</label>
            <input className="input" value={form.brand||''} onChange={e => set('brand',e.target.value)} placeholder="QSC" maxLength={100}/>
          </div>
          <div className="form-group">
            <label className="label">Modèle</label>
            <input className="input" value={form.model||''} onChange={e => set('model',e.target.value)} placeholder="K12.2" maxLength={100}/>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="label">Puissance (W)</label>
            <input className="input" type="number" min={0} value={form.power_watts||''} onChange={e => set('power_watts',e.target.value)} placeholder="2000"/>
          </div>
          <div className="form-group">
            <label className="label">Impédance (Ω)</label>
            <input className="input" type="number" min={0} step="0.1" value={form.impedance_ohms||''} onChange={e => set('impedance_ohms',e.target.value)} placeholder="8"/>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="label">Canaux</label>
            <input className="input" type="number" min={0} value={form.channels||''} onChange={e => set('channels',e.target.value)} placeholder="2"/>
          </div>
          <div className="form-group">
            <label className="label">Poids (kg)</label>
            <input className="input" type="number" min={0} step="0.1" value={form.weight_kg||''} onChange={e => set('weight_kg',e.target.value)} placeholder="16"/>
          </div>
        </div>
        <div className="form-group">
          <label className="label">Notes</label>
          <textarea className="input" value={form.notes||''} onChange={e => set('notes',e.target.value)} placeholder="Connecteurs, caractéristiques..." maxLength={500}/>
        </div>
        <div className="form-group">
          <label className="label">Photo</label>
          <label className="upload-zone">
            <input type="file" accept="image/*" style={{display:'none'}} onChange={e => {
              const f = e.target.files[0]
              if (f) { setImgFile(f); setImgPrev(prev => { if(prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f) }) }
            }}/>
            {imgPrev ? <img src={imgPrev} className="upload-preview" alt="preview"/> : <><div style={{fontSize:28}}>🔊</div><div style={{fontSize:13,marginTop:6}}>Photo de l'équipement</div></>}
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

// ── Calculateur de setup audio ───────────────────────────────
function AudioCalculator({ equipment }) {
  const [items, setItems]       = useState([])
  const [setupName, setSetupName] = useState('')
  const [circuitA, setCircuitA] = useState(16)
  const [circuitV, setCircuitV] = useState(230)
  const [saving, setSaving]     = useState(false)
  const { user } = useAuth()
  const toast = useToast()

  function addItem(eq) {
    setItems(prev => {
      const existing = prev.find(i => i.equipment.id === eq.id)
      if (existing) return prev.map(i => i.equipment.id === eq.id ? { ...i, qty: Math.min(999, i.qty + 1) } : i)
      if (prev.length >= 50) { toast('Maximum 50 types par setup', 'error'); return prev }
      return [...prev, { equipment: eq, qty: 1 }]
    })
  }

  function updateQty(id, qty) {
    if (+qty <= 0) { setItems(prev => prev.filter(i => i.equipment.id !== id)); return }
    setItems(prev => prev.map(i => i.equipment.id === id ? { ...i, qty: Math.min(999, +qty) } : i))
  }

  const safeV   = Math.max(1, circuitV)
  const safeA   = Math.max(1, circuitA)
  const totalW  = items.reduce((sum, i) => sum + ((i.equipment.power_watts || 0) * i.qty), 0)
  const totalA  = totalW / safeV
  const maxW    = safeA * safeV
  const pct     = Math.min((totalA / safeA) * 100, 100)
  const isSafe  = totalA <= safeA * 0.8
  const isWarn  = totalA > safeA * 0.8 && totalA <= safeA
  const isDanger = totalA > safeA
  const fillClass = isDanger ? 'power-danger' : isWarn ? 'power-warn' : 'power-safe'
  const status    = isDanger ? '🔴 SURCHARGE' : isWarn ? '🟡 Proche limite' : '🟢 OK'

  // Power-only items (cables, mics with 0W are excluded from total but shown)
  const poweredItems = items.filter(i => (i.equipment.power_watts || 0) > 0)

  async function handleSave() {
    if (!setupName.trim()) { toast('Nom du setup requis', 'error'); return }
    if (items.length === 0) { toast('Aucun équipement ajouté', 'error'); return }
    setSaving(true)
    try {
      await supabase.from('audio_setups').insert({
        name: setupName.trim().slice(0, 100),
        items: items.map(i => ({ id: i.equipment.id, name: i.equipment.name, type: i.equipment.type, power_watts: i.equipment.power_watts, qty: i.qty })),
        total_watts: totalW,
        created_by: user.id,
      })
      toast('Setup sauvegardé', 'success')
      setSetupName('')
    } catch(err) { toast(err.message, 'error') }
    finally { setSaving(false) }
  }

  const typeIcon = { 'Ampli':'🔋','Enceinte':'🔊','Caisson':'💥','Console / Mixeur':'🎚️','Processeur':'⚙️','Micro':'🎤','Câble':'🔌','Autre':'📦' }

  // Group equipment by type for picker
  const byType = AUDIO_TYPES.reduce((acc, t) => {
    const list = equipment.filter(e => e.type === t)
    if (list.length) acc[t] = list
    return acc
  }, {})

  return (
    <div>
      {/* Circuit */}
      <div className="card" style={{marginBottom:16}}>
        <div className="section-title" style={{marginBottom:12}}>🔌 Circuit électrique</div>
        <div className="form-row">
          <div className="form-group"><label className="label">Disjoncteur (A)</label><input className="input" type="number" value={circuitA} onChange={e => setCircuitA(+e.target.value)} min={1}/></div>
          <div className="form-group"><label className="label">Tension (V)</label><input className="input" type="number" value={circuitV} onChange={e => setCircuitV(+e.target.value)}/></div>
        </div>
        <div style={{fontSize:13,color:'var(--text2)'}}>Capacité max : <strong>{maxW} W / {safeA} A</strong></div>
      </div>

      {/* Résultat */}
      {items.length > 0 && poweredItems.length > 0 && (
        <div className="card" style={{marginBottom:16,border:`1px solid ${isDanger?'var(--red)':isWarn?'var(--amber)':'var(--border)'}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{fontWeight:700,fontSize:16}}>{status}</span>
            <span className="mono" style={{fontSize:13,color:'var(--text2)'}}>{totalW}W / {totalA.toFixed(1)}A</span>
          </div>
          <div className="power-bar"><div className={`power-fill ${fillClass}`} style={{width:`${pct}%`}}/></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text3)',marginTop:4}}>
            <span>0 W</span><span>{Math.round(maxW*0.8)} W (80%)</span><span>{maxW} W</span>
          </div>
          {isDanger && <div style={{marginTop:10,padding:'8px 12px',background:'rgba(220,38,38,0.1)',borderRadius:'var(--radius)',fontSize:13,color:'var(--red)'}}>⚠️ Dépasse la capacité de {(totalA - safeA).toFixed(1)}A — risque de disjonction</div>}
        </div>
      )}

      {/* Items sélectionnés */}
      {items.length > 0 && (
        <div style={{marginBottom:16}}>
          <div className="section-header"><span className="section-title">Setup ({items.length} type{items.length>1?'s':''})</span>
            <button className="btn btn-ghost btn-sm" style={{color:'var(--red)',fontSize:12}} onClick={() => setItems([])}>Tout vider</button>
          </div>
          {items.map(i => (
            <div key={i.equipment.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,padding:'10px 14px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
              <span style={{fontSize:18,flexShrink:0}}>{typeIcon[i.equipment.type]||'📦'}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{i.equipment.name}</div>
                <div style={{fontSize:12,color:'var(--text3)'}}>
                  {i.equipment.power_watts ? `${i.equipment.power_watts}W × ${i.qty} = ${i.equipment.power_watts * i.qty}W` : `${i.qty} × (pas de conso. renseignée)`}
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => updateQty(i.equipment.id, i.qty-1)} style={{fontSize:18,fontWeight:700}}>−</button>
                <span style={{minWidth:24,textAlign:'center',fontWeight:700}}>{i.qty}</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => updateQty(i.equipment.id, i.qty+1)} style={{fontSize:18,fontWeight:700}}>+</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sauvegarde */}
      {items.length > 0 && (
        <div style={{display:'flex',gap:8,marginBottom:20}}>
          <input className="input" placeholder="Nom du setup (ex: Scène principale)" value={setupName} onChange={e => setSetupName(e.target.value)} maxLength={100} style={{flex:1}}/>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" style={{borderTopColor:'#fff'}}/> : '💾'}
          </button>
        </div>
      )}

      {/* Catalogue picker */}
      <div className="section-header" style={{marginTop:8}}><span className="section-title">Ajouter un équipement</span></div>
      {Object.keys(byType).length === 0 ? (
        <div className="empty"><div className="empty-icon">🔊</div><p>Aucun équipement dans le catalogue</p></div>
      ) : (
        Object.entries(byType).map(([type, list]) => (
          <div key={type} style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:8}}>
              {typeIcon[type]||'📦'} {type}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {list.map(eq => (
                <div key={eq.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                  {eq.image_url
                    ? <img src={eq.image_url} style={{width:40,height:40,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={eq.name}/>
                    : <div style={{width:40,height:40,borderRadius:8,background:'var(--bg2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{typeIcon[eq.type]||'📦'}</div>
                  }
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:600,fontSize:14,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{eq.name}</div>
                    <div style={{fontSize:12,color:'var(--text3)'}}>
                      {eq.brand && `${eq.brand} · `}
                      {eq.power_watts ? `${eq.power_watts}W` : 'Conso. non renseignée'}
                      {eq.impedance_ohms ? ` · ${eq.impedance_ohms}Ω` : ''}
                      {eq.channels ? ` · ${eq.channels}ch` : ''}
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => addItem(eq)}>+</button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ── Historique des setups ────────────────────────────────────
function AudioHistory() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    supabase.from('audio_setups').select('*').order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => { setHistory(data || []); setLoading(false) })
  }, [])

  async function handleDelete(id) {
    if (!await confirm('Supprimer ce setup ?', { confirmLabel: 'Supprimer' })) return
    const { error } = await supabase.from('audio_setups').delete().eq('id', id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    setHistory(h => h.filter(s => s.id !== id))
    toast('Setup supprimé', 'success')
  }

  if (loading) return <div style={{display:'flex',justifyContent:'center',padding:60}}><span className="spinner" style={{width:32,height:32}}/></div>
  if (history.length === 0) return <div className="empty"><div className="empty-icon">📋</div><p>Aucun setup sauvegardé</p></div>

  const typeIcon = { 'Ampli':'🔋','Enceinte':'🔊','Caisson':'💥','Console / Mixeur':'🎚️','Processeur':'⚙️','Micro':'🎤','Câble':'🔌','Autre':'📦' }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {history.map(s => (
        <div key={s.id} className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:15}}>{s.name}</div>
              <div style={{fontSize:13,color:'var(--text2)',marginTop:4}}>
                {s.total_watts > 0 ? `${s.total_watts}W total · ` : ''}{(s.items||[]).length} équipement{(s.items||[]).length>1?'s':''}
              </div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{new Date(s.created_at).toLocaleDateString('fr')}</div>
              {s.items && s.items.length > 0 && (
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:8}}>
                  {s.items.map((it, i) => (
                    <span key={i} style={{fontSize:11,background:'var(--bg3)',borderRadius:20,padding:'2px 8px',border:'1px solid var(--border)',color:'var(--text2)'}}>
                      {typeIcon[it.type]||'📦'} {it.name} ×{it.qty}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDelete(s.id)} style={{color:'var(--red)',flexShrink:0}}>🗑️</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Page principale Audio ────────────────────────────────────
export default function AudioPage() {
  const { isEditor } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [tab, setTab]         = useState('calc')
  const [equipment, setEquipment] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [editEq, setEditEq]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')

  useEffect(() => { loadEquipment() }, [])

  async function loadEquipment() {
    setLoading(true)
    const { data } = await supabase.from('audio_equipment').select('*').order('type').order('name')
    setEquipment(data || [])
    setLoading(false)
  }

  async function handleDelete(id) {
    if (!await confirm('Supprimer cet équipement ?', { confirmLabel: 'Supprimer' })) return
    const { error } = await supabase.from('audio_equipment').delete().eq('id', id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    toast('Équipement supprimé', 'success')
    loadEquipment()
  }

  const typeIcon = { 'Ampli':'🔋','Enceinte':'🔊','Caisson':'💥','Console / Mixeur':'🎚️','Processeur':'⚙️','Micro':'🎤','Câble':'🔌','Autre':'📦' }
  const types = [...new Set(equipment.map(e => e.type).filter(Boolean))]
  const filtered = typeFilter ? equipment.filter(e => e.type === typeFilter) : equipment

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h1>🔊 Son</h1>
          {isEditor && tab === 'catalogue' && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Équipement</button>
          )}
        </div>
        <div style={{display:'flex',gap:6,marginTop:12}}>
          {[['calc','🔢 Calculer'],['catalogue','📦 Catalogue'],['historique','📋 Historique']].map(([t, label]) => (
            <button key={t} className={`btn btn-sm ${tab===t?'btn-primary':'btn-secondary'}`} onClick={() => setTab(t)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:60}}><span className="spinner" style={{width:32,height:32}}/></div>
        ) : tab === 'calc' ? (
          <AudioCalculator equipment={equipment}/>
        ) : tab === 'catalogue' ? (
          <div>
            {/* Filtre par type */}
            {types.length > 1 && (
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
                <button className={`btn btn-sm ${!typeFilter?'btn-primary':'btn-secondary'}`} onClick={() => setTypeFilter('')}>Tous</button>
                {types.map(t => (
                  <button key={t} className={`btn btn-sm ${typeFilter===t?'btn-primary':'btn-secondary'}`} onClick={() => setTypeFilter(typeFilter===t?'':t)}>
                    {typeIcon[t]||'📦'} {t}
                  </button>
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🔊</div>
                <p>{typeFilter ? `Aucun "${typeFilter}"` : 'Aucun équipement'}</p>
                {isEditor && !typeFilter && <button className="btn btn-primary" onClick={() => setShowAdd(true)}>Ajouter le premier</button>}
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {filtered.map(eq => (
                  <div key={eq.id} className="card" style={{display:'flex',gap:12,alignItems:'center'}}>
                    {eq.image_url
                      ? <img src={eq.image_url} style={{width:56,height:56,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={eq.name}/>
                      : <div style={{width:56,height:56,borderRadius:8,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,flexShrink:0}}>{typeIcon[eq.type]||'📦'}</div>
                    }
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                        <span style={{fontWeight:700,fontSize:15}}>{eq.name}</span>
                        <span style={{fontSize:11,background:'var(--bg3)',borderRadius:20,padding:'2px 8px',border:'1px solid var(--border)',color:'var(--text2)'}}>{eq.type}</span>
                      </div>
                      {eq.brand && <div style={{fontSize:13,color:'var(--text2)',marginTop:2}}>{eq.brand}{eq.model ? ` · ${eq.model}` : ''}</div>}
                      <div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap'}}>
                        {eq.power_watts    && <span className="chip">⚡ {eq.power_watts}W</span>}
                        {eq.impedance_ohms && <span className="chip">〰️ {eq.impedance_ohms}Ω</span>}
                        {eq.channels       && <span className="chip">🎚️ {eq.channels}ch</span>}
                        {eq.weight_kg      && <span className="chip">⚖️ {eq.weight_kg}kg</span>}
                      </div>
                      {eq.notes && <div style={{fontSize:12,color:'var(--text3)',marginTop:4}}>{eq.notes}</div>}
                    </div>
                    {isEditor && (
                      <div style={{display:'flex',flexDirection:'column',gap:6,flexShrink:0}}>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditEq(eq)}>✏️</button>
                        <button className="btn btn-ghost btn-icon btn-sm" style={{color:'var(--red)'}} onClick={() => handleDelete(eq.id)}>🗑️</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <AudioHistory/>
        )}
      </div>

      {(showAdd || editEq) && (
        <AudioModal
          equipment={editEq}
          onClose={() => { setShowAdd(false); setEditEq(null) }}
          onSave={loadEquipment}
        />
      )}
    </div>
  )
}
