import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { compressAndUpload } from '../lib/imageUtils'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL




// ── Extract specs from image/PDF via Edge Function proxy ─────
async function extractSpecsFromFile(file) {
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result.split(',')[1])
    r.onerror = () => rej(new Error('Lecture fichier échouée'))
    r.readAsDataURL(file)
  })

  const isPdf = file.type === 'application/pdf'
  const mediaType = isPdf ? 'application/pdf' : file.type

  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        {
          type: isPdf ? 'document' : 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 }
        },
        {
          type: 'text',
          text: `Extrais les informations techniques de ce projecteur/appareil d'éclairage depuis cette fiche technique.
Réponds UNIQUEMENT en JSON valide, sans backticks, sans texte autour :
{
  "name": "nom du modèle",
  "brand": "marque",
  "model": "référence modèle",
  "watts": nombre (puissance en W, obligatoire),
  "voltage": nombre (tension en V, défaut 230),
  "power_factor": nombre entre 0 et 1 (cos phi, défaut 1.0),
  "dmx_channels": nombre ou null,
  "weight_kg": nombre ou null,
  "extra_info": "autres infos pertinentes en une phrase ou null"
}
Si une valeur est inconnue, mets null sauf watts qui est obligatoire.`
        }
      ]
    }]
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Non connecté')

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/anthropic-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) throw new Error(`Erreur API: ${resp.status}`)
  const data = await resp.json()
  const text = data.content?.find(b => b.type === 'text')?.text || ''
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

