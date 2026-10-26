'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const launcher = require('./realmforge.cjs')

test('path resolution keeps the existing database location by default', () => {
  const root = path.join('D:', 'Projects', 'RealmForge')
  assert.equal(launcher.resolveDataDir(root, {}), path.resolve(root, 'server', 'data'))
  assert.equal(launcher.resolveDataDir(root, { REALMFORGE_DATA_DIR: 'D:\\RealmForgeData' }), path.resolve('D:\\RealmForgeData'))
})

test('runtime state is per-user and paths are grouped under the runtime directory', () => {
  const runtime = launcher.defaultRuntimeDir({ LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local' })
  const paths = launcher.pathsFor('D:\\Projects\\RealmForge', runtime)
  assert.match(paths.runtime, /RealmForge[\\/]launcher$/i)
  assert.equal(path.dirname(paths.owner), paths.lock)
  assert.equal(path.dirname(paths.log), paths.runtime)
})

test('netstat parsing identifies listening port conflicts without killing anything', () => {
  const output = '  TCP    127.0.0.1:3001    0.0.0.0:0    LISTENING    4242\r\n'
  assert.deepEqual(launcher.parseNetstatOutput(output), [4242])
  assert.deepEqual(launcher.parseNetstatOutput('TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 4242'), [])
})

test('process ownership requires root, script, token, and worker command evidence', () => {
  const root = path.resolve('D:\\Projects\\RealmForge')
  const script = path.join(root, 'launcher', 'windows', 'realmforge.cjs')
  const owner = { pid: 42, token: 'token-123', root, script }
  const inspector = () => ({ alive: true, command: `node "${script}" worker "${root}" token-123` })
  assert.equal(launcher.ownsProcess(owner, root, inspector), true)
  assert.equal(launcher.ownsProcess({ ...owner, token: 'wrong' }, root, inspector), false)
  assert.equal(launcher.ownsProcess(owner, path.resolve('D:\\Other'), inspector), false)
})

test('stale runtime state can be removed without touching the database', () => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-launcher-'))
  const paths = launcher.pathsFor('D:\\Projects\\RealmForge', runtime)
  fs.mkdirSync(paths.lock)
  fs.writeFileSync(paths.owner, '{}')
  fs.writeFileSync(paths.token, 'stale')
  fs.writeFileSync(paths.ready, 'stale')
  launcher.removeState(paths)
  assert.equal(fs.existsSync(paths.lock), false)
  assert.equal(path.dirname(paths.log), runtime)
  assert.notEqual(paths.runtime, path.resolve('D:\\Projects\\RealmForge', 'server', 'data'))
  fs.rmSync(runtime, { recursive: true, force: true })
})

test('missing production artifacts produce a startup error before any process is launched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-no-build-'))
  assert.throws(() => launcher.validateArtifacts(root), /Production artifacts are missing/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('Ollama configuration stays local and supports the configured model', () => {
  assert.deepEqual(launcher.ollamaConfig({}), { baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1:8b' })
  assert.deepEqual(launcher.ollamaConfig({ OLLAMA_BASE_URL: 'http://example.invalid:11434', OLLAMA_MODEL: 'custom:model' }), { baseUrl: 'http://127.0.0.1:11434', model: 'custom:model' })
})

test('PowerShell button commands are stored on the sender for deferred event handlers', () => {
  const script = fs.readFileSync(path.join(__dirname, 'RealmForge.ps1'), 'utf8')
  assert.match(script, /\$button\.Tag = \$command/)
  assert.match(script, /Invoke-Launcher \(\[string\]\$sender\.Tag\)/)
  assert.doesNotMatch(script, /Invoke-Launcher \$command/)
})
