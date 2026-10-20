import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import conditionRules = require('./conditionRules')

namespace spellCastingStore {
  export type Event = { id: string; requestId: string; campaignId: string; encounterId: string; casterCombatantId: string; casterName: string; casterCharacterId: string; spellId: string; spellName: string; baseLevel: number; castLevel: number; castingTimeCategory: string; slotLevel: number | null; actionResource: string | null; turnCount: number | null; dmOverride: boolean; overrideReason: string; status: string; createdAt: string }
  export type Input = { requestId: string; casterId: string; spellId: string; castLevel?: number; specialResource?: 'action' | 'bonusAction' | 'reaction' | 'none'; dmOverride: boolean; overrideReason: string }
  function tx<T>(fn: () => T): T { database.exec('BEGIN IMMEDIATE'); try { const value = fn(); database.exec('COMMIT'); return value } catch (error) { database.exec('ROLLBACK'); throw error } }
  function parse(row: Record<string, unknown>): Event { return { id: String(row.id), requestId: String(row.requestId), campaignId: String(row.campaignId), encounterId: String(row.encounterId), casterCombatantId: String(row.casterCombatantId), casterName: String(row.casterName), casterCharacterId: String(row.casterCharacterId), spellId: String(row.spellId), spellName: String(row.spellName), baseLevel: Number(row.baseLevel), castLevel: Number(row.castLevel), castingTimeCategory: String(row.castingTimeCategory), slotLevel: row.slotLevel === null ? null : Number(row.slotLevel), actionResource: row.actionResource === null ? null : String(row.actionResource), turnCount: row.turnCount === null ? null : Number(row.turnCount), dmOverride: Boolean(row.dmOverride), overrideReason: String(row.overrideReason), status: String(row.status), createdAt: String(row.createdAt) } }
  export function list(campaignId: string, encounterId: string): Event[] {
    if (!database.prepare('SELECT 1 FROM encounters WHERE id=? AND campaignId=?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
    return (database.prepare('SELECT * FROM encounter_spell_castings WHERE campaignId=? AND encounterId=? ORDER BY createdAt DESC LIMIT 50').all(campaignId, encounterId) as unknown as Record<string, unknown>[]).map(parse)
  }
  export function create(campaignId: string, encounterId: string, input: Input): { event: Event; replayed: boolean } {
    return tx(() => {
      if (!database.prepare('SELECT 1 FROM encounters WHERE id=? AND campaignId=?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
      const caster = database.prepare('SELECT id,name,type,characterId,survivalStatus FROM encounter_combatants WHERE id=? AND encounterId=?').get(input.casterId, encounterId) as { id: string; name: string; type: string; characterId: string | null; survivalStatus: string } | undefined
      if (!caster || caster.type !== 'player' || !caster.characterId) throw new HttpError(400, 'Choose a player character in this encounter as the caster.')
      const character = database.prepare(`SELECT c.id,c.name,m.campaignId,m.playerId FROM characters c JOIN campaign_memberships m ON m.id=c.membershipId WHERE c.id=? AND m.campaignId=?`).get(caster.characterId, campaignId) as { id: string; name: string; campaignId: string; playerId: string } | undefined
      if (!character) throw new HttpError(404, 'Caster character does not belong to this campaign.')
      const spell = database.prepare(`SELECT s.*,b.prepared,b.alwaysPrepared FROM character_spellbook b JOIN character_spells s ON s.id=b.spellId WHERE b.characterId=? AND b.spellId=?`).get(character.id, input.spellId) as Record<string, unknown> | undefined
      if (!spell) throw new HttpError(404, 'Spell is not in the caster’s spellbook.')
      const castLevel = input.castLevel ?? Number(spell.level)
      if (castLevel < Number(spell.level)) throw new HttpError(400, 'Cast level cannot be below the spell’s base level.')
      if (Number(spell.level) === 0 && castLevel !== 0) throw new HttpError(400, 'Cantrips do not use spell slots and cannot be upcast.')
      const casting = database.prepare('SELECT enabled,ability FROM character_spellcasting WHERE characterId=?').get(character.id) as { enabled: number; ability: string | null } | undefined
      if (!casting?.enabled || !casting.ability) throw new HttpError(409, 'Configure an enabled spellcasting ability before casting.')
      const requestHash = crypto.createHash('sha256').update(JSON.stringify({ campaignId, encounterId, ...input, castLevel })).digest('hex')
      const old = database.prepare('SELECT * FROM encounter_spell_castings WHERE requestId=?').get(input.requestId) as Record<string, unknown> | undefined
      if (old) { if (old.requestHash !== requestHash || old.campaignId !== campaignId || old.encounterId !== encounterId) throw new HttpError(409, 'This idempotency key was already used for a different casting request or encounter.'); return { event: parse(old), replayed: true } }
      if (!spell.prepared && !spell.alwaysPrepared && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, 'This spell is not marked prepared. Class eligibility is not modeled; explicit DM adjudication and a reason are required.')
      const category = String(spell.castingTimeCategory ?? 'special')
      const resource = category === 'action' ? 'action' : category === 'bonus_action' ? 'bonusAction' : category === 'reaction' ? 'reaction' : input.specialResource === 'none' ? null : input.specialResource ?? null
      if (category === 'special' && (!input.dmOverride || !input.overrideReason.trim() || input.specialResource === undefined)) throw new HttpError(409, 'Special casting times require a DM decision for Action, Bonus Action, Reaction, or no action resource, plus a reason.')
      const encounter = database.prepare('SELECT status,activeCombatantId FROM encounters WHERE id=?').get(encounterId) as { status: string; activeCombatantId: string | null }
      const actionState = database.prepare('SELECT * FROM encounter_action_state WHERE combatantId=?').get(caster.id) as Record<string, unknown> | undefined
      const conditions = database.prepare('SELECT combatantId,condition,sourceCombatantId,level FROM combatant_conditions WHERE combatantId=?').all(caster.id) as unknown as conditionRules.Condition[]
      const blocked = conditionRules.preventsActions(conditions).map((entry) => entry.condition)
      const activeTurn = encounter.status === 'active' && encounter.activeCombatantId === caster.id && Number(actionState?.turnCount ?? 0) > 0
      const reactionContext = category === 'reaction' && encounter.status === 'active'
      const resourceContext = resource === 'reaction' ? reactionContext : activeTurn || encounter.status === 'active' && input.dmOverride
      const contextMissing = category === 'special' && input.specialResource === undefined || (resource !== null && !resourceContext) || category === 'reaction'
      const reasons = [...blocked, ...(caster.survivalStatus === 'dead' ? ['dead'] : [])]
      if ((contextMissing || reasons.length > 0 || (!spell.prepared && !spell.alwaysPrepared)) && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, `${contextMissing ? 'Casting time or turn context requires DM adjudication. ' : ''}${reasons.length ? `${reasons.join(', ')} prevents casting. ` : ''}An explicit DM override and reason are required.`)
      if (resource && resourceContext) {
        const usedColumn = resource === 'action' ? 'actionUsed' : resource === 'bonusAction' ? 'bonusActionUsed' : 'reactionUsed'
        const resourceState: Record<string, unknown> | undefined = resource === 'reaction' && !activeTurn && encounter.activeCombatantId ? database.prepare('SELECT reactionUsed FROM encounter_action_state WHERE combatantId=?').get(caster.id) as Record<string, unknown> | undefined : actionState
        if (resourceState && Boolean(resourceState[usedColumn])) throw new HttpError(409, `The caster’s ${resource === 'bonusAction' ? 'Bonus Action' : resource === 'reaction' ? 'Reaction' : 'Action'} is already used.`)
      }
      const now = new Date().toISOString()
      const eventId = crypto.randomUUID()
      const slotLevel = Number(spell.level) > 0 ? castLevel : null
      if (slotLevel !== null) {
        const slot = database.prepare('SELECT maximum,remaining FROM character_spell_slots WHERE characterId=? AND level=?').get(character.id, slotLevel) as { maximum: number; remaining: number } | undefined
        if (!slot || slot.maximum < 1 || slot.remaining < 1) throw new HttpError(409, `No available level ${slotLevel} spell slot.`)
        const changed = database.prepare('UPDATE character_spell_slots SET remaining=remaining-1,updatedAt=? WHERE characterId=? AND level=? AND remaining>0').run(now, character.id, slotLevel)
        if (changed.changes !== 1) throw new HttpError(409, `No available level ${slotLevel} spell slot.`)
      }
      const turnOwnerId = encounter.status === 'active' ? encounter.activeCombatantId : null
      const turnOwnerState = turnOwnerId ? database.prepare('SELECT turnCount FROM encounter_action_state WHERE combatantId=?').get(turnOwnerId) as { turnCount: number } | undefined : undefined
      const turnCount = turnOwnerState && Number(turnOwnerState.turnCount) > 0 ? Number(turnOwnerState.turnCount) : null
      if (slotLevel !== null && turnOwnerId && turnCount !== null) {
        if (database.prepare('SELECT 1 FROM encounter_spell_slot_turns WHERE encounterId=? AND turnOwnerCombatantId=? AND turnCount=?').get(encounterId, turnOwnerId, turnCount)) throw new HttpError(409, 'Only one spell slot can be expended per turn. Cantrips and other legal actions remain available.')
      }
      const resourceToConsume = resource && resourceContext ? resource : null
      if (resourceToConsume && actionState) {
        const column = resourceToConsume === 'action' ? 'actionUsed' : resourceToConsume === 'bonusAction' ? 'bonusActionUsed' : 'reactionUsed'
        database.prepare(`UPDATE encounter_action_state SET ${column}=1 WHERE combatantId=?`).run(caster.id)
      }
      const status = (reasons.length > 0 || !spell.prepared && !spell.alwaysPrepared) && !input.dmOverride || encounter.status === 'active' && resource !== null && !resourceToConsume ? 'awaiting_adjudication' : 'cast'
      const snapshot = { ...spell, castingTimeCategory: category }
      database.prepare(`INSERT INTO encounter_spell_castings(id,requestId,requestHash,campaignId,encounterId,casterCombatantId,casterName,casterCharacterId,spellId,spellName,spellSnapshot,baseLevel,castLevel,castingTimeCategory,slotLevel,actionResource,turnCount,dmOverride,overrideReason,status,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId,input.requestId,requestHash,campaignId,encounterId,caster.id,caster.name,character.id,String(spell.id),String(spell.name),JSON.stringify(snapshot),Number(spell.level),castLevel,category,slotLevel,resourceToConsume,turnCount,Number(input.dmOverride),input.dmOverride?input.overrideReason.trim():'',status,now)
      if (slotLevel !== null && turnOwnerId && turnCount !== null) database.prepare('INSERT INTO encounter_spell_slot_turns(encounterId,turnOwnerCombatantId,turnCount,castingEventId) VALUES(?,?,?,?)').run(encounterId,turnOwnerId,turnCount,eventId)
      if (resourceToConsume) database.prepare('INSERT INTO encounter_action_events(id,actionId,encounterId,combatantId,combatantName,kind,details,createdAt) VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),`spell:${eventId}`,encounterId,caster.id,caster.name,'spell_cast',JSON.stringify({resource:resourceToConsume,spellName:String(spell.name),castingEventId:eventId,...(input.dmOverride?{dmOverride:true,overrideReason:input.overrideReason.trim()}: {})}),now)
      return { event: parse(database.prepare('SELECT * FROM encounter_spell_castings WHERE id=?').get(eventId) as Record<string, unknown>), replayed: false }
    })
  }
}
export = spellCastingStore
