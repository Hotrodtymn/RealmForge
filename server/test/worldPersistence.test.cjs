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
const previewFixture = require('./worldPreviewFixture.cjs')
const isLoopbackAddress = require('../src/loopback.ts')

const config = { dmMode: 'ai', theme: 'dark-fantasy', worldCreation: 'surprise', length: 'short' }
const requestBody = (body = config) => JSON.parse(JSON.stringify(body))

test('world save endpoint persists token-bound previews once and leaves existing campaign content intact', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-world-save-'))
  let realmServer
  let serverError = ''
  let ollamaServer
  let verificationDb
  let generationCalls = 0
  const reservePort = () => new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
  })
  const [serverPort, ollamaPort] = await Promise.all([reservePort(), reservePort()])
  const api = `http://127.0.0.1:${serverPort}/api`

  ollamaServer = http.createServer((request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }] }))
      return
    }
    if (request.url === '/api/generate') {
      generationCalls += 1
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ response: JSON.stringify(previewFixture()), done: true }))
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve) => ollamaServer.listen(ollamaPort, '127.0.0.1', resolve))

  t.after(async () => {
    if (realmServer && realmServer.exitCode === null) { const exited = once(realmServer, 'exit'); realmServer.kill('SIGTERM'); await exited }
    if (ollamaServer) await new Promise((resolve) => ollamaServer.close(resolve))
    if (verificationDb) { try { verificationDb.close() } catch {} }
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  realmServer = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(serverPort), REALMFORGE_HOST: '127.0.0.1', REALMFORGE_DATA_DIR: dataDir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaPort}`, OLLAMA_WORLD_PREVIEW_TTL_MS: '60000' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  realmServer.stderr.setEncoding('utf8')
  realmServer.stderr.on('data', (chunk) => { serverError += chunk })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (realmServer.exitCode !== null) throw new Error(`RealmForge server exited with ${realmServer.exitCode}: ${serverError}`)
    try { if ((await fetch(`${api}/health`)).ok) break } catch {}
    await delay(100)
  }

  const db = new DatabaseSync(path.join(dataDir, 'realmforge.sqlite'))
  verificationDb = db
  const timestamp = new Date().toISOString()
  db.prepare('INSERT INTO campaigns (id,name,description,setting,createdAt) VALUES (?,?,?,?,?)').run('kept-campaign', 'The Ashen Crown', 'Keep this campaign', 'Keep this setting', timestamp)
  db.prepare('INSERT INTO adventures (id,campaignId,title,description,status,startingLocation,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('kept-adventure', 'kept-campaign', 'The Whispering Flask', 'Keep this adventure', 'draft', '', timestamp, timestamp)
  const previous = {
    campaigns: db.prepare('SELECT COUNT(*) n FROM campaigns').get().n,
    adventures: db.prepare('SELECT COUNT(*) n FROM adventures').get().n,
    locations: db.prepare('SELECT COUNT(*) n FROM adventure_locations').get().n,
    npcs: db.prepare('SELECT COUNT(*) n FROM adventure_npcs').get().n,
    quests: db.prepare('SELECT COUNT(*) n FROM adventure_quests').get().n,
    sessions: db.prepare('SELECT COUNT(*) n FROM adventure_sessions').get().n,
  }
  async function post(route, body) {
    const response = await fetch(`${api}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }

  const invalidPreviewInput = await post('/ai/world/save', { previewToken: 'invalid-token-long-enough-to-be-rejected-as-unknown' })
  assert.equal(invalidPreviewInput.status, 404)
  assert.equal((await post('/ai/world/save', { previewToken: 'A'.repeat(43), preview: previewFixture() })).status, 400)
  assert.deepEqual({
    campaigns: db.prepare('SELECT COUNT(*) n FROM campaigns').get().n,
    adventures: db.prepare('SELECT COUNT(*) n FROM adventures').get().n,
  }, { campaigns: previous.campaigns, adventures: previous.adventures })

  const generated = await post('/ai/world/preview', requestBody())
  assert.equal(generated.status, 200, JSON.stringify(generated.body))
  assert.match(generated.body.previewToken, /^[A-Za-z0-9_-]{40,60}$/)
  assert.ok(generated.body.metadata.expiresAt)
  assert.equal(generationCalls, 1)
  assert.deepEqual({
    campaigns: db.prepare('SELECT COUNT(*) n FROM campaigns').get().n,
    adventures: db.prepare('SELECT COUNT(*) n FROM adventures').get().n,
  }, { campaigns: previous.campaigns, adventures: previous.adventures })

  const saveRequests = await Promise.all([
    post('/ai/world/save', { previewToken: generated.body.previewToken }),
    post('/ai/world/save', { previewToken: generated.body.previewToken }),
  ])
  assert.deepEqual(saveRequests.map((result) => result.status).sort(), [200, 201])
  const first = saveRequests.find((result) => result.status === 201).body
  const replay = saveRequests.find((result) => result.status === 200).body
  assert.equal(first.campaign.name, 'The Bell Beneath the Fen')
  assert.equal(first.adventure.startingLocation, 'Morrowfen Causeway')
  assert.equal(first.metadata.replayed, false)
  assert.equal(replay.campaign.id, first.campaign.id)
  assert.equal(replay.adventure.id, first.adventure.id)
  assert.equal(replay.metadata.replayed, true)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM campaigns').get().n, previous.campaigns + 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM adventures').get().n, previous.adventures + 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM adventure_locations WHERE adventureId=?').get(first.adventure.id).n, 3)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM adventure_npcs WHERE adventureId=?').get(first.adventure.id).n, 3)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM adventure_quests WHERE adventureId=?').get(first.adventure.id).n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM adventure_objectives WHERE questId=?').get(first.referenceMap.mainQuest).n, 3)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM adventure_sessions WHERE adventureId=?').get(first.adventure.id).n, 0)
  assert.equal(db.prepare('SELECT name FROM campaigns WHERE id=?').get('kept-campaign').name, 'The Ashen Crown')
  assert.equal(db.prepare('SELECT title FROM adventures WHERE id=?').get('kept-adventure').title, 'The Whispering Flask')

  const loaded = await fetch(`${api}/campaigns/${first.campaign.id}/adventures/${first.adventure.id}`)
  assert.equal(loaded.status, 200)
  const adventure = await loaded.json()
  assert.equal(adventure.openingScenes.length, 1)
  assert.equal(adventure.openingScenes[0].title, 'A Toll Through the Rain')
  assert.equal(adventure.openingScenes[0].locationName, 'Morrowfen Causeway')
  assert.equal(adventure.openingScenes[0].questTitle, 'Answer the Drowned Bell')
  assert.deepEqual(adventure.quests[0].locations.map((location) => location.name).sort(), ['Morrowfen Causeway', 'Old Ferry House', 'Sunken Chapel'].sort())
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  db.close()
})

test('world preview and persistence loopback helper rejects non-loopback clients', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('192.0.2.25'), false)
})
