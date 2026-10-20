import express = require('express')
import combatStore = require('./combatStore')
import attackStore = require('./attackStore')
import damageRules = require('./damageRules')
import damageStore = require('./damageStore')
import survivalStore = require('./survivalStore')
import actionEconomyStore = require('./actionEconomyStore')
import conditionStore = require('./conditionStore')
import database = require('./database')

const router = express.Router()

router.get('/:campaignId/characters/:characterId/exhaustion', (request, response, next) => {
  try {
    const character = database.prepare('SELECT c.id FROM characters c JOIN campaign_memberships m ON m.id=c.membershipId WHERE c.id=? AND m.campaignId=?').get(request.params.characterId, request.params.campaignId)
    if (!character) { response.status(404).json({ error: 'Character not found in this campaign.' }); return }
    const effects = database.prepare(`SELECT e.id AS encounterId,e.name AS encounterName,coalesce(cc.level,0) AS level
      FROM encounter_combatants ec JOIN encounters e ON e.id=ec.encounterId
      LEFT JOIN combatant_conditions cc ON cc.combatantId=ec.id AND cc.condition='exhaustion'
      WHERE ec.characterId=? AND e.campaignId=? AND e.status='active' ORDER BY e.updatedAt DESC`).all(request.params.characterId, request.params.campaignId)
    response.json({ effects })
  } catch (error) { next(error) }
})
const encounterNameLimit = 120
const combatantNameLimit = 120
const modifierLimit = 100
const initiativeLimit = 1000
const attackModifierLimit = 100
const conditionLabels: Record<combatStore.ConditionKey, string> = {
  blinded: 'Blinded', charmed: 'Charmed', deafened: 'Deafened', frightened: 'Frightened',
  grappled: 'Grappled', incapacitated: 'Incapacitated', invisible: 'Invisible', paralyzed: 'Paralyzed',
  petrified: 'Petrified', poisoned: 'Poisoned', prone: 'Prone', restrained: 'Restrained',
  stunned: 'Stunned', unconscious: 'Unconscious', exhaustion: 'Exhaustion',
}

function objectBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
}

function validateName(body: Record<string, unknown>, field: string, limit: number): { name?: string; error?: string } {
  if (typeof body[field] !== 'string') return { error: `${field === 'name' ? 'Name' : field} is required.` }
  const name = (body[field] as string).trim()
  if (!name) return { error: `${field === 'name' ? 'Name' : field} is required.` }
  if (name.length > limit) return { error: `${field === 'name' ? 'Name' : field} must be ${limit} characters or fewer.` }
  return { name }
}

function validateHitPoints(body: Record<string, unknown>): { currentHp?: number; maxHp?: number; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const maxHp = body.maxHp === undefined ? 1 : body.maxHp
  const currentHp = body.currentHp === undefined ? maxHp : body.currentHp
  if (!Number.isSafeInteger(maxHp) || (maxHp as number) <= 0) errors.maxHp = 'Maximum hit points must be a positive whole number.'
  if (!Number.isSafeInteger(currentHp) || (currentHp as number) < 0) errors.currentHp = 'Current hit points must be a nonnegative whole number.'
  if (!errors.maxHp && !errors.currentHp && (currentHp as number) > (maxHp as number)) errors.currentHp = 'Current hit points cannot exceed maximum hit points.'
  return Object.keys(errors).length ? { errors } : { currentHp: currentHp as number, maxHp: maxHp as number, errors }
}

function optionalWholeNumber(body: Record<string, unknown>, field: string, min: number, max: number, label: string): { value: number | null; error?: string } {
  const raw = body[field]
  if (raw === undefined || raw === null || raw === '') return { value: null }
  if (!Number.isSafeInteger(raw) || (raw as number) < min || (raw as number) > max) {
    return { value: null, error: `${label} must be a whole number from ${min} to ${max}, or left blank.` }
  }
  return { value: raw as number }
}

