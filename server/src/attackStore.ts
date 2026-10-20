import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import attackRules = require('./attackRules')
import damageRules = require('./damageRules')
import actionEconomyStore = require('./actionEconomyStore')
import conditionRules = require('./conditionRules')
import conditionStore = require('./conditionStore')

namespace attackStore {
  export interface AttackInput {
    attackerId: string
    targetId: string
    weaponId?: string
    weaponUse?: 'one_handed' | 'two_handed'
    mode: attackRules.AttackMode
    situationalModifier: number
    consumeAction?: boolean
    actionId?: string
    context?: conditionRules.AttackContext
    dmOverride?: boolean
    overrideReason?: string
  }
  export interface AttackRecord extends attackRules.AttackResolution {
    id: string
    encounterId: string
    attackerId: string
    attackerName: string
    targetId: string
    targetName: string
    weaponId: string | null
    weaponName: string | null
    weaponDefinitionId: string | null
    weaponUse: 'one_handed' | 'two_handed' | null
    damageDiceCount: number | null
    damageDieSize: number | null
    versatileDamageDiceCount: number | null
    versatileDamageDieSize: number | null
    damageType: damageRules.DamageType | null
    damageAbility: damageRules.Ability | null
    damageAbilityModifier: number | null
    enemyDamageFormula: string | null
    enemyDamageType: damageRules.DamageType | null
    createdAt: string
    conditionSnapshot: { manualMode: attackRules.AttackMode; mode: attackRules.AttackMode; advantageSources: string[]; disadvantageSources: string[]; warnings: string[]; blockedReason: string | null; criticalOnHit: boolean; appliedContext: conditionRules.AttackContext; exhaustionLevel?: number; exhaustionPenalty?: number; dmOverride?: boolean; overrideReason?: string }
  }

  const weapons: Record<string, { name: string; ability: 'str' | 'dex'; finesse: boolean }> = {
    club: { name: 'Club', ability: 'str', finesse: false }, dagger: { name: 'Dagger', ability: 'str', finesse: true },
    handaxe: { name: 'Handaxe', ability: 'str', finesse: false }, mace: { name: 'Mace', ability: 'str', finesse: false },
    quarterstaff: { name: 'Quarterstaff', ability: 'str', finesse: false }, spear: { name: 'Spear', ability: 'str', finesse: false },
    shortsword: { name: 'Shortsword', ability: 'str', finesse: true }, longsword: { name: 'Longsword', ability: 'str', finesse: false },
    rapier: { name: 'Rapier', ability: 'str', finesse: true }, greatsword: { name: 'Greatsword', ability: 'str', finesse: false },
    shortbow: { name: 'Shortbow', ability: 'dex', finesse: false }, longbow: { name: 'Longbow', ability: 'dex', finesse: false },
    light_crossbow: { name: 'Light Crossbow', ability: 'dex', finesse: false },
  }
  const armor: Record<string, { name: string; baseAc: number; weight: 'light' | 'medium' | 'heavy' }> = {
    padded: { name: 'Padded', baseAc: 11, weight: 'light' }, leather: { name: 'Leather', baseAc: 11, weight: 'light' },
    studded_leather: { name: 'Studded Leather', baseAc: 12, weight: 'light' }, hide: { name: 'Hide', baseAc: 12, weight: 'medium' },
    chain_shirt: { name: 'Chain Shirt', baseAc: 13, weight: 'medium' }, scale_mail: { name: 'Scale Mail', baseAc: 14, weight: 'medium' },
    breastplate: { name: 'Breastplate', baseAc: 14, weight: 'medium' }, half_plate: { name: 'Half Plate', baseAc: 15, weight: 'medium' },
    ring_mail: { name: 'Ring Mail', baseAc: 14, weight: 'heavy' }, chain_mail: { name: 'Chain Mail', baseAc: 16, weight: 'heavy' },
    splint: { name: 'Splint', baseAc: 17, weight: 'heavy' }, plate: { name: 'Plate', baseAc: 18, weight: 'heavy' },
  }
  const signed = (n: number) => n >= 0 ? `+${n}` : String(n)
  const profBonus = (level: number) => 2 + Math.floor((level - 1) / 4)

