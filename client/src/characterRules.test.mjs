import assert from 'node:assert/strict'
import test from 'node:test'
import { abilityModifier, proficiencyBonus, savingThrowBonus, skillBonus } from './characterRules.ts'

test('ability modifiers floor odd and even scores, including scores below ten', () => {
  assert.equal(abilityModifier(1), -5)
  assert.equal(abilityModifier(7), -2)
  assert.equal(abilityModifier(8), -1)
  assert.equal(abilityModifier(9), -1)
  assert.equal(abilityModifier(10), 0)
  assert.equal(abilityModifier(11), 0)
  assert.equal(abilityModifier(12), 1)
  assert.equal(abilityModifier(30), 10)
})

test('proficiency bonus changes at each four-level tier', () => {
  for (const [level, expected] of [[1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4], [13, 5], [16, 5], [17, 6], [20, 6]]) {
    assert.equal(proficiencyBonus(level), expected, `level ${level}`)
  }
})

test('saving throws and skills add proficiency only when selected', () => {
  assert.equal(savingThrowBonus(7, 5, false), -2)
  assert.equal(savingThrowBonus(7, 5, true), 1)
  assert.equal(skillBonus(15, 9, false), 2)
  assert.equal(skillBonus(15, 9, true), 6)
})

test('rules reject out-of-range and non-integer scores or levels', () => {
  for (const value of [0, 31, 1.5, NaN]) assert.throws(() => abilityModifier(value), RangeError)
  for (const value of [0, 21, 3.5, NaN]) assert.throws(() => proficiencyBonus(value), RangeError)
})
