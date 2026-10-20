import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ABILITIES } from './characterRules'
import { deriveSpellcastingBonuses } from './spellRules'
import './Spellcasting.css'

const API = 'http://localhost:3001/api'
type Spell = { id: string; name: string; level: number; school: string; castingTime: string; castingTimeCategory?: 'action' | 'bonus_action' | 'reaction' | 'special'; range: string; components: string[]; materialDetails: string; duration: string; concentration: boolean; ritual: boolean; description: string; sourceVersion: string; resolutionType?: 'none' | 'attack' | 'save'; savingThrowAbility?: string | null; attackType?: 'melee' | 'ranged' | null; targetGuidance?: string; resolutionNotes?: string; effectType?: 'none' | 'damage' | 'healing'; effectFormula?: string; damageType?: string | null; effectModifier?: number; includeSpellcastingModifier?: boolean; saveSuccessEffect?: 'full' | 'half' | 'none' | null; upcastMode?: 'none' | 'dice' | 'modifier'; upcastDiceCount?: number; upcastDieSize?: number | null; upcastModifier?: number; effectNotes?: string; custom?: boolean; prepared?: boolean; alwaysPrepared?: boolean }
type Character = { id: string; name: string; level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number }
type Player = { playerId: string; displayName: string; characters: Character[] }
type Campaign = { id: string; name: string }
type Bundle = { config: { enabled: boolean; ability: 'int' | 'wis' | 'cha' | null; notes: string; spellAttackBonus: number | null; spellSaveDc: number | null; warning: string | null }; spells: Spell[]; slots: { level: number; maximum: number; remaining: number; expended: number }[] }
type CustomForm = { name: string; level: string; school: string; castingTime: string; castingTimeCategory: 'action' | 'bonus_action' | 'reaction' | 'special'; range: string; components: string[]; materialDetails: string; duration: string; concentration: boolean; ritual: boolean; description: string; resolutionType: 'none' | 'attack' | 'save'; savingThrowAbility: string; attackType: string; targetGuidance: string; resolutionNotes: string; effectType: 'none' | 'damage' | 'healing'; effectFormula: string; damageType: string; effectModifier: string; includeSpellcastingModifier: boolean; saveSuccessEffect: string; upcastMode: 'none' | 'dice' | 'modifier'; upcastDiceCount: string; upcastDieSize: string; upcastModifier: string; effectNotes: string }
const emptyCustom: CustomForm = { name: '', level: '1', school: 'Evocation', castingTime: 'Action', castingTimeCategory: 'special', range: '60 feet', components: ['V', 'S'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: '', resolutionType: 'none', savingThrowAbility: '', attackType: '', targetGuidance: '', resolutionNotes: '', effectType: 'none', effectFormula: '', damageType: '', effectModifier: '0', includeSpellcastingModifier: false, saveSuccessEffect: '', upcastMode: 'none', upcastDiceCount: '0', upcastDieSize: '', upcastModifier: '0', effectNotes: '' }
const schools = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation']

async function json<T>(response: Response): Promise<T & { error?: string; fields?: Record<string, string> }> { return await response.json() as T & { error?: string; fields?: Record<string, string> } }

export default function Spellcasting({ campaigns }: { campaigns: Campaign[] }) {
  const [campaignId, setCampaignId] = useState('')
  const [players, setPlayers] = useState<Player[]>([])
  const [playerId, setPlayerId] = useState('')
  const [characterId, setCharacterId] = useState('')
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [library, setLibrary] = useState<Spell[]>([])
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [schoolFilter, setSchoolFilter] = useState('')
  const [config, setConfig] = useState<Bundle['config']>({ enabled: false, ability: null, notes: '', spellAttackBonus: null, spellSaveDc: null, warning: null })
  const [slotMaximums, setSlotMaximums] = useState<Record<number, string>>({})
  const [slotRemaining, setSlotRemaining] = useState<Record<number, string>>({})
  const [custom, setCustom] = useState<CustomForm>(emptyCustom)
  const [customOpen, setCustomOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedPlayer = players.find((player) => player.playerId === playerId)
  const selectedCharacter = selectedPlayer?.characters.find((character) => character.id === characterId)
  const derived = selectedCharacter ? deriveSpellcastingBonuses({ enabled: config.enabled, ability: config.ability, level: selectedCharacter.level, scores: selectedCharacter }) : null
  const base = campaignId && playerId && characterId ? `${API}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}` : ''

  useEffect(() => {
    if (!campaignId) { setPlayers([]); setPlayerId(''); setCharacterId(''); return }
    let cancelled = false
    async function loadRoster() {
      setLoading(true); setError('')
      try {
        const response = await fetch(`${API}/campaigns/${campaignId}/players`)
        const payload = await json<{ players?: Omit<Player, 'characters'>[] }>(response)
        if (!response.ok) throw new Error(payload.error || 'Could not load campaign players.')
        const roster = await Promise.all((payload.players ?? []).map(async (player) => {
          const charsResponse = await fetch(`${API}/campaigns/${campaignId}/players/${player.playerId}/characters`)
          const chars = await json<{ characters?: Character[] }>(charsResponse)
          if (!charsResponse.ok) throw new Error(chars.error || `Could not load ${player.displayName}’s characters.`)
          return { ...player, characters: chars.characters ?? [] }
        }))
        if (!cancelled) { setPlayers(roster); setPlayerId(''); setCharacterId('') }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load roster.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void loadRoster()
    return () => { cancelled = true }
  }, [campaignId])

  async function refresh() {
    if (!base) return
    setLoading(true); setError('')
    try {
      const [bundleResponse, libraryResponse] = await Promise.all([fetch(`${base}/spellcasting`), fetch(`${base}/spell-library` + new URLSearchParams({ ...(search ? { search } : {}), ...(levelFilter ? { level: levelFilter } : {}), ...(schoolFilter ? { school: schoolFilter } : {}) }).toString().replace(/^/, '?'))])
      const [nextBundle, nextLibrary] = await Promise.all([json<Bundle>(bundleResponse), json<{ spells?: Spell[] }>(libraryResponse)])
      if (!bundleResponse.ok) throw new Error(nextBundle.error || 'Could not load spellcasting data.')
      if (!libraryResponse.ok) throw new Error(nextLibrary.error || 'Could not load the spell library.')
      setBundle(nextBundle); setConfig(nextBundle.config); setLibrary(nextLibrary.spells ?? [])
      setSlotMaximums(Object.fromEntries(nextBundle.slots.map((slot) => [slot.level, String(slot.maximum)])))
      setSlotRemaining(Object.fromEntries(nextBundle.slots.map((slot) => [slot.level, String(slot.remaining)])))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load spellcasting data.') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (base) void refresh(); else { setBundle(null); setLibrary([]) } }, [base, search, levelFilter, schoolFilter])
  const bookIds = useMemo(() => new Set(bundle?.spells.map((spell) => spell.id) ?? []), [bundle])

  async function mutate(path: string, method: string, body?: unknown, success?: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const payload = response.status === 204 ? {} : await json<{ error?: string; fields?: Record<string, string> }>(response)
      if (!response.ok) throw new Error([payload.error, ...(payload.fields ? Object.values(payload.fields) : [])].filter(Boolean).join(': ') || `Request failed (${response.status}).`)
      if (success) setNotice(success)
      await refresh()
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Spellcasting update failed.') }
    finally { setBusy(false) }
    return false
  }

  async function saveCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await mutate('/spellbook/custom', 'POST', { ...custom, level: Number(custom.level), effectModifier: Number(custom.effectModifier), upcastDiceCount: Number(custom.upcastDiceCount), upcastDieSize: custom.upcastDieSize ? Number(custom.upcastDieSize) : null, upcastModifier: Number(custom.upcastModifier), damageType: custom.damageType || null, saveSuccessEffect: custom.saveSuccessEffect || null }, `${custom.name.trim()} added to the spellbook.`)
    if (!result) { setCustom(emptyCustom); setCustomOpen(false) }
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await mutate('/spellcasting/config', 'PUT', config, 'Spellcasting configuration saved.')
  }

  async function saveSlot(event: FormEvent<HTMLFormElement>, level: number) {
    event.preventDefault()
    await mutate(`/spell-slots/${level}`, 'PUT', { maximum: Number(slotMaximums[level] ?? 0), remaining: Number(slotRemaining[level] ?? 0) }, `Level ${level} slots saved.`)
  }

  const setSpellPreparation = (spell: Spell, prepared: boolean) => void mutate(`/spellbook/${encodeURIComponent(spell.id)}`, 'PATCH', { prepared }, `${spell.name} ${prepared ? 'prepared' : 'unprepared'}.`)

  return <section className="spellcasting-page" aria-labelledby="spellcasting-heading">
    <div className="eyebrow"><span className="eyebrow-line" />ARCANE RECORDS</div>
    <div className="spellcasting-title"><div><h1 id="spellcasting-heading">Spellcasting</h1><p>Manage a character’s spellbook, preparation, and manually configured slots.</p></div></div>
    <div className="spell-selectors">
      <label><span>Campaign</span><select value={campaignId} onChange={(event) => { setCampaignId(event.target.value); setBundle(null) }}><option value="">Choose a campaign</option>{campaigns.map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select></label>
      <label><span>Player</span><select value={playerId} disabled={!campaignId || loading} onChange={(event) => { setPlayerId(event.target.value); setCharacterId(''); setBundle(null) }}><option value="">Choose a player</option>{players.map((player) => <option value={player.playerId} key={player.playerId}>{player.displayName}</option>)}</select></label>
      <label><span>Character</span><select value={characterId} disabled={!playerId} onChange={(event) => { setCharacterId(event.target.value); setBundle(null) }}><option value="">Choose a character</option>{selectedPlayer?.characters.map((character) => <option value={character.id} key={character.id}>{character.name}</option>)}</select></label>
    </div>
    {error && <div className="spell-feedback error" role="alert">{error}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {notice && <div className="spell-feedback success" role="status">✦ {notice}</div>}
    {loading && <div className="spell-empty">Loading arcane records…</div>}
    {!campaignId && !loading && <div className="spell-empty"><span>✧</span><h2>Choose a campaign to begin</h2><p>Select a campaign, player, and character to view their spellcasting records.</p></div>}
    {campaignId && !loading && players.length === 0 && !error && <div className="spell-empty"><span>♙</span><h2>No players in this campaign</h2><p>Add a player and character from the campaign roster first.</p></div>}
    {base && selectedCharacter && bundle && <>
      <section className="spell-panel spell-overview" aria-labelledby="spell-overview-heading"><div className="spell-panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />SPELLCASTING OVERVIEW</div><h2 id="spell-overview-heading">{selectedCharacter.name}</h2><p>Level {selectedCharacter.level} · {selectedPlayer?.displayName}</p></div><span className="spell-level-tag">{config.enabled ? 'Enabled' : 'Disabled'}</span></div>
        <form className="spell-config-form" onSubmit={(event) => void saveConfig(event)}>
          <label className="spell-toggle"><input type="checkbox" checked={config.enabled} onChange={(event) => setConfig({ ...config, enabled: event.target.checked })} /><span>Spellcasting enabled</span></label>
          <label><span>Spellcasting ability</span><select value={config.ability ?? ''} onChange={(event) => setConfig({ ...config, ability: (event.target.value || null) as Bundle['config']['ability'] })}><option value="">Not configured</option>{ABILITIES.filter(({ key }) => ['int', 'wis', 'cha'].includes(key)).map(({ key, name }) => <option value={key} key={key}>{name}</option>)}</select></label>
          <label><span>Notes</span><input maxLength={1000} value={config.notes} onChange={(event) => setConfig({ ...config, notes: event.target.value })} placeholder="Optional class or source notes" /></label>
          <div className="spell-derived"><div><span>Spell attack bonus</span><strong>{derived?.spellAttackBonus === null || !derived ? '—' : `${derived.spellAttackBonus >= 0 ? '+' : ''}${derived.spellAttackBonus}`}</strong></div><div><span>Spell save DC</span><strong>{derived?.spellSaveDc ?? '—'}</strong></div></div>
          {config.warning && <p className="spell-warning" role="status">{config.warning}</p>}
          <button className="section-create-button" type="submit" disabled={busy}>Save configuration</button>
        </form>
      </section>

      <section className="spell-panel" aria-labelledby="spellbook-heading"><div className="spell-panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />KNOWN & PREPARED</div><h2 id="spellbook-heading">Spellbook</h2></div><span className="spell-level-tag">{bundle.spells.length} spells</span></div>
        {bundle.spells.length === 0 ? <p className="spell-empty-inline">No spells in this spellbook yet. Search the library below to add one.</p> : <div className="spellbook-levels">{Array.from({ length: 10 }, (_, level) => ({ level, spells: bundle.spells.filter((spell) => spell.level === level) })).filter(({ spells }) => spells.length > 0).map(({ level, spells }) => <section className="spell-level-group" key={level}><h3>{level === 0 ? 'Cantrips' : `Level ${level}`}</h3>{spells.map((spell) => <article className="spell-entry" key={spell.id}><div className="spell-entry-copy"><div className="spell-entry-title"><h4>{spell.name}</h4><span>{spell.school}</span>{spell.custom && <em>Custom</em>}</div><p>{spell.description}</p><small>{spell.castingTime} · {spell.range} · {spell.components.join(', ') || 'No components'} · {spell.duration}{spell.concentration ? ' · Concentration' : ''}{spell.ritual ? ' · Ritual' : ''}</small><small>Resolution: {spell.resolutionType === 'attack' ? `${spell.attackType} spell attack` : spell.resolutionType === 'save' ? `${spell.savingThrowAbility?.toUpperCase()} saving throw` : 'No automated roll type'}{spell.targetGuidance ? ` · ${spell.targetGuidance}` : ''}</small><small>Effect: {spell.effectType === 'damage' || spell.effectType === 'healing' ? `${spell.effectType} ${spell.effectFormula}${spell.damageType ? ` ${spell.damageType}` : ''}` : 'No automated damage or healing'}{spell.upcastMode && spell.upcastMode !== 'none' ? ` · upcast ${spell.upcastMode}` : ''}</small><small className="spell-source">Source: {spell.sourceVersion}</small></div><div className="spell-entry-actions"><label className="spell-toggle"><input type="checkbox" checked={Boolean(spell.prepared || spell.alwaysPrepared)} disabled={Boolean(spell.alwaysPrepared) || busy} onChange={(event) => setSpellPreparation(spell, event.target.checked)} /><span>{spell.alwaysPrepared ? 'Always prepared' : 'Prepared'}</span></label><button type="button" className="text-button" disabled={busy} onClick={() => void mutate(`/spellbook/${encodeURIComponent(spell.id)}`, 'DELETE', undefined, `${spell.name} removed.`)}>Remove</button></div></article>)}</section>)}</div>}
      </section>

      <section className="spell-panel" aria-labelledby="slots-heading"><div className="spell-panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />RESOURCE TRACKING</div><h2 id="slots-heading">Spell Slots</h2><p>Maximums are configured manually; rests do not restore slots automatically.</p></div><button type="button" className="text-button" disabled={busy || bundle.slots.length === 0} onClick={() => void mutate('/spell-slots/restore-all', 'POST', undefined, 'All configured slots restored.')}>Restore all</button></div>
        <div className="spell-slots-grid">{Array.from({ length: 9 }, (_, index) => index + 1).map((level) => { const slot = bundle.slots.find((entry) => entry.level === level); return <form className="spell-slot-card" key={level} onSubmit={(event) => void saveSlot(event, level)}><strong>Level {level}</strong><label><span>Maximum</span><input type="number" min="0" max="99" step="1" value={slotMaximums[level] ?? '0'} onChange={(event) => setSlotMaximums({ ...slotMaximums, [level]: event.target.value })} /></label><label><span>Remaining</span><input type="number" min="0" max={slotMaximums[level] ?? 0} step="1" value={slotRemaining[level] ?? '0'} onChange={(event) => setSlotRemaining({ ...slotRemaining, [level]: event.target.value })} /></label><small>{slot ? `${slot.expended} expended of ${slot.maximum}` : 'Not configured'}</small><button type="submit" className="text-button" disabled={busy}>Save</button>{slot && <div className="spell-slot-actions"><button type="button" disabled={busy || slot.remaining === 0} onClick={() => void mutate(`/spell-slots/${level}/expend`, 'POST', undefined, `Level ${level} slot expended.`)}>Expend</button><button type="button" disabled={busy || slot.remaining === slot.maximum} onClick={() => void mutate(`/spell-slots/${level}/restore`, 'POST', undefined, `Level ${level} slot restored.`)}>Restore</button></div>}</form> })}</div>
      </section>

      <section className="spell-panel" aria-labelledby="library-heading"><div className="spell-panel-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />LOCAL CATALOG</div><h2 id="library-heading">Spell Library</h2><p>Original RealmForge starter entries and spells created for this character.</p></div><button type="button" className="section-create-button" onClick={() => setCustomOpen(!customOpen)}>＋ Create custom spell</button></div>
        {customOpen && <form className="custom-spell-form" onSubmit={(event) => void saveCustom(event)}><h3>New custom spell</h3><div className="custom-spell-grid"><label><span>Name</span><input required maxLength={100} value={custom.name} onChange={(event) => setCustom({ ...custom, name: event.target.value })} /></label><label><span>Level</span><select value={custom.level} onChange={(event) => setCustom({ ...custom, level: event.target.value })}>{Array.from({ length: 10 }, (_, level) => <option key={level} value={level}>{level === 0 ? 'Cantrip' : `Level ${level}`}</option>)}</select></label><label><span>School</span><select value={custom.school} onChange={(event) => setCustom({ ...custom, school: event.target.value })}>{schools.map((school) => <option key={school}>{school}</option>)}</select></label><label><span>Casting time</span><input required maxLength={80} value={custom.castingTime} onChange={(event) => setCustom({ ...custom, castingTime: event.target.value })} /></label><label><span>Casting time category</span><select value={custom.castingTimeCategory} onChange={(event) => setCustom({ ...custom, castingTimeCategory: event.target.value as CustomForm["castingTimeCategory"] })}><option value="action">Action</option><option value="bonus_action">Bonus Action</option><option value="reaction">Reaction</option><option value="special">Special / DM adjudication</option></select></label><label><span>Range</span><input required maxLength={80} value={custom.range} onChange={(event) => setCustom({ ...custom, range: event.target.value })} /></label><label><span>Duration</span><input required maxLength={80} value={custom.duration} onChange={(event) => setCustom({ ...custom, duration: event.target.value })} /></label><label className="custom-wide"><span>Description</span><textarea required maxLength={3000} rows={3} value={custom.description} onChange={(event) => setCustom({ ...custom, description: event.target.value })} /></label><label><span>Material details</span><input maxLength={300} value={custom.materialDetails} onChange={(event) => setCustom({ ...custom, materialDetails: event.target.value })} /></label><fieldset className="custom-components"><legend>Components</legend>{['V', 'S', 'M'].map((part) => <label key={part}><input type="checkbox" checked={custom.components.includes(part)} onChange={() => setCustom({ ...custom, components: custom.components.includes(part) ? custom.components.filter((value) => value !== part) : [...custom.components, part] })} />{part}</label>)}</fieldset><label className="spell-toggle"><input type="checkbox" checked={custom.concentration} onChange={(event) => setCustom({ ...custom, concentration: event.target.checked })} /><span>Concentration</span></label><label className="spell-toggle"><input type="checkbox" checked={custom.ritual} onChange={(event) => setCustom({ ...custom, ritual: event.target.checked })} /><span>Ritual</span></label>
          <label><span>Resolution type</span><select value={custom.resolutionType} onChange={(event) => setCustom({ ...custom, resolutionType: event.target.value as CustomForm['resolutionType'], savingThrowAbility: '', attackType: '', saveSuccessEffect: '' })}><option value="none">None · manual adjudication</option><option value="attack">Spell attack</option><option value="save">Target saving throw</option></select></label>
          {custom.resolutionType === 'attack' && <label><span>Attack type</span><select required value={custom.attackType} onChange={(event) => setCustom({ ...custom, attackType: event.target.value })}><option value="">Choose type</option><option value="melee">Melee spell attack</option><option value="ranged">Ranged spell attack</option></select></label>}
          {custom.resolutionType === 'save' && <label><span>Saving throw ability</span><select required value={custom.savingThrowAbility} onChange={(event) => setCustom({ ...custom, savingThrowAbility: event.target.value })}><option value="">Choose ability</option>{ABILITIES.map(({ key, name }) => <option value={key} key={key}>{name}</option>)}</select></label>}
          <label><span>Effect type</span><select value={custom.effectType} onChange={(event) => setCustom({ ...custom, effectType: event.target.value as CustomForm['effectType'], effectFormula: event.target.value === 'none' ? '' : custom.effectFormula, damageType: event.target.value === 'damage' ? custom.damageType : '', effectModifier: event.target.value === 'none' ? '0' : custom.effectModifier, includeSpellcastingModifier: event.target.value === 'none' ? false : custom.includeSpellcastingModifier, saveSuccessEffect: event.target.value === 'none' ? '' : custom.saveSuccessEffect, upcastMode: event.target.value === 'none' ? 'none' : custom.upcastMode, upcastDiceCount: event.target.value === 'none' ? '0' : custom.upcastDiceCount, upcastDieSize: event.target.value === 'none' ? '' : custom.upcastDieSize, upcastModifier: event.target.value === 'none' ? '0' : custom.upcastModifier })}><option value="none">None · manual adjudication</option><option value="damage">Damage</option><option value="healing">Healing</option></select></label>
          {custom.effectType !== 'none' && <>
            <label><span>Base formula</span><input required maxLength={40} value={custom.effectFormula} onChange={(event) => setCustom({ ...custom, effectFormula: event.target.value })} placeholder="1d8+3" /></label>
            <label><span>Fixed modifier</span><input type="number" min="-100" max="100" step="1" value={custom.effectModifier} onChange={(event) => setCustom({ ...custom, effectModifier: event.target.value })} /></label>
            {custom.effectType === 'damage' && <label><span>Damage type</span><select required value={custom.damageType} onChange={(event) => setCustom({ ...custom, damageType: event.target.value })}><option value="">Choose type</option>{['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
            <label className="spell-toggle"><input type="checkbox" checked={custom.includeSpellcastingModifier} onChange={(event) => setCustom({ ...custom, includeSpellcastingModifier: event.target.checked })} /><span>Add spellcasting ability modifier</span></label>
            {custom.resolutionType === 'save' && <label><span>Effect on successful save</span><select required value={custom.saveSuccessEffect} onChange={(event) => setCustom({ ...custom, saveSuccessEffect: event.target.value })}><option value="">Choose explicitly</option><option value="full">Full effect</option><option value="half">Half effect (round down)</option><option value="none">No effect</option></select></label>}
            <label><span>Upcasting</span><select value={custom.upcastMode} onChange={(event) => setCustom({ ...custom, upcastMode: event.target.value as CustomForm['upcastMode'], upcastDiceCount: event.target.value === 'dice' ? '1' : '0', upcastDieSize: event.target.value === 'dice' ? custom.effectFormula.match(/d(4|6|8|10|12|20)/i)?.[1] ?? '' : '', upcastModifier: event.target.value === 'modifier' ? '1' : '0' })}><option value="none">No upcasting benefit</option><option value="dice">Additional dice per level</option><option value="modifier">Additional modifier per level</option></select></label>
            {custom.upcastMode === 'dice' && <><label><span>Additional dice per level</span><input type="number" min="1" max="20" step="1" value={custom.upcastDiceCount} onChange={(event) => setCustom({ ...custom, upcastDiceCount: event.target.value })} /></label><label><span>Additional die size</span><select required value={custom.upcastDieSize} onChange={(event) => setCustom({ ...custom, upcastDieSize: event.target.value })}><option value="">Choose size</option>{[4, 6, 8, 10, 12, 20].map((size) => <option key={size} value={size}>d{size}</option>)}</select></label></>}
            {custom.upcastMode === 'modifier' && <label><span>Additional modifier per level</span><input type="number" min="-100" max="100" step="1" required value={custom.upcastModifier} onChange={(event) => setCustom({ ...custom, upcastModifier: event.target.value })} /></label>}
            <label className="custom-wide"><span>Effect notes <small>optional · explicit rules context only</small></span><input maxLength={500} value={custom.effectNotes} onChange={(event) => setCustom({ ...custom, effectNotes: event.target.value })} /></label>
          </>}
          <label><span>Target guidance <small>optional · descriptive only</small></span><input maxLength={300} value={custom.targetGuidance} onChange={(event) => setCustom({ ...custom, targetGuidance: event.target.value })} placeholder="For example, one creature you can see" /></label>
          <label className="custom-wide"><span>Resolution notes <small>optional · do not include unverified rules</small></span><input maxLength={500} value={custom.resolutionNotes} onChange={(event) => setCustom({ ...custom, resolutionNotes: event.target.value })} /></label>
        </div><div className="inline-actions"><button type="button" className="cancel-button" onClick={() => setCustomOpen(false)}>Cancel</button><button type="submit" className="section-create-button" disabled={busy}>Create and add</button></div></form>}
        <div className="spell-library-filters"><label><span>Search name</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search available spells" /></label><label><span>Level</span><select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="">All levels</option>{Array.from({ length: 10 }, (_, level) => <option key={level} value={level}>{level === 0 ? 'Cantrip' : `Level ${level}`}</option>)}</select></label><label><span>School</span><select value={schoolFilter} onChange={(event) => setSchoolFilter(event.target.value)}><option value="">All schools</option>{schools.map((school) => <option key={school}>{school}</option>)}</select></label></div>
        {library.length === 0 ? <p className="spell-empty-inline">No matching spells found.</p> : <div className="spell-library-grid">{library.map((spell) => <article className="spell-library-card" key={spell.id}><div className="spell-entry-title"><span className="spell-level-tag">{spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`}</span><span>{spell.school}</span>{spell.custom && <em>Custom</em>}</div><h3>{spell.name}</h3><p>{spell.description}</p><small>{spell.castingTime} · {spell.range} · {spell.duration}</small><button type="button" className="text-button" disabled={busy || bookIds.has(spell.id)} onClick={() => void mutate('/spellbook', 'POST', { spellId: spell.id }, `${spell.name} added to the spellbook.`)}>{bookIds.has(spell.id) ? 'In spellbook' : '＋ Add to spellbook'}</button></article>)}</div>}
        <p className="spell-license-note">Starter entries are original RealmForge content released under CC0-1.0. They are not official D&amp;D spell descriptions or a complete 2024 rules catalog. Custom spells are local to this character.</p>
      </section>
    </>}
  </section>
}
