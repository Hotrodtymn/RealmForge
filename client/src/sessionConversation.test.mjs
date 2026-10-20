import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const filename = resolve(dirname(fileURLToPath(import.meta.url)), 'SessionConversation.tsx')
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const componentModule = new Module(filename)
componentModule.filename = filename
componentModule.paths = Module._nodeModulePaths(dirname(filename))
componentModule._compile(compiled.outputText, filename)
const SessionConversation = componentModule.exports.default

test('player conversation renders restored turns in distinct player and DM styles', () => {
  const markup = renderToStaticMarkup(React.createElement(SessionConversation, {
    turns: [{ id: 't1', sessionId: 's1', characterId: 'c1', clientTurnId: 'c1', action: 'I ask about the bell.', response: 'The ferryman lowers her lantern.', status: 'completed', createdAt: '2026-10-18T12:00:00.000Z', updatedAt: '2026-10-18T12:00:01.000Z', completedAt: '2026-10-18T12:00:01.000Z' }],
    loading: false, loadError: '', busy: false, error: '', action: '', sessionActive: true, currentScene: true,
    onActionChange() {}, onSubmit() {}, onRetry() {}, onReload() {}, onRetryTurn() {},
  }))
  assert.match(markup, /Adventure conversation/)
  assert.match(markup, /I ask about the bell\./)
  assert.match(markup, /REALMFORGE DM/)
  assert.match(markup, /The ferryman lowers her lantern\./)
  assert.match(markup, /Submit Action/)
  assert.match(markup, /Ctrl\/Cmd\+Enter submits/)
})

test('player conversation exposes loading and failed-turn retry states', () => {
  const props = { loading: false, loadError: '', busy: false, error: '', action: 'I listen again.', sessionActive: true, currentScene: true, onActionChange() {}, onSubmit() {}, onRetry() {}, onReload() {}, onRetryTurn() {} }
  const loading = renderToStaticMarkup(React.createElement(SessionConversation, { ...props, turns: [], loading: true }))
  assert.match(loading, /Restoring this session’s conversation/)
  const loadError = renderToStaticMarkup(React.createElement(SessionConversation, { ...props, turns: [], loadError: 'Could not load transcript.' }))
  assert.match(loadError, /Retry conversation/)
  const failed = renderToStaticMarkup(React.createElement(SessionConversation, { ...props, turns: [{ id: 't2', sessionId: 's1', characterId: 'c1', clientTurnId: 'c2', action: 'I listen again.', response: null, status: 'failed', createdAt: '2026-10-18T12:01:00.000Z', updatedAt: '2026-10-18T12:01:01.000Z', completedAt: null }] }))
  assert.match(failed, /Your action is preserved/)
  assert.match(failed, /Retry this action/)
  const pending = renderToStaticMarkup(React.createElement(SessionConversation, { ...props, turns: [{ id: 't3', sessionId: 's1', characterId: 'c1', clientTurnId: 'c3', action: 'I wait for a reply.', response: null, status: 'pending', createdAt: '2026-10-18T12:02:00.000Z', updatedAt: '2026-10-18T12:02:00.000Z', completedAt: null }] }))
  assert.match(pending, /Retry if interrupted/)
  assert.match(failed, /textarea/)
})
