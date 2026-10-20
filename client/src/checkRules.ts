import { rollDice, type RandomWordGenerator, type RollMode } from './dice.ts'
import {
  ABILITIES,
  SKILLS,
  abilityModifier,
  proficiencyBonus,
  type AbilityKey,
  type AbilityScores,
} from './characterRules.ts'

export type CheckKind = 'saving_throw' | 'skill'

export interface CheckDefinition {
  kind: CheckKind
  key: string
  label: string
  ability: AbilityKey
}

export const SAVING_THROW_CHECKS: CheckDefinition[] = ABILITIES.map(({ key, name }) => ({
  kind: 'saving_throw', key, label: name, ability: key,
}))

export const SKILL_CHECKS: CheckDefinition[] = SKILLS.map(({ key, name, ability }) => ({
  kind: 'skill', key, label: name, ability,
}))

export interface CheckCharacter {
  id: string
  name: string
  level: number
  abilityScores: AbilityScores
  savingThrowProficiencies: string[]
  skillProficiencies: string[]
}

export interface ResolveCheckInput {
  character: CheckCharacter
  kind: CheckKind
  key: string
  mode: RollMode
  situationalModifier: number
  exhaustionPenalty?: number
  dc?: number
}

export interface ResolvedCheck {
  id: string
  rolledAt: string
  characterId: string
  characterName: string
  characterLevel: number
  kind: CheckKind
  checkKey: string
  checkLabel: string
  ability: AbilityKey
  abilityName: string
  abilityModifier: number
  proficient: boolean
  proficiencyBonus: number
  situationalModifier: number
  exhaustionPenalty: number
  mode: RollMode
  diceResults: number[]
  keptIndices: number[]
  keptResult: number
  dc?: number
  outcome?: 'success' | 'failure'
  total: number
  breakdown: string
}

const checkByKind: Record<CheckKind, CheckDefinition[]> = {
  saving_throw: SAVING_THROW_CHECKS,
  skill: SKILL_CHECKS,
}

export function checkOptions(kind: CheckKind): CheckDefinition[] {
  return checkByKind[kind]
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`
}

export function validateCheckInput(input: ResolveCheckInput): CheckDefinition {
  if (input.kind !== 'saving_throw' && input.kind !== 'skill') {
    throw new RangeError('Choose a saving throw or skill check.')
  }
  const definition = checkByKind[input.kind].find((check) => check.key === input.key)
  if (!definition) throw new RangeError('Choose a valid saving throw or skill.')
  if (!input.character || typeof input.character.id !== 'string' || typeof input.character.name !== 'string') {
    throw new RangeError('Choose a character before rolling.')
  }
  if (!Number.isInteger(input.situationalModifier) || input.situationalModifier < -100 || input.situationalModifier > 100) {
    throw new RangeError('Situational modifier must be a whole number from -100 to 100.')
  }
  if (input.exhaustionPenalty !== undefined && (!Number.isInteger(input.exhaustionPenalty) || input.exhaustionPenalty > 0 || input.exhaustionPenalty < -12 || input.exhaustionPenalty % 2 !== 0)) {
    throw new RangeError('Exhaustion penalty must be 0 to -12 in increments of 2.')
  }
  if (input.dc !== undefined && (!Number.isInteger(input.dc) || input.dc < 1 || input.dc > 100)) {
    throw new RangeError('DC must be a whole number from 1 to 100.')
  }
  if (input.mode !== 'normal' && input.mode !== 'advantage' && input.mode !== 'disadvantage') {
    throw new RangeError('Choose Normal, Advantage, or Disadvantage.')
  }
  return definition
}

export function resolveCheck(input: ResolveCheckInput, randomWord?: RandomWordGenerator): ResolvedCheck {
  const definition = validateCheckInput(input)
  const modifier = abilityModifier(input.character.abilityScores[definition.ability])
  const trainedKeys = input.kind === 'saving_throw'
    ? input.character.savingThrowProficiencies
    : input.character.skillProficiencies
  const proficient = trainedKeys.includes(definition.key)
  const characterProficiency = proficiencyBonus(input.character.level)
  const proficiency = proficient ? characterProficiency : 0
  const exhaustionPenalty = input.exhaustionPenalty ?? 0
  const roll = rollDice({ diceCount: 1, sides: 20, modifier: 0, mode: input.mode }, randomWord)
  const keptResult = roll.diceResults[roll.keptIndices[0]!]!
  const total = keptResult + modifier + proficiency + exhaustionPenalty + input.situationalModifier
  const abilityName = ABILITIES.find(({ key }) => key === definition.ability)!.name
  const dieText = roll.mode === 'normal'
    ? `d20 (${keptResult})`
    : `d20 (${roll.diceResults.join(' / ')}, kept ${keptResult})`
  const parts = [dieText, `${abilityName} (${signed(modifier)})`]
  if (proficient) parts.push(`Proficiency (${signed(characterProficiency)})`)
  if (exhaustionPenalty) parts.push(`Exhaustion (${signed(exhaustionPenalty)})`)
  if (input.situationalModifier !== 0) parts.push(`Situational (${signed(input.situationalModifier)})`)
  const dcPart = input.dc === undefined ? {} : {
    dc: input.dc,
    outcome: total >= input.dc ? 'success' as const : 'failure' as const,
  }

  return {
    id: globalThis.crypto.randomUUID(),
    rolledAt: new Date().toISOString(),
    characterId: input.character.id,
    characterName: input.character.name,
    characterLevel: input.character.level,
    kind: input.kind,
    checkKey: definition.key,
    checkLabel: definition.label,
    ability: definition.ability,
    abilityName,
    abilityModifier: modifier,
    proficient,
    proficiencyBonus: proficiency,
    situationalModifier: input.situationalModifier,
    exhaustionPenalty,
    mode: input.mode,
    diceResults: [...roll.diceResults],
    keptIndices: [...roll.keptIndices],
    keptResult,
    ...dcPart,
    total,
    breakdown: `${parts.join(' + ')} = ${total}`,
  }
}

export function appendCheckHistory(history: ResolvedCheck[], check: ResolvedCheck): ResolvedCheck[] {
  const snapshot: ResolvedCheck = {
    ...check,
    diceResults: [...check.diceResults],
    keptIndices: [...check.keptIndices],
  }
  return [snapshot, ...history].slice(0, 20)
}
