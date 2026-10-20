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
require.extensions['.ts'] = (module, path) => {
  const source = readFileSync(path, 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  module._compile(output, path)
}
const filename = resolve(dirname(fileURLToPath(import.meta.url)), 'WorldExpansionPanel.tsx')
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
const componentModule = new Module(filename)
componentModule.filename = filename
componentModule.paths = Module._nodeModulePaths(dirname(filename))
componentModule._compile(compiled.outputText, filename)
const WorldExpansionPanel = componentModule.exports.default
const WorldExpansionEvidence = componentModule.exports.WorldExpansionEvidence
const ProposalNotice = componentModule.exports.ProposalNotice

test('world expansion panel starts with a preview-only review and no selected proposals', () => {
  const markup = renderToStaticMarkup(React.createElement(WorldExpansionPanel, {
    campaignId: 'campaign-1', adventureId: 'adventure-1', locations: [], npcs: [],
  }))
  assert.match(markup, /AI WORLD EXPANSION · REVIEW/)
  assert.match(markup, /Session and character/)
  assert.match(markup, /Generate World Expansion/)
  assert.match(markup, /Preview content is not saved until you explicitly approve selected proposals/)
  assert.doesNotMatch(markup, /Select for approval/)
  assert.doesNotMatch(markup, /Confirm approval/)
})

test('preview distinguishes new proposals from evidence and renders server-resolved provenance labels', () => {
  const notice = renderToStaticMarkup(React.createElement(ProposalNotice))
  assert.match(notice, /New creative proposal · not established campaign history/)

  const evidence = renderToStaticMarkup(React.createElement(WorldExpansionEvidence, { items: [
    { sourceType: 'story_memory', sourceId: 'memory-1', sourceLabel: 'Story memory 1 · mystery · npc claim', relationship: 'reported_claim', quote: 'The Spire whispers at night' },
    { sourceType: 'dm_narration', sourceId: 'conversation-1-narration', sourceLabel: 'DM narration · conversation turn 1', relationship: 'creative_inspiration', quote: 'A shadow crosses the town square.' },
  ] }))
  assert.match(evidence, /Story memory 1 · mystery · npc claim/)
  assert.match(evidence, /DM narration · conversation turn 1/)
  assert.match(evidence, /Provenance: story memory/)
  assert.match(evidence, /reported claim/)
  assert.match(evidence, /creative inspiration/)
  assert.doesNotMatch(evidence, /memory-1/)
  assert.doesNotMatch(evidence, /conversation-1-narration/)
})
