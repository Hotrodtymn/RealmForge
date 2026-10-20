import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import damageRules = require('./damageRules')
import survivalStore = require('./survivalStore')
import spellEffectRules = require('./spellEffectRules')
import spellRules = require('./spellRules')

namespace spellEffectStore {
  export interface RollInput {
    requestId: string
    castingEventId?: string | null
    casterId: string
    spellId: string
    targetIds: string[]
    castLevel: number
    resolutionId: string | null
    dmOverride: boolean
    overrideReason: string
    adjudicatedSaveOutcomes: Record<string, 'success' | 'failure'>
  }
  interface RollRecord extends Record<string, unknown> {
    id: string; requestId: string; requestHash: string; campaignId: string; encounterId: string; targetId: string
    diceResults: string; effectType: 'damage' | 'healing'; status: 'rolled' | 'no_effect' | 'adjudication_required'
  }
  export interface Application extends Record<string, unknown> { id: string; requestId: string; requestHash: string; rollId: string; campaignId: string; encounterId: string; targetId: string; effectType: 'damage' | 'healing'; amount: number; hpBefore: number; hpAfter: number; message: string; createdAt: string }

  function transaction<T>(fn: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try { const result = fn(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }
  function requireEncounter(campaignId: string, encounterId: string) {
    if (!database.prepare('SELECT 1 FROM encounters WHERE id=? AND campaignId=?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
  }
  function requireCombatant(encounterId: string, id: string) {
    const row = database.prepare('SELECT id,characterId,type,name,survivalStatus,currentHp,maxHp FROM encounter_combatants WHERE id=? AND encounterId=?').get(id, encounterId) as { id: string; characterId: string | null; type: 'player' | 'enemy'; name: string; survivalStatus: string; currentHp: number; maxHp: number } | undefined
    if (!row) throw new HttpError(404, 'Combatant not found in this encounter.')
    return row
  }
  function hash(value: unknown): string { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }
  function requestHash(campaignId: string, encounterId: string, input: RollInput): string {
    return hash({ campaignId, encounterId, ...input, targetIds: [...input.targetIds].sort(), adjudicatedSaveOutcomes: Object.fromEntries(Object.entries(input.adjudicatedSaveOutcomes).sort(([a], [b]) => a.localeCompare(b))) })
  }
  function parseRoll(row: RollRecord) {
    return { ...row, diceResults: JSON.parse(row.diceResults) as number[], critical: Boolean(row.critical), applied: Boolean(database.prepare('SELECT 1 FROM encounter_spell_effect_applications WHERE rollId=?').get(row.id)) }
  }
  function parseApplication(row: Record<string, unknown>): Application {
    return { ...row, amount: Number(row.amount), hpBefore: Number(row.hpBefore), hpAfter: Number(row.hpAfter) } as Application
  }

  export function list(campaignId: string, encounterId: string) {
    requireEncounter(campaignId, encounterId)
    const rolls = database.prepare('SELECT * FROM encounter_spell_effect_rolls WHERE campaignId=? AND encounterId=? ORDER BY createdAt DESC,rowid DESC LIMIT 50').all(campaignId, encounterId) as unknown as RollRecord[]
    const applications = database.prepare('SELECT * FROM encounter_spell_effect_applications WHERE campaignId=? AND encounterId=? ORDER BY createdAt DESC,rowid DESC LIMIT 50').all(campaignId, encounterId) as unknown as Record<string, unknown>[]
    return { rolls: rolls.map(parseRoll), applications: applications.map(parseApplication) }
  }

  function linkedResolution(campaignId: string, encounterId: string, input: RollInput, casterCharacterId: string, spellId: string, resolutionType: spellRules.SpellResolutionType) {
    if (resolutionType === 'none') {
      if (input.resolutionId) throw new HttpError(400, 'This spell does not require an attack or saving throw resolution.')
      return null
    }
    if (!input.resolutionId) throw new HttpError(409, 'Resolve this spell attack or saving throw before rolling its effect.')
    const row = database.prepare('SELECT * FROM encounter_spell_resolutions WHERE id=? AND campaignId=? AND encounterId=?').get(input.resolutionId, campaignId, encounterId) as Record<string, unknown> | undefined
    if (!row || row.spellId !== spellId || row.casterCharacterId !== casterCharacterId || row.resolutionType !== resolutionType) throw new HttpError(409, 'The selected spell resolution does not match this caster, spell, encounter, or resolution type.')
    if (input.castingEventId && row.castingEventId !== input.castingEventId) throw new HttpError(409, 'The spell resolution belongs to a different casting event.')
    return { id: String(row.id), casterCombatantId: String(row.casterCombatantId), castingEventId: row.castingEventId ? String(row.castingEventId) : null, targets: (JSON.parse(String(row.results)) as { targets: Record<string, unknown>[] }).targets }
  }

  export function roll(campaignId: string, encounterId: string, input: RollInput) {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      const digest = requestHash(campaignId, encounterId, input)
      const previous = database.prepare('SELECT * FROM encounter_spell_effect_rolls WHERE requestId=? ORDER BY rowid').all(input.requestId) as unknown as RollRecord[]
      if (previous.length) {
        if (previous.some((row) => row.requestHash !== digest)) throw new HttpError(409, 'This request ID was already used for a different spell effect roll.')
        return { rolls: previous.map(parseRoll), replayed: true }
      }
      if (input.targetIds.length < 1 || input.targetIds.length > 20 || new Set(input.targetIds).size !== input.targetIds.length) throw new HttpError(400, 'Choose between 1 and 20 distinct encounter targets.')
      const caster = requireCombatant(encounterId, input.casterId)
      if (caster.type !== 'player' || !caster.characterId) throw new HttpError(400, 'Spell effects require a player character as caster.')
      const character = database.prepare(`SELECT c.id,c.name,c.level,c.str,c.dex,c.con,c.int,c.wis,c.cha,m.campaignId FROM characters c JOIN campaign_memberships m ON m.id=c.membershipId WHERE c.id=? AND m.campaignId=?`).get(caster.characterId, campaignId) as ({ id: string; name: string; level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number; campaignId: string }) | undefined
      if (!character) throw new HttpError(404, 'Caster character does not belong to this campaign.')
      const spellRow = database.prepare(`SELECT s.*,b.prepared,b.alwaysPrepared FROM character_spellbook b JOIN character_spells s ON s.id=b.spellId WHERE b.characterId=? AND b.spellId=?`).get(character.id, input.spellId) as Record<string, unknown> | undefined
      if (!spellRow) throw new HttpError(404, 'Spell is not in the caster’s spellbook.')
      if (input.castingEventId) {
        const cast = database.prepare('SELECT casterCombatantId,spellId,castLevel,status FROM encounter_spell_castings WHERE id=? AND campaignId=? AND encounterId=?').get(input.castingEventId,campaignId,encounterId) as {casterCombatantId:string;spellId:string;castLevel:number;status:string}|undefined
        if (!cast || cast.casterCombatantId !== caster.id || cast.spellId !== input.spellId || cast.castLevel !== input.castLevel) throw new HttpError(409, 'This effect roll does not match the linked casting event, encounter, caster, spell, or cast level.')
        if (cast.status === 'awaiting_adjudication' && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, 'This cast is awaiting DM adjudication. Confirm its effect roll with an explicit reason.')
      }
      const spell = {
        id: String(spellRow.id), name: String(spellRow.name), level: Number(spellRow.level), resolutionType: spellRow.resolutionType as spellRules.SpellResolutionType,
        effectType: (spellRow.effectType ?? 'none') as spellRules.SpellEffectType, effectFormula: String(spellRow.effectFormula ?? ''), damageType: (spellRow.damageType ?? null) as string | null,
        effectModifier: Number(spellRow.effectModifier ?? 0), includeSpellcastingModifier: Boolean(spellRow.includeSpellcastingModifier), saveSuccessEffect: (spellRow.saveSuccessEffect ?? null) as spellRules.SaveSuccessEffect | null,
        upcastMode: (spellRow.upcastMode ?? 'none') as spellRules.UpcastMode, upcastDiceCount: Number(spellRow.upcastDiceCount ?? 0), upcastDieSize: (spellRow.upcastDieSize ?? null) as number | null,
        upcastModifier: Number(spellRow.upcastModifier ?? 0), effectNotes: String(spellRow.effectNotes ?? ''),
      }
      if (!['damage', 'healing'].includes(spell.effectType)) throw new HttpError(409, 'This spell has no explicit automated damage or healing metadata.')
      if (spell.effectType === 'damage' && (!spell.damageType || !damageRules.damageTypes.includes(spell.damageType as damageRules.DamageType))) throw new HttpError(409, 'This spell damage effect has no valid damage type.')
      const casting = database.prepare('SELECT enabled,ability FROM character_spellcasting WHERE characterId=?').get(character.id) as { enabled: number; ability: spellRules.SpellAbility | null } | undefined
      if (!casting?.enabled || !casting.ability) throw new HttpError(409, 'Caster spellcasting is disabled or incomplete; configure a spellcasting ability first.')
      if (spell.includeSpellcastingModifier && !casting.ability) throw new HttpError(409, 'This spell effect requires a configured spellcasting ability modifier.')
      if (!Boolean(spellRow.prepared) && !Boolean(spellRow.alwaysPrepared) && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, 'Class-specific preparation rules are not represented. An explicit DM override and reason are required for an unprepared spell.')
      const plan = spellEffectRules.plan(spell, spell.level, input.castLevel)
      const resolution = linkedResolution(campaignId, encounterId, input, character.id, spell.id, spell.resolutionType)
      const castingEventId = input.castingEventId ?? resolution?.castingEventId ?? null
      const abilityModifier = spell.includeSpellcastingModifier ? Math.floor((character[casting.ability] - 10) / 2) : 0
      const targets = input.targetIds.map((id) => requireCombatant(encounterId, id))
      if (resolution && resolution.casterCombatantId !== caster.id) throw new HttpError(409, 'The linked spell resolution was made by a different combatant.')
      if (spell.resolutionType === 'attack' && targets.length !== 1) throw new HttpError(400, 'Spell attacks resolve effects against exactly one target.')
      for (const [targetId] of Object.entries(input.adjudicatedSaveOutcomes)) {
        if (!targets.some((target) => target.id === targetId) || spell.resolutionType !== 'save' || !input.dmOverride || !input.overrideReason.trim()) throw new HttpError(400, 'Adjudicated save outcomes require a selected saving throw target and an explicit DM override reason.')
      }
      const createdAt = new Date().toISOString()
      const rolls: Record<string, unknown>[] = []
      for (const target of targets) {
        const resolutionTarget = resolution?.targets.find((entry) => entry.targetId === target.id)
        if (resolution && !resolutionTarget) throw new HttpError(409, `${target.name} is not included in the linked spell resolution.`)
        const attackOutcome = spell.resolutionType === 'attack' ? String(resolutionTarget?.outcome ?? '') : null
        const savedOutcome = spell.resolutionType === 'save' ? String(resolutionTarget?.outcome ?? '') : null
        let adjudicatedOutcome: 'success' | 'failure' | null = null
        if (savedOutcome === 'adjudication_required') adjudicatedOutcome = input.adjudicatedSaveOutcomes[target.id] ?? null
        else if (input.adjudicatedSaveOutcomes[target.id]) throw new HttpError(400, 'Only a save already marked for adjudication may receive a manual outcome override.')
        let status: 'rolled' | 'no_effect' | 'adjudication_required' = 'rolled'
        let diceResults: number[] = []
        let critical = attackOutcome === 'critical_hit'
        let fullAmount = 0
        let appliedAmount = 0
        let effectiveSave = (savedOutcome === 'success' || savedOutcome === 'failure' ? savedOutcome : adjudicatedOutcome) as 'success' | 'failure' | null
        if (attackOutcome === 'miss' && (!input.dmOverride || !input.overrideReason.trim())) throw new HttpError(409, 'A missed spell attack cannot roll damage without an explicit DM adjudication and reason.')
        if (savedOutcome === 'adjudication_required' && !adjudicatedOutcome) status = 'adjudication_required'
        if (spell.resolutionType === 'save' && effectiveSave === 'success' && spell.saveSuccessEffect === null) throw new HttpError(409, 'This saving throw spell has no explicit effect on a successful save; adjudicate it manually.')
        if (spell.resolutionType === 'save' && effectiveSave === 'success' && spell.saveSuccessEffect === 'none') status = 'no_effect'
        if (status === 'rolled') {
          const result = damageRules.resolveDamage({ diceCount: plan.diceCount, dieSize: plan.dieSize, formulaModifier: plan.formulaModifier, abilityModifier, situationalModifier: 0, critical: critical && spell.effectType === 'damage' })
          diceResults = result.diceResults
          fullAmount = result.total
          if (spell.resolutionType === 'save') {
            const scaled = spellEffectRules.saveAmount(fullAmount, effectiveSave === 'success', spell.saveSuccessEffect)
            appliedAmount = scaled.amount
            status = scaled.status
          } else appliedAmount = fullAmount
        }
        if (status !== 'rolled') { critical = critical && spell.effectType === 'damage'; fullAmount = 0; appliedAmount = 0 }
        const id = crypto.randomUUID()
        const finalFormula = critical && spell.effectType === 'damage' ? `${plan.diceCount * 2}d${plan.dieSize}${plan.formulaModifier === 0 ? '' : plan.formulaModifier > 0 ? `+${plan.formulaModifier}` : String(plan.formulaModifier)}` : plan.finalFormula
        database.prepare(`INSERT INTO encounter_spell_effect_rolls(id,requestId,requestHash,campaignId,encounterId,casterCombatantId,casterName,casterCharacterId,spellId,spellName,effectType,resolutionId,resolutionType,targetId,targetName,castLevel,baseLevel,baseFormula,finalFormula,diceCount,dieSize,diceResults,formulaModifier,effectModifier,ability,abilityModifier,damageType,saveOutcome,saveSuccessEffect,attackOutcome,critical,fullAmount,appliedAmount,status,scaling,notes,createdAt,castingEventId)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, input.requestId, digest, campaignId, encounterId, caster.id, caster.name, character.id, spell.id, spell.name, spell.effectType, resolution?.id ?? null, spell.resolutionType, target.id, target.name, plan.castLevel, plan.baseLevel, plan.baseFormula, finalFormula, plan.diceCount * (critical && spell.effectType === 'damage' ? 2 : 1), plan.dieSize, JSON.stringify(diceResults), plan.formulaModifier, plan.fixedModifier, spell.includeSpellcastingModifier ? casting.ability : null, abilityModifier, spell.damageType, effectiveSave ?? (savedOutcome === 'adjudication_required' ? 'adjudication_required' : null), spell.saveSuccessEffect, attackOutcome, Number(critical), fullAmount, appliedAmount, status, plan.scaling, [spell.effectNotes, input.dmOverride ? `DM override: ${input.overrideReason.trim()}` : ''].filter(Boolean).join(' '), createdAt, castingEventId)
        const saved = database.prepare('SELECT * FROM encounter_spell_effect_rolls WHERE id=?').get(id) as unknown as RollRecord
        rolls.push(parseRoll(saved))
      }
      return { rolls, replayed: false }
    })
  }

  export function apply(campaignId: string, encounterId: string, rollId: string, requestId: string) {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      const digest = hash({ campaignId, encounterId, rollId })
      const prior = database.prepare('SELECT * FROM encounter_spell_effect_applications WHERE requestId=?').get(requestId) as unknown as Record<string, unknown> | undefined
      if (prior) {
        if (prior.requestHash !== digest) throw new HttpError(409, 'This application request ID was already used for a different payload.')
        return { application: parseApplication(prior), replayed: true }
      }
      const row = database.prepare('SELECT * FROM encounter_spell_effect_rolls WHERE id=? AND campaignId=? AND encounterId=?').get(rollId, campaignId, encounterId) as unknown as RollRecord | undefined
      if (!row) throw new HttpError(404, 'Spell effect roll was not found in this encounter.')
      if (row.status === 'adjudication_required') throw new HttpError(409, 'This effect requires explicit DM adjudication before it can be applied.')
      if (database.prepare('SELECT 1 FROM encounter_spell_effect_applications WHERE rollId=?').get(rollId)) throw new HttpError(409, 'This spell effect roll has already been applied.')
      const target = requireCombatant(encounterId, row.targetId)
      if (row.effectType === 'healing' && target.type === 'player' && target.survivalStatus === 'dead') throw new HttpError(409, 'This effect could resurrect a dead character. Automatic resurrection is unsupported; explicit DM adjudication is required outside this application.')
      const amount = Number(row.appliedAmount)
      const hpBefore = target.currentHp
      let message = ''
      if (row.effectType === 'damage') message = survivalStore.applyDamageInTransaction(campaignId, encounterId, target.id, amount, Boolean(row.critical), `spell-effect:${rollId}`).message
      else survivalStore.adjustHp(campaignId, encounterId, target.id, amount, 'heal')
      const after = requireCombatant(encounterId, target.id)
      if (row.effectType === 'healing') message = target.type === 'player' && hpBefore === 0 && after.currentHp > 0 ? 'Recovered from 0 HP; unconsciousness and death save counters were cleared.' : `Healing applied, up to maximum HP ${after.maxHp}.`
      const createdAt = new Date().toISOString()
      const id = crypto.randomUUID()
      database.prepare(`INSERT INTO encounter_spell_effect_applications(id,requestId,requestHash,rollId,campaignId,encounterId,targetId,targetName,effectType,amount,hpBefore,hpAfter,message,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, requestId, digest, rollId, campaignId, encounterId, target.id, target.name, row.effectType, amount, hpBefore, after.currentHp, message, createdAt)
      const application = database.prepare('SELECT * FROM encounter_spell_effect_applications WHERE id=?').get(id) as unknown as Record<string, unknown>
      return { application: parseApplication(application), replayed: false }
    })
  }
}

export = spellEffectStore
