import express = require('express')
import spellStore = require('./spellStore')
import spellRules = require('./spellRules')

const router = express.Router()
const abilities = ['int', 'wis', 'cha']
const base = '/:campaignId/players/:playerId/characters/:characterId'
function bodyObject(body: unknown): Record<string, unknown> | null { return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null }
function validation(response: express.Response, fields: Record<string, string>) { response.status(400).json({ error: 'Validation failed', fields }) }

router.get(`${base}/spellcasting`, (request, response, next) => {
  try { response.json(spellStore.getSpellcasting(request.params.campaignId, request.params.playerId, request.params.characterId)) } catch (error) { next(error) }
})

router.get(`${base}/spell-library`, (request, response, next) => {
  const rawLevel = request.query.level
  const level = rawLevel === undefined ? undefined : Number(rawLevel)
  if (level !== undefined && (!Number.isInteger(level) || level < 0 || level > 9)) { validation(response, { level: 'Level must be a whole number from 0 to 9.' }); return }
  try { response.json({ spells: spellStore.listLibrary(request.params.campaignId, request.params.playerId, request.params.characterId, String(request.query.search ?? ''), level, String(request.query.school ?? '')) }) } catch (error) { next(error) }
})

router.put(`${base}/spellcasting/config`, (request, response, next) => {
  const body = bodyObject(request.body)
  if (!body) { validation(response, { body: 'Expected a JSON object.' }); return }
  const fields: Record<string, string> = {}
  if (typeof body.enabled !== 'boolean') fields.enabled = 'Spellcasting enabled must be true or false.'
  if (body.ability !== null && body.ability !== undefined && !abilities.includes(body.ability as string)) fields.ability = 'Choose Intelligence, Wisdom, Charisma, or leave blank.'
  if (body.enabled === true && body.ability === undefined) fields.ability = 'Choose an ability or explicitly leave it blank to save an incomplete configuration.'
  if (typeof body.notes !== 'string' || body.notes.length > 1000) fields.notes = 'Notes must be text up to 1000 characters.'
  if (Object.keys(fields).length) { validation(response, fields); return }
  try { response.json({ config: spellStore.updateConfig(request.params.campaignId, request.params.playerId, request.params.characterId, { enabled: body.enabled as boolean, ability: (body.ability ?? null) as 'int' | 'wis' | 'cha' | null, notes: (body.notes as string).trim() }) }) } catch (error) { next(error) }
})

router.post(`${base}/spellbook`, (request, response, next) => {
  const body = bodyObject(request.body)
  if (!body || typeof body.spellId !== 'string' || !body.spellId.trim()) { validation(response, { spellId: 'Provide a spell ID from this character’s available spell library.' }); return }
  try { response.status(201).json({ spell: spellStore.addSpell(request.params.campaignId, request.params.playerId, request.params.characterId, body.spellId) }) } catch (error) { next(error) }
})

router.post(`${base}/spellbook/custom`, (request, response, next) => {
  const result = spellRules.validateCustomSpell(request.body)
  if (Object.keys(result.errors).length) { validation(response, result.errors); return }
  try { response.status(201).json({ spell: spellStore.createCustomSpell(request.params.campaignId, request.params.playerId, request.params.characterId, result.spell) }) } catch (error) { next(error) }
})

router.patch(`${base}/spellbook/:spellId`, (request, response, next) => {
  const body = bodyObject(request.body)
  if (!body || typeof body.prepared !== 'boolean') { validation(response, { prepared: 'Prepared state must be true or false.' }); return }
  try { response.json({ spell: spellStore.setPreparation(request.params.campaignId, request.params.playerId, request.params.characterId, request.params.spellId, body.prepared) }) } catch (error) { next(error) }
})

router.delete(`${base}/spellbook/:spellId`, (request, response, next) => {
  try { spellStore.removeSpell(request.params.campaignId, request.params.playerId, request.params.characterId, request.params.spellId); response.status(204).end() } catch (error) { next(error) }
})

router.put(`${base}/spell-slots/:level`, (request, response, next) => {
  const level = Number(request.params.level)
  const body = bodyObject(request.body)
  const fields: Record<string, string> = {}
  if (!Number.isInteger(level) || level < 1 || level > 9) fields.level = 'Slot level must be a whole number from 1 to 9; cantrips do not use slots.'
  if (!body) fields.body = 'Expected a JSON object.'
  if (!body || !Number.isInteger(body.maximum) || (body.maximum as number) < 0 || (body.maximum as number) > 99) fields.maximum = 'Maximum slots must be a whole number from 0 to 99.'
  if (!body || !Number.isInteger(body.remaining) || (body.remaining as number) < 0 || (body.remaining as number) > 99) fields.remaining = 'Remaining slots must be a whole number from 0 to 99.'
  if (body && Number.isInteger(body.maximum) && Number.isInteger(body.remaining) && (body.remaining as number) > (body.maximum as number)) fields.remaining = 'Remaining slots cannot exceed the configured maximum.'
  if (Object.keys(fields).length) { validation(response, fields); return }
  try { response.json({ slot: spellStore.setSlot(request.params.campaignId, request.params.playerId, request.params.characterId, level, body!.maximum as number, body!.remaining as number) }) } catch (error) { next(error) }
})

router.post(`${base}/spell-slots/:level/:action`, (request, response, next) => {
  const level = Number(request.params.level)
  if (!Number.isInteger(level) || level < 1 || level > 9) { validation(response, { level: 'Slot level must be a whole number from 1 to 9.' }); return }
  if (request.params.action !== 'expend' && request.params.action !== 'restore') { validation(response, { action: 'Choose expend or restore.' }); return }
  try { response.json({ slot: spellStore.changeSlot(request.params.campaignId, request.params.playerId, request.params.characterId, level, request.params.action) }) } catch (error) { next(error) }
})

router.post(`${base}/spell-slots/restore-all`, (request, response, next) => {
  try { response.json({ slots: spellStore.restoreAll(request.params.campaignId, request.params.playerId, request.params.characterId) }) } catch (error) { next(error) }
})

export = router
