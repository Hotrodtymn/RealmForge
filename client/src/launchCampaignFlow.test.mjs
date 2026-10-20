import test from 'node:test'
import assert from 'node:assert/strict'
import { eligibleLaunchCharacters, launchConfiguration, launchSessionRequest, summarizePreview, supportedLaunchConfiguration } from './launchCampaignFlow.mjs'

test('only the generation API supported configuration is accepted', () => {
  assert.equal(supportedLaunchConfiguration(launchConfiguration), true)
  assert.equal(supportedLaunchConfiguration({ ...launchConfiguration, theme: 'high-fantasy' }), false)
  assert.equal(supportedLaunchConfiguration({ ...launchConfiguration, dmMode: 'human-assisted' }), false)
})

test('eligible characters remain scoped to their campaign roster and exclude dead or retired', () => {
  const result = eligibleLaunchCharacters([{ playerId: 'p1', displayName: 'Mira', characters: [
    { id: 'active', status: 'active' }, { id: 'prepared', status: 'prepared' }, { id: 'dead', status: 'dead' }, { id: 'retired', status: 'retired' },
  ] }])
  assert.deepEqual(result.map(({ id, playerId, playerName }) => [id, playerId, playerName]), [['active', 'p1', 'Mira'], ['prepared', 'p1', 'Mira']])
})

test('session request snapshots the stored opening scene and retains an idempotency key', () => {
  const scene = { id: 'opening-id', locationId: 'location-id', title: 'The Bell', description: 'A scene from the persisted world.' }
  const request = launchSessionRequest('character-id', scene, 'stable-request-id')
  assert.deepEqual(request, { requestId: 'stable-request-id', characterId: 'character-id', locationId: 'location-id', sceneTitle: 'The Bell', sceneDescription: 'A scene from the persisted world.' })
  assert.throws(() => launchSessionRequest('character-id', null, 'stable-request-id'))
})

test('preview summary separates its starting location and preserves preview display data', () => {
  const preview = { campaign: { title: 'The Hollow' }, locations: [{ name: 'Gate', isStartingLocation: true }, { name: 'Keep', isStartingLocation: false }], npcs: [{ name: 'Warden' }], mainQuest: { objectives: [{ description: 'Find the bell' }] } }
  assert.deepEqual(summarizePreview(preview), { startingLocation: { name: 'Gate', isStartingLocation: true }, otherLocations: [{ name: 'Keep', isStartingLocation: false }], npcs: [{ name: 'Warden' }], objectives: [{ description: 'Find the bell' }] })
  assert.equal(summarizePreview(null), null)
})

test('player route selection survives direct navigation and refresh query parsing', async () => {
  const { playerSelectionFromSearch } = await import('./launchCampaignFlow.mjs')
  assert.deepEqual(playerSelectionFromSearch('?campaignId=c1&adventureId=a1&sessionId=s1'), { campaignId: 'c1', adventureId: 'a1', sessionId: 's1' })
  assert.deepEqual(playerSelectionFromSearch(''), { campaignId: '', adventureId: '', sessionId: '' })
})

test('generation sends only the supported configuration and returns the transient token', async () => {
  const { requestWorldPreview } = await import('./launchCampaignFlow.mjs')
  let captured
  const result = await requestWorldPreview(async (_url, options) => {
    captured = JSON.parse(options.body)
    return { ok: true, status: 200, json: async () => ({ preview: { campaign: { title: 'Ash' } }, previewToken: 'opaque-preview-token', model: 'llama3.1:8b' }) }
  }, '/api/ai/world/preview', new AbortController().signal)
  assert.deepEqual(captured, launchConfiguration)
  assert.equal(result.previewToken, 'opaque-preview-token')
})

test('generation reports API and incomplete-response failures', async () => {
  const { requestWorldPreview } = await import('./launchCampaignFlow.mjs')
  await assert.rejects(requestWorldPreview(async () => ({ ok: false, status: 503, json: async () => ({ error: 'Ollama unavailable' }) }), '/preview'), /Ollama unavailable/)
  await assert.rejects(requestWorldPreview(async () => ({ ok: true, status: 200, json: async () => ({ preview: {} }) }), '/preview'), /incomplete/)
})

test('save accepts both first-save and idempotent replay responses, posting only the token', async () => {
  const { saveWorldPreview } = await import('./launchCampaignFlow.mjs')
  for (const status of [201, 200]) {
    let body
    const saved = await saveWorldPreview(async (_url, options) => {
      body = JSON.parse(options.body)
      return { ok: true, status, json: async () => ({ campaign: { id: 'c1' }, adventure: { id: 'a1' }, referenceMap: { openingScene: 'o1' } }) }
    }, '/save', 'token')
    assert.deepEqual(body, { previewToken: 'token' })
    assert.equal(saved.status, status)
    assert.equal(saved.campaign.id, 'c1')
  }
})

