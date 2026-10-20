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

test('spell casts atomically spend slots and turn resources, enforce idempotency, and persist', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-casting-'))
  const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) }) })
  const base = `http://127.0.0.1:${port}/api`
  let server
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  function start() { server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore' }) }
  async function stop() { if (!server || server.exitCode !== null) return; const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; server = undefined }
  async function ready() { for (let n = 0; n < 80; n++) { if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`); try { if ((await fetch(`${base}/health`)).ok) return } catch {} await delay(100) } throw new Error('Server did not become ready') }
  async function request(route, method = 'GET', body) { const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: response.status === 204 ? null : await response.json() } }
  const uuid = () => crypto.randomUUID()
  start(); await ready()
  const campaign = (await request('/campaigns', 'POST', { name: 'Casting', description: '', setting: '' })).body.campaign
  async function createCaster(displayName, name) {
    const player = (await request(`/campaigns/${campaign.id}/players`, 'POST', { displayName })).body.player
    const character = (await request(`/campaigns/${campaign.id}/players/${player.playerId}/characters`, 'POST', { name, species: 'Human', class: 'Wizard', level: 4, abilityScores: { str: 8, dex: 12, con: 12, int: 18, wis: 10, cha: 10 } })).body.character
    const root = `/campaigns/${campaign.id}/players/${player.playerId}/characters/${character.id}`
    await request(`${root}/spellcasting/config`, 'PUT', { enabled: true, ability: 'int', notes: '' })
    await request(`${root}/spell-slots/1`, 'PUT', { maximum: 3, remaining: 3 })
    const spell = (await request(`${root}/spellbook`, 'POST', { spellId: 'rf-stoneward' })).body.spell
    await request(`${root}/spellbook/${spell.id}`, 'PATCH', { prepared: true })
    const reaction = (await request(`${root}/spellbook/custom`, 'POST', { name: `${name} Reaction`, level: 0, school: 'Abjuration', castingTime: 'When triggered', castingTimeCategory: 'reaction', range: 'Self', components: ['V'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'A test reaction spell.' })).body.spell
    await request(`${root}/spellbook/${reaction.id}`, 'PATCH', { prepared: true })
    return { player, character, spell, reaction }
  }
  const a = await createCaster('A', 'Aster')
  const b = await createCaster('B', 'Beryl')
  await request(`/campaigns/${campaign.id}/players/${a.player.playerId}/characters/${a.character.id}/spellbook`, 'POST', { spellId: 'rf-spark-bolt' })
  const encounter = (await request(`/campaigns/${campaign.id}/encounters`, 'POST', { name: 'Casting encounter' })).body.encounter
  const ep = `/campaigns/${campaign.id}/encounters/${encounter.id}`
  const ca = (await request(`${ep}/combatants/players`, 'POST', { characterId: a.character.id })).body.combatants.find((entry) => entry.characterId === a.character.id)
  const cb = (await request(`${ep}/combatants/players`, 'POST', { characterId: b.character.id })).body.combatants.find((entry) => entry.characterId === b.character.id)
  await request(`${ep}/combatants/${ca.id}/initiative`, 'PUT', { source: 'manual', total: 20 })
  await request(`${ep}/combatants/${cb.id}/initiative`, 'PUT', { source: 'manual', total: 10 })
  assert.equal((await request(`${ep}/start`, 'POST')).body.encounter.activeCombatantId, ca.id)
  const casts = `${ep}/spell-castings`
  assert.equal((await request(casts, 'POST', { requestId: uuid(), casterId: ca.id, spellId: a.spell.id, castLevel: 0 })).status, 400)
  assert.equal((await request(casts, 'POST', { requestId: uuid(), casterId: ca.id, spellId: a.spell.id, castLevel: 10 })).status, 400)
  assert.equal((await request(casts, 'POST', { requestId: uuid(), casterId: ca.id, spellId: a.spell.id, castLevel: 2 })).status, 409, 'higher cast level needs a configured available slot')
  const requestId = uuid()
  const castInput = { requestId, casterId: ca.id, spellId: a.spell.id, castLevel: 1 }
  const [first, retry] = await Promise.all([request(casts, 'POST', castInput), request(casts, 'POST', castInput)])
  assert.deepEqual([first.status, retry.status].sort(), [200, 201])
  assert.equal(first.body.event.id, retry.body.event.id)
  assert.equal((await request(`/campaigns/${campaign.id}/players/${a.player.playerId}/characters/${a.character.id}/spellcasting`)).body.slots[0].remaining, 2)
  assert.equal((await request(casts, 'POST', { ...castInput, castLevel: 2 })).status, 409)
  const secondCasterTurn = await request(casts, 'POST', { requestId: uuid(), casterId: cb.id, spellId: b.spell.id, castLevel: 1, dmOverride: true, overrideReason: 'Testing turn-wide slot expenditure.' })
  assert.equal(secondCasterTurn.status, 409)
  assert.match(secondCasterTurn.body.error, /Only one spell slot can be expended per turn/)
  assert.equal((await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellcasting`)).body.slots[0].remaining, 3)
  const beforeReaction = (await request(`${ep}/action-economy`)).body.states.find((entry) => entry.combatantId === ca.id)
  assert.equal(beforeReaction.actionUsed, true)
  assert.equal((await request(`${ep}/next-turn`, 'POST', { actionId: uuid() })).body.encounter.activeCombatantId, cb.id)
  const reaction = await request(casts, 'POST', { requestId: uuid(), casterId: ca.id, spellId: a.reaction.id, castLevel: 0, dmOverride: true, overrideReason: 'Reaction trigger adjudicated by DM.' })
  assert.equal(reaction.status, 201, JSON.stringify(reaction.body))
  assert.equal(reaction.body.event.status, 'cast')
  assert.equal(reaction.body.event.actionResource, 'reaction')
  assert.equal((await request(`${ep}/action-economy`)).body.states.find((entry) => entry.combatantId === ca.id).reactionUsed, true)
  assert.equal((await request(casts, 'POST', { requestId: uuid(), casterId: ca.id, spellId: a.reaction.id, castLevel: 0, dmOverride: true, overrideReason: 'Second reaction attempt in the same round.' })).status, 409)
  assert.equal((await request(`/campaigns/${campaign.id}/players/${a.player.playerId}/characters/${a.character.id}/spellcasting`)).body.slots[0].remaining, 2)
  const attackSpell = (await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellbook/custom`, 'POST', { name: 'Linked Test Bolt', level: 1, school: 'Evocation', castingTime: 'Action', castingTimeCategory: 'action', range: '60 feet', components: ['V', 'S'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'A test spell with a linked effect.', resolutionType: 'attack', attackType: 'ranged', effectType: 'damage', effectFormula: '1d6', damageType: 'force' })).body.spell
  assert.equal((await request(casts, 'POST', { requestId: uuid(), casterId: cb.id, spellId: attackSpell.id, castLevel: 1 })).status, 409, 'unprepared spells require explicit preparation or DM adjudication')
  await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellbook/${attackSpell.id}`, 'PATCH', { prepared: true })
  await request(`${ep}/combatants/${cb.id}/conditions`, 'POST', { condition: 'incapacitated' })
  assert.equal((await request(casts, 'POST', { requestId: uuid(), casterId: cb.id, spellId: attackSpell.id, castLevel: 1 })).status, 409, 'conditions that prevent actions block casting')
  await request(`${ep}/combatants/${cb.id}/conditions/incapacitated`, 'DELETE')
  const attackCast = await request(casts, 'POST', { requestId: uuid(), casterId: cb.id, spellId: attackSpell.id, castLevel: 1 })
  assert.equal(attackCast.status, 201, JSON.stringify(attackCast.body))
  const resolutions = `${ep}/spell-resolutions`
  const linkedResolution = await request(resolutions, 'POST', { requestId: uuid(), casterId: cb.id, spellId: attackSpell.id, targetIds: [ca.id], castingEventId: attackCast.body.event.id })
  assert.equal(linkedResolution.status, 201, JSON.stringify(linkedResolution.body))
  const effectRoll = await request(`${ep}/spell-effects/roll`, 'POST', { requestId: uuid(), casterId: cb.id, spellId: attackSpell.id, targetIds: [ca.id], castLevel: 1, resolutionId: linkedResolution.body.resolution.id, castingEventId: attackCast.body.event.id, dmOverride: true, overrideReason: 'Test damage roll link regardless of random attack outcome.' })
  assert.equal(effectRoll.status, 201, JSON.stringify(effectRoll.body))
  assert.equal((await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellcasting`)).body.slots[0].remaining, 2, 'resolution and effect roll do not spend additional slots')
  const bonusSpell = (await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellbook/custom`, 'POST', { name: 'Bonus Cantrip', level: 0, school: 'Illusion', castingTime: 'Bonus Action', castingTimeCategory: 'bonus_action', range: 'Self', components: ['V'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'A test bonus-action cantrip.' })).body.spell
  await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellbook/${bonusSpell.id}`, 'PATCH', { prepared: true })
  const bonusCast = await request(casts, 'POST', { requestId: uuid(), casterId: cb.id, spellId: bonusSpell.id, castLevel: 0 })
  assert.equal(bonusCast.status, 201, JSON.stringify(bonusCast.body))
  assert.equal(bonusCast.body.event.slotLevel, null)
  assert.equal(bonusCast.body.event.actionResource, 'bonusAction')
  assert.equal((await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellcasting`)).body.slots[0].remaining, 2, 'cantrip and bonus action casting consume no spell slot')
  const specialSpell = (await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellbook/custom`, 'POST', { name: 'Special Time', level: 0, school: 'Illusion', castingTime: 'At the DM’s direction', castingTimeCategory: 'special', range: 'Self', components: ['V'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'A test special-time spell.' })).body.spell
  await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellbook/${specialSpell.id}`, 'PATCH', { prepared: true })
  assert.equal((await request(casts, 'POST', { requestId: uuid(), casterId: cb.id, spellId: specialSpell.id, castLevel: 0 })).status, 409)
  const specialCast = await request(casts, 'POST', { requestId: uuid(), casterId: cb.id, spellId: specialSpell.id, castLevel: 0, specialResource: 'none', dmOverride: true, overrideReason: 'Special casting time explicitly adjudicated.' })
  assert.equal(specialCast.status, 201)
  assert.equal(specialCast.body.event.status, 'cast')
  const otherEncounter = (await request(`/campaigns/${campaign.id}/encounters`, 'POST', { name: 'Other encounter' })).body.encounter
  const otherCombatant = (await request(`/campaigns/${campaign.id}/encounters/${otherEncounter.id}/combatants/players`, 'POST', { characterId: a.character.id })).body.combatants.find((entry) => entry.characterId === a.character.id)
  assert.equal((await request(`/campaigns/${campaign.id}/encounters/${otherEncounter.id}/spell-castings`, 'POST', { ...castInput, casterId: otherCombatant.id })).status, 409, 'an idempotency key cannot be reused in another encounter')
  const savedHistory = (await request(casts)).body.events
  assert.equal(savedHistory.length, 5)
  assert.equal(savedHistory.find((entry) => entry.id === first.body.event.id).slotLevel, 1)
  await stop(); start(); await ready()
  assert.equal((await request(casts)).body.events.length, 5)
  assert.equal((await request(`/campaigns/${campaign.id}/players/${a.player.playerId}/characters/${a.character.id}/spellcasting`)).body.slots[0].remaining, 2)
  assert.equal((await request(casts, 'POST', castInput)).status, 200)
  const bSlots = `/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spell-slots/1/restore`
  assert.equal((await request(bSlots, 'POST')).body.slot.remaining, 3)
  await stop(); start(); await ready()
  assert.equal((await request(`/campaigns/${campaign.id}/players/${b.player.playerId}/characters/${b.character.id}/spellcasting`)).body.slots[0].remaining, 3, 'manual slot recovery persists and does not rewrite casting history')
  assert.equal((await request(casts)).body.events.length, 5)
})

