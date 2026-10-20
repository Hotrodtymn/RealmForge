import express = require('express')
import cors = require('cors')
import fs = require('node:fs')
import path = require('node:path')
import campaignRoutes = require('./campaignRoutes')
import playerCharacterRoutes = require('./playerCharacterRoutes')
import inventoryRoutes = require('./inventoryRoutes')
import combatRoutes = require('./combatRoutes')
import spellRoutes = require('./spellRoutes')
import spellResolutionRoutes = require('./spellResolutionRoutes')
import spellEffectRoutes = require('./spellEffectRoutes')
import spellCastingRoutes = require('./spellCastingRoutes')
import adventureRoutes = require('./adventureRoutes')
import adventureSessionRoutes = require('./adventureSessionRoutes')
import createAiRouter = require('./aiRoutes')
import narrationRoutes = require('./narrationRoutes')
import aiSessionTurnRoutes = require('./aiSessionTurnRoutes')
import storyMemoryRoutes = require('./storyMemoryRoutes')
import worldGenerationRoutes = require('./worldGenerationRoutes')
import worldExpansionRoutes = require('./worldExpansionRoutes')
import HttpError = require('./httpError')
import readOllamaConfig = require('./ollamaConfig')

const app = express()
const port = Number(process.env.PORT) || 3001
const host = process.env.REALMFORGE_HOST || '127.0.0.1'

const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i
app.use(cors({
  origin(origin, callback) {
    callback(null, origin === undefined || localOrigin.test(origin))
  },
}))

app.use(express.json({ limit: '32kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.use('/api/ai', createAiRouter())
app.use('/api/ai', narrationRoutes)
app.use('/api/ai', aiSessionTurnRoutes)
app.use('/api/ai', storyMemoryRoutes)
app.use('/api/ai', worldGenerationRoutes)
app.use('/api/ai', worldExpansionRoutes)

app.use('/api/campaigns', campaignRoutes)
app.use('/api/campaigns', playerCharacterRoutes)
app.use('/api/campaigns', inventoryRoutes)
app.use('/api/campaigns', combatRoutes)
app.use('/api/campaigns', spellRoutes)
app.use('/api/campaigns', spellResolutionRoutes)
app.use('/api/campaigns', spellEffectRoutes)
app.use('/api/campaigns', spellCastingRoutes)
app.use('/api/campaigns', adventureRoutes)
app.use('/api/campaigns', adventureSessionRoutes)

const clientDist = process.env.REALMFORGE_CLIENT_DIST ? path.resolve(process.env.REALMFORGE_CLIENT_DIST) : ''
if (clientDist) {
  const clientIndex = path.join(clientDist, 'index.html')
  if (!fs.existsSync(clientIndex)) throw new Error(`Configured client build is missing: ${clientIndex}`)
  app.use(express.static(clientDist, { index: false, fallthrough: true }))
  app.use((request, response, next) => {
    if ((request.method !== 'GET' && request.method !== 'HEAD') || request.path.startsWith('/api/')) {
      next()
      return
    }
    response.sendFile(clientIndex, (error) => { if (error) next(error) })
  })
}

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

app.listen(port, host, () => {
  console.log(`RealmForge server listening at http://${host}:${port}`)
  console.info('[realmforge:startup]', JSON.stringify({ worldGenerationTimeoutMs: readOllamaConfig().worldGenerationTimeoutMs }))
})
