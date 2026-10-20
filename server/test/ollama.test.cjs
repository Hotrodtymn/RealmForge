require('tsx/cjs')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('memory extraction timeout defaults to 180 seconds, is bounded, and is independent from narration', () => {
  const readOllamaConfig = require('../src/ollamaConfig')
  const defaultConfig = readOllamaConfig({})
  assert.equal(readOllamaConfig({ OLLAMA_WORLD_TIMEOUT_MS: '300000' }).worldGenerationTimeoutMs, 300_000)
  assert.equal(defaultConfig.memoryExtractionTimeoutMs, 180_000)
  const independent = readOllamaConfig({ OLLAMA_NARRATION_TIMEOUT_MS: '60000', OLLAMA_MEMORY_EXTRACTION_TIMEOUT_MS: '210000' })
  assert.equal(independent.narrationTimeoutMs, 60_000)
  assert.equal(independent.memoryExtractionTimeoutMs, 210_000)
  assert.equal(readOllamaConfig({ OLLAMA_MEMORY_EXTRACTION_TIMEOUT_MS: 'invalid' }).memoryExtractionTimeoutMs, 180_000)
  assert.equal(readOllamaConfig({ OLLAMA_MEMORY_EXTRACTION_TIMEOUT_MS: '1' }).memoryExtractionTimeoutMs, 1_000)
  assert.equal(readOllamaConfig({ OLLAMA_MEMORY_EXTRACTION_TIMEOUT_MS: '999999' }).memoryExtractionTimeoutMs, 300_000)
  const { extractionLeaseMs } = require('../src/storyMemoryTiming')
  assert.ok(extractionLeaseMs(independent.memoryExtractionTimeoutMs, independent.timeoutMs) > independent.memoryExtractionTimeoutMs + independent.timeoutMs)
})

test('Ollama generation diagnostics report request duration and numeric server timing fields', async () => {
  const readOllamaConfig = require('../src/ollamaConfig')
  const { OllamaService } = require('../src/ollamaService')
  const config = readOllamaConfig({})
  const fetchMock = async (input) => input.toString().endsWith('/api/tags')
    ? new Response(JSON.stringify({ models: [{ name: config.model }] }), { status: 200 })
    : new Response(JSON.stringify({ response: '{}', done_reason: 'length', total_duration: 12_000_000, load_duration: 2_000_000, prompt_eval_duration: 3_000_000, eval_duration: 7_000_000, eval_count: 4 }), { status: 200 })
  const service = new OllamaService(config, fetchMock)
  const diagnostics = []
  const generated = await service.generate('safe test prompt', { onDiagnostic: (event) => diagnostics.push(event) })
  assert.deepEqual(generated, { model: config.model, response: '{}', truncated: false, responseCharCount: 2, doneReason: 'length', outputTokenCount: 4 })
  assert.deepEqual(diagnostics.map((event) => event.stage), ['health_check', 'generation'])
  assert.ok(diagnostics.every((event) => event.durationMs >= 0))
  assert.deepEqual(diagnostics[1].ollamaTimings, { total_duration: 12, load_duration: 2, prompt_eval_duration: 3, eval_duration: 7, eval_count: 4 })
  assert.deepEqual({ doneReason: diagnostics[1].doneReason, responseCharCount: diagnostics[1].responseCharCount, outputTokenCount: diagnostics[1].outputTokenCount, truncated: diagnostics[1].truncated }, { doneReason: 'length', responseCharCount: 2, outputTokenCount: 4, truncated: false })
})

