import express = require('express')
import combatStore = require('./combatStore')
import attackStore = require('./attackStore')

const router = express.Router()
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

router.post('/:campaignId/encounters/:encounterId/attacks', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const fields: Record<string, string> = {}
  for (const key of ['diceResults', 'diceCount', 'attackBonus', 'targetAC'] as const) {
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
  if (Object.keys(fields).length) { response.status(400).json({ error: 'Validation failed', fields }); return }
  try {
    const attack = attackStore.create(request.params.campaignId, request.params.encounterId, {
      attackerId: body.attackerId as string, targetId: body.targetId as string,
      ...(typeof body.weaponId === 'string' ? { weaponId: body.weaponId } : {}),
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
  if (armorClass.error) errors.armorClassOverride = armorClass.error
  if (attackModifier.error) errors.attackModifier = attackModifier.error
  if (Object.keys(errors).length) { response.status(400).json({ error: 'Validation failed', fields: errors }); return }
  try {
    response.status(201).json(combatStore.addEnemy(request.params.campaignId, request.params.encounterId, name!, rawModifier as number, hp.currentHp!, hp.maxHp!, armorClass.value, attackModifier.value))
  } catch (cause) { next(cause) }
})

router.put('/:campaignId/encounters/:encounterId/combatants/:combatantId/combat-stats', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } }); return }
  const armorClass = optionalWholeNumber(body, 'armorClassOverride', 1, 50, 'Enemy AC')
  const attackModifier = optionalWholeNumber(body, 'attackModifier', -20, 50, 'Enemy attack bonus')
  const errors: Record<string, string> = {}
  if (armorClass.error) errors.armorClassOverride = armorClass.error
  if (attackModifier.error) errors.attackModifier = attackModifier.error
  if (Object.keys(errors).length) { response.status(400).json({ error: 'Validation failed', fields: errors }); return }
  try { response.json(combatStore.setEnemyCombatStats(request.params.campaignId, request.params.encounterId, request.params.combatantId, armorClass.value, attackModifier.value)) }
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
  try { response.json(combatStore.addCondition(request.params.campaignId, request.params.encounterId, request.params.combatantId, condition as combatStore.ConditionKey, body.level as number | undefined)) }
  catch (error) { next(error) }
})

router.delete('/:campaignId/encounters/:encounterId/combatants/:combatantId/conditions/:condition', (request, response, next) => {
  const condition = request.params.condition
  if (!Object.hasOwn(conditionLabels, condition)) { response.status(400).json({ error: 'Unsupported condition.' }); return }
  try { response.json(combatStore.removeCondition(request.params.campaignId, request.params.encounterId, request.params.combatantId, condition as combatStore.ConditionKey)) }
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
  try { response.json(combatStore.nextTurn(request.params.campaignId, request.params.encounterId)) } catch (error) { next(error) }
})

router.post('/:campaignId/encounters/:encounterId/reset', (request, response, next) => {
  try { response.json(combatStore.reset(request.params.campaignId, request.params.encounterId)) } catch (error) { next(error) }
})

export = router
