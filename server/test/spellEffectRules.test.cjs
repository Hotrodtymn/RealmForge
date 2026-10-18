require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/spellEffectRules.ts')

function config(overrides = {}) { return { effectType: 'damage', effectFormula: '1d8+2', damageType: 'fire', effectModifier: 1, includeSpellcastingModifier: false, saveSuccessEffect: null, upcastMode: 'none', upcastDiceCount: 0, upcastDieSize: null, upcastModifier: 0, ...overrides } }

test('spell effect plans include formula and fixed modifiers and preserve base level', () => {
  assert.deepEqual(rules.plan(config(), 1, 1), { baseLevel: 1, castLevel: 1, baseFormula: '1d8+2', finalFormula: '1d8+3', diceCount: 1, dieSize: 8, formulaModifier: 3, fixedModifier: 1, upcastLevels: 0, scaling: 'No upcasting scaling.' })
})

test('explicit dice and modifier upcasting scale only above the base level', () => {
  const dice = rules.plan(config({ upcastMode: 'dice', upcastDiceCount: 1, upcastDieSize: 8 }), 1, 3)
  assert.equal(dice.finalFormula, '3d8+3'); assert.equal(dice.scaling, '+2d8 (2 levels above base)')
  const modifier = rules.plan(config({ upcastMode: 'modifier', upcastModifier: 2 }), 2, 4)
  assert.equal(modifier.finalFormula, '1d8+7'); assert.equal(modifier.formulaModifier, 7)
  assert.equal(rules.plan(config(), 1, 4).finalFormula, '1d8+3')
})

test('cast levels, cantrips, formula bounds, and die scaling configuration are validated', () => {
  assert.throws(() => rules.plan(config(), 2, 1), /below/)
  assert.throws(() => rules.plan(config(), 2, 10), /0 to 9/)
  assert.throws(() => rules.plan(config(), 0, 1), /Cantrips/)
  assert.throws(() => rules.plan(config({ effectFormula: '1d7' }), 1, 1), /formula/)
  assert.throws(() => rules.plan(config({ upcastMode: 'dice', upcastDiceCount: 1, upcastDieSize: 6 }), 1, 2), /configuration/)
  assert.throws(() => rules.plan(config({ effectFormula: '20d20', upcastMode: 'dice', upcastDiceCount: 1, upcastDieSize: 20 }), 1, 2), /20-die limit/)
})

test('saving throw effect behavior handles full, half rounded down, and no damage', () => {
  assert.deepEqual(rules.saveAmount(9, false, 'half'), { amount: 9, status: 'rolled' })
  assert.deepEqual(rules.saveAmount(9, true, 'full'), { amount: 9, status: 'rolled' })
  assert.deepEqual(rules.saveAmount(9, true, 'half'), { amount: 4, status: 'rolled' })
  assert.deepEqual(rules.saveAmount(9, true, 'none'), { amount: 0, status: 'no_effect' })
  assert.throws(() => rules.saveAmount(3, true, null), /explicit success behavior/)
})
