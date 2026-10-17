const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('attacks validate ownership, derive trusted bonuses and AC, and persist immutable history without changing combat state', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-attacks-'))
  let server
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) })
  })
  const base = `http://127.0.0.1:${port}/api`
  const start = () => { server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore' }) }
  async function stop() { if (!server || server.exitCode !== null) return; const ended = once(server, 'exit'); server.kill('SIGTERM'); await ended; server = undefined }
  async function ready() { for (let n = 0; n < 80; n += 1) { if (server.exitCode !== null) throw new Error(`Server exited with ${server.exitCode}`); try { if ((await fetch(`${base}/health`)).ok) return } catch {} await delay(100) } throw new Error('Server did not become ready') }
  async function request(route, method = 'GET', body) { const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() } }
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  start(); await ready()
  const campaign = (await request('/campaigns', 'POST', { name: 'Attack test', description: '', setting: '' })).body.campaign
  const player = (await request(`/campaigns/${campaign.id}/players`, 'POST', { displayName: 'Ilyra' })).body.player
  const charPath = `/campaigns/${campaign.id}/players/${player.playerId}/characters`
  const character = (await request(charPath, 'POST', { name: 'Ilyra Venn', species: 'Elf', class: 'Fighter', level: 5, abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 } })).body.character
  const secondCharacter = (await request(charPath, 'POST', { name: 'Tamsin', species: 'Human', class: 'Rogue', abilityScores: { str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10 } })).body.character
  const sheetPath = `${charPath}/${character.id}/sheet`
  assert.equal((await request(sheetPath, 'PUT', { level: 5, abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, savingThrowProficiencies: [], skillProficiencies: [], weaponProficiencies: ['longsword'] })).status, 200)
  const invPath = `${charPath}/${character.id}/inventory`
  const sword = (await request(invPath, 'POST', { name: 'Old Iron', category: 'weapon', weaponDefinitionId: 'longsword' })).body.item
  assert.equal((await request(`${invPath}/${sword.id}/equip`, 'POST', { slot: 'main_hand' })).status, 200)
  const otherInv = `${charPath}/${secondCharacter.id}/inventory`
  const otherSword = (await request(otherInv, 'POST', { name: 'Borrowed blade', category: 'weapon', weaponDefinitionId: 'longsword' })).body.item
  await request(`${otherInv}/${otherSword.id}/equip`, 'POST', { slot: 'main_hand' })

  const encounterPath = `/campaigns/${campaign.id}/encounters`
  const encounter = (await request(encounterPath, 'POST', { name: 'Cinder Hall' })).body.encounter
  const scoped = `${encounterPath}/${encounter.id}`
  const playerEntry = (await request(`${scoped}/combatants/players`, 'POST', { characterId: character.id, currentHp: 9, maxHp: 12 })).body.combatants[0]
  const secondEntry = (await request(`${scoped}/combatants/players`, 'POST', { characterId: secondCharacter.id })).body.combatants.find((entry) => entry.characterId === secondCharacter.id)
  const enemy = (await request(`${scoped}/combatants/enemies`, 'POST', { name: 'Ash Hound', armorClassOverride: 18, attackModifier: 4, currentHp: 7, maxHp: 7 })).body.combatants.find((entry) => entry.type === 'enemy')
  for (const [entry, total] of [[playerEntry, 12], [secondEntry, 10], [enemy, 8]]) assert.equal((await request(`${scoped}/combatants/${entry.id}/initiative`, 'PUT', { source: 'manual', total })).status, 200)
  assert.equal((await request(`${scoped}/start`, 'POST')).status, 200)
  assert.equal((await request(`${scoped}/combatants/${enemy.id}/conditions`, 'POST', { condition: 'blinded' })).status, 200)
  const beforeAttacks = (await request(scoped)).body
  assert.equal((await request(`${scoped}/attacks`, 'POST', { attackerId: playerEntry.id, targetId: playerEntry.id })).status, 400)
  assert.equal((await request(`${scoped}/attacks`, 'POST', { attackerId: playerEntry.id, targetId: enemy.id, weaponId: otherSword.id })).status, 404)
  assert.equal((await request(`${scoped}/attacks`, 'POST', { attackerId: playerEntry.id, targetId: enemy.id, weaponId: sword.id, mode: 'advantage', situationalModifier: 101 })).status, 400)
  assert.equal((await request(`${scoped}/attacks`, 'POST', { attackerId: playerEntry.id, targetId: enemy.id, weaponId: sword.id, diceResults: [20, 20], attackBonus: 999, targetAC: 1 })).status, 400)
  assert.equal((await request(`${scoped}/attacks`, 'POST', { attackerId: playerEntry.id, targetId: enemy.id, weaponId: sword.id })).status, 201)
  const firstHistory = (await request(`${scoped}/attacks`)).body.attacks[0]
  assert.equal(firstHistory.attackBonus, 6, 'STR +3 and level 5 proficiency +3 are read from persisted data')
  assert.equal(firstHistory.targetAC, 18)
  assert.equal(firstHistory.diceResults.length, 1, 'client dice and bonus values are ignored')
  assert.equal(firstHistory.mode, 'normal')
  assert.equal((await request(`${scoped}/attacks`, 'POST', { attackerId: enemy.id, targetId: playerEntry.id, mode: 'advantage', situationalModifier: -2 })).status, 201)
  const enemyHistory = (await request(`${scoped}/attacks`)).body.attacks[0]
  assert.equal(enemyHistory.attackBonus, 4)
  assert.equal(enemyHistory.targetAC, 12, 'player AC comes from saved Dexterity and equipped armor')
  assert.equal(enemyHistory.diceResults.length, 2)
  assert.equal(enemyHistory.keptIndex, 0)
  assert.equal((await request(`/campaigns/${campaign.id}/encounters/${encounter.id}/attacks`, 'POST', { attackerId: secondEntry.id, targetId: enemy.id, weaponId: otherSword.id, mode: 'disadvantage' })).status, 201)
  assert.equal((await request(`${scoped}/attacks`, 'POST', { attackerId: playerEntry.id, targetId: enemy.id, weaponId: sword.id, mode: 'lucky' })).status, 400)
  const noChanges = (await request(scoped)).body
  assert.equal(noChanges.combatants.find((entry) => entry.id === playerEntry.id).currentHp, 9)
  assert.equal(noChanges.combatants.find((entry) => entry.id === enemy.id).currentHp, 7)
  assert.equal(noChanges.encounter.activeCombatantId, beforeAttacks.encounter.activeCombatantId)
  assert.equal(noChanges.encounter.round, beforeAttacks.encounter.round)
  assert.deepEqual(noChanges.combatants.find((entry) => entry.id === enemy.id).conditions, beforeAttacks.combatants.find((entry) => entry.id === enemy.id).conditions)

  await request(`${invPath}/${sword.id}`, 'PUT', { name: 'Renamed sword', category: 'weapon', quantity: 1, notes: '', equipped: true, weaponDefinitionId: 'longsword' })
  await stop(); start(); await ready()
  const saved = await request(`${scoped}/attacks`)
  assert.equal(saved.status, 200)
  assert.equal(saved.body.attacks.length, 3)
  assert.equal(saved.body.attacks.find((entry) => entry.id === firstHistory.id).weaponName, 'Old Iron', 'history retains weapon-name snapshot')
  assert.equal((await request(scoped)).body.combatants.find((entry) => entry.id === playerEntry.id).currentHp, 9)
  const otherEncounter = (await request(encounterPath, 'POST', { name: 'Other room' })).body.encounter
  assert.equal((await request(`${encounterPath}/${otherEncounter.id}/attacks`, 'POST', { attackerId: playerEntry.id, targetId: enemy.id, weaponId: sword.id })).status, 404)
})