test('save and session errors preserve their recovery context', async () => {
  const { saveWorldPreview, postOpeningSession } = await import('./launchCampaignFlow.mjs')
  await assert.rejects(saveWorldPreview(async () => ({ ok: false, status: 409, json: async () => ({ error: 'Save in progress' }) }), '/save', 'same-token'), /Save in progress/)
  await assert.rejects(postOpeningSession(async () => ({ ok: false, status: 400, json: async () => ({ error: 'Character not in campaign' }) }), '/session', { requestId: 'stable' }), /Character not in campaign/)
  const result = await postOpeningSession(async (_url, options) => ({ ok: true, status: 201, json: async () => ({ session: { id: 's1' } }), options }), '/session', { requestId: 'stable' })
  assert.equal(result.session.id, 's1')
})

test('Launch Campaign component renders its accessible configuration workflow', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, resolve } = await import('node:path')
  const { createRequire, Module } = await import('node:module')
  const require = createRequire(import.meta.url)
  const ts = require('typescript')
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const filename = resolve(dirname(new URL(import.meta.url).pathname), 'LaunchCampaign.tsx')
  const source = await readFile(filename, 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const priorCssHandler = Module._extensions['.css']
  const priorTsxHandler = Module._extensions['.tsx']
  Module._extensions['.css'] = (module) => { module.exports = {} }
  Module._extensions['.tsx'] = (module, file) => {
    const tsx = require('typescript')
    const tsxSource = require('node:fs').readFileSync(file, 'utf8')
    const output = tsx.transpileModule(tsxSource, { compilerOptions: { jsx: tsx.JsxEmit.ReactJSX, module: tsx.ModuleKind.CommonJS, target: tsx.ScriptTarget.ES2022 } }).outputText
    module._compile(output, file)
  }
  try {
    const componentModule = new Module(filename)
    componentModule.filename = filename
    componentModule.paths = Module._nodeModulePaths(dirname(filename))
    componentModule._compile(compiled.outputText, filename)
    const Component = componentModule.exports.default
    const markup = renderToStaticMarkup(React.createElement(Component, { onManualCampaign() {}, onCampaignSaved() {}, onEnterAdventure() {} }))
    assert.match(markup, /Launch Campaign/)
    assert.match(markup, /AI Dungeon Master/)
    assert.match(markup, /Human DM with AI assistance/)
    assert.match(markup, /aria-label="Launch campaign steps"/)
    assert.match(markup, /Generate world preview/)
    assert.match(markup, /Create manually/)
  } finally {
    if (priorCssHandler) Module._extensions['.css'] = priorCssHandler
    else delete Module._extensions['.css']
    if (priorTsxHandler) Module._extensions['.tsx'] = priorTsxHandler
    else delete Module._extensions['.tsx']
  }
})

test('saved preview component renders the campaign world and keeps save behind explicit action', async () => {
  const { readFile } = await import('node:fs/promises')
  const { dirname, resolve } = await import('node:path')
  const { createRequire, Module } = await import('node:module')
  const require = createRequire(import.meta.url)
  const ts = require('typescript')
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const filename = resolve(dirname(new URL(import.meta.url).pathname), 'LaunchWorldPreview.tsx')
  const compiled = ts.transpileModule(await readFile(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const componentModule = new Module(filename)
  componentModule.filename = filename
  componentModule.paths = Module._nodeModulePaths(dirname(filename))
  componentModule._compile(compiled.outputText, filename)
  const Component = componentModule.exports.default
  const preview = {
    campaign: { title: 'The Ashen Bell', premise: 'A long premise establishes the curse and its danger for this adventure.', setting: 'A rainbound valley where old bells call the dead.' },
    locations: [
      { key: 'old_gate', name: 'Old Gate', kind: 'Village', description: 'The starting village holds its shutters against the storm.', isStartingLocation: true },
      { key: 'sunken_road', name: 'Sunken Road', kind: 'Road', description: 'A flooded road winds through abandoned fields.', isStartingLocation: false },
    ],
    npcs: [{ key: 'mara', name: 'Mara Venn', role: 'Village bell keeper', personality: 'Careful and weary after many sleepless nights.', motivation: 'Wants to find the missing bell clapper.' }],
    mainQuest: { title: 'Silence the Bell', description: 'Discover why the bell rings without a keeper.', objectives: [{ key: 'trace', description: 'Trace the sound to its source.' }] },
    mysteryOrThreat: 'A voice in the bell tower repeats the names of the missing.',
    openingScene: { title: 'A Bell at Midnight', description: 'The bell rings while its tower door is sealed from within.' },
    possibleResolution: 'The source may be quieted, bargained with, or allowed to speak.',
  }
  const markup = renderToStaticMarkup(React.createElement(Component, { preview, saved: false, previewToken: 'transient', saving: false, onSave() {} }))
  assert.match(markup, /The Ashen Bell/)
  assert.match(markup, /Old Gate/)
  assert.match(markup, /STARTING LOCATION/)
  assert.match(markup, /Mara Venn/)
  assert.match(markup, /Silence the Bell/)
  assert.match(markup, /A Bell at Midnight/)
  assert.match(markup, /Save campaign/)
  const savedMarkup = renderToStaticMarkup(React.createElement(Component, { preview, saved: true, previewToken: 'transient', saving: false, onSave() {} }))
  assert.match(savedMarkup, /Saved campaign/)
  assert.doesNotMatch(savedMarkup, /Save campaign/)
})
