import HttpError = require('./httpError')

namespace conditionRules {
  export type ConditionKey = 'blinded' | 'charmed' | 'deafened' | 'frightened' | 'grappled' | 'incapacitated' | 'invisible' | 'paralyzed' | 'poisoned' | 'prone' | 'restrained' | 'stunned' | 'unconscious' | 'petrified' | 'exhaustion'
  export interface Condition { condition: ConditionKey; sourceCombatantId?: string | null; level?: number | null }
  export interface AttackContext { distanceFeet?: number; attackerCanSeeTarget?: boolean; targetCanSeeAttacker?: boolean; fearSourceVisible?: boolean }
  export interface AttackEffects {
    mode: 'normal' | 'advantage' | 'disadvantage'
    advantageSources: string[]
    disadvantageSources: string[]
    warnings: string[]
    blockedReason: string | null
    criticalOnHit: boolean
    appliedContext: AttackContext
  }
  export interface MovementEffects { effectiveSpeed: number; reasons: string[]; prone: boolean; standCost: number | null; adjudication: string[] }

  export function exhaustionPenalty(level: number): number {
    if (!Number.isSafeInteger(level) || level < 0 || level > 6) throw new HttpError(400, 'Exhaustion level must be a whole number from 0 to 6.')
    return level * -2
  }

  export function exhaustionSpeed(baseSpeed: number, level: number): number {
    if (!Number.isSafeInteger(baseSpeed) || baseSpeed < 0 || baseSpeed > 300) throw new HttpError(400, 'Base Speed must be a whole number from 0 to 300.')
    if (!Number.isSafeInteger(level) || level < 0 || level > 6) throw new HttpError(400, 'Exhaustion level must be a whole number from 0 to 6.')
    return Math.max(0, baseSpeed - level * 5)
  }

  const actionPreventing: ConditionKey[] = ['incapacitated', 'paralyzed', 'stunned', 'unconscious', 'petrified']
  const zeroSpeed: ConditionKey[] = ['grappled', 'restrained', 'paralyzed', 'unconscious', 'petrified']
  export function preventsActions(conditions: Condition[]): Condition[] { return conditions.filter((entry) => actionPreventing.includes(entry.condition)) }
  export function attackActionBlock(conditions: Condition[]): string | null {
    const entry = preventsActions(conditions)[0]
    return entry ? `${entry.condition} prevents this combatant from taking actions or reactions.` : null
  }
  export function movement(baseSpeed: number, conditions: Condition[]): MovementEffects {
    if (!Number.isSafeInteger(baseSpeed) || baseSpeed < 0 || baseSpeed > 300) throw new HttpError(400, 'Base Speed must be a whole number from 0 to 300.')
    const zeroed = conditions.filter((entry) => zeroSpeed.includes(entry.condition))
    const prone = conditions.some((entry) => entry.condition === 'prone')
    return {
      effectiveSpeed: zeroed.length ? 0 : exhaustionSpeed(baseSpeed, Number(conditions.find((entry) => entry.condition === 'exhaustion')?.level ?? 0)),
      reasons: [...zeroed.map((entry) => `${entry.condition} sets Speed to 0`), ...(conditions.some((entry) => entry.condition === 'exhaustion') ? [`Exhaustion ${conditions.find((entry) => entry.condition === 'exhaustion')?.level ?? 0}: Speed reduced by ${Number(conditions.find((entry) => entry.condition === 'exhaustion')?.level ?? 0) * 5} feet`] : [])],
      prone,
      standCost: prone && !zeroed.length ? Math.floor(exhaustionSpeed(baseSpeed, Number(conditions.find((entry) => entry.condition === 'exhaustion')?.level ?? 0)) / 2) : null,
      adjudication: conditions.some((entry) => entry.condition === 'stunned') ? ['Stunned prevents actions but does not set Speed to 0 under the 2024 rules.'] : [],
    }
  }

