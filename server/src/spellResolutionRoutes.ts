import express = require('express')
import spellResolutionStore = require('./spellResolutionStore')

const router = express.Router()
function objectBody(body: unknown): Record<string, unknown> | null { return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null }
function validation(response: express.Response, fields: Record<string, string>) { response.status(400).json({ error: 'Validation failed', fields }) }
const base = '/:campaignId/encounters/:encounterId/spell-resolutions'

router.get(base, (request, response, next) => {
  try { response.json({ resolutions: spellResolutionStore.list(request.params.campaignId, request.params.encounterId) }) }
  catch (error) { next(error) }
})

router.post(base, (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { validation(response, { body: 'Expected a JSON object.' }); return }
  const fields: Record<string, string> = {}
  const allowed = new Set(['requestId', 'casterId', 'spellId', 'targetIds', 'mode', 'context', 'npcSaveModifiers', 'dmOverride', 'overrideReason', 'castingEventId'])
  for (const key of Object.keys(body)) if (!allowed.has(key)) fields[key] = 'Dice results, bonuses, AC, DC, and outcome are server-authoritative and cannot be submitted.'
  for (const key of ['requestId', 'casterId', 'spellId'] as const) if (typeof body[key] !== 'string' || !(body[key] as string).trim()) fields[key] = 'This field is required.'
  if (typeof body.requestId === 'string' && !/^[0-9a-f-]{36}$/i.test(body.requestId)) fields.requestId = 'Provide a valid UUID idempotency key.'
  if (body.castingEventId !== undefined && (typeof body.castingEventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.castingEventId))) fields.castingEventId = 'Provide a valid casting event ID or omit the field for legacy resolution.'
  if (!Array.isArray(body.targetIds) || body.targetIds.length < 1 || body.targetIds.length > 20 || body.targetIds.some((id) => typeof id !== 'string' || !id.trim())) fields.targetIds = 'Choose between 1 and 20 valid encounter targets.'
  else if (new Set(body.targetIds as string[]).size !== body.targetIds.length) fields.targetIds = 'A target cannot appear more than once.'
  const mode = body.mode === undefined ? 'normal' : body.mode
  if (!['normal', 'advantage', 'disadvantage'].includes(mode as string)) fields.mode = 'Choose normal, advantage, or disadvantage.'
  const context = body.context === undefined ? {} : objectBody(body.context)
  if (!context) fields.context = 'Condition context must be an object.'
  else {
    const allowedContext = new Set(['distanceFeet', 'attackerCanSeeTarget', 'targetCanSeeAttacker', 'fearSourceVisible'])
    for (const key of Object.keys(context)) if (!allowedContext.has(key)) fields.context = 'Condition context contains an unsupported field.'
    if (context.distanceFeet !== undefined && (!Number.isSafeInteger(context.distanceFeet) || (context.distanceFeet as number) < 0 || (context.distanceFeet as number) > 10000)) fields.distanceFeet = 'Distance must be a whole number from 0 to 10000 feet.'
    for (const key of ['attackerCanSeeTarget', 'targetCanSeeAttacker', 'fearSourceVisible']) if (context[key] !== undefined && typeof context[key] !== 'boolean') fields[key] = 'Visibility context must be true or false.'
  }
  const npcSaveModifiers = body.npcSaveModifiers === undefined ? {} : objectBody(body.npcSaveModifiers)
  if (!npcSaveModifiers) fields.npcSaveModifiers = 'Explicit NPC saving throw modifiers must be an object keyed by target ID.'
  else for (const [targetId, modifier] of Object.entries(npcSaveModifiers)) if (!targetId || !Number.isSafeInteger(modifier) || (modifier as number) < -30 || (modifier as number) > 30) fields.npcSaveModifiers = 'NPC saving throw modifiers must be whole numbers from -30 to 30.'
  if (body.dmOverride !== undefined && typeof body.dmOverride !== 'boolean') fields.dmOverride = 'DM override must be true or false.'
  if (body.overrideReason !== undefined && (typeof body.overrideReason !== 'string' || body.overrideReason.length > 500)) fields.overrideReason = 'Override reason must be text up to 500 characters.'
  if (Object.keys(npcSaveModifiers ?? {}).length && (body.dmOverride !== true || typeof body.overrideReason !== 'string' || !body.overrideReason.trim())) fields.overrideReason = 'Explicit NPC saving throw modifiers require a DM override and reason.'
  if (body.dmOverride === true && (typeof body.overrideReason !== 'string' || !body.overrideReason.trim())) fields.overrideReason = 'An explicit DM override requires a reason.'
  if (Object.keys(fields).length) { validation(response, fields); return }
  try {
    const result = spellResolutionStore.create(request.params.campaignId, request.params.encounterId, {
      casterId: body.casterId as string, spellId: body.spellId as string, targetIds: body.targetIds as string[], requestId: body.requestId as string,
      ...(typeof body.castingEventId === 'string' ? { castingEventId: body.castingEventId } : {}),
      mode: mode as 'normal' | 'advantage' | 'disadvantage', context: context as { distanceFeet?: number; attackerCanSeeTarget?: boolean; targetCanSeeAttacker?: boolean; fearSourceVisible?: boolean },
      npcSaveModifiers: npcSaveModifiers as Record<string, number>, dmOverride: body.dmOverride === true, overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason.trim() : '',
    })
    response.status(result.replayed ? 200 : 201).json(result)
  } catch (error) { next(error) }
})

export = router
