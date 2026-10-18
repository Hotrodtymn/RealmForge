import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import damageRules = require('./damageRules')
import survivalStore = require('./survivalStore')

namespace damageStore {
  export interface DamageRecord {
    id: string
    encounterId: string
    attackId: string
    attackerId: string
    attackerName: string
    targetId: string
    targetName: string
    weaponId: string | null
    weaponName: string | null
    source: 'weapon' | 'enemy'
    formula: string
    damageType: damageRules.DamageType
    diceCount: number
    dieSize: number
    diceResults: number[]
    formulaModifier: number
    ability: damageRules.Ability | null
    abilityModifier: number
    situationalModifier: number
    isCritical: boolean
    total: number
    applied: boolean
    hpBefore: number | null
    hpAfter: number | null
    createdAt: string
    appliedAt: string | null
    breakdown: string
  }

  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try { const result = operation(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }

  function requireEncounter(campaignId: string, encounterId: string): void {
    if (!database.prepare('SELECT 1 FROM encounters WHERE id = ? AND campaignId = ?').get(encounterId, campaignId)) {
      throw new HttpError(404, 'Encounter not found for this campaign.')
    }
  }

  function rowToRecord(row: Record<string, unknown>): DamageRecord {
    const diceResults = JSON.parse(row.diceResults as string) as number[]
    const modifierParts = [
      Number(row.formulaModifier) ? `formula ${Number(row.formulaModifier) > 0 ? '+' : '−'}${Math.abs(Number(row.formulaModifier))}` : '',
      row.ability ? `${String(row.ability).toUpperCase()} ${Number(row.abilityModifier) >= 0 ? '+' : '−'}${Math.abs(Number(row.abilityModifier))}` : '',
      Number(row.situationalModifier) ? `situational ${Number(row.situationalModifier) > 0 ? '+' : '−'}${Math.abs(Number(row.situationalModifier))}` : '',
    ].filter(Boolean)
    const breakdown = `${row.isCritical ? 'Critical · ' : ''}${row.formula} ${String(row.damageType)}: ${diceResults.join(' + ')}${modifierParts.length ? ` · ${modifierParts.join(' · ')}` : ''} = ${row.total}${Number(row.total) === 0 ? ' (minimum 0)' : ''}`
    return {
      ...row,
      diceResults,
      diceCount: Number(row.diceCount),
      isCritical: row.isCritical === 1,
      applied: row.applied === 1,
      breakdown,
    } as unknown as DamageRecord
  }

  const selectRoll = `SELECT id, encounterId, attackId, attackerId, attackerName, targetId, targetName,
    weaponId, weaponName, source, formula, damageType, diceCount, dieSize, diceResults, formulaModifier,
    ability, abilityModifier, situationalModifier, isCritical, total, applied, hpBefore, hpAfter, createdAt, appliedAt
    FROM encounter_damage_rolls`

  export function list(campaignId: string, encounterId: string): DamageRecord[] {
    requireEncounter(campaignId, encounterId)
    return (database.prepare(`${selectRoll} WHERE encounterId = ? ORDER BY createdAt DESC, rowid DESC`).all(encounterId) as unknown as Record<string, unknown>[]).map(rowToRecord)
  }

  export function roll(campaignId: string, encounterId: string, attackId: string, situationalModifier: number): DamageRecord {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      const attack = database.prepare(`SELECT * FROM encounter_attacks WHERE id = ? AND encounterId = ?`).get(attackId, encounterId) as Record<string, unknown> | undefined
      if (!attack) throw new HttpError(404, 'Attack was not found in this encounter.')
      if (attack.outcome !== 'hit' && attack.outcome !== 'critical_hit') throw new HttpError(409, 'Damage can only be rolled for a successful attack.')
      const attacker = database.prepare('SELECT id, characterId, type FROM encounter_combatants WHERE id = ? AND encounterId = ?').get(attack.attackerId as string, encounterId) as { id: string; characterId: string | null; type: string } | undefined
      const target = database.prepare('SELECT id, characterId, type FROM encounter_combatants WHERE id = ? AND encounterId = ?').get(attack.targetId as string, encounterId) as { id: string; characterId: string | null; type: string } | undefined
      if (!attacker || !target) throw new HttpError(404, 'Attacker or target is no longer in this encounter.')
      const critical = attack.outcome === 'critical_hit'
      let source: 'weapon' | 'enemy'
      let formula: string
      let damageType: damageRules.DamageType
      let diceCount: number
      let dieSize: number
      let formulaModifier = 0
      let ability: damageRules.Ability | null = null
      let abilityModifier = 0
      if (attack.weaponId) {
        if (attacker.type !== 'player' || !Number.isSafeInteger(attack.damageDiceCount) || !Number.isSafeInteger(attack.damageDieSize) || typeof attack.damageType !== 'string' || !['str', 'dex'].includes(attack.damageAbility as string) || !Number.isSafeInteger(attack.damageAbilityModifier)) {
          throw new HttpError(409, 'This attack has no complete structured weapon damage configuration.')
        }
        source = 'weapon'
        diceCount = attack.damageDiceCount as number
        dieSize = attack.damageDieSize as number
        damageType = attack.damageType as damageRules.DamageType
        ability = attack.damageAbility as damageRules.Ability
        abilityModifier = attack.damageAbilityModifier as number
        formula = `${diceCount}d${dieSize}`
      } else {
        if (attacker.type !== 'enemy' || typeof attack.enemyDamageFormula !== 'string' || typeof attack.enemyDamageType !== 'string') {
          throw new HttpError(409, 'This enemy has no configured damage formula.')
        }
        let parsed: damageRules.ParsedFormula
        try { parsed = damageRules.parseEnemyFormula(attack.enemyDamageFormula) }
        catch (error) { throw new HttpError(409, error instanceof Error ? error.message : 'Enemy damage formula is invalid.') }
        source = 'enemy'
        diceCount = parsed.diceCount
        dieSize = parsed.dieSize
        formulaModifier = parsed.modifier
        damageType = attack.enemyDamageType as damageRules.DamageType
        formula = attack.enemyDamageFormula
      }
      if (!damageRules.damageTypes.includes(damageType)) throw new HttpError(409, 'Damage type is not configured for this attack.')
      let result: damageRules.DamageResolution
      try {
        result = damageRules.resolveDamage({ diceCount, dieSize, formulaModifier, abilityModifier, situationalModifier, critical })
      } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Could not roll damage.') }
      const createdAt = new Date().toISOString()
      const id = crypto.randomUUID()
      database.prepare(`INSERT INTO encounter_damage_rolls (
        id, encounterId, attackId, attackerId, attackerName, targetId, targetName, weaponId, weaponName,
        source, formula, damageType, diceCount, dieSize, diceResults, formulaModifier, ability, abilityModifier,
        situationalModifier, isCritical, total, applied, hpBefore, hpAfter, createdAt, appliedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, NULL)`)
        .run(id, encounterId, attackId, attack.attackerId as string, attack.attackerName as string, attack.targetId as string, attack.targetName as string,
          attack.weaponId as string | null, attack.weaponName as string | null, source, formula, damageType, result.rolledDiceCount, dieSize,
          JSON.stringify(result.diceResults), formulaModifier, ability, abilityModifier, situationalModifier, critical ? 1 : 0, result.total, createdAt)
      const row = database.prepare(`${selectRoll} WHERE id = ?`).get(id) as unknown as Record<string, unknown>
      return rowToRecord(row)
    })
  }

  export function apply(campaignId: string, encounterId: string, damageId: string): { damage: DamageRecord; hp: { targetId: string; currentHp: number; maxHp: number }; survivalMessage?: string } {
    return transaction(() => {
      requireEncounter(campaignId, encounterId)
      const row = database.prepare(`${selectRoll} WHERE id = ? AND encounterId = ?`).get(damageId, encounterId) as unknown as Record<string, unknown> | undefined
      if (!row) throw new HttpError(404, 'Damage roll was not found in this encounter.')
      if (row.applied === 1) throw new HttpError(409, 'This damage roll has already been applied.')
      if (!database.prepare(`SELECT 1 FROM encounter_attacks WHERE id = ? AND encounterId = ? AND outcome IN ('hit', 'critical_hit')`).get(row.attackId as string, encounterId)) {
        throw new HttpError(409, 'Damage roll is not backed by a successful attack.')
      }
      const target = database.prepare('SELECT currentHp, maxHp FROM encounter_combatants WHERE id = ? AND encounterId = ?').get(row.targetId as string, encounterId) as { currentHp: number; maxHp: number } | undefined
      if (!target) throw new HttpError(404, 'Target combatant is no longer in this encounter.')
      const appliedAt = new Date().toISOString()
      const hp = survivalStore.applyDamageInTransaction(campaignId, encounterId, row.targetId as string, Number(row.total), Number(row.isCritical) === 1, `damage:${damageId}`)
      const hpAfter = hp.currentHp
      const changed = database.prepare('UPDATE encounter_damage_rolls SET applied = 1, hpBefore = ?, hpAfter = ?, appliedAt = ? WHERE id = ? AND applied = 0')
        .run(target.currentHp, hpAfter, appliedAt, damageId)
      if (changed.changes !== 1) throw new HttpError(409, 'This damage roll has already been applied.')
      const updated = database.prepare(`${selectRoll} WHERE id = ?`).get(damageId) as unknown as Record<string, unknown>
      return { damage: rowToRecord(updated), hp: { targetId: row.targetId as string, currentHp: hpAfter, maxHp: hp.maxHp }, survivalMessage: hp.message }
    })
  }
}

export = damageStore
