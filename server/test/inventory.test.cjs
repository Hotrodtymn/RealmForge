const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('inventory CRUD validates input, scopes character ownership, and persists across restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-inventory-'))
  let server
  const port = await new Promise((resolve, reject) => {
    const probe = require('node:net').createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port
      probe.close(() => resolve(value))
    })
  })
  const base = `http://127.0.0.1:${port}/api`
  t.after(async () => {
    await stopServer()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  function startServer() {
    server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir },
      stdio: 'ignore',
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
      try {
        const response = await fetch(`${base}/health`)
        if (response.ok) return
      } catch {}
      await delay(100)
    }
    throw new Error('Server did not become ready')
  }

  async function request(route, method = 'GET', body) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }

  startServer()
  await waitForServer()
  const campaignResult = await request('/campaigns', 'POST', { name: 'Inventory test', description: '', setting: '' })
  assert.equal(campaignResult.status, 201)
  const campaignId = campaignResult.body.campaign.id
  const playerResult = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName: 'Aria' })
  assert.equal(playerResult.status, 201)
  const playerId = playerResult.body.player.playerId
  const characterResult = await request(`/campaigns/${campaignId}/players/${playerId}/characters`, 'POST', {
    name: 'Ash', species: 'Elf', class: 'Ranger', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  })
  assert.equal(characterResult.status, 201)
  const characterId = characterResult.body.character.id
  const inventoryRoute = `/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/inventory`
  const secondPlayerResult = await request(`/campaigns/${campaignId}/players`, 'POST', { displayName: 'Borin' })
  const secondPlayerId = secondPlayerResult.body.player.playerId
  const secondCharacterResult = await request(`/campaigns/${campaignId}/players/${secondPlayerId}/characters`, 'POST', {
    name: 'Stone', species: 'Dwarf', class: 'Fighter', abilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 10, cha: 10 },
  })
  const secondCharacterId = secondCharacterResult.body.character.id

  for (const invalid of [
    { name: '   ' },
    { name: 'Rations', quantity: 0 },
    { name: 'Rations', quantity: 1.5 },
    { name: 'Rations', weight: -0.1 },
    { name: 'Rations', category: 'magic' },
    { name: 'Rations', equipped: 'yes' },
    { name: 'Armor', category: 'armor', armorDefinitionId: 'not_real' },
    { name: 'Gear', category: 'adventuring_gear', weaponDefinitionId: 'dagger' },
    { name: 'Blade', category: 'weapon', weaponDefinitionId: 'dagger', weaponAbility: 'int' },
    { name: 'Blade', category: 'weapon', manualAttackBonus: 51 },
  ]) {
    const result = await request(inventoryRoute, 'POST', invalid)
    assert.equal(result.status, 400, JSON.stringify(invalid))
    assert.ok(result.body.fields)
  }

  const created = await request(inventoryRoute, 'POST', {
    name: '  Healing potion ', category: 'consumable', quantity: 2, weight: null, notes: 'Red glass', equipped: false,
  })
  assert.equal(created.status, 201)
  const itemId = created.body.item.id
  assert.equal(created.body.item.name, 'Healing potion')
  assert.equal(created.body.item.weight, null)

  const addInventoryItem = async (name, category, quantity = 1, rules = {}) => {
    const result = await request(inventoryRoute, 'POST', { name, category, quantity, weight: 1.25, notes: 'Keep intact', equipped: false, ...rules })
    assert.equal(result.status, 201)
    return result.body.item
  }
  const blade = await addInventoryItem('Iron blade', 'weapon', 2, { weaponDefinitionId: 'dagger', weaponAbility: 'dex' })
  const spareBlade = await addInventoryItem('Backup blade', 'weapon')
  assert.equal(spareBlade.weaponDefinitionId, null)
  const armor = await addInventoryItem('Leather armor', 'armor', 1, { armorDefinitionId: 'leather' })
  const shield = await addInventoryItem('Oak shield', 'shield')
  const bladeRoute = `${inventoryRoute}/${blade.id}`

  const invalidSlot = await request(`${bladeRoute}/equip`, 'POST', { slot: 'head' })
  assert.equal(invalidSlot.status, 400)
  const incompatible = await request(`${bladeRoute}/equip`, 'POST', { slot: 'armor' })
  assert.equal(incompatible.status, 400)
  const equippedBlade = await request(`${bladeRoute}/equip`, 'POST', { slot: 'main_hand' })
  assert.equal(equippedBlade.status, 200)
  assert.equal(equippedBlade.body.item.equipmentSlot, 'main_hand')
  assert.equal(equippedBlade.body.item.quantity, 2)
  assert.equal(equippedBlade.body.item.weight, 1.25)
  assert.equal(equippedBlade.body.item.notes, 'Keep intact')
  assert.equal(equippedBlade.body.item.weaponDefinitionId, 'dagger')
  assert.equal(equippedBlade.body.item.weaponAbility, 'dex')

  const occupiedSlot = await request(`${inventoryRoute}/${spareBlade.id}/equip`, 'POST', { slot: 'main_hand' })
  assert.equal(occupiedSlot.status, 409)
  assert.equal(occupiedSlot.body.conflict.id, blade.id)
  const replaced = await request(`${inventoryRoute}/${spareBlade.id}/equip`, 'POST', { slot: 'main_hand', replace: true })
  assert.equal(replaced.status, 200)
  assert.equal(replaced.body.item.equipmentSlot, 'main_hand')
  const itemsAfterReplace = (await request(inventoryRoute)).body.items
  assert.equal(itemsAfterReplace.find((item) => item.id === blade.id).equipmentSlot, null)
  assert.equal(itemsAfterReplace.find((item) => item.id === blade.id).equipped, false)

  assert.equal((await request(`${inventoryRoute}/${armor.id}/equip`, 'POST', { slot: 'armor' })).status, 200)
  assert.equal((await request(`${inventoryRoute}/${shield.id}/equip`, 'POST', { slot: 'shield' })).status, 200)
  assert.equal((await request(`${inventoryRoute}/${spareBlade.id}/unequip`, 'POST')).body.item.equipmentSlot, null)
  assert.equal((await request(`${inventoryRoute}/${spareBlade.id}/unequip`, 'POST')).body.item.equipped, false)
  const manualBlade = await request(`${inventoryRoute}/${spareBlade.id}`, 'PUT', {
    name: 'Backup blade', category: 'weapon', quantity: 1, weight: 1.25, notes: 'Keep intact', equipped: false,
    weaponDefinitionId: 'longsword', weaponAbility: null, manualAttackBonus: 5,
  })
  assert.equal(manualBlade.status, 200)
  assert.equal(manualBlade.body.item.manualAttackBonus, 5)

  const invalidUpdate = await request(`${inventoryRoute}/${itemId}`, 'PUT', {
    name: '', category: 'consumable', quantity: 1, weight: 0, notes: '', equipped: false,
  })
  assert.equal(invalidUpdate.status, 400)

  const updated = await request(`${inventoryRoute}/${itemId}`, 'PUT', {
    name: 'Healing potion', category: 'consumable', quantity: 3, weight: 0.5, notes: 'Ready to use', equipped: true,
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.body.item.quantity, 3)
  assert.equal(updated.body.item.equipped, true)

  const wrongPlayer = await request(`/campaigns/${campaignId}/players/missing/characters/${characterId}/inventory`)
  assert.equal(wrongPlayer.status, 404)
  const otherCharacter = await request(`/campaigns/${campaignId}/players/${playerId}/characters/missing/inventory/${itemId}`, 'DELETE')
  assert.equal(otherCharacter.status, 404)
  const wrongCampaign = await request(`/campaigns/missing/players/${playerId}/characters/${characterId}/inventory`)
  assert.equal(wrongCampaign.status, 404)
  const crossCharacterEquip = await request(`/campaigns/${campaignId}/players/${playerId}/characters/missing/inventory/${blade.id}/equip`, 'POST', { slot: 'main_hand' })
  assert.equal(crossCharacterEquip.status, 404)
  const anotherCharactersInventory = await request(`/campaigns/${campaignId}/players/${secondPlayerId}/characters/${secondCharacterId}/inventory/${blade.id}/equip`, 'POST', { slot: 'main_hand' })
  assert.equal(anotherCharactersInventory.status, 404)
  const mismatchedMembership = await request(`/campaigns/${campaignId}/players/${secondPlayerId}/characters/${characterId}/inventory/${blade.id}/unequip`, 'POST')
  assert.equal(mismatchedMembership.status, 404)

  const sheetBeforeRestart = await request(`/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/sheet`)
  assert.equal(sheetBeforeRestart.status, 200)
  const sheetPath = `/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/sheet`
  assert.equal((await request(sheetPath, 'PUT', { level: 1, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, savingThrowProficiencies: [], skillProficiencies: [], weaponProficiencies: ['unknown'] })).status, 400)
  assert.equal((await request(sheetPath, 'PUT', { level: 1, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, savingThrowProficiencies: [], skillProficiencies: [], manualAcOverride: 51 })).status, 400)
  const configuredSheet = await request(sheetPath, 'PUT', { level: 5, abilityScores: { str: 16, dex: 18, con: 12, int: 10, wis: 10, cha: 10 }, savingThrowProficiencies: [], skillProficiencies: [], weaponProficiencies: ['dagger'], manualAcOverride: 19 })
  assert.equal(configuredSheet.status, 200)
  assert.deepEqual(configuredSheet.body.sheet.weaponProficiencies, ['dagger'])
  assert.equal(configuredSheet.body.sheet.manualAcOverride, 19)
  const sheetStats = configuredSheet.body.sheet

  await stopServer()
  startServer()
  await waitForServer()
  const persisted = await request(inventoryRoute)
  assert.equal(persisted.status, 200)
  assert.equal(persisted.body.items.length, 5)
  assert.equal(persisted.body.items.find((item) => item.id === itemId).weight, 0.5)
  assert.equal(persisted.body.items.find((item) => item.id === armor.id).equipmentSlot, 'armor')
  assert.equal(persisted.body.items.find((item) => item.id === armor.id).armorDefinitionId, 'leather')
  assert.equal(persisted.body.items.find((item) => item.id === blade.id).weaponDefinitionId, 'dagger')
  assert.equal(persisted.body.items.find((item) => item.id === spareBlade.id).weaponDefinitionId, 'longsword')
  assert.equal(persisted.body.items.find((item) => item.id === itemId).weaponDefinitionId, null)
  assert.equal(persisted.body.items.find((item) => item.id === shield.id).equipmentSlot, 'shield')
  assert.equal(persisted.body.items.find((item) => item.id === spareBlade.id).equipmentSlot, null)
  const sheetAfterRestart = await request(`/campaigns/${campaignId}/players/${playerId}/characters/${characterId}/sheet`)
  assert.deepEqual(sheetAfterRestart.body.sheet, sheetStats)

  const deleted = await request(`${inventoryRoute}/${itemId}`, 'DELETE')
  assert.equal(deleted.status, 200)
  const remainingItems = (await request(inventoryRoute)).body.items
  assert.equal(remainingItems.length, 4)
  assert.ok(!remainingItems.some((item) => item.id === itemId))
})
