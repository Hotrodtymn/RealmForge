import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')

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
    insertionOrder: number
    currentHp: number
    maxHp: number
    armorClassOverride: number | null
    attackModifier: number | null
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
        initiativeRoll, initiativeTotal, insertionOrder, currentHp, maxHp, armorClassOverride, attackModifier, createdAt, updatedAt
      FROM encounter_combatants WHERE id = ? AND encounterId = ?
    `).get(combatantId, encounterId)
    if (!row) throw new HttpError(404, 'Combatant not found in this encounter.')
    return row as unknown as Combatant
  }

  function getCombatants(encounterId: string): Combatant[] {
    const rows = database.prepare(`
      SELECT id, encounterId, characterId, type, name, initiativeModifier, initiativeSource,
        initiativeRoll, initiativeTotal, insertionOrder, currentHp, maxHp, armorClassOverride, attackModifier, createdAt, updatedAt
      FROM encounter_combatants WHERE encounterId = ?
      ORDER BY initiativeTotal IS NULL ASC, initiativeTotal DESC, insertionOrder ASC
    `).all(encounterId) as unknown as Omit<Combatant, 'conditions'>[]
    const conditionRows = database.prepare(`
      SELECT id, combatantId, condition, level, createdAt FROM combatant_conditions
      WHERE combatantId IN (SELECT id FROM encounter_combatants WHERE encounterId = ?)
      ORDER BY rowid ASC
    `).all(encounterId) as unknown as CombatantCondition[]
    const conditionsByCombatant = new Map<string, CombatantCondition[]>()
    for (const condition of conditionRows) {
      const entries = conditionsByCombatant.get(condition.combatantId) ?? []
      entries.push(condition)
      conditionsByCombatant.set(condition.combatantId, entries)
    }
    return rows.map((row) => ({ ...row, conditions: conditionsByCombatant.get(row.id) ?? [] }))
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
  ): Combatant {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO encounter_combatants (
        id, encounterId, characterId, type, name, initiativeModifier, initiativeSource,
        initiativeRoll, initiativeTotal, insertionOrder, currentHp, maxHp, armorClassOverride, attackModifier, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, encounterId, characterId, type, name, initiativeModifier, nextInsertionOrder(encounterId), currentHp, maxHp, armorClassOverride, attackModifier, now, now)
    return database.prepare(`
      SELECT id, encounterId, characterId, type, name, initiativeModifier, initiativeSource,
        initiativeRoll, initiativeTotal, insertionOrder, currentHp, maxHp, armorClassOverride, attackModifier, createdAt, updatedAt
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

  export function addEnemy(campaignId: string, encounterId: string, name: string, initiativeModifier: number, currentHp: number, maxHp: number, armorClassOverride: number | null = null, attackModifier: number | null = null): EncounterDetails {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      insertCombatant(encounterId, 'enemy', name, null, initiativeModifier, currentHp, maxHp, armorClassOverride, attackModifier)
      return details(campaignId, encounterId)
    })
  }

  export function setEnemyCombatStats(campaignId: string, encounterId: string, combatantId: string, armorClassOverride: number | null, attackModifier: number | null): EncounterDetails {
    return transaction(() => {
      const combatant = requireCombatant(campaignId, encounterId, combatantId)
      if (combatant.type !== 'enemy') throw new HttpError(400, 'Manual AC and attack bonuses can only be set for enemy combatants.')
      database.prepare('UPDATE encounter_combatants SET armorClassOverride = ?, attackModifier = ?, updatedAt = ? WHERE id = ? AND encounterId = ?')
        .run(armorClassOverride, attackModifier, new Date().toISOString(), combatantId, encounterId)
      return details(campaignId, encounterId)
    })
  }

  export function setHitPoints(campaignId: string, encounterId: string, combatantId: string, currentHp: number, maxHp: number): EncounterDetails {
    return transaction(() => {
      requireCombatant(campaignId, encounterId, combatantId)
      database.prepare('UPDATE encounter_combatants SET currentHp = ?, maxHp = ?, updatedAt = ? WHERE id = ? AND encounterId = ?')
        .run(currentHp, maxHp, new Date().toISOString(), combatantId, encounterId)
      return details(campaignId, encounterId)
    })
  }

  export function adjustHitPoints(campaignId: string, encounterId: string, combatantId: string, amount: number, action: 'damage' | 'heal'): EncounterDetails {
    return transaction(() => {
      const combatant = requireCombatant(campaignId, encounterId, combatantId)
      const currentHp = action === 'damage'
        ? Math.max(0, combatant.currentHp - amount)
        : Math.min(combatant.maxHp, combatant.currentHp + amount)
      database.prepare('UPDATE encounter_combatants SET currentHp = ?, updatedAt = ? WHERE id = ? AND encounterId = ?')
        .run(currentHp, new Date().toISOString(), combatantId, encounterId)
      return details(campaignId, encounterId)
    })
  }

  export function addCondition(campaignId: string, encounterId: string, combatantId: string, condition: ConditionKey, level?: number): EncounterDetails {
    return transaction(() => {
      requireCombatant(campaignId, encounterId, combatantId)
      const existing = database.prepare('SELECT id FROM combatant_conditions WHERE combatantId = ? AND condition = ?').get(combatantId, condition) as { id: string } | undefined
      if (condition === 'exhaustion' && existing) {
        database.prepare('UPDATE combatant_conditions SET level = ? WHERE id = ? AND combatantId = ?').run(level!, existing.id, combatantId)
      } else if (existing) {
        throw new HttpError(409, `${condition} is already applied to this combatant.`)
      } else {
        database.prepare('INSERT INTO combatant_conditions (id, combatantId, condition, level, createdAt) VALUES (?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), combatantId, condition, condition === 'exhaustion' ? level! : null, new Date().toISOString())
      }
      return details(campaignId, encounterId)
    })
  }

  export function removeCondition(campaignId: string, encounterId: string, combatantId: string, condition: ConditionKey): EncounterDetails {
    return transaction(() => {
      requireCombatant(campaignId, encounterId, combatantId)
      const result = database.prepare('DELETE FROM combatant_conditions WHERE combatantId = ? AND condition = ?').run(combatantId, condition)
      if (result.changes === 0) throw new HttpError(404, `${condition} is not applied to this combatant.`)
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
      const total = roll + combatant.initiativeModifier
      database.prepare(`
        UPDATE encounter_combatants SET initiativeSource = 'rolled', initiativeRoll = ?, initiativeTotal = ?, updatedAt = ?
        WHERE id = ? AND encounterId = ?
      `).run(roll, total, new Date().toISOString(), combatantId, encounterId)
      database.prepare('UPDATE encounters SET updatedAt = ? WHERE id = ?').run(new Date().toISOString(), encounterId)
      return details(campaignId, encounterId)
    })
  }

  export function setManualInitiative(campaignId: string, encounterId: string, combatantId: string, total: number): EncounterDetails {
    return transaction(() => {
      requireCombatant(campaignId, encounterId, combatantId)
      database.prepare(`
        UPDATE encounter_combatants SET initiativeSource = 'manual', initiativeRoll = NULL, initiativeTotal = ?, updatedAt = ?
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
      return details(campaignId, encounterId)
    })
  }

  export function nextTurn(campaignId: string, encounterId: string): EncounterDetails {
    return transaction(() => {
      const encounter = requireEncounter(campaignId, encounterId)
      if (encounter.status !== 'active') throw new HttpError(409, 'Start the encounter before advancing turns.')
      const combatants = getCombatants(encounterId).filter((combatant) => combatant.initiativeTotal !== null)
      if (combatants.length === 0) throw new HttpError(409, 'No combatants have initiative. Set initiative and restart the encounter.')
      const currentIndex = combatants.findIndex((combatant) => combatant.id === encounter.activeCombatantId)
      const wrapped = currentIndex === combatants.length - 1
      const next = currentIndex === -1 ? combatants[0]! : combatants[(currentIndex + 1) % combatants.length]!
      database.prepare('UPDATE encounters SET round = ?, activeCombatantId = ?, updatedAt = ? WHERE id = ?')
        .run(wrapped ? encounter.round + 1 : encounter.round, next.id, new Date().toISOString(), encounterId)
      return details(campaignId, encounterId)
    })
  }

  export function reset(campaignId: string, encounterId: string): EncounterDetails {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      database.prepare(`UPDATE encounters SET status = 'setup', round = 0, activeCombatantId = NULL, updatedAt = ? WHERE id = ?`)
        .run(new Date().toISOString(), encounterId)
      return details(campaignId, encounterId)
    })
  }
}

export = combatStore
