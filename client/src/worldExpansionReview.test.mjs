import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const filename = resolve(dirname(fileURLToPath(import.meta.url)), 'worldExpansionReview.ts')
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const loaded = new Module(filename)
loaded.filename = filename
loaded.paths = Module._nodeModulePaths(dirname(filename))
loaded._compile(compiled.outputText, filename)
const { approvalError, approvalPayload, ApprovalRequestError, createReviewState, dependencyProblems, reviewReducer, submitApproval } = loaded.exports

test('review state starts unselected and toggles only the selected proposal', () => {
  let state = createReviewState()
  assert.equal(state.selectedKeys.size, 0)
  state = reviewReducer(state, { type: 'toggle', key: 'npc_sable' })
  assert.deepEqual([...state.selectedKeys], ['npc_sable'])
  state = reviewReducer(state, { type: 'toggle', key: 'npc_sable' })
  assert.equal(state.selectedKeys.size, 0)
})

test('editing saves a creative draft, while cancel discards only the active draft', () => {
  let state = reviewReducer(createReviewState(), { type: 'edit', key: 'npc_sable', values: { name: 'Sable', description: 'Original' } })
  state = reviewReducer(state, { type: 'change', field: 'description', value: 'Unsaved' })
  state = reviewReducer(state, { type: 'cancel-edit' })
  assert.equal(state.savedEdits.npc_sable, undefined)
  state = reviewReducer(state, { type: 'edit', key: 'npc_sable', values: { name: 'Sable', description: 'Updated' } })
  state = reviewReducer(state, { type: 'save-edit' })
  assert.deepEqual(state.savedEdits.npc_sable, { name: 'Sable', description: 'Updated' })
  assert.equal(state.editingKey, null)
})

test('approval payload includes only selected keys and their saved permitted edits', () => {
  let state = reviewReducer(createReviewState(), { type: 'toggle', key: 'npc_sable' })
  state = reviewReducer(state, { type: 'toggle', key: 'quest_echoes' })
  const payload = approvalPayload('preview-secret', 'adventure-1', state.selectedKeys, {
    npc_sable: { name: 'Sable the Watcher', description: 'A watchful scholar.' },
    unselected: { name: 'Must not send' },
  })
  assert.deepEqual(payload, {
    previewId: 'preview-secret', adventureId: 'adventure-1', selectedProposalKeys: ['npc_sable', 'quest_echoes'],
    edits: { npc_sable: { name: 'Sable the Watcher', description: 'A watchful scholar.' } },
  })
  assert.doesNotMatch(JSON.stringify(payload), /evidence|uncertainty|sourceId|reference/i)
})

test('proposal dependencies block unselected or unknown proposed entities but accept approved dependencies', () => {
  const proposals = [
    { key: 'npc_sable', description: 'A scholar.' },
    { key: 'quest_echoes', description: 'Follow the echoes.', npcRefs: [{ type: 'proposal', key: 'npc_sable' }] },
  ]
  assert.deepEqual(dependencyProblems(proposals, new Set(['quest_echoes']), new Set()), [{ proposalKey: 'quest_echoes', dependencyKey: 'npc_sable' }])
  assert.deepEqual(dependencyProblems(proposals, new Set(['quest_echoes']), new Set(['npc_sable'])), [])
  const unknown = [{ key: 'quest_missing', description: 'Quest', locationRefs: [{ type: 'proposal', key: 'missing_location' }] }]
  assert.equal(dependencyProblems(unknown, new Set(['quest_missing']), new Set()).length, 1)
  assert.deepEqual(dependencyProblems(proposals, new Set(['quest_echoes', 'npc_sable']), new Set()), [])
})

test('partial approval removes only approved selections and preserves the remaining review state', () => {
  let state = createReviewState()
  state = reviewReducer(state, { type: 'toggle', key: 'npc_sable' })
  state = reviewReducer(state, { type: 'toggle', key: 'quest_echoes' })
  state = reviewReducer(state, { type: 'approved', keys: ['npc_sable'] })
  assert.deepEqual([...state.selectedKeys], ['quest_echoes'])
  assert.equal(state.savedEdits.npc_sable, undefined)
})

test('approval errors explain expiry and missing storage without retrying', () => {
  assert.match(approvalError(410), /expired/i)
  assert.match(approvalError(503), /migration/i)
  assert.match(approvalError(404), /unknown/i)
})

test('mock approval response returns partial approval data and posts exactly once', async () => {
  let calls = 0
  let posted
  const response = await submitApproval({ previewId: 'preview', adventureId: 'adventure', selectedProposalKeys: ['npc_sable'] }, async (url, init) => {
    calls += 1
    assert.equal(url, 'http://localhost:3001/api/ai/world/expand/approve')
    posted = JSON.parse(init.body)
    return { ok: true, status: 201, json: async () => ({ approved: [{ proposalKey: 'npc_sable', type: 'npc', id: 'npc-id', name: 'Sable' }], metadata: { remainingProposalKeys: ['quest_echoes'], expiresAt: 'later' } }) }
  })
  assert.equal(calls, 1)
  assert.deepEqual(posted, { previewId: 'preview', adventureId: 'adventure', selectedProposalKeys: ['npc_sable'] })
  assert.deepEqual(response.metadata.remainingProposalKeys, ['quest_echoes'])
})

test('mocked expiry and migration failures stay explicit, while network failure is marked uncertain without retry', async () => {
  await assert.rejects(submitApproval({}, async () => ({ ok: false, status: 410, json: async () => ({ error: 'expired' }) })), (error) => error instanceof ApprovalRequestError && !error.uncertain && /expired/i.test(error.message))
  await assert.rejects(submitApproval({}, async () => ({ ok: false, status: 503, json: async () => ({ error: 'schema missing' }) })), (error) => error instanceof ApprovalRequestError && /migration/i.test(error.message))
  let calls = 0
  await assert.rejects(submitApproval({}, async () => { calls += 1; throw new Error('offline') }), (error) => error instanceof ApprovalRequestError && error.uncertain && /no request was retried/i.test(error.message))
  assert.equal(calls, 1)
})
