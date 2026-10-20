require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/damageRules.ts')

function dice(...values) { let index = 0; return () => values[index++] }

test('structured weapon damage uses the catalog for common weapons and versatile modes', () => {
  assert.deepEqual(rules.weaponDamage.longsword, { diceCount: 1, dieSize: 8, type: 'slashing', versatileDiceCount: 1, versatileDieSize: 10 })
  assert.deepEqual(rules.weaponDamage.greatsword, { diceCount: 2, dieSize: 6, type: 'slashing' })
  assert.equal(rules.weaponDamage.longbow.ranged, true)
  assert.equal(rules.weaponDamage.handaxe.thrown, true)
  const oneHanded = rules.resolveDamage({ diceCount: 1, dieSize: 8, formulaModifier: 0, abilityModifier: 3, situationalModifier: 0, critical: false }, dice(6))
  assert.equal(oneHanded.total, 9)
  assert.equal(oneHanded.breakdown.includes('Proficiency'), false)
})

test('critical damage doubles dice only and adds each modifier once', () => {
  const result = rules.resolveDamage({ diceCount: 2, dieSize: 6, formulaModifier: 2, abilityModifier: 3, situationalModifier: -1, critical: true }, dice(1, 2, 3, 4))
  assert.deepEqual(result.diceResults, [1, 2, 3, 4])
  assert.equal(result.total, 14)
  assert.match(result.breakdown, /Critical/)
  assert.equal(rules.resolveDamage({ diceCount: 1, dieSize: 8, formulaModifier: 0, abilityModifier: -5, situationalModifier: -8, critical: false }, dice(2)).total, 0)
})

test('enemy damage formula parser accepts bounded simple notation and rejects arbitrary syntax', () => {
  assert.deepEqual(rules.parseEnemyFormula('2d8+3'), { diceCount: 2, dieSize: 8, modifier: 3 })
  assert.deepEqual(rules.parseEnemyFormula('1d6-2'), { diceCount: 1, dieSize: 6, modifier: -2 })
  for (const invalid of ['0d6', '21d6', '1d100', '1d6+101', '1d6; process.exit()', '1d6 + 2']) {
    assert.throws(() => rules.parseEnemyFormula(invalid))
  }
})

test('damage resolution validates dice configuration and random results', () => {
  assert.throws(() => rules.resolveDamage({ diceCount: 21, dieSize: 6, formulaModifier: 0, abilityModifier: 0, situationalModifier: 0, critical: false }))
  assert.throws(() => rules.resolveDamage({ diceCount: 1, dieSize: 6, formulaModifier: 0, abilityModifier: 0, situationalModifier: 0, critical: false }, () => 7))
})
