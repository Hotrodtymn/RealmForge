require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveAttack } = require('../src/attackRules.ts')

function roller(...values) { let index = 0; return () => values[index++] }

test('normal, advantage, and disadvantage attacks keep the correct d20', () => {
  assert.deepEqual(resolveAttack(5, 15, 'normal', 0, roller(10)).diceResults, [10])
  const advantage = resolveAttack(2, 15, 'advantage', 0, roller(4, 18))
  assert.deepEqual(advantage.diceResults, [4, 18]); assert.equal(advantage.keptIndex, 1)
  const disadvantage = resolveAttack(2, 15, 'disadvantage', 0, roller(18, 4))
  assert.deepEqual(disadvantage.diceResults, [18, 4]); assert.equal(disadvantage.keptIndex, 1)
})

test('natural 20 crits, natural 1 misses, and totals compare inclusively to AC', () => {
  assert.equal(resolveAttack(-10, 50, 'normal', 0, roller(20)).outcome, 'critical_hit')
  assert.equal(resolveAttack(100, 1, 'normal', 0, roller(1)).outcome, 'miss')
  assert.equal(resolveAttack(3, 15, 'normal', 2, roller(10)).outcome, 'hit')
  assert.equal(resolveAttack(3, 16, 'normal', 2, roller(10)).outcome, 'miss')
  assert.equal(resolveAttack(2, 10, 'advantage', 0, roller(1, 20)).keptIndex, 1)
  assert.equal(resolveAttack(2, 10, 'disadvantage', 0, roller(20, 1)).outcome, 'miss')
})

test('positive and negative situational modifiers are included, and invalid rolls are rejected', () => {
  assert.equal(resolveAttack(4, 18, 'normal', 3, roller(10)).total, 17)
  assert.equal(resolveAttack(4, 18, 'normal', -3, roller(10)).total, 11)
  assert.throws(() => resolveAttack(0, 12, 'normal', 101, roller(8)), /Situational modifier/)
  assert.throws(() => resolveAttack(0, 12, 'normal', 0, roller(0)), /invalid d20/)
  assert.throws(() => resolveAttack(0, 12, 'triple', 0, roller(8)), /Roll mode/)
})

test('verified condition Critical Hits apply on a hit within range but never override a natural 1 or miss', () => {
  assert.equal(resolveAttack(2, 12, 'normal', 0, roller(10), true).outcome, 'critical_hit')
  assert.equal(resolveAttack(-10, 12, 'normal', 0, roller(10), true).outcome, 'miss')
  assert.equal(resolveAttack(100, 12, 'normal', 0, roller(1), true).outcome, 'miss')
  assert.equal(resolveAttack(2, 12, 'normal', 0, roller(10), false).outcome, 'hit')
})
