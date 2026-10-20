require('tsx/cjs')
const {spawn}=require('node:child_process')
const {once}=require('node:events')
const http=require('node:http')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const net=require('node:net')
const {setTimeout:delay}=require('node:timers/promises')
const crypto=require('node:crypto')
const test=require('node:test')
const assert=require('node:assert/strict')
const uuid=()=>crypto.randomUUID()

test('persistent story memory validates evidence, scopes sessions, deduplicates, records lifecycle, recovers failures, and stays outside game mechanics',async(t)=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'realmforge-story-memory-'))
  let realmServer,serverError='',extractionMode='valid',nextNarration='Edda Vale says, "The bell rings beneath the causeway."',releaseHeldExtraction=null,heldExtractionStarted=null
  const prompts=[]
  const generationBodies=[]
  const ollamaServer=http.createServer((request,response)=>{
    if(request.url==='/api/tags'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({models:[{name:'llama3.1:8b'}]}));return}
    if(request.url==='/api/generate'){
      let body='';request.setEncoding('utf8');request.on('data',(chunk)=>{body+=chunk});request.on('end',()=>{
        const input=JSON.parse(body),prompt=input.prompt;prompts.push(prompt);generationBodies.push(input)
        if(prompt.includes('STORY MEMORY EXTRACTION')){
          if(extractionMode==='unavailable'){response.writeHead(503).end();return}
          if(extractionMode==='delay'){setTimeout(()=>{if(!response.destroyed)response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'{}'}))},1300);return}
          if(extractionMode==='tokenTruncated'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'{"memories":[',done_reason:'length',eval_count:768}));return}
          if(extractionMode==='characterTruncated'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'x'.repeat(6001),done_reason:'stop',eval_count:2}));return}
          if(extractionMode==='malformed'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'{not json',done_reason:'stop',eval_count:3}));return}
          if(extractionMode==='fenced'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'```json\n{"memories":[],"retractions":[]}\n```',done_reason:'stop',eval_count:20}));return}
          if(extractionMode==='extraText'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'Result: {"memories":[],"retractions":[]}',done_reason:'stop',eval_count:20}));return}
          if(extractionMode==='schemaMismatch'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'{"memories":[],"retractions":[],"unexpected":true}',done_reason:'stop',eval_count:20}));return}
          if(extractionMode==='missingField'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'{"memories":[]}',done_reason:'stop',eval_count:10}));return}
          if(extractionMode==='empty'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:'{"memories":[],"retractions":[]}',done_reason:'stop',eval_count:20}));return}
          if(extractionMode==='badEvidence'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:JSON.stringify({memories:[{category:'discovery',statement:'The hidden king lives below the lake.',verificationStatus:'observed',evidenceQuote:'invented model detail',relatedNpcId:null,relatedLocationId:null,relatedQuestId:null,supersedesMemoryId:null}],retractions:[]})}));return}
          if(extractionMode==='recoverScratch'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:JSON.stringify({memories:[{category:'discovery',statement:'Three shallow scratches are visible beneath the bell handle.',verificationStatus:'observed',evidenceQuote:'three shallow scratches beneath the handle',relatedNpcId:null,relatedLocationId:null,relatedQuestId:null,supersedesMemoryId:null}],retractions:[]})}));return}
          if(extractionMode==='recoverRain'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:JSON.stringify({memories:[{category:'environment',statement:'Rain eases while Edda watches the causeway.',verificationStatus:'observed',evidenceQuote:'The rain settles while Edda watches the causeway.',relatedNpcId:null,relatedLocationId:null,relatedQuestId:null,supersedesMemoryId:null}],retractions:[]})}));return}
          if(extractionMode==='badReference'){response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:JSON.stringify({memories:[{category:'npc_statement',statement:'Edda says the bell rings beneath the causeway.',verificationStatus:'npc_claim',evidenceQuote:'Edda Vale says, "The bell rings beneath the causeway."',relatedNpcId:uuid(),relatedLocationId:null,relatedQuestId:null,supersedesMemoryId:null}],retractions:[]})}));return}
          let memoryId=null
          if(extractionMode==='supersede'||extractionMode==='retract')memoryId=prompt.match(/"id":"([0-9a-f-]{36})","category":"npc_statement"/)?.[1]??null
          const evidence=nextNarration
          const candidate={category:'npc_statement',statement:extractionMode==='supersede'?'Edda later corrects her earlier account of the bell.':extractionMode==='conflict'?'Edda claims the bell rings from the ruined abbey.':'Edda says the bell rings beneath the causeway.',verificationStatus:'npc_claim',evidenceQuote:evidence,relatedNpcId:globalThis.storyTestNpcId,relatedLocationId:null,relatedQuestId:null,supersedesMemoryId:extractionMode==='supersede'?memoryId:null}
          const result={memories:extractionMode==='retract'?[]:[candidate],retractions:extractionMode==='retract'&&memoryId?[{memoryId,evidenceQuote:evidence}]:[]}
          if(extractionMode==='hold'){
            releaseHeldExtraction=()=>response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:JSON.stringify(result)}))
            heldExtractionStarted?.()
            return
          }
          response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:JSON.stringify(result)}));return
        }
        response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({response:nextNarration}))
      });return
    }
    response.writeHead(404).end()
  })
  const freePort=()=>new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port))})})
  const [serverPort,ollamaPort]=await Promise.all([freePort(),freePort()])
  await new Promise((resolve)=>ollamaServer.listen(ollamaPort,'127.0.0.1',resolve))
  const api=`http://127.0.0.1:${serverPort}/api`
  const serverEnv={...process.env,PORT:String(serverPort),REALMFORGE_HOST:'127.0.0.1',REALMFORGE_DATA_DIR:dataDir,OLLAMA_BASE_URL:`http://127.0.0.1:${ollamaPort}`,OLLAMA_NARRATION_TIMEOUT_MS:'3000',OLLAMA_MEMORY_EXTRACTION_TIMEOUT_MS:'1000',OLLAMA_NUM_PREDICT:'256'}
  async function startRealm(){serverError='';const child=spawn(process.execPath,[path.join(__dirname,'../node_modules/tsx/dist/cli.mjs'),'src/index.ts'],{cwd:path.join(__dirname,'..'),env:serverEnv,stdio:['ignore','ignore','pipe']});child.stderr.setEncoding('utf8');child.stderr.on('data',(chunk)=>{serverError+=chunk});for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(`Server exited: ${serverError}`);try{if((await fetch(`${api}/health`)).ok)return child}catch{}await delay(100)}child.kill('SIGTERM');throw new Error(`Server did not start: ${serverError}`)}
  async function stopRealm(child){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited}}
  async function request(route,method='GET',body){const response=await fetch(`${api}${route}`,{method,headers:body===undefined?undefined:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,body:await response.json()}}
  t.after(async()=>{await stopRealm(realmServer);await new Promise((resolve)=>ollamaServer.close(resolve));delete globalThis.storyTestNpcId;fs.rmSync(dataDir,{recursive:true,force:true})})
  realmServer=await startRealm()
  const campaign=(await request('/campaigns','POST',{name:'Morrowfen',description:'A rainbound valley.',setting:'Dark fantasy marshes.'})).body.campaign
  const player=(await request(`/campaigns/${campaign.id}/players`,'POST',{displayName:'Nia'})).body.player
  const character=(await request(`/campaigns/${campaign.id}/players/${player.playerId}/characters`,'POST',{name:'Nia Ashford',species:'Human',class:'Ranger',abilityScores:{str:10,dex:14,con:12,int:10,wis:15,cha:10}})).body.character
  const otherPlayer=(await request(`/campaigns/${campaign.id}/players`,'POST',{displayName:'Rook'})).body.player
  const otherCharacter=(await request(`/campaigns/${campaign.id}/players/${otherPlayer.playerId}/characters`,'POST',{name:'Rook Vale',species:'Elf',class:'Bard',abilityScores:{str:10,dex:14,con:12,int:10,wis:12,cha:15}})).body.character
  const adventure=(await request(`/campaigns/${campaign.id}/adventures`,'POST',{title:'The Drowned Bell',description:'A bell rings below the marsh.',status:'active',startingLocation:'Morrowfen Causeway'})).body.adventure
  const root=`/campaigns/${campaign.id}/adventures/${adventure.id}`
  const location=(await request(`${root}/locations`,'POST',{name:'Morrowfen Causeway',description:'A narrow road through reeds.',locationType:'Road'})).body.location
  const npc=(await request(`${root}/npcs`,'POST',{name:'Edda Vale',description:'A ferryman.',personality:'Wary.',disposition:'Cautious',currentLocationId:location.id,dmNotes:'PRIVATE: Edda is the hidden heir.'})).body.npc
  globalThis.storyTestNpcId=npc.id
  await request(`${root}/story/flags/secret_heir`,'PUT',{value:'Edda'})
  const firstSession=(await request(`${root}/sessions`,'POST',{requestId:uuid(),characterId:character.id,locationId:location.id,sceneTitle:'The First Toll',sceneDescription:'Rain falls over black water.'})).body.session
  const secondSession=(await request(`${root}/sessions`,'POST',{requestId:uuid(),characterId:otherCharacter.id,locationId:location.id,sceneTitle:'Another Beginning',sceneDescription:'A different story begins.'})).body.session
  const memoryRoute=`/ai/session/${firstSession.id}/memories?characterId=${character.id}`
  const otherMemoryRoute=`/ai/session/${secondSession.id}/memories?characterId=${otherCharacter.id}`
  const turnRoute='/ai/session/turn'
  assert.equal((await request(`/ai/session/${firstSession.id}/memories?characterId=${otherCharacter.id}`)).status,404)
  assert.equal((await request('/ai/session/not-a-session/memories?characterId='+character.id)).status,400)
  async function turn(session,char,action,narration,clientTurnId=uuid()){
    nextNarration=narration
    const result=await request(turnRoute,'POST',{sessionId:session.id,characterId:char.id,action,clientTurnId})
    assert.equal(result.status,201,JSON.stringify(result.body))
    return result.body.turn
  }
  async function waitFor(route,predicate){for(let i=0;i<100;i++){const result=await request(route);if(predicate(result.body))return result.body;await delay(30)}throw new Error('Timed out waiting for background story memory extraction.')}
  async function waitComplete(turnId){return waitFor(memoryRoute,(body)=>body.extractionIssues?.every((issue)=>issue.sourceTurnId!==turnId))}

  const beforeSession=(await request(`/campaigns/${campaign.id}/sessions/${firstSession.id}`)).body
  const beforeSheet=(await request(`/campaigns/${campaign.id}/players/${player.playerId}/characters/${character.id}/sheet`)).body
  const source='Edda Vale says, "The bell rings beneath the causeway."'
  let state
  extractionMode='valid'
  const firstTurn=await turn(firstSession,character,'I ask Edda why the bell is ringing.',source)
  let firstResult=await waitFor(memoryRoute,(body)=>body.memories?.length===1)
  assert.equal(firstResult.visibility,'dm_private')
  assert.equal(firstResult.memories[0].verificationStatus,'npc_claim')
  assert.equal(firstResult.memories[0].relatedNpcName,'Edda Vale')
  assert.equal(firstResult.memories[0].sourceTurnId,firstTurn.id)
  assert.equal(firstResult.memories[0].evidenceQuote,source)
  assert.equal((await request(otherMemoryRoute)).body.memories.length,0)
  const playerContext=await request(`/campaigns/${campaign.id}/sessions/${firstSession.id}/context`)
  assert.doesNotMatch(JSON.stringify(playerContext.body),/Edda says the bell rings beneath the causeway/)
  assert.doesNotMatch(prompts.find((prompt)=>prompt.includes('STORY MEMORY EXTRACTION')),/PRIVATE: Edda|secret_heir/)
  assert.ok(prompts.find((prompt)=>prompt.includes('STORY MEMORY EXTRACTION')).length<12_000)
  assert.equal(generationBodies[0].options.num_predict,256,'narration output budget remains configured independently')
  const firstExtractionRequest=generationBodies.find((request)=>request.prompt.includes('STORY MEMORY EXTRACTION'))
  assert.equal(firstExtractionRequest.options.num_predict,768)
  assert.equal(firstExtractionRequest.format.properties.memories.items.properties.statement.maxLength,500)
  assert.equal(firstExtractionRequest.format.properties.memories.items.properties.evidenceQuote.minLength,8)

  nextNarration=source
  await turn(firstSession,character,'I listen for the bell again.',nextNarration)
  await waitFor(memoryRoute,(body)=>body.memories?.[0]?.history?.some((event)=>event.eventType==='reinforced'))
  assert.match(prompts.filter((prompt)=>!prompt.includes('STORY MEMORY EXTRACTION')).at(-1),/Edda says the bell rings beneath the causeway/)
  assert.match(prompts.filter((prompt)=>!prompt.includes('STORY MEMORY EXTRACTION')).at(-1),/npc_claim/)
  assert.ok(prompts.filter((prompt)=>!prompt.includes('STORY MEMORY EXTRACTION')).at(-1).length<15_000)
  const retryComplete=await request(`/ai/session/${firstSession.id}/memories/${firstTurn.id}/retry?characterId=${character.id}`,'POST')
  assert.equal(retryComplete.status,200)
  assert.equal((await request(memoryRoute)).body.memories.length,1)

  extractionMode='delay';nextNarration=source
  const delayedTurn=await turn(firstSession,character,'I ask Edda to repeat her account.',source)
  const delayedFailure=await waitFor(memoryRoute,(body)=>body.extractionIssues?.some((issue)=>issue.sourceTurnId===delayedTurn.id&&issue.status==='failed'))
  assert.match(delayedFailure.extractionIssues.find((issue)=>issue.sourceTurnId===delayedTurn.id).diagnostic,/timeout/i)
  extractionMode='valid'
  const delayedRetry=await request(`/ai/session/${firstSession.id}/memories/${delayedTurn.id}/retry?characterId=${character.id}`,'POST')
  assert.equal(delayedRetry.status,200)
  assert.equal(delayedRetry.body.duplicates,1)
  assert.equal((await request(memoryRoute)).body.memories.length,1)

  extractionMode='tokenTruncated';nextNarration='Edda says, "The old road sinks beneath the marsh."'
  const truncatedTurn=await turn(firstSession,character,'I ask where the old road leads.',nextNarration)
  state=await waitFor(memoryRoute,(body)=>body.extractionIssues?.some((issue)=>issue.sourceTurnId===truncatedTurn.id&&issue.status==='failed'))
  assert.equal(state.extractionIssues.find((issue)=>issue.sourceTurnId===truncatedTurn.id).diagnostic,'Memory extraction output was truncated before completion.')
  assert.equal(state.memories.some((memory)=>memory.sourceTurnId===truncatedTurn.id),false)
  extractionMode='valid'
  const truncatedRetry=await request(`/ai/session/${firstSession.id}/memories/${truncatedTurn.id}/retry?characterId=${character.id}`,'POST')
  assert.equal(truncatedRetry.status,200)
  assert.equal(truncatedRetry.body.duplicates,1)
  assert.ok((await request(memoryRoute)).body.memories.some((memory)=>memory.history.some((event)=>event.sourceTurnId===truncatedTurn.id&&event.eventType==='reinforced')))

  extractionMode='characterTruncated';nextNarration='The bridge bell has a cracked iron clapper.'
  const characterTruncatedTurn=await turn(firstSession,character,'I inspect the bell.',nextNarration)
  state=await waitFor(memoryRoute,(body)=>body.extractionIssues?.some((issue)=>issue.sourceTurnId===characterTruncatedTurn.id&&issue.status==='failed'))
  assert.equal(state.extractionIssues.find((issue)=>issue.sourceTurnId===characterTruncatedTurn.id).diagnostic,'Memory extraction output was truncated before completion.')
  assert.equal(state.memories.some((memory)=>memory.sourceTurnId===characterTruncatedTurn.id),false)

  for(const [mode,action,narration,expected] of [
    ['schemaMismatch','I ask for a note about the bell.','The bell remains silent.','does not match the required schema'],
    ['missingField','I ask for another note about the bell.','The ferryman waits by the river.','does not match the required schema'],
    ['fenced','I ask for a fenced note about the bell.','Rain falls over the causeway.','malformed JSON'],
    ['extraText','I ask for a prefaced note about the bell.','The lantern gutters in the wind.','malformed JSON'],
  ]){
    extractionMode=mode;nextNarration=narration
    const invalidTurn=await turn(firstSession,character,action,narration)
    state=await waitFor(memoryRoute,(body)=>body.extractionIssues?.some((issue)=>issue.sourceTurnId===invalidTurn.id&&issue.status==='failed'))
    assert.match(state.extractionIssues.find((issue)=>issue.sourceTurnId===invalidTurn.id).diagnostic,new RegExp(expected))
    assert.equal(state.memories.some((memory)=>memory.sourceTurnId===invalidTurn.id),false)
  }

  extractionMode='empty';nextNarration='The causeway is quiet beneath the moon.'
  const emptyTurn=await turn(firstSession,character,'I wait for a sign.',nextNarration)
  await waitComplete(emptyTurn.id)
  assert.equal((await request(memoryRoute)).body.memories.some((memory)=>memory.sourceTurnId===emptyTurn.id),false)

  extractionMode='hold';nextNarration=source
  let signalHeldStarted
  const heldStarted=new Promise((resolve)=>{signalHeldStarted=resolve;heldExtractionStarted=resolve})
  const concurrentTurn=await turn(firstSession,character,'I ask Edda while the memory note is being considered.',source)
  await Promise.race([heldStarted,delay(2000).then(()=>{throw new Error('Timed out waiting for the held extraction request.')})])
  const concurrentRetry=await request(`/ai/session/${firstSession.id}/memories/${concurrentTurn.id}/retry?characterId=${character.id}`,'POST')
  assert.equal(concurrentRetry.status,409)
  extractionMode='valid';releaseHeldExtraction();releaseHeldExtraction=null;heldExtractionStarted=null
  await waitFor(memoryRoute,(body)=>body.extractionIssues?.every((issue)=>issue.sourceTurnId!==concurrentTurn.id))

  extractionMode='badEvidence'
  const badEvidenceTurn=await turn(firstSession,character,'I study the marks on the bell.','There are three shallow scratches beneath the handle.')
  state=await waitFor(memoryRoute,(body)=>body.extractionIssues?.some((issue)=>issue.sourceTurnId===badEvidenceTurn.id&&issue.status==='failed'))
  assert.equal(state.extractionIssues.find((issue)=>issue.sourceTurnId===badEvidenceTurn.id).diagnostic,'A memory candidate failed evidence or provenance validation.')
  assert.equal(state.memories.length,1)
  extractionMode='recoverScratch';nextNarration='There are three shallow scratches beneath the handle.'
  const recovered=await request(`/ai/session/${firstSession.id}/memories/${badEvidenceTurn.id}/retry?characterId=${character.id}`,'POST')
  assert.equal(recovered.status,200)
  await waitFor(memoryRoute,(body)=>body.extractionIssues?.every((issue)=>issue.sourceTurnId!==badEvidenceTurn.id))
  assert.equal((await request(memoryRoute)).body.memories.length,2)

  extractionMode='malformed'
  const malformedTurn=await turn(firstSession,character,'I ask for the ferryman’s theory.','Edda Vale says, "The river hides the bell."')
  state=await waitFor(memoryRoute,(body)=>body.extractionIssues?.some((issue)=>issue.sourceTurnId===malformedTurn.id&&issue.status==='failed'))
  assert.equal(state.extractionIssues.find((issue)=>issue.sourceTurnId===malformedTurn.id).diagnostic,'The memory extractor returned malformed JSON.')
  assert.equal(state.memories.length,2)
  extractionMode='conflict';nextNarration='Edda Vale says, "The bell rings from the ruined abbey."'
  await turn(firstSession,character,'I ask whether the bell came from the abbey.',nextNarration)
  state=await waitFor(memoryRoute,(body)=>body.memories?.some((memory)=>memory.statement==='Edda claims the bell rings from the ruined abbey.'))
  assert.equal(state.memories.filter((memory)=>memory.status==='active').length,3)

  extractionMode='badReference'
  const badReferenceTurn=await turn(firstSession,character,'I ask about the tower.','Edda says the tower is quiet.')
  state=await waitFor(memoryRoute,(body)=>body.extractionIssues?.some((issue)=>issue.sourceTurnId===badReferenceTurn.id&&issue.status==='failed'))
  assert.equal(state.memories.length,3)

  extractionMode='supersede';nextNarration='Edda Vale says, "I was wrong; the bell comes from the drowned abbey."'
  const updateTurn=await turn(firstSession,character,'I ask Edda to clarify her story.',nextNarration)
  state=await waitFor(memoryRoute,(body)=>body.memories?.some((memory)=>memory.sourceTurnId===updateTurn.id&&memory.status==='active')&&body.memories?.some((memory)=>memory.status==='superseded'))
  assert.equal(state.memories.filter((memory)=>memory.status==='active'&&memory.category==='npc_statement').length,2)
  assert.equal(state.memories.find((memory)=>memory.status==='superseded').supersededByMemoryId,state.memories.find((memory)=>memory.status==='active'&&memory.category==='npc_statement').id)

  extractionMode='retract';nextNarration='Edda admits that her earlier warning was mistaken.'
  const retractTurn=await turn(firstSession,character,'I ask if her warning was certain.',nextNarration)
  state=await waitFor(memoryRoute,(body)=>body.memories?.some((memory)=>memory.sourceTurnId===updateTurn.id&&memory.status==='retracted'))
  assert.ok(state.memories.some((memory)=>memory.status==='retracted'&&memory.history.some((event)=>event.eventType==='retracted')))

  extractionMode='unavailable';nextNarration='The rain settles while Edda watches the causeway.'
  const unavailableTurn=await turn(firstSession,character,'I wait beside the lantern.',nextNarration)
  state=await waitFor(memoryRoute,(body)=>body.extractionIssues?.some((issue)=>issue.sourceTurnId===unavailableTurn.id&&issue.status==='failed'))
  assert.equal(state.memories.some((memory)=>memory.sourceTurnId===unavailableTurn.id),false)
  extractionMode='recoverRain';nextNarration='The rain settles while Edda watches the causeway.'
  assert.equal((await request(`/ai/session/${firstSession.id}/memories/${unavailableTurn.id}/retry?characterId=${character.id}`,'POST')).status,200)
  await waitFor(memoryRoute,(body)=>body.extractionIssues?.every((issue)=>issue.sourceTurnId!==unavailableTurn.id))

  assert.deepEqual((await request(`/campaigns/${campaign.id}/sessions/${firstSession.id}`)).body,beforeSession)
  assert.deepEqual((await request(`/campaigns/${campaign.id}/players/${player.playerId}/characters/${character.id}/sheet`)).body,beforeSheet)
  const savedBeforeRestart=(await request(memoryRoute)).body.memories
  const failedAttemptsBeforeRestart=Object.fromEntries((await request(memoryRoute)).body.extractionIssues.map((issue)=>[issue.sourceTurnId,issue.attempts]))
  await stopRealm(realmServer);realmServer=await startRealm()
  const restored=(await request(memoryRoute)).body.memories
  assert.deepEqual(restored.map((memory)=>memory.id),savedBeforeRestart.map((memory)=>memory.id))
  const restoredIssues=await request(memoryRoute)
  assert.deepEqual(Object.fromEntries(restoredIssues.body.extractionIssues.map((issue)=>[issue.sourceTurnId,issue.attempts])),failedAttemptsBeforeRestart,'startup does not automatically retry historical failures')
  assert.ok(restored.some((memory)=>memory.status==='superseded'||memory.status==='retracted'))
})
