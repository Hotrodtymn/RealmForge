import express = require('express')
import inventoryStore = require('./inventoryStore')

const router = express.Router()
const nameLimit = 120
const notesLimit = 2000

function objectBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null
}

function validateInput(body: Record<string, unknown>, allowDefaults: boolean): {
  input?: inventoryStore.InventoryItemInput
  errors: Record<string, string>
} {
  const errors: Record<string, string> = {}
  const rawName = body.name
  let name = ''
  if (typeof rawName !== 'string') {
    errors.name = 'Item name is required.'
  } else {
    name = rawName.trim()
    if (!name) errors.name = 'Item name is required.'
    else if (name.length > nameLimit) errors.name = `Name must be ${nameLimit} characters or fewer.`
  }

  const rawCategory = body.category === undefined && allowDefaults ? 'other' : body.category
  let category: inventoryStore.InventoryCategory = 'other'
  if (typeof rawCategory !== 'string' || !inventoryStore.categories.includes(rawCategory as inventoryStore.InventoryCategory)) {
    errors.category = `Category must be one of: ${inventoryStore.categories.join(', ')}.`
  } else {
    category = rawCategory as inventoryStore.InventoryCategory
  }

  function optionalDefinition(field: 'armorDefinitionId' | 'weaponDefinitionId', allowed: readonly string[]): string | null | undefined {
    const value = body[field]
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    if (typeof value !== 'string' || !allowed.includes(value)) {
      errors[field] = `Choose a supported ${field === 'armorDefinitionId' ? 'armor' : 'weapon'} definition or leave it unconfigured.`
      return null
    }
    return value
  }
  const armorDefinitionId = optionalDefinition('armorDefinitionId', inventoryStore.armorDefinitions)
  const weaponDefinitionId = optionalDefinition('weaponDefinitionId', inventoryStore.weaponDefinitions)
  const weaponAbilityRaw = body.weaponAbility
  let weaponAbility: 'str' | 'dex' | null | undefined
  if (weaponAbilityRaw === undefined) weaponAbility = undefined
  else if (weaponAbilityRaw === null || weaponAbilityRaw === '') weaponAbility = null
  else if (weaponAbilityRaw === 'str' || weaponAbilityRaw === 'dex') weaponAbility = weaponAbilityRaw
  else { errors.weaponAbility = 'Weapon ability must be Strength or Dexterity.'; weaponAbility = null }
  const manualAttackRaw = body.manualAttackBonus
  let manualAttackBonus: number | null | undefined
  if (manualAttackRaw === undefined) manualAttackBonus = undefined
  else if (manualAttackRaw === null || manualAttackRaw === '') manualAttackBonus = null
  else if (!Number.isSafeInteger(manualAttackRaw) || (manualAttackRaw as number) < -20 || (manualAttackRaw as number) > 50) {
    errors.manualAttackBonus = 'Manual attack bonus must be a whole number from -20 to 50.'
    manualAttackBonus = null
  } else manualAttackBonus = manualAttackRaw as number

  if (armorDefinitionId != null && category !== 'armor') errors.armorDefinitionId = 'Armor definitions can only be assigned to armor items.'
  if (weaponDefinitionId != null && category !== 'weapon') errors.weaponDefinitionId = 'Weapon definitions can only be assigned to weapon items.'
  if (weaponAbility != null && (!weaponDefinitionId || !inventoryStore.finesseWeapons.includes(weaponDefinitionId as typeof inventoryStore.finesseWeapons[number]))) {
    errors.weaponAbility = 'Choose an attack ability only for a configured finesse weapon.'
  }
  if (manualAttackBonus != null && category !== 'weapon') errors.manualAttackBonus = 'Manual attack bonuses can only be assigned to weapon items.'

  const rawQuantity = body.quantity === undefined && allowDefaults ? 1 : body.quantity
  let quantity = 1
  if (!Number.isSafeInteger(rawQuantity) || (rawQuantity as number) < 1) {
    errors.quantity = 'Quantity must be a positive whole number.'
  } else {
    quantity = rawQuantity as number
  }

  let weight: number | null = null
  if (body.weight !== undefined && body.weight !== null) {
    if (typeof body.weight !== 'number' || !Number.isFinite(body.weight) || body.weight < 0) {
      errors.weight = 'Weight must be a nonnegative number or left blank.'
    } else {
      weight = body.weight
    }
  }

  let notes = ''
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') errors.notes = 'Notes must be text.'
    else if (body.notes.length > notesLimit) errors.notes = `Notes must be ${notesLimit} characters or fewer.`
    else notes = body.notes.trim()
  }

  let equipped = false
  if (body.equipped !== undefined) {
    if (typeof body.equipped !== 'boolean') errors.equipped = 'Equipped must be true or false.'
    else equipped = body.equipped
  }

  return {
    ...(Object.keys(errors).length === 0 ? { input: {
      name, category, quantity, weight, notes, equipped,
      ...(armorDefinitionId === undefined ? {} : { armorDefinitionId }),
      ...(weaponDefinitionId === undefined ? {} : { weaponDefinitionId }),
      ...(weaponAbility === undefined ? {} : { weaponAbility }),
      ...(manualAttackBonus === undefined ? {} : { manualAttackBonus }),
    } } : {}),
    errors,
  }
}

