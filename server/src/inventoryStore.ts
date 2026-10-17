import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')

namespace inventoryStore {
  export const categories = ['weapon', 'armor', 'shield', 'adventuring_gear', 'consumable', 'treasure', 'other'] as const
  export type InventoryCategory = typeof categories[number]
  export const equipmentSlots = ['armor', 'shield', 'main_hand', 'off_hand'] as const
  export type EquipmentSlot = typeof equipmentSlots[number]
  export const armorDefinitions = [
    'padded', 'leather', 'studded_leather', 'hide', 'chain_shirt', 'scale_mail',
    'breastplate', 'half_plate', 'ring_mail', 'chain_mail', 'splint', 'plate',
  ] as const
  export const weaponDefinitions = [
    'club', 'dagger', 'handaxe', 'mace', 'quarterstaff', 'spear', 'shortsword',
    'longsword', 'rapier', 'greatsword', 'shortbow', 'longbow', 'light_crossbow',
  ] as const
  export const finesseWeapons = ['dagger', 'shortsword', 'rapier'] as const
  // Initial compatibility is intentionally narrow: armor→armor, shield→shield, weapon→either hand.
  const compatibleCategory: Record<EquipmentSlot, InventoryCategory> = {
    armor: 'armor', shield: 'shield', main_hand: 'weapon', off_hand: 'weapon',
  }

  export interface InventoryItemInput {
    name: string
    category: InventoryCategory
    quantity: number
    weight: number | null
    notes: string
    equipped: boolean
    armorDefinitionId?: string | null
    weaponDefinitionId?: string | null
    weaponAbility?: 'str' | 'dex' | null
    manualAttackBonus?: number | null
  }

  export interface InventoryItem extends InventoryItemInput {
    id: string
    characterId: string
    equipmentSlot: EquipmentSlot | null
    armorDefinitionId: string | null
    weaponDefinitionId: string | null
    weaponAbility: 'str' | 'dex' | null
    manualAttackBonus: number | null
    createdAt: string
    updatedAt: string
  }

  export interface EquipResult { item?: InventoryItem; conflict?: InventoryItem }

  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  function requireCharacter(campaignId: string, playerId: string, characterId: string): void {
    const row = database.prepare(`
      SELECT 1
      FROM characters c
      JOIN campaign_memberships m ON m.id = c.membershipId
      WHERE c.id = ? AND m.campaignId = ? AND m.playerId = ?
    `).get(characterId, campaignId, playerId)
    if (!row) throw new HttpError(404, 'Character not found for this player and campaign.')
  }

  function getItem(campaignId: string, playerId: string, characterId: string, itemId: string): InventoryItem {
    const row = database.prepare(`
      SELECT i.id, i.characterId, i.name, i.category, i.quantity, i.weight, i.notes,
        i.equipped, i.equipmentSlot, i.armorDefinitionId, i.weaponDefinitionId,
        i.weaponAbility, i.manualAttackBonus, i.createdAt, i.updatedAt
      FROM inventory_items i
      JOIN characters c ON c.id = i.characterId
      JOIN campaign_memberships m ON m.id = c.membershipId
      WHERE i.id = ? AND i.characterId = ? AND m.campaignId = ? AND m.playerId = ?
    `).get(itemId, characterId, campaignId, playerId)
    if (!row) throw new HttpError(404, 'Inventory item not found for this character.')
    const item = row as unknown as Omit<InventoryItem, 'equipped'> & { equipped: number }
    return { ...item, equipped: item.equipped === 1 }
  }

  export function listItems(campaignId: string, playerId: string, characterId: string): InventoryItem[] {
    requireCharacter(campaignId, playerId, characterId)
    const rows = database.prepare(`
      SELECT id, characterId, name, category, quantity, weight, notes, equipped, equipmentSlot,
        armorDefinitionId, weaponDefinitionId, weaponAbility, manualAttackBonus, createdAt, updatedAt
      FROM inventory_items
      WHERE characterId = ?
      ORDER BY updatedAt DESC, createdAt DESC, rowid DESC
    `).all(characterId) as unknown as (Omit<InventoryItem, 'equipped'> & { equipped: number })[]
    return rows.map((item) => ({ ...item, equipped: item.equipped === 1 }))
  }

