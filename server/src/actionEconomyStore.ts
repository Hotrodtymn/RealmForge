import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import conditionRules = require('./conditionRules')
import conditionStore = require('./conditionStore')

namespace actionEconomyStore {
  type Resource = 'action' | 'bonusAction' | 'reaction'
  export type ActionKind = 'resource_override' | 'movement' | 'movement_allowance' | 'reset' | 'dash' | 'disengage' | 'dodge' | 'help' | 'ready' | 'ready_resolve' | 'ready_cancel'
  export interface Input { actionId: string; combatantId: string; kind: ActionKind; resource?: Resource; available?: boolean; distance?: number; movementAllowance?: number; targetId?: string; helpUse?: 'ability_check' | 'attack'; description?: string; trigger?: string; response?: string; effectId?: string; dmOverride?: boolean; overrideReason?: string }
  export interface State { combatantId: string; actionUsed: boolean; bonusActionUsed: boolean; reactionUsed: boolean; movementAllowance: number; movementUsed: number; dashBonusMovement: number; turnCount: number; disengageActive: boolean; dodgeActive: boolean; effectiveSpeed: number; speedRestrictions: string[]; actionRestricted: boolean; actionRestrictionConditions: string[]; prone: boolean; standCost: number | null; adjudication: string[] }
  export interface Effect { id: string; ownerCombatantId: string; ownerName: string; targetCombatantId: string | null; targetName: string | null; kind: 'help' | 'ready'; helpUse: 'ability_check' | 'attack' | null; description: string; triggerText: string; responseText: string; status: string; expiresAtOwnerTurn: number; createdAt: string }
  export interface Event { id: string; actionId: string; combatantId: string | null; combatantName: string; kind: string; details: Record<string, unknown>; createdAt: string }
  export interface Snapshot { states: State[]; effects: Effect[]; events: Event[] }
  function tx<T>(fn: () => T): T { database.exec('BEGIN IMMEDIATE'); try { const value = fn(); database.exec('COMMIT'); return value } catch (error) { database.exec('ROLLBACK'); throw error } }
  function ensure(encounterId: string, combatantId?: string): void {
    if (!database.prepare('SELECT 1 FROM encounters WHERE id=?').get(encounterId)) throw new HttpError(404, 'Encounter not found.')
    if (combatantId && !database.prepare('SELECT 1 FROM encounter_combatants WHERE id=? AND encounterId=?').get(combatantId, encounterId)) throw new HttpError(404, 'Combatant not found in this encounter.')
  }
  function state(combatantId: string): State {
    database.prepare('INSERT OR IGNORE INTO encounter_action_state(combatantId) VALUES (?)').run(combatantId)
    const row = database.prepare('SELECT s.*,c.survivalStatus FROM encounter_action_state s JOIN encounter_combatants c ON c.id=s.combatantId WHERE s.combatantId=?').get(combatantId) as Record<string, unknown>
    const conditions = database.prepare('SELECT condition, sourceCombatantId, level FROM combatant_conditions WHERE combatantId=?').all(combatantId) as unknown as conditionRules.Condition[]
    const dead = row.survivalStatus === 'dead'
    const movement = conditionRules.movement(dead ? 0 : Number(row.movementAllowance), conditions)
    const actionConditions = conditionRules.preventsActions(conditions).map((entry) => entry.condition)
    return { combatantId, actionUsed: Boolean(row.actionUsed), bonusActionUsed: Boolean(row.bonusActionUsed), reactionUsed: Boolean(row.reactionUsed), movementAllowance: Number(row.movementAllowance), movementUsed: Number(row.movementUsed), dashBonusMovement: Number(row.dashBonusMovement), turnCount: Number(row.turnCount), disengageActive: Boolean(row.disengageActive), dodgeActive: Boolean(row.dodgeActive), effectiveSpeed: movement.effectiveSpeed, speedRestrictions: dead ? ['Dead combatant has no movement.'] : movement.reasons, actionRestricted: dead || actionConditions.length > 0, actionRestrictionConditions: dead ? ['dead', ...actionConditions] : actionConditions, prone: movement.prone, standCost: movement.standCost, adjudication: movement.adjudication }
  }
  function actionOverride(combatantId: string, input: Input): Record<string, unknown> | null {
    const conditions = database.prepare('SELECT condition, sourceCombatantId, level FROM combatant_conditions WHERE combatantId=?').all(combatantId) as unknown as conditionRules.Condition[]
    const blocked = conditionRules.preventsActions(conditions)
    const dead = (database.prepare('SELECT survivalStatus FROM encounter_combatants WHERE id=?').get(combatantId) as { survivalStatus: string } | undefined)?.survivalStatus === 'dead'
    if (!blocked.length && !dead) return null
    if (input.dmOverride !== true || typeof input.overrideReason !== 'string' || !input.overrideReason.trim()) {
      throw new HttpError(409, `${[...(dead ? ['dead'] : []), ...blocked.map((entry) => entry.condition)].join(', ')} prevents ordinary actions or reactions. A DM override requires an explicit reason.`)
    }
    const overridden = [...(dead ? ['dead'] : []), ...blocked.map((entry) => entry.condition)]
    const encounterId = (database.prepare('SELECT encounterId FROM encounter_combatants WHERE id=?').get(combatantId) as { encounterId: string }).encounterId
    conditionStore.recordDmOverrideInTransaction(encounterId, combatantId, input.overrideReason.trim(), overridden, input.actionId)
    return { dmOverride: true, overrideReason: input.overrideReason.trim(), conditions: overridden }
  }
  export function get(campaignId: string, encounterId: string): Snapshot {
    if (!database.prepare('SELECT 1 FROM encounters WHERE id=? AND campaignId=?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
    const combatants = database.prepare('SELECT id FROM encounter_combatants WHERE encounterId=?').all(encounterId) as { id: string }[]
    const states = combatants.map(({ id }) => state(id))
    const effects = database.prepare(`SELECT e.id,e.ownerCombatantId,o.name ownerName,e.targetCombatantId,t.name targetName,e.kind,e.helpUse,e.description,e.triggerText,e.responseText,e.status,e.expiresAtOwnerTurn,e.createdAt FROM encounter_action_effects e JOIN encounter_combatants o ON o.id=e.ownerCombatantId LEFT JOIN encounter_combatants t ON t.id=e.targetCombatantId WHERE e.encounterId=? AND e.status='active' ORDER BY e.createdAt DESC`).all(encounterId) as unknown as Effect[]
    const events = (database.prepare('SELECT id,actionId,combatantId,combatantName,kind,details,createdAt FROM encounter_action_events WHERE encounterId=? ORDER BY rowid DESC LIMIT 30').all(encounterId) as unknown as (Omit<Event,'details'> & {details:string})[]).map((e) => ({ ...e, details: JSON.parse(e.details) as Record<string, unknown> }))
    return { states, effects, events }
  }
  export function turnStart(encounterId: string, combatantId: string): void {
    const current = state(combatantId)
    database.prepare(`UPDATE encounter_action_state SET actionUsed=0,bonusActionUsed=0,reactionUsed=0,movementUsed=0,dashBonusMovement=0,turnCount=turnCount+1,disengageActive=0,dodgeActive=0 WHERE combatantId=?`).run(combatantId)
    database.prepare(`UPDATE encounter_action_effects SET status='expired',resolvedAt=? WHERE encounterId=? AND ownerCombatantId=? AND status='active' AND expiresAtOwnerTurn<=?`).run(new Date().toISOString(), encounterId, combatantId, current.turnCount + 1)
    event(encounterId, crypto.randomUUID(), combatantId, 'turn_start_reset', { action: 'available', bonusAction: 'available', reaction: 'available', movementUsed: 0 })
  }
  export function turnEnd(encounterId: string, combatantId: string): void {
    const row = state(combatantId)
    if (!row.disengageActive) return
    database.prepare('UPDATE encounter_action_state SET disengageActive=0 WHERE combatantId=?').run(combatantId)
    event(encounterId, crypto.randomUUID(), combatantId, 'disengage_expired', { expiration: 'end of turn' })
  }
  export function recordAttackAction(encounterId: string, combatantId: string, actionId: string, overrideReason?: string): void {
    const encounter = database.prepare('SELECT status,activeCombatantId FROM encounters WHERE id=?').get(encounterId) as { status: string; activeCombatantId: string | null } | undefined
    if (!encounter || encounter.status !== 'active' || encounter.activeCombatantId !== combatantId) throw new HttpError(409, 'An Attack Action can only be spent by the active combatant during an active encounter.')
    if (database.prepare('SELECT 1 FROM encounter_action_events WHERE actionId=?').get(actionId)) throw new HttpError(409, 'This action request has already been applied.')
    const row = state(combatantId)
    if (row.actionUsed) throw new HttpError(409, 'Action is already used this turn.')
    const conditions = database.prepare('SELECT condition, sourceCombatantId FROM combatant_conditions WHERE combatantId=?').all(combatantId) as unknown as conditionRules.Condition[]
    const restrictions = conditionRules.preventsActions(conditions)
    if (restrictions.length && !overrideReason?.trim()) throw new HttpError(409, `${restrictions.map((entry) => entry.condition).join(', ')} prevents spending an Action.`)
    if (restrictions.length) conditionStore.recordDmOverrideInTransaction(encounterId, combatantId, overrideReason!.trim(), restrictions.map((entry) => entry.condition), actionId)
    database.prepare('UPDATE encounter_action_state SET actionUsed=1 WHERE combatantId=?').run(combatantId)
    event(encounterId, actionId, combatantId, 'attack_action', { note: 'Action spent to make an attack.', ...(restrictions.length ? { dmOverride: true, overrideReason: overrideReason!.trim(), conditions: restrictions.map((entry) => entry.condition) } : {}) })
  }
  function event(encounterId: string, actionId: string, combatantId: string | null, kind: string, details: Record<string, unknown>): void {
    const name = combatantId ? (database.prepare('SELECT name FROM encounter_combatants WHERE id=?').get(combatantId) as { name: string }).name : 'Encounter'
    database.prepare('INSERT INTO encounter_action_events(id,actionId,encounterId,combatantId,combatantName,kind,details,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(), actionId, encounterId, combatantId, name, kind, JSON.stringify(details), new Date().toISOString())
  }
  export function apply(campaignId: string, encounterId: string, input: Input): Snapshot {
    return tx(() => {
      if (!database.prepare('SELECT 1 FROM encounters WHERE id=? AND campaignId=?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
      ensure(encounterId, input.combatantId)
      if (database.prepare('SELECT 1 FROM encounter_action_events WHERE actionId=?').get(input.actionId)) throw new HttpError(409, 'This action request has already been applied.')
      const actor = database.prepare('SELECT name,type FROM encounter_combatants WHERE id=?').get(input.combatantId) as {name:string;type:string}
      const encounter = database.prepare('SELECT status,activeCombatantId FROM encounters WHERE id=?').get(encounterId) as {status:string;activeCombatantId:string|null}
      const mustBeActiveTurn = !['ready_resolve','ready_cancel','resource_override','movement_allowance','reset'].includes(input.kind)
      if (mustBeActiveTurn && (encounter.status !== 'active' || encounter.activeCombatantId !== input.combatantId)) throw new HttpError(409, 'This tactical action is only available to the active combatant during an active encounter.')
      const current = state(input.combatantId)
      const now = new Date().toISOString()
      const consumeAction = (kind: string) => { const override = actionOverride(input.combatantId,input); if (current.actionUsed) throw new HttpError(409, 'Action is already used this turn.'); database.prepare('UPDATE encounter_action_state SET actionUsed=1 WHERE combatantId=?').run(input.combatantId); event(encounterId,input.actionId,input.combatantId,kind,override ?? {}) }
      switch (input.kind) {
        case 'resource_override': {
          if (!['action','bonusAction','reaction'].includes(input.resource ?? '') || typeof input.available !== 'boolean') throw new HttpError(400, 'Choose Action, Bonus Action, or Reaction and whether it is available.')
          const override = input.available ? actionOverride(input.combatantId,input) : null
          const column = ({ action: 'actionUsed', bonusAction: 'bonusActionUsed', reaction: 'reactionUsed' } as const)[input.resource!]
          database.prepare(`UPDATE encounter_action_state SET ${column}=? WHERE combatantId=?`).run(input.available ? 0 : 1, input.combatantId)
          event(encounterId,input.actionId,input.combatantId,'manual_override',{resource:input.resource,available:input.available,...(override ?? {})}); break
        }
        case 'movement_allowance': {
          if (!Number.isSafeInteger(input.movementAllowance) || input.movementAllowance! < 0 || input.movementAllowance! > 300) throw new HttpError(400, 'Movement allowance must be a whole number from 0 to 300.')
          database.prepare('UPDATE encounter_action_state SET movementAllowance=? WHERE combatantId=?').run(input.movementAllowance!,input.combatantId)
          event(encounterId,input.actionId,input.combatantId,'manual_override',{movementAllowance:input.movementAllowance}); break
        }
        case 'movement': {
          if (!Number.isSafeInteger(input.distance) || input.distance! < 0 || input.distance! > 300) throw new HttpError(400, 'Movement used must be a whole number from 0 to 300.')
          let movementOverride: Record<string, unknown> | null = null
          if (input.distance! > 0 && current.effectiveSpeed === 0 && current.speedRestrictions.length) {
            if (input.dmOverride !== true || !input.overrideReason?.trim()) throw new HttpError(409, 'This condition sets effective Speed to 0; movement requires an explicit DM override and reason.')
            movementOverride = { dmOverride: true, overrideReason: input.overrideReason.trim(), conditions: current.speedRestrictions }
            const speedConditions = database.prepare("SELECT condition FROM combatant_conditions WHERE combatantId=? AND condition IN ('grappled','restrained','paralyzed','unconscious','petrified','exhaustion')").all(input.combatantId) as { condition: string }[]
            conditionStore.recordDmOverrideInTransaction(encounterId, input.combatantId, input.overrideReason.trim(), speedConditions.map((entry) => entry.condition), input.actionId)
          }
          if (input.distance! > 0 && current.effectiveSpeed === 0 && !movementOverride) throw new HttpError(409, 'This condition sets effective Speed to 0; ordinary movement is unavailable.')
          const movementBase = movementOverride ? current.movementAllowance : current.effectiveSpeed
          const available=movementBase+current.dashBonusMovement-current.movementUsed
          if (input.distance! > available) throw new HttpError(409, `Only ${available} feet of movement remain this turn.`)
          database.prepare('UPDATE encounter_action_state SET movementUsed=movementUsed+? WHERE combatantId=?').run(input.distance!,input.combatantId)
          event(encounterId,input.actionId,input.combatantId,'movement',{distance:input.distance,...(movementOverride ?? {})}); break
        }
        case 'reset':
          if (encounter.status==='active' && encounter.activeCombatantId!==input.combatantId) throw new HttpError(409,'Only the current combatant’s action economy can be reset during an active encounter.')
          database.prepare('UPDATE encounter_action_state SET actionUsed=0,bonusActionUsed=0,reactionUsed=0,movementUsed=0,dashBonusMovement=0,disengageActive=0,dodgeActive=0 WHERE combatantId=?').run(input.combatantId)
          database.prepare(`UPDATE encounter_action_effects SET status='expired',resolvedAt=? WHERE encounterId=? AND ownerCombatantId=? AND status='active'`).run(now,encounterId,input.combatantId)
          event(encounterId,input.actionId,input.combatantId,'manual_reset',{override:true}); break
        case 'dash': {
          const override = actionOverride(input.combatantId,input)
          if (current.actionUsed) throw new HttpError(409,'Action is already used this turn.')
          const speed=current.effectiveSpeed
          if(!Number.isSafeInteger(speed)||speed<0||speed>300) throw new HttpError(400,'Dash movement must be a whole number from 0 to 300.')
          database.prepare('UPDATE encounter_action_state SET actionUsed=1,dashBonusMovement=dashBonusMovement+? WHERE combatantId=?').run(speed,input.combatantId)
          event(encounterId,input.actionId,input.combatantId,'dash',{additionalMovement:speed,...(override ?? {})}); break
        }
        case 'disengage': case 'dodge': {
          const override = actionOverride(input.combatantId,input)
          if(current.actionUsed) throw new HttpError(409,'Action is already used this turn.')
          const column=input.kind==='disengage'?'disengageActive':'dodgeActive'
          database.prepare(`UPDATE encounter_action_state SET actionUsed=1,${column}=1 WHERE combatantId=?`).run(input.combatantId)
          event(encounterId,input.actionId,input.combatantId,input.kind,{expires:'start of this combatant’s next turn',...(override ?? {})}); break
        }
        case 'help': {
          const override = actionOverride(input.combatantId,input)
          if(current.actionUsed) throw new HttpError(409,'Action is already used this turn.')
          if(!input.targetId||input.targetId===input.combatantId) throw new HttpError(400,'Choose another combatant to help.')
          const target=database.prepare('SELECT id,type FROM encounter_combatants WHERE id=? AND encounterId=?').get(input.targetId,encounterId) as {id:string;type:string}|undefined
          if(!target) throw new HttpError(404,'Help target must belong to this encounter.')
          if(target.type!==actor.type) throw new HttpError(400,'Help target must be an eligible ally of the same combatant side.')
          if(!['ability_check','attack'].includes(input.helpUse??'')) throw new HttpError(400,'Choose whether Help applies to an ability check or attack.')
          if(typeof input.description!=='string'||!input.description.trim()||input.description.trim().length>300) throw new HttpError(400,'Describe the assistance in 1 to 300 characters.')
          database.prepare('UPDATE encounter_action_state SET actionUsed=1 WHERE combatantId=?').run(input.combatantId)
          const id: string = crypto.randomUUID(); database.prepare(`INSERT INTO encounter_action_effects(id,encounterId,ownerCombatantId,targetCombatantId,kind,helpUse,description,expiresAtOwnerTurn,createdAt) VALUES($id,$encounterId,$ownerId,$targetId,'help',$helpUse,$description,$expires,$createdAt)`).run({ $id:id, $encounterId:encounterId, $ownerId:input.combatantId, $targetId:input.targetId, $helpUse:input.helpUse!, $description:input.description.trim(), $expires:current.turnCount+1, $createdAt:now })
          event(encounterId,input.actionId,input.combatantId,'help',{effectId:id,targetId:input.targetId,helpUse:input.helpUse,description:input.description.trim(),...(override ?? {})}); break
        }
        case 'ready': {
          const override = actionOverride(input.combatantId,input)
          if(current.actionUsed) throw new HttpError(409,'Action is already used this turn.')
          if(typeof input.trigger!=='string'||!input.trigger.trim()||input.trigger.trim().length>300||typeof input.response!=='string'||!input.response.trim()||input.response.trim().length>300) throw new HttpError(400,'Ready requires a trigger and intended response, each 1 to 300 characters.')
          if(input.targetId){ ensure(encounterId,input.targetId) }
          database.prepare('UPDATE encounter_action_state SET actionUsed=1 WHERE combatantId=?').run(input.combatantId)
          const id=crypto.randomUUID(); database.prepare(`INSERT INTO encounter_action_effects(id,encounterId,ownerCombatantId,targetCombatantId,kind,triggerText,responseText,expiresAtOwnerTurn,createdAt) VALUES(?,?,?,?,'ready',?,?,?,?)`).run(id,encounterId,input.combatantId,input.targetId??null,input.trigger.trim(),input.response.trim(),current.turnCount+1,now)
          event(encounterId,input.actionId,input.combatantId,'ready',{effectId:id,trigger:input.trigger.trim(),response:input.response.trim(),...(override ?? {})}); break
        }
        case 'ready_resolve': case 'ready_cancel': {
          if(!input.effectId) throw new HttpError(400,'Choose a prepared action.')
          const effect=database.prepare(`SELECT id,ownerCombatantId,kind,status FROM encounter_action_effects WHERE id=? AND encounterId=?`).get(input.effectId,encounterId) as {id:string;ownerCombatantId:string;kind:string;status:string}|undefined
          if(!effect||effect.kind!=='ready') throw new HttpError(404,'Prepared action not found in this encounter.')
          if(effect.status!=='active') throw new HttpError(409,'This prepared action is no longer active.')
          let override: Record<string, unknown> | null = null
          if(input.kind==='ready_resolve') { override=actionOverride(effect.ownerCombatantId,input); const ownerState=state(effect.ownerCombatantId); if(ownerState.reactionUsed) throw new HttpError(409,'Reaction is already used; this prepared action cannot resolve.'); database.prepare('UPDATE encounter_action_state SET reactionUsed=1 WHERE combatantId=?').run(effect.ownerCombatantId) }
          else if(effect.ownerCombatantId!==input.combatantId) throw new HttpError(403,'Only the combatant who prepared this action can cancel it.')
          const status=input.kind==='ready_resolve'?'resolved':'cancelled'
          database.prepare('UPDATE encounter_action_effects SET status=?,resolvedAt=? WHERE id=?').run(status,now,input.effectId)
          event(encounterId,input.actionId,effect.ownerCombatantId,`ready_${status}`,{effectId:input.effectId,reactionUsed:input.kind==='ready_resolve',...(override ?? {})}); break
        }
      }
      return get(campaignId,encounterId)
    })
  }
}

export = actionEconomyStore
