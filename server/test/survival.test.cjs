const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('survival API scopes actions, records explicit events, and persists state across restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-survival-'))
  const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) }) })
  const base = `http://127.0.0.1:${port}/api`
  let server
  const start = () => { server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore' }) }
  async function stop() { if (!server || server.exitCode !== null) return; const ended = once(server, 'exit'); server.kill('SIGTERM'); await ended; server = undefined }
  async function ready() { for (let n = 0; n < 80; n += 1) { if (server.exitCode !== null) throw new Error(`Server exited with ${server.exitCode}`); try { if ((await fetch(`${base}/health`)).ok) return } catch {} await delay(100) } throw new Error('Server did not become ready') }
  async function request(route, method = 'GET', body) { const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  start(); await ready()
  const campaign = (await request('/campaigns', 'POST', { name: 'Survival test', description: '', setting: '' })).body.campaign
  const player = (await request(`/campaigns/${campaign.id}/players`, 'POST', { displayName: 'Rook' })).body.player
  const characterResult = await request(`/campaigns/${campaign.id}/players/${player.playerId}/characters`, 'POST', { name: 'Rook', species: 'Human', class: 'Ranger', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } })
  assert.equal(characterResult.status, 201, JSON.stringify(characterResult.body))
  const character = characterResult.body.character
  const encounter = (await request(`/campaigns/${campaign.id}/encounters`, 'POST', { name: 'Ash vault' })).body.encounter
  const encounterPath = `/campaigns/${campaign.id}/encounters/${encounter.id}`
  const addedPc = await request(`${encounterPath}/combatants/players`, 'POST', { characterId: character.id, currentHp: 5, maxHp: 10 })
  assert.equal(addedPc.status, 201, JSON.stringify(addedPc.body))
  const pc = addedPc.body.combatants[0]
  const enemy = (await request(`${encounterPath}/combatants/enemies`, 'POST', { name: 'Wraith', currentHp: 8, maxHp: 8, attackModifier: 50, damageFormula: '1d4', damageType: 'necrotic' })).body.combatants.find((entry) => entry.type === 'enemy')

  assert.equal((await request(`${encounterPath}/combatants/${pc.id}/death-save`, 'POST', {})).status, 400)
  assert.equal((await request(`/campaigns/not-this-campaign/encounters/${encounter.id}/combatants/${pc.id}/survival`)).status, 404)
  assert.equal((await request(`${encounterPath}/combatants/${enemy.id}/death-save`, 'POST', { actionId: 'enemy-save-001' })).status, 400)

  const zeroed = await request(`${encounterPath}/combatants/${pc.id}/hit-points`, 'PUT', { currentHp: 0, maxHp: 10 })
  let tracked = zeroed.body.combatants.find((entry) => entry.id === pc.id)
  assert.equal(tracked.survivalStatus, 'unconscious')
  assert.ok(tracked.conditions.some((condition) => condition.condition === 'unconscious'))
  const stabilized = await request(`${encounterPath}/combatants/${pc.id}/stabilize`, 'POST', { actionId: 'stabilize-rook-001' })
  assert.equal(stabilized.status, 201)
  assert.equal(stabilized.body.state.status, 'stable')
  assert.equal((await request(`${encounterPath}/combatants/${pc.id}/stabilize`, 'POST', { actionId: 'stabilize-rook-001' })).status, 409)

  const healed = await request(`${encounterPath}/combatants/${pc.id}/heal`, 'POST', { amount: 4 })
  tracked = healed.body.combatants.find((entry) => entry.id === pc.id)
  assert.deepEqual([tracked.currentHp, tracked.deathSaveSuccesses, tracked.deathSaveFailures, tracked.survivalStatus], [4, 0, 0, 'conscious'])
  assert.ok(!tracked.conditions.some((condition) => condition.condition === 'unconscious'))
  const redowned = await request(`${encounterPath}/combatants/${pc.id}/damage`, 'POST', { amount: 4 })
  tracked = redowned.body.combatants.find((entry) => entry.id === pc.id)
  assert.equal(tracked.survivalStatus, 'unconscious')
  let criticalAttack
  for (let attempt = 0; attempt < 120 && !criticalAttack; attempt += 1) {
    const attack = await request(`${encounterPath}/attacks`, 'POST', { attackerId: enemy.id, targetId: pc.id })
    assert.equal(attack.status, 201, JSON.stringify(attack.body))
    if (attack.body.attack.isCritical) criticalAttack = attack.body.attack
  }
  assert.ok(criticalAttack, 'secure d20 attack eventually records a natural 20')
  const criticalDamageRoll = await request(`${encounterPath}/attacks/${criticalAttack.id}/damage`, 'POST')
  assert.equal(criticalDamageRoll.status, 201)
  assert.equal(criticalDamageRoll.body.damage.isCritical, true)
  const criticalDamageApply = await request(`${encounterPath}/damage/${criticalDamageRoll.body.damage.id}/apply`, 'POST')
  assert.equal(criticalDamageApply.status, 200)
  tracked = (await request(encounterPath)).body.combatants.find((entry) => entry.id === pc.id)
  assert.equal(tracked.deathSaveFailures, 2, 'critical damage at 0 HP causes two failures')

  assert.equal((await request(`${encounterPath}/combatants/${pc.id}/death-save`, 'POST', { actionId: 'death-save-rook-001', roll: 20 })).status, 400, 'clients cannot submit or choose death-save results')
  const rolled = await request(`${encounterPath}/combatants/${pc.id}/death-save`, 'POST', { actionId: 'death-save-rook-001' })
  assert.equal(rolled.status, 201)
  assert.ok(rolled.body.event.naturalRoll >= 1 && rolled.body.event.naturalRoll <= 20)
  assert.equal((await request(`${encounterPath}/combatants/${pc.id}/death-save`, 'POST', { actionId: 'death-save-rook-001' })).status, 409)
  const events = await request(`${encounterPath}/combatants/${pc.id}/survival`)
  assert.ok(events.body.events.some((entry) => entry.action === 'death_save'))

  await stop(); start(); await ready()
  const restored = (await request(encounterPath)).body.combatants.find((entry) => entry.id === pc.id)
  assert.equal(restored.currentHp, rolled.body.state.currentHp)
  assert.equal(restored.survivalStatus, rolled.body.state.status)
  assert.deepEqual([restored.deathSaveSuccesses, restored.deathSaveFailures], [rolled.body.state.successes, rolled.body.state.failures])
  assert.equal((await request(`${encounterPath}/combatants/${pc.id}/survival`)).body.events.length, events.body.events.length)
})
