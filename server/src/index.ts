import express = require('express')
import cors = require('cors')
import campaignRoutes = require('./campaignRoutes')

const app = express()
const port = Number(process.env.PORT) || 3001

app.use(cors())
app.use(express.json({ limit: '32kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.use('/api/campaigns', campaignRoutes)

app.use((_request, response) => {
  response.status(404).json({ error: 'Not found' })
})

app.use(((error: unknown, _request, response, _next) => {
  if (error instanceof SyntaxError && 'status' in error) {
    response.status(400).json({ error: 'Invalid JSON request body' })
    return
  }

  console.error('Request failed:', error)
  response.status(500).json({ error: 'Internal server error' })
}) as express.ErrorRequestHandler)

app.listen(port, () => {
  console.log(`RealmForge API listening on port ${port}`)
})
