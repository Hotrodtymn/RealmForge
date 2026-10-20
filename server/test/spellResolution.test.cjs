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

test('spell attack/save resolution validates metadata and scope, snapshots targets, deduplicates retries, and persists', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-spell-resolution-'))
  const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) }) })
  const base = `http://127.0.0.1:${port}/api`
  let server
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  function start() { server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore' }) }
  async function stop() { if (!server || server.exitCode !== null) return; const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; server = undefined }
  async function ready() { for (let attempt = 0; attempt < 80; attempt++) { if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`); try { if ((await fetch(`${base}/health`)).ok) return } catch {} await delay(100) } throw new Error('Server did not become ready') }
  async function request(route, method = 'GET', body) { const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: response.status === 204 ? null : await response.json() } }
  const uuid = () => crypto.randomUUID()
  async function makePlayer(campaignId, displayName, name, abilityScores) {
    const player = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName })
    const playerId = player.body.player.playerId
    const character = await request(`/campaigns/${campaignId}/players/${playerId}/characters`, 'POST', { name, species: 'Human', class: 'Wizard', level: 5, abilityScores })
    assert.equal(character.status, 201)
    return { playerId, character: character.body.character }
  }
  const scores = (dex = 10) => ({ str: 10, dex, con: 12, int: 18, wis: 12, cha: 10 })
  const attackSpellBody = { name: 'Arc Thread', level: 1, school: 'Evocation', castingTime: 'Action', range: '60 feet', components: ['V', 'S'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'A narrow strand of force leaps toward a chosen target.', resolutionType: 'attack', attackType: 'ranged', targetGuidance: 'One creature', resolutionNotes: 'Original test spell.' }
  const saveSpellBody = { ...attackSpellBody, name: 'Glass Tide', resolutionType: 'save', attackType: '', savingThrowAbility: 'dex', description: 'A wavering arc crosses the target’s path.' }

  start(); await ready()
  const campaign = await request('/campaigns', 'POST', { name: 'Spell encounter', description: '', setting: '' })
  const campaignId = campaign.body.campaign.id
  const { playerId: casterPlayerId, character: caster } = await makePlayer(campaignId, 'Mage player', 'Orin', scores())
  const { character: targetCharacter } = await makePlayer(campaignId, 'Target player', 'Pella', scores(14))
  const { playerId: strangerPlayerId, character: stranger } = await makePlayer(campaignId, 'Stranger', 'Guest', scores())
  const casterPath = `/campaigns/${campaignId}/players/${casterPlayerId}/characters/${caster.id}`
  // The target character is owned by its original player, retrieved from roster linkage above.
  const players = (await request(`/campaigns/${campaignId}/players`)).body.players
  const targetPlayerId = players.find((entry) => entry.displayName === 'Target player').playerId
  const targetPath = `/campaigns/${campaignId}/players/${targetPlayerId}/characters/${targetCharacter.id}`
  const strangerPath = `/campaigns/${campaignId}/players/${strangerPlayerId}/characters/${stranger.id}`
  const configured = await request(`${casterPath}/spellcasting/config`, 'PUT', { enabled: true, ability: 'int', notes: '' })
  assert.equal(configured.body.config.spellAttackBonus, 7)
  assert.equal(configured.body.config.spellSaveDc, 15)

  const attackSpell = await request(`${casterPath}/spellbook/custom`, 'POST', attackSpellBody)
  const saveSpell = await request(`${casterPath}/spellbook/custom`, 'POST', saveSpellBody)
  assert.equal(attackSpell.status, 201)
  assert.equal(saveSpell.status, 201)
  assert.equal((await request(`${casterPath}/spellbook/custom`, 'POST', { ...attackSpellBody, resolutionType: 'save' })).status, 400)
  const attackId = attackSpell.body.spell.id
  const saveId = saveSpell.body.spell.id
  await request(`${casterPath}/spellbook/${attackId}`, 'PATCH', { prepared: true })
  await request(`${casterPath}/spellbook/${saveId}`, 'PATCH', { prepared: true })
  const unpreparedSpell = await request(`${casterPath}/spellbook/custom`, 'POST', { ...attackSpellBody, name: 'Unprepared Thread' })
  assert.equal(unpreparedSpell.status, 201)
  const foreignSpell = await request(`${strangerPath}/spellbook/custom`, 'POST', attackSpellBody)

  const createdEncounter = await request(`/campaigns/${campaignId}/encounters`, 'POST', { name: 'Spell test combat' })
  const encounterId = createdEncounter.body.encounter.id
  const encounterPath = `/campaigns/${campaignId}/encounters/${encounterId}`
  const casterCombat = await request(`${encounterPath}/combatants/players`, 'POST', { characterId: caster.id })
  const targetCombat = await request(`${encounterPath}/combatants/players`, 'POST', { characterId: targetCharacter.id })
  const npcCombat = await request(`${encounterPath}/combatants/enemies`, 'POST', { name: 'Ash Guard', armorClassOverride: 16, currentHp: 8, maxHp: 8 })
  const casterId = casterCombat.body.combatants.find((entry) => entry.characterId === caster.id).id
  const targetId = targetCombat.body.combatants.find((entry) => entry.characterId === targetCharacter.id).id
  const npcId = npcCombat.body.combatants.find((entry) => entry.name === 'Ash Guard').id
  const resolutions = `${encounterPath}/spell-resolutions`

  assert.equal((await request(resolutions, 'POST', { requestId: uuid(), casterId, spellId: attackId, targetIds: [npcId, npcId] })).status, 400)
  assert.equal((await request(resolutions, 'POST', { requestId: uuid(), casterId: npcId, spellId: attackId, targetIds: [targetId] })).status, 400)
  assert.equal((await request(resolutions, 'POST', { requestId: uuid(), casterId, spellId: foreignSpell.body.spell.id, targetIds: [npcId] })).status, 404)
  assert.equal((await request(`/campaigns/missing/encounters/${encounterId}/spell-resolutions`)).status, 404)
  assert.equal((await request(resolutions, 'POST', { requestId: uuid(), casterId, spellId: attackId, targetIds: [npcId], diceResults: [20] })).status, 400)
  const unprepared = await request(resolutions, 'POST', { requestId: uuid(), casterId, spellId: unpreparedSpell.body.spell.id, targetIds: [npcId] })
  assert.equal(unprepared.status, 409)
  const preparedOverride = await request(resolutions, 'POST', { requestId: uuid(), casterId, spellId: unpreparedSpell.body.spell.id, targetIds: [npcId], dmOverride: true, overrideReason: 'Confirmed eligible with DM' })
  assert.equal(preparedOverride.status, 201)

  // The combatant join, not a client bonus, provides attack and AC values. Conditions combine with manual mode.
  await request(`${encounterPath}/combatants/${casterId}/conditions`, 'POST', { condition: 'poisoned' })
  await request(`${encounterPath}/combatants/${npcId}/conditions`, 'POST', { condition: 'blinded' })
  const attackRequest = { requestId: uuid(), casterId, spellId: attackId, targetIds: [npcId], mode: 'advantage', context: { distanceFeet: 10 }, npcSaveModifiers: {} }
  const attack = await request(resolutions, 'POST', attackRequest)
  assert.equal(attack.status, 201, JSON.stringify(attack.body))
  assert.equal(attack.body.resolution.results[0].spellAttackBonus, 7)
  assert.equal(attack.body.resolution.results[0].targetAC, 16)
  assert.equal(attack.body.resolution.results[0].finalMode, 'normal')
  assert.ok(attack.body.resolution.results[0].advantageSources.includes('Blinded target'))
  assert.ok(attack.body.resolution.results[0].disadvantageSources.includes('Poisoned attacker'))
  assert.equal(attack.body.resolution.results[0].diceResults.length, 1)
  const replay = await request(resolutions, 'POST', attackRequest)
  assert.equal(replay.status, 200)
  assert.equal(replay.body.replayed, true)
  assert.equal(replay.body.resolution.id, attack.body.resolution.id)
  assert.equal((await request(resolutions, 'POST', { ...attackRequest, targetIds: [targetId] })).status, 409)
  const otherEncounter = await request(`/campaigns/${campaignId}/encounters`, 'POST', { name: 'Separate spell encounter' })
  assert.equal((await request(`/campaigns/${campaignId}/encounters/${otherEncounter.body.encounter.id}/spell-resolutions`, 'POST', attackRequest)).status, 409)

  await request(`${encounterPath}/combatants/${casterId}/exhaustion`, 'PUT', { level: 2, reason: 'spell test' })
  const exhaustedRequest = { ...attackRequest, requestId: uuid(), mode: 'normal' }
  const exhaustedAttack = await request(resolutions, 'POST', exhaustedRequest)
  assert.equal(exhaustedAttack.body.resolution.results[0].exhaustionPenalty, -4)
  assert.equal(exhaustedAttack.body.resolution.results[0].spellAttackBonus, 7)

  const sheetPath = `${targetPath}/sheet`
  const sheet = await request(sheetPath)
  const saveSheet = await request(sheetPath, 'PUT', { level: 5, abilityScores: { ...scores(14) }, savingThrowProficiencies: ['dex'], skillProficiencies: [] })
  assert.equal(saveSheet.status, 200)
  assert.ok(sheet.body.sheet)
  await request(`${encounterPath}/combatants/${targetId}/conditions`, 'POST', { condition: 'restrained' })
  await request(`${encounterPath}/combatants/${targetId}/exhaustion`, 'PUT', { level: 1, reason: 'spell test' })
  const saveRequest = { requestId: uuid(), casterId, spellId: saveId, targetIds: [targetId, npcId], npcSaveModifiers: {} }
  const save = await request(resolutions, 'POST', saveRequest)
  assert.equal(save.status, 201, JSON.stringify(save.body))
  const playerSave = save.body.resolution.results.find((entry) => entry.targetId === targetId)
  const npcSave = save.body.resolution.results.find((entry) => entry.targetId === npcId)
  assert.equal(playerSave.targetModifier, 5)
  assert.equal(playerSave.exhaustionPenalty, -2)
  assert.deepEqual(playerSave.disadvantageSources, ['Restrained target: Disadvantage on Dexterity saving throws'])
  assert.equal(playerSave.diceResults.length, 2)
  assert.equal(npcSave.outcome, 'adjudication_required')
  assert.deepEqual(npcSave.diceResults, [])
  assert.equal(npcSave.total, null)

  const npcManualRequest = { requestId: uuid(), casterId, spellId: saveId, targetIds: [npcId], npcSaveModifiers: { [npcId]: 2 }, dmOverride: true, overrideReason: 'NPC save modifier from encounter notes' }
  const npcManual = await request(resolutions, 'POST', npcManualRequest)
  assert.equal(npcManual.status, 201)
  assert.equal(npcManual.body.resolution.results[0].modifierSource, 'explicit_npc')
  assert.ok(npcManual.body.resolution.results[0].diceResults.length === 1)
  assert.equal((await request(resolutions, 'POST', { ...npcManualRequest, npcSaveModifiers: { [npcId]: 100 } })).status, 400)

  await request(`${encounterPath}/combatants/${targetId}/conditions`, 'POST', { condition: 'paralyzed' })
  const autoFail = await request(resolutions, 'POST', { requestId: uuid(), casterId, spellId: saveId, targetIds: [targetId], npcSaveModifiers: {} })
  assert.equal(autoFail.body.resolution.results[0].outcome, 'automatic_failure')
  assert.deepEqual(autoFail.body.resolution.results[0].diceResults, [])

  const savedHistory = (await request(resolutions)).body.resolutions
  assert.ok(savedHistory.length >= 5)
  const priorSave = savedHistory.find((entry) => entry.requestId === saveRequest.requestId)
  assert.equal(priorSave.results.find((entry) => entry.targetId === targetId).targetModifier, 5)
  const snapshot = JSON.stringify(savedHistory)
  await stop(); start(); await ready()
  assert.equal(JSON.stringify((await request(resolutions)).body.resolutions), snapshot)
  assert.equal((await request(`/campaigns/${campaignId}/encounters/${encounterId}/attacks`)).status, 200)
  assert.equal((await request(`/campaigns/${campaignId}/encounters/${encounterId}/damage`)).status, 200)
})
