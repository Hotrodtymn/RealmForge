import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import survivalStore = require('./survivalStore')
import actionEconomyStore = require('./actionEconomyStore')
import conditionRules = require('./conditionRules')
import conditionStore = require('./conditionStore')

namespace combatStore {
  export type EncounterStatus = 'setup' | 'active'
  export type CombatantType = 'player' | 'enemy'
  export type InitiativeSource = 'rolled' | 'manual'
  export const conditionKeys = [
    'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated',
    'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained',
    'stunned', 'unconscious', 'exhaustion',
  ] as const
  export type ConditionKey = typeof conditionKeys[number]

  export interface CombatantCondition {
    id: string
    combatantId: string
    condition: ConditionKey
    level: number | null
    sourceCombatantId: string | null
    notes: string
    mechanicalSummary: string
    contextWarning: string | null
    durationType: conditionStore.DurationType
    durationCombatantId: string | null
    durationTiming: conditionStore.Timing | null
    remainingRounds: number | null
    originalDuration: string
    recoveryAbility: conditionStore.RecoveryConfig['ability'] | null
    recoveryDc: number | null
    recoveryTiming: conditionStore.Timing | null
    recoveryNotes: string
    recoveryModifier: number | null
    createdAt: string
  }

  export interface Encounter {
    id: string
    campaignId: string
    name: string
    status: EncounterStatus
    round: number
    activeCombatantId: string | null
    createdAt: string
    updatedAt: string
  }

  export interface Combatant {
    id: string
    encounterId: string
    characterId: string | null
    type: CombatantType
    name: string
    initiativeModifier: number
    initiativeSource: InitiativeSource | null
    initiativeRoll: number | null
    initiativeTotal: number | null
    initiativeExhaustionPenalty: number
    insertionOrder: number
    currentHp: number
    maxHp: number
    deathSaveSuccesses: number
    deathSaveFailures: number
    survivalStatus: 'conscious' | 'unconscious' | 'stable' | 'dead'
    armorClassOverride: number | null
    attackModifier: number | null
    damageFormula: string | null
    damageType: string | null
    conditions: CombatantCondition[]
    createdAt: string
    updatedAt: string
  }

