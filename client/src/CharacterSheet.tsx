import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ABILITIES, SKILLS, abilityModifier, proficiencyBonus, savingThrowBonus, skillBonus, type AbilityKey } from './characterRules'
import { WEAPON_DEFINITIONS, calculateArmorClass, calculateWeaponAttackBonus } from './combatStats'
import { compatibleEquipmentSlots, equipmentSlotLabels, type EquipmentSlot } from './equipment'
import './CharacterSheet.css'

const API_URL = 'http://localhost:3001/api'
type CharacterStatus = 'active' | 'prepared' | 'dead' | 'retired'

interface SheetInventoryItem {
  id: string
  name: string
  category: string
  quantity: number
  equipped: boolean
  equipmentSlot: EquipmentSlot | null
  armorDefinitionId: string | null
  weaponDefinitionId: string | null
  weaponAbility: AbilityKey | null
  manualAttackBonus: number | null
}

interface EquipmentConflict {
  itemId: string
  slot: EquipmentSlot
  conflict: SheetInventoryItem
}

export interface SheetCharacter {
  id: string
  name: string
  species: string
  characterClass: string
  level: number
  str: number
  dex: number
  con: number
  int: number
  wis: number
  cha: number
  status: CharacterStatus
  createdAt: string
  updatedAt: string
  savingThrowProficiencies: string[]
  skillProficiencies: string[]
  weaponProficiencies: string[]
  manualAcOverride: number | null
}

interface Props {
  campaignId: string
  playerId: string
  characterId: string
  onClose: () => void
  onSaved: (character: SheetCharacter) => void
}

