#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn, spawnSync, execFileSync } = require('node:child_process')

const PORT = 3001
const HOST = '127.0.0.1'
const SCRIPT = fs.realpathSync(__filename)
const mode = process.argv[2] || 'help'

function pathsFor(root, runtime) {
  return {
    root: path.resolve(root),
    runtime: path.resolve(runtime),
    lock: path.join(path.resolve(runtime), 'active'),
    owner: path.join(path.resolve(runtime), 'active', 'owner.json'),
    token: path.join(path.resolve(runtime), 'active', 'token'),
    ready: path.join(path.resolve(runtime), 'active', 'ready'),
    error: path.join(path.resolve(runtime), 'last-error'),
    log: path.join(path.resolve(runtime), 'launcher.log'),
  }
}

function readOwner(paths) {
  try { return JSON.parse(fs.readFileSync(paths.owner, 'utf8')) } catch { return null }
}

function processCommand(pid) {
  try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim() } catch { return '' }
}

function ownsProcess(owner, root) {
  if (!owner || !Number.isInteger(owner.pid) || typeof owner.token !== 'string' || !owner.token) return false
  const projectRoot = path.resolve(root)
  if (owner.root && path.resolve(owner.root) !== projectRoot) return false
  const ownerScript = path.resolve(owner.script || path.join(projectRoot, 'launcher', 'macos', 'realmforge.cjs'))
  const scriptRelativeToRoot = path.relative(projectRoot, ownerScript)
  if (!scriptRelativeToRoot || scriptRelativeToRoot === '..' || scriptRelativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(scriptRelativeToRoot)) return false
  try { process.kill(owner.pid, 0) } catch { return false }
  const command = processCommand(owner.pid)
  return command.includes(ownerScript) && command.includes(projectRoot) && command.includes(owner.token) && command.includes('worker')
}

function removeOwnedLock(paths) {
  for (const file of [paths.owner, paths.token, paths.ready]) {
    try { fs.unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  try { fs.rmdirSync(paths.lock) } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not clear RealmForge launcher state at ${paths.lock}: ${error.message}`) }
}

async function isHealthy() {
  try {
    const response = await fetch(`http://${HOST}:${PORT}/api/health`, { signal: AbortSignal.timeout(1000) })
    if (!response.ok) return false
    const data = await response.json()
    return data.status === 'ok'
  } catch { return false }
}

function portIsOccupied() {
  try {
    const listeners = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (listeners.trim().split('\n').length > 1) return Promise.resolve(true)
  } catch (error) {
    if (error.status !== 1) {
      // Fall through to a direct socket probe when lsof is unavailable or restricted.
    } else return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: PORT })
    socket.setTimeout(500)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

async function waitUntilReady(paths, pid, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await isHealthy()) return
    try {
      const message = fs.readFileSync(paths.error, 'utf8').trim()
      if (message) throw new Error(message)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    try { process.kill(pid, 0) } catch { throw new Error(`RealmForge stopped during startup. See ${paths.log} for details.`) }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`RealmForge did not become ready within ${timeoutMs / 1000} seconds. See ${paths.log} for details.`)
}

function openBrowser() {
  if (process.env.REALMFORGE_NO_OPEN === '1') return
  const opener = spawn('/usr/bin/open', [`http://${HOST}:${PORT}`], { detached: true, stdio: 'ignore' })
  opener.unref()
}

