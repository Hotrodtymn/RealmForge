import express = require('express')
import isLoopbackAddress = require('./loopback')
import worldConfig = require('./worldGenerationConfig')
import worldGeneration = require('./worldGenerationService')
import previewSchema = require('./worldPreviewSchema')
import ollama = require('./ollamaService')
import HttpError = require('./httpError')
import worldPreviewRegistry = require('./worldPreviewRegistry')
import worldPersistence = require('./worldPersistenceStore')

const router = express.Router()

router.post('/world/preview', async (request, response, next) => {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.status(403).json({ error: 'World preview generation is available only to local clients.' })
    return
  }
  try {
    const configuration = worldConfig.validateWorldGenerationConfig(request.body)
    const result = await worldGeneration.worldGenerationService.preview(configuration)
    response.json(result)
  } catch (error) {
    if (error instanceof worldConfig.WorldGenerationConfigError) {
      response.status(400).json({ error: error.message, fields: error.fields })
      return
    }
    if (error instanceof previewSchema.WorldPreviewValidationError) {
      response.status(502).json({ error: error.message })
      return
    }
    if (error instanceof ollama.OllamaError) {
      const status = error.kind === 'timeout' ? 504 : error.kind === 'malformed' ? 502 : 503
      response.status(status).json({ error: error.message })
      return
    }
    if (error instanceof worldPreviewRegistry.PreviewTokenError && error.code === 'capacity') {
      response.status(503).json({ error: error.message })
      return
    }
    next(error instanceof HttpError ? error : new HttpError(502, 'World preview generation failed.'))
  }
})

router.post('/world/save', (request, response, next) => {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.status(403).json({ error: 'World persistence is available only to local clients.' })
    return
  }
  try {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
      response.status(400).json({ error: 'Expected a JSON object containing previewToken.' })
      return
    }
    const body = request.body as Record<string, unknown>
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'previewToken')) {
      response.status(400).json({ error: 'Request must contain only previewToken.' })
      return
    }
    const saved = worldPreviewRegistry.worldPreviewRegistry.save(body.previewToken, (snapshot) => worldPersistence.persistWorld(snapshot))
    response.status(saved.replayed ? 200 : 201).json({
      ...saved.value,
      metadata: { replayed: saved.replayed, expiresAt: saved.expiresAt },
    })
  } catch (error) {
    if (error instanceof worldPreviewRegistry.PreviewTokenError) {
      const status = error.code === 'expired' ? 410 : error.code === 'in-progress' ? 409 : error.code === 'capacity' ? 503 : 404
      response.status(status).json({ error: error.message })
      return
    }
    next(error instanceof HttpError ? error : new HttpError(500, 'World preview could not be saved. No partial campaign was created.'))
  }
})

export = router
