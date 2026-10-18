import assert from 'node:assert/strict'
import test from 'node:test'
import { getCombatantMarkers, getHpPercentage } from './combatPresentation.ts'

test('HP bars clamp visual values and handle invalid maxima', () => {
  assert.equal(getHpPercentage(25, 50), 50)
  assert.equal(getHpPercentage(0, 30), 0)
  assert.equal(getHpPercentage(35, 30), 100)
  assert.equal(getHpPercentage(-2, 30), 0)
  assert.equal(getHpPercentage(1, 0), 0)
})

test('combatant status markers independently identify active, attacker, and target', () => {
  assert.deepEqual(getCombatantMarkers('hero', 'hero', 'hero', 'foe'), { active: true, attacker: true, target: false })
  assert.deepEqual(getCombatantMarkers('foe', 'hero', 'hero', 'foe'), { active: false, attacker: false, target: true })
  assert.deepEqual(getCombatantMarkers('other', null, '', ''), { active: false, attacker: false, target: false })
})