  function combatant(encounterId: string, id: string) {
    const row = database.prepare(`SELECT id, characterId, type, name, attackModifier, armorClassOverride, damageFormula, damageType, survivalStatus FROM encounter_combatants WHERE id = ? AND encounterId = ?`).get(id, encounterId) as {
      id: string; characterId: string | null; type: 'player' | 'enemy'; name: string; attackModifier: number | null; armorClassOverride: number | null; damageFormula: string | null; damageType: string | null; survivalStatus: string
    } | undefined
    if (!row) throw new HttpError(404, 'Combatant not found in this encounter.')
    return row
  }

  interface PlayerAttackConfig {
    bonus: number
    weaponName: string
    weaponDefinitionId: string | null
    weaponUse: 'one_handed' | 'two_handed' | null
    damageDiceCount: number | null
    damageDieSize: number | null
    versatileDamageDiceCount: number | null
    versatileDamageDieSize: number | null
    damageType: damageRules.DamageType | null
    damageAbility: damageRules.Ability | null
    damageAbilityModifier: number | null
  }

  function playerAttackBonus(campaignId: string, characterId: string, weaponId: string, requestedUse?: 'one_handed' | 'two_handed'): PlayerAttackConfig {
    const character = database.prepare(`
      SELECT c.level, c.str, c.dex, c.con, c.int, c.wis, c.cha
      FROM characters c JOIN campaign_memberships m ON m.id = c.membershipId
      WHERE c.id = ? AND m.campaignId = ?
    `).get(characterId, campaignId) as { level: number; str: number; dex: number; con: number; int: number; wis: number; cha: number } | undefined
    if (!character) throw new HttpError(404, 'Attacking character is not part of this campaign.')
    const item = database.prepare(`
      SELECT id, name, category, equipmentSlot, equipped, weaponDefinitionId, weaponAbility, manualAttackBonus
      FROM inventory_items WHERE id = ? AND characterId = ?
    `).get(weaponId, characterId) as { id: string; name: string; category: string; equipmentSlot: string | null; equipped: number; weaponDefinitionId: string | null; weaponAbility: 'str' | 'dex' | null; manualAttackBonus: number | null } | undefined
    if (!item || item.category !== 'weapon' || !item.equipped || !['main_hand', 'off_hand'].includes(item.equipmentSlot ?? '')) {
      throw new HttpError(404, 'Choose a weapon currently equipped by the attacking character.')
    }
    const definition = item.weaponDefinitionId ? weapons[item.weaponDefinitionId] : undefined
    const damage = item.weaponDefinitionId ? damageRules.weaponDamage[item.weaponDefinitionId] : undefined
    if (item.manualAttackBonus === null && !definition) throw new HttpError(400, `${item.name} has no configured attack bonus. Configure its weapon or manual bonus in inventory.`)
    if (requestedUse && !damage?.versatileDiceCount) throw new HttpError(400, `${item.name} is not a versatile weapon.`)
    const weaponUse = damage?.versatileDiceCount ? requestedUse ?? 'one_handed' : null
    if (weaponUse === 'two_handed') {
      if (item.equipmentSlot !== 'main_hand') throw new HttpError(400, 'A versatile weapon must be equipped in the main hand to use it two-handed.')
      const occupiedHand = database.prepare(`SELECT id FROM inventory_items WHERE characterId = ? AND id <> ? AND equipmentSlot IN ('off_hand', 'shield')`).get(characterId, weaponId)
      if (occupiedHand) throw new HttpError(409, 'Unequip the off-hand item or shield before using this weapon two-handed.')
    }
    const ability = definition ? (definition.finesse && item.weaponAbility ? item.weaponAbility : definition.ability) : null
    if (definition && !definition.finesse && item.weaponAbility && item.weaponAbility !== definition.ability) throw new HttpError(400, 'This weapon has an invalid configured attack ability.')
    const score = ability ? character[ability] : null
    const abilityBonus = score === null ? null : Math.floor((score - 10) / 2)
    const proficient = Boolean(item.weaponDefinitionId && database.prepare('SELECT 1 FROM character_weapon_proficiencies WHERE characterId = ? AND weaponDefinitionId = ?').get(characterId, item.weaponDefinitionId))
    const bonus = item.manualAttackBonus ?? (abilityBonus! + (proficient ? profBonus(character.level) : 0))
    return {
      bonus, weaponName: item.name, weaponDefinitionId: item.weaponDefinitionId, weaponUse,
      damageDiceCount: damage ? (weaponUse === 'two_handed' ? damage.versatileDiceCount! : damage.diceCount) : null,
      damageDieSize: damage ? (weaponUse === 'two_handed' ? damage.versatileDieSize! : damage.dieSize) : null,
      versatileDamageDiceCount: damage?.versatileDiceCount ?? null, versatileDamageDieSize: damage?.versatileDieSize ?? null,
      damageType: damage?.type ?? null, damageAbilityModifier: damage ? abilityBonus : null,
      damageAbility: damage ? ability : null,
    }
  }

