require('tsx/cjs')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const { DatabaseSync } = require('node:sqlite')
const test = require('node:test')
const assert = require('node:assert/strict')
const previewSchema = require('../src/worldPreviewSchema.ts')
const isLoopbackAddress = require('../src/loopback.ts')

function validPreview() {
  return {
    campaign: {
      key: 'campaign', title: 'The Bell Beneath the Fen',
      premise: 'A drowned bell tolls each night, drawing the living toward a forgotten marsh shrine.',
      setting: 'A rain-dark borderland of drowned roads and old stone.', startingLocationKey: 'location_causeway',
    },
    locations: [
      { key: 'location_causeway', name: 'Morrowfen Causeway', kind: 'Road', description: 'A raised stone track crosses a wide, black marsh.', isStartingLocation: true },
      { key: 'location_chapel', name: 'Sunken Chapel', kind: 'Ruin', description: 'A roofless chapel sinks into the water beside leaning yews.', isStartingLocation: false },
      { key: 'location_ferry', name: 'Old Ferry House', kind: 'Shelter', description: 'A shuttered ferry house waits beside a broken wooden pier.', isStartingLocation: false },
    ],
    npcs: [
      { key: 'npc_edda', name: 'Edda Vale', role: 'Ferryman who watches the causeway', personality: 'Careful and slow to trust strangers.', motivation: 'She wants the nightly bell silenced before the next flood.', locationKey: 'location_causeway' },
      { key: 'npc_brother', name: 'Brother Caldus', role: 'Keeper of the ruined chapel', personality: 'Soft-spoken but fiercely protective of the shrine.', motivation: 'He seeks the missing chapel key to protect the village.', locationKey: 'location_chapel' },
      { key: 'npc_mara', name: 'Mara Venn', role: 'Reclusive former ferry keeper', personality: 'Wry, watchful, and uncomfortable around bells.', motivation: 'She hopes to repay an old debt to the people of the fen.', locationKey: 'location_ferry' },
    ],
    mainQuest: {
      key: 'main_quest', title: 'Answer the Drowned Bell',
      description: 'Find why the bell rings beneath the marsh and help the locals decide what to do.',
      objectives: [
        { key: 'objective_ask_edda', description: 'Ask Edda what changed before the first toll.' },
        { key: 'objective_reach_chapel', description: 'Reach the sunken chapel and examine its bell tower.' },
        { key: 'objective_choose_fate', description: 'Learn what sustains the toll and choose how to respond.' },
      ],
      locationKeys: ['location_causeway', 'location_chapel', 'location_ferry'],
    },
    mysteryOrThreat: 'Something beneath the chapel is repeating a warning from the flood that destroyed the old village.',
    openingScene: {
      key: 'opening_scene', title: 'A Toll Through the Rain',
      description: 'Rain beads on the causeway stones as a low bell sounds from beneath the dark water. Edda raises her lantern and asks who else heard it.',
      locationKey: 'location_causeway', questKey: 'main_quest',
    },
    possibleResolution: 'The character may quiet the bell, uncover its warning, or leave the mystery unresolved; the choice belongs to the player.',
  }
}

const config = { dmMode: 'ai', theme: 'dark-fantasy', worldCreation: 'surprise', length: 'short' }
const requestBody = (ids = config) => JSON.parse(JSON.stringify(ids))

test('world preview validator enforces required shape, bounds, stable keys, and relationships', () => {
  const preview = validPreview()
  assert.deepEqual(previewSchema.validateWorldPreview(preview), preview)

  const missingContent = validPreview()
  missingContent.npcs.pop()
  assert.throws(() => previewSchema.validateWorldPreview(missingContent), /exactly three NPCs/)

  const brokenNpcReference = validPreview()
  brokenNpcReference.npcs[0].locationKey = 'location_missing'
  assert.throws(() => previewSchema.validateWorldPreview(brokenNpcReference), /unknown location/)

  const brokenQuestReference = validPreview()
  brokenQuestReference.mainQuest.locationKeys[0] = 'location_missing'
  assert.throws(() => previewSchema.validateWorldPreview(brokenQuestReference), /unknown or duplicate location/)

  const brokenSceneReference = validPreview()
  brokenSceneReference.openingScene.questKey = 'another_quest'
  assert.throws(() => previewSchema.validateWorldPreview(brokenSceneReference), /unknown or mismatched/)

  const generatedUuidKey = validPreview()
  generatedUuidKey.locations[0].key = '123e4567-e89b-42d3-a456-426614174000'
  assert.throws(() => previewSchema.validateWorldPreview(generatedUuidKey), /stable preview key/)
})

test('world preview endpoint is loopback guarded', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('203.0.113.4'), false)
})

