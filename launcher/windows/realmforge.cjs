'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

const PORT = 3001
const HOST = '127.0.0.1'
const SCRIPT = fs.realpathSync(__filename)
const mode = process.argv[2] || 'help'

function pathsFor(root, runtime) {
  const resolvedRoot = path.resolve(root)
  const resolvedRuntime = path.resolve(runtime)
  return {
    root: resolvedRoot,
    runtime: resolvedRuntime,
    lock: path.join(resolvedRuntime, 'active'),
    owner: path.join(resolvedRuntime, 'active', 'owner.json'),
    token: path.join(resolvedRuntime, 'active', 'token'),
    ready: path.join(resolvedRuntime, 'active', 'ready'),
    error: path.join(resolvedRuntime, 'last-error'),
    log: path.join(resolvedRuntime, 'launcher.log'),
  }
}

function defaultRuntimeDir(env = process.env) {
  const base = env.LOCALAPPDATA || env.APPDATA || os.homedir()
  return path.join(base, 'RealmForge', 'launcher')
}

function resolveDataDir(root, env = process.env) {
  return path.resolve(env.REALMFORGE_DATA_DIR || path.join(root, 'server', 'data'))
}

function readOwner(paths) {
  try { return JSON.parse(fs.readFileSync(paths.owner, 'utf8')) } catch { return null }
}

function samePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function parseNetstatOutput(output, port = PORT) {
  const matches = []
  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/LISTENING\s+(\d+)\s*$/i)
    if (!match || !line.includes(`:${port}`)) continue
    matches.push(Number(match[1]))
  }
  return matches
}

