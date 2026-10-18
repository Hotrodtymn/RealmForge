import { abilityModifier, proficiencyBonus, type AbilityScores } from './characterRules.ts'

export type SpellAbility = 'int' | 'wis' | 'cha'
export interface SpellcastingBonuses { spellAttackBonus: number | null; spellSaveDc: number | null; warning: string | null }

export function deriveSpellcastingBonuses(input: { enabled: boolean; ability: SpellAbility | null; level: number; scores: AbilityScores }): SpellcastingBonuses {
  if (!input.enabled) return { spellAttackBonus: null, spellSaveDc: null, warning: 'Spellcasting is disabled for this character.' }
  if (!input.ability) return { spellAttackBonus: null, spellSaveDc: null, warning: 'Choose a spellcasting ability to calculate spell attack bonus and save DC.' }
  const modifier = abilityModifier(input.scores[input.ability])
  const proficiency = proficiencyBonus(input.level)
  return { spellAttackBonus: modifier + proficiency, spellSaveDc: 8 + modifier + proficiency, warning: null }
}
