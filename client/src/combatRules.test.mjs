import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceTurn, sortCombatants, startTurn } from './combatRules.ts'

const combatants = [
  { id: 'first', initiativeTotal: 14, insertionOrder: 0 },
  { id: 'second', initiativeTotal: 18, insertionOrder: 1 },
  { id: 'third', initiativeTotal: 14, insertionOrder: 2 },
  { id: 'unready', initiativeTotal: null, insertionOrder: 3 },
]

test('initiative sorts high to low, ties follow stable insertion order, and unset results come last', () => {
  assert.deepEqual(sortCombatants(combatants).map(({ id }) => id), ['second', 'first', 'third', 'unready'])
})

test('start chooses the highest initiative and requires every combatant to have initiative', () => {
  assert.equal(startTurn(combatants), null)
  assert.deepEqual(startTurn(combatants.slice(0, 3)), { status: 'active', round: 1, activeCombatantId: 'second' })
  assert.equal(startTurn([]), null)
  assert.equal(startTurn([{ id: 'unset', initiativeTotal: null, insertionOrder: 0 }]), null)
})

test('turn advancement follows initiative and increments the round only when wrapping', () => {
  const order = sortCombatants(combatants)
  let state = { status: 'active', round: 1, activeCombatantId: order[0].id }
  state = advanceTurn(state, combatants)
  assert.deepEqual(state, { status: 'active', round: 1, activeCombatantId: 'first' })
  state = advanceTurn(state, combatants)
  assert.deepEqual(state, { status: 'active', round: 1, activeCombatantId: 'third' })
  state = advanceTurn(state, combatants)
  assert.deepEqual(state, { status: 'active', round: 2, activeCombatantId: 'second' })
  assert.equal(advanceTurn(state, []), null)
})

test('a missing current combatant picks the first available initiative without losing the round', () => {
  assert.deepEqual(advanceTurn({ status: 'active', round: 4, activeCombatantId: 'removed' }, combatants), {
    status: 'active', round: 4, activeCombatantId: 'second',
  })
})
