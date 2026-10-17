export const ABILITIES = [
  { key: 'str', name: 'Strength' },
  { key: 'dex', name: 'Dexterity' },
  { key: 'con', name: 'Constitution' },
  { key: 'int', name: 'Intelligence' },
  { key: 'wis', name: 'Wisdom' },
  { key: 'cha', name: 'Charisma' },
] as const

export type AbilityKey = (typeof ABILITIES)[number]['key']
export type AbilityScores = Record<AbilityKey, number>

export const SKILLS = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { key: 'animalHandling', name: 'Animal Handling', ability: 'wis' },
  { key: 'arcana', name: 'Arcana', ability: 'int' },
  { key: 'athletics', name: 'Athletics', ability: 'str' },
  { key: 'deception', name: 'Deception', ability: 'cha' },
  { key: 'history', name: 'History', ability: 'int' },
  { key: 'insight', name: 'Insight', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { key: 'investigation', name: 'Investigation', ability: 'int' },
  { key: 'medicine', name: 'Medicine', ability: 'wis' },
  { key: 'nature', name: 'Nature', ability: 'int' },
  { key: 'perception', name: 'Perception', ability: 'wis' },
  { key: 'performance', name: 'Performance', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { key: 'religion', name: 'Religion', ability: 'int' },
  { key: 'sleightOfHand', name: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', name: 'Stealth', ability: 'dex' },
  { key: 'survival', name: 'Survival', ability: 'wis' },
] as const

function requireIntegerInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a whole number from ${min} to ${max}.`)
  }
}

export function abilityModifier(score: number): number {
  requireIntegerInRange(score, 1, 30, 'Ability score')
  return Math.floor((score - 10) / 2)
}

export function proficiencyBonus(level: number): number {
  requireIntegerInRange(level, 1, 20, 'Character level')
  return Math.floor((level - 1) / 4) + 2
}

export function savingThrowBonus(score: number, level: number, proficient: boolean): number {
  return abilityModifier(score) + (proficient ? proficiencyBonus(level) : 0)
}

export function skillBonus(score: number, level: number, proficient: boolean): number {
  return abilityModifier(score) + (proficient ? proficiencyBonus(level) : 0)
}