function optionalEnemyDamage(body: Record<string, unknown>): { formula: string | null; type: damageRules.DamageType | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const rawFormula = body.damageFormula
  const formula = rawFormula === undefined || rawFormula === null || rawFormula === ''
    ? null : typeof rawFormula === 'string' ? rawFormula.trim() : null
  if (rawFormula !== undefined && rawFormula !== null && rawFormula !== '' && typeof rawFormula !== 'string') errors.damageFormula = 'Damage formula must be text.'
  if (formula) {
    try { damageRules.parseEnemyFormula(formula) } catch (error) { errors.damageFormula = error instanceof Error ? error.message : 'Damage formula is invalid.' }
  }
  const rawType = body.damageType
  let type: damageRules.DamageType | null = null
  if (formula) {
    if (rawType === undefined) type = 'bludgeoning'
    else if (typeof rawType === 'string' && damageRules.damageTypes.includes(rawType as damageRules.DamageType)) type = rawType as damageRules.DamageType
    else errors.damageType = 'Choose a supported damage type.'
  } else if (rawType !== undefined && rawType !== null && rawType !== '') {
    errors.damageType = 'Choose a damage formula before selecting a damage type.'
  }
  return { formula, type, errors }
}

router.get('/:campaignId/encounters', (request, response, next) => {
  try { response.json({ encounters: combatStore.listEncounters(request.params.campaignId) }) } catch (error) { next(error) }
})

router.post('/:campaignId/encounters', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const { name, error } = validateName(body, 'name', encounterNameLimit)
  if (!name) { response.status(400).json({ error: 'Validation failed', fields: { name: error } }); return }
  try { response.status(201).json(combatStore.createEncounter(request.params.campaignId, name)) } catch (cause) { next(cause) }
})

router.get('/:campaignId/encounters/:encounterId', (request, response, next) => {
  try { response.json(combatStore.getEncounter(request.params.campaignId, request.params.encounterId)) } catch (error) { next(error) }
})

router.get('/:campaignId/encounters/:encounterId/attacks', (request, response, next) => {
  try { response.json({ attacks: attackStore.list(request.params.campaignId, request.params.encounterId) }) } catch (error) { next(error) }
})

router.get('/:campaignId/encounters/:encounterId/damage', (request, response, next) => {
  try { response.json({ damageRolls: damageStore.list(request.params.campaignId, request.params.encounterId) }) } catch (error) { next(error) }
})

router.get('/:campaignId/encounters/:encounterId/action-economy', (request, response, next) => {
  try { response.json(actionEconomyStore.get(request.params.campaignId, request.params.encounterId)) } catch (error) { next(error) }
})

