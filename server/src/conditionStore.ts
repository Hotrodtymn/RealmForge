import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import conditionRules = require('./conditionRules')

namespace conditionStore {
  export type Timing = 'start' | 'end'
  export type DurationType = 'indefinite' | 'turn_boundary' | 'fixed_rounds' | 'recovery_save'
  export interface RecoveryConfig { ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; dc: number; timing: Timing; notes?: string; saveModifier?: number }
  export interface DurationConfig { type: DurationType; combatantId?: string | null; timing?: Timing; rounds?: number; recovery?: RecoveryConfig }
  export interface HistoryEvent {
    id: string; eventKey: string | null; encounterId: string; combatantId: string; conditionId: string | null; condition: string;
    eventType: string; exhaustionLevel: number | null; sourceCombatantId: string | null; reason: string;
    previousValue: string | null; newValue: string | null; rollDetails: string | null; createdAt: string
  }
  interface Combatant { id: string; encounterId: string; campaignId: string; type: 'player' | 'enemy'; characterId: string | null; name: string }
  interface ConditionRow {
    id: string; combatantId: string; condition: string; level: number | null; sourceCombatantId: string | null; notes: string;
    durationType: DurationType; durationCombatantId: string | null; durationTiming: Timing | null; remainingRounds: number | null;
    originalDuration: string; recoveryAbility: RecoveryConfig['ability'] | null; recoveryDc: number | null; recoveryTiming: Timing | null;
    recoveryNotes: string; recoveryModifier: number | null; configuredAtRound: number; configuredAtTurnCount: number;
    lastRecoveryBoundary: string | null
  }
  const now = () => new Date().toISOString()
  const signed = (value: number) => value >= 0 ? `+${value}` : String(value)

