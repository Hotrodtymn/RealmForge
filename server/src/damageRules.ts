import crypto = require('node:crypto')

namespace damageRules {
  export const damageTypes = [
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing',
    'poison', 'psychic', 'radiant', 'slashing', 'thunder',
  ] as const
  export type DamageType = typeof damageTypes[number]
  export type Ability = 'str' | 'dex'

  export interface WeaponDamageDefinition {
    diceCount: number
    dieSize: number
    type: DamageType
    versatileDiceCount?: number
    versatileDieSize?: number
    ranged?: boolean
    thrown?: boolean
  }

  export const weaponDamage: Record<string, WeaponDamageDefinition> = {
    club: { diceCount: 1, dieSize: 4, type: 'bludgeoning' },
    dagger: { diceCount: 1, dieSize: 4, type: 'piercing', thrown: true },
    handaxe: { diceCount: 1, dieSize: 6, type: 'slashing', thrown: true },
    mace: { diceCount: 1, dieSize: 6, type: 'bludgeoning' },
    quarterstaff: { diceCount: 1, dieSize: 6, type: 'bludgeoning', versatileDiceCount: 1, versatileDieSize: 8 },
    spear: { diceCount: 1, dieSize: 6, type: 'piercing', versatileDiceCount: 1, versatileDieSize: 8, thrown: true },
    shortsword: { diceCount: 1, dieSize: 6, type: 'piercing' },
    longsword: { diceCount: 1, dieSize: 8, type: 'slashing', versatileDiceCount: 1, versatileDieSize: 10 },
    rapier: { diceCount: 1, dieSize: 8, type: 'piercing' },
    greatsword: { diceCount: 2, dieSize: 6, type: 'slashing' },
    shortbow: { diceCount: 1, dieSize: 6, type: 'piercing', ranged: true },
    longbow: { diceCount: 1, dieSize: 8, type: 'piercing', ranged: true },
    light_crossbow: { diceCount: 1, dieSize: 8, type: 'piercing', ranged: true },
  }

  export interface ParsedFormula { diceCount: number; dieSize: number; modifier: number }
  export function parseEnemyFormula(value: unknown): ParsedFormula {
    if (typeof value !== 'string') throw new Error('Damage formula must be text.')
    const formula = value.trim()
    const match = /^(\d{1,2})d(4|6|8|10|12|20)([+-]\d{1,3})?$/i.exec(formula)
    if (!match) throw new Error('Use a simple formula such as 1d6+2 (1–20 dice, d4/d6/d8/d10/d12/d20, modifier −100 to +100).')
    const diceCount = Number(match[1])
    const dieSize = Number(match[2])
    const modifier = Number(match[3] ?? 0)
    if (diceCount < 1 || diceCount > 20) throw new Error('Damage formulas must use from 1 to 20 dice.')
    if (modifier < -100 || modifier > 100) throw new Error('Damage formula modifier must be from -100 to 100.')
    return { diceCount, dieSize, modifier }
  }

  export interface DamageInput {
    diceCount: number
    dieSize: number
    formulaModifier: number
    abilityModifier: number
    situationalModifier: number
    critical: boolean
  }
  export interface DamageResolution extends DamageInput {
    diceResults: number[]
    rolledDiceCount: number
    total: number
    breakdown: string
  }

  export function resolveDamage(input: DamageInput, roll: (sides: number) => number = (sides) => crypto.randomInt(1, sides + 1)): DamageResolution {
    if (!Number.isSafeInteger(input.diceCount) || input.diceCount < 1 || input.diceCount > 20) throw new RangeError('Damage dice count must be from 1 to 20.')
    if (![4, 6, 8, 10, 12, 20].includes(input.dieSize)) throw new RangeError('Unsupported damage die size.')
    for (const [label, value] of [['Formula modifier', input.formulaModifier], ['Ability modifier', input.abilityModifier], ['Situational modifier', input.situationalModifier]] as const) {
      if (!Number.isSafeInteger(value) || value < -100 || value > 100) throw new RangeError(`${label} must be a whole number from -100 to 100.`)
    }
    const rolledDiceCount = input.diceCount * (input.critical ? 2 : 1)
    const diceResults = Array.from({ length: rolledDiceCount }, () => roll(input.dieSize))
    if (diceResults.some((die) => !Number.isSafeInteger(die) || die < 1 || die > input.dieSize)) throw new RangeError('Secure dice source returned an invalid damage die result.')
    const subtotal = diceResults.reduce((sum, die) => sum + die, 0) + input.formulaModifier + input.abilityModifier + input.situationalModifier
    const total = Math.max(0, subtotal)
    const parts = [`${input.critical ? 'Critical · ' : ''}${input.diceCount}d${input.dieSize}${input.critical ? ` (${rolledDiceCount} dice)` : ''}`, diceResults.join(' + ')]
    if (input.formulaModifier !== 0) parts.push(`formula ${input.formulaModifier >= 0 ? '+' : '−'}${Math.abs(input.formulaModifier)}`)
    if (input.abilityModifier !== 0) parts.push(`ability ${input.abilityModifier >= 0 ? '+' : '−'}${Math.abs(input.abilityModifier)}`)
    if (input.situationalModifier !== 0) parts.push(`situational ${input.situationalModifier >= 0 ? '+' : '−'}${Math.abs(input.situationalModifier)}`)
    const breakdown = `${parts[0]}: ${parts.slice(1).join(' · ')} = ${total}${subtotal < 0 ? ' (minimum 0)' : ''}`
    return { ...input, diceResults, rolledDiceCount, total, breakdown }
  }
}

export = damageRules
