import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import attackStore = require('./attackStore')
import conditionRules = require('./conditionRules')
import spellResolutionRules = require('./spellResolutionRules')
import spellRules = require('./spellRules')

namespace spellResolutionStore {
  type Mode = spellResolutionRules.AttackMode
  interface Input {
    casterId: string
    spellId: string
    targetIds: string[]
    mode: Mode
    requestId: string
    castingEventId?: string | null
    context: conditionRules.AttackContext
    npcSaveModifiers: Record<string, number>
    dmOverride: boolean
    overrideReason: string
  }
  interface Combatant { id: string; characterId: string | null; type: 'player' | 'enemy'; name: string; survivalStatus: string }
  export interface SpellResolutionRecord { id: string; requestId: string; campaignId: string; encounterId: string; casterCombatantId: string; casterName: string; casterCharacterId: string; spellId: string; spellName: string; resolutionType: 'attack' | 'save'; castingEventId: string | null; manualMode: Mode; results: Record<string, unknown>[]; dmOverride: boolean; overrideReason: string; createdAt: string }

  function transaction<T>(fn: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try { const result = fn(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }

  function requireEncounter(campaignId: string, encounterId: string) {
    const row = database.prepare('SELECT id,campaignId,name FROM encounters WHERE id=? AND campaignId=?').get(encounterId, campaignId) as { id: string; campaignId: string; name: string } | undefined
    if (!row) throw new HttpError(404, 'Encounter not found for this campaign.')
    return row
  }

  function requireCombatant(encounterId: string, combatantId: string): Combatant {
    const row = database.prepare('SELECT id,characterId,type,name,survivalStatus FROM encounter_combatants WHERE id=? AND encounterId=?').get(combatantId, encounterId) as Combatant | undefined
    if (!row) throw new HttpError(404, 'Combatant not found in this encounter.')
    return row
  }

  function spellRecord(row: Record<string, unknown>) {
    return {
      id: String(row.id), name: String(row.name), level: Number(row.level), resolutionType: row.resolutionType as spellRules.SpellResolutionType,
      savingThrowAbility: row.savingThrowAbility as spellRules.AbilityKey | null, attackType: row.attackType as spellRules.SpellAttackType | null,
      targetGuidance: String(row.targetGuidance ?? ''), resolutionNotes: String(row.resolutionNotes ?? ''), sourceVersion: String(row.sourceVersion),
    }
  }

  function parse(row: Record<string, unknown>): SpellResolutionRecord {
    return { id: String(row.id), requestId: String(row.requestId), campaignId: String(row.campaignId), encounterId: String(row.encounterId), casterCombatantId: String(row.casterCombatantId), casterName: String(row.casterName), casterCharacterId: String(row.casterCharacterId), spellId: String(row.spellId), spellName: String(row.spellName), resolutionType: row.resolutionType as 'attack' | 'save', castingEventId: row.castingEventId === null ? null : String(row.castingEventId), manualMode: (JSON.parse(String(row.results)) as { manualMode: Mode }).manualMode, results: (JSON.parse(String(row.results)) as { targets: Record<string, unknown>[] }).targets, dmOverride: Boolean((JSON.parse(String(row.results)) as { dmOverride: boolean }).dmOverride), overrideReason: String((JSON.parse(String(row.results)) as { overrideReason: string }).overrideReason), createdAt: String(row.createdAt) }
  }

  export function list(campaignId: string, encounterId: string): SpellResolutionRecord[] {
    requireEncounter(campaignId, encounterId)
    return (database.prepare('SELECT * FROM encounter_spell_resolutions WHERE campaignId=? AND encounterId=? ORDER BY createdAt DESC,rowid DESC LIMIT 20').all(campaignId, encounterId) as unknown as Record<string, unknown>[]).map(parse)
  }

  function hashInput(campaignId: string, encounterId: string, input: Input): string {
    const stable = { campaignId, encounterId, ...input, targetIds: [...input.targetIds].sort(), context: Object.fromEntries(Object.entries(input.context).sort(([a], [b]) => a.localeCompare(b))), npcSaveModifiers: Object.fromEntries(Object.entries(input.npcSaveModifiers).sort(([a], [b]) => a.localeCompare(b))) }
    return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex')
  }

  export function create(campaignId: string, encounterId: string, input: Input): { resolution: SpellResolutionRecord; replayed: boolean } {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      const requestHash = hashInput(campaignId, encounterId, input)
      const existing = database.prepare('SELECT * FROM encounter_spell_resolutions WHERE requestId=?').get(input.requestId) as Record<string, unknown> | undefined
      if (existing) {
        if (existing.requestHash !== requestHash) throw new HttpError(409, 'This request ID was already used for a different spell resolution.')
        return { resolution: parse(existing), replayed: true }
      }

      const caster = requireCombatant(encounterId, input.casterId)
      if (caster.type !== 'player' || !caster.characterId) throw new HttpError(400, 'Spell resolution requires a player character with a configured spellbook as caster.')
      const character = database.prepare(`SELECT c.id,c.name,c.level,c.str,c.dex,c.con,c.int,c.wis,c.cha,m.campaignId,m.playerId
        FROM characters c JOIN campaign_memberships m ON m.id=c.membershipId WHERE c.id=? AND m.campaignId=?`).get(caster.characterId, campaignId) as ({ id: string; name: string; level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number; campaignId: string; playerId: string }) | undefined
      if (!character) throw new HttpError(404, 'Caster character does not belong to this campaign.')
      if (input.castingEventId) {
        const cast = database.prepare('SELECT casterCombatantId,spellId,status FROM encounter_spell_castings WHERE id=? AND campaignId=? AND encounterId=?').get(input.castingEventId,campaignId,encounterId) as {casterCombatantId:string;spellId:string;status:string}|undefined
        if (!cast || cast.casterCombatantId !== caster.id || cast.spellId !== input.spellId) throw new HttpError(409, 'This spell resolution does not match the linked casting event, encounter, caster, or spell.')
        if (cast.status === 'awaiting_adjudication' && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, 'This cast is awaiting DM adjudication. Confirm its resolution with an explicit reason.')
      }
      const casting = database.prepare('SELECT enabled,ability FROM character_spellcasting WHERE characterId=?').get(character.id) as { enabled: number; ability: spellRules.SpellAbility | null } | undefined
      if (!casting?.enabled || !casting.ability) throw new HttpError(409, 'Caster spellcasting is disabled or incomplete; configure a spellcasting ability first.')
      const memberSpell = database.prepare(`SELECT s.* FROM character_spellbook b JOIN character_spells s ON s.id=b.spellId WHERE b.characterId=? AND b.spellId=?`).get(character.id, input.spellId) as Record<string, unknown> | undefined
      if (!memberSpell) throw new HttpError(404, 'Spell is not in the caster’s spellbook.')
      const spell = spellRecord(memberSpell)
      if (spell.resolutionType === 'none') throw new HttpError(409, 'This spell has no explicit attack or saving throw resolution metadata. Configure a future spell rule or adjudicate it manually.')
      if (spell.resolutionType === 'save' && !spell.savingThrowAbility) throw new HttpError(409, 'This saving throw spell has no configured saving throw ability.')
      if (spell.resolutionType === 'attack' && !spell.attackType) throw new HttpError(409, 'This spell attack has no configured attack type.')
      if (spell.resolutionType === 'save' && input.mode !== 'normal') throw new HttpError(400, 'Manual Advantage or Disadvantage applies to spell attack rolls; saving throw modes come from target conditions.')
      if (input.targetIds.length === 0 || input.targetIds.length > 20) throw new HttpError(400, 'Choose between 1 and 20 encounter targets.')
      if (new Set(input.targetIds).size !== input.targetIds.length) throw new HttpError(400, 'A target cannot appear more than once in a spell resolution.')
      if (spell.resolutionType === 'attack' && input.targetIds.length !== 1) throw new HttpError(400, 'Spell attack rolls resolve against exactly one target.')

      const bookEntry = database.prepare('SELECT prepared,alwaysPrepared FROM character_spellbook WHERE characterId=? AND spellId=?').get(character.id, spell.id) as { prepared: number; alwaysPrepared: number }
      const warnings: string[] = []
      if (!bookEntry.prepared && !bookEntry.alwaysPrepared) {
        warnings.push('Class-specific preparation rules are not configured. This spell is not marked prepared; confirm its eligibility with the DM.')
        if (!input.dmOverride || !input.overrideReason.trim()) throw new HttpError(409, `${warnings[0]} An explicit DM confirmation and reason are required to proceed.`)
      }
      const casterConditions = database.prepare('SELECT combatantId,condition,sourceCombatantId,level FROM combatant_conditions WHERE combatantId=?').all(caster.id) as unknown as conditionRules.Condition[]
      const actionBlock = conditionRules.attackActionBlock(casterConditions) ?? (caster.survivalStatus === 'dead' ? 'A dead combatant cannot cast a spell.' : null)
      if (actionBlock && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, `${actionBlock} A DM override requires an explicit reason.`)
      if (actionBlock) warnings.push(`DM override: ${actionBlock}`)

      const abilityScore = character[casting.ability]
      const attackBonus = spellResolutionRules.spellAttackBonus(abilityScore, character.level)
      const saveDc = spellResolutionRules.spellSaveDc(abilityScore, character.level)
      const targets = input.targetIds.map((targetId) => requireCombatant(encounterId, targetId))
      for (const [targetId] of Object.entries(input.npcSaveModifiers)) {
        const target = targets.find((entry) => entry.id === targetId)
        if (!target) throw new HttpError(400, 'An explicit NPC modifier references a target outside this spell resolution.')
        if (target.type !== 'enemy') throw new HttpError(400, 'Explicit NPC saving throw modifiers can only be supplied for NPC targets.')
        if (spell.resolutionType !== 'save') throw new HttpError(400, 'NPC saving throw modifiers are only valid for saving throw spells.')
      }
      const results: Record<string, unknown>[] = []
      for (const target of targets) {
        const targetConditions = database.prepare('SELECT combatantId,condition,sourceCombatantId,level FROM combatant_conditions WHERE combatantId=?').all(target.id) as unknown as conditionRules.Condition[]
        const charmedSource = casterConditions.some((condition) => condition.condition === 'charmed' && condition.sourceCombatantId === target.id)
        if (charmedSource && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, 'Charmed casters cannot target their charmer with harmful spells. A DM override requires an explicit reason.')
        if (charmedSource) warnings.push(`DM override: charmed caster targeted ${target.name}.`)
        const exhaustionLevel = Number((targetConditions.find((condition) => condition.condition === 'exhaustion')?.level) ?? 0)
        const exhaustionPenalty = conditionRules.exhaustionPenalty(exhaustionLevel)
        if (spell.resolutionType === 'attack') {
          const effect = conditionRules.attackEffects(caster.id, target.id, casterConditions, targetConditions, input.mode, input.context)
          if (effect.blockedReason && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, `${effect.blockedReason} A DM override requires an explicit reason.`)
          const finalMode = effect.mode
          const targetAC = attackStore.targetArmorClass(campaignId, encounterId, target.id)
          const casterExhaustion = Number((casterConditions.find((condition) => condition.condition === 'exhaustion')?.level) ?? 0)
          const casterExhaustionPenalty = conditionRules.exhaustionPenalty(casterExhaustion)
          const resolution = spellResolutionRules.resolveSpellAttack(attackBonus, targetAC, finalMode, casterExhaustionPenalty, undefined, effect.criticalOnHit)
          results.push({ targetId: target.id, targetName: target.name, resolutionType: 'attack', ability: casting.ability, abilityModifier: Math.floor((abilityScore - 10) / 2), proficiencyBonus: attackBonus - Math.floor((abilityScore - 10) / 2), spellAttackBonus: attackBonus, targetAC, manualMode: input.mode, finalMode, diceResults: resolution.diceResults, keptIndex: resolution.keptIndex, naturalRoll: resolution.diceResults[resolution.keptIndex], exhaustionLevel: casterExhaustion, exhaustionPenalty: casterExhaustionPenalty, advantageSources: effect.advantageSources, disadvantageSources: effect.disadvantageSources, conditionWarnings: [...effect.warnings, ...warnings], context: effect.appliedContext, outcome: resolution.outcome, total: resolution.total, breakdown: `d20 (${resolution.diceResults.map((die, index) => `${die}${index === resolution.keptIndex ? ' kept' : ''}`).join(' / ')}) + ${casting.ability.toUpperCase()} (${Math.floor((abilityScore - 10) / 2) >= 0 ? '+' : ''}${Math.floor((abilityScore - 10) / 2)}) + Proficiency (+${attackBonus - Math.floor((abilityScore - 10) / 2)})${casterExhaustionPenalty ? ` + Exhaustion (${casterExhaustionPenalty})` : ''} = ${resolution.total} vs AC ${targetAC}`, dmOverride: input.dmOverride || Boolean(effect.blockedReason), overrideReason: input.dmOverride || effect.blockedReason ? input.overrideReason.trim() : '' })
          continue
        }

        const saveAbility = spell.savingThrowAbility!
        const autoFailConditions = targetConditions.filter((condition) => ['paralyzed', 'stunned', 'petrified'].includes(condition.condition) && ['str', 'dex'].includes(saveAbility)).map((condition) => condition.condition)
        const restrainedDisadvantage = saveAbility === 'dex' && targetConditions.some((condition) => condition.condition === 'restrained')
        let targetModifier: number | undefined
        let modifierSource: 'character' | 'explicit_npc' | null = null
        if (target.type === 'player' && target.characterId) {
          const targetCharacter = database.prepare('SELECT level,str,dex,con,int,wis,cha FROM characters WHERE id=?').get(target.characterId) as { level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number } | undefined
          if (!targetCharacter) throw new HttpError(409, 'Target character saving throw data is unavailable; resolve this save manually.')
          const proficient = Boolean(database.prepare(`SELECT 1 FROM character_proficiencies WHERE characterId=? AND kind='saving_throw' AND proficiencyKey=?`).get(target.characterId, saveAbility))
          targetModifier = spellResolutionRules.savingThrowModifier(targetCharacter[saveAbility], targetCharacter.level, proficient)
          modifierSource = 'character'
        } else if (Object.hasOwn(input.npcSaveModifiers, target.id)) {
          targetModifier = input.npcSaveModifiers[target.id]
          modifierSource = 'explicit_npc'
        }
        const autoFail = autoFailConditions.length > 0
        let diceResults: number[] = []
        let keptIndex = 0
        let finalMode: 'normal' | 'disadvantage' = 'normal'
        let naturalRoll: number | undefined
        if (!autoFail && targetModifier !== undefined) {
          finalMode = restrainedDisadvantage ? 'disadvantage' : 'normal'
          diceResults = Array.from({ length: restrainedDisadvantage ? 2 : 1 }, () => crypto.randomInt(1, 21))
          if (diceResults.some((die) => !Number.isSafeInteger(die) || die < 1 || die > 20)) throw new HttpError(500, 'Secure dice source returned an invalid d20 result.')
          if (finalMode === 'disadvantage' && diceResults[1]! < diceResults[0]!) keptIndex = 1
          naturalRoll = diceResults[keptIndex]
        }
        const save = spellResolutionRules.resolveSavingThrow({ ...(naturalRoll === undefined ? {} : { naturalRoll }), ...(targetModifier === undefined ? {} : { targetModifier }), exhaustionPenalty, dc: saveDc, autoFail })
        results.push({ targetId: target.id, targetName: target.name, resolutionType: 'save', ability: saveAbility, casterSpellSaveDc: saveDc, targetModifier: save.targetModifier, modifierSource, proficient: modifierSource === 'character' ? Boolean(targetModifier !== undefined && target.characterId && database.prepare(`SELECT 1 FROM character_proficiencies WHERE characterId=? AND kind='saving_throw' AND proficiencyKey=?`).get(target.characterId, saveAbility)) : null, exhaustionLevel, exhaustionPenalty, manualMode: 'normal', finalMode, diceResults, keptIndex: diceResults.length ? keptIndex : null, naturalRoll: save.naturalRoll, total: save.total, dc: save.dc, outcome: save.outcome, breakdown: save.breakdown, automaticFailureConditions: autoFailConditions, disadvantageSources: restrainedDisadvantage ? ['Restrained target: Disadvantage on Dexterity saving throws'] : [], conditionWarnings: warnings, dmOverride: input.dmOverride || modifierSource === 'explicit_npc', overrideReason: modifierSource === 'explicit_npc' || input.dmOverride ? input.overrideReason.trim() : '' })
      }

      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      const resultSnapshot = { manualMode: input.mode, dmOverride: input.dmOverride, overrideReason: input.dmOverride ? input.overrideReason.trim() : '', spell }
      const record: SpellResolutionRecord = { id, requestId: input.requestId, campaignId, encounterId, casterCombatantId: caster.id, casterName: caster.name, casterCharacterId: character.id, spellId: spell.id, spellName: spell.name, resolutionType: spell.resolutionType, castingEventId: input.castingEventId ?? null, manualMode: input.mode, results, dmOverride: input.dmOverride, overrideReason: input.dmOverride ? input.overrideReason.trim() : '', createdAt }
      database.prepare(`INSERT INTO encounter_spell_resolutions(id,requestId,requestHash,campaignId,encounterId,casterCombatantId,casterName,casterCharacterId,spellId,spellName,resolutionType,results,createdAt,castingEventId)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.requestId, requestHash, campaignId, encounterId, caster.id, caster.name, character.id, spell.id, spell.name, spell.resolutionType, JSON.stringify({ ...resultSnapshot, targets: results }), createdAt, input.castingEventId ?? null)
      return { resolution: record, replayed: false }
    })
  }
}

export = spellResolutionStore
