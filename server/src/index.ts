import express = require('express')
import cors = require('cors')
import campaignRoutes = require('./campaignRoutes')
import playerCharacterRoutes = require('./playerCharacterRoutes')
import inventoryRoutes = require('./inventoryRoutes')
import combatRoutes = require('./combatRoutes')
import HttpError = require('./httpError')

const app = express()
const port = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json({ limit: '32kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.use('/api/campaigns', campaignRoutes)
app.use('/api/campaigns', playerCharacterRoutes)
app.use('/api/campaigns', inventoryRoutes)
app.use('/api/campaigns', combatRoutes)

app.use((_request, response) => {
  response.status(404).json({ error: 'Not found' })
})

app.use(((error: unknown, _request, response, _next) => {
  if (error instanceof SyntaxError && 'status' in error) {
    response.status(400).json({ error: 'Invalid JSON request body' })
    return
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.details ?? {}) })
    return
  }

  console.error('Request failed:', error)
  response.status(500).json({ error: 'Internal server error' })
}) as express.ErrorRequestHandler)

app.listen(port, () => {
  console.log(`RealmForge API listening on port ${port}`)
})
