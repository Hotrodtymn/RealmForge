import express = require('express')
import spellEffectStore = require('./spellEffectStore')

const router = express.Router()
const base = '/:campaignId/encounters/:encounterId/spell-effects'
function objectBody(body: unknown): Record<string, unknown> | null { return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null }
function validation(response: express.Response, fields: Record<string, string>) { response.status(400).json({ error: 'Validation failed', fields }) }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) }

router.get(base, (request, response, next) => {
  try { response.json(spellEffectStore.list(request.params.campaignId, request.params.encounterId)) }
  catch (error) { next(error) }
})

router.post(`${base}/roll`, (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) { validation(response, { body: 'Expected a JSON object.' }); return }
  const fields: Record<string, string> = {}
  const allowed = new Set(['requestId', 'casterId', 'spellId', 'targetIds', 'castLevel', 'resolutionId', 'castingEventId', 'dmOverride', 'overrideReason', 'adjudicatedSaveOutcomes'])
  for (const key of Object.keys(body)) if (!allowed.has(key)) fields[key] = 'Dice results, formulas, modifiers, HP, and outcomes are derived by the server.'
  if (!validId(body.requestId)) fields.requestId = 'Provide a valid UUID idempotency key.'
  if (typeof body.casterId !== 'string' || !body.casterId.trim()) fields.casterId = 'Choose a spellcaster.'
  if (typeof body.spellId !== 'string' || !body.spellId.trim()) fields.spellId = 'Choose a spellbook spell.'
  if (!Array.isArray(body.targetIds) || body.targetIds.length < 1 || body.targetIds.length > 20 || body.targetIds.some((id) => typeof id !== 'string' || !id.trim())) fields.targetIds = 'Choose between 1 and 20 encounter targets.'
  else if (new Set(body.targetIds as string[]).size !== body.targetIds.length) fields.targetIds = 'A target cannot appear more than once.'
  if (!Number.isSafeInteger(body.castLevel) || (body.castLevel as number) < 0 || (body.castLevel as number) > 9) fields.castLevel = 'Cast level must be a whole number from 0 to 9.'
  if (body.resolutionId !== undefined && body.resolutionId !== null && (typeof body.resolutionId !== 'string' || !body.resolutionId.trim())) fields.resolutionId = 'Choose a saved spell resolution or leave it blank.'
  if (body.castingEventId !== undefined && (typeof body.castingEventId !== 'string' || !validId(body.castingEventId))) fields.castingEventId = 'Provide a valid casting event ID or omit it for legacy effect rolls.'
  if (body.dmOverride !== undefined && typeof body.dmOverride !== 'boolean') fields.dmOverride = 'DM override must be true or false.'
  if (body.overrideReason !== undefined && (typeof body.overrideReason !== 'string' || body.overrideReason.length > 500)) fields.overrideReason = 'Override reason must be text up to 500 characters.'
  if (body.dmOverride === true && (typeof body.overrideReason !== 'string' || !body.overrideReason.trim())) fields.overrideReason = 'An explicit DM override requires a reason.'
  const saveOutcomes = body.adjudicatedSaveOutcomes === undefined ? {} : objectBody(body.adjudicatedSaveOutcomes)
  if (!saveOutcomes) fields.adjudicatedSaveOutcomes = 'Adjudicated outcomes must be an object keyed by target ID.'
  else for (const [targetId, outcome] of Object.entries(saveOutcomes)) if (!targetId || !['success', 'failure'].includes(outcome as string)) fields.adjudicatedSaveOutcomes = 'Choose success or failure for each manually adjudicated save.'
  if (Object.keys(saveOutcomes ?? {}).length && (body.dmOverride !== true || typeof body.overrideReason !== 'string' || !body.overrideReason.trim())) fields.overrideReason = 'Manual save outcomes require an explicit DM override reason.'
  if (Object.keys(fields).length) { validation(response, fields); return }
  try {
    const result = spellEffectStore.roll(request.params.campaignId, request.params.encounterId, {
      requestId: body.requestId as string, casterId: body.casterId as string, spellId: body.spellId as string, targetIds: body.targetIds as string[],
      castLevel: body.castLevel as number, resolutionId: typeof body.resolutionId === 'string' ? body.resolutionId : null,
      ...(typeof body.castingEventId === 'string' ? { castingEventId: body.castingEventId } : {}),
      dmOverride: body.dmOverride === true, overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason.trim() : '',
      adjudicatedSaveOutcomes: saveOutcomes as Record<string, 'success' | 'failure'>,
    })
    response.status(result.replayed ? 200 : 201).json(result)
  } catch (error) { next(error) }
})

router.post(`${base}/:rollId/apply`, (request, response, next) => {
  const body = objectBody(request.body)
  if (!body || Object.keys(body).some((key) => key !== 'requestId') || !validId(body.requestId)) { validation(response, { requestId: 'Provide a UUID idempotency key; effect amount and HP come from the saved roll.' }); return }
  try {
    const result = spellEffectStore.apply(request.params.campaignId, request.params.encounterId, request.params.rollId, body.requestId as string)
    response.status(result.replayed ? 200 : 201).json(result)
  } catch (error) { next(error) }
})

export = router