test('spell library, spellbook, configuration, slots and character ownership persist safely', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-spells-'))
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) })
  })
  const base = `http://127.0.0.1:${port}/api`
  let server
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  function start() { server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore' }) }
  async function stop() { if (!server || server.exitCode !== null) return; const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; server = undefined }
  async function ready() { for (let n = 0; n < 80; n++) { if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`); try { if ((await fetch(`${base}/health`)).ok) return } catch {} await delay(100) } throw new Error('Server did not become ready') }
  async function request(route, method = 'GET', body) { const response = await fetch(`${base}${route}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: response.status === 204 ? null : await response.json() } }

  start(); await ready()
  const campaign = await request('/campaigns', 'POST', { name: 'Spell test', description: '', setting: '' })
  const campaignId = campaign.body.campaign.id
  const player = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName: 'Mira' })
  const playerId = player.body.player.playerId
  const character = await request(`/campaigns/${campaignId}/players/${playerId}/characters`, 'POST', { name: 'Ilyan', species: 'Human', class: 'Wizard', level: 5, abilityScores: { str: 8, dex: 12, con: 12, int: 18, wis: 10, cha: 10 } })
  const characterId = character.body.character.id
  const root = `/campaigns/${campaignId}/players/${playerId}/characters/${characterId}`
  const secondPlayer = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName: 'Other' })
  const otherPlayerId = secondPlayer.body.player.playerId
  const otherCharacter = await request(`/campaigns/${campaignId}/players/${otherPlayerId}/characters`, 'POST', { name: 'Guest', species: 'Elf', class: 'Bard', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 16 } })
  const otherCharacterId = otherCharacter.body.character.id

  const initial = await request(`${root}/spellcasting`)
  assert.equal(initial.status, 200)
  assert.equal(initial.body.config.enabled, false)
  assert.deepEqual(initial.body.spells, [])
  assert.deepEqual(initial.body.slots, [])
  const library = await request(`${root}/spell-library?search=aether&level=0&school=Evocation`)
  assert.equal(library.status, 200)
  assert.equal(library.body.spells.length, 1)
  assert.equal(library.body.spells[0].id, 'rf-spark-bolt')
  assert.equal((await request(`${root}/spell-library?level=10`)).status, 400)
  assert.equal((await request(`${root}/spellcasting/config`, 'PUT', { enabled: true, ability: 'str', notes: '' })).status, 400)

  const configured = await request(`${root}/spellcasting/config`, 'PUT', { enabled: true, ability: 'int', notes: 'Prepared list maintained manually' })
  assert.equal(configured.status, 200)
  assert.equal(configured.body.config.spellAttackBonus, 7)
  assert.equal(configured.body.config.spellSaveDc, 15)
  const incomplete = await request(`${root}/spellcasting/config`, 'PUT', { enabled: true, ability: null, notes: '' })
  assert.equal(incomplete.body.config.spellAttackBonus, null)
  assert.match(incomplete.body.config.warning, /Choose a spellcasting ability/)
  await request(`${root}/spellcasting/config`, 'PUT', { enabled: true, ability: 'int', notes: '' })

  const blank = { name: 'Blank', level: 0, school: 'Evocation', castingTime: 'Action', range: 'Self', components: [], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'x' }
  assert.equal((await request(`${root}/spellbook/custom`, 'POST', blank)).status, 400)
  assert.equal((await request(`${root}/spellbook/custom`, 'POST', { ...blank, name: 'Bad level', level: 10, components: ['V'] })).status, 400)
  assert.equal((await request(`${root}/spellbook/custom`, 'POST', { ...blank, name: 'Missing material', level: 1, components: ['M'] })).status, 400)
  const customInput = { name: 'Ashen Compass', level: 1, school: 'Divination', castingTime: 'Action', range: 'Self', components: ['V', 'S', 'M'], materialDetails: 'A pinch of ash', duration: '10 minutes', concentration: true, ritual: false, description: 'A tiny coal-bright point turns toward a place you have visited.' }
  const custom = await request(`${root}/spellbook/custom`, 'POST', customInput)
  assert.equal(custom.status, 201)
  assert.equal(custom.body.spell.prepared, false)
  const customId = custom.body.spell.id
  const cantrip = await request(`${root}/spellbook`, 'POST', { spellId: 'rf-spark-bolt' })
  assert.equal(cantrip.status, 201)
  assert.equal(cantrip.body.spell.level, 0)
  assert.equal((await request(`${root}/spellcasting`)).body.spells[0].effectType, 'none')
  assert.equal((await request(`${root}/spellbook`, 'POST', { spellId: 'rf-spark-bolt' })).status, 409)
  assert.equal((await request(`${root}/spellbook`, 'POST', { spellId: 'not-real' })).status, 404)
  assert.equal((await request(`${root}/spellbook/${customId}`, 'PATCH', { prepared: true })).body.spell.prepared, true)
  assert.equal((await request(`${root}/spellbook/${customId}`, 'PATCH', { prepared: false })).body.spell.prepared, false)
  assert.equal((await request(`${root}/spellbook/${customId}`, 'PATCH', { prepared: true })).body.spell.prepared, true)
  assert.equal((await request(`${root}/spellbook/${customId}`, 'PATCH', { prepared: 'yes' })).status, 400)
  const otherScope = `/campaigns/${campaignId}/players/${otherPlayerId}/characters/${otherCharacterId}`
  assert.equal((await request(`${otherScope}/spellbook/${customId}`, 'PATCH', { prepared: false })).status, 404)
  assert.equal((await request(`${otherScope}/spellbook`, 'POST', { spellId: customId })).status, 404)

  for (const invalid of [0, 10, 1.5]) assert.equal((await request(`${root}/spell-slots/${invalid}`, 'PUT', { maximum: 1, remaining: 1 })).status, 400)
  assert.equal((await request(`${root}/spell-slots/1`, 'PUT', { maximum: 2, remaining: 3 })).status, 400)
  assert.equal((await request(`${root}/spell-slots/1`, 'PUT', { maximum: -1, remaining: 0 })).status, 400)
  assert.equal((await request(`${root}/spell-slots/1`, 'PUT', { maximum: 100, remaining: 0 })).status, 400)
  assert.deepEqual((await request(`${root}/spell-slots/1`, 'PUT', { maximum: 2, remaining: 2 })).body.slot, { level: 1, maximum: 2, remaining: 2, expended: 0 })
  assert.equal((await request(`${root}/spell-slots/0/expend`, 'POST')).status, 400)
  assert.equal((await request(`${root}/spell-slots/1/expend`, 'POST')).body.slot.remaining, 1)
  assert.equal((await request(`${root}/spell-slots/1/restore`, 'POST')).body.slot.remaining, 2)
  assert.equal((await request(`${root}/spell-slots/1/restore`, 'POST')).status, 409)
  assert.deepEqual((await request(`${root}/spell-slots/restore-all`, 'POST')).body.slots[0].remaining, 2)
  assert.equal((await request(`/campaigns/${campaignId}/players/nope/characters/${characterId}/spellcasting`)).status, 404)

  const beforeRestart = (await request(`${root}/spellcasting`)).body
  await stop(); start(); await ready()
  const afterRestart = await request(`${root}/spellcasting`)
  assert.deepEqual(afterRestart.body, beforeRestart)
  assert.deepEqual((await request(`${root}/spell-library?search=Ashen`)).body.spells.map((spell) => spell.id), [customId])
  assert.equal((await request(`${root}/spellbook/${customId}`, 'DELETE')).status, 204)
  assert.equal((await request(`${root}/spellcasting`)).body.spells.some((spell) => spell.id === customId), false)
  assert.equal((await request(`${root}/spellbook/rf-spark-bolt`, 'DELETE')).status, 204)
})
