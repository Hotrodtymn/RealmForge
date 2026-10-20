require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const registryModule = require('../src/worldExpansionApprovalRegistry.ts')

const proposals = { npcs: [], locations: [], quests: [] }
const snapshot = { adventureId: 'adventure-a', sessionId: 'session-a', model: 'llama3.1:8b', generatedAt: new Date(0).toISOString(), proposals }

test('approval previews are unpredictable, adventure-scoped, partial, one-time per proposal, and expire', () => {
  let now = 100
  let next = 0
  const registry = new registryModule.WorldExpansionApprovalRegistry({ ttlMs: 1000, maxEntries: 2, now: () => now, tokenFactory: () => `${String(++next).padStart(43, 'A')}` })
  const emptySnapshot = { ...snapshot, proposals: { npcs: [{ key: 'npc_sable' }], locations: [], quests: [] } }
  const issued = registry.issue(emptySnapshot)
  assert.match(issued.previewId, /^[A-Za-z0-9_-]{40,60}$/)
  assert.throws(() => registry.approve(issued.previewId, 'adventure-b', ['npc_sable'], () => null), { code: 'adventure' })
  assert.throws(() => registry.approve(issued.previewId, 'adventure-a', ['missing_key'], () => null), { code: 'unknown-proposal' })
  const saved = registry.approve(issued.previewId, 'adventure-a', ['npc_sable'], (_heldSnapshot, selected, token, approvedKeys) => ({ selected: selected.map((entry) => entry.key), token, prior: [...approvedKeys] }))
  assert.deepEqual(saved.value.selected, ['npc_sable'])
  assert.deepEqual(saved.value.prior, [])
  assert.deepEqual(saved.remainingProposalKeys, [])
  assert.throws(() => registry.approve(issued.previewId, 'adventure-a', ['npc_sable'], () => null), { code: 'already-approved' })
  now += 1001
  assert.throws(() => registry.approve(issued.previewId, 'adventure-a', ['npc_sable'], () => null), { code: 'expired' })
  const restartedRegistry = new registryModule.WorldExpansionApprovalRegistry({ ttlMs: 1000, maxEntries: 2, now: () => now })
  assert.throws(() => restartedRegistry.approve(issued.previewId, 'adventure-a', ['npc_sable'], () => null), { code: 'invalid' })
})

test('failed persistence leaves approval selection retryable', () => {
  const registry = new registryModule.WorldExpansionApprovalRegistry({ tokenFactory: () => 'T'.repeat(43) })
  const issued = registry.issue({ ...snapshot, proposals: { npcs: [{ key: 'npc_sable' }], locations: [], quests: [] } })
  assert.throws(() => registry.approve(issued.previewId, 'adventure-a', ['npc_sable'], () => { throw new Error('rollback') }), /rollback/)
  const retry = registry.approve(issued.previewId, 'adventure-a', ['npc_sable'], () => 'saved')
  assert.equal(retry.value, 'saved')
})
