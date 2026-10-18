import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveSpellcastingBonuses } from './spellRules.ts'

test('spellcasting bonuses derive from the configured ability and existing proficiency formula', () => {
  const scores = { str: 10, dex: 10, con: 10, int: 18, wis: 14, cha: 8 }
  assert.deepEqual(deriveSpellcastingBonuses({ enabled: true, ability: 'int', level: 5, scores }), { spellAttackBonus: 7, spellSaveDc: 15, warning: null })
  assert.deepEqual(deriveSpellcastingBonuses({ enabled: true, ability: 'wis', level: 1, scores }), { spellAttackBonus: 4, spellSaveDc: 12, warning: null })
  assert.equal(deriveSpellcastingBonuses({ enabled: false, ability: 'cha', level: 4, scores }).spellAttackBonus, null)
  assert.match(deriveSpellcastingBonuses({ enabled: true, ability: null, level: 4, scores }).warning ?? '', /Choose a spellcasting ability/)
})
