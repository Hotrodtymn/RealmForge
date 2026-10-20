import express = require('express')
import isLoopbackAddress = require('./loopback')
import turnService = require('./aiSessionTurnService')
import turnStore = require('./aiSessionTurnStore')
import HttpError = require('./httpError')
import ollama = require('./ollamaService')

const router = express.Router()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function localOnly(request: express.Request, response: express.Response): boolean {
  if (isLoopbackAddress(request.socket.remoteAddress)) return true
  response.status(403).json({ error: 'AI session turns are available only to local clients.' })
  return false
}
function failure(error: unknown, response: express.Response, next: express.NextFunction): void {
  if (error instanceof ollama.OllamaError) {
    const status = error.kind === 'timeout' ? 504 : error.kind === 'malformed' ? 502 : 503
    response.status(status).json({ error: error.message })
    return
  }
  next(error instanceof HttpError ? error : new HttpError(502, 'The Dungeon Master could not complete this turn. Retry the same action.'))
}
function objectBody(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

router.post('/session/turn', async (request, response, next) => {
  if (!localOnly(request, response)) return
  const body = objectBody(request.body)
  if (!body) { response.status(400).json({ error: 'Validation failed.', fields: { body: 'Expected a JSON object.' } }); return }
  const fields: Record<string, string> = {}
  for (const key of Object.keys(body)) if (!['sessionId', 'characterId', 'action', 'clientTurnId'].includes(key)) fields[key] = 'This field is not allowed.'
  for (const key of ['sessionId', 'characterId', 'clientTurnId'] as const) if (typeof body[key] !== 'string' || !uuid.test(body[key] as string)) fields[key] = 'Provide a valid UUID.'
  if (typeof body.action !== 'string') fields.action = 'Action must be text.'
  else if (!body.action.trim()) fields.action = 'Describe an action before submitting.'
  else if (body.action.trim().length > 2_000) fields.action = 'Action must be 2000 characters or fewer.'
  if (Object.keys(fields).length) { response.status(400).json({ error: 'Validation failed.', fields }); return }
  try {
    const result = await turnService.aiSessionTurnService.submit({
      sessionId: body.sessionId as string,
      characterId: body.characterId as string,
      action: (body.action as string).trim(),
      clientTurnId: body.clientTurnId as string,
    })
    response.status(result.replayed ? 200 : 201).json(result)
  } catch (error) { failure(error, response, next) }
})

router.get('/session/:sessionId/turns', (request, response, next) => {
  if (!localOnly(request, response)) return
  if (!uuid.test(request.params.sessionId)) { response.status(400).json({ error: 'Validation failed.', fields: { sessionId: 'Provide a valid UUID.' } }); return }
  const characterId = request.query.characterId
  if (typeof characterId !== 'string' || !uuid.test(characterId)) { response.status(400).json({ error: 'Validation failed.', fields: { characterId: 'Provide the session character UUID.' } }); return }
  try { response.json({ turns: turnService.aiSessionTurnService.transcript(request.params.sessionId, characterId) }) }
  catch (error) { failure(error, response, next) }
})

export = router