  function playerArmorClass(campaignId: string, characterId: string): number {
    const character = database.prepare(`
      SELECT c.dex, c.manualAcOverride FROM characters c
      JOIN campaign_memberships m ON m.id = c.membershipId WHERE c.id = ? AND m.campaignId = ?
    `).get(characterId, campaignId) as { dex: number; manualAcOverride: number | null } | undefined
    if (!character) throw new HttpError(404, 'Target character is not part of this campaign.')
    if (character.manualAcOverride !== null) return character.manualAcOverride
    const items = database.prepare(`SELECT category, equipmentSlot, armorDefinitionId FROM inventory_items WHERE characterId = ? AND equipped = 1`).all(characterId) as { category: string; equipmentSlot: string | null; armorDefinitionId: string | null }[]
    const armorItem = items.find((item) => item.category === 'armor' && item.equipmentSlot === 'armor')
    const shield = items.some((item) => item.category === 'shield' && item.equipmentSlot === 'shield')
    let baseAc = 10
    let dexMod = Math.floor((character.dex - 10) / 2)
    if (armorItem) {
      const definition = armorItem.armorDefinitionId ? armor[armorItem.armorDefinitionId] : undefined
      if (!definition) throw new HttpError(409, 'Target has equipped armor without a configured AC value.')
      baseAc = definition.baseAc
      if (definition.weight === 'heavy') dexMod = 0
      else if (definition.weight === 'medium') dexMod = Math.min(2, dexMod)
    }
    return baseAc + dexMod + (shield ? 2 : 0)
  }

