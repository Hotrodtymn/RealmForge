import express = require('express')
import isLoopbackAddress = require('./loopback')
import service = require('./worldExpansionService')
import ollama = require('./ollamaService')
import HttpError = require('./httpError')
import approvalService = require('./worldExpansionApprovalService')
import approvalRegistry = require('./worldExpansionApprovalRegistry')

const router = express.Router()
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

router.post('/world/expand/preview', async (request, response, next) => {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.status(403).json({ error: 'World expansion previews are available only to local clients.' })
    return
  }
  const body: unknown = request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.status(400).json({ error: 'Validation failed.', fields: { body: 'Expected a JSON object.' } })
    return
  }
  const values = body as Record<string, unknown>
  const fields: Record<string, string> = {}
  for (const key of Object.keys(values)) if (!['adventureId', 'sessionId', 'characterId'].includes(key)) fields[key] = 'This field is not allowed.'
  for (const key of ['adventureId', 'sessionId', 'characterId'] as const) {
    if (typeof values[key] !== 'string' || !uuid.test(values[key] as string)) fields[key] = 'Provide a valid UUID.'
  }
  if (Object.keys(fields).length) {
    response.status(400).json({ error: 'Validation failed.', fields })
    return
  }
  try {
    const result = await service.worldExpansionService.preview({
      adventureId: values.adventureId as string,
      sessionId: values.sessionId as string,
      characterId: values.characterId as string,
    })
    response.json(result)
  } catch (error) {
    if (error instanceof approvalRegistry.ApprovalPreviewError && error.code === 'capacity') {
      response.status(503).json({ error: error.message })
      return
    }
    if (error instanceof service.WorldExpansionError) {
      response.status(502).json({ error: error.message, kind: error.kind })
      return
    }
    if (error instanceof ollama.OllamaError) {
      const status = error.kind === 'timeout' ? 504 : error.kind === 'unavailable' || error.kind === 'missing-model' ? 503 : 502
      response.status(status).json({ error: error.message, kind: error.kind })
      return
    }
    next(error instanceof HttpError ? error : new HttpError(502, 'World expansion preview could not be generated.'))
  }
})

router.post('/world/expand/approve', (request, response, next) => {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    response.status(403).json({ error: 'World expansion approval is available only to local clients.' })
    return
  }
  try {
    const body: unknown = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object.')
    const values = body as Record<string, unknown>
    const allowed = new Set(['previewId', 'adventureId', 'selectedProposalKeys', 'edits'])
    for (const field of Object.keys(values)) if (!allowed.has(field)) throw new HttpError(400, `Field ${field} is not allowed.`)
    if (typeof values.previewId !== 'string') throw new HttpError(400, 'Provide a previewId.')
    if (typeof values.adventureId !== 'string') throw new HttpError(400, 'Provide an adventureId.')
    if (!Array.isArray(values.selectedProposalKeys)) throw new HttpError(400, 'selectedProposalKeys must be an array.')
    const result = approvalService.worldExpansionApprovalService.approve({
      previewId: values.previewId,
      adventureId: values.adventureId,
      selectedProposalKeys: values.selectedProposalKeys,
      ...(Object.hasOwn(values, 'edits') ? { edits: values.edits } : {}),
    })
    response.status(201).json({ ...result.value, metadata: { remainingProposalKeys: result.remainingProposalKeys, expiresAt: result.expiresAt } })
  } catch (error) {
    if (error instanceof approvalRegistry.ApprovalPreviewError) {
      const status = error.code === 'expired' ? 410
        : error.code === 'capacity' ? 503
          : error.code === 'adventure' || error.code === 'invalid' ? 404
            : error.code === 'already-approved' || error.code === 'in-progress' ? 409 : 400
      response.status(status).json({ error: error.message })
      return
    }
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.details ?? {}) })
      return
    }
    next(new HttpError(500, 'World Expansion approval failed. No partial changes were committed.'))
  }
})

export = router