// ── Projector form modal ─────────────────────────────────────
function ProjectorModal({ projector, onClose, onSave }) {
  const [form, setForm]       = useState({ name: '', brand: '', model: '', watts: '', voltage: 230, power_factor: 1.0, dmx_channels: '', weight_kg: '', ...projector })
  const [imgFile, setImgFile] = useState(null)
  const [imgPrev, setImgPrev] = useState(projector?.image_url || null)
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleScan(e) {
    const f = e.target.files[0]
    if (!f) return
    setScanning(true)
    try {
      const specs = await extractSpecsFromFile(f)
      setForm(prev => ({ ...prev, name: specs.name || prev.name, brand: specs.brand || prev.brand, model: specs.model || prev.model, watts: specs.watts ?? prev.watts, voltage: specs.voltage || 230, power_factor: specs.power_factor || 1.0, dmx_channels: specs.dmx_channels ?? '', weight_kg: specs.weight_kg ?? '' }))
      toast('Fiche lue avec succès !', 'success')
    } catch(err) {
      toast(err.message, 'error')
    } finally {
      setScanning(false)
    }
  }

  async function handleSave() {
    if (!form.name?.trim()) { toast('Nom requis', 'error'); return }
    if (!form.watts || +form.watts <= 0) { toast('Puissance (W) requise', 'error'); return }
    setLoading(true)
    try {
      let imageUrl = projector?.image_url || null
      if (imgFile) imageUrl = await compressAndUpload(imgFile, 'projector-images', `proj_${form.name.replace(/\s/g,'_')}`)
      const payload = { name: form.name.trim(), brand: form.brand || null, model: form.model || null, watts: +form.watts, voltage: +form.voltage || 230, power_factor: +form.power_factor || 1.0, dmx_channels: form.dmx_channels ? +form.dmx_channels : null, weight_kg: form.weight_kg ? +form.weight_kg : null, image_url: imageUrl }
      if (projector?.id) {
        await supabase.from('projectors').update(payload).eq('id', projector.id)
      } else {
        await supabase.from('projectors').insert(payload)
      }
      toast(projector?.id ? 'Projecteur mis à jour' : 'Projecteur ajouté', 'success')
      onSave()
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
        <h3 className="modal-title">{projector?.id ? 'Modifier' : 'Nouveau'} projecteur</h3>

        {/* Scan fiche */}
        <div style={{marginBottom:20,padding:'14px',background:'rgba(79,70,229,0.08)',border:'1px solid rgba(79,70,229,0.2)',borderRadius:'var(--radius)'}}>
          <div style={{fontWeight:600,fontSize:13,marginBottom:8,color:'var(--indigo2)'}}>✨ Lecture automatique de fiche</div>
          <label className="btn btn-secondary btn-sm" style={{cursor:'pointer',display:'inline-flex'}}>
            <input type="file" accept="image/*,application/pdf" style={{display:'none'}} onChange={handleScan}/>
            {scanning ? <><span className="spinner" style={{width:14,height:14}}/> Lecture...</> : '📄 Charger PDF ou photo'}
          </label>
          <span style={{color:'var(--text3)',fontSize:12,marginLeft:10}}>Remplit les champs auto</span>
        </div>

        <div className="form-row">
          <div className="form-group"><label className="label">Nom *</label><input className="input" value={form.name||''} onChange={e => set('name',e.target.value)} placeholder="PAR LED 64"/></div>
          <div className="form-group"><label className="label">Marque</label><input className="input" value={form.brand||''} onChange={e => set('brand',e.target.value)} placeholder="Chauvet"/></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Modèle</label><input className="input" value={form.model||''} onChange={e => set('model',e.target.value)} placeholder="Intimidator"/></div>
          <div className="form-group"><label className="label">Puissance (W) *</label><input className="input" type="number" min={1} value={form.watts||''} onChange={e => set('watts',e.target.value)} placeholder="150"/></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Tension (V)</label><input className="input" type="number" value={form.voltage||230} onChange={e => set('voltage',e.target.value)}/></div>
          <div className="form-group"><label className="label">Cos φ (0–1)</label><input className="input" type="number" step="0.01" min={0} max={1} value={form.power_factor||1} onChange={e => set('power_factor',e.target.value)}/></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="label">Canaux DMX</label><input className="input" type="number" value={form.dmx_channels||''} onChange={e => set('dmx_channels',e.target.value)} placeholder="16"/></div>
          <div className="form-group"><label className="label">Poids (kg)</label><input className="input" type="number" step="0.1" value={form.weight_kg||''} onChange={e => set('weight_kg',e.target.value)} placeholder="3.5"/></div>
        </div>
        <div className="form-group">
          <label className="label">Photo</label>
          <label className="upload-zone">
            <input type="file" accept="image/*" style={{display:'none'}} onChange={e => { const f=e.target.files[0]; if(f){setImgFile(f);setImgPrev(prev => { if(prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return URL.createObjectURL(f) })} }}/>
            {imgPrev ? <img src={imgPrev} className="upload-preview" alt="preview"/> : <><div style={{fontSize:28}}>💡</div><div style={{fontSize:13,marginTop:6}}>Photo du projecteur</div></>}
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

// ── Power Calculator ─────────────────────────────────────────
function PowerCalculator({ projectors }) {
  const [items, setItems]         = useState([]) // [{projector, qty}]
  const [circuitA, setCircuitA]   = useState(16)
  const [circuitV, setCircuitV]   = useState(230)
  const [calcName, setCalcName]   = useState('')
  const [saving, setSaving]       = useState(false)
  const { user } = useAuth()
  const toast = useToast()

  function addProjector(p) {
    setItems(prev => {
      const existing = prev.find(i => i.projector.id === p.id)
      if (existing) return prev.map(i => i.projector.id === p.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { projector: p, qty: 1 }]
    })
  }

  function updateQty(id, qty) {
    if (+qty <= 0) { setItems(prev => prev.filter(i => i.projector.id !== id)); return }
    setItems(prev => prev.map(i => i.projector.id === id ? { ...i, qty: +qty } : i))
  }

  const totalW   = items.reduce((sum, i) => sum + (i.projector.watts * i.qty), 0)
  const totalA   = totalW / circuitV
  const maxW     = circuitA * circuitV
  const pct      = Math.min((totalA / circuitA) * 100, 100)
  const isSafe   = totalA <= circuitA * 0.8
  const isWarn   = totalA > circuitA * 0.8 && totalA <= circuitA
  const isDanger = totalA > circuitA

  const fillClass = isDanger ? 'power-danger' : isWarn ? 'power-warn' : 'power-safe'
  const status    = isDanger ? '🔴 SURCHARGE' : isWarn ? '🟡 Proche de la limite' : '🟢 OK'

  async function handleSave() {
    if (!calcName.trim()) { toast('Nom du calcul requis', 'error'); return }
    if (items.length === 0) { toast('Aucun projecteur ajouté', 'error'); return }
    setSaving(true)
    try {
      await supabase.from('power_calculations').insert({
        name: calcName.trim(),
        circuit_amperage: circuitA,
        circuit_voltage: circuitV,
        items: items.map(i => ({ projector_id: i.projector.id, projector_name: i.projector.name, watts: i.projector.watts, qty: i.qty })),
        total_watts: totalW,
        total_amperage: totalA,
        is_safe: !isDanger,
        created_by: user.id
      })
      toast('Calcul sauvegardé', 'success')
      setCalcName('')
    } catch(err) {
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Circuit config */}
      <div className="card" style={{marginBottom:16}}>
        <div className="section-title" style={{marginBottom:12}}>⚡ Circuit</div>
        <div className="form-row">
          <div className="form-group"><label className="label">Disjoncteur (A)</label><input className="input" type="number" value={circuitA} onChange={e => setCircuitA(+e.target.value)} min={1}/></div>
          <div className="form-group"><label className="label">Tension (V)</label><input className="input" type="number" value={circuitV} onChange={e => setCircuitV(+e.target.value)}/></div>
        </div>
        <div style={{fontSize:13,color:'var(--text2)'}}>Capacité max : <strong>{maxW} W / {circuitA} A</strong></div>
      </div>

      {/* Result */}
      {items.length > 0 && (
        <div className="card" style={{marginBottom:16,border:`1px solid ${isDanger?'var(--red)':isWarn?'var(--amber)':'var(--border)'}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{fontWeight:700,fontSize:16}}>{status}</span>
            <span className="mono" style={{fontSize:13,color:'var(--text2)'}}>{totalW}W / {totalA.toFixed(1)}A</span>
          </div>
          <div className="power-bar"><div className={`power-fill ${fillClass}`} style={{width:`${pct}%`}}/></div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'var(--text3)',marginTop:4}}>
            <span>0 W</span><span>{Math.round(maxW*0.8)} W (80%)</span><span>{maxW} W</span>
          </div>
          {isDanger && <div style={{marginTop:10,padding:'8px 12px',background:'rgba(239,68,68,0.1)',borderRadius:'var(--radius)',fontSize:13,color:'var(--red)'}}>⚠️ Dépasse la capacité de {(totalA - circuitA).toFixed(1)}A — risque de disjonction</div>}
        </div>
      )}

      {/* Items */}
      {items.length > 0 && (
        <div style={{marginBottom:16}}>
          <div className="section-header"><span className="section-title">Projecteurs ({items.length})</span></div>
          {items.map(i => (
            <div key={i.projector.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,padding:'10px 14px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:14}}>{i.projector.name}</div>
                <div style={{fontSize:12,color:'var(--text3)'}}>{i.projector.watts}W × {i.qty} = <strong>{i.projector.watts*i.qty}W</strong></div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => updateQty(i.projector.id, i.qty-1)} style={{fontSize:18,fontWeight:700}}>−</button>
                <span style={{minWidth:24,textAlign:'center',fontWeight:700}}>{i.qty}</span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => updateQty(i.projector.id, i.qty+1)} style={{fontSize:18,fontWeight:700}}>+</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save */}
      {items.length > 0 && (
        <div style={{display:'flex',gap:8,marginBottom:20}}>
          <input className="input" placeholder="Nom du calcul (ex: Scène Gala)" value={calcName} onChange={e => setCalcName(e.target.value)} style={{flex:1}}/>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?<span className="spinner" style={{borderTopColor:'#fff'}}/>:'💾'}</button>
        </div>
      )}

      {/* Projector picker */}
      <div className="section-header"><span className="section-title">Ajouter un projecteur</span></div>
      {projectors.length === 0 ? (
        <div className="empty"><div className="empty-icon">💡</div><p>Aucun projecteur dans le catalogue</p></div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {projectors.map(p => (
            <div key={p.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background:'var(--bg3)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
              {p.image_url
                ? <img src={p.image_url} style={{width:44,height:44,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={p.name}/>
                : <div style={{width:44,height:44,borderRadius:8,background:'var(--bg2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>💡</div>
              }
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:14}}>{p.name}</div>
                <div style={{fontSize:12,color:'var(--text3)'}}>{p.brand && `${p.brand} · `}{p.watts}W · {(p.watts/p.voltage).toFixed(2)}A{p.dmx_channels ? ` · ${p.dmx_channels}ch DMX` : ''}</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => addProjector(p)}>+</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── History ──────────────────────────────────────────────────
function CalcHistory() {
  const [history, setHistory] = useState([])
  const toast = useToast()

  useEffect(() => {
    supabase.from('power_calculations').select('*').order('created_at', {ascending:false}).limit(20).then(({ data }) => setHistory(data||[]))
  }, [])

  async function handleDelete(id) {
    if (!confirm('Supprimer ce calcul ?')) return
    const { error } = await supabase.from('power_calculations').delete().eq('id', id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    setHistory(h => h.filter(c => c.id !== id))
    toast('Supprimé', 'success')
  }

  if (history.length === 0) return <div className="empty"><div className="empty-icon">📋</div><p>Aucun calcul sauvegardé</p></div>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10}}>
      {history.map(c => (
        <div key={c.id} className="card" style={{border:`1px solid ${c.is_safe?'var(--border)':'rgba(239,68,68,0.3)'}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div>
              <div style={{fontWeight:700}}>{c.name}</div>
              <div style={{fontSize:13,color:'var(--text2)',marginTop:4}}>{c.total_watts}W · {c.total_amperage?.toFixed(1)}A / {c.circuit_amperage}A</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{new Date(c.created_at).toLocaleDateString('fr')}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:18}}>{c.is_safe?'🟢':'🔴'}</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleDelete(c.id)} style={{color:'var(--red)'}}>🗑️</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main PowerPage ───────────────────────────────────────────
export default function PowerPage() {
  const { isEditor } = useAuth()
  const toast = useToast()
  const [tab, setTab]           = useState('calc')
  const [projectors, setProjectors] = useState([])
  const [showAdd, setShowAdd]   = useState(false)
  const [editProj, setEditProj] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => { loadProjectors() }, [])

  async function loadProjectors() {
    setLoading(true)
    const { data } = await supabase.from('projectors').select('*').order('name')
    setProjectors(data || [])
    setLoading(false)
  }

  async function handleDeleteProj(id) {
    if (!confirm('Supprimer ce projecteur ?')) return
    const { error } = await supabase.from('projectors').delete().eq('id', id)
    if (error) { toast('Erreur : ' + error.message, 'error'); return }
    toast('Projecteur supprimé', 'success')
    loadProjectors()
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h1>⚡ Calcul W</h1>
          {isEditor && tab === 'catalogue' && <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Projecteur</button>}
        </div>
        <div style={{display:'flex',gap:6,marginTop:12}}>
          {['calc','catalogue','historique'].map(t => (
            <button key={t} className={`btn btn-sm ${tab===t?'btn-primary':'btn-secondary'}`} onClick={() => setTab(t)} style={{textTransform:'capitalize'}}>
              {t === 'calc' ? '🔢 Calculer' : t === 'catalogue' ? '💡 Catalogue' : '📋 Historique'}
            </button>
          ))}
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div style={{display:'flex',justifyContent:'center',padding:60}}><span className="spinner" style={{width:32,height:32}}/></div>
        ) : tab === 'calc' ? (
          <PowerCalculator projectors={projectors}/>
        ) : tab === 'catalogue' ? (
          <div>
            {projectors.length === 0 ? (
              <div className="empty"><div className="empty-icon">💡</div><p>Aucun projecteur</p>{isEditor && <button className="btn btn-primary" onClick={() => setShowAdd(true)}>Ajouter le premier</button>}</div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {projectors.map(p => (
                  <div key={p.id} className="card" style={{display:'flex',gap:12,alignItems:'center'}}>
                    {p.image_url
                      ? <img src={p.image_url} style={{width:60,height:60,borderRadius:8,objectFit:'cover',flexShrink:0}} alt={p.name}/>
                      : <div style={{width:60,height:60,borderRadius:8,background:'var(--bg3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,flexShrink:0}}>💡</div>
                    }
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700}}>{p.name}</div>
                      {p.brand && <div style={{fontSize:13,color:'var(--text2)'}}>{p.brand} {p.model}</div>}
                      <div style={{display:'flex',gap:10,marginTop:6,flexWrap:'wrap'}}>
                        <span className="chip">⚡ {p.watts}W</span>
                        <span className="chip">🔌 {(p.watts/p.voltage).toFixed(2)}A</span>
                        {p.dmx_channels && <span className="chip">DMX {p.dmx_channels}ch</span>}
                        {p.weight_kg && <span className="chip">⚖️ {p.weight_kg}kg</span>}
                      </div>
                    </div>
                    {isEditor && (
                      <div style={{display:'flex',flexDirection:'column',gap:6}}>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditProj(p)}>✏️</button>
                        <button className="btn btn-ghost btn-icon btn-sm" style={{color:'var(--red)'}} onClick={() => handleDeleteProj(p.id)}>🗑️</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <CalcHistory/>
        )}
      </div>

      {(showAdd || editProj) && (
        <ProjectorModal
          projector={editProj}
          onClose={() => { setShowAdd(false); setEditProj(null) }}
          onSave={loadProjectors}
        />
      )}
    </div>
  )
}