  export function attackEffects(attackerId: string, targetId: string, attackerConditions: Condition[], targetConditions: Condition[], requestedMode: AttackEffects['mode'], context: AttackContext = {}): AttackEffects {
    if (!['normal', 'advantage', 'disadvantage'].includes(requestedMode)) throw new HttpError(400, 'Roll mode must be normal, advantage, or disadvantage.')
    if (context.distanceFeet !== undefined && (!Number.isSafeInteger(context.distanceFeet) || context.distanceFeet < 0 || context.distanceFeet > 10000)) throw new HttpError(400, 'Distance must be a whole number from 0 to 10000 feet.')
    for (const value of [context.attackerCanSeeTarget, context.targetCanSeeAttacker, context.fearSourceVisible]) if (value !== undefined && typeof value !== 'boolean') throw new HttpError(400, 'Visibility context must be yes or no when supplied.')
    const advantageSources: string[] = []
    const disadvantageSources: string[] = []
    const warnings: string[] = []
    let blockedReason: string | null = null
    let criticalOnHit = false

    for (const entry of attackerConditions) {
      switch (entry.condition) {
        case 'blinded': disadvantageSources.push('Blinded attacker'); break
        case 'charmed': if (!entry.sourceCombatantId) warnings.push('Charmed: charmer is missing; target restrictions need DM adjudication.'); break
        case 'poisoned': disadvantageSources.push('Poisoned attacker'); break
        case 'prone': disadvantageSources.push('Prone attacker'); break
        case 'restrained': disadvantageSources.push('Restrained attacker'); break
        case 'frightened':
          if (!entry.sourceCombatantId) warnings.push('Frightened: fear source is missing; line-of-sight effect needs DM adjudication.')
          else if (context.fearSourceVisible === undefined) warnings.push('Frightened: specify whether the fear source is within line of sight.')
          else if (context.fearSourceVisible) disadvantageSources.push('Frightened (fear source in line of sight)')
          break
        case 'grappled':
          if (!entry.sourceCombatantId) warnings.push('Grappled: grappler is missing; target-specific attack effect needs DM adjudication.')
          else if (entry.sourceCombatantId !== targetId) disadvantageSources.push('Grappled (target is not the grappler)')
          break
        case 'invisible':
          if (context.targetCanSeeAttacker === undefined) warnings.push('Invisible attacker: specify whether the target can see the attacker.')
          else if (!context.targetCanSeeAttacker) advantageSources.push('Invisible attacker (target cannot see attacker)')
          break
      }
    }
    for (const entry of targetConditions) {
      switch (entry.condition) {
        case 'blinded': advantageSources.push('Blinded target'); break
        case 'restrained': advantageSources.push('Restrained target'); break
        case 'paralyzed': advantageSources.push('Paralyzed target'); break
        case 'petrified': advantageSources.push('Petrified target'); break
        case 'stunned': advantageSources.push('Stunned target'); break
        case 'unconscious': advantageSources.push('Unconscious target'); break
        case 'prone':
          if (context.distanceFeet === undefined) warnings.push('Prone target: specify distance to determine the attack modifier.')
          else if (context.distanceFeet <= 5) advantageSources.push('Prone target within 5 feet')
          else disadvantageSources.push('Prone target more than 5 feet away')
          break
        case 'invisible':
          if (context.attackerCanSeeTarget === undefined) warnings.push('Invisible target: specify whether the attacker can see the target.')
          else if (!context.attackerCanSeeTarget) disadvantageSources.push('Invisible target (attacker cannot see target)')
          break
      }
      if (entry.condition === 'paralyzed' || entry.condition === 'unconscious') {
        if (context.distanceFeet === undefined) warnings.push(`${entry.condition === 'paralyzed' ? 'Paralyzed' : 'Unconscious'} target: distance is required to determine whether a hit is a critical hit.`)
        else if (context.distanceFeet <= 5) criticalOnHit = true
      }
    }
    const charmed = attackerConditions.find((entry) => entry.condition === 'charmed' && entry.sourceCombatantId === targetId)
    if (charmed) blockedReason = 'A charmed combatant cannot attack its charmer.'
    const hasAdvantage = requestedMode === 'advantage' || advantageSources.length > 0
    const hasDisadvantage = requestedMode === 'disadvantage' || disadvantageSources.length > 0
    const mode = hasAdvantage === hasDisadvantage ? 'normal' : hasAdvantage ? 'advantage' : 'disadvantage'
    return { mode, advantageSources, disadvantageSources, warnings: [...new Set(warnings)], blockedReason, criticalOnHit, appliedContext: { ...context } }
  }

  export function summary(condition: ConditionKey): string {
    const summaries: Record<ConditionKey, string> = {
      blinded: 'Attacks against this combatant have Advantage; its attacks have Disadvantage.',
      charmed: 'Cannot attack or target its charmer with harmful abilities or effects.',
      deafened: 'Automatically fails ability checks that require hearing.',
      frightened: 'Disadvantage on attacks and checks while fear source is in line of sight; cannot willingly approach it.',
      grappled: 'Speed 0; Disadvantage on attacks against targets other than its grappler.',
      incapacitated: 'Cannot take Actions, Bonus Actions, or Reactions.',
      invisible: 'Advantage on attacks and attacks against it have Disadvantage unless the observer can see it.',
      paralyzed: 'Incapacitated; Speed 0; fails Strength/Dexterity saves; attacks against it have Advantage; hits within 5 feet are Critical Hits.',
      poisoned: 'Disadvantage on attack rolls and ability checks.',
      prone: 'Can crawl or spend half Speed to stand; attack effects depend on distance.',
      restrained: 'Speed 0; attacks against it have Advantage; its attacks and Dexterity saves have Disadvantage.',
      stunned: 'Incapacitated; fails Strength/Dexterity saves; attacks against it have Advantage. Speed is not reduced by this condition.',
      unconscious: 'Incapacitated and Prone; Speed 0; attacks against it have Advantage; hits within 5 feet are Critical Hits.',
      petrified: 'Incapacitated; Speed 0; attacks against it have Advantage; fails Strength/Dexterity saves.',
      exhaustion: 'Exhaustion effects require the level and the game’s exhaustion rule adjudication.',
    }
    return summaries[condition]
  }
  export function contextWarning(condition: ConditionKey, sourceCombatantId: string | null | undefined): string | null {
    if (['charmed', 'frightened', 'grappled'].includes(condition) && !sourceCombatantId) return 'Source combatant is missing; source-dependent effects need DM adjudication.'
    if (condition === 'invisible') return 'Visibility is attack-specific; specify what each combatant can see.'
    if (condition === 'frightened') return 'Line of sight to the fear source is attack-specific.'
    if (condition === 'prone') return 'Attacker distance is needed to determine Advantage or Disadvantage.'
    if (condition === 'paralyzed' || condition === 'unconscious') return 'Distance within 5 feet must be verified for condition-based Critical Hits.'
    return null
  }
}

export = conditionRules