async function start(root, runtime) {
  const paths = pathsFor(root, runtime)
  if (!fs.existsSync(path.join(paths.root, 'server', 'package.json')) || !fs.existsSync(path.join(paths.root, 'client', 'package.json'))) {
    throw new Error(`Could not find the RealmForge client and server under ${paths.root}. Rebuild RealmForge.app after relocating the project.`)
  }
  fs.mkdirSync(paths.runtime, { recursive: true })

  try {
    fs.mkdirSync(paths.lock)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const owner = readOwner(paths)
    if (ownsProcess(owner, paths.root)) {
      await waitUntilReady(paths, owner.pid)
      openBrowser()
      process.stdout.write('RealmForge is already running.\n')
      return
    }
    const previousError = (() => { try { return fs.readFileSync(paths.error, 'utf8').trim() } catch { return '' } })()
    removeOwnedLock(paths)
    if (previousError) throw new Error(previousError)
  }

  if (await portIsOccupied()) {
    removeOwnedLock(paths)
    throw new Error(`Port ${PORT} is already in use. RealmForge did not stop or replace that process. Close the existing server and try again.`)
  }

  const token = crypto.randomUUID()
  fs.writeFileSync(paths.token, token, { mode: 0o600 })
  try { fs.unlinkSync(paths.error) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const worker = spawn(process.execPath, [SCRIPT, 'worker', paths.root, paths.runtime, token], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  })
  worker.unref()
  fs.writeFileSync(paths.owner, JSON.stringify({ pid: worker.pid, token, root: paths.root, script: SCRIPT }), { mode: 0o600 })
  try {
    await waitUntilReady(paths, worker.pid)
    openBrowser()
    process.stdout.write(`RealmForge is ready at http://${HOST}:${PORT}\n`)
  } catch (error) {
    const owner = readOwner(paths)
    if (ownsProcess(owner, paths.root)) process.kill(owner.pid, 'SIGTERM')
    throw error
  }
}

async function stop(root, runtime) {
  const paths = pathsFor(root, runtime)
  const owner = readOwner(paths)
  if (!ownsProcess(owner, paths.root)) {
    if (owner) removeOwnedLock(paths)
    process.stdout.write('RealmForge launcher has no running services to stop.\n')
    return
  }
  process.kill(owner.pid, 'SIGTERM')
  const end = Date.now() + 15000
  while (Date.now() < end) {
    if (!ownsProcess(owner, paths.root)) {
      process.stdout.write('RealmForge stopped.\n')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (ownsProcess(owner, paths.root)) throw new Error(`RealmForge did not stop cleanly. Review ${paths.log}; no unrelated processes were signaled.`)
  process.stdout.write('RealmForge stopped.\n')
}

async function status(root, runtime) {
  const paths = pathsFor(root, runtime)
  const owner = readOwner(paths)
  if (ownsProcess(owner, paths.root) && await isHealthy()) process.stdout.write(`RealmForge is running at http://${HOST}:${PORT}.\n`)
  else if (await isHealthy()) process.stdout.write(`Port ${PORT} responds, but it is not owned by this launcher.\n`)
  else if (await portIsOccupied()) process.stdout.write(`Port ${PORT} is occupied, but this launcher cannot verify the service health.\n`)
  else process.stdout.write('RealmForge is not running.\n')
}

function diagnose(root) {
  const projectRoot = path.resolve(root)
  const required = ['client/package.json', 'server/package.json']
  for (const relativePath of required) {
    const absolutePath = path.join(projectRoot, relativePath)
    fs.accessSync(absolutePath, fs.constants.R_OK)
    JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
  }
  const nodePathProbe = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' })
  if (nodePathProbe.error || nodePathProbe.status !== 0) throw new Error(`The selected Node.js is not available to launcher subprocesses through PATH${nodePathProbe.error ? `: ${nodePathProbe.error.message}` : '.'}`)
  const npmPath = process.env.REALMFORGE_SELECTED_NPM || 'npm'
  const npmProbe = spawnSync(npmPath, ['--version'], { encoding: 'utf8', env: process.env })
  if (npmProbe.error || npmProbe.status !== 0) throw new Error(`npm could not run with the selected Node.js PATH${npmProbe.error ? `: ${npmProbe.error.message}` : '.'}`)
  const result = `Launcher script: ${SCRIPT}\nProject root: ${projectRoot}\nNode executable: ${process.execPath}\nNode version: ${process.version}\nSubprocess node: ${nodePathProbe.stdout.trim()}\nnpm executable: ${npmPath}\nnpm version: ${npmProbe.stdout.trim()}\nSubprocess PATH: ${process.env.PATH}\nClient and server files are readable.\n`
  if (process.env.REALMFORGE_DIAGNOSTIC_OUTPUT) {
    fs.writeFileSync(process.env.REALMFORGE_DIAGNOSTIC_OUTPUT, result, { mode: 0o600 })
  }
  process.stdout.write(result)
}

function runBuild(cwd, logFd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.REALMFORGE_SELECTED_NPM || 'npm', ['run', 'build'], {
      cwd,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, PATH: process.env.PATH },
    })
    activeBuild = child
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (activeBuild === child) activeBuild = null
      if (code === 0) resolve()
      else reject(new Error(`Build failed in ${cwd} (${signal || `exit ${code}`}). See ${workerPaths.log}.`))
    })
  })
}