router.get('/:campaignId/encounters/:encounterId/condition-history', (request, response, next) => {
  const combatantId = typeof request.query.combatantId === 'string' ? request.query.combatantId : undefined
  try { response.json({ events: conditionStore.history(request.params.campaignId, request.params.encounterId, combatantId) }) } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/action-economy', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const allowed = new Set(['actionId','combatantId','kind','resource','available','distance','movementAllowance','targetId','helpUse','description','trigger','response','effectId','dmOverride','overrideReason'])
  const fields: Record<string,string> = {}
  for (const key of Object.keys(body)) if (!allowed.has(key)) fields[key] = 'This field is not supported.'
  if (typeof body.actionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.actionId)) fields.actionId = 'A unique action request ID is required.'
  if (typeof body.combatantId !== 'string' || !body.combatantId.trim()) fields.combatantId = 'Choose a combatant.'
  const kinds: actionEconomyStore.ActionKind[] = ['resource_override','movement','movement_allowance','reset','dash','disengage','dodge','help','ready','ready_resolve','ready_cancel']
  if (typeof body.kind !== 'string' || !kinds.includes(body.kind as actionEconomyStore.ActionKind)) fields.kind = 'Choose a supported action economy operation.'
  if (body.dmOverride !== undefined && typeof body.dmOverride !== 'boolean') fields.dmOverride = 'Choose whether this action is an explicit DM override.'
  if (body.overrideReason !== undefined && (typeof body.overrideReason !== 'string' || body.overrideReason.trim().length > 300)) fields.overrideReason = 'Override reason must be text up to 300 characters.'
  if (body.dmOverride === true && (typeof body.overrideReason !== 'string' || !body.overrideReason.trim())) fields.overrideReason = 'An explicit DM override requires a reason.'
  if (Object.keys(fields).length) { response.status(400).json({ error: 'Validation failed', fields }); return }
  try {
    response.json(actionEconomyStore.apply(request.params.campaignId, request.params.encounterId, body as unknown as actionEconomyStore.Input))
  } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/attacks/:attackId/damage', (request, response, next) => {
  const body = request.body === undefined ? {} : objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) {
    if (key !== 'situationalModifier') fields[key] = 'Damage dice, formula, type, target HP, and critical status come from the saved attack and server rules.'
  }
  const situationalModifier = body.situationalModifier === undefined ? 0 : body.situationalModifier
  if (!Number.isSafeInteger(situationalModifier) || (situationalModifier as number) < -attackModifierLimit || (situationalModifier as number) > attackModifierLimit) {
    fields.situationalModifier = `Situational damage modifier must be a whole number from -${attackModifierLimit} to ${attackModifierLimit}.`
  }
  if (Object.keys(fields).length) { response.status(400).json({ error: 'Validation failed', fields }); return }
  try {
    const damage = damageStore.roll(request.params.campaignId, request.params.encounterId, request.params.attackId, situationalModifier as number)
    response.status(201).json({ damage, damageRolls: damageStore.list(request.params.campaignId, request.params.encounterId) })
  } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/damage/:damageId/apply', (request, response, next) => {
  if (request.body && (!objectBody(request.body) || Object.keys(objectBody(request.body)!).length)) {
    response.status(400).json({ error: 'Validation failed', fields: { body: 'Damage application uses the saved damage roll and does not accept client HP values.' } }); return
  }
  try { response.json(damageStore.apply(request.params.campaignId, request.params.encounterId, request.params.damageId)) }
  catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/attacks', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const fields: Record<string, string> = {}
  const attackInputFields = new Set(['attackerId', 'targetId', 'weaponId', 'weaponUse', 'mode', 'situationalModifier', 'consumeAction', 'actionId', 'distanceFeet', 'attackerCanSeeTarget', 'targetCanSeeAttacker', 'fearSourceVisible', 'dmOverride', 'overrideReason'])
  for (const key of Object.keys(body)) {
    if (!attackInputFields.has(key)) fields[key] = 'Only combatant choices and roll controls may be submitted; combat values come from the server.'
  }
  for (const key of ['diceResults', 'diceCount', 'attackBonus', 'targetAC', 'damageDiceResults', 'damageTotal', 'isCritical', 'critical'] as const) {
    if (Object.hasOwn(body, key)) fields[key] = 'Dice, attack bonuses, and AC are determined by the server and cannot be submitted.'
  }
  for (const key of ['attackerId', 'targetId'] as const) {
    if (typeof body[key] !== 'string' || !(body[key] as string).trim()) fields[key] = 'Choose a combatant.'
  }
  if (body.attackerId === body.targetId && typeof body.attackerId === 'string') fields.targetId = 'Choose a different combatant as the target.'
  const mode = body.mode === undefined ? 'normal' : body.mode
  if (!['normal', 'advantage', 'disadvantage'].includes(mode as string)) fields.mode = 'Choose normal, advantage, or disadvantage.'
  const situationalModifier = body.situationalModifier === undefined ? 0 : body.situationalModifier
  if (!Number.isSafeInteger(situationalModifier) || (situationalModifier as number) < -attackModifierLimit || (situationalModifier as number) > attackModifierLimit) {
    fields.situationalModifier = `Situational modifier must be a whole number from -${attackModifierLimit} to ${attackModifierLimit}.`
  }
  if (body.weaponId !== undefined && body.weaponId !== null && (typeof body.weaponId !== 'string' || !body.weaponId.trim())) fields.weaponId = 'Choose a valid weapon.'
  if (body.weaponUse !== undefined && body.weaponUse !== null && !['one_handed', 'two_handed'].includes(body.weaponUse as string)) fields.weaponUse = 'Weapon use must be one_handed or two_handed.'
  if (body.consumeAction !== undefined && typeof body.consumeAction !== 'boolean') fields.consumeAction = 'Choose whether this attack spends the Action.'
  if (body.consumeAction === true && (typeof body.actionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.actionId))) fields.actionId = 'A unique action request ID is required to spend an Action.'
  if (body.dmOverride !== undefined && typeof body.dmOverride !== 'boolean') fields.dmOverride = 'Choose whether this attack is an explicit DM override.'
  if (body.overrideReason !== undefined && (typeof body.overrideReason !== 'string' || body.overrideReason.trim().length > 300)) fields.overrideReason = 'Override reason must be text up to 300 characters.'
  if (body.dmOverride === true && (typeof body.overrideReason !== 'string' || !body.overrideReason.trim())) fields.overrideReason = 'An explicit DM override requires a reason.'
  if (body.dmOverride === true && (typeof body.actionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.actionId))) fields.actionId = 'A unique action ID is required to record a DM override.'
  if (body.distanceFeet !== undefined && (!Number.isSafeInteger(body.distanceFeet) || (body.distanceFeet as number) < 0 || (body.distanceFeet as number) > 10000)) fields.distanceFeet = 'Distance must be a whole number from 0 to 10000 feet.'
  for (const key of ['attackerCanSeeTarget', 'targetCanSeeAttacker', 'fearSourceVisible'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') fields[key] = 'Choose yes or no, or leave this context unspecified for DM adjudication.'
  }
  if (Object.keys(fields).length) { response.status(400).json({ error: 'Validation failed', fields }); return }
  try {
    const attack = attackStore.create(request.params.campaignId, request.params.encounterId, {
      attackerId: body.attackerId as string, targetId: body.targetId as string,
      ...(typeof body.weaponId === 'string' ? { weaponId: body.weaponId } : {}),
      ...(body.weaponUse === 'one_handed' || body.weaponUse === 'two_handed' ? { weaponUse: body.weaponUse } : {}),
      ...(typeof body.actionId === 'string' ? { actionId: body.actionId } : {}),
      ...(body.consumeAction === true ? { consumeAction: true } : {}),
      context: {
        ...(typeof body.distanceFeet === 'number' ? { distanceFeet: body.distanceFeet } : {}),
        ...(typeof body.attackerCanSeeTarget === 'boolean' ? { attackerCanSeeTarget: body.attackerCanSeeTarget } : {}),
        ...(typeof body.targetCanSeeAttacker === 'boolean' ? { targetCanSeeAttacker: body.targetCanSeeAttacker } : {}),
        ...(typeof body.fearSourceVisible === 'boolean' ? { fearSourceVisible: body.fearSourceVisible } : {}),
      },
      ...(body.dmOverride === true ? { dmOverride: true, overrideReason: body.overrideReason as string } : {}),
      mode: mode as attackStore.AttackInput['mode'], situationalModifier: situationalModifier as number,
    })
    response.status(201).json({ attack, attacks: attackStore.list(request.params.campaignId, request.params.encounterId) })
  } catch (error) { next(error) }
})

