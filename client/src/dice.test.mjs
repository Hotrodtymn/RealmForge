import assert from 'node:assert/strict'
import test from 'node:test'
import { DIE_SIDES, randomInteger, rollDice, validateDiceRollInput } from './dice.ts'

test('every die maps the lowest and highest accepted random words to its face boundaries', () => {
  for (const sides of DIE_SIDES) {
    const acceptedRange = Math.floor(0x1_0000_0000 / sides) * sides
    assert.equal(randomInteger(sides, () => 0), 1)
    assert.equal(randomInteger(sides, () => acceptedRange - 1), sides)
  }
})

test('rejection sampling discards out-of-range words instead of introducing modulo bias', () => {
  const words = [0xffff_ffff, 4_294_967_199]
  let calls = 0
  const result = randomInteger(100, () => words[calls++])
  assert.equal(result, 100)
  assert.equal(calls, 2)
})

test('rejects malformed random source values', () => {
  assert.throws(() => randomInteger(6, () => -1), /unsigned 32-bit integer/)
  assert.throws(() => randomInteger(6, () => 1.5), /unsigned 32-bit integer/)
})

test('rolls multiple dice, keeps every result, and applies a negative modifier', () => {
  const words = [0, 1, 5]
  const result = rollDice({ diceCount: 3, sides: 6, modifier: -2, mode: 'normal' }, () => words.shift())
  assert.deepEqual(result.diceResults, [1, 2, 6])
  assert.deepEqual(result.keptIndices, [0, 1, 2])
  assert.equal(result.subtotal, 9)
  assert.equal(result.total, 7)
  assert.equal(result.breakdown, '3d6: 1 + 2 + 6 + modifier (-2) = 7')
})

test('supports one die, a positive modifier, and modifier boundaries', () => {
  const result = rollDice({ diceCount: 1, sides: 4, modifier: 1000, mode: 'normal' }, () => 3)
  assert.deepEqual(result.diceResults, [4])
  assert.equal(result.total, 1004)
  assert.equal(rollDice({ diceCount: 1, sides: 4, modifier: -1000, mode: 'normal' }, () => 0).total, -999)
})

test('advantage rolls two d20s, keeps the higher result, then applies the modifier', () => {
  const words = [4, 16]
  const result = rollDice({ diceCount: 1, sides: 20, modifier: -3, mode: 'advantage' }, () => words.shift())
  assert.deepEqual(result.diceResults, [5, 17])
  assert.deepEqual(result.keptIndices, [1])
  assert.equal(result.total, 14)
  assert.match(result.breakdown, /5 vs 17 \(kept\).*modifier \(-3\) = 14/)
})

test('disadvantage rolls two d20s, keeps the lower result, then applies the modifier', () => {
  const words = [16, 4]
  const result = rollDice({ diceCount: 1, sides: 20, modifier: 2, mode: 'disadvantage' }, () => words.shift())
  assert.deepEqual(result.diceResults, [17, 5])
  assert.deepEqual(result.keptIndices, [1])
  assert.equal(result.total, 7)
  assert.match(result.breakdown, /17 vs 5 \(kept\).*modifier \(\+2\) = 7/)
})

test('validates die count, die type, modifier, and advantage restrictions', () => {
  const base = { diceCount: 1, sides: 20, modifier: 0, mode: 'normal' }
  assert.throws(() => validateDiceRollInput({ ...base, diceCount: 0 }), /1 to 20/)
  assert.throws(() => validateDiceRollInput({ ...base, diceCount: 21 }), /1 to 20/)
  assert.throws(() => validateDiceRollInput({ ...base, diceCount: 1.5 }), /1 to 20/)
  assert.throws(() => validateDiceRollInput({ ...base, sides: 7 }), /available dice/)
  assert.throws(() => validateDiceRollInput({ ...base, modifier: 1.5 }), /whole number/)
  assert.throws(() => validateDiceRollInput({ ...base, modifier: 1001 }), /-1000 to 1000/)
  assert.throws(() => validateDiceRollInput({ ...base, mode: 'advantage', sides: 6 }), /single d20/)
  assert.throws(() => validateDiceRollInput({ ...base, mode: 'disadvantage', diceCount: 2 }), /single d20/)
})
