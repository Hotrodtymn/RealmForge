import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { rollDice } from './dice'
import { sortCombatants } from './combatRules'
import { calculateArmorClass, calculateWeaponAttackBonus } from './combatStats'
import './Combat.css'

const API_URL = 'http://localhost:3001/api'
const CONDITIONS: { key: ConditionKey; label: string }[] = [
  { key: 'blinded', label: 'Blinded' }, { key: 'charmed', label: 'Charmed' }, { key: 'deafened', label: 'Deafened' },
  { key: 'frightened', label: 'Frightened' }, { key: 'grappled', label: 'Grappled' }, { key: 'incapacitated', label: 'Incapacitated' },
  { key: 'invisible', label: 'Invisible' }, { key: 'paralyzed', label: 'Paralyzed' }, { key: 'petrified', label: 'Petrified' },
  { key: 'poisoned', label: 'Poisoned' }, { key: 'prone', label: 'Prone' }, { key: 'restrained', label: 'Restrained' },
  { key: 'stunned', label: 'Stunned' }, { key: 'unconscious', label: 'Unconscious' }, { key: 'exhaustion', label: 'Exhaustion' },
]

interface Campaign { id: string; name: string }
interface Encounter { id: string; campaignId: string; name: string; status: 'setup' | 'active'; round: number; activeCombatantId: string | null; createdAt: string; updatedAt: string }
type ConditionKey = 'blinded' | 'charmed' | 'deafened' | 'frightened' | 'grappled' | 'incapacitated' | 'invisible' | 'paralyzed' | 'petrified' | 'poisoned' | 'prone' | 'restrained' | 'stunned' | 'unconscious' | 'exhaustion'
interface CombatantCondition { id: string; combatantId: string; condition: ConditionKey; level: number | null; createdAt: string }
interface Combatant { id: string; encounterId: string; characterId: string | null; type: 'player' | 'enemy'; name: string; initiativeModifier: number; initiativeSource: 'rolled' | 'manual' | null; initiativeRoll: number | null; initiativeTotal: number | null; insertionOrder: number; currentHp: number; maxHp: number; armorClassOverride: number | null; attackModifier: number | null; conditions: CombatantCondition[] }
interface Details { encounter: Encounter; combatants: Combatant[] }
interface CharacterOption { id: string; playerId: string; name: string; playerName: string; dex: number; status: string }
interface CombatBuildItem { id: string; name: string; category: string; quantity: number; equipped: boolean; equipmentSlot: string | null; armorDefinitionId: string | null; weaponDefinitionId: string | null; weaponAbility: 'str' | 'dex' | null; manualAttackBonus: number | null }
interface CharacterBuild { level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number; manualAcOverride: number | null; weaponProficiencies: string[]; items: CombatBuildItem[] }
interface ApiError { error?: string; fields?: Record<string, string> }
type AttackMode = 'normal' | 'advantage' | 'disadvantage'
interface AttackRecord { id: string; encounterId: string; attackerId: string; attackerName: string; targetId: string; targetName: string; weaponId: string | null; weaponName: string | null; mode: AttackMode; diceResults: number[]; keptIndex: number; attackBonus: number; situationalModifier: number; total: number; targetAC: number; outcome: 'hit' | 'miss' | 'critical_hit'; isCritical: boolean; breakdown: string; createdAt: string }
interface Props { campaigns: Campaign[] }

async function readPayload<T>(response: Response): Promise<T & ApiError> {
  return await response.json() as T & ApiError
}

function signed(value: number): string { return value >= 0 ? `+${value}` : String(value) }

function PlayerCombatSummary({ build }: { build?: CharacterBuild }) {
  if (!build) return <div className="combat-rules-summary"><span>AC and equipped weapon bonuses: Not configured</span></div>
  const armor = build.items.find((item) => item.category === 'armor' && item.equipmentSlot === 'armor')
  const shield = build.items.some((item) => item.category === 'shield' && item.equipmentSlot === 'shield')
  let armorClass: ReturnType<typeof calculateArmorClass>
  try {
    armorClass = calculateArmorClass({ dexterityScore: build.dex, armorEquipped: Boolean(armor), armorDefinitionId: armor?.armorDefinitionId ?? null, shieldEquipped: shield, manualOverride: build.manualAcOverride })
  } catch { armorClass = { configured: false, value: null, source: 'unconfigured', breakdown: 'Invalid AC configuration.' } }
  const weapons = build.items.filter((item) => item.category === 'weapon' && (item.equipmentSlot === 'main_hand' || item.equipmentSlot === 'off_hand'))
  const scores = { str: build.str, dex: build.dex, con: build.con, int: build.int, wis: build.wis, cha: build.cha }
  return <div className="combat-rules-summary"><span><b>AC</b> {armorClass.configured ? armorClass.value : 'Not configured'} <small>{armorClass.source === 'manual' ? 'Manual override' : armorClass.breakdown}</small></span><div><b>Attack bonuses</b>{weapons.length === 0 ? <small>No equipped weapons</small> : weapons.map((weapon) => {
    const result = calculateWeaponAttackBonus({ abilityScores: scores, level: build.level, weaponDefinitionId: weapon.weaponDefinitionId, weaponAbility: weapon.weaponAbility, proficient: Boolean(weapon.weaponDefinitionId && build.weaponProficiencies.includes(weapon.weaponDefinitionId)), manualOverride: weapon.manualAttackBonus })
    return <small key={weapon.id}>{weapon.name}: {result.configured ? `${signed(result.total ?? 0)} · ${result.breakdown}` : 'Not configured'}</small>
  })}</div></div>
}