router.put('/:campaignId/encounters/:encounterId', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const { name, error } = validateName(body, 'name', encounterNameLimit)
  if (!name) { response.status(400).json({ error: 'Validation failed', fields: { name: error } }); return }
  try { response.json(combatStore.renameEncounter(request.params.campaignId, request.params.encounterId, name)) } catch (cause) { next(cause) }
})

router.delete('/:campaignId/encounters/:encounterId', (request, response, next) => {
  try { combatStore.deleteEncounter(request.params.campaignId, request.params.encounterId); response.json({ deleted: true }) } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/combatants/players', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body || typeof body.characterId !== 'string' || !body.characterId.trim()) {
    response.status(400).json({ error: 'Validation failed', fields: { characterId: 'Select a campaign character.' } })
    return
  }
  const hp = validateHitPoints(body)
  if (Object.keys(hp.errors).length) { response.status(400).json({ error: 'Validation failed', fields: hp.errors }); return }
  try {
    response.status(201).json(combatStore.addPlayer(request.params.campaignId, request.params.encounterId, body.characterId, hp.currentHp!, hp.maxHp!))
  } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/combatants/enemies', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const { name, error } = validateName(body, 'name', combatantNameLimit)
  const rawModifier = body.initiativeModifier === undefined ? 0 : body.initiativeModifier
  const errors: Record<string, string> = {}
  if (!name) errors.name = error!
  if (!Number.isSafeInteger(rawModifier) || (rawModifier as number) < -modifierLimit || (rawModifier as number) > modifierLimit) {
    errors.initiativeModifier = `Initiative modifier must be a whole number from -${modifierLimit} to ${modifierLimit}.`
  }
  const hp = validateHitPoints(body)
  Object.assign(errors, hp.errors)
  const armorClass = optionalWholeNumber(body, 'armorClassOverride', 1, 50, 'Enemy AC')
  const attackModifier = optionalWholeNumber(body, 'attackModifier', -20, 50, 'Enemy attack bonus')
  const enemyDamage = optionalEnemyDamage(body)
  if (armorClass.error) errors.armorClassOverride = armorClass.error
  if (attackModifier.error) errors.attackModifier = attackModifier.error
  Object.assign(errors, enemyDamage.errors)
  if (Object.keys(errors).length) { response.status(400).json({ error: 'Validation failed', fields: errors }); return }
  try {
    response.status(201).json(combatStore.addEnemy(request.params.campaignId, request.params.encounterId, name!, rawModifier as number, hp.currentHp!, hp.maxHp!, armorClass.value, attackModifier.value, enemyDamage.formula, enemyDamage.type))
  } catch (cause) { next(cause) }
})

