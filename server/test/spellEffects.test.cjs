const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('spell effects scale explicitly, resolve independently, apply once, and persist without changing unrelated history', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-spell-effects-'))
  const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) }) })
  const base = `http://127.0.0.1:${port}/api`
  let server
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  function start() { server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore' }) }
  async function stop() { if (!server || server.exitCode !== null) return; const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; server = undefined }
  async function ready() { for (let attempt = 0; attempt < 80; attempt++) { if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`); try { if ((await fetch(`${base}/health`)).ok) return } catch {} await delay(100) } throw new Error('Server did not become ready') }
  async function request(route, method = 'GET', body) { const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: response.status === 204 ? null : await response.json() } }
  const uuid = () => crypto.randomUUID()
  async function addCharacter(campaignId, displayName, name) {
    const player = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName })
    const playerId = player.body.player.playerId
    const character = await request(`/campaigns/${campaignId}/players/${playerId}/characters`, 'POST', { name, species: 'Human', class: 'Wizard', level: 5, abilityScores: { str: 10, dex: 16, con: 12, int: 18, wis: 12, cha: 10 } })
    assert.equal(character.status, 201)
    return { playerId, character: character.body.character }
  }
  const custom = (name, extra = {}) => ({ name, level: 1, school: 'Evocation', castingTime: 'Action', range: '60 feet', components: ['V', 'S'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'An original test spell with explicitly configured effects.', resolutionType: 'none', savingThrowAbility: '', attackType: '', effectType: 'damage', effectFormula: '1d4+2', damageType: 'fire', effectModifier: 1, includeSpellcastingModifier: true, saveSuccessEffect: null, upcastMode: 'none', upcastDiceCount: 0, upcastDieSize: null, upcastModifier: 0, ...extra })

  start(); await ready()
  const campaign = await request('/campaigns', 'POST', { name: 'Effect tests', description: '', setting: '' })
  const campaignId = campaign.body.campaign.id
  const caster = await addCharacter(campaignId, 'Caster player', 'Mira')
  const target = await addCharacter(campaignId, 'Target player', 'Tarin')
  const patient = await addCharacter(campaignId, 'Patient player', 'Sela')
  const deadPc = await addCharacter(campaignId, 'Dead player', 'Nox')
  const casterPath = `/campaigns/${campaignId}/players/${caster.playerId}/characters/${caster.character.id}`
  const targetPath = `/campaigns/${campaignId}/players/${target.playerId}/characters/${target.character.id}`
  await request(`${casterPath}/spellcasting/config`, 'PUT', { enabled: true, ability: 'int', notes: '' })
  const attackSpell = await request(`${casterPath}/spellbook/custom`, 'POST', custom('Cinder Lance', { resolutionType: 'attack', attackType: 'ranged', upcastMode: 'dice', upcastDiceCount: 1, upcastDieSize: 4 }))
  const saveSpell = await request(`${casterPath}/spellbook/custom`, 'POST', custom('Shatterwave', { resolutionType: 'save', savingThrowAbility: 'dex', saveSuccessEffect: 'half', effectFormula: '1d6', damageType: 'thunder', upcastMode: 'none', upcastDiceCount: 0, upcastDieSize: null }))
  const healSpell = await request(`${casterPath}/spellbook/custom`, 'POST', custom('Mend Light', { effectType: 'healing', effectFormula: '1d8', damageType: null, effectModifier: 0, upcastMode: 'none', upcastDiceCount: 0, upcastDieSize: null }))
  const directDamageSpell = await request(`${casterPath}/spellbook/custom`, 'POST', custom('Cinder Pin', { resolutionType: 'none', attackType: '', effectFormula: '1d4', effectModifier: 0, includeSpellcastingModifier: false, damageType: 'necrotic' }))
  const foreignSpell = await request(`${targetPath}/spellbook/custom`, 'POST', custom('Other Caster Spell', { resolutionType: 'none' }))
  assert.equal(attackSpell.status, 201, JSON.stringify(attackSpell.body))
  assert.equal(saveSpell.status, 201, JSON.stringify(saveSpell.body))
  assert.equal(healSpell.status, 201, JSON.stringify(healSpell.body))
  assert.equal(directDamageSpell.status, 201, JSON.stringify(directDamageSpell.body))
  assert.equal((await request(`${casterPath}/spellbook/custom`, 'POST', custom('Missing save behavior', { resolutionType: 'save', savingThrowAbility: 'dex', saveSuccessEffect: null }))).status, 400)
  for (const spell of [attackSpell.body.spell, saveSpell.body.spell, healSpell.body.spell, directDamageSpell.body.spell]) await request(`${casterPath}/spellbook/${spell.id}`, 'PATCH', { prepared: true })
  const encounter = await request(`/campaigns/${campaignId}/encounters`, 'POST', { name: 'Effects' })
  const encounterId = encounter.body.encounter.id
  const encounterPath = `/campaigns/${campaignId}/encounters/${encounterId}`
  const casterCombat = (await request(`${encounterPath}/combatants/players`, 'POST', { characterId: caster.character.id, currentHp: 20, maxHp: 20 })).body.combatants.find((entry) => entry.characterId === caster.character.id)
  const targetCombat = (await request(`${encounterPath}/combatants/players`, 'POST', { characterId: target.character.id, currentHp: 20, maxHp: 20 })).body.combatants.find((entry) => entry.characterId === target.character.id)
  const patientCombat = (await request(`${encounterPath}/combatants/players`, 'POST', { characterId: patient.character.id, currentHp: 0, maxHp: 10 })).body.combatants.find((entry) => entry.characterId === patient.character.id)
  const deadCombat = (await request(`${encounterPath}/combatants/players`, 'POST', { characterId: deadPc.character.id, currentHp: 1, maxHp: 10 })).body.combatants.find((entry) => entry.characterId === deadPc.character.id)
  const enemy = (await request(`${encounterPath}/combatants/enemies`, 'POST', { name: 'Ash Warden', currentHp: 100, maxHp: 100, armorClassOverride: 15 })).body.combatants.find((entry) => entry.name === 'Ash Warden')
  const effectsPath = `${encounterPath}/spell-effects`
  const resolutionsPath = `${encounterPath}/spell-resolutions`

  assert.equal((await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: attackSpell.body.spell.id, targetIds: [enemy.id, enemy.id], castLevel: 3 })).status, 400)
  assert.equal((await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: attackSpell.body.spell.id, targetIds: [enemy.id], castLevel: 0 })).status, 400)
  assert.equal((await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: attackSpell.body.spell.id, targetIds: [enemy.id], castLevel: 3, resolutionId: uuid() })).status, 409)
  assert.equal((await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: foreignSpell.body.spell.id, targetIds: [enemy.id], castLevel: 1, resolutionId: null })).status, 404)
  assert.equal((await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: healSpell.body.spell.id, targetIds: [uuid()], castLevel: 1, resolutionId: null })).status, 404)

  let successfulAttack
  let criticalEffect
  let sawMiss = false
  for (let attempt = 0; attempt < 120 && (!criticalEffect || !sawMiss); attempt++) {
    const resolved = await request(resolutionsPath, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: attackSpell.body.spell.id, targetIds: [enemy.id], mode: 'normal' })
    assert.equal(resolved.status, 201, JSON.stringify(resolved.body))
    const result = resolved.body.resolution.results[0]
    if (result.outcome === 'miss') {
      sawMiss = true
      const rejected = await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: attackSpell.body.spell.id, targetIds: [enemy.id], castLevel: 3, resolutionId: resolved.body.resolution.id })
      assert.equal(rejected.status, 409)
      continue
    }
    const requestId = uuid()
    const rolled = await request(`${effectsPath}/roll`, 'POST', { requestId, casterId: casterCombat.id, spellId: attackSpell.body.spell.id, targetIds: [enemy.id], castLevel: 3, resolutionId: resolved.body.resolution.id })
    assert.equal(rolled.status, 201, JSON.stringify(rolled.body))
    assert.equal(rolled.body.rolls[0].finalFormula, result.outcome === 'critical_hit' ? '6d4+3' : '3d4+3')
    assert.equal(rolled.body.rolls[0].abilityModifier, 4)
    const retry = await request(`${effectsPath}/roll`, 'POST', { requestId, casterId: casterCombat.id, spellId: attackSpell.body.spell.id, targetIds: [enemy.id], castLevel: 3, resolutionId: resolved.body.resolution.id })
    assert.equal(retry.status, 200); assert.equal(retry.body.replayed, true); assert.equal(retry.body.rolls[0].id, rolled.body.rolls[0].id)
    assert.equal((await request(`${effectsPath}/roll`, 'POST', { requestId, casterId: casterCombat.id, spellId: attackSpell.body.spell.id, targetIds: [enemy.id], castLevel: 2, resolutionId: resolved.body.resolution.id })).status, 409)
    if (!successfulAttack) successfulAttack = { resolution: resolved.body.resolution, roll: rolled.body.rolls[0] }
    if (result.outcome === 'critical_hit') criticalEffect = { resolution: resolved.body.resolution, roll: rolled.body.rolls[0] }
  }
  assert.ok(successfulAttack, 'a successful spell attack should be observed')
  assert.ok(criticalEffect, 'a critical spell attack should be observed')
  assert.ok(sawMiss, 'a missed spell attack should be observed and rejected for damage without override')
  assert.equal(criticalEffect.roll.diceResults.length, 6)
  assert.equal(criticalEffect.roll.damageType, 'fire')
  assert.equal(criticalEffect.roll.formulaModifier, 3)
  assert.equal(criticalEffect.roll.fullAmount, criticalEffect.roll.diceResults.reduce((sum, die) => sum + die, 0) + 3 + 4)
  assert.equal((await request(encounterPath)).body.combatants.find((entry) => entry.id === enemy.id).currentHp, 100, 'rolling damage does not apply it automatically')
  const applied = await request(`${effectsPath}/${successfulAttack.roll.id}/apply`, 'POST', { requestId: uuid() })
  assert.equal(applied.status, 201, JSON.stringify(applied.body))
  const applyRetry = await request(`${effectsPath}/${successfulAttack.roll.id}/apply`, 'POST', { requestId: applied.body.application.requestId })
  assert.equal(applyRetry.status, 200); assert.equal(applyRetry.body.replayed, true)
  assert.equal((await request(`${effectsPath}/${successfulAttack.roll.id}/apply`, 'POST', { requestId: uuid() })).status, 409)

  const saveResolution = await request(resolutionsPath, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: saveSpell.body.spell.id, targetIds: [targetCombat.id, enemy.id], npcSaveModifiers: {} })
  assert.equal(saveResolution.status, 201, JSON.stringify(saveResolution.body))
  const saveRollRequest = { requestId: uuid(), casterId: casterCombat.id, spellId: saveSpell.body.spell.id, targetIds: [targetCombat.id, enemy.id], castLevel: 1, resolutionId: saveResolution.body.resolution.id }
  const saveRoll = await request(`${effectsPath}/roll`, 'POST', saveRollRequest)
  assert.equal(saveRoll.status, 201, JSON.stringify(saveRoll.body))
  assert.equal(saveRoll.body.rolls.length, 2)
  assert.equal(saveRoll.body.rolls[0].damageType, 'thunder')
  assert.equal(saveResolution.body.resolution.results.find((entry) => entry.targetId === enemy.id).outcome, 'adjudication_required')
  for (const item of saveRoll.body.rolls) {
    const outcome = saveResolution.body.resolution.results.find((entry) => entry.targetId === item.targetId).outcome
    assert.equal(item.saveOutcome, outcome)
    if (outcome === 'adjudication_required') { assert.equal(item.status, 'adjudication_required'); assert.deepEqual(item.diceResults, []) }
    else assert.equal(item.appliedAmount, outcome === 'success' ? Math.floor(item.fullAmount / 2) : item.fullAmount)
  }
  const npcSaveRoll = await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: saveSpell.body.spell.id, targetIds: [enemy.id], castLevel: 1, resolutionId: saveResolution.body.resolution.id, dmOverride: true, overrideReason: 'NPC save adjudicated successful', adjudicatedSaveOutcomes: { [enemy.id]: 'success' } })
  assert.equal(npcSaveRoll.status, 201, JSON.stringify(npcSaveRoll.body))
  assert.equal(npcSaveRoll.body.rolls[0].saveOutcome, 'success')
  assert.equal(npcSaveRoll.body.rolls[0].appliedAmount, Math.floor(npcSaveRoll.body.rolls[0].fullAmount / 2))
  const playerRoll = saveRoll.body.rolls.find((item) => item.targetId === targetCombat.id)
  const saveApplied = await request(`${effectsPath}/${playerRoll.id}/apply`, 'POST', { requestId: uuid() })
  assert.equal(saveApplied.status, 201)

  // Healing is a separate roll/application and reuses existing 0 HP recovery behavior.
  const healRoll = await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: healSpell.body.spell.id, targetIds: [patientCombat.id], castLevel: 1, resolutionId: null })
  assert.equal(healRoll.status, 201, JSON.stringify(healRoll.body))
  assert.ok(healRoll.body.rolls[0].appliedAmount > 0)
  const healApplied = await request(`${effectsPath}/${healRoll.body.rolls[0].id}/apply`, 'POST', { requestId: uuid() })
  assert.equal(healApplied.status, 201)
  assert.ok(healApplied.body.application.hpAfter > 0 && healApplied.body.application.hpAfter <= 10)
  const encounterAfterHeal = await request(encounterPath)
  const recovered = encounterAfterHeal.body.combatants.find((entry) => entry.id === patientCombat.id)
  assert.equal(recovered.survivalStatus, 'conscious')
  assert.equal(recovered.deathSaveSuccesses, 0); assert.equal(recovered.deathSaveFailures, 0)

  await request(`${encounterPath}/combatants/${patientCombat.id}/damage`, 'POST', { amount: recovered.currentHp })
  const zeroDamageRoll = await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: directDamageSpell.body.spell.id, targetIds: [patientCombat.id], castLevel: 1, resolutionId: null })
  assert.equal(zeroDamageRoll.status, 201)
  const zeroDamageApplied = await request(`${effectsPath}/${zeroDamageRoll.body.rolls[0].id}/apply`, 'POST', { requestId: uuid() })
  assert.equal(zeroDamageApplied.status, 201)
  const unconscious = (await request(encounterPath)).body.combatants.find((entry) => entry.id === patientCombat.id)
  assert.equal(unconscious.survivalStatus, 'unconscious')
  assert.ok(unconscious.deathSaveFailures >= 1)

  await request(`${encounterPath}/combatants/${deadCombat.id}/damage`, 'POST', { amount: 11 })
  const deadHeal = await request(`${effectsPath}/roll`, 'POST', { requestId: uuid(), casterId: casterCombat.id, spellId: healSpell.body.spell.id, targetIds: [deadCombat.id], castLevel: 1, resolutionId: null })
  assert.equal(deadHeal.status, 201)
  assert.equal((await request(`${effectsPath}/${deadHeal.body.rolls[0].id}/apply`, 'POST', { requestId: uuid() })).status, 409)

  const saved = (await request(effectsPath)).body
  assert.ok(saved.rolls.length >= 6)
  assert.ok(saved.applications.length >= 3)
  const snapshot = JSON.stringify(saved)
  await stop(); start(); await ready()
  assert.equal(JSON.stringify(await request(effectsPath).then((response) => response.body)), snapshot)
  assert.equal((await request(`${encounterPath}/attacks`)).status, 200)
  assert.equal((await request(`${encounterPath}/damage`)).status, 200)
})
