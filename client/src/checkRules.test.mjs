import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ABILITIES,
  SKILLS,
} from './characterRules.ts'
import {
  appendCheckHistory,
  checkOptions,
  resolveCheck,
  validateCheckInput,
} from './checkRules.ts'

const scores = { str: 10, dex: 12, con: 14, int: 16, wis: 17, cha: 8 }
const character = {
  id: 'character-a', name: 'Mira', level: 5, abilityScores: scores,
  savingThrowProficiencies: ['wis'], skillProficiencies: ['perception', 'arcana'],
}
const words = (...values) => {
  const queue = [...values]
  return () => queue.shift()
}

test('saving throws map to their matching abilities and all standard skills are mapped', () => {
  const saves = checkOptions('saving_throw')
  assert.deepEqual(saves.map(({ key, ability }) => [key, ability]), ABILITIES.map(({ key }) => [key, key]))
  const skills = checkOptions('skill')
  assert.equal(skills.length, 18)
  assert.deepEqual(skills.map(({ key, ability }) => [key, ability]), SKILLS.map(({ key, ability }) => [key, ability]))
})

test('normal skill checks include ability, proficiency when selected, and optional situational modifiers', () => {
  const proficient = resolveCheck({ character, kind: 'skill', key: 'perception', mode: 'normal', situationalModifier: 2 }, words(9))
  assert.equal(proficient.abilityModifier, 3)
  assert.equal(proficient.proficient, true)
  assert.equal(proficient.proficiencyBonus, 3)
  assert.equal(proficient.total, 18)
  assert.equal(proficient.breakdown, 'd20 (10) + Wisdom (+3) + Proficiency (+3) + Situational (+2) = 18')

  const untrained = resolveCheck({ character, kind: 'skill', key: 'stealth', mode: 'normal', situationalModifier: -2 }, words(9))
  assert.equal(untrained.proficient, false)
  assert.equal(untrained.proficiencyBonus, 0)
  assert.equal(untrained.total, 9)
  assert.match(untrained.breakdown, /Situational \(-2\)/)
})

test('saving throws support zero situational modifier without changing character data', () => {
  const before = structuredClone(character)
  const result = resolveCheck({ character, kind: 'saving_throw', key: 'wis', mode: 'normal', situationalModifier: 0 }, words(13))
  assert.equal(result.total, 20)
  assert.equal(result.breakdown, 'd20 (14) + Wisdom (+3) + Proficiency (+3) = 20')
  assert.deepEqual(character, before)
})

test('Exhaustion is applied once to ability checks and saving throws', () => {
  const result = resolveCheck({ character, kind: 'saving_throw', key: 'con', mode: 'normal', situationalModifier: 1, exhaustionPenalty: -4 }, words(10))
  assert.equal(result.total, 10, 'natural 11 + CON 2 + situational 1 - Exhaustion 4')
  assert.equal(result.exhaustionPenalty, -4)
  assert.match(result.breakdown, /Exhaustion \(-4\)/)
  assert.throws(() => resolveCheck({ character, kind: 'skill', key: 'arcana', mode: 'normal', situationalModifier: 0, exhaustionPenalty: -3 }, words(1)), /increments of 2/)
})

test('advantage and disadvantage use the kept natural d20 result', () => {
  const advantage = resolveCheck({ character, kind: 'skill', key: 'arcana', mode: 'advantage', situationalModifier: 0 }, words(5, 16))
  assert.deepEqual(advantage.diceResults, [6, 17])
  assert.deepEqual(advantage.keptIndices, [1])
  assert.equal(advantage.keptResult, 17)
  assert.equal(advantage.total, 23)
  assert.match(advantage.breakdown, /d20 \(6 \/ 17, kept 17\)/)

  const disadvantage = resolveCheck({ character, kind: 'skill', key: 'arcana', mode: 'disadvantage', situationalModifier: -1 }, words(16, 5))
  assert.deepEqual(disadvantage.diceResults, [17, 6])
  assert.deepEqual(disadvantage.keptIndices, [1])
  assert.equal(disadvantage.total, 11)
})

test('DC success and failure are calculated only when a DC is supplied', () => {
  const success = resolveCheck({ character, kind: 'saving_throw', key: 'wis', mode: 'normal', situationalModifier: 0, dc: 20 }, words(13))
  assert.equal(success.total, 20)
  assert.equal(success.outcome, 'success')
  const failure = resolveCheck({ character, kind: 'saving_throw', key: 'wis', mode: 'normal', situationalModifier: 0, dc: 21 }, words(13))
  assert.equal(failure.outcome, 'failure')
  const noDc = resolveCheck({ character, kind: 'saving_throw', key: 'wis', mode: 'normal', situationalModifier: 0 }, words(13))
  assert.equal('outcome' in noDc, false)
  assert.equal('dc' in noDc, false)
})

test('check input validation rejects invalid selection, modifier, DC, and mode', () => {
  const base = { character, kind: 'skill', key: 'arcana', mode: 'normal', situationalModifier: 0 }
  assert.throws(() => validateCheckInput({ ...base, key: 'not-a-skill' }), /valid saving throw or skill/)
  assert.throws(() => validateCheckInput({ ...base, situationalModifier: 1.5 }), /whole number from -100 to 100/)
  assert.throws(() => validateCheckInput({ ...base, situationalModifier: 101 }), /whole number from -100 to 100/)
  assert.throws(() => validateCheckInput({ ...base, dc: 0 }), /DC must be a whole number from 1 to 100/)
  assert.throws(() => validateCheckInput({ ...base, dc: 101 }), /DC must be a whole number from 1 to 100/)
  assert.throws(() => validateCheckInput({ ...base, mode: 'secret' }), /Normal, Advantage, or Disadvantage/)
})

test('history retains the latest 20 checks and snapshots the original character', () => {
  const originalCharacter = structuredClone(character)
  const first = resolveCheck({ character: originalCharacter, kind: 'skill', key: 'arcana', mode: 'normal', situationalModifier: 0 }, words(3))
  let history = appendCheckHistory([], first)
  originalCharacter.id = 'character-b'
  originalCharacter.name = 'A different adventurer'
  originalCharacter.abilityScores.int = 30
  const second = resolveCheck({ character: originalCharacter, kind: 'skill', key: 'arcana', mode: 'normal', situationalModifier: 0 }, words(4))
  history = appendCheckHistory(history, second)
  assert.equal(history[1].characterId, 'character-a')
  assert.equal(history[1].characterName, 'Mira')
  assert.equal(history[1].abilityModifier, 3)

  for (let index = 0; index < 25; index++) {
    const entry = resolveCheck({ character, kind: 'skill', key: 'athletics', mode: 'normal', situationalModifier: 0 }, () => index % 20)
    history = appendCheckHistory(history, entry)
  }
  assert.equal(history.length, 20)
  assert.equal(history[0].checkLabel, 'Athletics')
})
