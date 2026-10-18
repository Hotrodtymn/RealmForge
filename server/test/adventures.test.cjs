const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('adventures, locations, NPCs, quests, objectives, and story state are scoped and persistent', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-adventures-'))
  let server
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) })
  })
  const base = `http://127.0.0.1:${port}/api`
  t.after(async () => { await stopServer(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  function startServer() {
    server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore',
    })
  }
  async function stopServer() {
    if (!server || server.exitCode !== null) return
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
    server = undefined
  }
  async function waitForServer() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (server.exitCode !== null) throw new Error(`Server exited with ${server.exitCode}`)
      try { if ((await fetch(`${base}/health`)).ok) return } catch {}
      await delay(100)
    }
    throw new Error('Server did not become ready')
  }
  async function request(route, method = 'GET', body) {
    const response = await fetch(`${base}${route}`, {
      method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  startServer(); await waitForServer()
  const campaign = await request('/campaigns', 'POST', { name: 'Adventure campaign' })
  const campaignId = campaign.body.campaign.id
  const otherCampaign = await request('/campaigns', 'POST', { name: 'Separate realm' })
  const otherId = otherCampaign.body.campaign.id
  const adventuresPath = `/campaigns/${campaignId}/adventures`
  assert.equal((await request('/campaigns/missing/adventures')).status, 404)
  assert.equal((await request(`${adventuresPath}`, 'POST', { title: '  ' })).status, 400)
  const created = await request(adventuresPath, 'POST', { title: 'Ashen Road', description: 'A road through the old pines', startingLocation: 'Morrowfen' })
  assert.equal(created.status, 201)
  const adventureId = created.body.adventure.id
  assert.equal((await request(`/campaigns/${otherId}/adventures/${adventureId}`)).status, 404)
  assert.equal((await request(`${adventuresPath}/${adventureId}`, 'PUT', { title: 'Ashen Road II', status: 'invalid' })).status, 400)
  const updated = await request(`${adventuresPath}/${adventureId}`, 'PUT', { title: 'Ashen Road', description: 'A road through the old pines', startingLocation: 'Morrowfen', status: 'active' })
  assert.equal(updated.body.adventure.status, 'active')

  const root = `${adventuresPath}/${adventureId}`
  const locationsPath = `${root}/locations`
  assert.equal((await request(locationsPath, 'POST', { name: '' })).status, 400)
  const village = await request(locationsPath, 'POST', { name: 'Morrowfen', locationType: 'Village', dmNotes: 'The mayor is hiding a map.' })
  const forest = await request(locationsPath, 'POST', { name: 'Old Pines', locationType: 'Wilderness' })
  assert.equal(village.status, 201); assert.equal(forest.status, 201)
  const fromId = village.body.location.id; const toId = forest.body.location.id
  assert.equal((await request(`${locationsPath}/${fromId}`)).body.location.name, 'Morrowfen')
  assert.equal((await request(`${locationsPath}/foreign-location`)).status, 404)
  assert.equal((await request(`${root}/locations/connections`, 'POST', { fromLocationId: fromId, toLocationId: 'foreign' })).status, 404)
  assert.equal((await request(`${root}/locations/connections`, 'POST', { fromLocationId: fromId, toLocationId: fromId })).status, 400)
  assert.equal((await request(`${root}/locations/connections`, 'POST', { fromLocationId: fromId, toLocationId: toId })).status, 201)
  assert.equal((await request(`${root}/locations/connections`, 'POST', { fromLocationId: fromId, toLocationId: toId })).status, 409)
  assert.equal((await request(`${root}/locations/connections`, 'POST', { fromLocationId: toId, toLocationId: fromId })).status, 409)
  assert.equal((await request(`${locationsPath}/${toId}`, 'PUT', { name: 'Pinewood', description: 'A thick forest', locationType: 'Forest', dmNotes: '' })).body.location.name, 'Pinewood')

  const npcsPath = `${root}/npcs`
  assert.equal((await request(npcsPath, 'POST', { name: 'Invalid', currentLocationId: 'foreign-location' })).status, 404)
  const npc = await request(npcsPath, 'POST', { name: 'Edda Vale', personality: 'Watchful ferryman', disposition: 'Wary', currentLocationId: fromId, dmNotes: 'Knows the hidden route.' })
  assert.equal(npc.status, 201)
  assert.equal((await request(`${npcsPath}/${npc.body.npc.id}`)).body.npc.name, 'Edda Vale')
  const updatedNpc = await request(`${npcsPath}/${npc.body.npc.id}`, 'PUT', { name: 'Edda Vale', description: 'Runs the ferry', personality: 'Watchful', disposition: 'Friendly', currentLocationId: toId, dmNotes: '' })
  assert.equal(updatedNpc.body.npc.currentLocationId, toId, JSON.stringify({ fromId, toId, npc: updatedNpc.body.npc }))

  const questsPath = `${root}/quests`
  const quest = await request(questsPath, 'POST', { title: 'Find the missing caravan', description: 'Search the forest.' })
  assert.equal(quest.status, 201)
  const questId = quest.body.quest.id
  assert.equal((await request(`${questsPath}/${questId}`, 'PUT', { title: 'Find the missing caravan', status: 'active' })).body.quest.status, 'active')
  const objective = await request(`${questsPath}/${questId}/objectives`, 'POST', { description: 'Question the ferryman', sortOrder: 0 })
  assert.equal(objective.status, 201)
  const objectivePath = `${questsPath}/${questId}/objectives/${objective.body.objective.id}`
  assert.equal((await request(objectivePath, 'PUT', { completed: true })).body.objective.completed, 1)
  assert.equal((await request(objectivePath, 'PUT', { completed: false })).body.objective.completed, 0)
  assert.equal((await request(`${questsPath}/foreign/objectives/${objective.body.objective.id}`, 'PUT', { completed: true })).status, 404)

  assert.equal((await request(`${root}/story/flags/not valid`, 'PUT', { value: true })).status, 400)
  assert.equal((await request(`${root}/story/flags/found_hidden_passage`, 'PUT', { value: { nested: { too: { deeply: { buried: { unsafe: true } } } } } })).status, 400)
  assert.equal((await request(`${root}/story/flags/found_hidden_passage`, 'PUT', { value: true })).body.flag.value, true)
  assert.equal((await request(`${root}/story/flags/found_hidden_passage`, 'PUT', { value: { discovered: true, clueCount: 2 } })).body.flag.value.clueCount, 2)
  assert.equal((await request(`${root}/story/notes`, 'POST', { content: 'The caravan left signs in the mud.' })).status, 201)
  assert.equal((await request(`${root}/story/notes`, 'POST', { content: '  ' })).status, 400)

  const edited = await request(`${adventuresPath}/${adventureId}`, 'PUT', { title: 'The Ashen Road', description: 'The mystery deepens', status: 'active', startingLocation: 'Morrowfen' })
  await stopServer(); startServer(); await waitForServer()
  const reopened = await request(`${adventuresPath}/${adventureId}`)
  assert.equal(reopened.body.adventure.title, edited.body.adventure.title)
  assert.equal(reopened.body.locations.find((location) => location.id === fromId).connections[0].name, 'Pinewood')
  assert.equal(reopened.body.locations.find((location) => location.id === fromId).dmNotes, 'The mayor is hiding a map.')
  assert.equal(reopened.body.npcs.find((entry) => entry.id === npc.body.npc.id).currentLocationId, toId)
  assert.equal(reopened.body.quests.find((entry) => entry.id === questId).objectives[0].completed, 0)
  assert.deepEqual(reopened.body.storyFlags[0].value, { discovered: true, clueCount: 2 })
  assert.equal(reopened.body.storyNotes[0].content, 'The caravan left signs in the mud.')
  assert.equal((await request(`/campaigns/${otherId}/adventures`)).body.adventures.length, 0)
})