  export function targetArmorClass(campaignId: string, encounterId: string, targetId: string): number {
    if (!database.prepare('SELECT 1 FROM encounters WHERE id = ? AND campaignId = ?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
    const target = combatant(encounterId, targetId)
    const value = target.type === 'enemy'
      ? target.armorClassOverride ?? (() => { throw new HttpError(409, `${target.name} has no configured AC.`) })()
      : playerArmorClass(campaignId, target.characterId!)
    if (value < 1 || value > 50) throw new HttpError(409, 'Target AC is outside the supported range.')
    return value
  }

  function rowToRecord(row: Record<string, unknown>): AttackRecord {
    const savedConditionSnapshot = JSON.parse((row.conditionSnapshot as string | undefined) ?? '{}') as Partial<AttackRecord['conditionSnapshot']>
    const conditionSnapshot = Array.isArray(savedConditionSnapshot.advantageSources) && Array.isArray(savedConditionSnapshot.disadvantageSources) && Array.isArray(savedConditionSnapshot.warnings)
      ? savedConditionSnapshot as AttackRecord['conditionSnapshot']
      : { manualMode: row.mode as attackRules.AttackMode, mode: row.mode as attackRules.AttackMode, advantageSources: [], disadvantageSources: [], warnings: [], blockedReason: null, criticalOnHit: false, appliedContext: {} }
    return {
      ...row,
      diceResults: JSON.parse(row.diceResults as string) as number[],
      conditionSnapshot,
      isCritical: row.outcome === 'critical_hit',
      breakdown: `d20 (${(JSON.parse(row.diceResults as string) as number[]).map((die, index) => `${die}${index === row.keptIndex ? ' kept' : ''}`).join(' / ')}) ${signed(row.attackBonus as number)} attack bonus ${signed(row.situationalModifier as number)} situational modifier = ${row.total}`,
    } as unknown as AttackRecord
  }

  const selectAttack = `SELECT id, encounterId, attackerId, attackerName, targetId, targetName, weaponId, weaponName, mode, diceResults, keptIndex, attackBonus, situationalModifier, total, targetAC, outcome, weaponDefinitionId, weaponUse, damageDiceCount, damageDieSize, versatileDamageDiceCount, versatileDamageDieSize, damageType, damageAbility, damageAbilityModifier, enemyDamageFormula, enemyDamageType, conditionSnapshot, createdAt FROM encounter_attacks`

  export function list(campaignId: string, encounterId: string): AttackRecord[] {
    if (!database.prepare('SELECT 1 FROM encounters WHERE id = ? AND campaignId = ?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
    return (database.prepare(`${selectAttack} WHERE encounterId = ? ORDER BY createdAt DESC, rowid DESC LIMIT 20`).all(encounterId) as unknown as Record<string, unknown>[]).map(rowToRecord)
  }

  export function create(campaignId: string, encounterId: string, input: AttackInput): AttackRecord {
    database.exec('BEGIN IMMEDIATE')
    try {
      if (!database.prepare('SELECT 1 FROM encounters WHERE id = ? AND campaignId = ?').get(encounterId, campaignId)) throw new HttpError(404, 'Encounter not found for this campaign.')
      const attacker = combatant(encounterId, input.attackerId)
      const target = combatant(encounterId, input.targetId)
      if (attacker.id === target.id) throw new HttpError(400, 'Attacker and target must be different combatants.')
      const conditionRows = database.prepare('SELECT combatantId, condition, sourceCombatantId, level FROM combatant_conditions WHERE combatantId IN (?, ?)').all(attacker.id, target.id) as { combatantId: string; condition: conditionRules.ConditionKey; sourceCombatantId: string | null; level: number | null }[]
      const attackerConditions = conditionRows.filter((entry) => entry.combatantId === attacker.id)
      const targetConditions = conditionRows.filter((entry) => entry.combatantId === target.id)
      const actionBlock = conditionRules.attackActionBlock(attackerConditions) ?? (attacker.survivalStatus === 'dead' ? 'A dead combatant cannot make attacks.' : null)
      if (actionBlock && (input.dmOverride !== true || !input.overrideReason?.trim())) throw new HttpError(409, `${actionBlock} A DM override requires an explicit reason.`)
      if (actionBlock) {
        if (!input.actionId) throw new HttpError(400, 'A unique action ID is required to record a DM override.')
        conditionStore.recordDmOverrideInTransaction(encounterId, attacker.id, input.overrideReason!.trim(), [...conditionRules.preventsActions(attackerConditions).map((entry) => entry.condition), ...(attacker.survivalStatus === 'dead' ? ['dead'] : [])], input.actionId)
      }
      const conditionSnapshot = conditionRules.attackEffects(attacker.id, target.id, attackerConditions, targetConditions, input.mode, input.context)
      if (conditionSnapshot.blockedReason) throw new HttpError(409, conditionSnapshot.blockedReason)
      let attackBonus: number
      let weaponId: string | null = null
      let weaponName: string | null = null
      let weaponDefinitionId: string | null = null
      let weaponUse: 'one_handed' | 'two_handed' | null = null
      let damageDiceCount: number | null = null
      let damageDieSize: number | null = null
      let versatileDamageDiceCount: number | null = null
      let versatileDamageDieSize: number | null = null
      let damageType: damageRules.DamageType | null = null
      let damageAbility: damageRules.Ability | null = null
      let damageAbilityModifier: number | null = null
      let enemyDamageFormula: string | null = null
      let enemyDamageType: damageRules.DamageType | null = null
      if (attacker.type === 'enemy') {
        if (input.weaponId || input.weaponUse) throw new HttpError(400, 'Enemy attacks use the enemy’s configured manual attack bonus and damage formula.')
        if (attacker.attackModifier === null) throw new HttpError(409, `${attacker.name} has no configured attack bonus.`)
        attackBonus = attacker.attackModifier
        enemyDamageFormula = attacker.damageFormula
        enemyDamageType = attacker.damageType as damageRules.DamageType | null
      } else {
        if (!input.weaponId) throw new HttpError(400, 'Select an equipped, configured weapon for this character.')
        const result = playerAttackBonus(campaignId, attacker.characterId!, input.weaponId, input.weaponUse)
        attackBonus = result.bonus; weaponId = input.weaponId; weaponName = result.weaponName
        weaponDefinitionId = result.weaponDefinitionId; weaponUse = result.weaponUse
        damageDiceCount = result.damageDiceCount; damageDieSize = result.damageDieSize
        versatileDamageDiceCount = result.versatileDamageDiceCount; versatileDamageDieSize = result.versatileDamageDieSize
        damageType = result.damageType; damageAbility = result.damageAbility; damageAbilityModifier = result.damageAbilityModifier
      }
      const exhaustionLevel = Number(attackerConditions.find((entry) => entry.condition === 'exhaustion')?.level ?? 0)
      const exhaustionPenalty = conditionRules.exhaustionPenalty(exhaustionLevel)
      attackBonus += exhaustionPenalty
      const targetAC = target.type === 'enemy'
        ? target.armorClassOverride ?? (() => { throw new HttpError(409, `${target.name} has no configured AC.`) })()
        : playerArmorClass(campaignId, target.characterId!)
      if (targetAC < 1 || targetAC > 50) throw new HttpError(409, 'Target AC is outside the supported range.')
      const result = attackRules.resolveAttack(attackBonus, targetAC, conditionSnapshot.mode, input.situationalModifier, undefined, conditionSnapshot.criticalOnHit)
      const record: AttackRecord = {
        id: crypto.randomUUID(), encounterId, attackerId: attacker.id, attackerName: attacker.name,
        targetId: target.id, targetName: target.name, weaponId, weaponName, weaponDefinitionId, weaponUse,
        damageDiceCount, damageDieSize, versatileDamageDiceCount, versatileDamageDieSize, damageType, damageAbilityModifier,
        damageAbility, enemyDamageFormula, enemyDamageType, ...result,
        conditionSnapshot: { ...conditionSnapshot, manualMode: input.mode, ...(exhaustionLevel ? { exhaustionLevel, exhaustionPenalty } : {}), ...(actionBlock ? { dmOverride: true, overrideReason: input.overrideReason!.trim() } : {}) }, createdAt: new Date().toISOString(),
      }
      database.prepare(`INSERT INTO encounter_attacks
        (id, encounterId, attackerId, attackerName, targetId, targetName, weaponId, weaponName, mode, diceResults, keptIndex, attackBonus, situationalModifier, total, targetAC, outcome,
          weaponDefinitionId, weaponUse, damageDiceCount, damageDieSize, versatileDamageDiceCount, versatileDamageDieSize, damageType, damageAbility, damageAbilityModifier, enemyDamageFormula, enemyDamageType, conditionSnapshot, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `)
        .run(record.id, encounterId, record.attackerId, record.attackerName, record.targetId, record.targetName, record.weaponId, record.weaponName,
          record.mode, JSON.stringify(record.diceResults), record.keptIndex, record.attackBonus, record.situationalModifier, record.total, record.targetAC, record.outcome,
          record.weaponDefinitionId, record.weaponUse, record.damageDiceCount, record.damageDieSize, record.versatileDamageDiceCount, record.versatileDamageDieSize,
          record.damageType, record.damageAbility, record.damageAbilityModifier, record.enemyDamageFormula, record.enemyDamageType, JSON.stringify(record.conditionSnapshot), record.createdAt)
      if (input.consumeAction) {
        if (!input.actionId) throw new HttpError(400, 'An action request ID is required when spending an Action.')
        actionEconomyStore.recordAttackAction(encounterId, attacker.id, input.actionId, input.dmOverride === true ? input.overrideReason : undefined)
      }
      database.exec('COMMIT')
      return record
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}

export = attackStore
