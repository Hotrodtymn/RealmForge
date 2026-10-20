import express = require('express')
import ollama = require('./ollamaService')
import isLoopbackAddress = require('./loopback')
import HttpError = require('./httpError')

function createAiRouter(service: InstanceType<typeof ollama.OllamaService> = ollama.ollamaService) {
  const router = express.Router()

  router.get('/health', async (_request, response) => {
    response.json(await service.health())
  })

  router.post('/test', async (request, response, next) => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      response.status(403).json({ error: 'This diagnostic endpoint is available only to local clients.' })
      return
    }
    const body: unknown = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } })
      return
    }
    const values = body as Record<string, unknown>
    const errors: Record<string, string> = {}
    for (const key of Object.keys(values)) {
      if (key !== 'prompt') errors[key] = 'This field is not allowed.'
    }
    if (typeof values.prompt !== 'string') errors.prompt = 'Prompt must be text.'
    else if (values.prompt.trim().length === 0) errors.prompt = 'Prompt is required.'
    else if (values.prompt.trim().length > 300) errors.prompt = 'Prompt must be 300 characters or fewer.'
    if (Object.keys(errors).length) {
      response.status(400).json({ error: 'Validation failed', fields: errors })
      return
    }
    try {
      response.json(await service.generate((values.prompt as string).trim()))
    } catch (error) {
      if (error instanceof ollama.OllamaError) {
        const status = error.kind === 'missing-model' ? 503 : error.kind === 'timeout' ? 504 : error.kind === 'malformed' ? 502 : 503
        response.status(status).json({ error: error.message })
        return
      }
      next(new HttpError(502, 'The local AI test request failed.'))
    }
  })

  return router
}

export = createAiRouter
