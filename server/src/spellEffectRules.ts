import damageRules = require('./damageRules')
import HttpError = require('./httpError')
import spellRules = require('./spellRules')

namespace spellEffectRules {
  export interface EffectConfig {
    effectType: spellRules.SpellEffectType
    effectFormula: string
    damageType: string | null
    effectModifier: number
    includeSpellcastingModifier: boolean
    saveSuccessEffect: spellRules.SaveSuccessEffect | null
    upcastMode: spellRules.UpcastMode
    upcastDiceCount: number
    upcastDieSize: number | null
    upcastModifier: number
  }
  export interface FormulaPlan {
    baseLevel: number
    castLevel: number
    baseFormula: string
    finalFormula: string
    diceCount: number
    dieSize: number
    formulaModifier: number
    fixedModifier: number
    upcastLevels: number
    scaling: string
  }

  export function plan(config: EffectConfig, baseLevel: number, castLevel: number): FormulaPlan {
    if (!Number.isSafeInteger(baseLevel) || baseLevel < 0 || baseLevel > 9) throw new HttpError(400, 'Base spell level must be from 0 to 9.')
    if (!Number.isSafeInteger(castLevel) || castLevel < 0 || castLevel > 9) throw new HttpError(400, 'Cast level must be from 0 to 9.')
    if (baseLevel === 0 && castLevel !== 0) throw new HttpError(400, 'Cantrips cannot be upcast using spell slots.')
    if (baseLevel > 0 && castLevel < baseLevel) throw new HttpError(400, 'Cast level cannot be below the spell’s base level.')
    if (config.effectType === 'none') throw new HttpError(409, 'This spell has no explicit automated damage or healing metadata.')
    let parsed: damageRules.ParsedFormula
    try { parsed = damageRules.parseEnemyFormula(config.effectFormula) }
    catch (error) { throw new HttpError(409, error instanceof Error ? error.message : 'Spell effect formula is invalid.') }
    if (!Number.isSafeInteger(config.effectModifier) || config.effectModifier < -100 || config.effectModifier > 100) throw new HttpError(409, 'Spell effect modifier is outside the supported range.')
    const upcastLevels = Math.max(0, castLevel - baseLevel)
    let diceCount = parsed.diceCount
    let formulaModifier = parsed.modifier + config.effectModifier
    let scaling = 'No upcasting scaling.'
    if (upcastLevels && config.upcastMode === 'dice') {
      if (!Number.isSafeInteger(config.upcastDiceCount) || config.upcastDiceCount < 1 || ![4, 6, 8, 10, 12, 20].includes(config.upcastDieSize ?? NaN) || config.upcastDieSize !== parsed.dieSize) throw new HttpError(409, 'Spell dice upcasting configuration is invalid.')
      diceCount += upcastLevels * config.upcastDiceCount
      scaling = `+${upcastLevels * config.upcastDiceCount}d${parsed.dieSize} (${upcastLevels} level${upcastLevels === 1 ? '' : 's'} above base)`
    } else if (upcastLevels && config.upcastMode === 'modifier') {
      if (!Number.isSafeInteger(config.upcastModifier) || config.upcastModifier === 0 || config.upcastModifier < -100 || config.upcastModifier > 100) throw new HttpError(409, 'Spell modifier upcasting configuration is invalid.')
      formulaModifier += upcastLevels * config.upcastModifier
      scaling = `${config.upcastModifier >= 0 ? '+' : ''}${upcastLevels * config.upcastModifier} modifier (${upcastLevels} level${upcastLevels === 1 ? '' : 's'} above base)`
    }
    if (diceCount > 20) throw new HttpError(400, 'Upcasting would exceed the 20-die limit.')
    const finalFormula = `${diceCount}d${parsed.dieSize}${formulaModifier === 0 ? '' : formulaModifier > 0 ? `+${formulaModifier}` : String(formulaModifier)}`
    return { baseLevel, castLevel, baseFormula: config.effectFormula, finalFormula, diceCount, dieSize: parsed.dieSize, formulaModifier, fixedModifier: config.effectModifier, upcastLevels, scaling }
  }

  export function saveAmount(fullAmount: number, success: boolean, behavior: spellRules.SaveSuccessEffect | null): { amount: number; status: 'rolled' | 'no_effect' } {
    if (!Number.isSafeInteger(fullAmount) || fullAmount < 0) throw new HttpError(400, 'Effect amount must be a nonnegative whole number.')
    if (!success) return { amount: fullAmount, status: 'rolled' }
    if (behavior === 'none') return { amount: 0, status: 'no_effect' }
    if (behavior === 'half') return { amount: Math.floor(fullAmount / 2), status: 'rolled' }
    if (behavior === 'full') return { amount: fullAmount, status: 'rolled' }
    throw new HttpError(409, 'This saving throw effect has no explicit success behavior; adjudicate it manually.')
  }
}

export = spellEffectRules
