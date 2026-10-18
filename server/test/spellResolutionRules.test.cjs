require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/spellResolutionRules.ts')

function roller(...values) { let index = 0; return () => values[index++] }

test('spell attacks calculate only ability plus proficiency, use standard d20 modes, and preserve natural 1/20 rules', () => {
  assert.equal(rules.spellAttackBonus(18, 5), 7)
  assert.equal(rules.spellSaveDc(18, 5), 15)
  const normal = rules.resolveSpellAttack(7, 15, 'normal', 0, roller(8))
  assert.equal(normal.total, 15); assert.equal(normal.outcome, 'hit')
  const advantage = rules.resolveSpellAttack(7, 20, 'advantage', 0, roller(2, 14))
  assert.equal(advantage.keptIndex, 1); assert.equal(advantage.mode, 'advantage')
  const disadvantage = rules.resolveSpellAttack(7, 20, 'disadvantage', -2, roller(17, 10))
  assert.equal(disadvantage.keptIndex, 1); assert.equal(disadvantage.total, 15)
  assert.equal(rules.resolveSpellAttack(-100, 50, 'normal', 0, roller(1)).outcome, 'miss')
  assert.equal(rules.resolveSpellAttack(-100, 50, 'normal', 0, roller(20)).outcome, 'critical_hit')
  assert.throws(() => rules.spellAttackBonus(31, 1), /ability score/)
})

test('saving throw math handles every ability, proficiency, Exhaustion, equality, and no natural 1/20 auto rule', () => {
  for (const score of [8, 10, 12, 18]) {
    assert.equal(rules.savingThrowModifier(score, 5, true), Math.floor((score - 10) / 2) + 3)
  }
  assert.equal(rules.savingThrowModifier(14, 9, false), 2)
  assert.deepEqual(rules.resolveSavingThrow({ naturalRoll: 10, targetModifier: 3, exhaustionPenalty: -2, dc: 11 }), {
    naturalRoll: 10, targetModifier: 3, exhaustionPenalty: -2, total: 11, dc: 11, outcome: 'success', breakdown: 'd20 (10) saving throw + 3 Exhaustion -2 = 11 vs DC 11',
  })
  assert.equal(rules.resolveSavingThrow({ naturalRoll: 1, targetModifier: 100, exhaustionPenalty: 0, dc: 10 }).outcome, 'success')
  assert.equal(rules.resolveSavingThrow({ naturalRoll: 20, targetModifier: -100, exhaustionPenalty: 0, dc: 10 }).outcome, 'failure')
  assert.equal(rules.resolveSavingThrow({ targetModifier: 4, exhaustionPenalty: -2, dc: 15, autoFail: true }).outcome, 'automatic_failure')
  assert.equal(rules.resolveSavingThrow({ exhaustionPenalty: 0, dc: 15 }).outcome, 'adjudication_required')
})
