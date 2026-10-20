import HttpError = require('./httpError')
import attackRules = require('./attackRules')

namespace spellResolutionRules {
  export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
  export interface Scores extends Record<Ability, number> {}
  export type AttackMode = attackRules.AttackMode

  function integer(value: number, min: number, max: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`)
  }

  export function spellAttackBonus(score: number, level: number): number {
    integer(score, 1, 30, 'Spellcasting ability score')
    integer(level, 1, 20, 'Character level')
    return Math.floor((score - 10) / 2) + 2 + Math.floor((level - 1) / 4)
  }

  export function spellSaveDc(score: number, level: number): number {
    return 8 + spellAttackBonus(score, level)
  }

  export function savingThrowModifier(score: number, level: number, proficient: boolean): number {
    integer(score, 1, 30, 'Target ability score')
    integer(level, 1, 20, 'Target character level')
    if (typeof proficient !== 'boolean') throw new HttpError(400, 'Saving throw proficiency must be true or false.')
    return Math.floor((score - 10) / 2) + (proficient ? 2 + Math.floor((level - 1) / 4) : 0)
  }

  export function resolveSpellAttack(attackBonus: number, targetAC: number, mode: AttackMode, exhaustionPenalty: number, rollD20?: () => number, criticalOnHit = false) {
    return attackRules.resolveAttack(attackBonus, targetAC, mode, exhaustionPenalty, rollD20, criticalOnHit)
  }

  export interface SavingThrowResult {
    naturalRoll: number | null
    targetModifier: number | null
    exhaustionPenalty: number
    total: number | null
    dc: number
    outcome: 'success' | 'failure' | 'automatic_failure' | 'adjudication_required'
    breakdown: string
  }

  export function resolveSavingThrow(input: { naturalRoll?: number; targetModifier?: number; exhaustionPenalty: number; dc: number; autoFail?: boolean }): SavingThrowResult {
    integer(input.dc, 1, 100, 'Spell save DC')
    integer(input.exhaustionPenalty, -12, 0, 'Exhaustion penalty')
    if (input.autoFail) return { naturalRoll: null, targetModifier: input.targetModifier ?? null, exhaustionPenalty: input.exhaustionPenalty, total: null, dc: input.dc, outcome: 'automatic_failure', breakdown: 'Condition causes an automatic failure; no d20 was rolled.' }
    if (input.targetModifier === undefined) return { naturalRoll: null, targetModifier: null, exhaustionPenalty: input.exhaustionPenalty, total: null, dc: input.dc, outcome: 'adjudication_required', breakdown: 'Target saving throw modifier is unavailable; DM adjudication required.' }
    integer(input.targetModifier, -100, 100, 'Target saving throw modifier')
    if (input.naturalRoll === undefined) throw new HttpError(400, 'A natural d20 result is required when a target modifier is available.')
    integer(input.naturalRoll, 1, 20, 'Natural d20 result')
    const total = input.naturalRoll + input.targetModifier + input.exhaustionPenalty
    const outcome = total >= input.dc ? 'success' : 'failure'
    const pieces = [`d20 (${input.naturalRoll})`, `saving throw ${input.targetModifier >= 0 ? '+' : '−'} ${Math.abs(input.targetModifier)}`]
    if (input.exhaustionPenalty) pieces.push(`Exhaustion ${input.exhaustionPenalty}`)
    return { naturalRoll: input.naturalRoll, targetModifier: input.targetModifier, exhaustionPenalty: input.exhaustionPenalty, total, dc: input.dc, outcome, breakdown: `${pieces.join(' ')} = ${total} vs DC ${input.dc}` }
  }
}

export = spellResolutionRules
