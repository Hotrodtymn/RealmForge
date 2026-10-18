require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const rules = require('../src/survivalRules.ts')

const dying = (overrides = {}) => ({ currentHp: 0, maxHp: 10, successes: 0, failures: 0, status: 'unconscious', ...overrides })

test('death save thresholds, natural 1, and natural 20 follow the survival rules', () => {
  assert.equal(rules.deathSave(dying(), 9).state.failures, 1)
  assert.equal(rules.deathSave(dying(), 10).state.successes, 1)
  const one = rules.deathSave(dying({ failures: 1 }), 1)
  assert.equal(one.state.failures, 3)
  assert.equal(one.state.status, 'dead')
  assert.match(one.message, /Natural 1/)
  const twenty = rules.deathSave(dying({ successes: 2, failures: 1 }), 20)
  assert.deepEqual([twenty.state.currentHp, twenty.state.successes, twenty.state.failures, twenty.state.status], [1, 0, 0, 'conscious'])
})

test('three successes stabilize and three failures kill', () => {
  assert.equal(rules.deathSave(dying({ successes: 2 }), 10).state.status, 'stable')
  assert.equal(rules.deathSave(dying({ failures: 2 }), 9).state.status, 'dead')
  assert.equal(rules.stabilize(dying()).state.status, 'stable')
  assert.throws(() => rules.deathSave(dying({ status: 'stable' }), 12), /only available/)
})

test('healing resets counters and unconsciousness; damage at zero, critical damage, and massive damage resolve', () => {
  const healed = rules.recover(dying({ failures: 2, successes: 1 }), 4)
  assert.deepEqual([healed.state.currentHp, healed.state.successes, healed.state.failures, healed.state.status], [4, 0, 0, 'conscious'])
  assert.equal(rules.enterZeroHp(dying({ failures: 1 }), 3, false).state.failures, 2)
  const stableDamage = rules.enterZeroHp(dying({ status: 'stable', successes: 3 }), 1, false).state
  assert.deepEqual([stableDamage.status, stableDamage.successes, stableDamage.failures], ['unconscious', 0, 1])
  assert.equal(rules.enterZeroHp(dying(), 0, false).state.failures, 0)
  assert.equal(rules.enterZeroHp(dying(), 3, true).state.failures, 2)
  assert.equal(rules.enterZeroHp(dying(), 10, false).state.status, 'dead')
  assert.equal(rules.enterZeroHp({ currentHp: 5, maxHp: 10, successes: 0, failures: 0, status: 'conscious' }, 15, false).state.status, 'dead')
  assert.equal(rules.enterZeroHp({ currentHp: 5, maxHp: 10, successes: 0, failures: 0, status: 'conscious' }, 14, false).state.status, 'unconscious')
  assert.throws(() => rules.recover(dying({ status: 'dead' }), 1), /dead character/)
})
