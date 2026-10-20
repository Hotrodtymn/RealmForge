const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

test('condition durations, recovery saves, Exhaustion, and condition history persist and advance only on turn transitions', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-conditions-'))
  const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)) }) })
  const base = `http://127.0.0.1:${port}/api`
  let server
  t.after(async () => { await stop(); fs.rmSync(dataDir, { recursive: true, force: true }) })
  function start() { server = spawn(process.execPath, [path.join(__dirname, '../node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), REALMFORGE_DATA_DIR: dataDir }, stdio: 'ignore' }) }
  async function stop() { if (!server || server.exitCode !== null) return; const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; server = undefined }
  async function wait() { for (let i=0;i<80;i+=1) { if(server.exitCode!==null) throw new Error(`Server exited ${server.exitCode}`); try { if((await fetch(`${base}/health`)).ok)return } catch{} await delay(100) } throw new Error('Server did not become ready') }
  async function req(route, method='GET', body) { const response=await fetch(`${base}${route}`,{method,headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()} }
  const campaign=(await (async()=>{start();await wait();return req('/campaigns','POST',{name:'Condition tests',description:'',setting:''})})()).body.campaign
  const player=(await req(`/campaigns/${campaign.id}/players`,'POST',{displayName:'Test player'})).body.player
  const created=(await req(`/campaigns/${campaign.id}/players/${player.playerId}/characters`,'POST',{name:'Astra',species:'Elf',class:'Wizard',abilityScores:{str:10,dex:12,con:10,int:10,wis:30,cha:10}})).body.character
  await req(`/campaigns/${campaign.id}/players/${player.playerId}/characters/${created.id}/sheet`,'PUT',{level:5,abilityScores:{str:10,dex:12,con:10,int:10,wis:30,cha:10},savingThrowProficiencies:['wis'],skillProficiencies:[],weaponProficiencies:[],manualAcOverride:null})
  const root=`/campaigns/${campaign.id}/encounters`
  const encounter=(await req(root,'POST',{name:'Dusk Vault'})).body.encounter
  const url=`${root}/${encounter.id}`
  const combatant=(await req(`${url}/combatants/players`,'POST',{characterId:created.id})).body.combatants[0]
  const enemy=(await req(`${url}/combatants/enemies`,'POST',{name:'Sentinel',initiativeModifier:0,attackModifier:0})).body.combatants[1]
  await req(`${url}/combatants/${combatant.id}/initiative`,'PUT',{source:'manual',total:20})
  await req(`${url}/combatants/${enemy.id}/initiative`,'PUT',{source:'manual',total:10})
  assert.equal((await req(`${url}/next-turn`,'POST')).status,400,'turn advance requires a stable idempotency key')
  assert.equal((await req(`${url}/start`,'POST')).status,200)

  assert.equal((await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'poisoned',duration:{type:'fixed_rounds',combatantId:enemy.id,timing:'end',rounds:0}})).status,400)
  assert.equal((await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'exhaustion',level:7})).status,400)
  assert.equal((await req(`${url}/combatants/${enemy.id}/conditions`,'POST',{condition:'blinded',duration:{type:'recovery_save',recovery:{ability:'cha',dc:12,timing:'start',saveModifier:31}}})).status,400)

  await req(`${url}/combatants/${enemy.id}/conditions`,'POST',{condition:'stunned',duration:{type:'recovery_save',recovery:{ability:'str',dc:12,timing:'start'}}})
  await req(`${url}/next-turn`,'POST',{actionId:crypto.randomUUID()})
  const npcSave=(await req(`${url}/condition-history`)).body.events.find(x=>x.condition==='stunned'&&x.eventType==='recovery_save_attempted')
  assert.equal(JSON.parse(npcSave.rollDetails).adjudicationRequired,true)
  assert.equal('naturalRoll' in JSON.parse(npcSave.rollDetails),false,'NPC with unknown modifier is never rolled with a fabricated bonus')
  const adjudicationId=crypto.randomUUID()
  assert.equal((await req(`${url}/combatants/${enemy.id}/conditions/stunned/recovery`,'POST',{success:true,reason:'DM adjudicated the save',actionId:adjudicationId})).status,200)
  assert.equal((await req(`${url}/combatants/${enemy.id}/conditions/stunned/recovery`,'POST',{success:true,reason:'DM adjudicated the save',actionId:adjudicationId})).status,200,'retry returns success without adding another adjudication')

  assert.equal((await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'poisoned',duration:{type:'turn_boundary',combatantId:'foreign',timing:'end'}})).status,400)
  const applied=await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'poisoned',duration:{type:'turn_boundary',combatantId:enemy.id,timing:'end'}})
  assert.equal(applied.status,200)
  const expireTransition=crypto.randomUUID()
  const expired=await req(`${url}/next-turn`,'POST',{actionId:expireTransition})
  assert.equal(expired.body.combatants.find(x=>x.id===combatant.id).conditions.length,0)
  const retry=await req(`${url}/next-turn`,'POST',{actionId:expireTransition})
  assert.equal(retry.body.encounter.activeCombatantId,expired.body.encounter.activeCombatantId)
  assert.equal((await req(`${url}/condition-history`)).body.events.filter(x=>x.eventType==='expired'&&x.condition==='poisoned').length,1)

  await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'blinded',duration:{type:'fixed_rounds',combatantId:enemy.id,timing:'end',rounds:1}})
  await req(`${url}/next-turn`,'POST',{actionId:crypto.randomUUID()})
  const fixedEnd=await req(`${url}/next-turn`,'POST',{actionId:crypto.randomUUID()})
  assert.ok(!fixedEnd.body.combatants.find(x=>x.id===combatant.id).conditions.some(x=>x.condition==='blinded'))
  await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'prone',duration:{type:'turn_boundary',combatantId:enemy.id,timing:'start'}})
  const startBoundary=await req(`${url}/next-turn`,'POST',{actionId:crypto.randomUUID()})
  assert.ok(!startBoundary.body.combatants.find(x=>x.id===combatant.id).conditions.some(x=>x.condition==='prone'))

  await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'exhaustion',level:2})
  const economy=await req(`${url}/action-economy`)
  assert.equal(economy.body.states.find(x=>x.combatantId===combatant.id).effectiveSpeed,20)
  assert.equal((await req(`/campaigns/${campaign.id}/characters/${created.id}/exhaustion`)).body.effects[0].level,2)
  assert.equal((await req(`${url}/combatants/${combatant.id}/exhaustion`,'PUT',{level:1,reason:''})).status,400)
  const exhaustedInitiative=await req(`${url}/combatants/${combatant.id}/initiative`,'PUT',{source:'rolled',roll:15})
  const exhaustedPlayer=exhaustedInitiative.body.combatants.find(x=>x.id===combatant.id)
  assert.equal(exhaustedPlayer.initiativeExhaustionPenalty,-4)
  assert.equal(exhaustedPlayer.initiativeTotal,12,'initiative D20 Test includes Exhaustion once')
  await req(`${url}/combatants/${enemy.id}/conditions`,'POST',{condition:'exhaustion',level:2})
  const exhaustionAttack=await req(`${url}/attacks`,'POST',{attackerId:enemy.id,targetId:combatant.id,mode:'normal',situationalModifier:0})
  assert.equal(exhaustionAttack.status,201)
  assert.equal(exhaustionAttack.body.attack.attackBonus,-4,'Exhaustion penalty applies once to enemy D20 attack bonus')

  const abilities=['str','dex','con','int','wis','cha']
  const saveConditions=['poisoned','blinded','frightened','deafened','invisible','charmed']
  for (let i=0;i<abilities.length;i+=1) await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:saveConditions[i],duration:{type:'recovery_save',recovery:{ability:abilities[i],dc:40,timing:'end'}}})
  await req(`${url}/next-turn`,'POST',{actionId:crypto.randomUUID()})
  const recoveryTurn=await req(`${url}/next-turn`,'POST',{actionId:crypto.randomUUID()})
  assert.equal(recoveryTurn.body.combatants.find(x=>x.id===combatant.id).conditions.filter(x=>saveConditions.includes(x.condition)).length,6)
  const history=await req(`${url}/condition-history`)
  const failed=history.body.events.filter(x=>x.eventType==='recovery_save_failed'&&saveConditions.includes(x.condition))
  assert.equal(failed.length,6)
  const rolledAbilities=failed.map(x=>JSON.parse(x.rollDetails).ability).sort()
  assert.deepEqual(rolledAbilities,abilities.slice().sort())
  for (const event of failed) {
    const roll=JSON.parse(event.rollDetails)
    assert.equal(roll.exhaustionPenalty,-4)
    assert.equal(roll.final,roll.naturalRoll+roll.modifier+roll.exhaustionPenalty)
    assert.ok(roll.naturalRoll>=1&&roll.naturalRoll<=20)
  }
  const proficientWisdomSave=failed.map(x=>JSON.parse(x.rollDetails)).find(x=>x.ability==='wis')
  assert.equal(proficientWisdomSave.modifier,13,'recovery save uses the saved ability and proficiency bonus')

  await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'restrained',duration:{type:'recovery_save',recovery:{ability:'wis',dc:1,timing:'end'}}})
  await req(`${url}/next-turn`,'POST',{actionId:crypto.randomUUID()})
  const recovered=await req(`${url}/next-turn`,'POST',{actionId:crypto.randomUUID()})
  assert.ok(!recovered.body.combatants.find(x=>x.id===combatant.id).conditions.some(x=>x.condition==='restrained'))
  const charmed=await req(`${url}/combatants/${combatant.id}/conditions`,'POST',{condition:'petrified',sourceCombatantId:enemy.id,duration:{type:'fixed_rounds',combatantId:enemy.id,timing:'end',rounds:3}})
  assert.equal(charmed.status,200,JSON.stringify(charmed.body))
  assert.equal(charmed.body.combatants.find(x=>x.id===combatant.id).conditions.find(x=>x.condition==='petrified').remainingRounds,3)
  await req(`${url}/reset`,'POST')
  assert.equal((await req(`${url}`)).body.combatants.find(x=>x.id===combatant.id).conditions.find(x=>x.condition==='petrified').remainingRounds,3,'reset does not advance a configured duration')
  await stop(); start(); await wait()
  const persisted=await req(`${url}/condition-history`)
  assert.equal((await req(`${url}`)).body.encounter.round,0,'loading after reset and restart does not advance turn-based durations')
  assert.equal((await req(`${url}`)).body.combatants.find(x=>x.id===combatant.id).conditions.find(x=>x.condition==='petrified').remainingRounds,3,'active duration configuration survives backend restart')
  assert.ok(persisted.body.events.some(x=>x.eventType==='recovery_save_succeeded'&&x.condition==='restrained'))
  assert.ok(persisted.body.events.some(x=>x.eventType==='exhaustion_increased'))

  const fatal=await req(`${url}/combatants/${combatant.id}/exhaustion`,'PUT',{level:6,reason:'Test fatal Exhaustion rule'})
  assert.equal(fatal.status,200)
  assert.equal(fatal.body.combatants.find(x=>x.id===combatant.id).survivalStatus,'dead')
  assert.equal((await req(`${url}/action-economy`)).body.states.find(x=>x.combatantId===combatant.id).actionRestricted,true)
  assert.equal((await req(`${url}/attacks`,'POST',{attackerId:combatant.id,targetId:enemy.id,mode:'normal',situationalModifier:0})).status,409,'level 6 death blocks ordinary attacks')
  const again=await req(`${url}/combatants/${combatant.id}/exhaustion`,'PUT',{level:4,reason:'Test reduction after fatal level'})
  assert.equal(again.body.combatants.find(x=>x.id===combatant.id).survivalStatus,'dead','reducing Exhaustion does not revive a dead combatant')
  const finalEvents=(await req(`${url}/condition-history`)).body.events
  assert.ok(finalEvents.some(x=>x.eventType==='dm_override'&&x.condition==='exhaustion'))
  assert.ok(finalEvents.some(x=>x.eventType==='exhaustion_decreased'&&x.condition==='exhaustion'))
})