test('local Ollama health and diagnostic generation use bounded, validated requests', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-ollama-'))
  let realmServer
  let ollamaServer
  let mode = 'normal'
  let generationBody
  const ports = await Promise.all([0, 0].map(() => new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
  })))
  const [serverPort, ollamaPort] = ports
  const api = `http://127.0.0.1:${serverPort}/api`

  ollamaServer = http.createServer((request, response) => {
    if (request.url === '/api/tags') {
      if (mode === 'unavailable') { response.writeHead(503).end(); return }
      if (mode === 'malformed-tags') { response.writeHead(200).end('{'); return }
      const models = mode === 'missing-model' ? [] : [{ name: 'llama3.1:8b' }]
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ models }))
      return
    }
    if (request.url === '/api/generate') {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', (part) => { raw += part })
      request.on('end', () => {
        generationBody = JSON.parse(raw)
        if (mode === 'slow') { setTimeout(() => response.writeHead(200).end(JSON.stringify({ response: 'late' })), 700); return }
        if (mode === 'malformed-generation') { response.writeHead(200).end('{'); return }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ response: 'x'.repeat(120), done_reason: 'stop', eval_count: 6 }))
      })
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve) => ollamaServer.listen(ollamaPort, '127.0.0.1', resolve))

  t.after(async () => {
    if (realmServer && realmServer.exitCode === null) { const exited = once(realmServer, 'exit'); realmServer.kill('SIGTERM'); await exited }
    if (ollamaServer) await new Promise((resolve) => ollamaServer.close(resolve))
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  realmServer = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(serverPort), REALMFORGE_HOST: '127.0.0.1', REALMFORGE_DATA_DIR: dataDir,
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollamaPort}`, OLLAMA_REQUEST_TIMEOUT_MS: '300', OLLAMA_MAX_RESPONSE_CHARS: '100' },
    stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (realmServer.exitCode !== null) throw new Error(`RealmForge server exited with ${realmServer.exitCode}`)
    try { if ((await fetch(`${api}/health`)).ok) break } catch {}
    await delay(100)
  }
  async function request(route, method = 'GET', body) {
    const result = await fetch(`${api}${route}`, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: result.status, body: await result.json() }
  }

  const health = await request('/ai/health')
  assert.equal(health.status, 200)
  assert.deepEqual(health.body, { connectionStatus: 'online', model: 'llama3.1:8b', modelAvailable: true })
  assert.equal((await request('/ai/test', 'POST', {})).status, 400)
  assert.equal((await request('/ai/test', 'POST', { prompt: 'x'.repeat(301) })).status, 400)
  assert.equal((await request('/ai/test', 'POST', { prompt: 'hello', model: 'other' })).status, 400)

  const generated = await request('/ai/test', 'POST', { prompt: '  Say hello.  ' })
  assert.equal(generated.status, 200)
  assert.deepEqual(generated.body, { model: 'llama3.1:8b', response: 'x'.repeat(100), truncated: true, responseCharCount: 120, doneReason: 'stop', outputTokenCount: 6 })
  assert.equal(generationBody.prompt, 'Say hello.')
  assert.equal(generationBody.stream, false)
  assert.equal(generationBody.model, 'llama3.1:8b')

  mode = 'missing-model'
  const missing = await request('/ai/health')
  assert.equal(missing.body.connectionStatus, 'online')
  assert.equal(missing.body.modelAvailable, false)
  assert.match(missing.body.error, /not installed/)
  assert.equal((await request('/ai/test', 'POST', { prompt: 'hello' })).status, 503)

  mode = 'unavailable'
  const offline = await request('/ai/health')
  assert.equal(offline.body.connectionStatus, 'offline')
  assert.equal(offline.body.modelAvailable, false)
  assert.ok(offline.body.error)

  mode = 'malformed-tags'
  const malformedHealth = await request('/ai/health')
  assert.equal(malformedHealth.body.connectionStatus, 'online')
  assert.equal(malformedHealth.body.modelAvailable, false)
  assert.match(malformedHealth.body.error, /invalid|unreadable/i)

  mode = 'normal'
  assert.equal((await request('/ai/test', 'POST', { prompt: 'hello' })).status, 200)
  mode = 'malformed-generation'
  assert.equal((await request('/ai/test', 'POST', { prompt: 'hello' })).status, 502)
  mode = 'slow'
  assert.equal((await request('/ai/test', 'POST', { prompt: 'hello' })).status, 504)
})