export default function Combat({ campaigns }: Props) {
  const [campaignId, setCampaignId] = useState('')
  const [encounters, setEncounters] = useState<Encounter[]>([])
  const [encounterId, setEncounterId] = useState('')
  const [details, setDetails] = useState<Details | null>(null)
  const [characters, setCharacters] = useState<CharacterOption[]>([])
  const [characterBuilds, setCharacterBuilds] = useState<Record<string, CharacterBuild>>({})
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [encounterName, setEncounterName] = useState('')
  const [newEncounterName, setNewEncounterName] = useState('')
  const [enemyName, setEnemyName] = useState('')
  const [enemyModifier, setEnemyModifier] = useState('0')
  const [playerHp, setPlayerHp] = useState({ current: '10', max: '10' })
  const [enemyHp, setEnemyHp] = useState({ current: '10', max: '10' })
  const [enemyArmorClass, setEnemyArmorClass] = useState('')
  const [enemyAttackBonus, setEnemyAttackBonus] = useState('')
  const [editingEnemyStats, setEditingEnemyStats] = useState<Record<string, boolean>>({})
  const [enemyStatDrafts, setEnemyStatDrafts] = useState<Record<string, { armorClass: string; attackBonus: string }>>({})
  const [hpAmounts, setHpAmounts] = useState<Record<string, string>>({})
  const [hpEdits, setHpEdits] = useState<Record<string, { current: string; max: string }>>({})
  const [editingHp, setEditingHp] = useState<Record<string, boolean>>({})
  const [conditionDrafts, setConditionDrafts] = useState<Record<string, { condition: ConditionKey; level: string }>>({})
  const [manualTotals, setManualTotals] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attackAttackerId, setAttackAttackerId] = useState('')
  const [attackTargetId, setAttackTargetId] = useState('')
  const [attackWeaponId, setAttackWeaponId] = useState('')
  const [attackMode, setAttackMode] = useState<AttackMode>('normal')
  const [attackModifierDraft, setAttackModifierDraft] = useState('0')
  const [attackSaving, setAttackSaving] = useState(false)
  const [attackHistory, setAttackHistory] = useState<AttackRecord[]>([])
  const [attackHistoryLoading, setAttackHistoryLoading] = useState(false)

  const route = (suffix = '') => `${API_URL}/campaigns/${campaignId}/encounters${suffix}`
  const sortedCombatants = useMemo(() => details ? sortCombatants(details.combatants) : [], [details])
  const availableCharacters = characters.filter((character) => !details?.combatants.some((combatant) => combatant.characterId === character.id))

  useEffect(() => {
    if (!campaigns.length) { setCampaignId(''); return }
    if (!campaigns.some((campaign) => campaign.id === campaignId)) setCampaignId(campaigns[0]!.id)
  }, [campaigns, campaignId])

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    async function loadEncounters() {
      setLoading(true); setError(''); setEncounters([]); setEncounterId(''); setDetails(null)
      try {
        const response = await fetch(route())
        const payload = await readPayload<{ encounters?: Encounter[] }>(response)
        if (!response.ok) throw new Error(payload.error || 'Could not load encounters.')
        if (!cancelled) {
          const loaded = payload.encounters ?? []
          setEncounters(loaded)
          setEncounterId(loaded[0]?.id ?? '')
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load encounters.')
      } finally { if (!cancelled) setLoading(false) }
    }
    void loadEncounters()
    return () => { cancelled = true }
  }, [campaignId])

  useEffect(() => {
    if (!campaignId) { setCharacters([]); setCharacterBuilds({}); return }
    let cancelled = false
    setCharacters([]); setCharacterBuilds({})
    async function loadCharacters() {
      try {
        const rosterResponse = await fetch(`${API_URL}/campaigns/${campaignId}/players`)
        const rosterPayload = await readPayload<{ players?: { playerId: string; displayName: string }[] }>(rosterResponse)
        if (!rosterResponse.ok) throw new Error(rosterPayload.error || 'Could not load campaign players.')
        const groups = await Promise.all((rosterPayload.players ?? []).map(async (player) => {
          const response = await fetch(`${API_URL}/campaigns/${campaignId}/players/${player.playerId}/characters`)
          const payload = await readPayload<{ characters?: { id: string; name: string; dex: number; status: string }[] }>(response)
          if (!response.ok) throw new Error(payload.error || `Could not load ${player.displayName}’s characters.`)
          return (payload.characters ?? []).map((character) => ({ ...character, playerId: player.playerId, playerName: player.displayName }))
        }))
        const loadedCharacters = groups.flat()
        const builds = await Promise.all(loadedCharacters.map(async (character) => {
          const prefix = `${API_URL}/campaigns/${campaignId}/players/${character.playerId}/characters/${character.id}`
          const [sheetResponse, inventoryResponse] = await Promise.all([fetch(`${prefix}/sheet`), fetch(`${prefix}/inventory`)])
          const sheetPayload = await readPayload<{ sheet?: CharacterBuild }>(sheetResponse)
          const inventoryPayload = await readPayload<{ items?: CombatBuildItem[] }>(inventoryResponse)
          if (!sheetResponse.ok || !sheetPayload.sheet) throw new Error('Could not load character combat statistics.')
          if (!inventoryResponse.ok) throw new Error('Could not load equipped character items.')
          return [character.id, { ...sheetPayload.sheet, items: inventoryPayload.items ?? [] }] as const
        }))
        if (!cancelled) { setCharacters(loadedCharacters); setCharacterBuilds(Object.fromEntries(builds)) }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load campaign characters.')
      }
    }
    void loadCharacters()
    return () => { cancelled = true }
  }, [campaignId])

  useEffect(() => {
    if (!campaignId || !encounterId) { setDetails(null); return }
    let cancelled = false
    async function loadDetails() {
      setLoading(true); setError('')
      try {
        const response = await fetch(route(`/${encounterId}`))
        const payload = await readPayload<Details>(response)
        if (!response.ok) throw new Error(payload.error || 'Could not open this encounter.')
        if (!cancelled) { setDetails(payload); setEncounterName(payload.encounter.name) }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not open this encounter.')
      } finally { if (!cancelled) setLoading(false) }
    }
    void loadDetails()
    return () => { cancelled = true }
  }, [campaignId, encounterId])

  useEffect(() => {
    if (!campaignId || !encounterId) { setAttackHistory([]); return }
    let cancelled = false
    setAttackHistoryLoading(true)
    fetch(route(`/${encounterId}/attacks`)).then(readPayload<{ attacks?: AttackRecord[] }>).then((payload) => {
      if (!cancelled) setAttackHistory(payload.attacks ?? [])
    }).catch(() => { if (!cancelled) setAttackHistory([]) }).finally(() => { if (!cancelled) setAttackHistoryLoading(false) })
    return () => { cancelled = true }
  }, [campaignId, encounterId])

  useEffect(() => {
    if (!details) { setAttackAttackerId(''); setAttackTargetId(''); setAttackWeaponId(''); return }
    const ids = details.combatants.map((entry) => entry.id)
    setAttackAttackerId((current) => ids.includes(current) ? current : ids[0] ?? '')
    setAttackTargetId((current) => ids.includes(current) && current !== (ids.includes(attackAttackerId) ? attackAttackerId : ids[0])
      ? current : ids.find((id) => id !== (ids.includes(attackAttackerId) ? attackAttackerId : ids[0])) ?? '')
  }, [details, attackAttackerId])

  const attackAttacker = details?.combatants.find((entry) => entry.id === attackAttackerId)
  const attackTarget = details?.combatants.find((entry) => entry.id === attackTargetId)
  const attackTargets = details?.combatants.filter((entry) => entry.id !== attackAttackerId) ?? []
  const attackerBuild = attackAttacker?.characterId ? characterBuilds[attackAttacker.characterId] : undefined
  const attackWeapons = attackerBuild?.items.filter((item) => item.category === 'weapon' && item.equipped && (item.equipmentSlot === 'main_hand' || item.equipmentSlot === 'off_hand')) ?? []
  const selectedAttackWeapon = attackWeapons.find((entry) => entry.id === attackWeaponId)
  const configuredAttackWeapon = selectedAttackWeapon ? calculateWeaponAttackBonus({
    abilityScores: { str: attackerBuild!.str, dex: attackerBuild!.dex, con: attackerBuild!.con, int: attackerBuild!.int, wis: attackerBuild!.wis, cha: attackerBuild!.cha },
    level: attackerBuild!.level, weaponDefinitionId: selectedAttackWeapon.weaponDefinitionId,
    weaponAbility: selectedAttackWeapon.weaponAbility, proficient: Boolean(selectedAttackWeapon.weaponDefinitionId && attackerBuild!.weaponProficiencies.includes(selectedAttackWeapon.weaponDefinitionId)),
    manualOverride: selectedAttackWeapon.manualAttackBonus,
  }) : null
  const targetBuild = attackTarget?.characterId ? characterBuilds[attackTarget.characterId] : undefined
  const targetArmor = targetBuild?.items.find((item) => item.category === 'armor' && item.equipmentSlot === 'armor')
  const targetShield = Boolean(targetBuild?.items.some((item) => item.category === 'shield' && item.equipmentSlot === 'shield'))
  const targetArmorClass = attackTarget?.type === 'enemy'
    ? attackTarget.armorClassOverride
    : targetBuild ? calculateArmorClass({ dexterityScore: targetBuild.dex, armorEquipped: Boolean(targetArmor), armorDefinitionId: targetArmor?.armorDefinitionId ?? null, shieldEquipped: targetShield, manualOverride: targetBuild.manualAcOverride }).value
    : null

  useEffect(() => {
    if (!attackWeapons.some((weapon) => weapon.id === attackWeaponId)) setAttackWeaponId(attackWeapons[0]?.id ?? '')
  }, [attackAttackerId, attackWeapons, attackWeaponId])

  async function refreshEncounter() {
    if (!campaignId || !encounterId) return
    const response = await fetch(route(`/${encounterId}`))
    const payload = await readPayload<Details>(response)
    if (!response.ok) throw new Error(payload.error || 'Could not refresh this encounter.')
    setDetails(payload)
    setEncounterName(payload.encounter.name)
    setEncounters((current) => current.map((entry) => entry.id === payload.encounter.id ? payload.encounter : entry))
  }

  async function createEncounter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(route(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newEncounterName }) })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not create encounter.')
      setEncounters((current) => [payload.encounter, ...current])
      setDetails(payload); setEncounterName(payload.encounter.name); setEncounterId(payload.encounter.id); setNewEncounterName(''); setNotice('Encounter created.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create encounter.') }
    finally { setSaving(false) }
  }

  async function renameEncounter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!encounterId) return
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: encounterName }) })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not rename encounter.')
      setDetails(payload); setEncounterName(payload.encounter.name); setEncounters((current) => current.map((entry) => entry.id === encounterId ? payload.encounter : entry)); setNotice('Encounter renamed.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not rename encounter.') }
    finally { setSaving(false) }
  }

  async function deleteEncounter() {
    if (!details || !window.confirm(`Delete “${details.encounter.name}” and its combatants? This cannot be undone.`)) return
    setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${details.encounter.id}`), { method: 'DELETE' })
      const payload = await readPayload<{ deleted?: boolean }>(response)
      if (!response.ok) throw new Error(payload.error || 'Could not delete encounter.')
      const remaining = encounters.filter((entry) => entry.id !== details.encounter.id)
      setEncounters(remaining); setEncounterId(remaining[0]?.id ?? ''); setDetails(null); setNotice('Encounter deleted.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete encounter.') }
  }

  async function addPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!encounterId || !selectedCharacterId) return
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/combatants/players`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: selectedCharacterId, currentHp: Number(playerHp.current), maxHp: Number(playerHp.max) }) })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || 'Could not add this character.')
      setDetails(payload); setSelectedCharacterId(''); setNotice('Character added to the encounter.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add this character.') }
    finally { setSaving(false) }
  }

  async function addEnemy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!encounterId) return
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/combatants/enemies`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: enemyName, initiativeModifier: Number(enemyModifier), currentHp: Number(enemyHp.current), maxHp: Number(enemyHp.max), armorClassOverride: enemyArmorClass === '' ? null : Number(enemyArmorClass), attackModifier: enemyAttackBonus === '' ? null : Number(enemyAttackBonus) }) })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not add enemy.')
      setDetails(payload); setEnemyName(''); setEnemyModifier('0'); setEnemyHp({ current: '10', max: '10' }); setEnemyArmorClass(''); setEnemyAttackBonus(''); setNotice('Enemy added to the encounter.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add enemy.') }
    finally { setSaving(false) }
  }

  async function removeCombatant(combatant: Combatant) {
    if (!window.confirm(`Remove ${combatant.name} from this encounter?`)) return
    setError(''); setNotice('')
    try {
      const activeRemoved = details?.encounter.activeCombatantId === combatant.id
      const response = await fetch(route(`/${encounterId}/combatants/${combatant.id}`), { method: 'DELETE' })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || 'Could not remove combatant.')
      setDetails(payload); setNotice(activeRemoved ? 'Active combatant removed. Turn tracking reset; start the encounter again.' : 'Combatant removed.')
      setEncounters((current) => current.map((entry) => entry.id === encounterId ? payload.encounter : entry))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove combatant.') }
  }

  async function combatantRequest(combatant: Combatant, action: string, method: 'PUT' | 'POST' | 'DELETE', body?: Record<string, unknown>, success = 'Combatant updated.') {
    setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/combatants/${combatant.id}/${action}`), {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
      })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not update this combatant.')
      setDetails(payload); setNotice(success)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this combatant.') }
  }

  async function adjustHp(combatant: Combatant, action: 'damage' | 'heal') {
    const amount = Number(hpAmounts[combatant.id] ?? '1')
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError('Enter a positive whole number for damage or healing.'); return }
    await combatantRequest(combatant, action, 'POST', { amount }, action === 'damage' ? 'Damage applied.' : 'Healing applied.')
  }

  async function saveHp(combatant: Combatant) {
    const values = hpEdits[combatant.id] ?? { current: String(combatant.currentHp), max: String(combatant.maxHp) }
    if (!/^\d+$/.test(values.current) || !/^\d+$/.test(values.max)) { setError('Current and maximum HP must be whole numbers.'); return }
    await combatantRequest(combatant, 'hit-points', 'PUT', { currentHp: Number(values.current), maxHp: Number(values.max) }, 'Hit points saved.')
    setEditingHp((current) => ({ ...current, [combatant.id]: false }))
  }

  async function updateCondition(combatant: Combatant) {
    const draft = conditionDrafts[combatant.id] ?? { condition: 'blinded' as ConditionKey, level: '1' }
    await combatantRequest(combatant, 'conditions', 'POST', draft.condition === 'exhaustion'
      ? { condition: draft.condition, level: Number(draft.level) }
      : { condition: draft.condition }, draft.condition === 'exhaustion' ? `Exhaustion level ${draft.level} applied.` : `${CONDITIONS.find((entry) => entry.key === draft.condition)?.label} applied.`)
  }

  async function saveEnemyStats(combatant: Combatant) {
    const draft = enemyStatDrafts[combatant.id] ?? { armorClass: String(combatant.armorClassOverride ?? ''), attackBonus: String(combatant.attackModifier ?? '') }
    const values: Record<string, number | null> = {}
    for (const [key, value, min, max] of [['armorClassOverride', draft.armorClass, 1, 50], ['attackModifier', draft.attackBonus, -20, 50]] as const) {
      if (value.trim() === '') values[key] = null
      else if (!/^-?\d+$/.test(value) || Number(value) < min || Number(value) > max) { setError(`${key === 'armorClassOverride' ? 'Enemy AC' : 'Enemy attack bonus'} must be a whole number from ${min} to ${max}, or blank.`); return }
      else values[key] = Number(value)
    }
    setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/combatants/${combatant.id}/combat-stats`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not save enemy combat stats.')
      setDetails(payload); setEditingEnemyStats({ ...editingEnemyStats, [combatant.id]: false }); setNotice('Enemy combat stats saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save enemy combat stats.') }
  }

  async function setInitiative(combatant: Combatant, source: 'rolled' | 'manual') {
    setError(''); setNotice('')
    try {
      if (source === 'manual') {
        const entered = manualTotals[combatant.id] ?? (combatant.initiativeSource === 'manual' ? String(combatant.initiativeTotal) : '')
        if (entered.trim() === '' || !Number.isInteger(Number(entered))) {
          setError('Enter a whole-number manual initiative total first.')
          return
        }
      }
      const data = source === 'rolled'
        ? { source, roll: rollDice({ diceCount: 1, sides: 20, modifier: 0, mode: 'normal' }).diceResults[0] }
        : { source, total: Number(manualTotals[combatant.id] ?? combatant.initiativeTotal) }
      const response = await fetch(route(`/${encounterId}/combatants/${combatant.id}/initiative`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not set initiative.')
      setDetails(payload)
      setNotice(payload.encounter.status === 'active' ? 'Initiative updated. The current turn stays active; the new order applies on the next turn.' : source === 'rolled' ? 'Initiative roll saved.' : 'Manual initiative saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not set initiative.') }
  }

  async function encounterAction(action: 'start' | 'next-turn' | 'reset') {
    if (!details) return
    if (action === 'reset' && !window.confirm('Reset the encounter turn and round tracking? Initiative will be kept.')) return
    setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/${action}`), { method: 'POST' })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || 'Could not update encounter turns.')
      setDetails(payload)
      setEncounters((current) => current.map((entry) => entry.id === encounterId ? payload.encounter : entry))
      setNotice(action === 'start' ? 'Encounter started.' : action === 'reset' ? 'Turn tracking reset. Initiative was kept.' : 'Turn advanced.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update encounter turns.') }
  }

  async function rollAttack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!details || !attackAttackerId || !attackTargetId) return
    if (!/^-?\d+$/.test(attackModifierDraft) || Number(attackModifierDraft) < -100 || Number(attackModifierDraft) > 100) {
      setError('Situational attack modifier must be a whole number from -100 to 100.')
      return
    }
    if (attackAttacker?.type === 'player' && (!selectedAttackWeapon || !configuredAttackWeapon?.configured)) {
      setError('Choose an equipped weapon with a configured attack bonus before rolling.')
      return
    }
    setAttackSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/attacks`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attackerId: attackAttackerId, targetId: attackTargetId, ...(attackAttacker?.type === 'player' ? { weaponId: attackWeaponId } : {}), mode: attackMode, situationalModifier: Number(attackModifierDraft) }),
      })
      const payload = await readPayload<{ attack?: AttackRecord; attacks?: AttackRecord[] }>(response)
      if (!response.ok || !payload.attack) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not resolve this attack.')
      setAttackHistory(payload.attacks ?? [payload.attack, ...attackHistory].slice(0, 20))
      setNotice(`${payload.attack.outcome === 'critical_hit' ? 'Critical hit' : payload.attack.outcome === 'hit' ? 'Hit' : 'Miss'} recorded. No damage or turn state was changed.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not resolve this attack.') }
    finally { setAttackSaving(false) }
  }

  return <section className="combat-view" aria-labelledby="combat-heading">
    <header className="combat-page-heading"><div className="eyebrow"><span className="eyebrow-line" />THE ORDER OF BATTLE</div><h1 id="combat-heading">Combat <em>Encounters</em></h1><p>Gather the party, set initiative, and track each round.</p></header>
    {campaigns.length === 0 ? <div className="combat-empty"><span aria-hidden="true">⚔</span><h2>No campaigns available</h2><p>Create a campaign before preparing an encounter.</p></div> : <>
      <div className="combat-campaign-select"><label className="combat-field"><span>Campaign</span><select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label></div>
      <div className="combat-workspace">
        <aside className="combat-encounter-rail" aria-label="Saved encounters">
          <div className="combat-rail-heading"><div className="eyebrow small"><span className="eyebrow-line" />ENCOUNTERS</div><strong>{encounters.length}</strong></div>
          {loading && encounters.length === 0 ? <p className="combat-muted">Loading…</p> : encounters.length === 0 ? <p className="combat-muted">No saved encounters yet.</p> : <div className="combat-encounter-list">{encounters.map((encounter) => <button type="button" className={`combat-encounter-choice${encounter.id === encounterId ? ' selected' : ''}`} key={encounter.id} onClick={() => setEncounterId(encounter.id)}><span>{encounter.name}</span><small>{encounter.status === 'active' ? `Round ${encounter.round}` : 'Setup'}</small></button>)}</div>}
          <form className="combat-new-form" onSubmit={(event) => void createEncounter(event)}><label className="combat-field"><span>New encounter</span><input required maxLength={120} value={newEncounterName} onChange={(event) => setNewEncounterName(event.target.value)} placeholder="The Ashen Bridge" /></label><button className="combat-primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : '＋ Create encounter'}</button></form>
        </aside>

        <div className="combat-main-panel">
          {error && <div className="combat-feedback error" role="alert">{error}<button type="button" onClick={() => { setError(''); if (encounterId) void refreshEncounter() }}>Dismiss</button></div>}
          {notice && <div className="combat-feedback success" role="status">✦ {notice}</div>}
          {!details ? <div className="combat-no-encounter"><span aria-hidden="true">✧</span><h2>{loading ? 'Opening encounter…' : 'Choose your first encounter'}</h2><p>Select a saved encounter or create one to arrange the combatants.</p></div> : <>
            <div className="combat-encounter-heading"><div className="combat-encounter-title"><div className="eyebrow small"><span className="eyebrow-line" />{details.encounter.status === 'active' ? `ROUND ${details.encounter.round}` : 'ENCOUNTER SETUP'}</div><h2>{details.encounter.name}</h2><p>{details.combatants.length} {details.combatants.length === 1 ? 'combatant' : 'combatants'} · ties use insertion order</p></div><button type="button" className="combat-danger-button" onClick={() => void deleteEncounter()}>Delete encounter</button></div>
            <form className="combat-rename-form" onSubmit={(event) => void renameEncounter(event)}><label className="combat-field"><span>Encounter name</span><input required maxLength={120} value={encounterName} onChange={(event) => setEncounterName(event.target.value)} /></label><button type="submit" className="combat-secondary-button" disabled={saving || encounterName.trim() === details.encounter.name}>Rename</button></form>
            <div className={`combat-round-banner${details.encounter.status === 'active' ? ' active' : ''}`}><div><span>{details.encounter.status === 'active' ? 'ACTIVE TURN' : 'TURN TRACKING'}</span><strong>{details.encounter.status === 'active' ? sortedCombatants.find((combatant) => combatant.id === details.encounter.activeCombatantId)?.name ?? 'No active combatant' : 'Encounter not started'}</strong></div><div className="combat-round-number"><span>ROUND</span><strong>{details.encounter.round || '—'}</strong></div></div>
            <div className="combat-turn-actions">{details.encounter.status === 'setup' ? <button className="combat-primary-button" type="button" disabled={details.combatants.length === 0 || details.combatants.some((combatant) => combatant.initiativeTotal === null)} onClick={() => void encounterAction('start')}>⚔ Start encounter</button> : <><button className="combat-primary-button" type="button" onClick={() => void encounterAction('next-turn')}>Next turn <span>↗</span></button><button className="combat-secondary-button" type="button" onClick={() => void encounterAction('reset')}>Reset turn tracking</button></>}{details.combatants.some((combatant) => combatant.initiativeTotal === null) && <small>Set initiative for every combatant to start.</small>}</div>

            <div className="combat-add-panels">
              <form className="combat-add-form" onSubmit={(event) => void addPlayer(event)}><div className="eyebrow small"><span className="eyebrow-line" />PLAYER CHARACTER</div><label className="combat-field"><span>Campaign character</span><select value={selectedCharacterId} onChange={(event) => setSelectedCharacterId(event.target.value)} disabled={!availableCharacters.length}><option value="">{availableCharacters.length ? 'Choose a character' : 'No available characters'}</option>{availableCharacters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.playerName}</option>)}</select></label><div className="combat-hp-entry"><label className="combat-field"><span>Current HP</span><input type="number" min="0" step="1" value={playerHp.current} onChange={(event) => setPlayerHp({ ...playerHp, current: event.target.value })} /></label><label className="combat-field"><span>Maximum HP</span><input type="number" min="1" step="1" value={playerHp.max} onChange={(event) => setPlayerHp({ ...playerHp, max: event.target.value })} /></label></div><button className="combat-secondary-button" type="submit" disabled={saving || !selectedCharacterId}>＋ Add character</button></form>
              <form className="combat-add-form" onSubmit={(event) => void addEnemy(event)}><div className="eyebrow small"><span className="eyebrow-line" />ENEMY COMBATANT</div><div className="combat-enemy-fields"><label className="combat-field"><span>Enemy name</span><input required maxLength={120} value={enemyName} onChange={(event) => setEnemyName(event.target.value)} placeholder="Bandit captain" /></label><label className="combat-field modifier-field"><span>Initiative mod</span><input type="number" min="-100" max="100" step="1" value={enemyModifier} onChange={(event) => setEnemyModifier(event.target.value)} /></label></div><div className="combat-hp-entry"><label className="combat-field"><span>Current HP</span><input type="number" min="0" step="1" value={enemyHp.current} onChange={(event) => setEnemyHp({ ...enemyHp, current: event.target.value })} /></label><label className="combat-field"><span>Maximum HP</span><input type="number" min="1" step="1" value={enemyHp.max} onChange={(event) => setEnemyHp({ ...enemyHp, max: event.target.value })} /></label></div><div className="combat-enemy-combat-stats"><label className="combat-field"><span>Enemy AC <small>optional manual value</small></span><input type="number" min="1" max="50" step="1" value={enemyArmorClass} onChange={(event) => setEnemyArmorClass(event.target.value)} placeholder="Not configured" /></label><label className="combat-field"><span>Attack bonus <small>optional manual value</small></span><input type="number" min="-20" max="50" step="1" value={enemyAttackBonus} onChange={(event) => setEnemyAttackBonus(event.target.value)} placeholder="Not configured" /></label></div><button className="combat-secondary-button" type="submit" disabled={saving}>＋ Add enemy</button></form>
            </div>

            <section className="combat-attack-section" aria-labelledby="combat-attack-heading">
              <div className="combatants-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />ATTACK ROLLS</div><h3 id="combat-attack-heading">Resolve an attack</h3></div><span>Server-rolled d20 · no damage applied</span></div>
              {details.combatants.length < 2 ? <p className="combat-muted">Add at least two combatants to roll an attack.</p> : <form className="combat-attack-form" onSubmit={(event) => void rollAttack(event)}>
                <label className="combat-field"><span>Attacker</span><select value={attackAttackerId} onChange={(event) => { setAttackAttackerId(event.target.value); setAttackWeaponId('') }}>{details.combatants.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.type === 'player' ? 'Player' : 'Enemy'}</option>)}</select></label>
                <label className="combat-field"><span>Target</span><select value={attackTargetId} onChange={(event) => setAttackTargetId(event.target.value)}>{attackTargets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
                {attackAttacker?.type === 'player' ? <label className="combat-field"><span>Equipped weapon</span><select value={attackWeaponId} onChange={(event) => setAttackWeaponId(event.target.value)} disabled={!attackWeapons.length}><option value="">{attackWeapons.length ? 'Choose a weapon' : 'No equipped weapons'}</option>{attackWeapons.map((weapon) => {
                  const bonus = calculateWeaponAttackBonus({ abilityScores: { str: attackerBuild!.str, dex: attackerBuild!.dex, con: attackerBuild!.con, int: attackerBuild!.int, wis: attackerBuild!.wis, cha: attackerBuild!.cha }, level: attackerBuild!.level, weaponDefinitionId: weapon.weaponDefinitionId, weaponAbility: weapon.weaponAbility, proficient: Boolean(weapon.weaponDefinitionId && attackerBuild!.weaponProficiencies.includes(weapon.weaponDefinitionId)), manualOverride: weapon.manualAttackBonus })
                  return <option key={weapon.id} value={weapon.id}>{weapon.name} · {bonus.configured ? `${signed(bonus.total ?? 0)} attack` : 'Not configured'}</option>
                })}</select></label> : <div className="combat-attack-config"><span>Enemy attack bonus</span><strong>{attackAttacker?.attackModifier === null || attackAttacker?.attackModifier === undefined ? 'Not configured' : signed(attackAttacker.attackModifier)}</strong></div>}
                <label className="combat-field"><span>Roll mode</span><select value={attackMode} onChange={(event) => setAttackMode(event.target.value as AttackMode)}><option value="normal">Normal</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option></select></label>
                <label className="combat-field"><span>Situational modifier</span><input type="number" min="-100" max="100" step="1" value={attackModifierDraft} onChange={(event) => setAttackModifierDraft(event.target.value)} /></label>
                <button type="submit" className="combat-primary-button" disabled={attackSaving || !attackAttackerId || !attackTargetId || details.combatants.length < 2 || targetArmorClass === null || (attackAttacker?.type === 'player' && !configuredAttackWeapon?.configured) || (attackAttacker?.type === 'enemy' && attackAttacker.attackModifier === null)}>{attackSaving ? 'Rolling…' : '⚔ Roll attack'}</button>
                {attackAttacker?.type === 'player' && <p className="combat-attack-hint">{configuredAttackWeapon?.configured ? `${selectedAttackWeapon?.name}: ${signed(configuredAttackWeapon.total ?? 0)} base attack bonus · verified again by the server.` : 'Choose an equipped weapon with a configured attack bonus.'}</p>}
                {attackAttacker?.type === 'enemy' && attackAttacker.attackModifier === null && <p className="combat-attack-hint">Set this enemy’s manual attack bonus above before rolling.</p>}
                <p className="combat-attack-hint">Target AC: {targetArmorClass ?? 'Not configured'}{targetArmorClass !== null ? ' · verified again by the server.' : ' · configure AC before rolling.'}</p>
              </form>}
              <div className="combat-attack-history"><div className="combat-attack-history-heading"><h4>Recent attacks</h4><span>{attackHistoryLoading ? 'Loading…' : `${attackHistory.length} saved`}</span></div>
                {attackHistory.length === 0 ? <p className="combat-muted">Attack rolls for this encounter will appear here.</p> : <div className="combat-attack-list">{attackHistory.map((attack) => <article className={`combat-attack-result ${attack.outcome}`} key={attack.id}>
                  <div className="combat-attack-result-heading"><strong>{attack.attackerName} → {attack.targetName}</strong><span className="combat-attack-total">{attack.total}</span><span className={`combat-attack-outcome ${attack.outcome}`}>{attack.outcome === 'critical_hit' ? 'Critical Hit' : attack.outcome === 'hit' ? 'Hit' : 'Miss'}</span></div>
                  <p>{attack.weaponName ? `${attack.weaponName} · ` : ''}{attack.mode[0]!.toUpperCase() + attack.mode.slice(1)} · d20 {attack.diceResults.map((die, index) => `${die}${index === attack.keptIndex ? ' (kept)' : ''}`).join(' / ')}</p>
                  <p className="combat-attack-breakdown">{attack.breakdown} · target AC {attack.targetAC}</p>
                  <time dateTime={attack.createdAt}>{new Date(attack.createdAt).toLocaleString()}</time>
                </article>)}</div>}
              </div>
            </section>

            <section className="combatants-section" aria-label="Combat turn order"><div className="combatants-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />TURN ORDER</div><h3>Initiative</h3></div><span>Highest first · ties keep insertion order</span></div>
              {sortedCombatants.length === 0 ? <div className="combat-empty-list"><span aria-hidden="true">⚔</span><p>No combatants yet. Add a campaign character or enemy.</p></div> : <div className="combatant-list">{sortedCombatants.map((combatant, index) => <article key={combatant.id} className={`combatant-card${details.encounter.activeCombatantId === combatant.id ? ' is-active' : ''}${combatant.type === 'enemy' ? ' is-enemy' : ''}`}>
                <div className="combatant-initiative"><span>{combatant.initiativeTotal === null ? '—' : combatant.initiativeTotal}</span><small>{combatant.initiativeTotal === null ? 'NO INIT' : 'INIT'}</small></div>
                  <div className="combatant-main"><div className="combatant-name-row"><span className="combatant-order">{index + 1}</span><h4>{combatant.name}</h4><span className={`combatant-type ${combatant.type}`}>{combatant.type === 'player' ? 'PLAYER' : 'ENEMY'}</span>{details.encounter.activeCombatantId === combatant.id && <span className="active-turn-tag">ACTIVE</span>}</div><p>{combatant.initiativeSource === 'rolled' ? `Rolled d20 ${combatant.initiativeRoll} ${signed(combatant.initiativeModifier)} modifier = ${combatant.initiativeTotal}` : combatant.initiativeSource === 'manual' ? `Manual total · modifier ${signed(combatant.initiativeModifier)} not applied` : details.encounter.status === 'active' ? 'Initiative not set · excluded from turn advancement' : `Initiative modifier ${signed(combatant.initiativeModifier)} · not set`}</p>
                  {combatant.type === 'player' ? <PlayerCombatSummary build={characterBuilds[combatant.characterId ?? '']} /> : <div className="combat-enemy-stats"><span><b>AC</b> {combatant.armorClassOverride ?? 'Not configured'} <small>{combatant.armorClassOverride === null ? 'Manual value not set' : 'Manual value'}</small></span><span><b>Attack bonus</b> {combatant.attackModifier === null ? 'Not configured' : signed(combatant.attackModifier)} <small>{combatant.attackModifier === null ? 'Manual value not set' : 'Manual value'}</small></span><button type="button" className="combat-secondary-button" onClick={() => { setEnemyStatDrafts({ ...enemyStatDrafts, [combatant.id]: { armorClass: String(combatant.armorClassOverride ?? ''), attackBonus: String(combatant.attackModifier ?? '') } }); setEditingEnemyStats({ ...editingEnemyStats, [combatant.id]: !editingEnemyStats[combatant.id] }) }}>{editingEnemyStats[combatant.id] ? 'Cancel edit' : 'Edit enemy stats'}</button>{editingEnemyStats[combatant.id] && <div className="combat-enemy-combat-stats"><label className="combat-field"><span>Enemy AC</span><input type="number" min="1" max="50" step="1" value={enemyStatDrafts[combatant.id]?.armorClass ?? ''} onChange={(event) => setEnemyStatDrafts({ ...enemyStatDrafts, [combatant.id]: { armorClass: event.target.value, attackBonus: enemyStatDrafts[combatant.id]?.attackBonus ?? '' } })} placeholder="Not configured" /></label><label className="combat-field"><span>Attack bonus</span><input type="number" min="-20" max="50" step="1" value={enemyStatDrafts[combatant.id]?.attackBonus ?? ''} onChange={(event) => setEnemyStatDrafts({ ...enemyStatDrafts, [combatant.id]: { armorClass: enemyStatDrafts[combatant.id]?.armorClass ?? '', attackBonus: event.target.value } })} placeholder="Not configured" /></label><button type="button" className="combat-secondary-button" onClick={() => void saveEnemyStats(combatant)}>Save enemy stats</button></div>}</div>}
                  <div className={`combat-hp-panel${combatant.currentHp === 0 ? ' at-zero' : ''}`}><div className="combat-hp-summary"><span>HIT POINTS</span><strong>{combatant.currentHp} <small>/ {combatant.maxHp}</small></strong>{combatant.currentHp === 0 && <em>At 0 HP · status unchanged</em>}</div><div className="combat-hp-actions"><label className="combat-field"><span className="visually-hidden">Damage or healing amount for {combatant.name}</span><input type="number" min="1" step="1" aria-label={`Damage or healing amount for ${combatant.name}`} value={hpAmounts[combatant.id] ?? '1'} onChange={(event) => setHpAmounts({ ...hpAmounts, [combatant.id]: event.target.value })} /></label><button type="button" className="combat-roll-button" onClick={() => void adjustHp(combatant, 'damage')}>Damage</button><button type="button" className="combat-roll-button" onClick={() => void adjustHp(combatant, 'heal')}>Heal</button><button type="button" className="combat-secondary-button" onClick={() => { setHpEdits({ ...hpEdits, [combatant.id]: { current: String(combatant.currentHp), max: String(combatant.maxHp) } }); setEditingHp({ ...editingHp, [combatant.id]: !editingHp[combatant.id] }) }}>{editingHp[combatant.id] ? 'Cancel edit' : 'Edit HP'}</button></div></div>
                  {editingHp[combatant.id] && <div className="combat-hp-entry combat-hp-edit"><label className="combat-field"><span>Current HP</span><input type="number" min="0" step="1" value={hpEdits[combatant.id]?.current ?? combatant.currentHp} onChange={(event) => setHpEdits({ ...hpEdits, [combatant.id]: { current: event.target.value, max: hpEdits[combatant.id]?.max ?? String(combatant.maxHp) } })} /></label><label className="combat-field"><span>Maximum HP</span><input type="number" min="1" step="1" value={hpEdits[combatant.id]?.max ?? combatant.maxHp} onChange={(event) => setHpEdits({ ...hpEdits, [combatant.id]: { current: hpEdits[combatant.id]?.current ?? String(combatant.currentHp), max: event.target.value } })} /></label><button type="button" className="combat-secondary-button" onClick={() => void saveHp(combatant)}>Save HP</button></div>}
                  <div className="combat-condition-panel"><div className="combat-condition-list" aria-label={`Conditions on ${combatant.name}`}>{combatant.conditions.map((condition) => <span className="combat-condition-chip" key={condition.id}>{CONDITIONS.find((entry) => entry.key === condition.condition)?.label}{condition.level ? ` ${condition.level}` : ''}<button type="button" aria-label={`Remove ${condition.condition}${condition.level ? ` level ${condition.level}` : ''} from ${combatant.name}`} onClick={() => void combatantRequest(combatant, `conditions/${condition.condition}`, 'DELETE', undefined, 'Condition removed.')}>×</button></span>)}{combatant.conditions.length === 0 && <span className="combat-no-conditions">No conditions</span>}</div><div className="combat-condition-entry"><label className="combat-field"><span>Add condition</span><select value={(conditionDrafts[combatant.id] ?? { condition: 'blinded' as ConditionKey, level: '1' }).condition} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { condition: event.target.value as ConditionKey, level: conditionDrafts[combatant.id]?.level ?? '1' } })}>{CONDITIONS.filter((condition) => condition.key === 'exhaustion' || !combatant.conditions.some((entry) => entry.condition === condition.key)).map((condition) => <option key={condition.key} value={condition.key}>{condition.label}</option>)}</select></label>{(conditionDrafts[combatant.id]?.condition ?? 'blinded') === 'exhaustion' && <label className="combat-field"><span>Level</span><select value={conditionDrafts[combatant.id]?.level ?? '1'} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { condition: 'exhaustion', level: event.target.value } })}>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>}<button type="button" className="combat-secondary-button" onClick={() => void updateCondition(combatant)}>Add</button></div></div>
                  <div className="combatant-controls"><button type="button" className="combat-roll-button" onClick={() => void setInitiative(combatant, 'rolled')}>{combatant.initiativeSource === 'rolled' ? 'Reroll d20' : 'Roll d20'}</button><label className="combat-manual-entry"><span className="visually-hidden">Manual initiative total for {combatant.name}</span><input type="number" min="-1000" max="1000" step="1" value={manualTotals[combatant.id] ?? (combatant.initiativeSource === 'manual' ? String(combatant.initiativeTotal) : '')} onChange={(event) => setManualTotals({ ...manualTotals, [combatant.id]: event.target.value })} placeholder="Manual total" /><button type="button" className="combat-secondary-button" disabled={manualTotals[combatant.id] === undefined && combatant.initiativeSource !== 'manual'} onClick={() => void setInitiative(combatant, 'manual')}>Set total</button></label><button type="button" className="combat-danger-link" onClick={() => void removeCombatant(combatant)}>Remove</button></div>
                </div>
              </article>)}</div>}
            </section>
          </>}
        </div>
      </div>
    </>}
  </section>
}
