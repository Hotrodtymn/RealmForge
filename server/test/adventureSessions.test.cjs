const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const { DatabaseSync } = require('node:sqlite')
const test = require('node:test')
const assert = require('node:assert/strict')
const uuid = () => require('node:crypto').randomUUID()

test('session lifecycle, scenes, decisions, journal, context, integrity, and restart persistence', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-session-'))
  const clientDist = path.join(dataDir, 'client-dist')
  fs.mkdirSync(clientDist, { recursive: true })
  fs.writeFileSync(path.join(clientDist, 'index.html'), '<!doctype html><title>RealmForge test client</title>')
  fs.writeFileSync(path.join(clientDist, 'sample.js'), 'window.realmForgeTest = true')
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
      cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir, REALMFORGE_CLIENT_DIST: clientDist }, stdio: 'ignore',
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
  async function campaign(name) {
    const result = await request('/campaigns', 'POST', { name })
    assert.equal(result.status, 201)
    return result.body.campaign.id
  }
  async function character(campaignId, playerName, name) {
    const player = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName: playerName })
    assert.equal(player.status, 201)
    const result = await request(`/campaigns/${campaignId}/players/${player.body.player.playerId}/characters`, 'POST', {
      name, species: 'Human', class: 'Ranger', abilityScores: { str: 12, dex: 14, con: 12, int: 10, wis: 15, cha: 10 },
    })
    assert.equal(result.status, 201)
    return result.body.character
  }

  startServer(); await waitForServer()
  const clientRoot = await fetch(base.replace(/\/api$/, '/'))
  assert.match(await clientRoot.text(), /RealmForge test client/)
  const clientRefresh = await fetch(base.replace(/\/api$/, '/solo/adventure/session'))
  assert.match(await clientRefresh.text(), /RealmForge test client/)
  const staticAsset = await fetch(base.replace(/\/api$/, '/sample.js'))
  assert.match(await staticAsset.text(), /realmForgeTest/)
  const unknownApi = await request('/missing-api')
  assert.equal(unknownApi.status, 404)
  assert.equal(unknownApi.body.error, 'Not found')
  const deniedOrigin = await fetch(`${base}/health`, { headers: { Origin: 'https://untrusted.example' } })
  assert.equal(deniedOrigin.status, 200)
  assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null)
  const localOrigin = await fetch(`${base}/health`, { headers: { Origin: 'http://localhost:5173' } })
  assert.equal(localOrigin.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  const campaignId = await campaign('Session campaign')
  const otherCampaignId = await campaign('Other campaign')
  const hero = await character(campaignId, 'Nia', 'Nia Ashford')
  const foreignHero = await character(otherCampaignId, 'Orren', 'Orren Vale')
  const adventureResult = await request(`/campaigns/${campaignId}/adventures`, 'POST', { title: 'The Long Road', description: 'A caravan has vanished.', startingLocation: 'Crossroads' })
  const adventureId = adventureResult.body.adventure.id
  const otherAdventure = await request(`/campaigns/${otherCampaignId}/adventures`, 'POST', { title: 'Other tale' })
  const foreignLocation = await request(`/campaigns/${otherCampaignId}/adventures/${otherAdventure.body.adventure.id}/locations`, 'POST', { name: 'Far Realm' })
  const secondHero = await character(campaignId, 'Tamsin', 'Tamsin Reed')
  const locations = `/campaigns/${campaignId}/adventures/${adventureId}/locations`
  const crossroads = await request(locations, 'POST', { name: 'Crossroads', locationType: 'Roadside' })
  const oldRoad = await request(locations, 'POST', { name: 'Old Road', locationType: 'Road' })
  const cliff = await request(locations, 'POST', { name: 'Black Cliff', locationType: 'Cliff' })
  const crossroadsId = crossroads.body.location.id, oldRoadId = oldRoad.body.location.id, cliffId = cliff.body.location.id
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/locations/connections`, 'POST', { fromLocationId: crossroadsId, toLocationId: oldRoadId })
  const npcVisible = await request(`/campaigns/${campaignId}/adventures/${adventureId}/npcs`, 'POST', { name: 'Mira', description: 'A tired scout.', personality: 'Cautious', currentLocationId: crossroadsId, dmNotes: 'Secret: works for the duke.' })
  const npcElsewhere = await request(`/campaigns/${campaignId}/adventures/${adventureId}/npcs`, 'POST', { name: 'Rook', currentLocationId: oldRoadId, dmNotes: 'Should stay private too.' })
  const activeQuest = await request(`/campaigns/${campaignId}/adventures/${adventureId}/quests`, 'POST', { title: 'Find the caravan', status: 'active' })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/quests`, 'POST', { title: 'Talk to the miller', status: 'available' })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/story/flags/public_caravan_found`, 'PUT', { value: true })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/story/flags/secret_passage`, 'PUT', { value: { discovered: true } })
  await request(`/campaigns/${campaignId}/adventures/${adventureId}/story/notes`, 'POST', { content: 'Private DM story note.' })

  const playerView = await request(`/campaigns/${campaignId}/adventures/${adventureId}/player-view`)
  assert.equal(playerView.status, 200)
  assert.deepEqual(Object.keys(playerView.body.locations[0]).sort(), ['connections', 'description', 'id', 'locationType', 'name'].sort())
  assert.equal(JSON.stringify(playerView.body).includes('dmNotes'), false)
  assert.equal(JSON.stringify(playerView.body).includes('Secret: works for the duke.'), false)
  assert.equal(JSON.stringify(playerView.body).includes('Private DM story note.'), false)
  assert.equal((await request(`/campaigns/${otherCampaignId}/adventures/${adventureId}/player-view`)).status, 404)

  const sessionsPath = `/campaigns/${campaignId}/adventures/${adventureId}/sessions`
  assert.equal((await request(sessionsPath, 'POST', { characterId: hero.id })).status, 400)
  assert.equal((await request(sessionsPath, 'POST', { requestId: uuid(), characterId: foreignHero.id })).status, 404)
  assert.equal((await request(`/campaigns/${campaignId}/adventures/${otherAdventure.body.adventure.id}/sessions`, 'POST', { requestId: uuid(), characterId: hero.id })).status, 404)
  assert.equal((await request(sessionsPath, 'POST', { requestId: uuid(), characterId: hero.id, locationId: foreignLocation.body.location.id })).status, 404)
  const startKey = uuid()
  const started = await request(sessionsPath, 'POST', { requestId: startKey, characterId: hero.id })
  assert.equal(started.status, 201)
  const sessionId = started.body.session.id
  const openingScene = started.body.scenes[0]
  assert.equal(openingScene.locationId, crossroadsId)
  assert.equal(openingScene.sequence, 1)
  assert.equal(openingScene.status, 'current')
  const repeatedStart = await request(sessionsPath, 'POST', { requestId: startKey, characterId: hero.id })
  assert.equal(repeatedStart.status, 200)
  assert.equal(repeatedStart.body.session.id, sessionId)
  assert.equal((await request(sessionsPath, 'POST', { requestId: startKey, characterId: secondHero.id })).status, 409)
  assert.equal((await request(sessionsPath, 'POST', { requestId: uuid(), characterId: hero.id })).status, 409)

  const sessionPath = `/campaigns/${campaignId}/sessions/${sessionId}`
  assert.equal((await request(`/campaigns/${otherCampaignId}/sessions/${sessionId}`)).status, 404)
  assert.equal((await request(`${sessionPath}/pause`, 'POST', { requestId: uuid() })).body.session.status, 'paused')
  assert.equal((await request(`${sessionPath}/pause`, 'POST', { requestId: uuid() })).status, 409)
  assert.equal((await request(`${sessionPath}/decisions`, 'POST', { requestId: uuid(), decisionText: 'Wait' })).status, 409)
  assert.equal((await request(`${sessionPath}/resume`, 'POST', { requestId: uuid() })).body.session.status, 'active')
  assert.equal((await request(`${sessionPath}/resume`, 'POST', { requestId: uuid() })).status, 409)

  const badDestination = await request(`${sessionPath}/scenes`, 'POST', { requestId: uuid(), title: 'At the cliff', locationId: cliffId })
  assert.equal(badDestination.status, 409)
  assert.equal(badDestination.body.requiresOverride, true)
  assert.equal((await request(`${sessionPath}/scenes`, 'POST', { requestId: uuid(), title: 'Elsewhere', locationId: foreignLocation.body.location.id, dmOverride: true, overrideReason: 'Teleport' })).status, 404)
  const transitionKey = uuid()
  const transitionBody = { requestId: transitionKey, title: 'Along the Old Road', description: 'Mira points toward the trees.', locationId: oldRoadId }
  const transitioned = await request(`${sessionPath}/scenes`, 'POST', transitionBody)
  assert.equal(transitioned.status, 200)
  assert.equal(transitioned.body.scenes.length, 2)
  assert.equal(transitioned.body.scenes[0].status, 'completed')
  assert.equal(transitioned.body.scenes[1].status, 'current')
  assert.equal(transitioned.body.session.currentLocationId, oldRoadId)
  const replayTransition = await request(`${sessionPath}/scenes`, 'POST', transitionBody)
  assert.equal(replayTransition.body.replayed, true)
  assert.equal(replayTransition.body.scenes.length, 2)
  assert.equal((await request(`${sessionPath}/scenes`, 'POST', { ...transitionBody, title: 'Different request with same key' })).status, 409)

  const dbPath = path.join(dataDir, 'realmforge.sqlite')
  const rawDb = new DatabaseSync(dbPath)
  rawDb.exec(`CREATE TRIGGER force_transition_failure BEFORE INSERT ON adventure_session_journal
    WHEN NEW.eventType='scene_entered' AND NEW.details LIKE '%Rollback Probe%'
    BEGIN SELECT RAISE(ABORT,'forced transition rollback'); END`)
  const beforeFailure = await request(sessionPath)
  const failedTransition = await request(`${sessionPath}/scenes`, 'POST', { requestId: uuid(), title: 'Rollback Probe', locationId: crossroadsId })
  assert.equal(failedTransition.status, 500)
  const afterFailure = await request(sessionPath)
  assert.equal(afterFailure.body.session.currentSceneId, beforeFailure.body.session.currentSceneId)
  assert.equal(afterFailure.body.scenes.length, beforeFailure.body.scenes.length)
  rawDb.exec('DROP TRIGGER force_transition_failure')
  rawDb.close()

  const specialTransition = await request(`${sessionPath}/scenes`, 'POST', { requestId: uuid(), title: 'The Black Cliff', locationId: cliffId, dmOverride: true, overrideReason: 'A teleportation spell bypassed the road.' })
  assert.equal(specialTransition.status, 200)
  assert.equal(specialTransition.body.session.currentLocationId, cliffId)
  const noReason = await request(`${sessionPath}/scenes`, 'POST', { requestId: uuid(), title: 'No reason', locationId: oldRoadId, dmOverride: true })
  assert.equal(noReason.status, 400)

  const decisionKey = uuid()
  const decisionBody = { requestId: decisionKey, decisionText: '  I warn the village before moving on.  ', category: 'Protective choice' }
  const decision = await request(`${sessionPath}/decisions`, 'POST', decisionBody)
  assert.equal(decision.status, 201)
  assert.equal(decision.body.decision.characterId, hero.id)
  assert.equal(decision.body.decision.sceneId, specialTransition.body.session.currentSceneId)
  assert.equal((await request(`${sessionPath}/decisions`, 'POST', decisionBody)).status, 200)
  assert.equal((await request(`${sessionPath}/decisions`, 'POST', { ...decisionBody, decisionText: 'Changed decision' })).status, 409)
  assert.equal((await request(`${sessionPath}/scenes/${openingScene.id}/decisions`)).body.decisions.length, 0)
  assert.equal((await request(`${sessionPath}/scenes/${specialTransition.body.session.currentSceneId}/decisions`)).body.decisions[0].decisionText, decisionBody.decisionText)
  const secondSession = await request(sessionsPath, 'POST', { requestId: uuid(), characterId: secondHero.id, locationId: crossroadsId })
  assert.equal(secondSession.status, 201)
  const secondSessionPath = `/campaigns/${campaignId}/sessions/${secondSession.body.session.id}`
  assert.equal((await request(`${secondSessionPath}/scenes/${specialTransition.body.session.currentSceneId}/decisions`)).status, 404)

  for (let index = 0; index < 12; index += 1) {
    const response = await request(`${sessionPath}/decisions`, 'POST', { requestId: uuid(), decisionText: `Choice ${index}` })
    assert.equal(response.status, 201)
  }
  const contextResponse = await request(`${sessionPath}/context`)
  assert.equal(contextResponse.status, 200)
  const context = contextResponse.body.context
  assert.equal(context.currentScene.id, specialTransition.body.session.currentSceneId)
  assert.equal(context.currentLocation.id, cliffId)
  assert.deepEqual(context.visibleNpcs, [])
  assert.deepEqual(context.activeQuests.map((entry) => entry.id), [activeQuest.body.quest.id])
  assert.deepEqual(context.publicStoryFlags.map((flag) => flag.name), ['public_caravan_found'])
  assert.equal(context.recentPlayerDecisions.length, 10)
  assert.ok(context.recentJournalEvents.length <= 20)
  assert.equal(JSON.stringify(context).includes('Secret: works for the duke.'), false)
  assert.equal(JSON.stringify(context).includes('Private DM story note.'), false)
  assert.equal(JSON.stringify(context).includes('secret_passage'), false)
  assert.equal(JSON.stringify(context).includes('A teleportation spell bypassed the road.'), false)
  assert.equal(context.scenes.length, 3)
  assert.ok(context.connectedLocations.every((place) => !Object.hasOwn(place, 'dmNotes')))
  assert.equal(JSON.stringify(context).includes('overrideReason'), false)

  // Return to the opening location; scoped visibility includes only NPCs there.
  const returnMove = await request(`${sessionPath}/scenes`, 'POST', { requestId: uuid(), title: 'Back at Crossroads', locationId: crossroadsId, dmOverride: true, overrideReason: 'Narrative return to town.' })
  assert.equal(returnMove.status, 200)
  const townContext = (await request(`${sessionPath}/context`)).body.context
  assert.deepEqual(townContext.visibleNpcs.map((entry) => entry.id), [npcVisible.body.npc.id])
  assert.equal(JSON.stringify(townContext).includes('Secret: works for the duke.'), false)

  const completeKey = uuid()
  const completed = await request(`${sessionPath}/complete`, 'POST', { requestId: completeKey })
  assert.equal(completed.body.session.status, 'completed')
  assert.ok(completed.body.session.completedAt)
  assert.equal(completed.body.scenes.at(-1).status, 'completed')
  assert.equal((await request(`${sessionPath}/complete`, 'POST', { requestId: completeKey })).body.replayed, true)
  assert.equal((await request(`${sessionPath}/pause`, 'POST', { requestId: uuid() })).status, 409)
  const newSession = await request(sessionsPath, 'POST', { requestId: uuid(), characterId: hero.id, locationId: crossroadsId })
  assert.equal(newSession.status, 201)

  await stopServer(); startServer(); await waitForServer()
  const persisted = await request(sessionPath)
  assert.equal(persisted.body.session.status, 'completed')
  assert.equal(persisted.body.decisions.length, 13)
  assert.equal(persisted.body.journal.length > 20, true)
  assert.equal(persisted.body.scenes.length, completed.body.scenes.length)
  assert.deepEqual(persisted.body.journal.map((entry) => entry.sequence), persisted.body.journal.map((_, index) => index + 1))
  await stopServer()
  const auditDb = new DatabaseSync(dbPath)
  assert.throws(() => auditDb.prepare('UPDATE adventure_session_journal SET details=? WHERE sessionId=?').run('{}', sessionId), /immutable/)
  assert.throws(() => auditDb.prepare('DELETE FROM adventure_session_journal WHERE sessionId=?').run(sessionId), /cannot be deleted/)
  assert.throws(() => auditDb.prepare('UPDATE adventure_session_decisions SET decisionText=? WHERE sessionId=?').run('rewritten', sessionId), /immutable/)
  auditDb.close()
})