type FormState = { level: string; scores: Record<AbilityKey, string>; manualAcOverride: string }
const abilityKeys = ABILITIES.map(({ key }) => key)

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`
}

export default function CharacterSheet({ campaignId, playerId, characterId, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [sheet, setSheet] = useState<SheetCharacter | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saves, setSaves] = useState<string[]>([])
  const [skills, setSkills] = useState<string[]>([])
  const [weaponProficiencies, setWeaponProficiencies] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inventoryItems, setInventoryItems] = useState<SheetInventoryItem[]>([])
  const [equipmentError, setEquipmentError] = useState('')
  const [equipmentNotice, setEquipmentNotice] = useState('')
  const [equipmentSelections, setEquipmentSelections] = useState<Record<string, EquipmentSlot>>({})
  const [equipmentConflict, setEquipmentConflict] = useState<EquipmentConflict | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    closeButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
    }
  }, [])

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/sheet`)
        const payload = await response.json() as { sheet?: SheetCharacter; error?: string }
        if (!response.ok || !payload.sheet) throw new Error(payload.error || 'Could not load the character sheet.')
        if (cancelled) return
        setSheet(payload.sheet)
        setForm({ level: String(payload.sheet.level), scores: Object.fromEntries(
          abilityKeys.map((key) => [key, String(payload.sheet![key])]),
        ) as Record<AbilityKey, string>, manualAcOverride: payload.sheet.manualAcOverride === null ? '' : String(payload.sheet.manualAcOverride) })
        setSaves(payload.sheet.savingThrowProficiencies)
        setSkills(payload.sheet.skillProficiencies)
        setWeaponProficiencies(payload.sheet.weaponProficiencies ?? [])
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the character sheet.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [campaignId, playerId, characterId])

  useEffect(() => {
    let cancelled = false
    async function loadInventory() {
      try {
        const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory`)
        const payload = await response.json() as { items?: SheetInventoryItem[]; error?: string }
        if (!response.ok) throw new Error(payload.error || 'Could not load character equipment.')
        if (!cancelled) setInventoryItems(payload.items ?? [])
      } catch (cause) {
        if (!cancelled) setEquipmentError(cause instanceof Error ? cause.message : 'Could not load character equipment.')
      }
    }
    void loadInventory()
    return () => { cancelled = true }
  }, [campaignId, playerId, characterId])

  async function refreshInventory() {
    const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory`)
    const payload = await response.json() as { items?: SheetInventoryItem[]; error?: string }
    if (!response.ok) throw new Error(payload.error || 'Could not refresh character equipment.')
    setInventoryItems(payload.items ?? [])
  }

  async function assignEquipment(itemId: string, slot: EquipmentSlot, replace = false) {
    setEquipmentError('')
    setEquipmentNotice('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory/${itemId}/equip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot, replace }),
      })
      const payload = await response.json() as { item?: SheetInventoryItem; conflict?: SheetInventoryItem; error?: string }
      if (response.status === 409 && payload.conflict) {
        setEquipmentConflict({ itemId, slot, conflict: payload.conflict })
        return
      }
      if (!response.ok) throw new Error(payload.error || 'Could not equip this item.')
      setEquipmentConflict(null)
      setEquipmentNotice(`${inventoryItems.find((item) => item.id === itemId)?.name ?? 'Item'} equipped in ${equipmentSlotLabels[slot]}.`)
      await refreshInventory()
    } catch (cause) {
      setEquipmentError(cause instanceof Error ? cause.message : 'Could not equip this item.')
    }
  }

  async function unequipItem(item: SheetInventoryItem) {
    setEquipmentError('')
    setEquipmentNotice('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory/${item.id}/unequip`, { method: 'POST' })
      const payload = await response.json() as { item?: SheetInventoryItem; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not unequip this item.')
      setEquipmentConflict(null)
      setEquipmentNotice(`${item.name} moved back to the pack.`)
      await refreshInventory()
    } catch (cause) {
      setEquipmentError(cause instanceof Error ? cause.message : 'Could not unequip this item.')
    }
  }

  const toggle = (key: string, values: string[], update: (items: string[]) => void) => {
    update(values.includes(key) ? values.filter((value) => value !== key) : [...values, key])
  }

  const activeArmor = inventoryItems.find((item) => item.equipmentSlot === 'armor' && item.category === 'armor')
  const shieldEquipped = inventoryItems.some((item) => item.equipmentSlot === 'shield' && item.category === 'shield')
  let armorClass: ReturnType<typeof calculateArmorClass> | null = null
  if (form) {
    try {
      armorClass = calculateArmorClass({
        dexterityScore: Number(form.scores.dex),
        armorEquipped: Boolean(activeArmor), armorDefinitionId: activeArmor?.armorDefinitionId ?? null,
        shieldEquipped, manualOverride: form.manualAcOverride.trim() === '' ? null : Number(form.manualAcOverride),
      })
    } catch { armorClass = { configured: false, value: null, source: 'unconfigured', breakdown: 'Enter valid Dexterity and manual AC values.' } }
  }
  const equippedWeaponAttacks = inventoryItems
    .filter((item) => item.category === 'weapon' && (item.equipmentSlot === 'main_hand' || item.equipmentSlot === 'off_hand'))
    .map((item) => {
      try {
        return { item, result: calculateWeaponAttackBonus({
          abilityScores: form ? Object.fromEntries(abilityKeys.map((key) => [key, Number(form.scores[key])])) as Record<AbilityKey, number> : { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          level: Number(form?.level) || 1, weaponDefinitionId: item.weaponDefinitionId, weaponAbility: item.weaponAbility,
          proficient: Boolean(item.weaponDefinitionId && weaponProficiencies.includes(item.weaponDefinitionId)),
          manualOverride: item.manualAttackBonus,
        }) }
      } catch { return { item, result: null } }
    })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/sheet`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: Number(form.level), abilityScores: Object.fromEntries(
          abilityKeys.map((key) => [key, Number(form.scores[key])]),
        ), savingThrowProficiencies: saves, skillProficiencies: skills, weaponProficiencies,
        manualAcOverride: form.manualAcOverride.trim() === '' ? null : Number(form.manualAcOverride) }),
      })
      const payload = await response.json() as { sheet?: SheetCharacter; error?: string; fields?: Record<string, string> }
      if (!response.ok || !payload.sheet) {
        const details = payload.fields ? Object.values(payload.fields).join(' ') : ''
        throw new Error([payload.error, details].filter(Boolean).join(': ') || 'Could not save the character sheet.')
      }
      setSheet(payload.sheet)
      setNotice('Character sheet saved.')
      onSaved(payload.sheet)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the character sheet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    createPortal(
      <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section className="sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="character-sheet-title" ref={dialogRef} onKeyDown={handleDialogKeyDown}>
          <header className="sheet-dialog-header">
            <div><div className="sheet-eyebrow">CHARACTER SHEET</div><h2 id="character-sheet-title">{sheet?.name ?? 'Character sheet'}</h2></div>
            {sheet && form && <div className="sheet-proficiency"><span>PROFICIENCY BONUS</span><strong>{signed(proficiencyBonus(Number(form.level) || 1))}</strong></div>}
            <button ref={closeButtonRef} className="sheet-close" type="button" aria-label="Close character sheet" onClick={onClose}>×</button>
          </header>
          <div className="sheet-dialog-content">
            {loading ? <p className="sheet-message">Unfurling the character sheet…</p> : error && !sheet ? <div className="sheet-error" role="alert">{error}</div> : sheet && form ? (
              <form className="sheet-form" onSubmit={(event) => void submit(event)}>
                {error && <div className="sheet-error" role="alert">{error}</div>}
                {notice && <div className="sheet-notice" role="status">✦ {notice}</div>}
                <div className="sheet-stats">
                  <label className="sheet-level">Level<input type="number" min="1" max="20" step="1" value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })} /></label>
                  {ABILITIES.map(({ key, name }) => {
                    const score = Number(form.scores[key])
                    let modifier = '—'
                    try { modifier = signed(abilityModifier(score)) } catch { /* Invalid edits remain editable until save. */ }
                    return <label className="sheet-ability" key={key}><span>{name}</span><strong>{modifier}</strong><input aria-label={`${name} score`} type="number" min="1" max="30" step="1" value={form.scores[key]} onChange={(event) => setForm({ ...form, scores: { ...form.scores, [key]: event.target.value } })} /></label>
                  })}
                </div>
                <section className="sheet-combat-statistics" aria-labelledby="sheet-combat-statistics-title">
                  <div className="sheet-equipment-heading"><div><div className="sheet-eyebrow">DEFENSE & WEAPON SKILL</div><h3 id="sheet-combat-statistics-title">Combat Statistics</h3></div></div>
                  <div className="sheet-ac-summary"><div><span>ARMOR CLASS</span><strong>{armorClass?.configured ? armorClass.value : 'Not configured'}</strong><small>{armorClass?.breakdown ?? 'Calculating…'}</small></div><label className="sheet-manual-ac">Manual AC override <span>optional</span><input type="number" min="1" max="50" step="1" value={form.manualAcOverride} onChange={(event) => setForm({ ...form, manualAcOverride: event.target.value })} placeholder="Use calculated AC" /></label></div>
                  <div className="sheet-equipped-attacks"><h4>Equipped weapon attacks</h4>{equippedWeaponAttacks.length === 0 ? <p>No equipped weapons.</p> : equippedWeaponAttacks.map(({ item, result }) => <div className="sheet-attack-row" key={item.id}><strong>{item.name}<small>{item.equipmentSlot === 'main_hand' ? 'Main hand' : 'Off hand'}</small></strong>{result?.configured ? <span className={result.source === 'manual' ? 'manual-value' : ''}>{result.ability ? `${result.ability.toUpperCase()} ${signed(result.abilityModifier ?? 0)} · ${result.proficiencyContribution ? `Proficiency +${result.proficiencyContribution}` : 'No proficiency'}` : 'Manual override'} · <b>{signed(result.total ?? 0)}</b>{result.source === 'manual' && <em>Manual override</em>}</span> : <span>Not configured</span>}</div>)}</div>
                  <fieldset className="sheet-check-list sheet-weapon-proficiencies"><legend>Weapon Proficiencies</legend><p>Select the weapons this character is proficient with.</p><div>{WEAPON_DEFINITIONS.map((weapon) => <label className="sheet-check-row" key={weapon.id}><input type="checkbox" checked={weaponProficiencies.includes(weapon.id)} onChange={() => toggle(weapon.id, weaponProficiencies, setWeaponProficiencies)} /><span>{weapon.name}</span><small>{weapon.finesse ? 'Finesse' : weapon.attackAbility.toUpperCase()}</small></label>)}</div></fieldset>
                </section>
                <div className="sheet-lists">
                  <fieldset className="sheet-check-list">
                    <legend>Saving Throws</legend>
                    {ABILITIES.map(({ key, name }) => {
                      const proficient = saves.includes(key)
                      const bonus = savingThrowBonus(Number(form.scores[key]) || 10, Number(form.level) || 1, proficient)
                      return <label className="sheet-check-row" key={key}><input type="checkbox" checked={proficient} onChange={() => toggle(key, saves, setSaves)} /><span>{name}</span><small>{signed(bonus)}</small></label>
                    })}
                  </fieldset>
                  <fieldset className="sheet-check-list skills-list">
                    <legend>Skills</legend>
                    {SKILLS.map(({ key, name, ability }) => {
                      const proficient = skills.includes(key)
                      const bonus = skillBonus(Number(form.scores[ability]), Number(form.level) || 1, proficient)
                      return <label className="sheet-check-row" key={key}><input type="checkbox" checked={proficient} onChange={() => toggle(key, skills, setSkills)} /><span>{name}<em>{ability.toUpperCase()}</em></span><small>{signed(bonus)}</small></label>
                    })}
                  </fieldset>
                </div>
                <section className="sheet-equipment" aria-labelledby="sheet-equipment-heading">
                  <div className="sheet-equipment-heading"><div><div className="sheet-eyebrow">PACK & EQUIPMENT</div><h3 id="sheet-equipment-heading">Equipment</h3></div></div>
                  {equipmentError && <div className="sheet-error" role="alert">{equipmentError}<button type="button" className="sheet-inline-link" onClick={() => void refreshInventory()}>Retry</button></div>}
                  {equipmentNotice && <div className="sheet-notice" role="status">✦ {equipmentNotice}</div>}
                  {inventoryItems.length === 0 ? <p className="sheet-equipment-empty">No inventory items yet. Add items from the Inventory destination.</p> : <div className="sheet-equipment-list">
                    {inventoryItems.map((item) => {
                      const compatibleSlots = compatibleEquipmentSlots(item.category)
                      const selectedSlot = equipmentSelections[item.id] ?? compatibleSlots[0]
                      return <div className="sheet-equipment-row" key={item.id}>
                        <div className="sheet-equipment-item"><strong>{item.name}</strong><span>{item.quantity > 1 ? `Quantity ${item.quantity} · ` : ''}{item.equipmentSlot ? equipmentSlotLabels[item.equipmentSlot] : item.equipped ? 'Equipped · slot unassigned' : compatibleSlots.length ? 'Not equipped' : 'No compatible slot in this stage'}</span></div>
                        {item.equipmentSlot ? <button className="sheet-equipment-action secondary" type="button" onClick={() => void unequipItem(item)}>Unequip</button> : compatibleSlots.length > 0 && selectedSlot ? <div className="sheet-equipment-controls"><label><span className="sheet-visually-hidden">Equipment slot for {item.name}</span><select value={selectedSlot} onChange={(event) => setEquipmentSelections({ ...equipmentSelections, [item.id]: event.target.value as EquipmentSlot })}>{compatibleSlots.map((slot) => <option key={slot} value={slot}>{equipmentSlotLabels[slot]}</option>)}</select></label><button className="sheet-equipment-action" type="button" onClick={() => void assignEquipment(item.id, selectedSlot)}>Equip</button></div> : null}
                      </div>
                    })}
                  </div>}
                  {equipmentConflict && <div className="sheet-equipment-conflict" role="alert"><p><strong>{equipmentConflict.conflict.name}</strong> already occupies {equipmentSlotLabels[equipmentConflict.slot]}. Choose whether to keep it there or move it back to the pack.</p><div><button className="sheet-equipment-action secondary" type="button" onClick={() => setEquipmentConflict(null)}>Keep existing</button><button className="sheet-equipment-action" type="button" onClick={() => void assignEquipment(equipmentConflict.itemId, equipmentConflict.slot, true)}>Unequip existing and equip selected</button></div></div>}
                </section>
                <div className="sheet-footer"><span>Checked boxes mark proficiency.</span><button className="section-create-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save sheet'}</button></div>
              </form>
            ) : null}
          </div>
        </section>
      </div>,
      document.body,
    )
  )
}