router.put('/:campaignId/encounters/:encounterId/combatants/:combatantId/combat-stats', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const armorClass = optionalWholeNumber(body, 'armorClassOverride', 1, 50, 'Enemy AC')
  const attackModifier = optionalWholeNumber(body, 'attackModifier', -20, 50, 'Enemy attack bonus')
  const enemyDamage = optionalEnemyDamage(body)
  const errors: Record<string, string> = {}
  if (armorClass.error) errors.armorClassOverride = armorClass.error
  if (attackModifier.error) errors.attackModifier = attackModifier.error
  Object.assign(errors, enemyDamage.errors)
  if (Object.keys(errors).length) { response.status(400).json({ error: 'Validation failed', fields: errors }); return }
  try { response.json(combatStore.setEnemyCombatStats(request.params.campaignId, request.params.encounterId, request.params.combatantId, armorClass.value, attackModifier.value, enemyDamage.formula, enemyDamage.type)) }
  catch (error) { next(error) }
})

router.put('/:campaignId/encounters/:encounterId/combatants/:combatantId/hit-points', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const hp = validateHitPoints(body)
  if (Object.keys(hp.errors).length) { response.status(400).json({ error: 'Validation failed', fields: hp.errors }); return }
  try { response.json(combatStore.setHitPoints(request.params.campaignId, request.params.encounterId, request.params.combatantId, hp.currentHp!, hp.maxHp!)) }
  catch (error) { next(error) }
})

for (const action of ['damage', 'heal'] as const) {
  router.post(`/:campaignId/encounters/:encounterId/combatants/:combatantId/${action}`, (request, response, next) => {
    const body = objectBody(request.body)
    if (!body || !Number.isSafeInteger(body.amount) || (body.amount as number) <= 0) {
      response.status(400).json({ error: 'Validation failed', fields: { amount: `Amount must be a positive whole number to ${action === 'damage' ? 'deal damage' : 'heal'}.` } })
      return
    }
    try { response.json(combatStore.adjustHitPoints(request.params.campaignId, request.params.encounterId, request.params.combatantId, body.amount as number, action)) }
    catch (error) { next(error) }
  })
}

