import test from 'node:test'
import assert from 'node:assert/strict'
import { readTheme, saveTheme } from './themePreferences.mjs'

function memoryStorage(initial = null) {
  let value = initial
  return { getItem: () => value, setItem: (_key, next) => { value = next }, value: () => value }
}

test('theme selection defaults to Modern Dark Fantasy and safely restores supported choices', () => {
  assert.equal(readTheme(memoryStorage()), 'modern')
  assert.equal(readTheme(memoryStorage('invalid')), 'modern')
  assert.equal(readTheme(memoryStorage('gothic')), 'gothic')
  assert.equal(readTheme({ getItem: () => { throw new Error('storage blocked') } }), 'modern')
})

test('theme selection persists locally and rejects unknown identifiers', () => {
  const storage = memoryStorage()
  saveTheme('tactical', storage)
  assert.equal(readTheme(storage), 'tactical')
  assert.throws(() => saveTheme('other', storage), /Unsupported/)
})
