require('tsx/cjs')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const crypto = require('node:crypto')
const test = require('node:test')
const assert = require('node:assert/strict')
const isLoopbackAddress = require('../src/loopback.ts')

const uuid = () => crypto.randomUUID()

test('loopback guard recognizes local IPv4/IPv6 clients and rejects remote addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('192.0.2.10'), false)
  assert.equal(isLoopbackAddress(undefined), false)
})

test('narration validates authoritative active scene context, filters private facts, and does not mutate session state', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-narration-'))
  let realmServer
  let serverError = ''
  let ollamaServer
  let ollamaMode = 'normal'
  let capturedPrompt = ''
  let generationCount = 0
  const [serverPort, ollamaPort] = await Promise.all([0, 0].map(() => new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
  })))
  const api = `http://127.0.0.1:${serverPort}/api`

  ollamaServer = http.createServer((request, response) => {
    if (request.url === '/api/tags') {
      if (ollamaMode === 'unavailable') { response.writeHead(503).end(); return }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }))
      return
    }
    if (request.url === '/api/generate') {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        capturedPrompt = JSON.parse(body).prompt
        generationCount += 1
        if (ollamaMode === 'timeout') {
          setTimeout(() => { if (!response.destroyed) response.writeHead(200).end(JSON.stringify({ response: 'late text' })) }, 1_500)
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ response: 'Mist drifts across the road as the old bell rings once.' }))
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
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaPort}`, OLLAMA_NARRATION_TIMEOUT_MS: '1000' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  realmServer.stderr.setEncoding('utf8')
  realmServer.stderr.on('data', (chunk) => { serverError += chunk })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (realmServer.exitCode !== null) throw new Error(`RealmForge server exited with ${realmServer.exitCode}: ${serverError}`)
    try { if ((await fetch(`${api}/health`)).ok) break } catch {}
    await delay(100)
  }
  async function request(route, method = 'GET', body) {
    const response = await fetch(`${api}${route}`, { method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }

  const campaignResponse = await request('/campaigns', 'POST', { name: 'Morrowfen', description: 'A marshland realm.', setting: 'Low fantasy' })
  const campaignId = campaignResponse.body.campaign.id
  const playerResponse = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName: 'Nia' })
  const characterResponse = await request(`/campaigns/${campaignId}/players/${playerResponse.body.player.playerId}/characters`, 'POST', {
    name: 'Nia Ashford', species: 'Human', class: 'Ranger',
    abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 15, cha: 10 },
  })
  const characterId = characterResponse.body.character.id
  const adventureResponse = await request(`/campaigns/${campaignId}/adventures`, 'POST', { title: 'The Drowned Bell', description: 'A bell rings from beneath the fen.', status: 'active', startingLocation: 'Morrowfen Causeway' })
  const adventureId = adventureResponse.body.adventure.id
  const locations = `/campaigns/${campaignId}/adventures/${adventureId}/locations`
  const currentLocation = await request(locations, 'POST', { name: 'Morrowfen Causeway', description: 'A narrow stone road through the reeds.', locationType: 'Road' })
  const distantLocation = await request(locations, 'POST', { name: 'Cairn Hill', description: 'A hill beyond the marsh.', locationType: 'Hill' })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/npcs`, 'POST', {
    name: 'Edda Vale', description: 'A ferryman with a lantern.', personality: 'Watchful', disposition: 'Wary',
    currentLocationId: currentLocation.body.location.id, dmNotes: 'Hidden fact: Edda is the masked heir.' })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/npcs`, 'POST', {
    name: 'Distant Rook', description: 'A figure on the hill.', currentLocationId: distantLocation.body.location.id, dmNotes: 'Do not reveal this.' })
  const quest = await request(`/campaigns/${campaignId}/adventures/${adventureId}/quests`, 'POST', {
    title: 'Find the bell', description: 'Discover why the bell rings.', status: 'active' })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/quests/${quest.body.quest.id}/objectives`, 'POST', { description: 'Question the ferryman.' })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/story/flags/public_bell_heard`, 'PUT', { value: true })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/story/flags/secret_heir_identity`, 'PUT', { value: 'Edda' })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/story/notes`, 'POST', { content: 'Private DM note: the ferryman is the heir.' })
  const started = await request(`/campaigns/${campaignId}/adventures/${adventureId}/sessions`, 'POST', {
    requestId: uuid(), characterId, locationId: currentLocation.body.location.id,
    sceneTitle: 'The First Toll', sceneDescription: 'A bronze bell sounds beneath the dark water.' })
  const sessionId = started.body.session.id
  const sceneId = started.body.session.currentSceneId
  await request(`/campaigns/${campaignId}/sessions/${sessionId}/decisions`, 'POST', { requestId: uuid(), decisionText: 'I study the waterline.' })

  const invalidBody = await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId, sceneId: 'not-an-id' })
  assert.equal(invalidBody.status, 400)
  assert.equal((await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId })).status, 400)
  assert.equal((await request('/ai/narrate', 'POST', { campaignId: uuid(), adventureId, sessionId, sceneId })).status, 404)
  assert.equal((await request('/ai/narrate', 'POST', { campaignId, adventureId: uuid(), sessionId, sceneId })).status, 404)
  assert.equal((await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId: uuid(), sceneId })).status, 404)
  assert.equal((await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId, sceneId: uuid() })).status, 409)

  const before = await request(`/campaigns/${campaignId}/sessions/${sessionId}`)
  const result = await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId, sceneId })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.deepEqual(result.body, {
    model: 'llama3.1:8b', narration: 'Mist drifts across the road as the old bell rings once.',
    identifiers: { campaignId, adventureId, sessionId, sceneId },
  })
  assert.match(capturedPrompt, /Morrowfen/)
  assert.match(capturedPrompt, /Morrowfen Causeway/)
  assert.match(capturedPrompt, /The First Toll/)
  assert.match(capturedPrompt, /Edda Vale/)
  assert.match(capturedPrompt, /Question the ferryman/)
  assert.match(capturedPrompt, /public_bell_heard/)
  assert.match(capturedPrompt, /I study the waterline/)
  assert.doesNotMatch(capturedPrompt, /Hidden fact|masked heir|Distant Rook|Do not reveal this|secret_heir_identity|Private DM note/)
  const after = await request(`/campaigns/${campaignId}/sessions/${sessionId}`)
  assert.deepEqual(after.body, before.body)

  const paused = await request(`/campaigns/${campaignId}/sessions/${sessionId}/pause`, 'POST', { requestId: uuid() })
  assert.equal(paused.status, 200)
  assert.equal((await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId, sceneId })).status, 409)

  ollamaMode = 'unavailable'
  assert.equal((await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId: started.body.session.id, sceneId })).status, 409)
  const resumed = await request(`/campaigns/${campaignId}/sessions/${sessionId}/resume`, 'POST', { requestId: uuid() })
  assert.equal(resumed.status, 200)
  ollamaMode = 'unavailable'
  assert.equal((await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId, sceneId })).status, 503)
  ollamaMode = 'timeout'
  assert.equal((await request('/ai/narrate', 'POST', { campaignId, adventureId, sessionId, sceneId })).status, 504)
  assert.ok(generationCount >= 2)
})
