import { abilityModifier, proficiencyBonus, type AbilityKey, type AbilityScores } from './characterRules.ts'

export const ARMOR_DEFINITIONS = [
  { id: 'padded', name: 'Padded', baseAc: 11, weightClass: 'light' },
  { id: 'leather', name: 'Leather', baseAc: 11, weightClass: 'light' },
  { id: 'studded_leather', name: 'Studded Leather', baseAc: 12, weightClass: 'light' },
  { id: 'hide', name: 'Hide', baseAc: 12, weightClass: 'medium' },
  { id: 'chain_shirt', name: 'Chain Shirt', baseAc: 13, weightClass: 'medium' },
  { id: 'scale_mail', name: 'Scale Mail', baseAc: 14, weightClass: 'medium' },
  { id: 'breastplate', name: 'Breastplate', baseAc: 14, weightClass: 'medium' },
  { id: 'half_plate', name: 'Half Plate', baseAc: 15, weightClass: 'medium' },
  { id: 'ring_mail', name: 'Ring Mail', baseAc: 14, weightClass: 'heavy' },
  { id: 'chain_mail', name: 'Chain Mail', baseAc: 16, weightClass: 'heavy' },
  { id: 'splint', name: 'Splint', baseAc: 17, weightClass: 'heavy' },
  { id: 'plate', name: 'Plate', baseAc: 18, weightClass: 'heavy' },
] as const

export type ArmorDefinitionId = (typeof ARMOR_DEFINITIONS)[number]['id']

export const WEAPON_DEFINITIONS = [
  { id: 'club', name: 'Club', attackAbility: 'str', finesse: false },
  { id: 'dagger', name: 'Dagger', attackAbility: 'str', finesse: true },
  { id: 'handaxe', name: 'Handaxe', attackAbility: 'str', finesse: false },
  { id: 'mace', name: 'Mace', attackAbility: 'str', finesse: false },
  { id: 'quarterstaff', name: 'Quarterstaff', attackAbility: 'str', finesse: false },
  { id: 'spear', name: 'Spear', attackAbility: 'str', finesse: false },
  { id: 'shortsword', name: 'Shortsword', attackAbility: 'str', finesse: true },
  { id: 'longsword', name: 'Longsword', attackAbility: 'str', finesse: false },
  { id: 'rapier', name: 'Rapier', attackAbility: 'str', finesse: true },
  { id: 'greatsword', name: 'Greatsword', attackAbility: 'str', finesse: false },
  { id: 'shortbow', name: 'Shortbow', attackAbility: 'dex', finesse: false },
  { id: 'longbow', name: 'Longbow', attackAbility: 'dex', finesse: false },
  { id: 'light_crossbow', name: 'Light Crossbow', attackAbility: 'dex', finesse: false },
] as const

export type WeaponDefinitionId = (typeof WEAPON_DEFINITIONS)[number]['id']

export interface ArmorClassInput {
  dexterityScore: number
  armorEquipped: boolean
  armorDefinitionId: string | null
  shieldEquipped: boolean
  manualOverride: number | null
}

export interface ArmorClassResult {
  configured: boolean
  value: number | null
  source: 'calculated' | 'manual' | 'unconfigured'
  breakdown: string
}

export function calculateArmorClass(input: ArmorClassInput): ArmorClassResult {
  if (input.manualOverride !== null) {
    if (!Number.isInteger(input.manualOverride) || input.manualOverride < 1 || input.manualOverride > 50) {
      throw new RangeError('Manual AC override must be a whole number from 1 to 50.')
    }
    return { configured: true, value: input.manualOverride, source: 'manual', breakdown: `Manual AC override: ${input.manualOverride}` }
  }
  let baseAc = 10
  let dexterity = abilityModifier(input.dexterityScore)
  let source = 'Unarmored'
  if (input.armorEquipped) {
    const armor = ARMOR_DEFINITIONS.find((entry) => entry.id === input.armorDefinitionId)
    if (!armor) return { configured: false, value: null, source: 'unconfigured', breakdown: 'Equipped armor is not configured.' }
    baseAc = armor.baseAc
    source = armor.name
    dexterity = armor.weightClass === 'heavy' ? 0 : armor.weightClass === 'medium' ? Math.min(2, dexterity) : dexterity
  }
  const shieldBonus = input.shieldEquipped ? 2 : 0
  const value = baseAc + dexterity + shieldBonus
  const parts = [`${source} ${baseAc}`, `Dexterity ${dexterity >= 0 ? '+' : ''}${dexterity}`]
  if (input.shieldEquipped) parts.push('Shield +2')
  return { configured: true, value, source: 'calculated', breakdown: `${parts.join(' · ')} = ${value}` }
}

export interface WeaponAttackInput {
  abilityScores: AbilityScores
  level: number
  weaponDefinitionId: string | null
  weaponAbility: AbilityKey | null
  proficient: boolean
  manualOverride: number | null
}

export interface WeaponAttackResult {
  configured: boolean
  total: number | null
  source: 'calculated' | 'manual' | 'unconfigured'
  ability: AbilityKey | null
  abilityModifier: number | null
  proficiencyContribution: number
  breakdown: string
}

export function calculateWeaponAttackBonus(input: WeaponAttackInput): WeaponAttackResult {
  if (input.manualOverride !== null && (!Number.isInteger(input.manualOverride) || input.manualOverride < -20 || input.manualOverride > 50)) {
    throw new RangeError('Manual attack bonus must be a whole number from -20 to 50.')
  }
  const weapon = WEAPON_DEFINITIONS.find((entry) => entry.id === input.weaponDefinitionId)
  if (!weapon) {
    return input.manualOverride === null
      ? { configured: false, total: null, source: 'unconfigured', ability: null, abilityModifier: null, proficiencyContribution: 0, breakdown: 'Weapon is not configured.' }
      : { configured: true, total: input.manualOverride, source: 'manual', ability: null, abilityModifier: null, proficiencyContribution: 0, breakdown: `Manual attack bonus: ${signed(input.manualOverride)}` }
  }
  if (!weapon.finesse && input.weaponAbility !== null && input.weaponAbility !== weapon.attackAbility) {
    throw new RangeError(`${weapon.name} must use ${weapon.attackAbility.toUpperCase()}.`)
  }
  const ability: AbilityKey = weapon.finesse && input.weaponAbility ? input.weaponAbility : weapon.attackAbility
  if (weapon.finesse && ability !== 'str' && ability !== 'dex') throw new RangeError('Finesse weapons must use Strength or Dexterity.')
  const modifier = abilityModifier(input.abilityScores[ability])
  const proficiency = input.proficient ? proficiencyBonus(input.level) : 0
  const calculatedTotal = modifier + proficiency
  const baseBreakdown = `${ability.toUpperCase()} ${signed(modifier)}${input.proficient ? ` · Proficiency +${proficiency}` : ' · Not proficient'}`
  if (input.manualOverride !== null) {
    return { configured: true, total: input.manualOverride, source: 'manual', ability, abilityModifier: modifier, proficiencyContribution: proficiency, breakdown: `${baseBreakdown} · Manual override ${signed(input.manualOverride)}` }
  }
  return { configured: true, total: calculatedTotal, source: 'calculated', ability, abilityModifier: modifier, proficiencyContribution: proficiency, breakdown: `${baseBreakdown} = ${signed(calculatedTotal)}` }
}

function signed(value: number): string { return value >= 0 ? `+${value}` : String(value) }
