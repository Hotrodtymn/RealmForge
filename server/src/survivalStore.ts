import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import survivalRules = require('./survivalRules')

namespace survivalStore {
  export interface State extends survivalRules.State { id: string; encounterId: string; campaignId: string; type: 'player' | 'enemy'; name: string; characterId: string | null }
  export interface Event { id: string; actionId: string; campaignId: string; encounterId: string; combatantId: string; action: string; naturalRoll: number | null; successes: number; failures: number; survivalStatus: survivalRules.Status; hpBefore: number; hpAfter: number; detail: string; createdAt: string }

  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try { const result = operation(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }

  function requireState(campaignId: string, encounterId: string, combatantId: string): State {
    const row = database.prepare(`SELECT c.id,c.encounterId,e.campaignId,c.type,c.characterId,c.name,c.currentHp,c.maxHp,c.deathSaveSuccesses AS successes,c.deathSaveFailures AS failures,c.survivalStatus AS status
      FROM encounter_combatants c JOIN encounters e ON e.id=c.encounterId WHERE c.id=? AND c.encounterId=? AND e.campaignId=?`).get(combatantId, encounterId, campaignId) as State | undefined
    if (!row) throw new HttpError(404, 'Combatant not found in this campaign encounter.')
    return row
  }

  function addEvent(campaignId: string, encounterId: string, combatantId: string, actionId: string, action: string, roll: number | null, before: number, after: number, detail: string, state: survivalRules.State): void {
    database.prepare(`INSERT INTO encounter_survival_events (id,actionId,campaignId,encounterId,combatantId,action,naturalRoll,successes,failures,survivalStatus,hpBefore,hpAfter,detail,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), actionId, campaignId, encounterId, combatantId, action, roll, state.successes, state.failures, state.status, before, after, detail, new Date().toISOString())
  }

  function setState(combatantId: string, state: survivalRules.State): void {
    database.prepare(`UPDATE encounter_combatants SET currentHp=?,maxHp=?,deathSaveSuccesses=?,deathSaveFailures=?,survivalStatus=?,updatedAt=? WHERE id=?`)
      .run(state.currentHp, state.maxHp, state.successes, state.failures, state.status, new Date().toISOString(), combatantId)
    if (state.status === 'conscious' && state.currentHp > 0) {
      database.prepare("DELETE FROM combatant_conditions WHERE combatantId=? AND condition='unconscious'").run(combatantId)
    } else if (state.status !== 'conscious' && state.status !== 'dead') {
      database.prepare("INSERT OR IGNORE INTO combatant_conditions (id,combatantId,condition,level,createdAt) VALUES (?,?, 'unconscious',NULL,?)")
        .run(crypto.randomUUID(), combatantId, new Date().toISOString())
    } else if (state.status === 'dead') {
      database.prepare("INSERT OR IGNORE INTO combatant_conditions (id,combatantId,condition,level,createdAt) VALUES (?,?, 'unconscious',NULL,?)")
        .run(crypto.randomUUID(), combatantId, new Date().toISOString())
    }
  }

  export function list(campaignId: string, encounterId: string, combatantId: string): Event[] {
    requireState(campaignId, encounterId, combatantId)
    return database.prepare('SELECT * FROM encounter_survival_events WHERE campaignId=? AND encounterId=? AND combatantId=? ORDER BY createdAt DESC,rowid DESC')
      .all(campaignId, encounterId, combatantId) as unknown as Event[]
  }

  export function deathSave(campaignId: string, encounterId: string, combatantId: string, actionId: string): { event: Event; state: State } {
    return transaction(() => {
      const combatant = requireState(campaignId, encounterId, combatantId)
      if (combatant.type !== 'player') throw new HttpError(400, 'Death saving throws are only tracked for player characters.')
      const already = database.prepare('SELECT 1 FROM encounter_survival_events WHERE actionId=?').get(actionId)
      if (already) throw new HttpError(409, 'This survival action was already processed.')
      if (combatant.currentHp !== 0 || combatant.status !== 'unconscious') throw new HttpError(409, 'Death saves are only available to an unconscious player character at 0 HP.')
      const roll = crypto.randomInt(1, 21)
      const result = survivalRules.deathSave(combatant, roll)
      setState(combatant.id, result.state)
      addEvent(campaignId, encounterId, combatant.id, actionId, 'death_save', roll, combatant.currentHp, result.state.currentHp, result.message, result.state)
      const event = database.prepare('SELECT * FROM encounter_survival_events WHERE actionId=?').get(actionId) as unknown as Event
      return { event, state: requireState(campaignId, encounterId, combatantId) }
    })
  }

  export function stabilize(campaignId: string, encounterId: string, combatantId: string, actionId: string): { event: Event; state: State } {
    return transaction(() => {
      const combatant = requireState(campaignId, encounterId, combatantId)
      if (combatant.type !== 'player') throw new HttpError(400, 'Only player characters use this survival workflow.')
      if (database.prepare('SELECT 1 FROM encounter_survival_events WHERE actionId=?').get(actionId)) throw new HttpError(409, 'This survival action was already processed.')
      let result: survivalRules.Outcome
      try { result = survivalRules.stabilize(combatant) } catch (error) { throw new HttpError(409, error instanceof Error ? error.message : 'Combatant cannot be stabilized.') }
      setState(combatant.id, result.state)
      addEvent(campaignId, encounterId, combatant.id, actionId, 'stabilize', null, 0, 0, result.message, result.state)
      return { event: database.prepare('SELECT * FROM encounter_survival_events WHERE actionId=?').get(actionId) as unknown as Event, state: requireState(campaignId, encounterId, combatantId) }
    })
  }

  // Called inside the damage transaction: amount and critical state come from the saved damage roll.
  export function applyDamageInTransaction(campaignId: string, encounterId: string, combatantId: string, amount: number, critical: boolean, actionId: string): { currentHp: number; maxHp: number; message: string } {
    const combatant = requireState(campaignId, encounterId, combatantId)
    const after = Math.max(0, combatant.currentHp - amount)
    if (amount === 0) return { currentHp: combatant.currentHp, maxHp: combatant.maxHp, message: 'No damage dealt; survival state is unchanged.' }
    if (combatant.type !== 'player') {
      database.prepare('UPDATE encounter_combatants SET currentHp=?,updatedAt=? WHERE id=?').run(after, new Date().toISOString(), combatantId)
      return { currentHp: after, maxHp: combatant.maxHp, message: '' }
    }
    if (combatant.status === 'dead') throw new HttpError(409, 'A dead character cannot take further combat damage.')
    if (after > 0) {
      database.prepare('UPDATE encounter_combatants SET currentHp=?,updatedAt=? WHERE id=?').run(after, new Date().toISOString(), combatantId)
      return { currentHp: after, maxHp: combatant.maxHp, message: '' }
    }
    const result = survivalRules.enterZeroHp(combatant, amount, critical)
    setState(combatant.id, result.state)
    addEvent(campaignId, encounterId, combatant.id, actionId, combatant.currentHp === 0 ? 'damage_at_zero' : 'unconscious', null, combatant.currentHp, result.state.currentHp, result.message, result.state)
    return { currentHp: result.state.currentHp, maxHp: result.state.maxHp, message: result.message }
  }

  export function setHitPoints(campaignId: string, encounterId: string, combatantId: string, currentHp: number, maxHp: number): void {
    const combatant = requireState(campaignId, encounterId, combatantId)
    if (combatant.type !== 'player') {
      database.prepare('UPDATE encounter_combatants SET currentHp=?,maxHp=?,updatedAt=? WHERE id=?').run(currentHp, maxHp, new Date().toISOString(), combatantId); return
    }
    let result: survivalRules.Outcome
    try { result = survivalRules.recover(combatant, currentHp, maxHp) }
    catch (error) { throw new HttpError(409, error instanceof Error ? error.message : 'Hit points cannot be restored.') }
    setState(combatant.id, result.state)
    if (currentHp > 0 && combatant.currentHp === 0) addEvent(campaignId, encounterId, combatant.id, crypto.randomUUID(), 'recovery', null, 0, currentHp, result.message, result.state)
    if (currentHp === 0 && combatant.currentHp > 0) addEvent(campaignId, encounterId, combatant.id, crypto.randomUUID(), 'unconscious', null, combatant.currentHp, 0, result.message, result.state)
  }

  export function adjustHp(campaignId: string, encounterId: string, combatantId: string, amount: number, action: 'damage' | 'heal'): void {
    const combatant = requireState(campaignId, encounterId, combatantId)
    if (combatant.type !== 'player') {
      const hp = action === 'damage' ? Math.max(0, combatant.currentHp - amount) : Math.min(combatant.maxHp, combatant.currentHp + amount)
      database.prepare('UPDATE encounter_combatants SET currentHp=?,updatedAt=? WHERE id=?').run(hp, new Date().toISOString(), combatantId); return
    }
    if (action === 'damage') { survivalStore.applyDamageInTransaction(campaignId, encounterId, combatantId, amount, false, crypto.randomUUID()); return }
    const hp = Math.min(combatant.maxHp, combatant.currentHp + amount)
    let result: survivalRules.Outcome
    try { result = survivalRules.recover(combatant, hp) }
    catch (error) { throw new HttpError(409, error instanceof Error ? error.message : 'Hit points cannot be restored.') }
    setState(combatant.id, result.state)
    if (combatant.currentHp === 0 && hp > 0) addEvent(campaignId, encounterId, combatant.id, crypto.randomUUID(), 'recovery', null, 0, hp, result.message, result.state)
  }
}

export = survivalStore