router.post('/:campaignId/encounters/:encounterId/combatants/:combatantId/conditions', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const condition = body.condition
  if (typeof condition !== 'string' || !Object.hasOwn(conditionLabels, condition)) {
    response.status(400).json({ error: 'Validation failed', fields: { condition: `Choose a supported condition: ${Object.values(conditionLabels).join(', ')}.` } })
    return
  }
  if (condition === 'exhaustion') {
    if (!Number.isInteger(body.level) || (body.level as number) < 1 || (body.level as number) > 6) {
      response.status(400).json({ error: 'Validation failed', fields: { level: 'Exhaustion level must be a whole number from 1 to 6.' } }); return
    }
  } else if (body.level !== undefined) {
    response.status(400).json({ error: 'Validation failed', fields: { level: 'Only Exhaustion has a level.' } }); return
  }
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) if (!['condition', 'level', 'sourceCombatantId', 'notes', 'duration'].includes(key)) fields[key] = 'This field is not supported.'
  if (body.sourceCombatantId !== undefined && body.sourceCombatantId !== null && (typeof body.sourceCombatantId !== 'string' || !body.sourceCombatantId.trim())) fields.sourceCombatantId = 'Choose a valid source combatant or leave it blank for adjudication.'
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 500)) fields.notes = 'Condition notes must be text up to 500 characters.'
  if (body.duration !== undefined && (!body.duration || typeof body.duration !== 'object' || Array.isArray(body.duration))) fields.duration = 'Duration configuration must be an object.'
  if (Object.keys(fields).length) { response.status(400).json({ error: 'Validation failed', fields }); return }
  try {
    if (body.duration) conditionStore.validateDurationRequest(request.params.campaignId, request.params.encounterId, request.params.combatantId, condition, body.duration as conditionStore.DurationConfig)
    const result = combatStore.addCondition(request.params.campaignId, request.params.encounterId, request.params.combatantId, condition as combatStore.ConditionKey, body.level as number | undefined, typeof body.sourceCombatantId === 'string' ? body.sourceCombatantId.trim() : null, typeof body.notes === 'string' ? body.notes.trim() : '')
    if (body.duration) conditionStore.configure(request.params.campaignId, request.params.encounterId, request.params.combatantId, condition, body.duration as conditionStore.DurationConfig)
    response.json(body.duration ? combatStore.getEncounter(request.params.campaignId, request.params.encounterId) : result)
  }
  catch (error) { next(error) }
})

router.put('/:campaignId/encounters/:encounterId/combatants/:combatantId/conditions/:condition/duration', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body || !body.duration || typeof body.duration !== 'object' || Array.isArray(body.duration)) { response.status(400).json({ error: 'Validation failed', fields: { duration: 'A duration configuration object is required.' } }); return }
  if (Object.keys(body).some((key) => !['duration','reason','actionId'].includes(key))) { response.status(400).json({ error: 'Validation failed', fields: { body: 'This request contains unsupported fields.' } }); return }
  if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 300)) { response.status(400).json({ error: 'Validation failed', fields: { reason: 'Reason must be text up to 300 characters.' } }); return }
  if (body.actionId !== undefined && (typeof body.actionId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.actionId))) { response.status(400).json({ error: 'Validation failed', fields: { actionId: 'Action ID must contain 8 to 80 letters, numbers, or hyphens.' } }); return }
  try {
    conditionStore.configure(request.params.campaignId, request.params.encounterId, request.params.combatantId, request.params.condition, body.duration as conditionStore.DurationConfig, typeof body.reason === 'string' ? body.reason : '', typeof body.actionId === 'string' ? body.actionId : undefined)
    response.json(combatStore.getEncounter(request.params.campaignId, request.params.encounterId))
  }
  catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/combatants/:combatantId/conditions/:condition/recovery', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body || typeof body.success !== 'boolean' || typeof body.reason !== 'string') { response.status(400).json({ error: 'Validation failed', fields: { success: 'Choose success or failure.', reason: 'A DM adjudication reason is required.' } }); return }
  if (Object.keys(body).some((key) => !['success','reason','actionId'].includes(key)) || (body.actionId !== undefined && (typeof body.actionId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.actionId)))) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Unsupported recovery resolution fields or invalid action ID.' } }); return }
  try {
    conditionStore.resolveRecovery(request.params.campaignId, request.params.encounterId, request.params.combatantId, request.params.condition, body.success, body.reason, typeof body.actionId === 'string' ? body.actionId : undefined)
    response.json(combatStore.getEncounter(request.params.campaignId, request.params.encounterId))
  } catch (error) { next(error) }
})

router.put('/:campaignId/encounters/:encounterId/combatants/:combatantId/exhaustion', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body || Object.keys(body).some((key) => !['level','reason'].includes(key)) || !Number.isSafeInteger(body.level) || typeof body.reason !== 'string') { response.status(400).json({ error: 'Validation failed', fields: { level: 'Choose Exhaustion level 0–6.', reason: 'A recovery or override reason is required.' } }); return }
  try {
    conditionStore.adjustExhaustion(request.params.campaignId, request.params.encounterId, request.params.combatantId, body.level as number, body.reason)
    response.json(combatStore.getEncounter(request.params.campaignId, request.params.encounterId))
  } catch (error) { next(error) }
})

