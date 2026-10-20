import { useEffect, useMemo, useState } from 'react'
import './CombatSpellEffects.css'

const API = 'http://localhost:3001/api'
type Combatant = { id: string; characterId: string | null; type: 'player' | 'enemy'; name: string; currentHp: number; maxHp: number; survivalStatus?: string }
type CharacterOption = { id: string; playerId: string; name: string; playerName: string }
type Spell = { id: string; name: string; level: number; prepared: boolean; alwaysPrepared: boolean; resolutionType: 'none' | 'attack' | 'save'; effectType: 'none' | 'damage' | 'healing'; effectFormula: string; damageType: string | null; effectModifier: number; includeSpellcastingModifier: boolean; saveSuccessEffect: 'full' | 'half' | 'none' | null; upcastMode: 'none' | 'dice' | 'modifier'; upcastDiceCount: number; upcastDieSize: number | null; upcastModifier: number; effectNotes: string }
type ResolutionTarget = { targetId: string; targetName: string; outcome: string }
type Resolution = { id: string; casterCombatantId: string; casterName: string; casterCharacterId: string; spellId: string; spellName: string; resolutionType: 'attack' | 'save'; castingEventId: string | null; results: ResolutionTarget[]; createdAt: string }
type CastingEvent = { id: string; casterCombatantId: string; spellId: string; castLevel: number; status: string; createdAt: string }
type Roll = { id: string; requestId: string; targetId: string; targetName: string; spellId: string; spellName: string; effectType: 'damage' | 'healing'; resolutionId: string | null; resolutionType: 'none' | 'attack' | 'save'; castLevel: number; baseLevel: number; baseFormula: string; finalFormula: string; diceCount: number; dieSize: number | null; diceResults: number[]; formulaModifier: number; effectModifier: number; ability: string | null; abilityModifier: number; damageType: string | null; saveOutcome: string | null; saveSuccessEffect: string | null; attackOutcome: string | null; critical: boolean; fullAmount: number; appliedAmount: number; status: 'rolled' | 'no_effect' | 'adjudication_required'; scaling: string; notes: string; createdAt: string; applied: boolean }
type Application = { id: string; requestId: string; rollId: string; targetId: string; targetName: string; effectType: 'damage' | 'healing'; amount: number; hpBefore: number; hpAfter: number; message: string; createdAt: string }
type Bundle = { config: { enabled: boolean; ability: string | null; warning: string | null }; spells: Spell[] }
type ApiError = { error?: string; fields?: Record<string, string> }
async function read<T>(response: Response): Promise<T & ApiError> { return await response.json() as T & ApiError }

function upcastPreview(spell: Spell, castLevel: number): string {
  const parsed = /^(\d+)d(4|6|8|10|12|20)([+-]\d+)?$/i.exec(spell.effectFormula)
  if (!parsed) return spell.effectFormula || 'Not configured'
  const levels = Math.max(0, castLevel - spell.level)
  let count = Number(parsed[1]); let modifier = Number(parsed[3] ?? 0) + spell.effectModifier
  if (levels && spell.upcastMode === 'dice') count += levels * spell.upcastDiceCount
  if (levels && spell.upcastMode === 'modifier') modifier += levels * spell.upcastModifier
  return `${count}d${parsed[2]}${modifier ? modifier > 0 ? `+${modifier}` : modifier : ''}`
}