  export function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try { const result = operation(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }
  function requireCombatant(campaignId: string, encounterId: string, combatantId: string): Combatant {
    const row = database.prepare(`SELECT c.id,c.encounterId,e.campaignId,c.type,c.characterId,c.name FROM encounter_combatants c JOIN encounters e ON e.id=c.encounterId WHERE c.id=? AND c.encounterId=? AND e.campaignId=?`).get(combatantId, encounterId, campaignId) as Combatant | undefined
    if (!row) throw new HttpError(404, 'Combatant not found in this campaign encounter.')
    return row
  }
  function condition(combatantId: string, key: string): ConditionRow | undefined {
    return database.prepare('SELECT * FROM combatant_conditions WHERE combatantId=? AND condition=?').get(combatantId, key) as ConditionRow | undefined
  }
  function log(input: Partial<HistoryEvent> & Pick<HistoryEvent, 'encounterId' | 'combatantId' | 'condition' | 'eventType'>): void {
    database.prepare(`INSERT OR IGNORE INTO combatant_condition_events(id,eventKey,encounterId,combatantId,conditionId,condition,eventType,exhaustionLevel,sourceCombatantId,reason,previousValue,newValue,rollDetails,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.id ?? crypto.randomUUID(), input.eventKey ?? null, input.encounterId, input.combatantId, input.conditionId ?? null, input.condition, input.eventType, input.exhaustionLevel ?? null, input.sourceCombatantId ?? null, input.reason ?? '', input.previousValue ?? null, input.newValue ?? null, input.rollDetails ?? null, input.createdAt ?? now())
  }
  export function recordDmOverrideInTransaction(encounterId: string, combatantId: string, reason: string, conditionKeys: string[], actionId: string): void {
    const combatant = database.prepare('SELECT campaignId FROM encounters WHERE id=?').get(encounterId) as { campaignId: string } | undefined
    if (!combatant) throw new HttpError(404, 'Encounter not found.')
    const keys = conditionKeys.length ? [...new Set(conditionKeys)] : ['dead']
    for (const key of keys) {
      const active = condition(combatantId, key)
      log({ encounterId, combatantId, conditionId: active?.id ?? null, condition: key, eventType: 'dm_override', eventKey: `dm-override:${actionId}:${key}`, reason: reason.trim(), previousValue: active ? JSON.stringify({ level: active.level, condition: key }) : null, newValue: JSON.stringify({ override: true }) })
    }
  }
  function validateDuration(encounterId: string, affectedId: string, combatant: Combatant, config: DurationConfig): void {
    if (!['indefinite', 'turn_boundary', 'fixed_rounds', 'recovery_save'].includes(config.type)) throw new HttpError(400, 'Choose an indefinite, turn-boundary, fixed-round, or recovery-save duration.')
    const allowedDuration = new Set(['type', 'combatantId', 'timing', 'rounds', 'recovery'])
    if (Object.keys(config as unknown as Record<string, unknown>).some((key) => !allowedDuration.has(key))) throw new HttpError(400, 'Duration configuration contains an unsupported field.')
    if (config.type === 'indefinite') {
      if (config.combatantId !== undefined || config.timing !== undefined || config.rounds !== undefined || config.recovery !== undefined) throw new HttpError(400, 'Indefinite duration does not accept turn, round, or recovery settings.')
      return
    }
    if (config.type === 'recovery_save') {
      if (config.combatantId !== undefined || config.timing !== undefined || config.rounds !== undefined) throw new HttpError(400, 'Recovery-save duration uses its recovery timing only.')
      if (!config.recovery || !['str','dex','con','int','wis','cha'].includes(config.recovery.ability) || !Number.isSafeInteger(config.recovery.dc) || config.recovery.dc < 1 || config.recovery.dc > 40 || !['start','end'].includes(config.recovery.timing)) throw new HttpError(400, 'Recovery saves require an ability, DC 1–40, and start/end timing.')
      if (Object.keys(config.recovery as unknown as Record<string, unknown>).some((key) => !['ability', 'dc', 'timing', 'notes', 'saveModifier'].includes(key))) throw new HttpError(400, 'Recovery configuration contains an unsupported field.')
      if (config.recovery.notes !== undefined && (typeof config.recovery.notes !== 'string' || config.recovery.notes.length > 300)) throw new HttpError(400, 'Recovery notes must be text up to 300 characters.')
      if (combatant.type === 'enemy' && config.recovery.saveModifier !== undefined && (!Number.isSafeInteger(config.recovery.saveModifier) || config.recovery.saveModifier! < -30 || config.recovery.saveModifier! > 30)) throw new HttpError(400, 'NPC recovery save modifier must be a whole number from -30 to 30, or leave it blank for manual DM adjudication.')
      return
    }
    if (!config.combatantId || !database.prepare('SELECT 1 FROM encounter_combatants WHERE id=? AND encounterId=?').get(config.combatantId, encounterId)) throw new HttpError(400, 'Choose a duration combatant in this encounter.')
    if (config.recovery !== undefined) throw new HttpError(400, 'Turn and round durations do not accept a recovery-save configuration.')
    if (!['start','end'].includes(config.timing ?? '')) throw new HttpError(400, 'Choose whether this duration is checked at the start or end of the selected combatant’s turn.')
    if (config.type === 'fixed_rounds' && (!Number.isSafeInteger(config.rounds) || config.rounds! < 1 || config.rounds! > 1000)) throw new HttpError(400, 'Fixed duration must be from 1 to 1000 rounds.')
    if (config.type === 'turn_boundary' && config.rounds !== undefined) throw new HttpError(400, 'Turn-boundary duration does not accept a round count.')
    void affectedId
  }
  export function validateDurationRequest(campaignId: string, encounterId: string, combatantId: string, key: string, config: DurationConfig): void {
    if (key === 'exhaustion' && config.type !== 'indefinite') throw new HttpError(400, 'Exhaustion does not expire automatically; use explicit Exhaustion adjustment or removal.')
    const actor = requireCombatant(campaignId, encounterId, combatantId)
    validateDuration(encounterId, combatantId, actor, config)
  }

  export function configure(campaignId: string, encounterId: string, combatantId: string, key: string, config: DurationConfig, reason = '', requestId?: string): ConditionRow {
    return transaction(() => {
      if (requestId && database.prepare('SELECT 1 FROM combatant_condition_events WHERE eventKey=?').get(`duration:${requestId}`)) {
        const existing = condition(combatantId, key)
        if (existing) return existing
        throw new HttpError(404, 'Condition is no longer active.')
      }
      if (key === 'exhaustion' && config.type !== 'indefinite') throw new HttpError(400, 'Exhaustion does not expire automatically; use explicit Exhaustion adjustment or removal.')
      const combatant = requireCombatant(campaignId, encounterId, combatantId)
      const current = condition(combatantId, key)
      if (!current) throw new HttpError(404, 'Condition is not active on this combatant.')
      validateDuration(encounterId, combatantId, combatant, config)
      const state = database.prepare('SELECT turnCount FROM encounter_action_state WHERE combatantId=?').get(combatantId) as { turnCount: number } | undefined
      const round = (database.prepare('SELECT round FROM encounters WHERE id=?').get(encounterId) as { round: number }).round
      const duration = config.type === 'recovery_save' ? config.recovery! : null
      const original = { type: config.type, combatantId: config.combatantId ?? null, timing: config.timing ?? null, rounds: config.rounds ?? null, recovery: duration }
      database.prepare(`UPDATE combatant_conditions SET durationType=?,durationCombatantId=?,durationTiming=?,remainingRounds=?,originalDuration=?,recoveryAbility=?,recoveryDc=?,recoveryTiming=?,recoveryNotes=?,recoveryModifier=?,configuredAtRound=?,configuredAtTurnCount=?,lastRecoveryBoundary=NULL WHERE id=?`).run(
        config.type, config.type === 'recovery_save' ? combatantId : config.combatantId ?? null,
        config.type === 'recovery_save' ? null : config.timing ?? null, config.type === 'fixed_rounds' ? config.rounds! : null,
        JSON.stringify(original), duration?.ability ?? null, duration?.dc ?? null, duration?.timing ?? null,
        duration?.notes?.trim() ?? '', duration?.saveModifier ?? null, round, state?.turnCount ?? 0, current.id)
      const eventType = current.durationType === 'indefinite' ? 'duration_configured' : 'duration_changed'
      if (eventType === 'duration_changed' && !reason.trim()) throw new HttpError(400, 'A reason is required when changing an existing duration.')
      log({ encounterId, combatantId, conditionId: current.id, condition: key, eventType, eventKey: requestId ? `duration:${requestId}` : null, reason: reason.trim(), previousValue: current.originalDuration, newValue: JSON.stringify(original) })
      if (eventType === 'duration_changed') log({ encounterId, combatantId, conditionId: current.id, condition: key, eventType: 'dm_override', eventKey: requestId ? `duration-override:${requestId}` : null, reason: reason.trim(), previousValue: current.originalDuration, newValue: JSON.stringify(original) })
      return condition(combatantId, key)!
    })
  }

  export function apply(campaignId: string, encounterId: string, combatantId: string, key: string, level?: number, sourceCombatantId: string | null = null, notes = '', duration?: DurationConfig): void {
    const combatant = requireCombatant(campaignId, encounterId, combatantId)
    if (sourceCombatantId) {
      if (sourceCombatantId === combatantId) throw new HttpError(400, 'A condition source must be a different combatant.')
      if (!database.prepare('SELECT 1 FROM encounter_combatants WHERE id=? AND encounterId=?').get(sourceCombatantId, encounterId)) throw new HttpError(404, 'Condition source must belong to this encounter.')
    }
    const current = condition(combatantId, key)
    if (key === 'exhaustion') {
      if (!Number.isSafeInteger(level) || level! < 1 || level! > 6) throw new HttpError(400, 'Exhaustion level must be a whole number from 1 to 6.')
      if (current) {
        if (current.level === level) throw new HttpError(409, `Exhaustion is already level ${level}.`)
        const eventType = level! > Number(current.level) ? 'exhaustion_increased' : 'exhaustion_decreased'
        if (level! < Number(current.level) && (!notes.trim() || notes.length > 300)) throw new HttpError(400, 'A reason up to 300 characters is required when reducing Exhaustion.')
        log({ encounterId, combatantId, conditionId: current.id, condition: key, eventType, exhaustionLevel: level!, previousValue: String(current.level), newValue: String(level), reason: notes })
        if (level! < Number(current.level)) {
          log({ encounterId, combatantId, conditionId: current.id, condition: key, eventType: 'dm_override', reason: notes.trim(), previousValue: String(current.level), newValue: String(level) })
        }
        database.prepare('UPDATE combatant_conditions SET level=?,notes=? WHERE id=?').run(level!, notes, current.id)
        if (level === 6) database.prepare("UPDATE encounter_combatants SET survivalStatus='dead',updatedAt=? WHERE id=?").run(now(), combatantId)
      } else {
        const id = crypto.randomUUID()
        database.prepare('INSERT INTO combatant_conditions (id,combatantId,condition,level,sourceCombatantId,notes,createdAt) VALUES (?,?,?,?,?,?,?)').run(id, combatantId, key, level!, sourceCombatantId, notes, now())
        log({ encounterId, combatantId, conditionId: id, condition: key, eventType: 'exhaustion_increased', exhaustionLevel: level!, previousValue: '0', newValue: String(level), reason: notes })
        if (level === 6) database.prepare("UPDATE encounter_combatants SET survivalStatus='dead',updatedAt=? WHERE id=?").run(now(), combatantId)
      }
      return
    }
    if (current) throw new HttpError(409, `${key} is already applied to this combatant.`)
    const id = crypto.randomUUID()
    database.prepare('INSERT INTO combatant_conditions (id,combatantId,condition,level,sourceCombatantId,notes,createdAt) VALUES (?,?,?,NULL,?,?,?)').run(id, combatantId, key, sourceCombatantId, notes, now())
    log({ encounterId, combatantId, conditionId: id, condition: key, eventType: 'applied', sourceCombatantId, newValue: JSON.stringify({ notes }) })
    if (duration) configure(campaignId, encounterId, combatantId, key, duration)
    void combatant
  }

  export function adjustExhaustion(campaignId: string, encounterId: string, combatantId: string, level: number, reason: string): void {
    if (!Number.isSafeInteger(level) || level < 0 || level > 6) throw new HttpError(400, 'Exhaustion level must be a whole number from 0 to 6.')
    if (!reason.trim() || reason.trim().length > 300) throw new HttpError(400, 'A reason up to 300 characters is required to adjust Exhaustion.')
    transaction(() => {
      requireCombatant(campaignId, encounterId, combatantId)
      const current = condition(combatantId, 'exhaustion')
      if (!current && level === 0) throw new HttpError(404, 'Exhaustion is not active on this combatant.')
      if (current && level === current.level) throw new HttpError(409, 'Exhaustion is already at that level.')
      if (level === 0) { remove(campaignId, encounterId, combatantId, 'exhaustion', true, reason); return }
      apply(campaignId, encounterId, combatantId, 'exhaustion', level, null, reason)
    })
  }

  export function remove(campaignId: string, encounterId: string, combatantId: string, key: string, override = false, reason = ''): void {
    requireCombatant(campaignId, encounterId, combatantId)
    const current = condition(combatantId, key)
    if (!current) throw new HttpError(404, `${key} is not applied to this combatant.`)
    if (key === 'unconscious') {
      const state = database.prepare('SELECT type,survivalStatus FROM encounter_combatants WHERE id=?').get(combatantId) as { type: string; survivalStatus: string }
      if (state.type === 'player' && state.survivalStatus !== 'conscious') throw new HttpError(409, 'Unconscious is maintained by the survival state until the character regains hit points.')
    }
    if (key === 'exhaustion' && (!reason.trim() || reason.length > 300)) throw new HttpError(400, 'A reason up to 300 characters is required when removing Exhaustion.')
    if (override && !reason.trim()) throw new HttpError(400, 'A reason is required for this DM override.')
    const eventType = key === 'exhaustion' ? 'exhaustion_decreased' : override ? 'dm_override' : 'manually_removed'
    log({ encounterId, combatantId, conditionId: current.id, condition: key, eventType, exhaustionLevel: key === 'exhaustion' ? 0 : null, reason: reason.trim(), previousValue: key === 'exhaustion' ? String(current.level) : JSON.stringify(current), newValue: key === 'exhaustion' ? '0' : null })
    if (override) log({ encounterId, combatantId, conditionId: current.id, condition: key, eventType: 'dm_override', reason: reason.trim(), previousValue: JSON.stringify(current), newValue: null })
    database.prepare('DELETE FROM combatant_conditions WHERE id=?').run(current.id)
  }

  function saveModifier(combatant: Combatant, row: ConditionRow): { modifier: number; exhaustionPenalty: number } {
    const exhaustion = Number(condition(combatant.id, 'exhaustion')?.level ?? 0)
    const penalty = conditionRules.exhaustionPenalty(exhaustion)
    if (combatant.type === 'enemy') {
      if (row.recoveryModifier === null) throw new HttpError(409, 'NPC recovery save requires an explicit modifier or manual DM adjudication.')
      return { modifier: row.recoveryModifier, exhaustionPenalty: penalty }
    }
    const character = database.prepare('SELECT c.level,c.str,c.dex,c.con,c.int,c.wis,c.cha FROM characters c WHERE c.id=?').get(combatant.characterId) as ({ level: number } & Record<string, number>) | undefined
    if (!character) throw new HttpError(409, 'Character saving throw data is unavailable; resolve this recovery save manually.')
    const score = character[row.recoveryAbility!]!
    const abilityModifier = Math.floor((score - 10) / 2)
    const proficient = Boolean(database.prepare("SELECT 1 FROM character_proficiencies WHERE characterId=? AND kind='saving_throw' AND proficiencyKey=?").get(combatant.characterId, row.recoveryAbility))
    const proficiency = proficient ? 2 + Math.floor((character.level - 1) / 4) : 0
    return { modifier: abilityModifier + proficiency, exhaustionPenalty: penalty }
  }
  function attemptRecovery(campaignId: string, encounterId: string, combatant: Combatant, row: ConditionRow, boundaryKey: string, manual?: { success: boolean; reason: string }): void {
    if (row.lastRecoveryBoundary === boundaryKey) return
    const rollInfo = manual ? null : saveModifier(combatant, row)
    const naturalRoll = manual ? null : crypto.randomInt(1, 21)
    const final = manual ? null : naturalRoll! + rollInfo!.modifier + rollInfo!.exhaustionPenalty
    const success = manual ? manual.success : final! >= row.recoveryDc!
    const details = manual ? { adjudicated: true, success, reason: manual.reason.trim(), ability: row.recoveryAbility, dc: row.recoveryDc } : {
      naturalRoll, ability: row.recoveryAbility, modifier: rollInfo!.modifier, exhaustionPenalty: rollInfo!.exhaustionPenalty, final, dc: row.recoveryDc,
      success, breakdown: `d20 (${naturalRoll}) ${signed(rollInfo!.modifier)} modifier${rollInfo!.exhaustionPenalty ? ` + Exhaustion (${signed(rollInfo!.exhaustionPenalty)})` : ''} = ${final}`,
    }
    database.prepare('UPDATE combatant_conditions SET lastRecoveryBoundary=? WHERE id=?').run(boundaryKey, row.id)
    log({ encounterId, combatantId: combatant.id, conditionId: row.id, condition: row.condition, eventType: 'recovery_save_attempted', eventKey: `recovery:${row.id}:${boundaryKey}`, exhaustionLevel: row.condition === 'exhaustion' ? row.level : null, reason: manual?.reason.trim() ?? row.recoveryNotes, rollDetails: JSON.stringify(details) })
    if (success) {
      log({ encounterId, combatantId: combatant.id, conditionId: row.id, condition: row.condition, eventType: 'recovery_save_succeeded', eventKey: `recovery-success:${row.id}:${boundaryKey}`, reason: manual?.reason.trim() ?? row.recoveryNotes, rollDetails: JSON.stringify(details) })
      database.prepare('DELETE FROM combatant_conditions WHERE id=?').run(row.id)
    } else log({ encounterId, combatantId: combatant.id, conditionId: row.id, condition: row.condition, eventType: 'recovery_save_failed', eventKey: `recovery-failed:${row.id}:${boundaryKey}`, reason: manual?.reason.trim() ?? row.recoveryNotes, rollDetails: JSON.stringify(details) })
  }

  export function processBoundary(encounterId: string, combatantId: string, timing: Timing, round: number): void {
    const actor = database.prepare(`SELECT c.id,c.encounterId,e.campaignId,c.type,c.characterId,c.name FROM encounter_combatants c JOIN encounters e ON e.id=c.encounterId WHERE c.id=? AND c.encounterId=?`).get(combatantId, encounterId) as Combatant | undefined
    if (!actor) return
    const turnCount = (database.prepare('SELECT turnCount FROM encounter_action_state WHERE combatantId=?').get(combatantId) as { turnCount: number } | undefined)?.turnCount ?? 0
    const rows = database.prepare('SELECT * FROM combatant_conditions WHERE durationCombatantId=? OR (durationType=\'recovery_save\' AND combatantId=?)').all(combatantId, combatantId) as unknown as ConditionRow[]
    for (const row of rows) {
      const boundaryKey = `${round}:${turnCount}:${timing}`
      if (row.durationType === 'recovery_save' && row.recoveryTiming === timing && row.lastRecoveryBoundary !== boundaryKey) {
        if (actor.type === 'enemy' && row.recoveryModifier === null) {
          database.prepare('UPDATE combatant_conditions SET lastRecoveryBoundary=? WHERE id=?').run(boundaryKey, row.id)
          log({ encounterId, combatantId: actor.id, conditionId: row.id, condition: row.condition, eventType: 'recovery_save_attempted', eventKey: `recovery:${row.id}:${boundaryKey}`, reason: row.recoveryNotes, rollDetails: JSON.stringify({ adjudicationRequired: true, ability: row.recoveryAbility, dc: row.recoveryDc, message: 'NPC save modifier is not configured; resolve this save manually.' }) })
        } else attemptRecovery(actor.campaignId, encounterId, actor, row, boundaryKey)
      }
      if (row.durationType === 'indefinite' || row.durationType === 'recovery_save' || row.durationTiming !== timing || row.durationCombatantId !== combatantId) continue
      if (row.durationType === 'turn_boundary') {
        log({ encounterId, combatantId: row.combatantId, conditionId: row.id, condition: row.condition, eventType: 'expired', eventKey: `expire:${row.id}:${boundaryKey}`, previousValue: row.originalDuration })
        database.prepare('DELETE FROM combatant_conditions WHERE id=?').run(row.id)
      } else if (row.durationType === 'fixed_rounds') {
        const remaining = Math.max(0, Number(row.remainingRounds) - 1)
        if (remaining === 0) {
          log({ encounterId, combatantId: row.combatantId, conditionId: row.id, condition: row.condition, eventType: 'expired', eventKey: `expire:${row.id}:${boundaryKey}`, previousValue: JSON.stringify({ remainingRounds: row.remainingRounds }), newValue: '0' })
          database.prepare('DELETE FROM combatant_conditions WHERE id=?').run(row.id)
        } else {
          database.prepare('UPDATE combatant_conditions SET remainingRounds=? WHERE id=?').run(remaining, row.id)
          log({ encounterId, combatantId: row.combatantId, conditionId: row.id, condition: row.condition, eventType: 'duration_changed', eventKey: `round:${row.id}:${boundaryKey}`, previousValue: String(row.remainingRounds), newValue: String(remaining) })
        }
      }
    }
  }

  export function resolveRecovery(campaignId: string, encounterId: string, combatantId: string, key: string, success: boolean, reason: string, requestId?: string): void {
    if (typeof success !== 'boolean' || !reason.trim() || reason.trim().length > 300) throw new HttpError(400, 'DM resolution requires a success/failure result and a reason up to 300 characters.')
    transaction(() => {
      if (requestId && database.prepare('SELECT 1 FROM combatant_condition_events WHERE eventKey=?').get(`manual-recovery:${requestId}`)) return
      const actor = requireCombatant(campaignId, encounterId, combatantId)
      const row = condition(combatantId, key)
      if (!row || row.durationType !== 'recovery_save' || row.recoveryDc === null) throw new HttpError(409, 'This condition has no configured recovery save.')
      const encounter = database.prepare('SELECT round FROM encounters WHERE id=?').get(encounterId) as { round: number }
      const turn = (database.prepare('SELECT turnCount FROM encounter_action_state WHERE combatantId=?').get(combatantId) as { turnCount: number } | undefined)?.turnCount ?? 0
      const boundary = `${encounter.round}:${turn}:${row.recoveryTiming}:manual:${requestId ?? crypto.randomUUID()}`
      attemptRecovery(campaignId, encounterId, actor, row, boundary, { success, reason })
      log({ encounterId, combatantId, conditionId: row.id, condition: key, eventType: 'dm_override', eventKey: requestId ? `manual-recovery:${requestId}` : null, reason: reason.trim(), rollDetails: JSON.stringify({ success, adjudicated: true }) })
    })
  }
  export function history(campaignId: string, encounterId: string, combatantId?: string): HistoryEvent[] {
    if (!database.prepare('SELECT 1 FROM encounters WHERE id=? AND campaignId=?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
    if (combatantId) requireCombatant(campaignId, encounterId, combatantId)
    return database.prepare(`SELECT * FROM combatant_condition_events WHERE encounterId=? ${combatantId ? 'AND combatantId=?' : ''} ORDER BY rowid DESC LIMIT 100`).all(...(combatantId ? [encounterId, combatantId] : [encounterId])) as unknown as HistoryEvent[]
  }
}

export = conditionStore