function processCommand(pid) {
  try {
    if (process.platform === 'win32') {
      const filter = `ProcessId = ${Number(pid)}`
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter \"${filter}\").CommandLine`], { encoding: 'utf8', windowsHide: true }).trim()
    }
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
  } catch { return '' }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function ownsProcess(owner, root, inspector = (pid) => ({ alive: processAlive(pid), command: processCommand(pid) })) {
  if (!owner || !Number.isInteger(owner.pid) || typeof owner.token !== 'string' || !owner.token) return false
  if (owner.root && !samePath(owner.root, root)) return false
  const ownerScript = path.resolve(owner.script || path.join(root, 'launcher', 'windows', 'realmforge.cjs'))
  const relative = path.relative(path.resolve(root), ownerScript)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false
  const info = inspector(owner.pid)
  if (!info.alive) return false
  const command = String(info.command || '')
  return samePath(owner.root || root, root) && command.toLowerCase().includes(ownerScript.toLowerCase()) && command.toLowerCase().includes(String(root).toLowerCase()) && command.includes(owner.token) && command.toLowerCase().includes('worker')
}

function removeState(paths) {
  for (const file of [paths.owner, paths.token, paths.ready]) {
    try { fs.unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  try { fs.rmdirSync(paths.lock) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

function portIsOccupied() {
  if (process.platform === 'win32') {
    try { if (parseNetstatOutput(execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })).length) return Promise.resolve(true) } catch {}
  }
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: PORT })
    socket.setTimeout(500)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

async function isHealthy() {
  try {
    const response = await fetch(`http://${HOST}:${PORT}/api/health`, { signal: AbortSignal.timeout(1000) })
    const data = await response.json()
    return response.ok && data.status === 'ok'
  } catch { return false }
}

function ollamaConfig(env = process.env) {
  let baseUrl = 'http://127.0.0.1:11434'
  try {
    const candidate = new URL(env.OLLAMA_BASE_URL || baseUrl)
    const localHost = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(candidate.hostname.toLowerCase())
    if (candidate.protocol === 'http:' && localHost && !candidate.username && !candidate.password && !candidate.search && !candidate.hash) baseUrl = candidate.toString().replace(/\/$/, '')
  } catch {}
  const model = env.OLLAMA_MODEL || 'llama3.1:8b'
  return { baseUrl, model }
}

async function ollamaStatus(env = process.env) {
  const config = ollamaConfig(env)
  try {
    const response = await fetch(`${config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return { online: false, model: config.model, modelAvailable: false, error: `Ollama returned HTTP ${response.status}.` }
    const payload = await response.json()
    const modelAvailable = Array.isArray(payload.models) && payload.models.some((entry) => entry && entry.name === config.model)
    return { online: true, model: config.model, modelAvailable, ...(modelAvailable ? {} : { error: `The configured model ${config.model} is not installed in Ollama.` }) }
  } catch { return { online: false, model: config.model, modelAvailable: false, error: 'Ollama is unavailable. Non-AI features remain available.' } }
}

async function waitUntilReady(paths, pid, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await isHealthy()) return
    try { const message = fs.readFileSync(paths.error, 'utf8').trim(); if (message) throw new Error(message) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!processAlive(pid)) throw new Error(`RealmForge stopped during startup. See ${paths.log} for details.`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`RealmForge did not become ready within ${timeoutMs / 1000} seconds. See ${paths.log} for details.`)
}

function openBrowser() {
  if (process.env.REALMFORGE_NO_OPEN === '1') return
  if (process.platform === 'win32') {
    const opener = spawn('cmd.exe', ['/c', 'start', '', `http://${HOST}:${PORT}`], { detached: true, stdio: 'ignore', windowsHide: true })
    opener.unref()
  }
}

function validateArtifacts(root) {
  const clientIndex = path.join(root, 'client', 'dist', 'index.html')
  const serverEntry = path.join(root, 'server', 'dist', 'index.js')
  if (!fs.existsSync(clientIndex) || !fs.existsSync(serverEntry)) {
    throw new Error(`Production artifacts are missing. Expected ${clientIndex} and ${serverEntry}. Build the client and server before starting RealmForge.`)
  }
  return { clientIndex, serverEntry }
}

function terminateProcess(pid) {
  try { process.kill(pid, 'SIGTERM') } catch {}
}

function forceTerminateTree(pid) {
  if (process.platform !== 'win32') return
  try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch {}
}

async function start(root, runtime) {
  const paths = pathsFor(root, runtime)
  const artifacts = validateArtifacts(paths.root)
  fs.mkdirSync(paths.runtime, { recursive: true })
  try { fs.mkdirSync(paths.lock) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const owner = readOwner(paths)
    if (ownsProcess(owner, paths.root)) { await waitUntilReady(paths, owner.pid); openBrowser(); process.stdout.write('RealmForge is already running.\n'); return }
    removeState(paths)
  }
  if (await portIsOccupied()) { removeState(paths); throw new Error(`Port ${PORT} is already in use. RealmForge did not stop or replace that process.`) }
  const token = crypto.randomUUID()
  fs.writeFileSync(paths.token, token)
  try { fs.unlinkSync(paths.error) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const worker = spawn(process.execPath, [SCRIPT, 'worker', paths.root, paths.runtime, token], { cwd: paths.root, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env } })
  worker.unref()
  fs.writeFileSync(paths.owner, JSON.stringify({ pid: worker.pid, token, root: paths.root, script: SCRIPT }))
  try { await waitUntilReady(paths, worker.pid); openBrowser(); const ai = await ollamaStatus(process.env); process.stdout.write(`RealmForge is ready at http://${HOST}:${PORT}. Ollama: ${ai.online ? (ai.modelAvailable ? 'ready' : ai.error) : ai.error}\n`) } catch (error) {
    const owner = readOwner(paths); if (ownsProcess(owner, paths.root)) { terminateProcess(owner.pid); forceTerminateTree(owner.pid) }; throw error
  }
}

async function stop(root, runtime) {
  const paths = pathsFor(root, runtime)
  const owner = readOwner(paths)
  if (!ownsProcess(owner, paths.root)) { if (owner) removeState(paths); process.stdout.write('RealmForge launcher has no verified running service to stop.\n'); return }
  terminateProcess(owner.pid)
  forceTerminateTree(owner.pid)
  const end = Date.now() + 15000
  while (Date.now() < end) { if (!ownsProcess(owner, paths.root)) { removeState(paths); process.stdout.write('RealmForge stopped.\n'); return } await new Promise((resolve) => setTimeout(resolve, 200)) }
  throw new Error(`RealmForge did not stop cleanly. Review ${paths.log}.`)
}

async function status(root, runtime) {
  const paths = pathsFor(root, runtime)
  const owner = readOwner(paths)
  const healthy = await isHealthy()
  const ai = healthy ? await ollamaStatus(process.env) : null
  if (ownsProcess(owner, paths.root) && healthy) process.stdout.write(`RealmForge is running at http://${HOST}:${PORT}. Ollama: ${ai.online ? (ai.modelAvailable ? 'ready' : ai.error) : ai.error}\n`)
  else if (healthy) process.stdout.write(`Port ${PORT} responds, but it is not owned by this launcher.\n`)
  else if (await portIsOccupied()) process.stdout.write(`Port ${PORT} is occupied, but this launcher cannot verify the service.\n`)
  else process.stdout.write('RealmForge is not running.\n')
}

function diagnose(root, runtime) {
  const artifacts = validateArtifacts(path.resolve(root))
  const result = [`Launcher script: ${SCRIPT}`, `Project root: ${path.resolve(root)}`, `Runtime directory: ${path.resolve(runtime)}`, `Node executable: ${process.execPath}`, `Node version: ${process.version}`, `Client artifact: ${artifacts.clientIndex}`, `Server artifact: ${artifacts.serverEntry}`, `Database directory: ${resolveDataDir(path.resolve(root))}`, `Port: ${PORT}`, 'Production artifacts are readable.']
  process.stdout.write(`${result.join('\n')}\n`)
}

async function worker(root, runtime, token) {
  const paths = pathsFor(root, runtime)
  if (fs.readFileSync(paths.token, 'utf8') !== token) process.exit(2)
  const logFd = fs.openSync(paths.log, 'a')
  let serverProcess
  let stopping = false
  const writeError = (message) => { try { fs.writeFileSync(paths.error, `${message}\n`) } catch {} }
  const cleanup = async (exitCode) => {
    if (stopping) return
    stopping = true
    if (serverProcess && serverProcess.exitCode === null) { terminateProcess(serverProcess.pid); await new Promise((resolve) => setTimeout(resolve, 1000)); if (serverProcess.exitCode === null) { try { serverProcess.kill() } catch {} } }
    try { removeState(paths) } catch {}
    fs.closeSync(logFd)
    process.exit(exitCode)
  }
  process.once('SIGTERM', () => { void cleanup(0) })
  process.once('SIGINT', () => { void cleanup(0) })
  try {
    const artifacts = validateArtifacts(paths.root)
    serverProcess = spawn(process.execPath, [artifacts.serverEntry], { cwd: paths.root, env: { ...process.env, PORT: String(PORT), REALMFORGE_HOST: HOST, REALMFORGE_CLIENT_DIST: path.join(paths.root, 'client', 'dist'), REALMFORGE_DATA_DIR: process.env.REALMFORGE_DATA_DIR || resolveDataDir(paths.root) }, stdio: ['ignore', logFd, logFd], windowsHide: true })
    serverProcess.once('error', (error) => { writeError(`Could not start the backend: ${error.message}. See ${paths.log}.`); void cleanup(1) })
    serverProcess.once('exit', (code, signal) => { if (!stopping) { writeError(`RealmForge backend exited (${signal || `exit ${code}`}). See ${paths.log}.`); void cleanup(1) } })
    await waitUntilReady(paths, process.pid)
    fs.writeFileSync(paths.ready, new Date().toISOString())
    try { fs.unlinkSync(paths.error) } catch {}
    await new Promise(() => {})
  } catch (error) { writeError(error instanceof Error ? error.message : String(error)); await cleanup(1) }
}

async function main() {
  const root = path.resolve(process.env.REALMFORGE_PROJECT_ROOT || process.argv[3] || path.join(__dirname, '..', '..'))
  const runtime = process.env.REALMFORGE_LAUNCHER_DIR || defaultRuntimeDir()
  if (mode === 'worker') return worker(process.argv[3], process.argv[4], process.argv[5])
  if (mode === 'diagnose') return diagnose(root, runtime)
  if (mode === 'start') return start(root, runtime)
  if (mode === 'stop') return stop(root, runtime)
  if (mode === 'status') return status(root, runtime)
  process.stdout.write('Usage: realmforge.cmd {diagnose|start|status|stop}\n')
}

if (require.main === module) main().catch((error) => { process.stderr.write(`RealmForge launcher error: ${error.message}\n`); process.exitCode = 1 })

module.exports = { PORT, HOST, pathsFor, defaultRuntimeDir, resolveDataDir, parseNetstatOutput, ownsProcess, removeState, ollamaConfig, validateArtifacts, forceTerminateTree }
