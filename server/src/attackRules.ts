import crypto = require('node:crypto')
import HttpError = require('./httpError')

namespace attackRules {
export type AttackMode = 'normal' | 'advantage' | 'disadvantage'
export type AttackOutcome = 'hit' | 'miss' | 'critical_hit'

export interface AttackResolution {
  mode: AttackMode
  diceResults: number[]
  keptIndex: number
  attackBonus: number
  situationalModifier: number
  total: number
  targetAC: number
  outcome: AttackOutcome
  isCritical: boolean
  breakdown: string
}

export function resolveAttack(
  attackBonus: number,
  targetAC: number,
  mode: AttackMode,
  situationalModifier: number,
  rollD20: () => number = () => crypto.randomInt(1, 21),
  criticalOnHit = false,
): AttackResolution {
  if (!Number.isSafeInteger(attackBonus) || attackBonus < -100 || attackBonus > 100) throw new HttpError(400, 'Attack bonus is outside the supported range.')
  if (!Number.isSafeInteger(targetAC) || targetAC < 1 || targetAC > 50) throw new HttpError(400, 'Target AC must be a whole number from 1 to 50.')
  if (!['normal', 'advantage', 'disadvantage'].includes(mode)) throw new HttpError(400, 'Roll mode must be normal, advantage, or disadvantage.')
  if (!Number.isSafeInteger(situationalModifier) || situationalModifier < -100 || situationalModifier > 100) {
    throw new HttpError(400, 'Situational modifier must be a whole number from -100 to 100.')
  }
  const diceResults = Array.from({ length: mode === 'normal' ? 1 : 2 }, rollD20)
  if (diceResults.some((die) => !Number.isSafeInteger(die) || die < 1 || die > 20)) throw new HttpError(500, 'Secure dice source returned an invalid d20 result.')
  let keptIndex = 0
  if (mode === 'advantage' && diceResults[1]! > diceResults[0]!) keptIndex = 1
  if (mode === 'disadvantage' && diceResults[1]! < diceResults[0]!) keptIndex = 1
  const natural = diceResults[keptIndex]!
  const total = natural + attackBonus + situationalModifier
  const outcome: AttackOutcome = natural === 20 ? 'critical_hit' : natural === 1 ? 'miss' : total >= targetAC ? criticalOnHit ? 'critical_hit' : 'hit' : 'miss'
  const isCritical = outcome === 'critical_hit'
  const breakdown = `d20 (${diceResults.map((die, index) => `${die}${index === keptIndex ? ' kept' : ''}`).join(' / ')}) ${attackBonus < 0 ? '−' : '+'} ${Math.abs(attackBonus)} attack bonus ${situationalModifier === 0 ? '' : `${situationalModifier < 0 ? '−' : '+'} ${Math.abs(situationalModifier)} situational modifier `}= ${total}`.trim()
  return { mode, diceResults, keptIndex, attackBonus, situationalModifier, total, targetAC, outcome, isCritical, breakdown }
}
}

export = attackRules
