const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('combat encounters validate scope, manage initiative and turns, and persist state on restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-combat-'))
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
    if (route.endsWith('/next-turn') && method === 'POST' && body === undefined) body = { actionId: require('node:crypto').randomUUID() }
    const response = await fetch(`${base}${route}`, {
      method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  async function makeCharacter(campaignId, playerName, characterName, dex) {
    const player = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName: playerName })
    assert.equal(player.status, 201)
    const result = await request(`/campaigns/${campaignId}/players/${player.body.player.playerId}/characters`, 'POST', {
      name: characterName, species: 'Human', class: 'Rogue', abilityScores: { str: 10, dex, con: 10, int: 10, wis: 10, cha: 10 },
    })
    assert.equal(result.status, 201)
    return { playerId: player.body.player.playerId, character: result.body.character }
  }

  startServer()
  await waitForServer()
  const campaign = await request('/campaigns', 'POST', { name: 'Combat test', description: '', setting: '' })
  const campaignId = campaign.body.campaign.id
  const otherCampaign = await request('/campaigns', 'POST', { name: 'Other campaign', description: '', setting: '' })
  const { character } = await makeCharacter(campaignId, 'Mara', 'Mara Flint', 14)
  const { character: otherCharacter } = await makeCharacter(otherCampaign.body.campaign.id, 'Other', 'Other Hero', 10)
  const encounterPath = `/campaigns/${campaignId}/encounters`

  assert.equal((await request(encounterPath, 'POST', { name: '   ' })).status, 400)
  assert.equal((await request('/campaigns/missing/encounters', 'POST', { name: 'Nowhere' })).status, 404)
  const created = await request(encounterPath, 'POST', { name: 'The Broken Gate' })
  assert.equal(created.status, 201)
  const encounterId = created.body.encounter.id
  assert.equal(created.body.encounter.round, 0)
  assert.equal((await request(`/campaigns/${otherCampaign.body.campaign.id}/encounters/${encounterId}`)).status, 404)
  assert.equal((await request(`${encounterPath}/${encounterId}/start`, 'POST')).status, 409)

  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/players`, 'POST', { characterId: character.id, currentHp: 2, maxHp: 0 })).status, 400)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/players`, 'POST', { characterId: character.id, currentHp: 11, maxHp: 10 })).status, 400)
  const addedPlayer = await request(`${encounterPath}/${encounterId}/combatants/players`, 'POST', { characterId: character.id, name: 'Spoofed name' })
  assert.equal(addedPlayer.status, 201)
  const playerCombatant = addedPlayer.body.combatants[0]
  assert.equal(playerCombatant.characterId, character.id)
  assert.equal(playerCombatant.name, 'Mara Flint')
  assert.equal(playerCombatant.initiativeModifier, 2)
  assert.equal(playerCombatant.currentHp, 1)
  assert.equal(playerCombatant.maxHp, 1)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/players`, 'POST', { characterId: character.id })).status, 409)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/players`, 'POST', { characterId: otherCharacter.id })).status, 404)

  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/enemies`, 'POST', { name: 'Invalid AC', armorClassOverride: 0 })).status, 400)
  const enemyResult = await request(`${encounterPath}/${encounterId}/combatants/enemies`, 'POST', { name: 'Goblin scout', initiativeModifier: -1, currentHp: 8, maxHp: 10, armorClassOverride: 15, attackModifier: 4 })
  assert.equal(enemyResult.status, 201)
  const enemy = enemyResult.body.combatants.find((combatant) => combatant.type === 'enemy')
  assert.equal(enemy.initiativeModifier, -1)
  assert.equal(enemy.currentHp, 8)
  assert.equal(enemy.maxHp, 10)
  assert.equal(enemy.armorClassOverride, 15)
  assert.equal(enemy.attackModifier, 4)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/enemies`, 'POST', { name: 'Bad', initiativeModifier: 1.5 })).status, 400)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/enemies`, 'POST', { name: '   ' })).status, 400)

  const rolledPlayer = await request(`${encounterPath}/${encounterId}/combatants/${playerCombatant.id}/initiative`, 'PUT', { source: 'rolled', roll: 17 })
  assert.equal(rolledPlayer.status, 200)
  assert.equal(rolledPlayer.body.combatants.find((entry) => entry.id === playerCombatant.id).initiativeTotal, 19)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/${playerCombatant.id}/initiative`, 'PUT', { source: 'rolled', roll: 21 })).status, 400)
  const rolledEnemy = await request(`${encounterPath}/${encounterId}/combatants/${enemy.id}/initiative`, 'PUT', { source: 'rolled', roll: 20 })
  assert.equal(rolledEnemy.body.combatants.find((entry) => entry.id === enemy.id).initiativeTotal, 19)
  assert.equal(rolledEnemy.body.combatants.find((entry) => entry.id === enemy.id).initiativeSource, 'rolled')

  const thirdEnemy = await request(`${encounterPath}/${encounterId}/combatants/enemies`, 'POST', { name: 'Ogre', initiativeModifier: 0 })
  const ogre = thirdEnemy.body.combatants.find((entry) => entry.name === 'Ogre')
  const manual = await request(`${encounterPath}/${encounterId}/combatants/${ogre.id}/initiative`, 'PUT', { source: 'manual', total: 5 })
  const manualOgre = manual.body.combatants.find((entry) => entry.id === ogre.id)
  assert.equal(manualOgre.initiativeSource, 'manual')
  assert.equal(manualOgre.initiativeRoll, null)
  assert.equal(manualOgre.initiativeTotal, 5)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/${ogre.id}/initiative`, 'PUT', { source: 'manual', total: 2.2 })).status, 400)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/${ogre.id}/initiative`, 'PUT', { source: 'manual', total: 1001 })).status, 400)

  const sorted = (await request(`${encounterPath}/${encounterId}`)).body.combatants
  assert.deepEqual(sorted.map((entry) => entry.id), [playerCombatant.id, enemy.id, ogre.id])
  assert.equal((await request(`${encounterPath}/${encounterId}/start`, 'POST')).body.encounter.activeCombatantId, playerCombatant.id)
  assert.equal((await request(`${encounterPath}/${encounterId}/next-turn`, 'POST')).body.encounter.activeCombatantId, enemy.id)
  assert.equal((await request(`${encounterPath}/${encounterId}/next-turn`, 'POST')).body.encounter.activeCombatantId, ogre.id)
  const wrapped = await request(`${encounterPath}/${encounterId}/next-turn`, 'POST')
  assert.equal(wrapped.body.encounter.activeCombatantId, playerCombatant.id)
  assert.equal(wrapped.body.encounter.round, 2)
  assert.equal((await request(`${encounterPath}/${encounterId}/start`, 'POST')).status, 409)

  const playerHpPath = `${encounterPath}/${encounterId}/combatants/${playerCombatant.id}`
  assert.equal((await request(`${playerHpPath}/damage`, 'POST', { amount: 1.5 })).status, 400)
  assert.equal((await request(`${playerHpPath}/damage`, 'POST', { amount: 0 })).status, 400)
  assert.equal((await request(`${playerHpPath}/hit-points`, 'PUT', { currentHp: 5, maxHp: -1 })).status, 400)
  assert.equal((await request(`${playerHpPath}/hit-points`, 'PUT', { currentHp: 5.5, maxHp: 8 })).status, 400)
  assert.equal((await request(`${playerHpPath}/hit-points`, 'PUT', { currentHp: 9, maxHp: 8 })).status, 400)
  assert.equal((await request(`${playerHpPath}/hit-points`, 'PUT', { currentHp: 2, maxHp: 8 })).status, 200)
  const reducedToZero = await request(`${playerHpPath}/damage`, 'POST', { amount: 3 })
  assert.equal(reducedToZero.body.combatants.find((entry) => entry.id === playerCombatant.id).currentHp, 0)
  assert.ok(reducedToZero.body.combatants.find((entry) => entry.id === playerCombatant.id).conditions.some((condition) => condition.condition === 'unconscious'))
  let changedHp = await request(`${playerHpPath}/heal`, 'POST', { amount: 20 })
  assert.equal(changedHp.status, 200, JSON.stringify(changedHp.body))
  assert.equal(changedHp.body.combatants.find((entry) => entry.id === playerCombatant.id).currentHp, 8)
  changedHp = await request(`${playerHpPath}/hit-points`, 'PUT', { currentHp: 12, maxHp: 15 })
  assert.equal(changedHp.status, 200)
  assert.equal(changedHp.body.combatants.find((entry) => entry.id === playerCombatant.id).maxHp, 15)
  const hpSet = await request(`${playerHpPath}/damage`, 'POST', { amount: 2 })
  assert.equal(hpSet.body.combatants.find((entry) => entry.id === playerCombatant.id).currentHp, 10)
  assert.equal(hpSet.body.encounter.activeCombatantId, playerCombatant.id)
  assert.equal(hpSet.body.encounter.round, 2)
  assert.equal((await request(`${encounterPath}/${encounterId}/combatants/${playerCombatant.id}/combat-stats`, 'PUT', { armorClassOverride: 15, attackModifier: 5 })).status, 400)
  const enemyStats = await request(`${encounterPath}/${encounterId}/combatants/${enemy.id}/combat-stats`, 'PUT', { armorClassOverride: 18, attackModifier: -2 })
  assert.equal(enemyStats.status, 200)
  assert.equal(enemyStats.body.combatants.find((entry) => entry.id === enemy.id).armorClassOverride, 18)
  assert.equal(enemyStats.body.combatants.find((entry) => entry.id === enemy.id).attackModifier, -2)
  assert.equal(enemyStats.body.encounter.activeCombatantId, playerCombatant.id)

  assert.equal((await request(`${playerHpPath}/conditions`, 'POST', { condition: 'unlisted' })).status, 400)
  assert.equal((await request(`${playerHpPath}/conditions`, 'POST', { condition: 'exhaustion', level: 7 })).status, 400)
  assert.equal((await request(`${playerHpPath}/conditions`, 'POST', { condition: 'blinded', level: 2 })).status, 400)
  let conditionResult = await request(`${playerHpPath}/conditions`, 'POST', { condition: 'blinded' })
  assert.equal(conditionResult.status, 200)
  assert.equal((await request(`${playerHpPath}/conditions`, 'POST', { condition: 'blinded' })).status, 409)
  conditionResult = await request(`${playerHpPath}/conditions`, 'POST', { condition: 'exhaustion', level: 2 })
  conditionResult = await request(`${playerHpPath}/conditions`, 'POST', { condition: 'exhaustion', level: 5 })
  const playerConditions = conditionResult.body.combatants.find((entry) => entry.id === playerCombatant.id).conditions
  assert.equal(playerConditions.filter((entry) => entry.condition === 'exhaustion').length, 1)
  assert.equal(playerConditions.find((entry) => entry.condition === 'exhaustion').level, 5)
  assert.equal((await request(`${playerHpPath}/conditions/blinded`, 'DELETE')).status, 200)
  assert.equal((await request(`${playerHpPath}/conditions/blinded`, 'DELETE')).status, 404)
  const wrongEncounter = await request(encounterPath, 'POST', { name: 'Other room' })
  assert.equal((await request(`${encounterPath}/${wrongEncounter.body.encounter.id}/combatants/${playerCombatant.id}/conditions`, 'POST', { condition: 'stunned' })).status, 404)

  const manualEditDuringCombat = await request(`${encounterPath}/${encounterId}/combatants/${ogre.id}/initiative`, 'PUT', { source: 'manual', total: 22 })
  assert.equal(manualEditDuringCombat.body.encounter.activeCombatantId, playerCombatant.id)
  assert.equal(manualEditDuringCombat.body.encounter.round, 2)
  const persistedState = manualEditDuringCombat.body.encounter
  assert.equal((await request(`/campaigns/${otherCampaign.body.campaign.id}/encounters/${encounterId}`, 'DELETE')).status, 404)
  await stopServer()
  startServer()
  await waitForServer()
  const reopened = await request(`${encounterPath}/${encounterId}`)
  assert.deepEqual(reopened.body.encounter, persistedState)
  assert.equal(reopened.body.combatants.find((entry) => entry.id === playerCombatant.id).initiativeRoll, 17)
  assert.equal(reopened.body.combatants.find((entry) => entry.id === ogre.id).initiativeSource, 'manual')
  const reopenedPlayer = reopened.body.combatants.find((entry) => entry.id === playerCombatant.id)
  assert.equal(reopenedPlayer.currentHp, 10)
  assert.equal(reopenedPlayer.maxHp, 15)
  assert.equal(reopened.body.combatants.find((entry) => entry.id === enemy.id).armorClassOverride, 18)
  assert.equal(reopened.body.combatants.find((entry) => entry.id === enemy.id).attackModifier, -2)
  assert.equal(reopenedPlayer.conditions.some((entry) => entry.condition === 'blinded'), false)
  assert.equal(reopenedPlayer.conditions.find((entry) => entry.condition === 'exhaustion').level, 5)
  const reset = await request(`${encounterPath}/${encounterId}/reset`, 'POST')
  assert.equal(reset.body.encounter.status, 'setup')
  assert.equal(reset.body.encounter.round, 0)
  assert.ok(reset.body.combatants.every((entry) => entry.initiativeTotal !== null))
  const restartedEncounter = await request(`${encounterPath}/${encounterId}/start`, 'POST')
  assert.equal(restartedEncounter.body.encounter.activeCombatantId, ogre.id)
  const removal = await request(`${encounterPath}/${encounterId}/combatants/${ogre.id}`, 'DELETE')
  assert.equal(removal.body.encounter.status, 'setup')
  assert.equal(removal.body.encounter.activeCombatantId, null)

  const emptyEncounter = await request(encounterPath, 'POST', { name: 'Empty room' })
  assert.deepEqual(emptyEncounter.body.combatants, [])
  assert.equal((await request(`${encounterPath}/${emptyEncounter.body.encounter.id}/next-turn`, 'POST')).status, 409)
  const uninitialized = await request(`${encounterPath}/${emptyEncounter.body.encounter.id}/combatants/enemies`, 'POST', { name: 'Unready foe' })
  assert.equal(uninitialized.status, 201)
  assert.equal((await request(`${encounterPath}/${emptyEncounter.body.encounter.id}/start`, 'POST')).status, 409)
  const removed = await request(`${encounterPath}/${emptyEncounter.body.encounter.id}/combatants/${uninitialized.body.combatants[0].id}`, 'DELETE')
  assert.deepEqual(removed.body.combatants, [])

  assert.equal((await request(`${encounterPath}/${encounterId}`, 'PUT', { name: '   ' })).status, 400)
  assert.equal((await request(`${encounterPath}/${encounterId}`, 'PUT', { name: 'The Gate at Dawn' })).status, 200)
  assert.equal((await request(`${encounterPath}/${encounterId}`, 'DELETE')).status, 200)
  assert.equal((await request(`${encounterPath}/${encounterId}`)).status, 404)
  assert.equal((await request(`${encounterPath}/${emptyEncounter.body.encounter.id}`, 'DELETE')).status, 200)
})