export default function CombatSpellEffects({ campaignId, encounterId, combatants, characters }: { campaignId: string; encounterId: string; combatants: Combatant[]; characters: CharacterOption[] }) {
  const [casterId, setCasterId] = useState('')
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [spellId, setSpellId] = useState('')
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [resolutionId, setResolutionId] = useState('')
  const [castLevel, setCastLevel] = useState('0')
  const [dmOverride, setDmOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [saveOutcomes, setSaveOutcomes] = useState<Record<string, '' | 'success' | 'failure'>>({})
  const [resolutions, setResolutions] = useState<Resolution[]>([])
  const [castingEvents, setCastingEvents] = useState<CastingEvent[]>([])
  const [castingEventId, setCastingEventId] = useState('')
  const [rolls, setRolls] = useState<Roll[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [applyRequestIds, setApplyRequestIds] = useState<Record<string, string>>({})

  const path = `${API}/campaigns/${campaignId}/encounters/${encounterId}/spell-effects`
  const caster = combatants.find((entry) => entry.id === casterId && entry.type === 'player')
  const character = characters.find((entry) => entry.id === caster?.characterId)
  const spell = bundle?.spells.find((entry) => entry.id === spellId)
  const matchingResolutions = useMemo(() => resolutions.filter((entry) => entry.casterCombatantId === casterId && entry.spellId === spellId), [resolutions, casterId, spellId])
  const selectedResolution = matchingResolutions.find((entry) => entry.id === resolutionId)
  const matchingCasts = castingEvents.filter((entry) => entry.casterCombatantId === casterId && entry.spellId === spellId)
  const selectedCastingEventId = selectedResolution?.castingEventId ?? castingEventId
  const eligibleTargets = selectedResolution ? combatants.filter((target) => selectedResolution.results.some((result) => result.targetId === target.id)) : combatants
  const activeSaveOutcomes = Object.fromEntries(Object.entries(saveOutcomes).filter(([id, outcome]) => targetIds.includes(id) && outcome)) as Record<string, 'success' | 'failure'>

  async function loadHistory() {
    const [rollResponse, resolutionResponse, castsResponse] = await Promise.all([fetch(path), fetch(`${API}/campaigns/${campaignId}/encounters/${encounterId}/spell-resolutions`), fetch(`${API}/campaigns/${campaignId}/encounters/${encounterId}/spell-castings`)] )
    const [effectBody, resolutionBody, castsBody] = await Promise.all([read<{ rolls?: Roll[]; applications?: Application[] }>(rollResponse), read<{ resolutions?: Resolution[] }>(resolutionResponse), read<{ events?: CastingEvent[] }>(castsResponse)])
    if (!rollResponse.ok) throw new Error(effectBody.error || 'Could not load spell effect history.')
    if (!resolutionResponse.ok) throw new Error(resolutionBody.error || 'Could not load spell resolution history.')
    if (!castsResponse.ok) throw new Error(castsBody.error || 'Could not load casting history.')
    setRolls(effectBody.rolls ?? []); setApplications(effectBody.applications ?? []); setResolutions(resolutionBody.resolutions ?? []); setCastingEvents(castsBody.events ?? [])
  }

  useEffect(() => {
    let cancelled = false
    setCasterId(''); setSpellId(''); setTargetIds([]); setResolutionId(''); setCastingEventId(''); setBundle(null); setRolls([]); setApplications([]); setResolutions([]); setCastingEvents([]); setError('')
    async function load() { setLoading(true); try { await loadHistory() } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load spell effects.') } finally { if (!cancelled) setLoading(false) } }
    void load(); return () => { cancelled = true }
  }, [campaignId, encounterId])

  useEffect(() => {
    let cancelled = false
    setBundle(null); setSpellId(''); setResolutionId(''); setCastingEventId(''); setTargetIds([])
    if (!character) return () => { cancelled = true }
    const base = `${API}/campaigns/${campaignId}/players/${character.playerId}/characters/${character.id}/spellcasting`
    async function load() { setLoading(true); setError(''); try { const response = await fetch(base); const body = await read<Bundle>(response); if (!response.ok) throw new Error(body.error || 'Could not load spellbook.'); if (!cancelled) setBundle(body) } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load spellbook.') } finally { if (!cancelled) setLoading(false) } }
    void load(); return () => { cancelled = true }
  }, [campaignId, character?.id, character?.playerId])

  useEffect(() => { if (spell) setCastLevel(String(spell.level)) }, [spell?.id])

  function toggleTarget(id: string) { setTargetIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]) }
  function resetIdempotency() { setRequestId(crypto.randomUUID()) }

  async function rollEffect() {
    if (!spell || !caster || !targetIds.length) return
    if (spell.resolutionType === 'none' && !selectedCastingEventId) { setError('Select a recorded casting event before rolling this spell effect.'); return }
    if (spell.resolutionType !== 'none' && !selectedResolution) { setError('Select a saved attack or saving throw result for this caster and spell first.'); return }
    if (spell.resolutionType === 'attack' && targetIds.length !== 1) { setError('A spell attack effect applies to its single resolved target.'); return }
    if ((spell.effectType === 'healing' || spell.effectType === 'damage') && (!spell.prepared && !spell.alwaysPrepared) && (!dmOverride || !overrideReason.trim())) { setError('Confirm the unprepared spell with an explicit DM override and reason.'); return }
    if (Object.keys(activeSaveOutcomes).length > 0 && !dmOverride) { setError('Enable DM adjudication before entering manual saving throw outcomes.'); return }
    if ((dmOverride || Object.keys(activeSaveOutcomes).length) && !overrideReason.trim()) { setError('Enter a reason for the explicit DM adjudication.'); return }
    setBusyId('roll'); setError(''); setNotice('')
    try {
      const response = await fetch(`${path}/roll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, casterId, spellId, targetIds, castLevel: Number(castLevel), resolutionId: selectedResolution?.id ?? null, ...(selectedCastingEventId ? { castingEventId: selectedCastingEventId } : {}), dmOverride, ...(dmOverride ? { overrideReason: overrideReason.trim() } : {}), adjudicatedSaveOutcomes: activeSaveOutcomes }) })
      const body = await read<{ rolls?: Roll[]; replayed?: boolean }>(response)
      if (!response.ok || !body.rolls) throw new Error([body.error, ...(body.fields ? Object.values(body.fields) : [])].filter(Boolean).join(': ') || 'Could not roll the spell effect.')
      setNotice(body.replayed ? 'Previously saved effect roll returned; no additional dice were rolled.' : `${spell.effectType === 'damage' ? 'Damage' : 'Healing'} rolled. Review it before applying.`)
      setRequestId(crypto.randomUUID()); await loadHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not roll the spell effect.') }
    finally { setBusyId('') }
  }

  async function applyEffect(roll: Roll) {
    const id = applyRequestIds[roll.id] ?? crypto.randomUUID()
    if (!applyRequestIds[roll.id]) setApplyRequestIds((current) => ({ ...current, [roll.id]: id }))
    setBusyId(roll.id); setError(''); setNotice('')
    try {
      const response = await fetch(`${path}/${encodeURIComponent(roll.id)}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: id }) })
      const body = await read<{ application?: Application; replayed?: boolean }>(response)
      if (!response.ok || !body.application) throw new Error([body.error, ...(body.fields ? Object.values(body.fields) : [])].filter(Boolean).join(': ') || 'Could not apply the spell effect.')
      setNotice(body.replayed ? 'Previously saved application returned; HP was not changed again.' : `${roll.effectType === 'damage' ? 'Damage' : 'Healing'} applied to ${body.application.targetName}.`)
      await loadHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply the spell effect.') }
    finally { setBusyId('') }
  }

  return <section className="combat-spell-effects" aria-labelledby="spell-effects-heading">
    <div className="combatants-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />SPELL EFFECTS</div><h3 id="spell-effects-heading">Roll, review, then apply</h3></div><span>Effect rolls never change HP until applied</span></div>
    {error && <p className="combat-spell-effect-feedback error" role="alert">{error}</p>}{notice && <p className="combat-spell-effect-feedback success" role="status">{notice}</p>}
    <div className="combat-spell-effect-grid">
      <label className="combat-field"><span>Spellcaster</span><select value={casterId} onChange={(event) => { setCasterId(event.target.value); setSpellId(''); setTargetIds([]); setResolutionId(''); resetIdempotency() }}><option value="">Choose a player caster</option>{combatants.filter((entry) => entry.type === 'player' && characters.some((item) => item.id === entry.characterId)).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {characters.find((item) => item.id === entry.characterId)?.playerName}</option>)}</select></label>
      <label className="combat-field"><span>Spell effect</span><select value={spellId} disabled={!casterId || loading} onChange={(event) => { setSpellId(event.target.value); setTargetIds([]); setResolutionId(''); resetIdempotency() }}><option value="">Choose a spell</option>{bundle?.spells.filter((entry) => entry.effectType !== 'none').map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.effectType} · Level {entry.level}</option>)}</select></label>
      {spell && <div className="spell-effect-preview"><strong>{spell.effectType === 'damage' ? 'Damage' : 'Healing'} formula</strong><span>{upcastPreview(spell, Number(castLevel))}{spell.damageType ? ` ${spell.damageType}` : ''}</span><small>Base {spell.effectFormula}{spell.effectModifier ? ` · fixed ${spell.effectModifier > 0 ? '+' : ''}${spell.effectModifier}` : ''}{spell.includeSpellcastingModifier ? ' · spellcasting modifier' : ''}</small>{spell.upcastMode !== 'none' && <small>{spell.upcastMode === 'dice' ? `+${spell.upcastDiceCount}d${spell.upcastDieSize} per level above base` : `${spell.upcastModifier > 0 ? '+' : ''}${spell.upcastModifier} per level above base`}</small>}{spell.effectNotes && <small>{spell.effectNotes}</small>}</div>}
      {spell && spell.level > 0 && <label className="combat-field"><span>Cast level</span><select value={castLevel} onChange={(event) => { setCastLevel(event.target.value); resetIdempotency() }}>{Array.from({ length: 10 - spell.level }, (_, index) => spell.level + index).map((level) => <option key={level} value={level}>Level {level}{level > spell.level ? ` · +${level - spell.level} above base` : ' · base'}</option>)}</select></label>}
      {spell?.level === 0 && <p className="combat-effect-note">Cantrips use their base formula; spell slots cannot upcast them.</p>}
      {spell && spell.resolutionType !== 'none' && <label className="combat-field effect-wide"><span>Saved {spell.resolutionType === 'attack' ? 'spell attack' : 'saving throw'} resolution</span><select value={resolutionId} onChange={(event) => { setResolutionId(event.target.value); setTargetIds([]); resetIdempotency() }}><option value="">Choose a saved resolution</option>{matchingResolutions.map((entry) => <option key={entry.id} value={entry.id}>{new Date(entry.createdAt).toLocaleString()} · {entry.results.map((result) => `${result.targetName}: ${result.outcome}`).join(', ')}</option>)}</select></label>}
      {spell?.resolutionType === 'none' && <label className="combat-field effect-wide"><span>Recorded casting event</span><select value={castingEventId} onChange={(event) => { setCastingEventId(event.target.value); resetIdempotency() }}><option value="">Choose a committed cast</option>{matchingCasts.filter((entry) => entry.castLevel === Number(castLevel)).map((entry) => <option key={entry.id} value={entry.id}>{new Date(entry.createdAt).toLocaleString()} · level {entry.castLevel} · {entry.status.replaceAll('_',' ')}</option>)}</select></label>}
      {spell && <fieldset className="combat-effect-targets effect-wide"><legend>Targets</legend>{eligibleTargets.length === 0 ? <small>No targets are available in the selected resolution.</small> : eligibleTargets.map((target) => <label key={target.id}><input type="checkbox" checked={targetIds.includes(target.id)} onChange={() => { toggleTarget(target.id); resetIdempotency() }} /><span>{target.name}</span><small>{target.currentHp}/{target.maxHp} HP{target.survivalStatus === 'dead' ? ' · Dead' : ''}</small></label>)}</fieldset>}
      {spell?.resolutionType === 'save' && selectedResolution?.results.some((result) => targetIds.includes(result.targetId) && result.outcome === 'adjudication_required') && <div className="combat-effect-adjudication effect-wide"><strong>Missing save result</strong><p>Enter a DM-determined outcome for each target. No save modifier or outcome will be assumed.</p>{selectedResolution.results.filter((result) => targetIds.includes(result.targetId) && result.outcome === 'adjudication_required').map((result) => <label className="combat-field" key={result.targetId}><span>{result.targetName} · adjudicated save</span><select value={saveOutcomes[result.targetId] ?? ''} onChange={(event) => { setSaveOutcomes({ ...saveOutcomes, [result.targetId]: event.target.value as '' | 'success' | 'failure' }); resetIdempotency() }}><option value="">Choose outcome</option><option value="success">Success</option><option value="failure">Failure</option></select></label>)}</div>}
      {spell && <div className="combat-effect-override effect-wide"><label><input type="checkbox" checked={dmOverride} onChange={(event) => { setDmOverride(event.target.checked); resetIdempotency() }} /><span>DM adjudication / override</span></label>{(dmOverride || !spell.prepared && !spell.alwaysPrepared || selectedResolution?.results.some((entry) => targetIds.includes(entry.targetId) && entry.outcome === 'miss') || Object.keys(activeSaveOutcomes).length > 0) && <input maxLength={500} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Reason required" aria-label="Spell effect adjudication reason" />}</div>}
      <button className="combat-primary-button" type="button" disabled={busyId !== '' || loading || !spell || !caster || !targetIds.length || spell.effectType === 'none' || spell.resolutionType !== 'none' && !selectedResolution || spell.resolutionType === 'none' && !selectedCastingEventId} onClick={() => void rollEffect()}>{busyId === 'roll' ? 'Rolling…' : `✧ Roll ${spell?.effectType === 'healing' ? 'Healing' : 'Damage'}`}</button>
    </div>
    <div className="combat-spell-effect-history"><div className="combat-attack-history-heading"><h4>Recent spell effect rolls</h4><span>{loading ? 'Loading…' : `${rolls.length} saved`}</span></div>{rolls.length === 0 ? <p className="combat-muted">Rolled spell damage and healing appear here before application.</p> : rolls.map((roll) => { const application = applications.find((entry) => entry.rollId === roll.id); return <article className="combat-spell-effect-event" key={roll.id}><header><strong>{roll.spellName} → {roll.targetName}</strong><span>{roll.effectType} · Cast at level {roll.castLevel}</span></header><p><b>{roll.status.replaceAll('_', ' ')}</b> · {roll.finalFormula}{roll.damageType ? ` ${roll.damageType}` : ''} · Dice: {roll.diceResults.length ? roll.diceResults.join(' + ') : 'none'} · {roll.effectType === 'damage' ? 'Applied damage' : 'Healing amount'} {roll.appliedAmount}{roll.saveOutcome && roll.saveOutcome !== 'adjudication_required' && roll.fullAmount !== roll.appliedAmount ? ` (full roll ${roll.fullAmount})` : ''}{roll.saveOutcome ? ` · Save ${roll.saveOutcome}` : ''}{roll.critical ? ' · Critical dice doubled' : ''}</p><small>Base level {roll.baseLevel}: {roll.baseFormula} · scaling: {roll.scaling}{roll.ability ? ` · ${roll.ability.toUpperCase()} ${roll.abilityModifier >= 0 ? '+' : ''}${roll.abilityModifier}` : ''}{roll.notes ? ` · ${roll.notes}` : ''}</small>{application ? <p className="applied">Applied · HP {application.hpBefore} → {application.hpAfter}{application.message ? ` · ${application.message}` : ''}</p> : roll.status !== 'adjudication_required' && <button type="button" className="combat-primary-button" disabled={busyId !== ''} onClick={() => void applyEffect(roll)}>{busyId === roll.id ? 'Applying…' : `Apply ${roll.effectType === 'damage' ? 'Damage' : 'Healing'}`}</button>}<time dateTime={roll.createdAt}>{new Date(roll.createdAt).toLocaleString()}</time></article> })}</div>
  </section>
}
