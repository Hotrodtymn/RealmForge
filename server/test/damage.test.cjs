const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('damage workflow is authoritative, atomic, scoped, and persistent', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-damage-'))
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
  async function successfulAttack(path, body) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = await request(path, 'POST', body)
      if (result.status !== 201) throw new Error(JSON.stringify(result.body))
      if (result.body.attack.outcome !== 'miss') return result.body.attack
    }
    throw new Error('Could not roll a successful attack within 60 tries.')
  }
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })

  start(); await ready()
  const campaign = (await request('/campaigns', 'POST', { name: 'Damage test', description: '', setting: '' })).body.campaign
  const player = (await request(`/campaigns/${campaign.id}/players`, 'POST', { displayName: 'Kestrel' })).body.player
  const characterPath = `/campaigns/${campaign.id}/players/${player.playerId}/characters`
  const character = (await request(characterPath, 'POST', { name: 'Kestrel Vale', species: 'Human', class: 'Fighter', level: 5, abilityScores: { str: 16, dex: 16, con: 12, int: 10, wis: 10, cha: 10 } })).body.character
  assert.equal((await request(`${characterPath}/${character.id}/sheet`, 'PUT', { level: 5, abilityScores: { str: 16, dex: 16, con: 12, int: 10, wis: 10, cha: 10 }, savingThrowProficiencies: [], skillProficiencies: [], weaponProficiencies: ['longsword'] })).status, 200)
  const inventoryPath = `${characterPath}/${character.id}/inventory`
  const sword = (await request(inventoryPath, 'POST', { name: 'Vowkeeper', category: 'weapon', weaponDefinitionId: 'longsword' })).body.item
  await request(`${inventoryPath}/${sword.id}/equip`, 'POST', { slot: 'main_hand' })
  const dagger = (await request(inventoryPath, 'POST', { name: 'Quickthorn', category: 'weapon', weaponDefinitionId: 'dagger', weaponAbility: 'dex' })).body.item
  await request(`${inventoryPath}/${dagger.id}/equip`, 'POST', { slot: 'off_hand' })

  const encountersPath = `/campaigns/${campaign.id}/encounters`
  const encounter = (await request(encountersPath, 'POST', { name: 'Damage chamber' })).body.encounter
  const encounterPath = `${encountersPath}/${encounter.id}`
  const playerCombatant = (await request(`${encounterPath}/combatants/players`, 'POST', { characterId: character.id, currentHp: 12, maxHp: 12 })).body.combatants[0]
  assert.equal((await request(`${encounterPath}/combatants/enemies`, 'POST', { name: 'Invalid formula', damageFormula: '1d6;process.exit()', damageType: 'fire' })).status, 400)
  const enemyResult = await request(`${encounterPath}/combatants/enemies`, 'POST', { name: 'Cinder imp', currentHp: 4, maxHp: 4, armorClassOverride: 1, attackModifier: 50, damageFormula: '1d4+2', damageType: 'fire' })
  assert.equal(enemyResult.status, 201)
  const enemy = enemyResult.body.combatants.find((entry) => entry.type === 'enemy')
  assert.equal(enemy.damageFormula, '1d4+2')
  const attackPath = `${encounterPath}/attacks`

  assert.equal((await request(`${attackPath}`, 'POST', { attackerId: playerCombatant.id, targetId: enemy.id, weaponId: sword.id, weaponUse: 'two_handed' })).status, 409, 'two-handed use rejects an occupied off hand')
  await request(`${inventoryPath}/${dagger.id}/unequip`, 'POST')
  const versatileAttack = await successfulAttack(attackPath, { attackerId: playerCombatant.id, targetId: enemy.id, weaponId: sword.id, weaponUse: 'two_handed' })
  assert.equal(versatileAttack.damageDiceCount, 1)
  assert.equal(versatileAttack.damageDieSize, 10)
  assert.equal(versatileAttack.damageType, 'slashing')
  assert.equal(versatileAttack.damageAbilityModifier, 3)
  assert.equal(versatileAttack.weaponUse, 'two_handed')
  assert.equal((await request(`${encounterPath}/attacks`, 'POST', { attackerId: playerCombatant.id, targetId: enemy.id, weaponId: sword.id, weaponUse: 'two_handed', targetAC: 1, damageTotal: 999 })).status, 400)
  const rollsResponse = await request(`${encounterPath}/attacks/${versatileAttack.id}/damage`, 'POST', { situationalModifier: 2, diceResults: [20, 20], damageTotal: 999, isCritical: true })
  assert.equal(rollsResponse.status, 400)
  await request(`${characterPath}/${character.id}/sheet`, 'PUT', { level: 1, abilityScores: { str: 8, dex: 16, con: 12, int: 10, wis: 10, cha: 10 }, savingThrowProficiencies: [], skillProficiencies: [], weaponProficiencies: [] })
  await request(`${inventoryPath}/${sword.id}`, 'PUT', { name: 'Renamed after attack', category: 'weapon', quantity: 1, notes: '', equipped: true, weaponDefinitionId: 'longsword' })
  const rolled = await request(`${encounterPath}/attacks/${versatileAttack.id}/damage`, 'POST', { situationalModifier: -1 })
  assert.equal(rolled.status, 201)
  const weaponDamage = rolled.body.damage
  assert.equal(weaponDamage.dieSize, 10)
  assert.equal(weaponDamage.damageType, 'slashing')
  assert.equal(weaponDamage.ability, 'str')
  assert.equal(weaponDamage.abilityModifier, 3)
  assert.equal(weaponDamage.weaponName, 'Vowkeeper', 'damage uses the attack-time weapon and stat snapshot')
  assert.equal(weaponDamage.situationalModifier, -1)
  assert.equal(weaponDamage.diceResults.length, versatileAttack.isCritical ? 2 : 1)
  assert.equal((await request(encounterPath)).body.combatants.find((entry) => entry.id === enemy.id).currentHp, 4, 'rolling damage does not change HP')

  await request(`${encounterPath}/combatants/${enemy.id}/hit-points`, 'PUT', { currentHp: 1, maxHp: 4 })
  const applyPath = `${encounterPath}/damage/${weaponDamage.id}/apply`
  const simultaneous = await Promise.all([request(applyPath, 'POST'), request(applyPath, 'POST')])
  assert.deepEqual(simultaneous.map((entry) => entry.status).sort(), [200, 409])
  const applied = simultaneous.find((entry) => entry.status === 200).body.damage
  assert.equal(applied.applied, true)
  assert.equal(applied.hpBefore, 1)
  assert.equal(applied.hpAfter, 0, 'HP is clamped at zero')
  assert.equal((await request(applyPath, 'POST')).status, 409)
  const encounterAfter = (await request(encounterPath)).body
  assert.equal(encounterAfter.combatants.find((entry) => entry.id === enemy.id).currentHp, 0)
  assert.equal(encounterAfter.encounter.round, 0)
  assert.equal(encounterAfter.encounter.activeCombatantId, null)
  assert.deepEqual(encounterAfter.combatants.find((entry) => entry.id === enemy.id).conditions, [])

  await request(`${inventoryPath}/${dagger.id}/equip`, 'POST', { slot: 'off_hand' })
  const finesseAttack = await successfulAttack(attackPath, { attackerId: playerCombatant.id, targetId: enemy.id, weaponId: dagger.id })
  assert.equal(finesseAttack.damageAbilityModifier, 3, 'configured finesse Dexterity is saved for damage')
  const finesseDamage = await request(`${encounterPath}/attacks/${finesseAttack.id}/damage`, 'POST')
  assert.equal(finesseDamage.status, 201)
  assert.equal(finesseDamage.body.damage.damageType, 'piercing')
  assert.equal(finesseDamage.body.damage.ability, 'dex')
  assert.equal(finesseDamage.body.damage.abilityModifier, 3)

  const enemyAttack = await successfulAttack(attackPath, { attackerId: enemy.id, targetId: playerCombatant.id })
  assert.equal((await request(`${encounterPath}/combatants/${enemy.id}/combat-stats`, 'PUT', { armorClassOverride: 1, attackModifier: 50, damageFormula: '2d6+9', damageType: 'cold' })).status, 200)
  const enemyDamage = await request(`${encounterPath}/attacks/${enemyAttack.id}/damage`, 'POST')
  assert.equal(enemyDamage.status, 201)
  assert.equal(enemyDamage.body.damage.source, 'enemy')
  assert.equal(enemyDamage.body.damage.formula, '1d4+2')
  assert.equal(enemyDamage.body.damage.formulaModifier, 2)
  assert.equal(enemyDamage.body.damage.damageType, 'fire')
  assert.equal(enemyDamage.body.damage.abilityModifier, 0)

  const missEnemy = (await request(`${encounterPath}/combatants/enemies`, 'POST', { name: 'Iron sentinel', currentHp: 10, maxHp: 10, armorClassOverride: 50, attackModifier: 0, damageFormula: '2d8+3', damageType: 'slashing' })).body.combatants.find((entry) => entry.name === 'Iron sentinel')
  let missedAttack
  for (let i = 0; i < 60; i += 1) {
    const attempt = (await request(attackPath, 'POST', { attackerId: playerCombatant.id, targetId: missEnemy.id, weaponId: sword.id })).body.attack
    if (attempt.outcome === 'miss') { missedAttack = attempt; break }
  }
  assert.ok(missedAttack)
  assert.equal((await request(`${encounterPath}/attacks/${missedAttack.id}/damage`, 'POST')).status, 409)
  assert.equal((await request(`${encountersPath}/${encounter.id}/damage/nope/apply`, 'POST')).status, 404)

  await stop(); start(); await ready()
  const history = await request(`${encounterPath}/damage`)
  assert.equal(history.status, 200)
  assert.equal(history.body.damageRolls.find((entry) => entry.id === weaponDamage.id).applied, true)
  assert.equal(history.body.damageRolls.find((entry) => entry.id === weaponDamage.id).hpBefore, 1)
  assert.equal((await request(`${encounterPath}/combatants/${enemy.id}/hit-points`, 'PUT', { currentHp: 1, maxHp: 4 })).status, 200)
  const wrongEncounter = (await request(encountersPath, 'POST', { name: 'Other chamber' })).body.encounter
  assert.equal((await request(`${encountersPath}/${wrongEncounter.id}/attacks/${versatileAttack.id}/damage`, 'POST')).status, 404)
})
