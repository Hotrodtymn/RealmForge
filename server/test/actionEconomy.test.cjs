const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')

test('action economy validates, tracks tactical actions, expires turn effects, and persists safely', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-actions-'))
  const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) }) })
  const base = `http://127.0.0.1:${port}/api`
  let server
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  function start() { server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore' }) }
  async function stop() { if (!server || server.exitCode !== null) return; const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; server = undefined }
  async function wait() { for (let i=0;i<80;i+=1) { if(server.exitCode!==null) throw new Error(`Server exited ${server.exitCode}`); try { if((await fetch(`${base}/health`)).ok)return } catch{} await delay(100) } throw new Error('Server did not become ready') }
  async function req(route, method='GET', body) { if(route.endsWith('/next-turn')&&method==='POST'&&body===undefined) body={actionId:require('node:crypto').randomUUID()}; const response=await fetch(`${base}${route}`,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()} }
  const actionId=()=>require('node:crypto').randomUUID()
  start(); await wait()
  const campaign=(await req('/campaigns','POST',{name:'Turn test',description:'',setting:''})).body.campaign
  const root=`/campaigns/${campaign.id}/encounters`
  const encounter=(await req(root,'POST',{name:'Ashen Yard'})).body
  const encounterId=encounter.encounter.id, encounterUrl=`${root}/${encounterId}`
  const a=(await req(`${encounterUrl}/combatants/enemies`,'POST',{name:'Warden',initiativeModifier:0})).body.combatants[0]
  const b=(await req(`${encounterUrl}/combatants/enemies`,'POST',{name:'Sentinel',initiativeModifier:0})).body.combatants[1]
  await req(`${encounterUrl}/combatants/${a.id}/initiative`,'PUT',{source:'manual',total:20})
  await req(`${encounterUrl}/combatants/${b.id}/initiative`,'PUT',{source:'manual',total:10})
  assert.equal((await req(`${encounterUrl}/action-economy`)).status,200)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'dash'})).status,409)
  const started=await req(`${encounterUrl}/start`,'POST');assert.equal(started.body.encounter.activeCombatantId,a.id)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'movement',distance:-1})).status,400)
  let snapshot=(await req(`${encounterUrl}/action-economy`)).body
  assert.equal(snapshot.states.find(x=>x.combatantId===a.id).actionUsed,false)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'movement_allowance',movementAllowance:40})).status,200)
  const dashId=actionId()
  snapshot=(await req(`${encounterUrl}/action-economy`,'POST',{actionId:dashId,combatantId:a.id,kind:'dash'})).body
  assert.equal(snapshot.states.find(x=>x.combatantId===a.id).dashBonusMovement,40)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:dashId,combatantId:a.id,kind:'dash'})).status,409)
  snapshot=(await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'movement',distance:75})).body
  assert.equal(snapshot.states.find(x=>x.combatantId===a.id).movementUsed,75)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'movement',distance:6})).status,409)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'dodge'})).status,409)

  await req(`${encounterUrl}/next-turn`,'POST')
  snapshot=(await req(`${encounterUrl}/action-economy`)).body
  assert.equal(snapshot.states.find(x=>x.combatantId===b.id).actionUsed,false)
  const otherEncounter=(await req(root,'POST',{name:'Other Field'})).body.encounter
  const foreignTarget=(await req(`${root}/${otherEncounter.id}/combatants/enemies`,'POST',{name:'Foreign Ally'})).body.combatants[0]
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:b.id,kind:'help',targetId:foreignTarget.id,helpUse:'attack',description:'Cross-encounter target'})).status,404)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:b.id,kind:'help',targetId:a.id,helpUse:'attack',description:'Distracts the foe'})).status,200)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:b.id,kind:'help',targetId:'foreign-id',helpUse:'attack',description:'Distracts'})).status,409)
  assert.equal((await req(`${encounterUrl}/next-turn`,'POST')).body.encounter.activeCombatantId,a.id)
  assert.equal((await req(`${encounterUrl}/action-economy`)).body.effects.length,1)
  const dodge=(await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'dodge'}))
  assert.equal(dodge.status,200)
  await req(`${encounterUrl}/next-turn`,'POST')
  snapshot=(await req(`${encounterUrl}/action-economy`)).body
  assert.equal(snapshot.states.find(x=>x.combatantId===a.id).dodgeActive,true)
  await req(`${encounterUrl}/next-turn`,'POST')
  snapshot=(await req(`${encounterUrl}/action-economy`)).body
  assert.equal(snapshot.states.find(x=>x.combatantId===a.id).dodgeActive,false)
  assert.equal(snapshot.effects.length,0)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'disengage'})).status,200)
  await req(`${encounterUrl}/next-turn`,'POST')
  assert.equal((await req(`${encounterUrl}/action-economy`)).body.states.find(x=>x.combatantId===a.id).disengageActive,false)
  await req(`${encounterUrl}/next-turn`,'POST')

  const ready=await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'ready',trigger:'The door opens',response:'Shoot the intruder'})
  assert.equal(ready.status,200)
  const effect=ready.body.effects.find(x=>x.kind==='ready')
  await req(`${encounterUrl}/next-turn`,'POST')
  snapshot=(await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:b.id,kind:'ready_resolve',effectId:effect.id})).body
  assert.equal(snapshot.states.find(x=>x.combatantId===a.id).reactionUsed,true)
  assert.equal(snapshot.effects.length,0)

  await req(`${encounterUrl}/next-turn`,'POST')
  const cancellable=(await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'ready',trigger:'A bell rings',response:'Close the gate'})).body.effects[0]
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'ready_cancel',effectId:cancellable.id})).body.effects.length,0)
  await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'reset'})
  assert.equal((await req(`${encounterUrl}/combatants/${a.id}/conditions`,'POST',{condition:'stunned'})).status,200)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'dash'})).status,409,'Stunned prevents ordinary action spending')
  snapshot=(await req(`${encounterUrl}/action-economy`)).body
  const stunnedState=snapshot.states.find(x=>x.combatantId===a.id)
  assert.equal(stunnedState.actionRestricted,true)
  assert.equal(stunnedState.effectiveSpeed,40,'2024 Stunned does not set Speed to zero')
  const override=await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'dash',dmOverride:true,overrideReason:'DM allows the stunned creature to act for this test'})
  assert.equal(override.status,200)
  assert(override.body.events.some(x=>x.kind==='dash'&&x.details.dmOverride===true))
  assert((await req(`${encounterUrl}/condition-history`)).body.events.some(x=>x.condition==='stunned'&&x.eventType==='dm_override'))
  await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'reset'})
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'ready',trigger:'A bell rings',response:'Raise the gate'})).status,409,'Stunned prevents Ready')
  const stunnedReady=await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'ready',trigger:'A bell rings',response:'Raise the gate',dmOverride:true,overrideReason:'DM permits a prepared response'})
  assert.equal(stunnedReady.status,200)
  await req(`${encounterUrl}/next-turn`,'POST')
  const readyEffect=stunnedReady.body.effects.find(x=>x.kind==='ready')
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:b.id,kind:'ready_resolve',effectId:readyEffect.id})).status,409,'Stunned owner cannot spend a Reaction to resolve Ready')
  const reactionOverride=await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:b.id,kind:'ready_resolve',effectId:readyEffect.id,dmOverride:true,overrideReason:'DM permits the reaction'})
  assert.equal(reactionOverride.status,200)
  assert.equal((await req(`${encounterUrl}/combatants/${b.id}/conditions`,'POST',{condition:'grappled',sourceCombatantId:a.id})).status,200)
  assert.equal((await req(`${encounterUrl}/action-economy`)).body.states.find(x=>x.combatantId===b.id).effectiveSpeed,0)
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:b.id,kind:'movement',distance:5})).status,409,'Grappled prevents ordinary movement')
  const moveOverride=await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:b.id,kind:'movement',distance:5,dmOverride:true,overrideReason:'DM permits a forced reposition'})
  assert.equal(moveOverride.status,200)
  assert(moveOverride.body.events.some(x=>x.kind==='movement'&&x.details.dmOverride===true&&x.details.overrideReason==='DM permits a forced reposition'))
  assert.equal((await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'resource_override',resource:'bonusAction',available:true})).status,409,'restoring an action while incapacitated needs an explicit override')
  const resourceOverride=await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'resource_override',resource:'bonusAction',available:true,dmOverride:true,overrideReason:'DM restores the resource'})
  assert.equal(resourceOverride.status,200)
  await req(`${encounterUrl}/action-economy`,'POST',{actionId:actionId(),combatantId:a.id,kind:'resource_override',resource:'bonusAction',available:false})
  await stop(); start(); await wait()
  snapshot=(await req(`${encounterUrl}/action-economy`)).body
  assert.equal(snapshot.states.find(x=>x.combatantId===a.id).bonusActionUsed,true)
  assert(snapshot.events.some(x=>x.kind==='manual_override'))
  assert(snapshot.events.some(x=>x.details.dmOverride===true&&x.details.overrideReason==='DM allows the stunned creature to act for this test'))
  assert(snapshot.events.some(x=>x.kind==='ready_resolved'&&x.details.overrideReason==='DM permits the reaction'))
  assert.equal((await req(`${encounterUrl}`)).body.combatants.find(x=>x.id===b.id).conditions[0].sourceCombatantId,a.id,'condition source persists across restart')
})
