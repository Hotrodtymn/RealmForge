import { useEffect, useMemo, useState } from 'react'
import './CombatSpellResolution.css'

const API = 'http://localhost:3001/api'
type Mode = 'normal' | 'advantage' | 'disadvantage'
type Combatant = { id: string; characterId: string | null; type: 'player' | 'enemy'; name: string; conditions: { condition: string; level: number | null }[] }
type CharacterOption = { id: string; playerId: string; name: string; playerName: string }
type Spell = { id: string; name: string; level: number; prepared: boolean; alwaysPrepared: boolean; castingTime: string; castingTimeCategory?: 'action' | 'bonus_action' | 'reaction' | 'special'; resolutionType?: 'none' | 'attack' | 'save'; savingThrowAbility?: string | null; attackType?: 'melee' | 'ranged' | null; targetGuidance?: string; resolutionNotes?: string }
type SpellData = { enabled: boolean; ability: string | null; spellAttackBonus: number | null; spellSaveDc: number | null; warning: string | null; slots?: { level: number; maximum: number; remaining: number; expended: number }[] }
type ResolutionTarget = { targetId: string; targetName: string; resolutionType: 'attack' | 'save'; outcome: string; total: number | null; targetAC?: number; dc?: number; naturalRoll: number | null; diceResults: number[]; keptIndex: number | null; manualMode: Mode; finalMode: string; spellAttackBonus?: number; ability?: string; abilityModifier?: number; proficiencyBonus?: number; targetModifier?: number | null; exhaustionLevel: number; exhaustionPenalty: number; advantageSources?: string[]; disadvantageSources?: string[]; conditionWarnings: string[]; automaticFailureConditions?: string[]; breakdown: string; dmOverride: boolean; overrideReason: string }
type Resolution = { id: string; requestId: string; casterName: string; casterCombatantId: string; spellId: string; spellName: string; resolutionType: 'attack' | 'save'; castingEventId: string | null; manualMode: Mode; results: ResolutionTarget[]; dmOverride: boolean; overrideReason: string; createdAt: string }
type CastingEvent = { id: string; casterCombatantId: string; spellId: string; casterName: string; spellName: string; castLevel: number; slotLevel: number | null; actionResource: string | null; status: string; dmOverride: boolean; overrideReason: string; createdAt: string }
type ApiError = { error?: string; fields?: Record<string, string> }
async function payload<T>(response: Response): Promise<T & ApiError> { return await response.json() as T & ApiError }
function signed(value: number): string { return value >= 0 ? `+${value}` : String(value) }

