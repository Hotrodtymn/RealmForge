const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('identity and private journal operations are not exposed through unauthenticated HTTP routes', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-private-routes-'))
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) })
  })
  let server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore',
  })
  const stop = async () => {
    if (!server || server.exitCode !== null) return
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
  }
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited with ${server.exitCode}`)
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break } } catch {}
    await delay(100)
  }
  assert.equal(ready, true, 'server should start with the new internal schema')
  const base = `http://127.0.0.1:${port}/api`
  const campaignResponse = await fetch(`${base}/campaigns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Private route test' }) })
  const campaign = (await campaignResponse.json()).campaign
  const playerResponse = await fetch(`${base}/campaigns/${campaign.id}/players`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Journal owner' }) })
  const player = (await playerResponse.json()).player
  const characterResponse = await fetch(`${base}/campaigns/${campaign.id}/players/${player.playerId}/characters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Private Hero', species: 'Human', class: 'Ranger', abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } }) })
  const characterBody = await characterResponse.json()
  assert.equal(characterResponse.status, 201, JSON.stringify(characterBody))
  const character = characterBody.character
  const scoped = `/api/campaigns/${campaign.id}/players/${player.playerId}/characters/${character.id}`
  for (const [route, method] of [
    ['/api/player-identities', 'GET'],
    [`/api/campaigns/${campaign.id}/log`, 'GET'],
    [`${scoped}/journal`, 'GET'],
    [`${scoped}/journal/entry-id/share`, 'POST'],
    [`${scoped}/journal/entry-id/promote`, 'POST'],
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method })
    assert.equal(response.status, 404, `${method} ${route} must remain unavailable without authentication`)
    const body = await response.json()
    assert.equal(body.error, 'Not found')
  }
  await stop()
  server = undefined
})