test('world generation validates configuration, retries invalid output, handles Ollama failures, and never writes preview data', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-world-preview-'))
  let realmServer
  let serverError = ''
  let ollamaServer
  let mode = 'valid'
  let generationCalls = 0
  let receivedGenerationRequest
  const [serverPort, ollamaPort] = await Promise.all([0, 0].map(() => new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
  })))
  const api = `http://127.0.0.1:${serverPort}/api`

  ollamaServer = http.createServer((request, response) => {
    if (request.url === '/api/tags') {
      if (mode === 'unavailable') { response.writeHead(503).end(); return }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }))
      return
    }
    if (request.url === '/api/generate') {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { raw += chunk })
      request.on('end', () => {
        receivedGenerationRequest = JSON.parse(raw)
        generationCalls += 1
        if (mode === 'timeout') {
          setTimeout(() => { if (!response.destroyed) response.writeHead(200).end(JSON.stringify({ response: JSON.stringify(validPreview()) })) }, 1_500)
          return
        }
        const preview = validPreview()
        if (mode === 'missing-content') preview.npcs.pop()
        if (mode === 'broken-reference') preview.openingScene.locationKey = 'location_unknown'
        const generated = mode === 'malformed-json' ? '{not-json' : JSON.stringify(preview)
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ response: generated }))
      })
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve) => ollamaServer.listen(ollamaPort, '127.0.0.1', resolve))

  t.after(async () => {
    if (realmServer && realmServer.exitCode === null) { const exited = once(realmServer, 'exit'); realmServer.kill('SIGTERM'); await exited }
    if (ollamaServer) await new Promise((resolve) => ollamaServer.close(resolve))
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  realmServer = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(serverPort), REALMFORGE_HOST: '127.0.0.1', REALMFORGE_DATA_DIR: dataDir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaPort}`, OLLAMA_WORLD_TIMEOUT_MS: '1000', OLLAMA_WORLD_RETRY_TIMEOUT_MS: '1000' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  realmServer.stderr.setEncoding('utf8')
  realmServer.stderr.on('data', (chunk) => { serverError += chunk })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (realmServer.exitCode !== null) throw new Error(`RealmForge server exited with ${realmServer.exitCode}: ${serverError}`)
    try { if ((await fetch(`${api}/health`)).ok) break } catch {}
    await delay(100)
  }
  async function request(route, body = requestBody()) {
    const result = await fetch(`${api}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: result.status, body: await result.json() }
  }

  const db = new DatabaseSync(path.join(dataDir, 'realmforge.sqlite'))
  const counts = () => Object.fromEntries(['campaigns', 'adventures', 'adventure_locations', 'adventure_npcs', 'adventure_quests', 'adventure_sessions'].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]))
  const before = counts()
  const invalidConfiguration = await request('/ai/world/preview', { ...config, theme: 'high-fantasy' })
  assert.equal(invalidConfiguration.status, 400)
  assert.ok(invalidConfiguration.body.fields.theme)
  assert.equal(generationCalls, 0)
  assert.equal((await request('/ai/world/preview', { ...config, model: 'other-model' })).status, 400)

  const successful = await request('/ai/world/preview')
  assert.equal(successful.status, 200, JSON.stringify(successful.body))
  assert.equal(successful.body.model, 'llama3.1:8b')
  assert.equal(successful.body.metadata.previewOnly, true)
  assert.equal(successful.body.metadata.attempts, 1)
  assert.equal(successful.body.preview.locations.length, 3)
  assert.equal(successful.body.preview.npcs.length, 3)
  assert.equal(successful.body.preview.mainQuest.objectives.length, 3)
  assert.equal(receivedGenerationRequest.model, 'llama3.1:8b')
  assert.equal(receivedGenerationRequest.stream, false)
  assert.ok(receivedGenerationRequest.format && typeof receivedGenerationRequest.format === 'object')
  assert.equal(receivedGenerationRequest.options.num_predict, 1600)
  assert.deepEqual(counts(), before)

  for (const invalidMode of ['missing-content', 'broken-reference', 'malformed-json']) {
    mode = invalidMode
    const callsBefore = generationCalls
    const rejected = await request('/ai/world/preview')
    assert.equal(rejected.status, 502)
    assert.match(rejected.body.error, /valid structured preview/)
    assert.equal(generationCalls - callsBefore, 2)
  }

  mode = 'unavailable'
  const unavailable = await request('/ai/world/preview')
  assert.equal(unavailable.status, 503)
  assert.match(unavailable.body.error, /Ollama|model/i)
  mode = 'timeout'
  const timedOut = await request('/ai/world/preview')
  assert.equal(timedOut.status, 504)
  assert.match(timedOut.body.error, /timed out/i)
  assert.deepEqual(counts(), before)
  db.close()
})
