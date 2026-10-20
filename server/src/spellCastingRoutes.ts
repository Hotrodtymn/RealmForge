import express = require('express')
import spellCastingStore = require('./spellCastingStore')

const router = express.Router()
const base = '/:campaignId/encounters/:encounterId/spell-castings'
function bodyObject(body: unknown): Record<string, unknown> | null { return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null }
function validation(response: express.Response, fields: Record<string, string>) { response.status(400).json({ error: 'Validation failed', fields }) }
router.get(base, (request, response, next) => { try { response.json({ events: spellCastingStore.list(request.params.campaignId, request.params.encounterId) }) } catch (error) { next(error) } })
router.post(base, (request, response, next) => {
  const body = bodyObject(request.body)
  if (!body) { validation(response, { body: 'Expected a JSON object.' }); return }
  const fields: Record<string, string> = {}
  const allowed = new Set(['requestId','casterId','spellId','castLevel','specialResource','dmOverride','overrideReason'])
  for (const key of Object.keys(body)) if (!allowed.has(key)) fields[key] = 'Casting outcome, resource counts, and spell rules are server-authoritative.'
  if (typeof body.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.requestId)) fields.requestId = 'Provide a valid UUID idempotency key.'
  for (const key of ['casterId','spellId']) if (typeof body[key] !== 'string' || !(body[key] as string).trim()) fields[key] = 'This field is required.'
  if (body.castLevel !== undefined && (!Number.isSafeInteger(body.castLevel) || (body.castLevel as number) < 0 || (body.castLevel as number) > 9)) fields.castLevel = 'Cast level must be a whole number from 0 to 9.'
  if (body.specialResource !== undefined && !['action','bonusAction','reaction','none'].includes(body.specialResource as string)) fields.specialResource = 'Choose Action, Bonus Action, Reaction, or no action resource for a Special casting time.'
  if (body.dmOverride !== undefined && typeof body.dmOverride !== 'boolean') fields.dmOverride = 'DM override must be true or false.'
  if (body.overrideReason !== undefined && (typeof body.overrideReason !== 'string' || body.overrideReason.length > 500)) fields.overrideReason = 'Override reason must be text up to 500 characters.'
  if (body.dmOverride === true && (typeof body.overrideReason !== 'string' || !body.overrideReason.trim())) fields.overrideReason = 'An explicit DM override requires a reason.'
  if (Object.keys(fields).length) { validation(response, fields); return }
  try {
    const result = spellCastingStore.create(request.params.campaignId, request.params.encounterId, { requestId: body.requestId as string, casterId: body.casterId as string, spellId: body.spellId as string, ...(body.castLevel === undefined ? {} : { castLevel: body.castLevel as number }), ...(body.specialResource === undefined ? {} : { specialResource: body.specialResource as 'action' | 'bonusAction' | 'reaction' | 'none' }), dmOverride: body.dmOverride === true, overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason.trim() : '' })
    response.status(result.replayed ? 200 : 201).json(result)
  } catch (error) { next(error) }
})
export = router
