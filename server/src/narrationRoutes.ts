import express = require('express')
import isLoopbackAddress = require('./loopback')
import narration = require('./narrationService')
import HttpError = require('./httpError')
import ollama = require('./ollamaService')

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const router = express.Router()

router.post('/narrate', async (request, response, next) => {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.status(403).json({ error: 'Narration is available only to local clients.' })
    return
  }

  const body: unknown = request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.status(400).json({ error: 'Validation failed.', fields: { body: 'Expected a JSON object.' } })
    return
  }
  const values = body as Record<string, unknown>
  const fields: Record<string, string> = {}
  for (const key of Object.keys(values)) {
    if (!['campaignId', 'adventureId', 'sessionId', 'sceneId'].includes(key)) fields[key] = 'This field is not allowed.'
  }
  for (const key of ['campaignId', 'adventureId', 'sessionId', 'sceneId'] as const) {
    if (typeof values[key] !== 'string' || !uuid.test(values[key] as string)) fields[key] = 'Provide a valid identifier.'
  }
  if (Object.keys(fields).length) {
    response.status(400).json({ error: 'Validation failed.', fields })
    return
  }

  try {
    const result = await narration.narrationService.narrate({
      campaignId: values.campaignId as string,
      adventureId: values.adventureId as string,
      sessionId: values.sessionId as string,
      sceneId: values.sceneId as string,
    })
    response.json(result)
  } catch (error) {
    if (error instanceof ollama.OllamaError) {
      const status = error.kind === 'timeout' ? 504 : error.kind === 'malformed' ? 502 : 503
      response.status(status).json({ error: error.message })
      return
    }
    next(error instanceof HttpError ? error : new HttpError(502, 'Narration could not be generated.'))
  }
})

export = router
