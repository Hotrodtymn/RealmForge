import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { rollDice } from './dice'
import { sortCombatants } from './combatRules'
import { getCombatantMarkers, getHpPercentage } from './combatPresentation'
import { calculateArmorClass, calculateWeaponAttackBonus, WEAPON_DEFINITIONS } from './combatStats'
import CombatSpellResolution from './CombatSpellResolution'
import CombatSpellEffects from './CombatSpellEffects'
import './Combat.css'

const API_URL = 'http://localhost:3001/api'
const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const
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
interface CombatantCondition { id: string; combatantId: string; condition: ConditionKey; level: number | null; sourceCombatantId: string | null; notes: string; mechanicalSummary: string; contextWarning: string | null; durationType: 'indefinite' | 'turn_boundary' | 'fixed_rounds' | 'recovery_save'; durationCombatantId: string | null; durationTiming: 'start' | 'end' | null; remainingRounds: number | null; originalDuration: string; recoveryAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' | null; recoveryDc: number | null; recoveryTiming: 'start' | 'end' | null; recoveryNotes: string; recoveryModifier: number | null; createdAt: string }
interface ConditionHistoryEvent { id: string; condition: string; eventType: string; reason: string; previousValue: string | null; newValue: string | null; rollDetails: string | null; createdAt: string; combatantId: string }
interface Combatant { id: string; encounterId: string; characterId: string | null; type: 'player' | 'enemy'; name: string; initiativeModifier: number; initiativeSource: 'rolled' | 'manual' | null; initiativeRoll: number | null; initiativeTotal: number | null; initiativeExhaustionPenalty: number; insertionOrder: number; currentHp: number; maxHp: number; deathSaveSuccesses: number; deathSaveFailures: number; survivalStatus: 'conscious' | 'unconscious' | 'stable' | 'dead'; armorClassOverride: number | null; attackModifier: number | null; damageFormula: string | null; damageType: string | null; conditions: CombatantCondition[] }
interface SurvivalEvent { id: string; actionId: string; action: string; naturalRoll: number | null; successes: number; failures: number; survivalStatus: Combatant['survivalStatus']; hpBefore: number; hpAfter: number; detail: string; createdAt: string }
interface Details { encounter: Encounter; combatants: Combatant[] }
interface ActionState { combatantId: string; actionUsed: boolean; bonusActionUsed: boolean; reactionUsed: boolean; movementAllowance: number; movementUsed: number; dashBonusMovement: number; turnCount: number; disengageActive: boolean; dodgeActive: boolean; effectiveSpeed: number; speedRestrictions: string[]; actionRestricted: boolean; actionRestrictionConditions: string[]; prone: boolean; standCost: number | null; adjudication: string[] }
interface ActionEffect { id: string; ownerCombatantId: string; ownerName: string; targetCombatantId: string | null; targetName: string | null; kind: 'help' | 'ready'; helpUse: 'ability_check' | 'attack' | null; description: string; triggerText: string; responseText: string; status: string; expiresAtOwnerTurn: number; createdAt: string }
interface ActionEvent { id: string; actionId: string; combatantId: string | null; combatantName: string; kind: string; details: Record<string, unknown>; createdAt: string }
interface ActionSnapshot { states: ActionState[]; effects: ActionEffect[]; events: ActionEvent[] }
interface CharacterOption { id: string; playerId: string; name: string; playerName: string; dex: number; status: string }
interface CombatBuildItem { id: string; name: string; category: string; quantity: number; equipped: boolean; equipmentSlot: string | null; armorDefinitionId: string | null; weaponDefinitionId: string | null; weaponAbility: 'str' | 'dex' | null; manualAttackBonus: number | null }
interface CharacterBuild { level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number; manualAcOverride: number | null; weaponProficiencies: string[]; items: CombatBuildItem[] }
interface ApiError { error?: string; fields?: Record<string, string> }
type AttackMode = 'normal' | 'advantage' | 'disadvantage'
interface AttackRecord { id: string; encounterId: string; attackerId: string; attackerName: string; targetId: string; targetName: string; weaponId: string | null; weaponName: string | null; weaponDefinitionId: string | null; weaponUse: 'one_handed' | 'two_handed' | null; damageDiceCount: number | null; damageDieSize: number | null; versatileDamageDiceCount: number | null; versatileDamageDieSize: number | null; damageType: string | null; damageAbility: 'str' | 'dex' | null; damageAbilityModifier: number | null; enemyDamageFormula: string | null; enemyDamageType: string | null; mode: AttackMode; diceResults: number[]; keptIndex: number; attackBonus: number; situationalModifier: number; total: number; targetAC: number; outcome: 'hit' | 'miss' | 'critical_hit'; isCritical: boolean; breakdown: string; createdAt: string; conditionSnapshot: { manualMode: AttackMode; mode: AttackMode; advantageSources: string[]; disadvantageSources: string[]; warnings: string[]; blockedReason: string | null; criticalOnHit: boolean; appliedContext: Record<string, unknown>; exhaustionLevel?: number; exhaustionPenalty?: number; dmOverride?: boolean; overrideReason?: string } }
interface DamageRecord { id: string; encounterId: string; attackId: string; attackerId: string; attackerName: string; targetId: string; targetName: string; weaponId: string | null; weaponName: string | null; source: 'weapon' | 'enemy'; formula: string; damageType: string; diceCount: number; dieSize: number; diceResults: number[]; formulaModifier: number; ability: 'str' | 'dex' | null; abilityModifier: number; situationalModifier: number; isCritical: boolean; total: number; applied: boolean; hpBefore: number | null; hpAfter: number | null; createdAt: string; appliedAt: string | null; breakdown: string }
interface Props { campaigns: Campaign[] }

async function readPayload<T>(response: Response): Promise<T & ApiError> {
  return await response.json() as T & ApiError
}

function signed(value: number): string { return value >= 0 ? `+${value}` : String(value) }
function conditionEventText(event: ConditionHistoryEvent): string {
  if (event.rollDetails) {
    try {
      const details = JSON.parse(event.rollDetails) as { breakdown?: string; final?: number; dc?: number; success?: boolean; naturalRoll?: number }
      return [details.breakdown, details.success === undefined ? '' : `${details.success ? 'Success' : 'Failure'} vs DC ${details.dc ?? '—'}`].filter(Boolean).join(' · ')
    } catch { return event.reason || event.eventType.replaceAll('_', ' ') }
  }
  return event.reason || [event.previousValue, event.newValue].filter(Boolean).join(' → ') || event.eventType.replaceAll('_', ' ')
}

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

function DamageControls({
  attack, rolls, modifier, disabled, onModifierChange, onRoll, onApply,
}: {
  attack: AttackRecord
  rolls: DamageRecord[]
  modifier: string
  disabled: boolean
  onModifierChange: (value: string) => void
  onRoll: () => void
  onApply: (roll: DamageRecord) => void
}) {
  if (attack.outcome === 'miss') return null
  const configured = attack.weaponId
    ? attack.damageDiceCount !== null && attack.damageDieSize !== null && attack.damageType !== null && attack.damageAbilityModifier !== null
    : Boolean(attack.enemyDamageFormula && attack.enemyDamageType)
  return <div className="combat-damage-controls">
    <div className="combat-damage-action-row">
      <label className="combat-field"><span>Situational damage modifier</span><input aria-label={`Situational damage modifier for ${attack.attackerName}'s attack`} type="number" min="-100" max="100" step="1" value={modifier} onChange={(event) => onModifierChange(event.target.value)} /></label>
      <button type="button" className="combat-secondary-button" disabled={disabled || !configured} onClick={onRoll}>Roll Damage</button>
      {!configured && <small>Damage is unavailable: this attack has no structured damage configuration.</small>}
    </div>
    {rolls.map((roll) => <div className={`combat-damage-roll${roll.applied ? ' applied' : ''}`} key={roll.id}>
      <div><strong>{roll.total} {roll.damageType}</strong><span>{roll.isCritical ? 'Critical damage' : 'Damage roll'} · {roll.source === 'weapon' ? roll.weaponName : 'Enemy formula'}</span></div>
      <p>{roll.breakdown}</p>
      {roll.applied ? <p className="combat-damage-applied">Applied · target HP {roll.hpBefore} → {roll.hpAfter}</p> : <button type="button" className="combat-primary-button" disabled={disabled} onClick={() => onApply(roll)}>Apply {roll.total} damage to {roll.targetName}</button>}
    </div>)}
  </div>
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
  const [enemyDamageFormula, setEnemyDamageFormula] = useState('')
  const [enemyDamageType, setEnemyDamageType] = useState('bludgeoning')
  const [editingEnemyStats, setEditingEnemyStats] = useState<Record<string, boolean>>({})
  const [enemyStatDrafts, setEnemyStatDrafts] = useState<Record<string, { armorClass: string; attackBonus: string; damageFormula: string; damageType: string }>>({})
  const [hpAmounts, setHpAmounts] = useState<Record<string, string>>({})
  const [hpEdits, setHpEdits] = useState<Record<string, { current: string; max: string }>>({})
  const [editingHp, setEditingHp] = useState<Record<string, boolean>>({})
  const [conditionDrafts, setConditionDrafts] = useState<Record<string, { condition: ConditionKey; level: string; sourceCombatantId: string; notes: string; durationType: 'indefinite' | 'turn_boundary' | 'fixed_rounds' | 'recovery_save'; durationCombatantId: string; durationTiming: 'start' | 'end'; durationRounds: string; recoveryAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; recoveryDc: string; recoveryTiming: 'start' | 'end'; recoveryModifier: string }>>({})
  const [conditionHistory, setConditionHistory] = useState<ConditionHistoryEvent[]>([])
  const [manualTotals, setManualTotals] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [attackAttackerId, setAttackAttackerId] = useState('')
  const [attackTargetId, setAttackTargetId] = useState('')
  const [attackWeaponId, setAttackWeaponId] = useState('')
  const [attackWeaponUse, setAttackWeaponUse] = useState<'one_handed' | 'two_handed'>('one_handed')
  const [attackMode, setAttackMode] = useState<AttackMode>('normal')
  const [attackModifierDraft, setAttackModifierDraft] = useState('0')
  const [attackSaving, setAttackSaving] = useState(false)
  const [attackHistory, setAttackHistory] = useState<AttackRecord[]>([])
  const [attackHistoryLoading, setAttackHistoryLoading] = useState(false)
  const [damageHistory, setDamageHistory] = useState<DamageRecord[]>([])
  const [damageModifierDrafts, setDamageModifierDrafts] = useState<Record<string, string>>({})
  const [damageSaving, setDamageSaving] = useState(false)
  const [survivalSaving, setSurvivalSaving] = useState<string | null>(null)
  const [survivalEvents, setSurvivalEvents] = useState<Record<string, SurvivalEvent[]>>({})
  const [actionEconomy, setActionEconomy] = useState<ActionSnapshot | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [turnActionRequest, setTurnActionRequest] = useState<{ encounterId: string; actionId: string } | null>(null)
  const [movementDraft, setMovementDraft] = useState('')
  const [allowanceDraft, setAllowanceDraft] = useState('')
  const [helpTargetId, setHelpTargetId] = useState('')
  const [helpUseDraft, setHelpUseDraft] = useState<'ability_check' | 'attack'>('ability_check')
  const [helpDescriptionDraft, setHelpDescriptionDraft] = useState('')
  const [readyTriggerDraft, setReadyTriggerDraft] = useState('')
  const [readyResponseDraft, setReadyResponseDraft] = useState('')
  const [consumeAttackAction, setConsumeAttackAction] = useState(false)
  const [distanceDraft, setDistanceDraft] = useState('')
  const [attackerSight, setAttackerSight] = useState('')
  const [targetSight, setTargetSight] = useState('')
  const [fearSourceSight, setFearSourceSight] = useState('')
  const [attackDmOverride, setAttackDmOverride] = useState(false)
  const [attackOverrideReason, setAttackOverrideReason] = useState('')
  const [actionDmOverride, setActionDmOverride] = useState(false)
  const [actionOverrideReason, setActionOverrideReason] = useState('')

  const route = (suffix = '') => `${API_URL}/campaigns/${campaignId}/encounters${suffix}`
  const conditionDraftFor = (combatantId: string) => conditionDrafts[combatantId] ?? { condition: 'blinded' as ConditionKey, level: String(details?.combatants.find((entry) => entry.id === combatantId)?.conditions.find((entry) => entry.condition === 'exhaustion')?.level ?? 1), sourceCombatantId: '', notes: '', durationType: 'indefinite' as const, durationCombatantId: combatantId, durationTiming: 'end' as const, durationRounds: '1', recoveryAbility: 'con' as const, recoveryDc: '10', recoveryTiming: 'end' as const, recoveryModifier: '' }
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
    if (!campaignId || !encounterId || !details) { setActionEconomy(null); return }
    let cancelled = false
    fetch(route(`/${encounterId}/action-economy`)).then(async (response) => {
      const payload = await readPayload<ActionSnapshot & ApiError>(response)
      if (!response.ok) throw new Error(payload.error || 'Could not load action economy.')
      if (!cancelled) setActionEconomy(payload)
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load action economy.') })
    return () => { cancelled = true }
  }, [campaignId, encounterId, details])

  useEffect(() => {
    if (!campaignId || !encounterId || !details) { setSurvivalEvents({}); return }
    let cancelled = false
    Promise.all(details.combatants.filter((entry) => entry.type === 'player').map(async (entry) => {
      const response = await fetch(route(`/${encounterId}/combatants/${entry.id}/survival`))
      const payload = await readPayload<{ events?: SurvivalEvent[] }>(response)
      if (!response.ok) throw new Error('Could not load survival history.')
      return [entry.id, payload.events ?? []] as const
    })).then((entries) => { if (!cancelled) setSurvivalEvents(Object.fromEntries(entries)) })
      .catch(() => { if (!cancelled) setSurvivalEvents({}) })
    return () => { cancelled = true }
  }, [campaignId, encounterId, details])

  useEffect(() => {
    if (!campaignId || !encounterId) { setConditionHistory([]); return }
    let cancelled = false
    fetch(route(`/${encounterId}/condition-history`)).then(async (response) => {
      const payload = await readPayload<{ events?: ConditionHistoryEvent[] } & ApiError>(response)
      if (!response.ok) throw new Error(payload.error || 'Could not load condition history.')
      if (!cancelled) setConditionHistory(payload.events ?? [])
    }).catch(() => { if (!cancelled) setConditionHistory([]) })
    return () => { cancelled = true }
  }, [campaignId, encounterId, details])

  useEffect(() => {
    if (!campaignId || !encounterId) { setAttackHistory([]); setDamageHistory([]); return }
    let cancelled = false
    setAttackHistoryLoading(true)
    Promise.all([fetch(route(`/${encounterId}/attacks`)), fetch(route(`/${encounterId}/damage`))]).then(async ([attackResponse, damageResponse]) => {
      const [attacks, damage] = await Promise.all([readPayload<{ attacks?: AttackRecord[] }>(attackResponse), readPayload<{ damageRolls?: DamageRecord[] }>(damageResponse)])
      if (!attackResponse.ok || !damageResponse.ok) throw new Error('Could not load attack and damage history.')
      if (!cancelled) { setAttackHistory(attacks.attacks ?? []); setDamageHistory(damage.damageRolls ?? []) }
    }).catch(() => { if (!cancelled) { setAttackHistory([]); setDamageHistory([]) } }).finally(() => { if (!cancelled) setAttackHistoryLoading(false) })
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
  const activeCombatant = details?.combatants.find((entry) => entry.id === details.encounter.activeCombatantId)
  const activeEconomy = activeCombatant ? actionEconomy?.states.find((entry) => entry.combatantId === activeCombatant.id) : undefined
  const activeAllies = activeCombatant ? details?.combatants.filter((entry) => entry.type === activeCombatant.type && entry.id !== activeCombatant.id) ?? [] : []
  const attackTarget = details?.combatants.find((entry) => entry.id === attackTargetId)
  const attackTargets = details?.combatants.filter((entry) => entry.id !== attackAttackerId) ?? []
  const attackerBuild = attackAttacker?.characterId ? characterBuilds[attackAttacker.characterId] : undefined
  const attackWeapons = attackerBuild?.items.filter((item) => item.category === 'weapon' && item.equipped && (item.equipmentSlot === 'main_hand' || item.equipmentSlot === 'off_hand')) ?? []
  const selectedAttackWeapon = attackWeapons.find((entry) => entry.id === attackWeaponId)
  const selectedWeaponDefinition = selectedAttackWeapon?.weaponDefinitionId
    ? WEAPON_DEFINITIONS.find((entry) => entry.id === selectedAttackWeapon.weaponDefinitionId)
    : undefined
  const versatileFormula = selectedWeaponDefinition && 'versatile' in selectedWeaponDefinition ? selectedWeaponDefinition.versatile : undefined
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

  useEffect(() => { setAttackWeaponUse('one_handed') }, [attackWeaponId])

  const recentSurvivalEvents = details
    ? details.combatants.flatMap((combatant) => (survivalEvents[combatant.id] ?? []).map((entry) => ({ ...entry, combatantName: combatant.name })))
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt)).slice(0, 6)
    : []

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
      const response = await fetch(route(`/${encounterId}/combatants/enemies`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: enemyName, initiativeModifier: Number(enemyModifier), currentHp: Number(enemyHp.current), maxHp: Number(enemyHp.max), armorClassOverride: enemyArmorClass === '' ? null : Number(enemyArmorClass), attackModifier: enemyAttackBonus === '' ? null : Number(enemyAttackBonus), damageFormula: enemyDamageFormula.trim() || null, damageType: enemyDamageFormula.trim() ? enemyDamageType : null }) })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not add enemy.')
      setDetails(payload); setEnemyName(''); setEnemyModifier('0'); setEnemyHp({ current: '10', max: '10' }); setEnemyArmorClass(''); setEnemyAttackBonus(''); setEnemyDamageFormula(''); setEnemyDamageType('bludgeoning'); setNotice('Enemy added to the encounter.')
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

  async function survivalAction(combatant: Combatant, action: 'death-save' | 'stabilize') {
    setSurvivalSaving(combatant.id); setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/combatants/${combatant.id}/${action}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId: crypto.randomUUID() }) })
      const payload = await readPayload<{ event?: SurvivalEvent } & Details>(response)
      if (!response.ok || !payload.event) throw new Error(payload.error || 'Could not update survival status.')
      const detailResponse = await fetch(route(`/${encounterId}`))
      const nextDetails = await readPayload<Details>(detailResponse)
      if (!detailResponse.ok) throw new Error(nextDetails.error || 'Survival action was recorded, but combat state could not refresh.')
      setDetails(nextDetails)
      setNotice(payload.event.detail)
      const historyResponse = await fetch(route(`/${encounterId}/combatants/${combatant.id}/survival`))
      const historyPayload = await readPayload<{ events?: SurvivalEvent[] }>(historyResponse)
      if (historyResponse.ok) setSurvivalEvents((current) => ({ ...current, [combatant.id]: historyPayload.events ?? [] }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update survival status.') }
    finally { setSurvivalSaving(null) }
  }

  async function updateCondition(combatant: Combatant) {
    const draft = conditionDraftFor(combatant.id)
    if (draft.condition === 'exhaustion' && combatant.conditions.some((entry) => entry.condition === 'exhaustion')) {
      await combatantRequest(combatant, 'exhaustion', 'PUT', { level: Number(draft.level), reason: draft.notes }, `Exhaustion adjusted to level ${draft.level}.`)
      return
    }
    let duration: Record<string, unknown> | undefined
    if (draft.durationType === 'turn_boundary') duration = { type: draft.durationType, combatantId: draft.durationCombatantId || combatant.id, timing: draft.durationTiming }
    if (draft.durationType === 'fixed_rounds') duration = { type: draft.durationType, combatantId: draft.durationCombatantId || combatant.id, timing: draft.durationTiming, rounds: Number(draft.durationRounds) }
    if (draft.durationType === 'recovery_save') duration = { type: draft.durationType, recovery: { ability: draft.recoveryAbility, dc: Number(draft.recoveryDc), timing: draft.recoveryTiming, notes: draft.notes, ...(combatant.type === 'enemy' && draft.recoveryModifier.trim() ? { saveModifier: Number(draft.recoveryModifier) } : {}) } }
    await combatantRequest(combatant, 'conditions', 'POST', draft.condition === 'exhaustion'
      ? { condition: draft.condition, level: Number(draft.level), sourceCombatantId: draft.sourceCombatantId || null, notes: draft.notes }
      : { condition: draft.condition, sourceCombatantId: draft.sourceCombatantId || null, notes: draft.notes, ...(duration ? { duration } : {}) }, draft.condition === 'exhaustion' ? `Exhaustion level ${draft.level} applied.` : `${CONDITIONS.find((entry) => entry.key === draft.condition)?.label} applied.`)
  }

  async function saveConditionDuration(combatant: Combatant, condition: CombatantCondition) {
    const draft = conditionDraftFor(combatant.id)
    let duration: Record<string, unknown>
    if (draft.durationType === 'turn_boundary') duration = { type: draft.durationType, combatantId: draft.durationCombatantId || combatant.id, timing: draft.durationTiming }
    else if (draft.durationType === 'fixed_rounds') duration = { type: draft.durationType, combatantId: draft.durationCombatantId || combatant.id, timing: draft.durationTiming, rounds: Number(draft.durationRounds) }
    else if (draft.durationType === 'recovery_save') duration = { type: draft.durationType, recovery: { ability: draft.recoveryAbility, dc: Number(draft.recoveryDc), timing: draft.recoveryTiming, notes: draft.notes, ...(combatant.type === 'enemy' && draft.recoveryModifier.trim() ? { saveModifier: Number(draft.recoveryModifier) } : {}) } }
    else duration = { type: 'indefinite' }
    await combatantRequest(combatant, `conditions/${condition.condition}/duration`, 'PUT', { duration, reason: draft.notes, actionId: crypto.randomUUID() }, `${condition.condition} duration updated.`)
  }

  async function resolveRecoveryManually(combatant: Combatant, condition: CombatantCondition) {
    const reason = window.prompt(`Why is the recovery save for ${condition.condition} being resolved manually?`)
    if (!reason?.trim()) return
    const success = window.confirm('Did the recovery save succeed? Choose Cancel for failure.')
    await combatantRequest(combatant, `conditions/${condition.condition}/recovery`, 'POST', { success, reason: reason.trim(), actionId: crypto.randomUUID() }, `Recovery save manually resolved: ${success ? 'success' : 'failure'}.`)
  }

  async function removeConditionFromCombatant(combatant: Combatant, condition: CombatantCondition) {
    const reason = condition.condition === 'exhaustion' ? window.prompt('Reason for reducing Exhaustion to 0?') : undefined
    if (condition.condition === 'exhaustion' && !reason?.trim()) return
    if (!window.confirm(`Remove ${condition.condition}${condition.level ? ` level ${condition.level}` : ''} from ${combatant.name}?`)) return
    await combatantRequest(combatant, `conditions/${condition.condition}`, 'DELETE', reason ? { reason } : undefined, 'Condition removed.')
  }

  async function saveEnemyStats(combatant: Combatant) {
    const draft = enemyStatDrafts[combatant.id] ?? { armorClass: String(combatant.armorClassOverride ?? ''), attackBonus: String(combatant.attackModifier ?? ''), damageFormula: combatant.damageFormula ?? '', damageType: combatant.damageType ?? 'bludgeoning' }
    const values: Record<string, number | null> = {}
    for (const [key, value, min, max] of [['armorClassOverride', draft.armorClass, 1, 50], ['attackModifier', draft.attackBonus, -20, 50]] as const) {
      if (value.trim() === '') values[key] = null
      else if (!/^-?\d+$/.test(value) || Number(value) < min || Number(value) > max) { setError(`${key === 'armorClassOverride' ? 'Enemy AC' : 'Enemy attack bonus'} must be a whole number from ${min} to ${max}, or blank.`); return }
      else values[key] = Number(value)
    }
    setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/combatants/${combatant.id}/combat-stats`), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, damageFormula: draft.damageFormula.trim() || null, damageType: draft.damageFormula.trim() ? draft.damageType : null }) })
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
    setActionBusy(true)
    const actionId = action === 'next-turn'
      ? turnActionRequest?.encounterId === encounterId ? turnActionRequest.actionId : crypto.randomUUID()
      : undefined
    if (actionId) setTurnActionRequest({ encounterId, actionId })
    try {
      const response = await fetch(route(`/${encounterId}/${action}`), { method: 'POST', ...(actionId ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId }) } : {}) })
      const payload = await readPayload<Details>(response)
      if (!response.ok) throw new Error(payload.error || 'Could not update encounter turns.')
      if (actionId) setTurnActionRequest((current) => current?.actionId === actionId ? null : current)
      setDetails(payload)
      setEncounters((current) => current.map((entry) => entry.id === encounterId ? payload.encounter : entry))
      setNotice(action === 'start' ? 'Encounter started.' : action === 'reset' ? 'Turn tracking reset. Initiative was kept.' : 'Turn advanced.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update encounter turns.') }
    finally { setActionBusy(false) }
  }

  async function performEconomy(input: Record<string, unknown>, successMessage: string) {
    if (!details || !encounterId) return
    if (actionDmOverride && !actionOverrideReason.trim()) { setError('Enter a reason for the explicit DM override.'); return }
    setActionBusy(true); setError(''); setNotice('')
    try {
      const override = actionDmOverride ? { dmOverride: true, overrideReason: actionOverrideReason } : {}
      const response = await fetch(route(`/${encounterId}/action-economy`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actionId: crypto.randomUUID(), ...override, ...input }) })
      const payload = await readPayload<ActionSnapshot>(response)
      if (!response.ok) throw new Error((payload as ActionSnapshot & ApiError).error || 'Could not update action economy.')
      setActionEconomy(payload); setNotice(successMessage)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update action economy.') }
    finally { setActionBusy(false) }
  }

  async function rollAttack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!details || !attackAttackerId || !attackTargetId) return
    if (!/^-?\d+$/.test(attackModifierDraft) || Number(attackModifierDraft) < -100 || Number(attackModifierDraft) > 100) {
      setError('Situational attack modifier must be a whole number from -100 to 100.')
      return
    }
    if (distanceDraft !== '' && (!/^\d+$/.test(distanceDraft) || Number(distanceDraft) > 10000)) { setError('Distance must be a whole number from 0 to 10000 feet, or blank for DM adjudication.'); return }
    if (attackDmOverride && !attackOverrideReason.trim()) { setError('Enter a reason for the explicit DM override.'); return }
    if (attackAttacker?.type === 'player' && (!selectedAttackWeapon || !configuredAttackWeapon?.configured)) {
      setError('Choose an equipped weapon with a configured attack bonus before rolling.')
      return
    }
    setAttackSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/attacks`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attackerId: attackAttackerId, targetId: attackTargetId, ...(attackAttacker?.type === 'player' ? { weaponId: attackWeaponId, ...(versatileFormula ? { weaponUse: attackWeaponUse } : {}) } : {}), mode: attackMode, situationalModifier: Number(attackModifierDraft), ...(distanceDraft !== '' ? { distanceFeet: Number(distanceDraft) } : {}), ...(attackerSight !== '' ? { attackerCanSeeTarget: attackerSight === 'yes' } : {}), ...(targetSight !== '' ? { targetCanSeeAttacker: targetSight === 'yes' } : {}), ...(fearSourceSight !== '' ? { fearSourceVisible: fearSourceSight === 'yes' } : {}), ...(attackDmOverride ? { dmOverride: true, overrideReason: attackOverrideReason.trim() } : {}), ...(consumeAttackAction ? { consumeAction: true, actionId: crypto.randomUUID() } : {}) }),
      })
      const payload = await readPayload<{ attack?: AttackRecord; attacks?: AttackRecord[] }>(response)
      if (!response.ok || !payload.attack) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not resolve this attack.')
      setAttackHistory(payload.attacks ?? [payload.attack, ...attackHistory].slice(0, 20))
      if (consumeAttackAction) {
        setConsumeAttackAction(false)
        const economyResponse = await fetch(route(`/${encounterId}/action-economy`))
        if (economyResponse.ok) setActionEconomy(await readPayload<ActionSnapshot>(economyResponse))
      }
      setNotice(`${payload.attack.outcome === 'critical_hit' ? 'Critical hit' : payload.attack.outcome === 'hit' ? 'Hit' : 'Miss'} recorded. No damage or turn state was changed.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not resolve this attack.') }
    finally { setAttackSaving(false) }
  }

  async function rollDamage(attack: AttackRecord) {
    const rawModifier = damageModifierDrafts[attack.id] ?? '0'
    if (!/^-?\d+$/.test(rawModifier) || Number(rawModifier) < -100 || Number(rawModifier) > 100) {
      setError('Situational damage modifier must be a whole number from -100 to 100.')
      return
    }
    setDamageSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/attacks/${attack.id}/damage`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ situationalModifier: Number(rawModifier) }) })
      const payload = await readPayload<{ damage?: DamageRecord; damageRolls?: DamageRecord[] }>(response)
      if (!response.ok || !payload.damage) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not roll damage.')
      setDamageHistory(payload.damageRolls ?? [payload.damage, ...damageHistory])
      setNotice(`${payload.damage.breakdown}. HP was not changed.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not roll damage.') }
    finally { setDamageSaving(false) }
  }

  async function applyDamage(damage: DamageRecord) {
    setDamageSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(route(`/${encounterId}/damage/${damage.id}/apply`), { method: 'POST' })
      const payload = await readPayload<{ damage?: DamageRecord; hp?: { targetId: string; currentHp: number; maxHp: number }; survivalMessage?: string }>(response)
      if (!response.ok || !payload.damage || !payload.hp) throw new Error(payload.error || Object.values(payload.fields ?? {}).join(' ') || 'Could not apply damage.')
      setDamageHistory((current) => current.map((entry) => entry.id === damage.id ? payload.damage! : entry))
      await refreshEncounter()
      setNotice([`${damage.total} damage applied to ${damage.targetName}. HP ${payload.damage.hpBefore} → ${payload.damage.hpAfter}.`, payload.survivalMessage].filter(Boolean).join(' '))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply damage.') }
    finally { setDamageSaving(false) }
  }

  const combatantsPanel = details ? (
            <section className="combatants-section" aria-label="Combat turn order"><div className="combatants-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />TURN ORDER</div><h3>Combatants</h3></div><span>Initiative order</span></div>
              {sortedCombatants.length === 0 ? <div className="combat-empty-list"><span aria-hidden="true">⚔</span><p>No combatants yet. Add a campaign character or enemy.</p></div> : <div className="combatant-list">{sortedCombatants.map((combatant, index) => { const markers = getCombatantMarkers(combatant.id, details.encounter.activeCombatantId, attackAttackerId, attackTargetId); return <article key={combatant.id} className={`combatant-card${markers.active ? ' is-active' : ''}${combatant.type === 'enemy' ? ' is-enemy' : ''}${markers.attacker ? ' is-selected-attacker' : ''}${markers.target ? ' is-selected-target' : ''}`}>
                <div className="combatant-initiative"><span>{combatant.initiativeTotal === null ? '—' : combatant.initiativeTotal}</span><small>{combatant.initiativeTotal === null ? 'NO INIT' : 'INIT'}</small></div>
                  <div className="combatant-main"><div className="combatant-name-row"><span className="combatant-order">{index + 1}</span><h4>{combatant.name}</h4><span className={`combatant-type ${combatant.type}`}>{combatant.type === 'player' ? 'PLAYER' : 'ENEMY'}</span>{markers.active && <span className="active-turn-tag">ACTIVE TURN</span>}{markers.attacker && <span className="combat-selection-tag attacker">ATTACKER</span>}{markers.target && <span className="combat-selection-tag target">TARGET</span>}</div><p>{combatant.initiativeSource === 'rolled' ? `Rolled d20 ${combatant.initiativeRoll} ${signed(combatant.initiativeModifier)} modifier${combatant.initiativeExhaustionPenalty ? ` ${signed(combatant.initiativeExhaustionPenalty)} Exhaustion` : ''} = ${combatant.initiativeTotal}` : combatant.initiativeSource === 'manual' ? `Manual total · modifier ${signed(combatant.initiativeModifier)} not applied` : details.encounter.status === 'active' ? 'Initiative not set · excluded from turn advancement' : `Initiative modifier ${signed(combatant.initiativeModifier)} · not set`}</p>
                  {combatant.type === 'player' ? <PlayerCombatSummary build={characterBuilds[combatant.characterId ?? '']} /> : <div className="combat-enemy-stats"><span><b>AC</b> {combatant.armorClassOverride ?? 'Not configured'} <small>{combatant.armorClassOverride === null ? 'Manual value not set' : 'Manual value'}</small></span><span><b>Attack bonus</b> {combatant.attackModifier === null ? 'Not configured' : signed(combatant.attackModifier)} <small>{combatant.attackModifier === null ? 'Manual value not set' : 'Manual value'}</small></span><span><b>Damage</b> {combatant.damageFormula ? `${combatant.damageFormula} ${combatant.damageType}` : 'Not configured'}</span><button type="button" className="combat-secondary-button" onClick={() => { setEnemyStatDrafts({ ...enemyStatDrafts, [combatant.id]: { armorClass: String(combatant.armorClassOverride ?? ''), attackBonus: String(combatant.attackModifier ?? ''), damageFormula: combatant.damageFormula ?? '', damageType: combatant.damageType ?? 'bludgeoning' } }); setEditingEnemyStats({ ...editingEnemyStats, [combatant.id]: !editingEnemyStats[combatant.id] }) }}>{editingEnemyStats[combatant.id] ? 'Cancel edit' : 'Edit enemy stats'}</button>{editingEnemyStats[combatant.id] && <div className="combat-enemy-combat-stats"><label className="combat-field"><span>Enemy AC</span><input type="number" min="1" max="50" step="1" value={enemyStatDrafts[combatant.id]?.armorClass ?? ''} onChange={(event) => setEnemyStatDrafts({ ...enemyStatDrafts, [combatant.id]: { ...enemyStatDrafts[combatant.id], armorClass: event.target.value, attackBonus: enemyStatDrafts[combatant.id]?.attackBonus ?? '', damageFormula: enemyStatDrafts[combatant.id]?.damageFormula ?? combatant.damageFormula ?? '', damageType: enemyStatDrafts[combatant.id]?.damageType ?? combatant.damageType ?? 'bludgeoning' } })} placeholder="Not configured" /></label><label className="combat-field"><span>Attack bonus</span><input type="number" min="-20" max="50" step="1" value={enemyStatDrafts[combatant.id]?.attackBonus ?? ''} onChange={(event) => setEnemyStatDrafts({ ...enemyStatDrafts, [combatant.id]: { ...enemyStatDrafts[combatant.id], armorClass: enemyStatDrafts[combatant.id]?.armorClass ?? String(combatant.armorClassOverride ?? ''), attackBonus: event.target.value, damageFormula: enemyStatDrafts[combatant.id]?.damageFormula ?? combatant.damageFormula ?? '', damageType: enemyStatDrafts[combatant.id]?.damageType ?? combatant.damageType ?? 'bludgeoning' } })} placeholder="Not configured" /></label><label className="combat-field"><span>Damage formula</span><input maxLength={20} value={enemyStatDrafts[combatant.id]?.damageFormula ?? combatant.damageFormula ?? ''} onChange={(event) => setEnemyStatDrafts({ ...enemyStatDrafts, [combatant.id]: { ...enemyStatDrafts[combatant.id], armorClass: enemyStatDrafts[combatant.id]?.armorClass ?? String(combatant.armorClassOverride ?? ''), attackBonus: enemyStatDrafts[combatant.id]?.attackBonus ?? String(combatant.attackModifier ?? ''), damageFormula: event.target.value, damageType: enemyStatDrafts[combatant.id]?.damageType ?? combatant.damageType ?? 'bludgeoning' } })} placeholder="1d6+2" /></label><label className="combat-field"><span>Damage type</span><select value={enemyStatDrafts[combatant.id]?.damageType ?? combatant.damageType ?? 'bludgeoning'} onChange={(event) => setEnemyStatDrafts({ ...enemyStatDrafts, [combatant.id]: { ...enemyStatDrafts[combatant.id], armorClass: enemyStatDrafts[combatant.id]?.armorClass ?? String(combatant.armorClassOverride ?? ''), attackBonus: enemyStatDrafts[combatant.id]?.attackBonus ?? String(combatant.attackModifier ?? ''), damageFormula: enemyStatDrafts[combatant.id]?.damageFormula ?? combatant.damageFormula ?? '', damageType: event.target.value } })}>{DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type[0]!.toUpperCase() + type.slice(1)}</option>)}</select></label><button type="button" className="combat-secondary-button" onClick={() => void saveEnemyStats(combatant)}>Save enemy stats</button></div>}</div>}
                  <div className={`combat-hp-panel${combatant.currentHp === 0 ? ' at-zero' : ''}`}><div className="combat-hp-summary"><span>HIT POINTS</span><strong>{combatant.currentHp} <small>/ {combatant.maxHp}</small></strong>{combatant.type === 'player' && combatant.survivalStatus !== 'conscious' && <em className={`survival-status ${combatant.survivalStatus}`}>{combatant.survivalStatus === 'unconscious' ? 'Unconscious · death saves required' : combatant.survivalStatus === 'stable' ? 'Stable at 0 HP' : 'Dead'}</em>}</div><div className="combat-hp-bar" role="progressbar" aria-label={`${combatant.name} hit points`} aria-valuemin={0} aria-valuemax={combatant.maxHp} aria-valuenow={combatant.currentHp}><span className={combatant.currentHp === 0 ? 'empty' : getHpPercentage(combatant.currentHp, combatant.maxHp) <= 25 ? 'low' : ''} style={{ width: `${getHpPercentage(combatant.currentHp, combatant.maxHp)}%` }} /></div><div className="combat-hp-actions"><label className="combat-field"><span className="visually-hidden">Damage or healing amount for {combatant.name}</span><input type="number" min="1" step="1" aria-label={`Damage or healing amount for ${combatant.name}`} value={hpAmounts[combatant.id] ?? '1'} onChange={(event) => setHpAmounts({ ...hpAmounts, [combatant.id]: event.target.value })} /></label><button type="button" className="combat-roll-button" onClick={() => void adjustHp(combatant, 'damage')}>Damage</button><button type="button" className="combat-roll-button" onClick={() => void adjustHp(combatant, 'heal')}>Heal</button><button type="button" className="combat-secondary-button" onClick={() => { setHpEdits({ ...hpEdits, [combatant.id]: { current: String(combatant.currentHp), max: String(combatant.maxHp) } }); setEditingHp({ ...editingHp, [combatant.id]: !editingHp[combatant.id] }) }}>{editingHp[combatant.id] ? 'Cancel edit' : 'Edit HP'}</button></div></div>
                  {combatant.type === 'player' && combatant.currentHp === 0 && <div className="combat-survival-panel" aria-label={`${combatant.name} survival actions`}><div className="combat-survival-counters"><span>Death save successes <b>{combatant.deathSaveSuccesses}/3</b></span><span>Failures <b>{combatant.deathSaveFailures}/3</b></span></div>{combatant.survivalStatus === 'unconscious' && <div className="combat-survival-actions"><button type="button" className="combat-primary-button" disabled={survivalSaving === combatant.id} onClick={() => void survivalAction(combatant, 'death-save')}>{survivalSaving === combatant.id ? 'Rolling…' : 'Roll Death Save'}</button><button type="button" className="combat-secondary-button" disabled={survivalSaving === combatant.id} onClick={() => void survivalAction(combatant, 'stabilize')}>Stabilize</button></div>}{combatant.survivalStatus === 'stable' && <p>Stable: no death saves are needed. Taking damage at 0 HP can cause a failed save.</p>}{combatant.survivalStatus === 'dead' && <p>Dead. The combat record and survival history are preserved.</p>}</div>}
                  {editingHp[combatant.id] && <div className="combat-hp-entry combat-hp-edit"><label className="combat-field"><span>Current HP</span><input type="number" min="0" step="1" value={hpEdits[combatant.id]?.current ?? combatant.currentHp} onChange={(event) => setHpEdits({ ...hpEdits, [combatant.id]: { current: event.target.value, max: hpEdits[combatant.id]?.max ?? String(combatant.maxHp) } })} /></label><label className="combat-field"><span>Maximum HP</span><input type="number" min="1" step="1" value={hpEdits[combatant.id]?.max ?? combatant.maxHp} onChange={(event) => setHpEdits({ ...hpEdits, [combatant.id]: { current: hpEdits[combatant.id]?.current ?? String(combatant.currentHp), max: event.target.value } })} /></label><button type="button" className="combat-secondary-button" onClick={() => void saveHp(combatant)}>Save HP</button></div>}
                  <div className="combat-condition-panel"><div className="combat-condition-list" aria-label={`Conditions on ${combatant.name}`}>{combatant.conditions.map((condition) => <span className="combat-condition-chip" key={condition.id} title={condition.mechanicalSummary}>{CONDITIONS.find((entry) => entry.key === condition.condition)?.label}{condition.level ? ` ${condition.level}` : ''}{condition.sourceCombatantId ? ` · source ${details.combatants.find((entry) => entry.id === condition.sourceCombatantId)?.name ?? 'unknown'}` : ['charmed', 'frightened', 'grappled'].includes(condition.condition) ? ' · source/context needed' : ''}{condition.notes ? ` · ${condition.notes}` : ''}{condition.contextWarning && <small className="combat-condition-context-warning">Context needed</small>}<button type="button" aria-label={`Remove ${condition.condition}${condition.level ? ` level ${condition.level}` : ''} from ${combatant.name}`} onClick={() => void removeConditionFromCombatant(combatant, condition)}>×</button></span>)}{combatant.conditions.length === 0 && <span className="combat-no-conditions">No conditions</span>}</div>{combatant.conditions.length > 0 && <ul className="combat-condition-rules-list">{combatant.conditions.map((condition) => <li key={condition.id}><strong>{CONDITIONS.find((entry) => entry.key === condition.condition)?.label}:</strong> {condition.mechanicalSummary}{condition.contextWarning && <span> {condition.contextWarning}</span>}</li>)}</ul>}<div className="combat-condition-entry"><label className="combat-field"><span>Add condition</span><select value={conditionDraftFor(combatant.id).condition} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), condition: event.target.value as ConditionKey } })}>{CONDITIONS.filter((condition) => condition.key === 'exhaustion' || !combatant.conditions.some((entry) => entry.condition === condition.key)).map((condition) => <option key={condition.key} value={condition.key}>{condition.label}</option>)}</select></label>{(conditionDrafts[combatant.id]?.condition ?? 'blinded') === 'exhaustion' && <label className="combat-field"><span>Level</span><select value={conditionDraftFor(combatant.id).level} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), condition: 'exhaustion', level: event.target.value } })}>{(combatant.conditions.some((entry) => entry.condition === 'exhaustion') ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]).map((level) => <option key={level} value={level}>{level}</option>)}</select></label>}<button type="button" className="combat-secondary-button" onClick={() => void updateCondition(combatant)}>{conditionDraftFor(combatant.id).condition === 'exhaustion' && combatant.conditions.some((entry) => entry.condition === 'exhaustion') ? 'Adjust level' : 'Add'}</button></div><div className="combat-condition-context"><label className="combat-field"><span>Condition source <small>needed for charmed, frightened, or grappled effects</small></span><select value={conditionDraftFor(combatant.id).sourceCombatantId} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), sourceCombatantId: event.target.value } })}><option value="">Unspecified · DM adjudication</option>{details.combatants.filter((entry) => entry.id !== combatant.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label className="combat-field"><span>Condition notes / reason</span><input maxLength={500} value={conditionDraftFor(combatant.id).notes} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), notes: event.target.value } })} placeholder="Reason required for rule overrides" /></label></div></div>
                  <div className="combat-condition-advanced">{combatant.survivalStatus === 'dead' && <p className="combat-condition-rules warning">Dead · the combatant is out of the encounter.</p>}<p className="combat-condition-duration">Turn and round durations advance only when the server processes a turn boundary. Fixed rounds decrease once per matching boundary; reset and page refresh do not advance them.</p>{combatant.conditions.map((entry) => <p className="combat-condition-duration" key={`duration-${entry.id}`}><strong>{entry.condition === 'exhaustion' ? `Exhaustion ${entry.level}` : entry.condition}</strong>{entry.durationType === 'indefinite' ? ' · indefinite / manual removal' : entry.durationType === 'turn_boundary' ? ` · expires at ${entry.durationTiming} of ${details.combatants.find((candidate) => candidate.id === entry.durationCombatantId)?.name ?? 'unknown'}’s turn` : entry.durationType === 'fixed_rounds' ? ` · ${entry.remainingRounds} rounds remain; ${entry.durationTiming} of ${details.combatants.find((candidate) => candidate.id === entry.durationCombatantId)?.name ?? 'unknown'}’s turn` : ` · recovery ${entry.recoveryAbility?.toUpperCase()} save DC ${entry.recoveryDc} at ${entry.recoveryTiming} of turn`}{entry.recoveryNotes ? ` · ${entry.recoveryNotes}` : ''}</p>)}<div className="combat-condition-entry">
                    <label className="combat-field"><span>Duration</span><select value={conditionDraftFor(combatant.id).durationType} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), durationType: event.target.value as 'indefinite'|'turn_boundary'|'fixed_rounds'|'recovery_save' } })}><option value="indefinite">Indefinite · manual removal</option><option value="turn_boundary">At a turn boundary</option><option value="fixed_rounds">Fixed rounds</option><option value="recovery_save">Recovery save</option></select></label>
                    {['turn_boundary','fixed_rounds'].includes(conditionDraftFor(combatant.id).durationType) && <><label className="combat-field"><span>Whose turn</span><select value={conditionDraftFor(combatant.id).durationCombatantId} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), durationCombatantId: event.target.value } })}>{details.combatants.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label className="combat-field"><span>Timing</span><select value={conditionDraftFor(combatant.id).durationTiming} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), durationTiming: event.target.value as 'start'|'end' } })}><option value="start">Start of turn</option><option value="end">End of turn</option></select></label></>}
                    {conditionDraftFor(combatant.id).durationType === 'fixed_rounds' && <label className="combat-field"><span>Rounds</span><input type="number" min="1" max="1000" step="1" value={conditionDraftFor(combatant.id).durationRounds} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), durationRounds: event.target.value } })} /></label>}
                    {conditionDraftFor(combatant.id).durationType === 'recovery_save' && <><label className="combat-field"><span>Recovery ability</span><select value={conditionDraftFor(combatant.id).recoveryAbility} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), recoveryAbility: event.target.value as 'str'|'dex'|'con'|'int'|'wis'|'cha' } })}>{[['str','Strength'],['dex','Dexterity'],['con','Constitution'],['int','Intelligence'],['wis','Wisdom'],['cha','Charisma']].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="combat-field"><span>Save DC</span><input type="number" min="1" max="40" step="1" value={conditionDraftFor(combatant.id).recoveryDc} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), recoveryDc: event.target.value } })} /></label><label className="combat-field"><span>Save timing</span><select value={conditionDraftFor(combatant.id).recoveryTiming} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), recoveryTiming: event.target.value as 'start'|'end' } })}><option value="start">Start of affected turn</option><option value="end">End of affected turn</option></select></label>{combatant.type === 'enemy' && <label className="combat-field"><span>NPC save modifier</span><input type="number" min="-30" max="30" step="1" value={conditionDraftFor(combatant.id).recoveryModifier} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), recoveryModifier: event.target.value } })} /></label>}</>}
                    <button type="button" className="combat-secondary-button" onClick={() => void updateCondition(combatant)}>Apply condition</button>
                  </div><div className="combat-condition-entry"><label className="combat-field"><span>DM adjustment / notes</span><input maxLength={300} value={conditionDraftFor(combatant.id).notes} onChange={(event) => setConditionDrafts({ ...conditionDrafts, [combatant.id]: { ...conditionDraftFor(combatant.id), notes: event.target.value } })} placeholder="Reason required for rule overrides" /></label>{combatant.conditions.filter((entry) => entry.condition !== 'exhaustion').map((entry) => <button type="button" className="combat-secondary-button" key={entry.id} onClick={() => void saveConditionDuration(combatant, entry)}>Set {entry.condition} duration</button>)}{combatant.conditions.filter((entry) => entry.durationType === 'recovery_save').map((entry) => <button type="button" className="combat-secondary-button" key={`resolve-${entry.id}`} onClick={() => void resolveRecoveryManually(combatant, entry)}>Resolve {entry.condition} save manually</button>)}</div></div>
                  <div className="combatant-controls"><button type="button" className="combat-roll-button" onClick={() => void setInitiative(combatant, 'rolled')}>{combatant.initiativeSource === 'rolled' ? 'Reroll d20' : 'Roll d20'}</button><label className="combat-manual-entry"><span className="visually-hidden">Manual initiative total for {combatant.name}</span><input type="number" min="-1000" max="1000" step="1" value={manualTotals[combatant.id] ?? (combatant.initiativeSource === 'manual' ? String(combatant.initiativeTotal) : '')} onChange={(event) => setManualTotals({ ...manualTotals, [combatant.id]: event.target.value })} placeholder="Manual total" /><button type="button" className="combat-secondary-button" disabled={manualTotals[combatant.id] === undefined && combatant.initiativeSource !== 'manual'} onClick={() => void setInitiative(combatant, 'manual')}>Set total</button></label><button type="button" className="combat-danger-link" onClick={() => void removeCombatant(combatant)}>Remove</button></div>
                </div>
              </article>})}</div>}
            </section>
  ) : null

  return <section className="combat-view" aria-labelledby="combat-heading">
    <header className="combat-page-heading"><div className="eyebrow"><span className="eyebrow-line" />THE ORDER OF BATTLE</div><h1 id="combat-heading">Combat <em>Encounters</em></h1><p>Gather the party, set initiative, and track each round.</p></header>
    {campaigns.length === 0 ? <div className="combat-empty"><span aria-hidden="true">⚔</span><h2>No campaigns available</h2><p>Create a campaign before preparing an encounter.</p></div> : <>
      <div className="combat-campaign-select"><label className="combat-field"><span>Campaign</span><select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label></div>
      <nav className="combat-section-nav" aria-label="Combat sections"><a href="#combat-order">Combatants</a><a href="#combat-action-economy-heading">Actions</a><a href="#combat-attack-heading">Attacks</a><a href="#combat-history">History</a></nav>
      <div className="combat-workspace">
        <div id="combat-order" className="combat-left-column">
        <aside className="combat-encounter-rail" aria-label="Saved encounters">
          <div className="combat-rail-heading"><div className="eyebrow small"><span className="eyebrow-line" />ENCOUNTERS</div><strong>{encounters.length}</strong></div>
          {loading && encounters.length === 0 ? <p className="combat-muted">Loading…</p> : encounters.length === 0 ? <p className="combat-muted">No saved encounters yet.</p> : <div className="combat-encounter-list">{encounters.map((encounter) => <button type="button" className={`combat-encounter-choice${encounter.id === encounterId ? ' selected' : ''}`} key={encounter.id} onClick={() => setEncounterId(encounter.id)}><span>{encounter.name}</span><small>{encounter.status === 'active' ? `Round ${encounter.round}` : 'Setup'}</small></button>)}</div>}
          <form className="combat-new-form" onSubmit={(event) => void createEncounter(event)}><label className="combat-field"><span>New encounter</span><input required maxLength={120} value={newEncounterName} onChange={(event) => setNewEncounterName(event.target.value)} placeholder="The Ashen Bridge" /></label><button className="combat-primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : '＋ Create encounter'}</button></form>
        </aside>

        {combatantsPanel}
        </div>

        <div className="combat-main-panel">
          {error && <div className="combat-feedback error" role="alert">{error}<button type="button" onClick={() => { setError(''); if (encounterId) void refreshEncounter() }}>Dismiss</button></div>}
          {notice && <div className="combat-feedback success" role="status">✦ {notice}</div>}
          {details && <section className="combat-condition-history" aria-labelledby="condition-history-heading"><div className="combatants-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />CONDITION LEDGER</div><h3 id="condition-history-heading">Condition history</h3></div><span>Saved with this encounter</span></div>{conditionHistory.length === 0 ? <p className="combat-muted">No condition events recorded.</p> : <ol>{conditionHistory.slice(0, 12).map((event) => <li key={event.id}><strong>{details.combatants.find((entry) => entry.id === event.combatantId)?.name ?? 'Combatant'}</strong><span>{event.condition.replaceAll('_', ' ')} · {event.eventType.replaceAll('_', ' ')}</span><small>{conditionEventText(event)} · {new Date(event.createdAt).toLocaleString()}</small></li>)}</ol>}</section>}
          {!details ? <div className="combat-no-encounter"><span aria-hidden="true">✧</span><h2>{loading ? 'Opening encounter…' : 'Choose your first encounter'}</h2><p>Select a saved encounter or create one to arrange the combatants.</p></div> : <>
            <div className="combat-encounter-heading"><div className="combat-encounter-title"><div className="eyebrow small"><span className="eyebrow-line" />{details.encounter.status === 'active' ? `ROUND ${details.encounter.round}` : 'ENCOUNTER SETUP'}</div><h2>{details.encounter.name}</h2><p>{details.combatants.length} {details.combatants.length === 1 ? 'combatant' : 'combatants'} · ties use insertion order</p></div><button type="button" className="combat-danger-button" onClick={() => void deleteEncounter()}>Delete encounter</button></div>
            <form className="combat-rename-form" onSubmit={(event) => void renameEncounter(event)}><label className="combat-field"><span>Encounter name</span><input required maxLength={120} value={encounterName} onChange={(event) => setEncounterName(event.target.value)} /></label><button type="submit" className="combat-secondary-button" disabled={saving || encounterName.trim() === details.encounter.name}>Rename</button></form>
            <div className={`combat-round-banner${details.encounter.status === 'active' ? ' active' : ''}`}><div><span>{details.encounter.status === 'active' ? 'ACTIVE TURN' : 'TURN TRACKING'}</span><strong>{details.encounter.status === 'active' ? sortedCombatants.find((combatant) => combatant.id === details.encounter.activeCombatantId)?.name ?? 'No active combatant' : 'Encounter not started'}</strong></div><div className="combat-round-number"><span>ROUND</span><strong>{details.encounter.round || '—'}</strong></div></div>
            <div className="combat-turn-actions">{details.encounter.status === 'setup' ? <button className="combat-primary-button" type="button" disabled={actionBusy || details.combatants.length === 0 || details.combatants.some((combatant) => combatant.initiativeTotal === null)} onClick={() => void encounterAction('start')}>⚔ Start encounter</button> : <><button className="combat-primary-button" type="button" disabled={actionBusy} onClick={() => void encounterAction('next-turn')}>Next turn <span>↗</span></button><button className="combat-secondary-button" type="button" disabled={actionBusy} onClick={() => void encounterAction('reset')}>Reset turn tracking</button></>}{details.combatants.some((combatant) => combatant.initiativeTotal === null) && <small>Set initiative for every combatant to start.</small>}</div>

            <div className="combat-add-panels">
              <form className="combat-add-form" onSubmit={(event) => void addPlayer(event)}><div className="eyebrow small"><span className="eyebrow-line" />PLAYER CHARACTER</div><label className="combat-field"><span>Campaign character</span><select value={selectedCharacterId} onChange={(event) => setSelectedCharacterId(event.target.value)} disabled={!availableCharacters.length}><option value="">{availableCharacters.length ? 'Choose a character' : 'No available characters'}</option>{availableCharacters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.playerName}</option>)}</select></label><div className="combat-hp-entry"><label className="combat-field"><span>Current HP</span><input type="number" min="0" step="1" value={playerHp.current} onChange={(event) => setPlayerHp({ ...playerHp, current: event.target.value })} /></label><label className="combat-field"><span>Maximum HP</span><input type="number" min="1" step="1" value={playerHp.max} onChange={(event) => setPlayerHp({ ...playerHp, max: event.target.value })} /></label></div><button className="combat-secondary-button" type="submit" disabled={saving || !selectedCharacterId}>＋ Add character</button></form>
              <form className="combat-add-form" onSubmit={(event) => void addEnemy(event)}><div className="eyebrow small"><span className="eyebrow-line" />ENEMY COMBATANT</div><div className="combat-enemy-fields"><label className="combat-field"><span>Enemy name</span><input required maxLength={120} value={enemyName} onChange={(event) => setEnemyName(event.target.value)} placeholder="Bandit captain" /></label><label className="combat-field modifier-field"><span>Initiative mod</span><input type="number" min="-100" max="100" step="1" value={enemyModifier} onChange={(event) => setEnemyModifier(event.target.value)} /></label></div><div className="combat-hp-entry"><label className="combat-field"><span>Current HP</span><input type="number" min="0" step="1" value={enemyHp.current} onChange={(event) => setEnemyHp({ ...enemyHp, current: event.target.value })} /></label><label className="combat-field"><span>Maximum HP</span><input type="number" min="1" step="1" value={enemyHp.max} onChange={(event) => setEnemyHp({ ...enemyHp, max: event.target.value })} /></label></div><div className="combat-enemy-combat-stats"><label className="combat-field"><span>Enemy AC <small>optional manual value</small></span><input type="number" min="1" max="50" step="1" value={enemyArmorClass} onChange={(event) => setEnemyArmorClass(event.target.value)} placeholder="Not configured" /></label><label className="combat-field"><span>Attack bonus <small>optional manual value</small></span><input type="number" min="-20" max="50" step="1" value={enemyAttackBonus} onChange={(event) => setEnemyAttackBonus(event.target.value)} placeholder="Not configured" /></label><label className="combat-field"><span>Damage formula <small>optional · e.g. 1d6+2</small></span><input maxLength={20} value={enemyDamageFormula} onChange={(event) => setEnemyDamageFormula(event.target.value)} placeholder="Not configured" /></label><label className="combat-field"><span>Damage type</span><select value={enemyDamageType} onChange={(event) => setEnemyDamageType(event.target.value)}>{DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type[0]!.toUpperCase() + type.slice(1)}</option>)}</select></label></div><button className="combat-secondary-button" type="submit" disabled={saving}>＋ Add enemy</button></form>
            </div>

            <section id="combat-action-economy" className="combat-action-economy" aria-labelledby="combat-action-economy-heading"><div className="combat-action-core">
              <div className="combatants-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />TURN RESOURCES</div><h3 id="combat-action-economy-heading">Action Economy</h3></div><span>{activeCombatant ? `Active: ${activeCombatant.name}` : 'Start the encounter to track turn resources'}</span></div>
              {activeEconomy?.actionRestricted && <p className="combat-speed-warning" role="status">{activeEconomy.actionRestrictionConditions.join(', ')} prevents Actions, Bonus Actions, and Reactions. {activeEconomy.adjudication.join(' ')}</p>}
              {activeEconomy?.speedRestrictions.map((reason) => <p className="combat-speed-warning" key={reason}>{reason} · effective Speed 0</p>)}
              {activeEconomy?.prone && <p className="combat-condition-rules">Prone: movement is limited to crawling or standing, which costs {activeEconomy.standCost ?? 'half of base Speed'} feet of movement. Standing is unavailable while Speed is 0.</p>}
              {activeEconomy?.adjudication.filter((message) => !activeEconomy.actionRestricted || !message.startsWith('Stunned')).map((message) => <p className="combat-condition-rules" key={message}>{message}</p>)}
              <div className="combat-dm-override"><label><input type="checkbox" checked={actionDmOverride} onChange={(event) => setActionDmOverride(event.target.checked)} />Explicit DM override for condition restrictions</label><label className="visually-hidden" htmlFor="action-override-reason">DM override reason</label><input id="action-override-reason" maxLength={300} value={actionOverrideReason} onChange={(event) => setActionOverrideReason(event.target.value)} placeholder="Reason required when overriding" /></div>
              {!activeCombatant || !activeEconomy ? <p className="combat-muted">Action resources appear when turn tracking is active.</p> : <>
                <div className="combat-action-resource-grid">
                  {([['action','Action','actionUsed'],['bonusAction','Bonus Action','bonusActionUsed'],['reaction','Reaction','reactionUsed']] as const).map(([resource,label,key]) => <div className="combat-action-resource" key={resource}><span>{label}</span><strong className={activeEconomy[key] ? 'used' : 'available'}>{activeEconomy[key] ? 'Used' : 'Available'}</strong><button type="button" className="combat-secondary-button" disabled={actionBusy} onClick={() => void performEconomy({ kind:'resource_override', combatantId:activeCombatant.id, resource, available:activeEconomy[key] }, `${label} manually marked ${activeEconomy[key] ? 'available' : 'used'}.`)}>Mark {activeEconomy[key] ? 'available' : 'used'}</button></div>)}
                </div>
                <div className="combat-action-movement"><div><b>Movement</b><span>{activeEconomy.movementUsed} ft used · {Math.max(0, activeEconomy.effectiveSpeed + (activeEconomy.effectiveSpeed ? activeEconomy.dashBonusMovement : 0) - activeEconomy.movementUsed)} ft remaining</span><small>Base {activeEconomy.movementAllowance} ft · Effective {activeEconomy.effectiveSpeed} ft{activeEconomy.dashBonusMovement ? ` + ${activeEconomy.dashBonusMovement} ft Dash` : ''}</small></div><label className="combat-field"><span>Record movement (ft)</span><input type="number" min="0" max="300" step="1" value={movementDraft} onChange={(event) => setMovementDraft(event.target.value)} /></label><button type="button" className="combat-secondary-button" disabled={actionBusy || !/^\d+$/.test(movementDraft)} onClick={() => void performEconomy({kind:'movement',combatantId:activeCombatant.id,distance:Number(movementDraft)},'Movement recorded.')}>Record</button><label className="combat-field"><span>Manual allowance (ft)</span><input type="number" min="0" max="300" step="1" value={allowanceDraft || String(activeEconomy.movementAllowance)} onChange={(event) => setAllowanceDraft(event.target.value)} /></label><button type="button" className="combat-secondary-button" disabled={actionBusy || !/^\d+$/.test(allowanceDraft)} onClick={() => void performEconomy({kind:'movement_allowance',combatantId:activeCombatant.id,movementAllowance:Number(allowanceDraft)},'Movement allowance updated manually.')}>Set allowance</button></div>
                <div className="combat-tactical-actions"><div className="combat-action-buttons"><button type="button" className="combat-secondary-button" disabled={actionBusy || activeEconomy.actionUsed} onClick={() => void performEconomy({kind:'dash',combatantId:activeCombatant.id},'Dash used; movement increased by the configured allowance.')}>Dash</button><button type="button" className="combat-secondary-button" disabled={actionBusy || activeEconomy.actionUsed || activeEconomy.disengageActive} onClick={() => void performEconomy({kind:'disengage',combatantId:activeCombatant.id},'Disengage is active for this turn.')}>Disengage</button><button type="button" className="combat-secondary-button" disabled={actionBusy || activeEconomy.actionUsed || activeEconomy.dodgeActive} onClick={() => void performEconomy({kind:'dodge',combatantId:activeCombatant.id},'Dodge is active until this combatant’s next turn.')}>Dodge</button><button type="button" className="combat-danger-button" disabled={actionBusy} onClick={() => void performEconomy({kind:'reset',combatantId:activeCombatant.id},'Action economy manually reset for the active combatant.')}>Reset this combatant</button></div>
                  <p className="combat-action-effects">{activeEconomy.disengageActive && <span>Disengage · remainder of current turn</span>}{activeEconomy.dodgeActive && <span>Dodge · until start of next turn</span>}{!activeEconomy.disengageActive && !activeEconomy.dodgeActive && <small>No active personal effects.</small>}</p>
                  <form className="combat-action-form" onSubmit={(event) => {event.preventDefault(); if(!helpTargetId||!helpDescriptionDraft.trim())return; void performEconomy({kind:'help',combatantId:activeCombatant.id,targetId:helpTargetId,helpUse:helpUseDraft,description:helpDescriptionDraft},'Help recorded; its benefit is tracked without automatically changing rolls.');setHelpDescriptionDraft('')}}><label className="combat-field"><span>Help ally</span><select value={helpTargetId} onChange={(event)=>setHelpTargetId(event.target.value)}><option value="">Choose ally</option>{activeAllies.map((entry)=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label className="combat-field"><span>Help use</span><select value={helpUseDraft} onChange={(event)=>setHelpUseDraft(event.target.value as 'ability_check'|'attack')}><option value="ability_check">Ability check</option><option value="attack">Attack</option></select></label><label className="combat-field"><span>Describe assistance</span><input maxLength={300} value={helpDescriptionDraft} onChange={(event)=>setHelpDescriptionDraft(event.target.value)} placeholder="Distracts the sentry" /></label><button className="combat-secondary-button" type="submit" disabled={actionBusy||activeEconomy.actionUsed||!activeAllies.length||!helpDescriptionDraft.trim()}>Help</button></form>
                  <form className="combat-action-form" onSubmit={(event)=>{event.preventDefault();if(!readyTriggerDraft.trim()||!readyResponseDraft.trim())return;void performEconomy({kind:'ready',combatantId:activeCombatant.id,trigger:readyTriggerDraft,response:readyResponseDraft},'Ready action recorded; resolve it manually when its trigger occurs.');setReadyTriggerDraft('');setReadyResponseDraft('')}}><label className="combat-field"><span>Ready trigger</span><input maxLength={300} value={readyTriggerDraft} onChange={(event)=>setReadyTriggerDraft(event.target.value)} placeholder="When the cultist enters reach" /></label><label className="combat-field"><span>Intended response</span><input maxLength={300} value={readyResponseDraft} onChange={(event)=>setReadyResponseDraft(event.target.value)} placeholder="Strike with my longsword" /></label><button className="combat-secondary-button" type="submit" disabled={actionBusy||activeEconomy.actionUsed||!readyTriggerDraft.trim()||!readyResponseDraft.trim()}>Ready</button></form>
                </div>
              </>}
              </div>
              <div className="combat-action-effects-list"><h4>Active tactical effects</h4>{!actionEconomy?.effects.length?<p className="combat-muted">No active Help or Ready effects.</p>:actionEconomy.effects.map((effect)=><article key={effect.id}><div><strong>{effect.kind==='help'?'Help':'Ready'} · {effect.ownerName}</strong><p>{effect.kind==='help'?`${effect.helpUse==='attack'?'Attack':'Ability check'} for ${effect.targetName}: ${effect.description}`:`When ${effect.triggerText}, ${effect.responseText}`}</p><small>Expires at the start of {effect.ownerName}’s next turn.</small></div>{effect.kind==='ready'&&<div className="combat-action-buttons"><button type="button" className="combat-secondary-button" disabled={actionBusy||Boolean(actionEconomy.states.find((s)=>s.combatantId===effect.ownerCombatantId)?.reactionUsed)} onClick={()=>void performEconomy({kind:'ready_resolve',combatantId:activeCombatant?.id??effect.ownerCombatantId,effectId:effect.id},'Ready response resolved; Reaction spent.')}>Resolve · use Reaction</button><button type="button" className="combat-danger-button" disabled={actionBusy} onClick={()=>void performEconomy({kind:'ready_cancel',combatantId:effect.ownerCombatantId,effectId:effect.id},'Ready action cancelled.')}>Cancel</button></div>}</article>)}</div>
              <div className="combat-action-history"><h4>Recent action history</h4>{!actionEconomy?.events.length?<p className="combat-muted">Actions and manual overrides will be recorded here.</p>:actionEconomy.events.slice(0,12).map((entry)=><p key={entry.id}><strong>{entry.combatantName}</strong> · {entry.kind.replaceAll('_',' ')}{Object.keys(entry.details).length>0&&<span> · {Object.entries(entry.details).map(([key,value])=>`${key.replaceAll('_',' ')}: ${String(value)}`).join(' · ')}</span>} <small>{new Date(entry.createdAt).toLocaleString()}</small></p>)}</div>
            </section>

            <section className="combat-attack-section" aria-labelledby="combat-attack-heading"><div className="combat-attack-core">
              <div className="combatants-heading"><div><div className="eyebrow small"><span className="eyebrow-line" />ATTACK ROLLS</div><h3 id="combat-attack-heading">Resolve an attack</h3></div><span>Server-rolled d20 · no damage applied</span></div>
              {details.combatants.length < 2 ? <p className="combat-muted">Add at least two combatants to roll an attack.</p> : <form className="combat-attack-form" onSubmit={(event) => void rollAttack(event)}>
                <label className="combat-field"><span>Attacker</span><select value={attackAttackerId} onChange={(event) => { setAttackAttackerId(event.target.value); setAttackWeaponId('') }}>{details.combatants.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.type === 'player' ? 'Player' : 'Enemy'}</option>)}</select></label>
                <label className="combat-field"><span>Target</span><select value={attackTargetId} onChange={(event) => setAttackTargetId(event.target.value)}>{attackTargets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
                {attackAttacker?.type === 'player' ? <><label className="combat-field"><span>Equipped weapon</span><select value={attackWeaponId} onChange={(event) => setAttackWeaponId(event.target.value)} disabled={!attackWeapons.length}><option value="">{attackWeapons.length ? 'Choose a weapon' : 'No equipped weapons'}</option>{attackWeapons.map((weapon) => {
                  const bonus = calculateWeaponAttackBonus({ abilityScores: { str: attackerBuild!.str, dex: attackerBuild!.dex, con: attackerBuild!.con, int: attackerBuild!.int, wis: attackerBuild!.wis, cha: attackerBuild!.cha }, level: attackerBuild!.level, weaponDefinitionId: weapon.weaponDefinitionId, weaponAbility: weapon.weaponAbility, proficient: Boolean(weapon.weaponDefinitionId && attackerBuild!.weaponProficiencies.includes(weapon.weaponDefinitionId)), manualOverride: weapon.manualAttackBonus })
                  return <option key={weapon.id} value={weapon.id}>{weapon.name} · {bonus.configured ? `${signed(bonus.total ?? 0)} attack` : 'Not configured'}</option>
                })}</select></label>{versatileFormula && <label className="combat-field"><span>Versatile use</span><select value={attackWeaponUse} onChange={(event) => setAttackWeaponUse(event.target.value as 'one_handed' | 'two_handed')}><option value="one_handed">One-handed · {selectedWeaponDefinition?.damage}</option><option value="two_handed">Two-handed · {versatileFormula} {selectedWeaponDefinition?.damage.split(' ').slice(1).join(' ')}</option></select></label>}</> : <div className="combat-attack-config"><span>Enemy attack bonus</span><strong>{attackAttacker?.attackModifier === null || attackAttacker?.attackModifier === undefined ? 'Not configured' : signed(attackAttacker.attackModifier)}</strong></div>}
                <label className="combat-field"><span>Roll mode</span><select value={attackMode} onChange={(event) => setAttackMode(event.target.value as AttackMode)}><option value="normal">Normal</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option></select></label>
                <label className="combat-field"><span>Situational modifier</span><input type="number" min="-100" max="100" step="1" value={attackModifierDraft} onChange={(event) => setAttackModifierDraft(event.target.value)} /></label>
                <label className="combat-action-consume"><input type="checkbox" checked={consumeAttackAction} disabled={attackAttacker?.id!==activeCombatant?.id||!activeEconomy||activeEconomy.actionUsed} onChange={(event)=>setConsumeAttackAction(event.target.checked)} /><span>Spend this attacker’s Action for this attack {attackAttacker?.id===activeCombatant?.id?`(${activeEconomy?.actionUsed?'used':'available'})`:'(attacker must be active)'}</span></label>
                {consumeAttackAction && <p className="combat-attack-hint">Requires this attacker to be the active combatant with an Action available. Unchecked attacks do not change action economy.</p>}
                <details className="combat-context-fields"><summary>Condition context · required for distance and visibility rules</summary><label className="combat-field"><span>Distance between attacker and target (ft)</span><input type="number" min="0" max="10000" step="1" value={distanceDraft} onChange={(event) => setDistanceDraft(event.target.value)} placeholder="Unknown · adjudicate manually" /></label><label className="combat-field"><span>Can attacker see target?</span><select value={attackerSight} onChange={(event) => setAttackerSight(event.target.value)}><option value="">Unknown · adjudicate manually</option><option value="yes">Yes</option><option value="no">No</option></select></label><label className="combat-field"><span>Can target see attacker?</span><select value={targetSight} onChange={(event) => setTargetSight(event.target.value)}><option value="">Unknown · adjudicate manually</option><option value="yes">Yes</option><option value="no">No</option></select></label><label className="combat-field"><span>Is frightened source in line of sight?</span><select value={fearSourceSight} onChange={(event) => setFearSourceSight(event.target.value)}><option value="">Unknown · adjudicate manually</option><option value="yes">Yes</option><option value="no">No</option></select></label><div className="combat-dm-override"><label><input type="checkbox" checked={attackDmOverride} onChange={(event) => setAttackDmOverride(event.target.checked)} />Explicit DM override for incapacitating condition</label><label className="visually-hidden" htmlFor="attack-override-reason">DM override reason</label><input id="attack-override-reason" maxLength={300} value={attackOverrideReason} onChange={(event) => setAttackOverrideReason(event.target.value)} placeholder="Reason required when overriding" /></div></details>
                <button type="submit" className="combat-primary-button" disabled={attackSaving || !attackAttackerId || !attackTargetId || details.combatants.length < 2 || targetArmorClass === null || (attackAttacker?.type === 'player' && !configuredAttackWeapon?.configured) || (attackAttacker?.type === 'enemy' && attackAttacker.attackModifier === null)}>{attackSaving ? 'Rolling…' : '⚔ Roll attack'}</button>
                {attackAttacker?.type === 'player' && <p className="combat-attack-hint">{configuredAttackWeapon?.configured ? `${selectedAttackWeapon?.name}: ${signed(configuredAttackWeapon.total ?? 0)} base attack bonus · verified again by the server.` : 'Choose an equipped weapon with a configured attack bonus.'}</p>}
                {attackAttacker?.type === 'enemy' && attackAttacker.attackModifier === null && <p className="combat-attack-hint">Set this enemy’s manual attack bonus above before rolling.</p>}
                <p className="combat-attack-hint">Target AC: {targetArmorClass ?? 'Not configured'}{targetArmorClass !== null ? ' · verified again by the server.' : ' · configure AC before rolling.'}</p>
              </form>}
              </div>
              <div id="combat-history" className="combat-attack-history"><div className="combat-attack-history-heading"><h4>Recent attacks &amp; damage</h4><span>{attackHistoryLoading ? 'Loading…' : `${attackHistory.length} saved`}</span></div>
                {attackHistory.length === 0 ? <p className="combat-muted">Attack rolls for this encounter will appear here.</p> : <div className="combat-attack-list">{attackHistory.slice(0, 12).map((attack) => <article className={`combat-attack-result ${attack.outcome}`} key={attack.id}>
                  <div className="combat-attack-result-heading"><strong>{attack.attackerName} → {attack.targetName}</strong><span className="combat-attack-total">{attack.total}</span><span className={`combat-attack-outcome ${attack.outcome}`}>{attack.outcome === 'critical_hit' ? 'Critical Hit' : attack.outcome === 'hit' ? 'Hit' : 'Miss'}</span></div>
                  <p>{attack.weaponName ? `${attack.weaponName} · ` : ''}Requested {attack.conditionSnapshot?.manualMode ?? attack.mode}; effective {attack.mode} · d20 {attack.diceResults.map((die, index) => `${die}${index === attack.keptIndex ? ' (kept)' : ''}`).join(' / ')}</p>
                  <p className="combat-attack-breakdown">{attack.breakdown} · target AC {attack.targetAC}</p>
                  {attack.conditionSnapshot && <div className="combat-condition-snapshot"><strong>Condition rules:</strong> {attack.conditionSnapshot.advantageSources.length ? `Advantage: ${attack.conditionSnapshot.advantageSources.join(', ')}. ` : ''}{attack.conditionSnapshot.disadvantageSources.length ? `Disadvantage: ${attack.conditionSnapshot.disadvantageSources.join(', ')}. ` : ''}{attack.conditionSnapshot.exhaustionLevel ? `Exhaustion ${attack.conditionSnapshot.exhaustionLevel}: ${signed(attack.conditionSnapshot.exhaustionPenalty ?? 0)} to this D20 Test. ` : ''}{attack.conditionSnapshot.criticalOnHit && attack.outcome === 'critical_hit' ? 'Condition critical hit verified within 5 feet. ' : ''}{attack.conditionSnapshot.dmOverride ? `DM override: ${attack.conditionSnapshot.overrideReason}. ` : ''}{attack.conditionSnapshot.warnings.map((warning) => <span className="combat-condition-rules warning" key={warning}>{warning} </span>)}</div>}
                  <DamageControls attack={attack} rolls={damageHistory.filter((entry) => entry.attackId === attack.id)} modifier={damageModifierDrafts[attack.id] ?? '0'} disabled={damageSaving} onModifierChange={(value) => setDamageModifierDrafts((current) => ({ ...current, [attack.id]: value }))} onRoll={() => void rollDamage(attack)} onApply={(roll) => void applyDamage(roll)} />
                  <time dateTime={attack.createdAt}>{new Date(attack.createdAt).toLocaleString()}</time>
                </article>)}</div>}
              </div>
            </section>
            <CombatSpellResolution campaignId={campaignId} encounterId={encounterId} combatants={details.combatants} characters={characters} />
            <CombatSpellEffects campaignId={campaignId} encounterId={encounterId} combatants={details.combatants} characters={characters} />
            <section className="combat-survival-feed" aria-labelledby="combat-survival-feed-heading"><h3 id="combat-survival-feed-heading">Survival events</h3>{recentSurvivalEvents.length === 0 ? <p className="combat-muted">Death saves and recovery events will appear here.</p> : <ol>{recentSurvivalEvents.map((entry) => <li key={entry.id}><strong>{entry.combatantName}</strong> · {entry.detail}{entry.naturalRoll !== null ? ` · d20 ${entry.naturalRoll}` : ''}</li>)}</ol>}</section>

          </>}
        </div>
      </div>
    </>}
  </section>
}
