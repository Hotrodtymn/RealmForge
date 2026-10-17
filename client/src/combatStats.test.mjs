import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateArmorClass, calculateWeaponAttackBonus } from './combatStats.ts'

const abilities = { str: 16, dex: 18, con: 12, int: 10, wis: 10, cha: 10 }

test('armor class supports unarmored and light armor with positive and negative Dexterity modifiers', () => {
  assert.equal(calculateArmorClass({ dexterityScore: 18, armorEquipped: false, armorDefinitionId: null, shieldEquipped: false, manualOverride: null }).value, 14)
  assert.equal(calculateArmorClass({ dexterityScore: 7, armorEquipped: false, armorDefinitionId: null, shieldEquipped: false, manualOverride: null }).value, 8)
  assert.equal(calculateArmorClass({ dexterityScore: 18, armorEquipped: true, armorDefinitionId: 'leather', shieldEquipped: false, manualOverride: null }).value, 15)
  assert.equal(calculateArmorClass({ dexterityScore: 7, armorEquipped: true, armorDefinitionId: 'studded_leather', shieldEquipped: false, manualOverride: null }).value, 10)
})

test('medium armor caps positive Dexterity at +2 and heavy armor ignores Dexterity', () => {
  assert.equal(calculateArmorClass({ dexterityScore: 20, armorEquipped: true, armorDefinitionId: 'chain_shirt', shieldEquipped: false, manualOverride: null }).value, 15)
  assert.equal(calculateArmorClass({ dexterityScore: 20, armorEquipped: true, armorDefinitionId: 'plate', shieldEquipped: false, manualOverride: null }).value, 18)
  assert.equal(calculateArmorClass({ dexterityScore: 7, armorEquipped: true, armorDefinitionId: 'chain_mail', shieldEquipped: false, manualOverride: null }).value, 16)
})

test('equipped shield adds two AC and manual AC is labeled as an override', () => {
  const shielded = calculateArmorClass({ dexterityScore: 14, armorEquipped: true, armorDefinitionId: 'leather', shieldEquipped: true, manualOverride: null })
  assert.equal(shielded.value, 15)
  assert.match(shielded.breakdown, /Shield \+2/)
  assert.deepEqual(calculateArmorClass({ dexterityScore: 8, armorEquipped: true, armorDefinitionId: null, shieldEquipped: true, manualOverride: 21 }), {
    configured: true, value: 21, source: 'manual', breakdown: 'Manual AC override: 21',
  })
  assert.equal(calculateArmorClass({ dexterityScore: 12, armorEquipped: true, armorDefinitionId: null, shieldEquipped: false, manualOverride: null }).source, 'unconfigured')
  assert.throws(() => calculateArmorClass({ dexterityScore: 12, armorEquipped: false, armorDefinitionId: null, shieldEquipped: false, manualOverride: 0 }), RangeError)
})

test('weapon attacks use Strength for melee and Dexterity for ranged weapons', () => {
  const melee = calculateWeaponAttackBonus({ abilityScores: abilities, level: 5, weaponDefinitionId: 'longsword', weaponAbility: null, proficient: false, manualOverride: null })
  assert.equal(melee.ability, 'str')
  assert.equal(melee.total, 3)
  const ranged = calculateWeaponAttackBonus({ abilityScores: abilities, level: 5, weaponDefinitionId: 'longbow', weaponAbility: null, proficient: false, manualOverride: null })
  assert.equal(ranged.ability, 'dex')
  assert.equal(ranged.total, 4)
})

test('finesse weapons accept Strength or Dexterity and thrown weapons use melee ability', () => {
  const finesse = calculateWeaponAttackBonus({ abilityScores: abilities, level: 1, weaponDefinitionId: 'rapier', weaponAbility: 'dex', proficient: false, manualOverride: null })
  assert.equal(finesse.ability, 'dex')
  assert.equal(finesse.total, 4)
  const thrown = calculateWeaponAttackBonus({ abilityScores: abilities, level: 1, weaponDefinitionId: 'handaxe', weaponAbility: null, proficient: true, manualOverride: null })
  assert.equal(thrown.ability, 'str')
  assert.equal(thrown.total, 5)
})

test('proficiency is added only when selected and manual weapon overrides are distinct', () => {
  const noProficiency = calculateWeaponAttackBonus({ abilityScores: abilities, level: 5, weaponDefinitionId: 'shortbow', weaponAbility: null, proficient: false, manualOverride: null })
  const proficient = calculateWeaponAttackBonus({ abilityScores: abilities, level: 5, weaponDefinitionId: 'shortbow', weaponAbility: null, proficient: true, manualOverride: null })
  assert.equal(noProficiency.total, 4)
  assert.equal(proficient.total, 7)
  const manual = calculateWeaponAttackBonus({ abilityScores: abilities, level: 5, weaponDefinitionId: 'shortbow', weaponAbility: null, proficient: true, manualOverride: 9 })
  assert.equal(manual.total, 9)
  assert.equal(manual.source, 'manual')
  assert.equal(calculateWeaponAttackBonus({ abilityScores: abilities, level: 1, weaponDefinitionId: null, weaponAbility: null, proficient: false, manualOverride: null }).source, 'unconfigured')
  assert.throws(() => calculateWeaponAttackBonus({ abilityScores: abilities, level: 1, weaponDefinitionId: 'club', weaponAbility: 'dex', proficient: false, manualOverride: null }), RangeError)
  assert.throws(() => calculateWeaponAttackBonus({ abilityScores: abilities, level: 1, weaponDefinitionId: null, weaponAbility: null, proficient: false, manualOverride: 51 }), RangeError)
})