let workerPaths
let serverProcess
let activeBuild
let stopping = false

async function worker(root, runtime, token) {
  workerPaths = pathsFor(root, runtime)
  const currentToken = (() => { try { return fs.readFileSync(workerPaths.token, 'utf8') } catch { return '' } })()
  if (!token || currentToken !== token) process.exit(2)
  const logFd = fs.openSync(workerPaths.log, 'a', 0o600)
  let ready = false
  const writeError = (message) => { try { fs.writeFileSync(workerPaths.error, `${message}\n`, { mode: 0o600 }) } catch {} }
  const stopOwned = async () => {
    if (stopping) return
    stopping = true
    if (activeBuild?.pid) {
      try { process.kill(-activeBuild.pid, 'SIGTERM') } catch {}
    }
    if (serverProcess?.pid && serverProcess.exitCode === null) {
      serverProcess.kill('SIGTERM')
      await Promise.race([new Promise((resolve) => serverProcess.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))])
      if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL')
    }
    try { fs.unlinkSync(workerPaths.owner) } catch {}
    try { fs.unlinkSync(workerPaths.token) } catch {}
    try { fs.unlinkSync(workerPaths.ready) } catch {}
    try { fs.rmdirSync(workerPaths.lock) } catch {}
    fs.closeSync(logFd)
    process.exit(ready ? 0 : 1)
  }
  process.once('SIGTERM', () => { void stopOwned() })
  process.once('SIGINT', () => { void stopOwned() })

  try {
    await runBuild(path.join(workerPaths.root, 'client'), logFd)
    await runBuild(path.join(workerPaths.root, 'server'), logFd)
    if (stopping) return
    if (await portIsOccupied()) throw new Error(`Port ${PORT} became occupied during startup. RealmForge left the existing process untouched.`)
    serverProcess = spawn(process.execPath, [path.join(workerPaths.root, 'server', 'dist', 'index.js')], {
      cwd: workerPaths.root,
      env: { ...process.env, PORT: String(PORT), REALMFORGE_HOST: HOST, REALMFORGE_CLIENT_DIST: path.join(workerPaths.root, 'client', 'dist') },
      stdio: ['ignore', logFd, logFd],
    })
    serverProcess.once('error', (error) => { writeError(`Could not start the backend: ${error.message}. See ${workerPaths.log}.`); void stopOwned() })
    serverProcess.once('exit', (code, signal) => {
      if (!stopping) {
        writeError(`RealmForge backend exited (${signal || `exit ${code}`}). See ${workerPaths.log}.`)
        void stopOwned()
      }
    })
    await waitUntilReady(workerPaths, process.pid, 30000)
    if (stopping) return
    ready = true
    fs.writeFileSync(workerPaths.ready, new Date().toISOString(), { mode: 0o600 })
    try { fs.unlinkSync(workerPaths.error) } catch {}
    process.stdout.write('RealmForge production server is ready.\n')
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error))
    await stopOwned()
  }
}

async function main() {
  if (mode === 'worker') return worker(process.argv[3], process.argv[4], process.argv[5])
  const root = path.resolve(process.argv[3] || path.join(__dirname, '..', '..'))
  const runtime = process.env.REALMFORGE_LAUNCHER_DIR || path.join(process.env.HOME || root, 'Library', 'Application Support', 'RealmForge', 'launcher')
  if (mode === 'diagnose') return diagnose(root)
  if (mode === 'start') return start(root, runtime)
  if (mode === 'stop') return stop(root, runtime)
  if (mode === 'status') return status(root, runtime)
  process.stdout.write('Usage: realmforge.sh {start|stop|status}\n')
}

main().catch((error) => {
  process.stderr.write(`RealmForge launcher error: ${error.message}\n`)
  process.exitCode = 1
})