router.get('/:campaignId/players/:playerId/characters/:characterId/inventory', (request, response, next) => {
  try {
    response.json({ items: inventoryStore.listItems(request.params.campaignId, request.params.playerId, request.params.characterId) })
  } catch (error) {
    next(error)
  }
})

router.post('/:campaignId/players/:playerId/characters/:characterId/inventory', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) {
    response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } })
    return
  }
  const { input, errors } = validateInput(body, true)
  if (!input) {
    response.status(400).json({ error: 'Validation failed', fields: errors })
    return
  }
  try {
    response.status(201).json({ item: inventoryStore.createItem(
      request.params.campaignId, request.params.playerId, request.params.characterId, input,
    ) })
  } catch (error) {
    next(error)
  }
})

router.put('/:campaignId/players/:playerId/characters/:characterId/inventory/:itemId', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) {
    response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } })
    return
  }
  const { input, errors } = validateInput(body, false)
  if (!input) {
    response.status(400).json({ error: 'Validation failed', fields: errors })
    return
  }
  try {
    response.json({ item: inventoryStore.updateItem(
      request.params.campaignId, request.params.playerId, request.params.characterId, request.params.itemId, input,
    ) })
  } catch (error) {
    next(error)
  }
})

router.delete('/:campaignId/players/:playerId/characters/:characterId/inventory/:itemId', (request, response, next) => {
  try {
    inventoryStore.deleteItem(request.params.campaignId, request.params.playerId, request.params.characterId, request.params.itemId)
    response.json({ deleted: true })
  } catch (error) {
    next(error)
  }
})

router.post('/:campaignId/players/:playerId/characters/:characterId/inventory/:itemId/equip', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body || typeof body.slot !== 'string' || !inventoryStore.equipmentSlots.includes(body.slot as inventoryStore.EquipmentSlot)) {
    response.status(400).json({ error: 'Validation failed', fields: { slot: `Slot must be one of: ${inventoryStore.equipmentSlots.join(', ')}.` } })
    return
  }
  if (body.replace !== undefined && typeof body.replace !== 'boolean') {
    response.status(400).json({ error: 'Validation failed', fields: { replace: 'Replace must be true or false.' } })
    return
  }
  try {
    const result = inventoryStore.equipItem(
      request.params.campaignId, request.params.playerId, request.params.characterId,
      request.params.itemId, body.slot as inventoryStore.EquipmentSlot, body.replace === true,
    )
    if (result.conflict) {
      response.status(409).json({ error: `The ${body.slot.replace('_', ' ')} slot is occupied by ${result.conflict.name}.`, conflict: result.conflict })
      return
    }
    response.json({ item: result.item })
  } catch (error) {
    next(error)
  }
})

router.post('/:campaignId/players/:playerId/characters/:characterId/inventory/:itemId/unequip', (request, response, next) => {
  try {
    response.json({ item: inventoryStore.unequipItem(
      request.params.campaignId, request.params.playerId, request.params.characterId, request.params.itemId,
    ) })
  } catch (error) {
    next(error)
  }
})

export = router
