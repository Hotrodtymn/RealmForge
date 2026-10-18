import test from 'node:test'
import assert from 'node:assert/strict'
import { canRecordDecision, chooseSession, playerCharacterSummary, sceneSelection } from './soloAdventureView.mjs'

test('session selection restores an existing choice, otherwise prefers in-progress then recent history', () => {
  const sessions = [{ id: 'done', status: 'completed' }, { id: 'paused', status: 'paused' }, { id: 'active', status: 'active' }]
  assert.equal(chooseSession(sessions, 'done'), 'done')
  assert.equal(chooseSession(sessions), 'paused')
  assert.equal(chooseSession([{ id: 'done', status: 'completed' }]), 'done')
  assert.equal(chooseSession([]), '')
})

test('scene selection displays historical scenes read-only and returns to current scene by default', () => {
  const old = { id: 'old', title: 'Old scene' }
  const current = { id: 'now', title: 'Current scene' }
  assert.deepEqual(sceneSelection([old, current], current, 'old'), { scene: old, isCurrent: false })
  assert.deepEqual(sceneSelection([old, current], current), { scene: current, isCurrent: true })
  assert.equal(canRecordDecision('active', false, 'look around', false), false)
})

test('decision submission requires active current scene, nonblank text, and no request already in flight', () => {
  assert.equal(canRecordDecision('active', true, '  I inspect the map  ', false), true)
  assert.equal(canRecordDecision('active', true, '  ', false), false)
  assert.equal(canRecordDecision('paused', true, 'continue', false), false)
  assert.equal(canRecordDecision('completed', true, 'continue', false), false)
  assert.equal(canRecordDecision('active', true, 'continue', true), false)
})

test('character summary exposes supported profile fields and gracefully handles missing data', () => {
  assert.deepEqual(playerCharacterSummary({ id: 'c1', name: 'Mira', species: 'Elf', class: 'Ranger', level: 3 }), { id: 'c1', name: 'Mira', species: 'Elf', class: 'Ranger', level: 3 })
  assert.deepEqual(playerCharacterSummary({ id: 'c1', name: 'Mira' }), { id: 'c1', name: 'Mira', species: '', class: '', level: null })
  assert.equal(playerCharacterSummary(null), null)
})
