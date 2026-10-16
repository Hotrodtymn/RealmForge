import express = require('express')
import campaignStore = require('./campaignStore')

const router = express.Router()
const limits = { name: 100, description: 2000, setting: 120 }

router.get('/', (_request, response) => {
  response.json({ campaigns: campaignStore.listCampaigns() })
})

router.post('/', (request, response, next) => {
  const body: unknown = request.body
  const errors: Record<string, string> = {}

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } })
    return
  }

  const values = body as Record<string, unknown>
  const normalized: campaignStore.NewCampaign = { name: '', description: '', setting: '' }

  for (const field of ['name', 'description', 'setting'] as const) {
    const value = values[field]
    const isRequired = field === 'name'

    if (value === undefined && !isRequired) continue
    if (typeof value !== 'string') {
      errors[field] = 'Must be text.'
      continue
    }

    const trimmed = value.trim()
    if (isRequired && trimmed.length === 0) {
      errors[field] = 'Name is required.'
    } else if (trimmed.length > limits[field]) {
      errors[field] = `Must be ${limits[field]} characters or fewer.`
    } else {
      normalized[field] = trimmed
    }
  }

  if (Object.keys(errors).length > 0) {
    response.status(400).json({ error: 'Validation failed', fields: errors })
    return
  }

  try {
    response.status(201).json({ campaign: campaignStore.createCampaign(normalized) })
  } catch (error) {
    next(error)
  }
})

export = router