export default function CombatSpellResolution({ campaignId, encounterId, combatants, characters }: { campaignId: string; encounterId: string; combatants: Combatant[]; characters: CharacterOption[] }) {
  const [casterId, setCasterId] = useState('')
  const [spellData, setSpellData] = useState<SpellData | null>(null)
  const [spells, setSpells] = useState<Spell[]>([])
  const [spellId, setSpellId] = useState('')
  const [targets, setTargets] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('normal')
  const [npcModifiers, setNpcModifiers] = useState<Record<string, string>>({})
  const [dmOverride, setDmOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [distance, setDistance] = useState('')
  const [casterSight, setCasterSight] = useState('')
  const [targetSight, setTargetSight] = useState('')
  const [fearSight, setFearSight] = useState('')
  const [history, setHistory] = useState<Resolution[]>([])
  const [castingHistory, setCastingHistory] = useState<CastingEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [castLevel, setCastLevel] = useState('')
  const [castRequestId, setCastRequestId] = useState(() => crypto.randomUUID())
  const [castingEventId, setCastingEventId] = useState('')
  const [castingSaving, setCastingSaving] = useState(false)
  const [specialResource, setSpecialResource] = useState<'action' | 'bonusAction' | 'reaction' | 'none'>('action')

  const casterOptions = useMemo(() => combatants.filter((combatant) => combatant.type === 'player' && combatant.characterId && characters.some((character) => character.id === combatant.characterId)), [combatants, characters])
  const casterCombatant = casterOptions.find((combatant) => combatant.id === casterId)
  const casterCharacter = characters.find((character) => character.id === casterCombatant?.characterId)
  const spell = spells.find((entry) => entry.id === spellId)
  const resolutionType = spell?.resolutionType ?? 'none'
  const path = `${API}/campaigns/${campaignId}/encounters/${encounterId}/spell-resolutions`
  const incompleteSpell = Boolean(spell && resolutionType === 'none')
  const unprepared = Boolean(spell && !spell.prepared && !spell.alwaysPrepared)
  const hasNPCModifiers = Object.values(npcModifiers).some((value) => value.trim() !== '')
  const castLevelNumber = castLevel === '' ? spell?.level ?? 0 : Number(castLevel)
  const castingResource = spell?.castingTimeCategory === 'action' ? 'Action' : spell?.castingTimeCategory === 'bonus_action' ? 'Bonus Action' : spell?.castingTimeCategory === 'reaction' ? 'Reaction' : specialResource === 'none' ? 'No action resource' : specialResource === 'bonusAction' ? 'Bonus Action' : specialResource === 'reaction' ? 'Reaction' : 'Action'

  useEffect(() => { setCastLevel(spell ? String(spell.level) : ''); setCastingEventId(''); setCastRequestId(crypto.randomUUID()) }, [spell?.id])

  async function loadHistory() {
    if (!campaignId || !encounterId) return
    const response = await fetch(path)
    const body = await payload<{ resolutions?: Resolution[] }>(response)
    if (!response.ok) throw new Error(body.error || 'Could not load spell resolution history.')
    setHistory(body.resolutions ?? [])
    const castsResponse = await fetch(`${API}/campaigns/${campaignId}/encounters/${encounterId}/spell-castings`)
    const castsBody = await payload<{ events?: CastingEvent[] }>(castsResponse)
    if (!castsResponse.ok) throw new Error(castsBody.error || 'Could not load casting history.')
    setCastingHistory(castsBody.events ?? [])
  }

  useEffect(() => {
    let cancelled = false
    setCasterId(''); setSpellId(''); setSpells([]); setSpellData(null); setTargets([]); setHistory([]); setError('')
    async function load() {
      setLoading(true)
      try { await loadHistory() }
      catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load spell history.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [campaignId, encounterId])

  useEffect(() => {
    let cancelled = false
    setSpellData(null); setSpells([]); setSpellId('')
    if (!casterCharacter || !casterCombatant) return () => { cancelled = true }
    const base = `${API}/campaigns/${campaignId}/players/${casterCharacter.playerId}/characters/${casterCharacter.id}/spellcasting`
    async function loadCasterSpells() {
      setLoading(true); setError('')
      try {
        const response = await fetch(base)
        const body = await payload<{ config?: SpellData; spells?: Spell[]; slots?: SpellData['slots'] }>(response)
        if (!response.ok || !body.config) throw new Error(body.error || 'Could not load this caster’s spellbook.')
        if (!cancelled) { setSpellData({ ...body.config, slots: body.slots ?? [] }); setSpells(body.spells ?? []) }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this caster’s spellbook.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void loadCasterSpells()
    return () => { cancelled = true }
  }, [campaignId, casterCharacter?.id, casterCharacter?.playerId, casterCombatant?.id])

  function toggleTarget(id: string) { setTargets((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]) }

  async function castSpell() {
    if (!spell || !casterCombatant) return
    if (spell.level === 0 && castLevelNumber !== 0 || castLevelNumber < spell.level || castLevelNumber > 9) { setError('Choose a cast level from the spell’s base level through level 9; cantrips remain level 0.'); return }
    if (spell.castingTimeCategory === 'special' && (!dmOverride || !overrideReason.trim())) { setError('Special casting times require explicit DM adjudication and a reason.'); return }
    setCastingSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${API}/campaigns/${campaignId}/encounters/${encounterId}/spell-castings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: castRequestId, casterId, spellId, castLevel: castLevelNumber, ...(spell.castingTimeCategory === 'special' ? { specialResource } : {}), ...(dmOverride ? { dmOverride: true, overrideReason: overrideReason.trim() } : {}) }) })
      const body = await payload<{ event?: { id: string; status: string; slotLevel: number | null; actionResource: string | null }; replayed?: boolean }>(response)
      if (!response.ok || !body.event) throw new Error([body.error, ...(body.fields ? Object.values(body.fields) : [])].filter(Boolean).join(': ') || 'Could not cast this spell.')
      setCastingEventId(body.event.id); setNotice(body.replayed ? 'Previously committed casting returned; resources were not spent again.' : `${spell.name} cast${body.event.slotLevel ? ` · level ${body.event.slotLevel} slot spent` : ' · no slot spent'}. ${body.event.actionResource ? `${body.event.actionResource} spent.` : ''} ${body.event.status === 'awaiting_adjudication' ? 'Awaiting DM adjudication.' : 'Ready for resolution.'}`)
      setCastRequestId(crypto.randomUUID())
      const caster = characters.find((character) => character.id === casterCharacter?.id)
      if (caster) { const response = await fetch(`${API}/campaigns/${campaignId}/players/${caster.playerId}/characters/${caster.id}/spellcasting`); const refreshed = await payload<{ config?: SpellData; slots?: SpellData['slots'] }>(response); if (response.ok && refreshed.config) setSpellData({ ...refreshed.config, slots: refreshed.slots ?? [] }) }
      await loadHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cast this spell.') }
    finally { setCastingSaving(false) }
  }

  async function resolve() {
    if (!spell || !casterCombatant || targets.length === 0) return
    if (!castingEventId) { setError('Cast the spell first so its resource expenditure is recorded.'); return }
    if (incompleteSpell) { setError('This spell has no explicit attack or saving throw metadata; resolve it manually or configure it as a custom spell.'); return }
    if (unprepared && (!dmOverride || !overrideReason.trim())) { setError('Class-specific preparation rules are not represented. Confirm the unprepared spell with an explicit DM override and reason.'); return }
    if (hasNPCModifiers && (!dmOverride || !overrideReason.trim())) { setError('Explicit NPC saving throw modifiers require a DM override reason.'); return }
    if (dmOverride && !overrideReason.trim()) { setError('Enter a reason for the explicit DM override.'); return }
    if (resolutionType === 'attack' && targets.length !== 1) { setError('Spell attacks resolve against one target at a time.'); return }
    if (resolutionType === 'attack' && distance.trim() && (!/^\d+$/.test(distance) || Number(distance) > 10000)) { setError('Distance must be a whole number from 0 to 10000 feet, or blank for DM adjudication.'); return }
    const saveModifiers: Record<string, number> = {}
    if (resolutionType === 'save') for (const [targetId, value] of Object.entries(npcModifiers)) if (targets.includes(targetId) && value.trim()) {
      if (!/^-?\d+$/.test(value) || Number(value) < -30 || Number(value) > 30) { setError('NPC saving throw modifiers must be whole numbers from -30 to 30.'); return }
      saveModifiers[targetId] = Number(value)
    }
    const context = {
      ...(distance.trim() ? { distanceFeet: Number(distance) } : {}),
      ...(casterSight ? { attackerCanSeeTarget: casterSight === 'yes' } : {}),
      ...(targetSight ? { targetCanSeeAttacker: targetSight === 'yes' } : {}),
      ...(fearSight ? { fearSourceVisible: fearSight === 'yes' } : {}),
    }
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, casterId, spellId, targetIds: targets, mode: resolutionType === 'attack' ? mode : 'normal', context, npcSaveModifiers: saveModifiers, ...(castingEventId ? { castingEventId } : {}), ...(dmOverride ? { dmOverride: true, overrideReason: overrideReason.trim() } : {}) }) })
      const body = await payload<{ resolution?: Resolution; replayed?: boolean }>(response)
      if (!response.ok || !body.resolution) throw new Error([body.error, ...(body.fields ? Object.values(body.fields) : [])].filter(Boolean).join(': ') || 'Could not resolve this spell.')
      setNotice(body.replayed ? 'Previously saved spell resolution returned; no additional dice were rolled.' : `${spell.name} resolution saved.`)
      setRequestId(crypto.randomUUID())
      await loadHistory()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not resolve this spell.') }
    finally { setSaving(false) }
  }

  return <section className="combat-spell-resolution" aria-labelledby="spell-resolution-heading">
    <div className="combatants-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />SPELL RESOLUTION</div><h3 id="spell-resolution-heading">Resolve a spell attack or save</h3></div><span>Server-rolled d20 · no slots or actions spent</span></div>
    {error && <p className="combat-spell-feedback error" role="alert">{error}</p>}{notice && <p className="combat-spell-feedback success" role="status">{notice}</p>}
    {combatants.length === 0 ? <p className="combat-muted">Add combatants to resolve a spell.</p> : <div className="combat-spell-grid">
      <label className="combat-field"><span>Spellcaster</span><select value={casterId} onChange={(event) => { setCasterId(event.target.value); setSpellId(''); setTargets([]); setDmOverride(false); setOverrideReason('') }}><option value="">Choose a player caster</option>{casterOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {characters.find((character) => character.id === entry.characterId)?.playerName}</option>)}</select></label>
      <label className="combat-field"><span>Spell</span><select value={spellId} disabled={!casterId || loading} onChange={(event) => setSpellId(event.target.value)}><option value="">Choose a spellbook entry</option>{spells.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.level === 0 ? 'Cantrip' : `Level ${entry.level}`}{!entry.prepared && !entry.alwaysPrepared ? ' · unprepared' : ''}</option>)}</select></label>
      {spellData && <div className="combat-spell-config"><span>Spell attack bonus</span><strong>{spellData.spellAttackBonus === null ? '—' : signed(spellData.spellAttackBonus)}</strong><span>Spell save DC</span><strong>{spellData.spellSaveDc ?? '—'}</strong></div>}
      {spellData?.warning && <p className="combat-condition-rules warning">{spellData.warning}</p>}
      {spell && <div className="combat-spell-meta"><strong>{spell.name}</strong><span>{resolutionType === 'attack' ? `${spell.attackType} spell attack` : resolutionType === 'save' ? `${spell.savingThrowAbility?.toUpperCase()} saving throw` : 'No automated resolution metadata'}</span>{spell.targetGuidance && <small>{spell.targetGuidance}</small>}{spell.resolutionNotes && <small>{spell.resolutionNotes}</small>}</div>}
      {spell && <section className="combat-spell-cast-workflow" aria-label="Cast spell"><h4>Cast spell</h4><p>{spell.castingTime} · {castingResource}{spell.castingTimeCategory === 'special' ? ' · requires DM adjudication' : ''}</p>{spell.level > 0 && <><label className="combat-field"><span>Cast level</span><select value={castLevel} disabled={Boolean(castingEventId)} onChange={(event) => { setCastLevel(event.target.value); setCastingEventId('') }}>{Array.from({ length: 10 - spell.level }, (_, index) => spell.level + index).map((level) => <option value={level} key={level}>Level {level}{level === spell.level ? ' · base level' : ' · upcast'}</option>)}</select></label><div className="combat-cast-slot-list"><strong>Available slots</strong>{(spellData?.slots ?? []).filter((slot) => slot.level >= spell.level).map((slot) => <span key={slot.level}>Level {slot.level}: {slot.remaining}/{slot.maximum}</span>)}{!(spellData?.slots ?? []).some((slot) => slot.level >= spell.level && slot.remaining > 0) && <span>No available slot at or above the spell level.</span>}</div></>}{castingHistory.some((entry) => entry.casterCombatantId === casterId && entry.spellId === spellId) && <label className="combat-field"><span>Use a previously committed cast</span><select value={castingEventId} onChange={(event) => setCastingEventId(event.target.value)}><option value="">Commit a new cast</option>{castingHistory.filter((entry) => entry.casterCombatantId === casterId && entry.spellId === spellId).map((entry) => <option key={entry.id} value={entry.id}>{new Date(entry.createdAt).toLocaleString()} · level {entry.castLevel} · {entry.status.replaceAll('_',' ')}</option>)}</select></label>}{castingEventId ? <p className="combat-cast-confirmed" role="status">Recorded cast selected · event {castingEventId.slice(0, 8)} · expenditure will not be repeated. Continue to resolve the spell below.</p> : <><p className="combat-attack-hint">Committing spends {spell.level > 0 ? `one level ${castLevelNumber} spell slot` : 'no spell slot'}{castingResource !== 'No action resource' ? ` and the ${castingResource}` : ''}.</p><button type="button" className="combat-primary-button" disabled={castingSaving || loading || !spellData?.enabled || !spellData.ability || (spell.level > 0 && !(spellData.slots ?? []).some((slot) => slot.level === castLevelNumber && slot.remaining > 0))} onClick={() => void castSpell()}>{castingSaving ? 'Committing cast…' : `✧ Cast ${spell.name}`}</button></>}{spell.castingTimeCategory === 'special' && <><label className="combat-field"><span>DM-adjudicated action resource</span><select value={specialResource} onChange={(event) => setSpecialResource(event.target.value as typeof specialResource)}><option value="action">Action</option><option value="bonusAction">Bonus Action</option><option value="reaction">Reaction</option><option value="none">No action resource</option></select></label><p className="combat-attack-hint">Existing or unclassified casting times are treated as Special. Confirm the resource above and enter a reason in the DM adjudication field before committing.</p></>}</section>}
      {spell && resolutionType !== 'none' && <fieldset className="combat-spell-targets"><legend>Choose target{resolutionType === 'save' ? 's' : ''}</legend>{combatants.map((target) => <label key={target.id}><input type={resolutionType === 'attack' ? 'radio' : 'checkbox'} name="spell-target" checked={targets.includes(target.id)} onChange={() => resolutionType === 'attack' ? setTargets([target.id]) : toggleTarget(target.id)} /><span>{target.name}</span><small>{target.type === 'player' ? 'Player' : 'NPC'}{target.conditions.some((condition) => condition.condition === 'exhaustion') ? ` · Exhaustion ${target.conditions.find((condition) => condition.condition === 'exhaustion')?.level}` : ''}</small></label>)}</fieldset>}
      {spell && resolutionType === 'attack' && <>
        <label className="combat-field"><span>Manual roll mode</span><select value={mode} onChange={(event) => setMode(event.target.value as Mode)}><option value="normal">Normal</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option></select></label>
        <details className="combat-context-fields"><summary>Visibility and distance context for conditions</summary><label className="combat-field"><span>Distance between caster and target (ft)</span><input type="number" min="0" max="10000" step="1" value={distance} onChange={(event) => setDistance(event.target.value)} placeholder="Unknown · adjudicate manually" /></label><label className="combat-field"><span>Can caster see target?</span><select value={casterSight} onChange={(event) => setCasterSight(event.target.value)}><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label><label className="combat-field"><span>Can target see caster?</span><select value={targetSight} onChange={(event) => setTargetSight(event.target.value)}><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label><label className="combat-field"><span>Fear source in caster’s line of sight?</span><select value={fearSight} onChange={(event) => setFearSight(event.target.value)}><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label></details>
      </>}
      {spell && resolutionType === 'save' && <div className="combat-spell-npc-modifiers"><strong>NPC save modifiers · optional</strong><p>NPC saves are not rolled without an explicit modifier. Leave blank for DM adjudication.</p>{targets.map((targetId) => { const target = combatants.find((entry) => entry.id === targetId); return target?.type === 'enemy' ? <label className="combat-field" key={targetId}><span>{target.name} · {spell.savingThrowAbility?.toUpperCase()} modifier</span><input type="number" min="-30" max="30" step="1" value={npcModifiers[targetId] ?? ''} onChange={(event) => setNpcModifiers({ ...npcModifiers, [targetId]: event.target.value })} placeholder="Not configured" /></label> : null })}</div>}
      {unprepared && <p className="combat-condition-rules warning">Class-specific preparation rules are not represented. This spell is not marked prepared; confirm eligibility with the DM.</p>}
      {spell && <div className="combat-spell-override"><label><input type="checkbox" checked={dmOverride} onChange={(event) => setDmOverride(event.target.checked)} /><span>Explicit DM adjudication / override</span></label>{(unprepared || spell.castingTimeCategory === 'special' || targets.some((id) => npcModifiers[id]?.trim()) || dmOverride) && <input maxLength={500} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Reason required to proceed" aria-label="DM override reason" />}</div>}
      <button type="button" className="combat-primary-button" disabled={saving || loading || !spell || !casterId || !spellId || !targets.length || !castingEventId || resolutionType === 'none' || !spellData?.enabled || !spellData.ability} onClick={() => void resolve()}>{saving ? 'Resolving…' : `✧ Resolve ${resolutionType === 'save' ? 'saving throws' : 'spell attack'}`}</button>
    </div>}
    <div className="combat-spell-history"><div className="combat-attack-history-heading"><h4>Recent casting events</h4><span>{castingHistory.length} saved</span></div>{castingHistory.length === 0 ? <p className="combat-muted">Committed spell casts will appear here.</p> : castingHistory.map((entry) => { const resolved = history.some((resolution) => resolution.castingEventId === entry.id); return <article className="combat-spell-event" key={entry.id}><header><strong>{entry.casterName} · {entry.spellName}</strong><span>{entry.status === 'awaiting_adjudication' ? 'Awaiting adjudication' : resolved ? 'Cast · resolved' : 'Cast · unresolved'}</span></header><p>{entry.castLevel === 0 ? 'Cantrip' : `Cast at level ${entry.castLevel}`}{entry.slotLevel ? ` · Level ${entry.slotLevel} slot spent` : ' · no slot spent'}{entry.actionResource ? ` · ${entry.actionResource} spent` : ''}</p>{entry.dmOverride && <p className="combat-condition-rules warning">DM adjudication: {entry.overrideReason}</p>}<time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></article> })}</div>
    <div className="combat-spell-history"><div className="combat-attack-history-heading"><h4>Recent spell resolutions</h4><span>{loading ? 'Loading…' : `${history.length} saved`}</span></div>{history.length === 0 ? <p className="combat-muted">Spell attacks and saving throws for this encounter will appear here.</p> : history.map((entry) => <article className="combat-spell-event" key={entry.id}><header><strong>{entry.casterName} · {entry.spellName}</strong><span>{entry.resolutionType === 'attack' ? `Requested ${entry.manualMode}` : 'Saving throw'}</span></header>{entry.results.map((result) => <div className="combat-spell-result" key={result.targetId}><div><strong>{result.targetName}</strong><b className={result.outcome}>{result.outcome.replaceAll('_', ' ')}</b>{result.total !== null && <b className="combat-spell-total">{result.total}</b>}</div><p>{result.breakdown}{result.targetAC !== undefined ? ` · AC ${result.targetAC}` : ''}{result.dc !== undefined ? ` · DC ${result.dc}` : ''}</p>{result.resolutionType === 'attack' && <p>Requested {result.manualMode}; final {result.finalMode} · spell attack {signed(result.spellAttackBonus ?? 0)} · Exhaustion {signed(result.exhaustionPenalty)}</p>}{result.diceResults.length > 0 && <p>Raw d20: {result.diceResults.map((die, index) => `${die}${index === result.keptIndex ? ' (kept)' : ''}`).join(' / ')}</p>}{result.advantageSources?.length ? <p>Advantage: {result.advantageSources.join(', ')}</p> : null}{result.disadvantageSources?.length ? <p>Disadvantage: {result.disadvantageSources.join(', ')}</p> : null}{result.automaticFailureConditions?.length ? <p>Automatic failure from: {result.automaticFailureConditions.join(', ')}</p> : null}{result.conditionWarnings.map((warning) => <p className="combat-condition-rules warning" key={warning}>{warning}</p>)}{result.dmOverride && <p className="combat-condition-rules warning">DM override: {result.overrideReason}</p>}</div>)}<time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></article>)}</div>
  </section>
}