router.get('/:campaignId/encounters/:encounterId/combatants/:combatantId/survival', (request, response, next) => {
  try { response.json({ events: survivalStore.list(request.params.campaignId, request.params.encounterId, request.params.combatantId) }) }
  catch (error) { next(error) }
})

for (const action of ['death-save', 'stabilize'] as const) {
  router.post(`/:campaignId/encounters/:encounterId/combatants/:combatantId/${action}`, (request, response, next) => {
    const body = objectBody(request.body)
    const actionId = body?.actionId
    if (!body || Object.keys(body).some((key) => key !== 'actionId') || typeof actionId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(actionId)) {
      response.status(400).json({ error: 'Validation failed', fields: { actionId: 'A unique action ID is required.' } }); return
    }
    try {
      const result = action === 'death-save'
        ? survivalStore.deathSave(request.params.campaignId, request.params.encounterId, request.params.combatantId, actionId)
        : survivalStore.stabilize(request.params.campaignId, request.params.encounterId, request.params.combatantId, actionId)
      response.status(201).json(result)
    } catch (error) { next(error) }
  })
}

router.delete('/:campaignId/encounters/:encounterId/combatants/:combatantId/conditions/:condition', (request, response, next) => {
  const condition = request.params.condition
  if (!Object.hasOwn(conditionLabels, condition)) { response.status(400).json({ error: 'Unsupported condition.' }); return }
  const body = objectBody(request.body)
  if (body && (Object.keys(body).some((key) => key !== 'reason') || (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 300)))) { response.status(400).json({ error: 'Validation failed', fields: { reason: 'Reason must be text up to 300 characters.' } }); return }
  try { response.json(combatStore.removeCondition(request.params.campaignId, request.params.encounterId, request.params.combatantId, condition as combatStore.ConditionKey, typeof body?.reason === 'string' ? body.reason : '')) }
  catch (error) { next(error) }
})

router.delete('/:campaignId/encounters/:encounterId/combatants/:combatantId', (request, response, next) => {
  try { response.json(combatStore.removeCombatant(request.params.campaignId, request.params.encounterId, request.params.combatantId)) } catch (error) { next(error) }
})

router.put('/:campaignId/encounters/:encounterId/combatants/:combatantId/initiative', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  try {
    if (body.source === 'rolled') {
      if (!Number.isInteger(body.roll) || (body.roll as number) < 1 || (body.roll as number) > 20) {
        response.status(400).json({ error: 'Validation failed', fields: { roll: 'A rolled initiative result must be a d20 result from 1 to 20.' } })
        return
      }
      response.json(combatStore.setRolledInitiative(request.params.campaignId, request.params.encounterId, request.params.combatantId, body.roll as number))
      return
    }
    if (body.source === 'manual') {
      if (!Number.isSafeInteger(body.total) || (body.total as number) < -initiativeLimit || (body.total as number) > initiativeLimit) {
        response.status(400).json({ error: 'Validation failed', fields: { total: `Manual initiative must be a whole number from -${initiativeLimit} to ${initiativeLimit}.` } })
        return
      }
      response.json(combatStore.setManualInitiative(request.params.campaignId, request.params.encounterId, request.params.combatantId, body.total as number))
      return
    }
    response.status(400).json({ error: 'Validation failed', fields: { source: 'Initiative source must be rolled or manual.' } })
  } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/start', (request, response, next) => {
  try { response.json(combatStore.start(request.params.campaignId, request.params.encounterId)) } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/next-turn', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body || typeof body.actionId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.actionId) || Object.keys(body).some((key) => key !== 'actionId')) { response.status(400).json({ error: 'Validation failed', fields: { actionId: 'A unique action ID containing 8 to 80 letters, numbers, or hyphens is required.' } }); return }
  try { response.json(combatStore.nextTurn(request.params.campaignId, request.params.encounterId, body.actionId)) } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/reset', (request, response, next) => {
  try { response.json(combatStore.reset(request.params.campaignId, request.params.encounterId)) } catch (error) { next(error) }
})

export = router
