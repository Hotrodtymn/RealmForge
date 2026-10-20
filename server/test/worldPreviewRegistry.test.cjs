require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const registryModule = require('../src/worldPreviewRegistry.ts')

test('preview registry issues unpredictable tokens, expires unused previews, and rejects forged tokens', () => {
  let now = 1_800_000_000_000
  const registry = new registryModule.WorldPreviewRegistry({ ttlMs: 1000, maxEntries: 2, now: () => now, tokenFactory: () => require('node:crypto').randomBytes(32).toString('base64url') })
  const issued = registry.issue({ marker: 'bound-preview' })
  assert.match(issued.token, /^[A-Za-z0-9_-]{40,60}$/)
  const second = registry.issue({ marker: 'second' })
  assert.equal(new Set([issued.token, second.token]).size, 2)
  assert.throws(() => registry.save('forged-token-that-is-long-enough-but-not-real', () => ({})), { code: 'invalid' })
  now += 1001
  registry.issue({ marker: 'new token prunes expired records' })
  assert.throws(() => registry.save(issued.token, () => ({})), { code: 'expired' })
})

test('preview registry saves once and returns the exact saved value on retries', () => {
  let now = 1_800_000_000_000
  const registry = new registryModule.WorldPreviewRegistry({ ttlMs: 5000, maxEntries: 2, now: () => now })
  const issued = registry.issue({ preview: { title: 'exact preview' }, configuration: { dmMode: 'ai' } })
  let writes = 0
  const first = registry.save(issued.token, (snapshot) => { writes += 1; return { id: 'saved-id', snapshot } })
  const replay = registry.save(issued.token, () => { writes += 1; return { id: 'duplicate' } })
  assert.equal(first.replayed, false)
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.value, first.value)
  assert.equal(writes, 1)
  now += 5001
  assert.throws(() => registry.save(issued.token, () => ({})), { code: 'expired' })
})

test('preview registry restores save eligibility after transactional persistence fails and is capacity bounded', () => {
  const registry = new registryModule.WorldPreviewRegistry({ ttlMs: 1000, maxEntries: 1, now: () => 1_800_000_000_000 })
  const first = registry.issue({ id: 1 })
  assert.throws(() => registry.save(first.token, () => { throw new Error('rolled back') }), /rolled back/)
  assert.equal(registry.save(first.token, (snapshot) => snapshot).value.id, 1)
  assert.throws(() => registry.issue({ id: 2 }), { code: 'capacity' })
})