  export interface EncounterDetails {
    encounter: Encounter
    combatants: Combatant[]
  }

  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  function requireCampaign(campaignId: string): void {
    if (!database.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId)) {
      throw new HttpError(404, 'Campaign not found.')
    }
  }

  function requireEncounter(campaignId: string, encounterId: string): Encounter {
    const row = database.prepare(`
      SELECT id, campaignId, name, status, round, activeCombatantId, createdAt, updatedAt
      FROM encounters WHERE id = ? AND campaignId = ?
    `).get(encounterId, campaignId)
    if (!row) throw new HttpError(404, 'Encounter not found for this campaign.')
    return row as unknown as Encounter
  }

  function requireCombatant(campaignId: string, encounterId: string, combatantId: string): Combatant {
    requireEncounter(campaignId, encounterId)
    const row = database.prepare(`
      SELECT id, encounterId, characterId, type, name, initiativeModifier, initiativeSource,
        initiativeRoll, initiativeTotal, initiativeExhaustionPenalty, insertionOrder, currentHp, maxHp, deathSaveSuccesses, deathSaveFailures, survivalStatus, armorClassOverride, attackModifier, damageFormula, damageType, createdAt, updatedAt
      FROM encounter_combatants WHERE id = ? AND encounterId = ?
    `).get(combatantId, encounterId)
    if (!row) throw new HttpError(404, 'Combatant not found in this encounter.')
    return row as unknown as Combatant
  }

  function getCombatants(encounterId: string): Combatant[] {
    const rows = database.prepare(`
      SELECT id, encounterId, characterId, type, name, initiativeModifier, initiativeSource,
        initiativeRoll, initiativeTotal, initiativeExhaustionPenalty, insertionOrder, currentHp, maxHp, deathSaveSuccesses, deathSaveFailures, survivalStatus, armorClassOverride, attackModifier, damageFormula, damageType, createdAt, updatedAt
      FROM encounter_combatants WHERE encounterId = ?
      ORDER BY initiativeTotal IS NULL ASC, initiativeTotal DESC, insertionOrder ASC
    `).all(encounterId) as unknown as Omit<Combatant, 'conditions'>[]
    const conditionRows = database.prepare(`
      SELECT * FROM combatant_conditions
      WHERE combatantId IN (SELECT id FROM encounter_combatants WHERE encounterId = ?)
      ORDER BY rowid ASC
    `).all(encounterId) as unknown as CombatantCondition[]
    const conditionsByCombatant = new Map<string, CombatantCondition[]>()
    for (const condition of conditionRows) {
      const entries = conditionsByCombatant.get(condition.combatantId) ?? []
      entries.push(condition)
      conditionsByCombatant.set(condition.combatantId, entries)
    }
    return rows.map((row) => ({ ...row, conditions: (conditionsByCombatant.get(row.id) ?? []).map((entry) => ({ ...entry, mechanicalSummary: entry.condition === 'exhaustion' ? `Level ${entry.level}: ${Math.abs(conditionRules.exhaustionPenalty(Number(entry.level)))} penalty to D20 Tests and ${Number(entry.level) * 5} feet less Speed; level 6 causes death.` : conditionRules.summary(entry.condition), contextWarning: conditionRules.contextWarning(entry.condition, entry.sourceCombatantId) })) }))
  }

  function details(campaignId: string, encounterId: string): EncounterDetails {
    return { encounter: requireEncounter(campaignId, encounterId), combatants: getCombatants(encounterId) }
  }

  function nextInsertionOrder(encounterId: string): number {
    const row = database.prepare('SELECT coalesce(max(insertionOrder), -1) + 1 AS next FROM encounter_combatants WHERE encounterId = ?')
      .get(encounterId) as { next: number }
    return row.next
  }

  function insertCombatant(
    encounterId: string, type: CombatantType, name: string, characterId: string | null, initiativeModifier: number,
    currentHp: number, maxHp: number,
    armorClassOverride: number | null = null, attackModifier: number | null = null,
    damageFormula: string | null = null, damageType: string | null = null,
  ): Combatant {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO encounter_combatants (
        id, encounterId, characterId, type, name, initiativeModifier, initiativeSource,
        initiativeRoll, initiativeTotal, insertionOrder, currentHp, maxHp, deathSaveSuccesses, deathSaveFailures, survivalStatus, armorClassOverride, attackModifier, damageFormula, damageType, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, encounterId, characterId, type, name, initiativeModifier, nextInsertionOrder(encounterId), currentHp, maxHp, currentHp === 0 && type === 'player' ? 'unconscious' : 'conscious', armorClassOverride, attackModifier, damageFormula, damageType, now, now)
    database.prepare('INSERT OR IGNORE INTO encounter_action_state(combatantId) VALUES (?)').run(id)
    if (currentHp === 0 && type === 'player') database.prepare("INSERT OR IGNORE INTO combatant_conditions (id,combatantId,condition,level,createdAt) VALUES (?,?, 'unconscious',NULL,?)").run(crypto.randomUUID(), id, now)
    return database.prepare(`
      SELECT id, encounterId, characterId, type, name, initiativeModifier, initiativeSource,
        initiativeRoll, initiativeTotal, insertionOrder, currentHp, maxHp, deathSaveSuccesses, deathSaveFailures, survivalStatus, armorClassOverride, attackModifier, damageFormula, damageType, createdAt, updatedAt
      FROM encounter_combatants WHERE id = ?
    `).get(id) as unknown as Omit<Combatant, 'conditions'> as Combatant
  }

  export function listEncounters(campaignId: string): Encounter[] {
    requireCampaign(campaignId)
    return database.prepare(`
      SELECT id, campaignId, name, status, round, activeCombatantId, createdAt, updatedAt
      FROM encounters WHERE campaignId = ? ORDER BY updatedAt DESC, createdAt DESC, rowid DESC
    `).all(campaignId) as unknown as Encounter[]
  }

  export function getEncounter(campaignId: string, encounterId: string): EncounterDetails {
    return details(campaignId, encounterId)
  }

  export function createEncounter(campaignId: string, name: string): EncounterDetails {
    return transaction(() => {
      requireCampaign(campaignId)
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      database.prepare(`
        INSERT INTO encounters (id, campaignId, name, status, round, activeCombatantId, createdAt, updatedAt)
        VALUES (?, ?, ?, 'setup', 0, NULL, ?, ?)
      `).run(id, campaignId, name, now, now)
      return details(campaignId, id)
    })
  }

  export function renameEncounter(campaignId: string, encounterId: string, name: string): EncounterDetails {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      database.prepare('UPDATE encounters SET name = ?, updatedAt = ? WHERE id = ? AND campaignId = ?')
        .run(name, new Date().toISOString(), encounterId, campaignId)
      return details(campaignId, encounterId)
    })
  }

  export function deleteEncounter(campaignId: string, encounterId: string): void {
    transaction(() => {
      requireEncounter(campaignId, encounterId)
      database.prepare('DELETE FROM encounters WHERE id = ? AND campaignId = ?').run(encounterId, campaignId)
    })
  }

  export function addPlayer(campaignId: string, encounterId: string, characterId: string, currentHp: number, maxHp: number): EncounterDetails {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      const character = database.prepare(`
        SELECT c.id, c.name, c.dex FROM characters c
        JOIN campaign_memberships m ON m.id = c.membershipId
        WHERE c.id = ? AND m.campaignId = ?
      `).get(characterId, campaignId) as { id: string; name: string; dex: number } | undefined
      if (!character) throw new HttpError(404, 'Character not found in this campaign.')
      if (database.prepare('SELECT 1 FROM encounter_combatants WHERE encounterId = ? AND characterId = ?').get(encounterId, characterId)) {
        throw new HttpError(409, 'This character is already in the encounter.')
      }
      const initiativeModifier = Math.floor((character.dex - 10) / 2)
      insertCombatant(encounterId, 'player', character.name, character.id, initiativeModifier, currentHp, maxHp)
      return details(campaignId, encounterId)
    })
  }

  export function addEnemy(campaignId: string, encounterId: string, name: string, initiativeModifier: number, currentHp: number, maxHp: number, armorClassOverride: number | null = null, attackModifier: number | null = null, damageFormula: string | null = null, damageType: string | null = null): EncounterDetails {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      insertCombatant(encounterId, 'enemy', name, null, initiativeModifier, currentHp, maxHp, armorClassOverride, attackModifier, damageFormula, damageType)
      return details(campaignId, encounterId)
    })
  }

  export function setEnemyCombatStats(campaignId: string, encounterId: string, combatantId: string, armorClassOverride: number | null, attackModifier: number | null, damageFormula: string | null, damageType: string | null): EncounterDetails {
    return transaction(() => {
      const combatant = requireCombatant(campaignId, encounterId, combatantId)
      if (combatant.type !== 'enemy') throw new HttpError(400, 'Manual AC and attack bonuses can only be set for enemy combatants.')
      database.prepare('UPDATE encounter_combatants SET armorClassOverride = ?, attackModifier = ?, damageFormula = ?, damageType = ?, updatedAt = ? WHERE id = ? AND encounterId = ?')
        .run(armorClassOverride, attackModifier, damageFormula, damageType, new Date().toISOString(), combatantId, encounterId)
      return details(campaignId, encounterId)
    })
  }

  export function setHitPoints(campaignId: string, encounterId: string, combatantId: string, currentHp: number, maxHp: number): EncounterDetails {
    return transaction(() => {
      requireCombatant(campaignId, encounterId, combatantId)
      survivalStore.setHitPoints(campaignId, encounterId, combatantId, currentHp, maxHp)
      return details(campaignId, encounterId)
    })
  }

  export function adjustHitPoints(campaignId: string, encounterId: string, combatantId: string, amount: number, action: 'damage' | 'heal'): EncounterDetails {
    return transaction(() => {
      requireCombatant(campaignId, encounterId, combatantId)
      survivalStore.adjustHp(campaignId, encounterId, combatantId, amount, action)
      return details(campaignId, encounterId)
    })
  }

  export function addCondition(campaignId: string, encounterId: string, combatantId: string, condition: ConditionKey, level?: number, sourceCombatantId: string | null = null, notes = ''): EncounterDetails {
    return transaction(() => {
      conditionStore.apply(campaignId, encounterId, combatantId, condition, level, sourceCombatantId, notes)
      return details(campaignId, encounterId)
    })
  }

  export function removeCondition(campaignId: string, encounterId: string, combatantId: string, condition: ConditionKey, reason = ''): EncounterDetails {
    return transaction(() => {
      conditionStore.remove(campaignId, encounterId, combatantId, condition, condition === 'exhaustion', reason)
      return details(campaignId, encounterId)
    })
  }

  export function removeCombatant(campaignId: string, encounterId: string, combatantId: string): EncounterDetails {
    return transaction(() => {
      const encounter = requireEncounter(campaignId, encounterId)
      requireCombatant(campaignId, encounterId, combatantId)
      database.prepare('DELETE FROM encounter_combatants WHERE id = ? AND encounterId = ?').run(combatantId, encounterId)
      if (encounter.activeCombatantId === combatantId) {
        database.prepare(`UPDATE encounters SET status = 'setup', round = 0, activeCombatantId = NULL, updatedAt = ? WHERE id = ?`)
          .run(new Date().toISOString(), encounterId)
      }
      return details(campaignId, encounterId)
    })
  }

  export function setRolledInitiative(campaignId: string, encounterId: string, combatantId: string, roll: number): EncounterDetails {
    return transaction(() => {
      const combatant = requireCombatant(campaignId, encounterId, combatantId)
      const exhaustion = Number((database.prepare("SELECT level FROM combatant_conditions WHERE combatantId=? AND condition='exhaustion'").get(combatantId) as { level: number } | undefined)?.level ?? 0)
      const exhaustionPenalty = conditionRules.exhaustionPenalty(exhaustion)
      const total = roll + combatant.initiativeModifier + exhaustionPenalty
      database.prepare(`
        UPDATE encounter_combatants SET initiativeSource = 'rolled', initiativeRoll = ?, initiativeTotal = ?, initiativeExhaustionPenalty = ?, updatedAt = ?
        WHERE id = ? AND encounterId = ?
      `).run(roll, total, exhaustionPenalty, new Date().toISOString(), combatantId, encounterId)
      database.prepare('UPDATE encounters SET updatedAt = ? WHERE id = ?').run(new Date().toISOString(), encounterId)
      return details(campaignId, encounterId)
    })
  }

  export function setManualInitiative(campaignId: string, encounterId: string, combatantId: string, total: number): EncounterDetails {
    return transaction(() => {
      requireCombatant(campaignId, encounterId, combatantId)
      database.prepare(`
        UPDATE encounter_combatants SET initiativeSource = 'manual', initiativeRoll = NULL, initiativeTotal = ?, initiativeExhaustionPenalty = 0, updatedAt = ?
        WHERE id = ? AND encounterId = ?
      `).run(total, new Date().toISOString(), combatantId, encounterId)
      database.prepare('UPDATE encounters SET updatedAt = ? WHERE id = ?').run(new Date().toISOString(), encounterId)
      return details(campaignId, encounterId)
    })
  }

  export function start(campaignId: string, encounterId: string): EncounterDetails {
    return transaction(() => {
      const encounter = requireEncounter(campaignId, encounterId)
      if (encounter.status === 'active') throw new HttpError(409, 'The encounter is already active. Reset turn tracking before starting it again.')
      const combatants = getCombatants(encounterId)
      if (combatants.length === 0) throw new HttpError(409, 'Add at least one combatant before starting the encounter.')
      if (combatants.some((combatant) => combatant.initiativeTotal === null)) {
        throw new HttpError(409, 'Set initiative for every combatant before starting the encounter.')
      }
      database.prepare(`UPDATE encounters SET status = 'active', round = 1, activeCombatantId = ?, updatedAt = ? WHERE id = ?`)
        .run(combatants[0]!.id, new Date().toISOString(), encounterId)
      actionEconomyStore.turnStart(encounterId, combatants[0]!.id)
      conditionStore.processBoundary(encounterId, combatants[0]!.id, 'start', 1)
      return details(campaignId, encounterId)
    })
  }

  export function nextTurn(campaignId: string, encounterId: string, actionId?: string): EncounterDetails {
    return transaction(() => {
      const encounter = requireEncounter(campaignId, encounterId)
      if (actionId) {
        const duplicate = database.prepare('SELECT encounterId,result FROM encounter_turn_transitions WHERE actionId=?').get(actionId) as { encounterId: string; result: string } | undefined
        if (duplicate && duplicate.encounterId !== encounterId) throw new HttpError(409, 'This turn action ID was already used for another encounter.')
        if (duplicate) return JSON.parse(duplicate.result) as EncounterDetails
      }
      if (encounter.status !== 'active') throw new HttpError(409, 'Start the encounter before advancing turns.')
      const combatants = getCombatants(encounterId).filter((combatant) => combatant.initiativeTotal !== null)
      if (combatants.length === 0) throw new HttpError(409, 'No combatants have initiative. Set initiative and restart the encounter.')
      const currentIndex = combatants.findIndex((combatant) => combatant.id === encounter.activeCombatantId)
      const wrapped = currentIndex === combatants.length - 1
      const next = currentIndex === -1 ? combatants[0]! : combatants[(currentIndex + 1) % combatants.length]!
      if (encounter.activeCombatantId) {
        actionEconomyStore.turnEnd(encounterId, encounter.activeCombatantId)
        conditionStore.processBoundary(encounterId, encounter.activeCombatantId, 'end', encounter.round)
      }
      actionEconomyStore.turnStart(encounterId, next.id)
      database.prepare('UPDATE encounters SET round = ?, activeCombatantId = ?, updatedAt = ? WHERE id = ?')
        .run(wrapped ? encounter.round + 1 : encounter.round, next.id, new Date().toISOString(), encounterId)
      conditionStore.processBoundary(encounterId, next.id, 'start', wrapped ? encounter.round + 1 : encounter.round)
      const result = details(campaignId, encounterId)
      if (actionId) database.prepare('INSERT INTO encounter_turn_transitions(actionId,encounterId,result,createdAt) VALUES(?,?,?,?)').run(actionId, encounterId, JSON.stringify(result), new Date().toISOString())
      return result
    })
  }

  export function reset(campaignId: string, encounterId: string): EncounterDetails {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      database.prepare(`UPDATE encounters SET status = 'setup', round = 0, activeCombatantId = NULL, updatedAt = ? WHERE id = ?`)
        .run(new Date().toISOString(), encounterId)
      database.prepare(`UPDATE encounter_action_state SET actionUsed=0,bonusActionUsed=0,reactionUsed=0,movementUsed=0,dashBonusMovement=0,disengageActive=0,dodgeActive=0 WHERE combatantId IN (SELECT id FROM encounter_combatants WHERE encounterId=?)`).run(encounterId)
      database.prepare(`UPDATE encounter_action_effects SET status='expired',resolvedAt=? WHERE encounterId=? AND status='active'`).run(new Date().toISOString(),encounterId)
      return details(campaignId, encounterId)
    })
  }
}

export = combatStore