  export function createItem(campaignId: string, playerId: string, characterId: string, input: InventoryItemInput): InventoryItem {
    return transaction(() => {
      requireCharacter(campaignId, playerId, characterId)
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      database.prepare(`
        INSERT INTO inventory_items (
          id, characterId, name, category, quantity, weight, notes, equipped,
          armorDefinitionId, weaponDefinitionId, weaponAbility, manualAttackBonus, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, characterId, input.name, input.category, input.quantity, input.weight,
        input.notes, input.equipped ? 1 : 0, input.armorDefinitionId ?? null, input.weaponDefinitionId ?? null,
        input.weaponAbility ?? null, input.manualAttackBonus ?? null, now, now)
      return getItem(campaignId, playerId, characterId, id)
    })
  }

  export function updateItem(campaignId: string, playerId: string, characterId: string, itemId: string, input: InventoryItemInput): InventoryItem {
    return transaction(() => {
      requireCharacter(campaignId, playerId, characterId)
      const existing = getItem(campaignId, playerId, characterId, itemId)
      if (existing.equipmentSlot && compatibleCategory[existing.equipmentSlot] !== input.category) {
        throw new HttpError(400, 'Change the item’s equipment slot before changing it to an incompatible category.', {
          category: 'This category is incompatible with the item’s assigned equipment slot.',
        })
      }
      const armorDefinitionId = input.armorDefinitionId === undefined ? existing.armorDefinitionId : input.armorDefinitionId
      const weaponDefinitionId = input.weaponDefinitionId === undefined ? existing.weaponDefinitionId : input.weaponDefinitionId
      const weaponAbility = input.weaponAbility === undefined ? existing.weaponAbility : input.weaponAbility
      const manualAttackBonus = input.manualAttackBonus === undefined ? existing.manualAttackBonus : input.manualAttackBonus
      if (armorDefinitionId && input.category !== 'armor') throw new HttpError(400, 'Armor definitions can only be assigned to armor items.')
      if (weaponDefinitionId && input.category !== 'weapon') throw new HttpError(400, 'Weapon definitions can only be assigned to weapon items.')
      if (manualAttackBonus !== null && input.category !== 'weapon') throw new HttpError(400, 'Manual attack bonuses can only be assigned to weapon items.')
      if (weaponAbility !== null && (!weaponDefinitionId || !(finesseWeapons as readonly string[]).includes(weaponDefinitionId))) {
        throw new HttpError(400, 'Choose an attack ability only for a configured finesse weapon.')
      }
      database.prepare(`
        UPDATE inventory_items
        SET name = ?, category = ?, quantity = ?, weight = ?, notes = ?,
          equipped = CASE WHEN equipmentSlot IS NOT NULL THEN 1 ELSE ? END,
          armorDefinitionId = ?, weaponDefinitionId = ?, weaponAbility = ?, manualAttackBonus = ?, updatedAt = ?
        WHERE id = ? AND characterId = ?
      `).run(input.name, input.category, input.quantity, input.weight, input.notes,
        input.equipped ? 1 : 0, armorDefinitionId, weaponDefinitionId, weaponAbility, manualAttackBonus,
        new Date().toISOString(), itemId, characterId)
      return getItem(campaignId, playerId, characterId, itemId)
    })
  }

  export function equipItem(
    campaignId: string, playerId: string, characterId: string, itemId: string,
    slot: EquipmentSlot, replace: boolean,
  ): EquipResult {
    return transaction(() => {
      requireCharacter(campaignId, playerId, characterId)
      const item = getItem(campaignId, playerId, characterId, itemId)
      if (item.category !== compatibleCategory[slot]) {
        throw new HttpError(400, `${item.category.replace('_', ' ')} items cannot be assigned to the ${slot.replace('_', ' ')} slot.`, {
          slot: `Only ${compatibleCategory[slot]} items can use this slot.`,
        })
      }
      const occupied = database.prepare(`
        SELECT id FROM inventory_items WHERE characterId = ? AND equipmentSlot = ? AND id <> ?
      `).get(characterId, slot, itemId) as { id: string } | undefined
      if (occupied) {
        const conflict = getItem(campaignId, playerId, characterId, occupied.id)
        if (!replace) return { conflict }
        database.prepare(`
          UPDATE inventory_items SET equipmentSlot = NULL, equipped = 0, updatedAt = ? WHERE id = ? AND characterId = ?
        `).run(new Date().toISOString(), conflict.id, characterId)
      }
      database.prepare(`
        UPDATE inventory_items SET equipmentSlot = ?, equipped = 1, updatedAt = ? WHERE id = ? AND characterId = ?
      `).run(slot, new Date().toISOString(), itemId, characterId)
      return { item: getItem(campaignId, playerId, characterId, itemId) }
    })
  }

  export function unequipItem(campaignId: string, playerId: string, characterId: string, itemId: string): InventoryItem {
    return transaction(() => {
      requireCharacter(campaignId, playerId, characterId)
      getItem(campaignId, playerId, characterId, itemId)
      database.prepare(`
        UPDATE inventory_items SET equipmentSlot = NULL, equipped = 0, updatedAt = ? WHERE id = ? AND characterId = ?
      `).run(new Date().toISOString(), itemId, characterId)
      return getItem(campaignId, playerId, characterId, itemId)
    })
  }

  export function deleteItem(campaignId: string, playerId: string, characterId: string, itemId: string): void {
    transaction(() => {
      requireCharacter(campaignId, playerId, characterId)
      getItem(campaignId, playerId, characterId, itemId)
      database.prepare('DELETE FROM inventory_items WHERE id = ? AND characterId = ?').run(itemId, characterId)
    })
  }
}

export = inventoryStore
