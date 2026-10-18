namespace spellRules {
export type SpellAbility = 'int' | 'wis' | 'cha'
export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
export type SpellResolutionType = 'none' | 'attack' | 'save'
export type SpellAttackType = 'melee' | 'ranged'
export type SpellEffectType = 'none' | 'damage' | 'healing'
export type SaveSuccessEffect = 'full' | 'half' | 'none'
export type UpcastMode = 'none' | 'dice' | 'modifier'
export type CastingTimeCategory = 'action' | 'bonus_action' | 'reaction' | 'special'

export interface SpellDefinition {
  id: string
  name: string
  level: number
  school: string
  castingTime: string
  castingTimeCategory?: CastingTimeCategory
  range: string
  components: string[]
  materialDetails: string
  duration: string
  concentration: boolean
  ritual: boolean
  description: string
  sourceVersion: string
  resolutionType?: SpellResolutionType
  savingThrowAbility?: AbilityKey | null
  attackType?: SpellAttackType | null
  targetGuidance?: string
  resolutionNotes?: string
  effectType?: SpellEffectType
  effectFormula?: string
  damageType?: string | null
  effectModifier?: number
  includeSpellcastingModifier?: boolean
  saveSuccessEffect?: SaveSuccessEffect | null
  upcastMode?: UpcastMode
  upcastDiceCount?: number
  upcastDieSize?: number | null
  upcastModifier?: number
  effectNotes?: string
  custom?: boolean
}

// Original starter content, written for RealmForge and released under CC0-1.0.
// This is metadata and original prose, not copied from a rulebook or a 2014 spell list.
export const STARTER_SPELLS: SpellDefinition[] = [
  { id: 'rf-spark-bolt', name: 'Aether Flicker', level: 0, school: 'Evocation', castingTime: 'Action', castingTimeCategory: 'action', range: '60 feet', components: ['V', 'S'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'Launch a brief arc of force that flashes toward a distant creature.', sourceVersion: 'RealmForge Original Starter Set (CC0-1.0)' },
  { id: 'rf-whispering-lantern', name: 'Lantern Wisp', level: 0, school: 'Illusion', castingTime: 'Action', castingTimeCategory: 'action', range: 'Self', components: ['V', 'S'], materialDetails: '', duration: '10 minutes', concentration: false, ritual: false, description: 'Shape a small, quiet light that follows close by and sheds a gentle glow.', sourceVersion: 'RealmForge Original Starter Set (CC0-1.0)' },
  { id: 'rf-mender-touch', name: 'Seamweaver Touch', level: 0, school: 'Transmutation', castingTime: 'Action', castingTimeCategory: 'action', range: 'Touch', components: ['V', 'S'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'Temporarily join a small tear or break in a nonmagical object.', sourceVersion: 'RealmForge Original Starter Set (CC0-1.0)' },
  { id: 'rf-stoneward', name: 'Rune Pebble Ward', level: 1, school: 'Abjuration', castingTime: 'Action', castingTimeCategory: 'action', range: 'Touch', components: ['V', 'S', 'M'], materialDetails: 'A pebble marked with a rune', duration: '1 hour', concentration: false, ritual: false, description: 'Set a brief protective ward into a willing creature or a small object.', sourceVersion: 'RealmForge Original Starter Set (CC0-1.0)' },
  { id: 'rf-mist-step', name: 'Veilstride', level: 2, school: 'Conjuration', castingTime: 'Bonus Action', castingTimeCategory: 'bonus_action', range: 'Self', components: ['V'], materialDetails: '', duration: 'Instantaneous', concentration: false, ritual: false, description: 'Vanish in a curl of mist and reappear a short distance away in a space you can see.', sourceVersion: 'RealmForge Original Starter Set (CC0-1.0)' },
  { id: 'rf-silver-thread', name: 'Farstar Thread', level: 3, school: 'Divination', castingTime: 'Action', castingTimeCategory: 'action', range: 'Self', components: ['V', 'S', 'M'], materialDetails: 'A silver filament', duration: '1 minute', concentration: true, ritual: false, description: 'Trace a faint magical line toward a creature or object you have seen nearby.', sourceVersion: 'RealmForge Original Starter Set (CC0-1.0)' },
]

export const SPELL_SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'] as const

export function filterSpells(spells: SpellDefinition[], query = '', level?: number, school = ''): SpellDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return spells.filter((spell) => (!normalizedQuery || spell.name.toLocaleLowerCase().includes(normalizedQuery))
    && (level === undefined || spell.level === level)
    && (!school || spell.school.toLocaleLowerCase() === school.toLocaleLowerCase()))
}

export function validateCustomSpell(input: unknown): { spell: Omit<SpellDefinition, 'id' | 'sourceVersion' | 'custom'>; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const text = (key: string, max: number, required = true): string => {
    const value = body[key]
    if (typeof value !== 'string') { if (required || value !== undefined) errors[key] = 'Must be text.'; return '' }
    const clean = value.trim()
    if (required && !clean) errors[key] = 'This field is required.'
    else if (clean.length > max) errors[key] = `Must be ${max} characters or fewer.`
    return clean
  }
  const name = text('name', 100)
  const school = text('school', 40)
  const castingTime = text('castingTime', 80)
  const castingTimeCategory = body.castingTimeCategory === undefined ? 'special' : body.castingTimeCategory
  if (!['action', 'bonus_action', 'reaction', 'special'].includes(castingTimeCategory as string)) errors.castingTimeCategory = 'Choose Action, Bonus Action, Reaction, or Special / DM adjudication.'
  const range = text('range', 80)
  const materialDetails = text('materialDetails', 300, false)
  const duration = text('duration', 80)
  const description = text('description', 3000)
  const targetGuidance = text('targetGuidance', 300, false)
  const resolutionNotes = text('resolutionNotes', 500, false)
  const effectNotes = text('effectNotes', 500, false)
  if (!Number.isInteger(body.level) || (body.level as number) < 0 || (body.level as number) > 9) errors.level = 'Spell level must be a whole number from 0 to 9.'
  const allowedComponents = ['V', 'S', 'M']
  if (!Array.isArray(body.components) || body.components.length === 0 || body.components.some((part) => !allowedComponents.includes(part as string)) || new Set(body.components as string[]).size !== (body.components as unknown[] | undefined)?.length) errors.components = 'Choose one or more distinct components: V, S, or M.'
  if (Array.isArray(body.components) && body.components.includes('M') && !materialDetails) errors.materialDetails = 'Describe the material component when M is selected.'
  if (body.concentration !== undefined && typeof body.concentration !== 'boolean') errors.concentration = 'Must be true or false.'
  if (body.ritual !== undefined && typeof body.ritual !== 'boolean') errors.ritual = 'Must be true or false.'
  const resolutionType = body.resolutionType === undefined ? 'none' : body.resolutionType
  if (!['none', 'attack', 'save'].includes(resolutionType as string)) errors.resolutionType = 'Choose attack, saving throw, or none.'
  const savingThrowAbility = body.savingThrowAbility === '' || body.savingThrowAbility === undefined ? null : body.savingThrowAbility
  if (savingThrowAbility !== null && !['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(savingThrowAbility as string)) errors.savingThrowAbility = 'Choose one of the six abilities.'
  const attackType = body.attackType === '' || body.attackType === undefined ? null : body.attackType
  if (attackType !== null && !['melee', 'ranged'].includes(attackType as string)) errors.attackType = 'Choose melee or ranged.'
  if (resolutionType === 'save' && savingThrowAbility === null) errors.savingThrowAbility = 'Saving throw spells require an explicit ability.'
  if (resolutionType === 'attack' && attackType === null) errors.attackType = 'Spell attacks require an explicit attack type.'
  if (resolutionType !== 'save' && savingThrowAbility !== null) errors.savingThrowAbility = 'Only saving throw spells use a saving throw ability.'
  if (resolutionType !== 'attack' && attackType !== null) errors.attackType = 'Only attack spells use an attack type.'
  const effectType = body.effectType === undefined ? 'none' : body.effectType
  if (!['none', 'damage', 'healing'].includes(effectType as string)) errors.effectType = 'Choose damage, healing, or none.'
  const effectFormula = body.effectFormula === undefined ? '' : text('effectFormula', 40, effectType !== 'none')
  let parsedFormula: { diceCount: number; dieSize: number; modifier: number } | undefined
  if (effectType !== 'none') {
    const formulaMatch = /^(\d{1,2})d(4|6|8|10|12|20)([+-]\d{1,3})?$/i.exec(effectFormula)
    if (!formulaMatch || Number(formulaMatch[1]) < 1 || Number(formulaMatch[1]) > 20 || Number(formulaMatch[3] ?? 0) < -100 || Number(formulaMatch[3] ?? 0) > 100) errors.effectFormula = 'Use a supported formula such as 1d8, 2d6+3, or 3d8-1 (1–20 dice, d4/d6/d8/d10/d12/d20).'
    else parsedFormula = { diceCount: Number(formulaMatch[1]), dieSize: Number(formulaMatch[2]), modifier: Number(formulaMatch[3] ?? 0) }
  } else if (effectFormula) errors.effectFormula = 'Choose damage or healing before configuring an effect formula.'
  const supportedDamageTypes = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
  const damageType = body.damageType === '' || body.damageType === undefined ? null : body.damageType
  if (damageType !== null && !supportedDamageTypes.includes(damageType as string)) errors.damageType = 'Choose a supported damage type.'
  if (effectType === 'damage' && damageType === null) errors.damageType = 'Damage effects require a damage type.'
  if (effectType !== 'damage' && damageType !== null) errors.damageType = 'Only damage effects use a damage type.'
  const effectModifier = body.effectModifier === undefined ? 0 : body.effectModifier
  if (!Number.isSafeInteger(effectModifier) || (effectModifier as number) < -100 || (effectModifier as number) > 100) errors.effectModifier = 'Effect modifier must be a whole number from -100 to 100.'
  const includeSpellcastingModifier = body.includeSpellcastingModifier === undefined ? false : body.includeSpellcastingModifier
  if (typeof includeSpellcastingModifier !== 'boolean') errors.includeSpellcastingModifier = 'Choose whether to add the spellcasting ability modifier.'
  if (effectType === 'none' && (effectModifier !== 0 || includeSpellcastingModifier)) errors.effectModifier = 'Configure modifiers only for damage or healing effects.'
  const saveSuccessEffect = body.saveSuccessEffect === '' || body.saveSuccessEffect === undefined ? null : body.saveSuccessEffect
  if (saveSuccessEffect !== null && !['full', 'half', 'none'].includes(saveSuccessEffect as string)) errors.saveSuccessEffect = 'Choose full, half, or no effect on a successful saving throw.'
  if (resolutionType === 'save' && effectType !== 'none' && saveSuccessEffect === null) errors.saveSuccessEffect = 'Saving throw effects require explicit success behavior: full, half, or none.'
  if (resolutionType !== 'save' && saveSuccessEffect !== null) errors.saveSuccessEffect = 'Save success behavior is only used by saving throw spells.'
  const upcastMode = body.upcastMode === undefined ? 'none' : body.upcastMode
  if (!['none', 'dice', 'modifier'].includes(upcastMode as string)) errors.upcastMode = 'Choose no scaling, additional dice, or additional modifier.'
  const upcastDiceCount = body.upcastDiceCount === undefined ? 0 : body.upcastDiceCount
  const upcastDieSize = body.upcastDieSize === '' || body.upcastDieSize === undefined ? null : body.upcastDieSize
  const upcastModifier = body.upcastModifier === undefined ? 0 : body.upcastModifier
  if (!Number.isSafeInteger(upcastDiceCount) || (upcastDiceCount as number) < 0 || (upcastDiceCount as number) > 20) errors.upcastDiceCount = 'Additional dice per level must be a whole number from 0 to 20.'
  if (upcastDieSize !== null && ![4, 6, 8, 10, 12, 20].includes(upcastDieSize as number)) errors.upcastDieSize = 'Choose a supported die size.'
  if (!Number.isSafeInteger(upcastModifier) || (upcastModifier as number) < -100 || (upcastModifier as number) > 100) errors.upcastModifier = 'Additional modifier per level must be a whole number from -100 to 100.'
  if (effectType === 'none' && upcastMode !== 'none') errors.upcastMode = 'Configure upcasting only for damage or healing effects.'
  if (upcastMode === 'dice' && (!upcastDiceCount || upcastDieSize === null)) errors.upcastDiceCount = 'Dice scaling requires an additional dice count and die size.'
  if (upcastMode !== 'dice' && (upcastDiceCount !== 0 || upcastDieSize !== null)) errors.upcastDiceCount = 'Additional dice settings require dice scaling.'
  if (upcastMode === 'modifier' && !upcastModifier) errors.upcastModifier = 'Modifier scaling requires a nonzero modifier per level.'
  if (upcastMode !== 'modifier' && upcastModifier !== 0) errors.upcastModifier = 'Additional modifier requires modifier scaling.'
  if (parsedFormula && upcastMode === 'dice' && parsedFormula.dieSize !== upcastDieSize) errors.upcastDieSize = 'Additional dice must use the base formula die size in this stage.'
  const schoolValid = SPELL_SCHOOLS.some((candidate) => candidate.toLocaleLowerCase() === school.toLocaleLowerCase())
  if (school && !schoolValid) errors.school = 'Choose a recognized school of magic.'
  return { spell: { name, level: Number(body.level), school: schoolValid ? SPELL_SCHOOLS.find((candidate) => candidate.toLocaleLowerCase() === school.toLocaleLowerCase())! : school, castingTime, castingTimeCategory: castingTimeCategory as CastingTimeCategory, range, components: Array.isArray(body.components) ? body.components as string[] : [], materialDetails, duration, concentration: body.concentration === true, ritual: body.ritual === true, description, resolutionType: resolutionType as SpellResolutionType, savingThrowAbility: savingThrowAbility as AbilityKey | null, attackType: attackType as SpellAttackType | null, targetGuidance, resolutionNotes, effectType: effectType as SpellEffectType, effectFormula, damageType: damageType as string | null, effectModifier: effectModifier as number, includeSpellcastingModifier: includeSpellcastingModifier as boolean, saveSuccessEffect: saveSuccessEffect as SaveSuccessEffect | null, upcastMode: upcastMode as UpcastMode, upcastDiceCount: upcastDiceCount as number, upcastDieSize: upcastDieSize as number | null, upcastModifier: upcastModifier as number, effectNotes }, errors }
}
}

export = spellRules
