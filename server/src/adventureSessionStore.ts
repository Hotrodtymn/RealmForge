import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')

namespace adventureSessionStore {
  type Row = Record<string, unknown>
  type SqlValue = string | number | bigint | null | NodeJS.ArrayBufferView
  export type SessionStatus = 'active' | 'paused' | 'completed'
  export type SessionInput = { requestId: string; characterId: string; locationId: string | null; sceneTitle: string; sceneDescription: string }
  export type TransitionInput = { requestId: string; locationId: string | null; title: string; description: string; dmOverride: boolean; overrideReason: string }
  const now = () => new Date().toISOString()
  const id = () => crypto.randomUUID()
  const one = (sql: string, ...params: SqlValue[]) => database.prepare(sql).get(...params) as Row | undefined
  const many = (sql: string, ...params: SqlValue[]) => database.prepare(sql).all(...params) as unknown as Row[]
  const run = (sql: string, ...params: SqlValue[]) => database.prepare(sql).run(...params)
  const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const requireAdventure = (campaignId: string, adventureId: string) => {
    const row = one('SELECT * FROM adventures WHERE id=? AND campaignId=?', adventureId, campaignId)
    if (!row) throw new HttpError(404, 'Adventure not found in this campaign.')
    return row
  }
  function sessionRow(campaignId: string, sessionId: string) {
    const row = one(`SELECT s.*, a.title AS adventureTitle, a.description AS adventureDescription,
      c.name AS characterName, c.species AS characterSpecies, c.characterClass, c.level AS characterLevel
      FROM adventure_sessions s JOIN adventures a ON a.id=s.adventureId
      JOIN characters c ON c.id=s.characterId WHERE s.id=? AND s.campaignId=?`, sessionId, campaignId)
    if (!row) throw new HttpError(404, 'Session not found in this campaign.')
    return row
  }
  function appendJournal(sessionId: string, eventType: string, sceneId: string | null, details: unknown, timestamp = now()) {
    const sequence = Number(one('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM adventure_session_journal WHERE sessionId=?', sessionId)?.next ?? 1)
    const journalId = id()
    run('INSERT INTO adventure_session_journal (id,sessionId,sequence,eventType,sceneId,createdAt,details) VALUES (?,?,?,?,?,?,?)', journalId, sessionId, sequence, eventType, sceneId, timestamp, JSON.stringify(details))
    return { id: journalId, sessionId, sequence, eventType, sceneId, createdAt: timestamp, details }
  }
  function sessionSnapshot(campaignId: string, sessionId: string) {
    const session = sessionRow(campaignId, sessionId)
    const scenes = many(`SELECT s.*, l.name AS locationName FROM adventure_scenes s
      LEFT JOIN adventure_locations l ON l.id=s.locationId WHERE s.sessionId=? ORDER BY s.sequence ASC`, sessionId)
    const decisions = many(`SELECT d.*, c.name AS characterName FROM adventure_session_decisions d
      JOIN characters c ON c.id=d.characterId WHERE d.sessionId=? ORDER BY d.createdAt ASC,d.rowid ASC`, sessionId)
    const journal: Row[] = many('SELECT * FROM adventure_session_journal WHERE sessionId=? ORDER BY sequence ASC', sessionId).map((entry): Row => ({ ...entry, details: JSON.parse(String(entry.details)) as unknown }))
    return { session, scenes, decisions, journal }
  }
  export function list(campaignId: string, adventureId: string) {
    requireAdventure(campaignId, adventureId)
    return many(`SELECT s.id,s.campaignId,s.adventureId,s.characterId,s.status,s.currentSceneId,s.currentLocationId,
      s.startedAt,s.lastActivityAt,s.completedAt,c.name AS characterName
      FROM adventure_sessions s JOIN characters c ON c.id=s.characterId
      WHERE s.campaignId=? AND s.adventureId=? ORDER BY s.startedAt DESC,s.rowid DESC`, campaignId, adventureId)
  }
  export function get(campaignId: string, sessionId: string) { return sessionSnapshot(campaignId, sessionId) }
  export function start(campaignId: string, adventureId: string, input: SessionInput) {
    const adventure = requireAdventure(campaignId, adventureId)
    const hash = digest({ campaignId, adventureId, ...input })
    const replay = one('SELECT id,startRequestHash FROM adventure_sessions WHERE startRequestId=?', input.requestId)
    if (replay) {
      if (replay.startRequestHash !== hash || !one('SELECT id FROM adventure_sessions WHERE id=? AND campaignId=? AND adventureId=?', replay.id as string, campaignId, adventureId)) throw new HttpError(409, 'This idempotency key was already used for a different session request.')
      return { ...sessionSnapshot(campaignId, String(replay.id)), replayed: true }
    }
    const character = one(`SELECT c.id,c.name,c.species,c.characterClass,c.level,c.status FROM characters c
      JOIN campaign_memberships m ON m.id=c.membershipId WHERE c.id=? AND m.campaignId=?`, input.characterId, campaignId)
    if (!character) throw new HttpError(404, 'Selected character does not belong to this campaign.')
    let locationId = input.locationId || (adventure.startingLocationId ? String(adventure.startingLocationId) : null)
    if (!locationId && String(adventure.startingLocation).trim()) {
      const starting = one('SELECT id FROM adventure_locations WHERE adventureId=? AND name=? COLLATE NOCASE', adventureId, String(adventure.startingLocation).trim())
      if (starting) locationId = String(starting.id)
    }
    if (locationId && !one('SELECT id FROM adventure_locations WHERE id=? AND adventureId=?', locationId, adventureId)) throw new HttpError(404, 'Starting location does not belong to this adventure.')
    const timestamp = now(); const sessionId = id(); const sceneId = id()
    const title = input.sceneTitle || `Opening: ${String(adventure.title)}`
    const description = input.sceneDescription || String(adventure.description)
    database.exec('BEGIN IMMEDIATE')
    try {
      const raced = one('SELECT id,startRequestHash FROM adventure_sessions WHERE startRequestId=?', input.requestId)
      if (raced) {
        if (raced.startRequestHash !== hash || !one('SELECT id FROM adventure_sessions WHERE id=? AND campaignId=? AND adventureId=?', raced.id as string, campaignId, adventureId)) throw new HttpError(409, 'This idempotency key was already used for a different session request.')
        database.exec('COMMIT')
        return { ...sessionSnapshot(campaignId, String(raced.id)), replayed: true }
      }
      run(`INSERT INTO adventure_sessions (id,campaignId,adventureId,characterId,status,currentSceneId,currentLocationId,startedAt,lastActivityAt,completedAt,startRequestId,startRequestHash)
        VALUES (?,?,?,?, 'active',NULL,?,?,?,NULL,?,?)`, sessionId,campaignId,adventureId,input.characterId,locationId,timestamp,timestamp,input.requestId,hash)
      run(`INSERT INTO adventure_scenes (id,sessionId,locationId,title,description,status,sequence,createdAt,completedAt)
        VALUES (?,?,?,?,?,'current',1,?,NULL)`, sceneId,sessionId,locationId,title,description,timestamp)
      run('UPDATE adventure_sessions SET currentSceneId=? WHERE id=?', sceneId, sessionId)
      appendJournal(sessionId,'session_started',sceneId,{ adventureId, adventureTitle: String(adventure.title), characterId: input.characterId, characterName: String(character.name) },timestamp)
      appendJournal(sessionId,'scene_entered',sceneId,{ sceneId,title,locationId },timestamp)
      if (locationId) appendJournal(sessionId,'location_changed',sceneId,{ fromLocationId:null,toLocationId:locationId },timestamp)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      if (String(error).includes('idx_adventure_sessions_one_in_progress') || String(error).includes('UNIQUE constraint failed: adventure_sessions.adventureId')) throw new HttpError(409, 'This character already has an active or paused session for this adventure.')
      throw error
    }
    return { ...sessionSnapshot(campaignId, sessionId), replayed: false }
  }
  export function changeStatus(campaignId: string, sessionId: string, action: 'pause'|'resume'|'complete', requestId: string) {
    sessionRow(campaignId, sessionId)
    const hash = digest({ campaignId, sessionId, action })
    const prior = one('SELECT sessionId,requestHash,responseJson FROM adventure_session_idempotency WHERE requestId=?', requestId)
    if (prior) {
      if (prior.sessionId !== sessionId || prior.requestHash !== hash) throw new HttpError(409, 'This idempotency key was already used for a different session action.')
      return { ...(JSON.parse(String(prior.responseJson)) as ReturnType<typeof sessionSnapshot>), replayed: true }
    }
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      const raced = one('SELECT sessionId,requestHash,responseJson FROM adventure_session_idempotency WHERE requestId=?', requestId)
      if (raced) {
        if (raced.sessionId !== sessionId || raced.requestHash !== hash) throw new HttpError(409, 'This idempotency key was already used for a different session action.')
        database.exec('COMMIT')
        return { ...(JSON.parse(String(raced.responseJson)) as ReturnType<typeof sessionSnapshot>), replayed: true }
      }
      const current = sessionRow(campaignId,sessionId)
      const status = String(current.status) as SessionStatus
      const allowed = action==='pause' ? status==='active' : action==='resume' ? status==='paused' : status==='active'||status==='paused'
      if (!allowed) throw new HttpError(409, `Cannot ${action} a ${status} session.`)
      const nextStatus: SessionStatus = action==='pause'?'paused':action==='resume'?'active':'completed'
      run('UPDATE adventure_sessions SET status=?,lastActivityAt=?,completedAt=? WHERE id=?',nextStatus,timestamp,nextStatus==='completed'?timestamp:null,sessionId)
      if (action==='complete' && current.currentSceneId) {
        const sceneId=String(current.currentSceneId)
        run("UPDATE adventure_scenes SET status='completed',completedAt=? WHERE id=? AND status='current'",timestamp,sceneId)
        const scene=one('SELECT title FROM adventure_scenes WHERE id=?',sceneId)
        appendJournal(sessionId,'scene_completed',sceneId,{sceneId,title:String(scene?.title??'')},timestamp)
      }
      appendJournal(sessionId,`session_${action==='complete'?'completed':action==='pause'?'paused':'resumed'}`,current.currentSceneId===null?null:String(current.currentSceneId),{fromStatus:status,toStatus:nextStatus},timestamp)
      const response=sessionSnapshot(campaignId,sessionId)
      run('INSERT INTO adventure_session_idempotency (requestId,sessionId,requestHash,responseJson,createdAt) VALUES (?,?,?,?,?)',requestId,sessionId,hash,JSON.stringify(response),timestamp)
      database.exec('COMMIT')
      return {...response,replayed:false}
    } catch(error) { database.exec('ROLLBACK'); throw error }
  }
  export function transition(campaignId: string, sessionId: string, input: TransitionInput) {
    sessionRow(campaignId,sessionId)
    const hash=digest({campaignId,sessionId,...input})
    const prior=one('SELECT sessionId,requestHash,responseJson FROM adventure_session_idempotency WHERE requestId=?',input.requestId)
    if(prior){if(prior.sessionId!==sessionId||prior.requestHash!==hash)throw new HttpError(409,'This idempotency key was already used for a different transition.');return {...(JSON.parse(String(prior.responseJson)) as ReturnType<typeof sessionSnapshot>),replayed:true}}
    const timestamp=now()
    database.exec('BEGIN IMMEDIATE')
    try {
      const raced=one('SELECT sessionId,requestHash,responseJson FROM adventure_session_idempotency WHERE requestId=?',input.requestId)
      if(raced){if(raced.sessionId!==sessionId||raced.requestHash!==hash)throw new HttpError(409,'This idempotency key was already used for a different transition.');database.exec('COMMIT');return {...(JSON.parse(String(raced.responseJson)) as ReturnType<typeof sessionSnapshot>),replayed:true}}
      const current=sessionRow(campaignId,sessionId)
      if(current.status!=='active')throw new HttpError(409,'Only an active session can transition scenes.')
      const adventureId=String(current.adventureId)
      if(input.locationId&&!one('SELECT id FROM adventure_locations WHERE id=? AND adventureId=?',input.locationId,adventureId))throw new HttpError(404,'Destination location does not belong to this adventure.')
      const fromLocation=current.currentLocationId===null?null:String(current.currentLocationId)
      if(fromLocation&&input.locationId&&fromLocation!==input.locationId){
        const connected=Boolean(one('SELECT 1 FROM adventure_location_connections WHERE adventureId=? AND fromLocationId=? AND toLocationId=?',adventureId,fromLocation,input.locationId))
        if(!connected&&(!input.dmOverride||!input.overrideReason.trim()))throw new HttpError(409,'Destination is not connected to the current location. Provide a DM override reason for a special transition.',undefined,{requiresOverride:true})
      }
      const previousId=String(current.currentSceneId)
      const previous=one('SELECT title,sequence FROM adventure_scenes WHERE id=? AND sessionId=? AND status=\'current\'',previousId,sessionId)
      if(!previous)throw new HttpError(409,'The session does not have a current scene.')
      run("UPDATE adventure_scenes SET status='completed',completedAt=? WHERE id=?",timestamp,previousId)
      appendJournal(sessionId,'scene_completed',previousId,{sceneId:previousId,title:String(previous.title)},timestamp)
      const sceneId=id();const sequence=Number(previous.sequence)+1
      run(`INSERT INTO adventure_scenes (id,sessionId,locationId,title,description,status,sequence,createdAt,completedAt) VALUES (?,?,?,?,?,'current',?,?,NULL)`,sceneId,sessionId,input.locationId,input.title,input.description,sequence,timestamp)
      run('UPDATE adventure_sessions SET currentSceneId=?,currentLocationId=?,lastActivityAt=? WHERE id=?',sceneId,input.locationId,timestamp,sessionId)
      appendJournal(sessionId,'scene_entered',sceneId,{sceneId,title:input.title,locationId:input.locationId,...(input.dmOverride?{dmOverride:true,overrideReason:input.overrideReason.trim()}: {})},timestamp)
      if(fromLocation!==input.locationId)appendJournal(sessionId,'location_changed',sceneId,{fromLocationId:fromLocation,toLocationId:input.locationId,...(input.dmOverride?{dmOverride:true,overrideReason:input.overrideReason.trim()}: {})},timestamp)
      const response=sessionSnapshot(campaignId,sessionId)
      run('INSERT INTO adventure_session_idempotency (requestId,sessionId,requestHash,responseJson,createdAt) VALUES (?,?,?,?,?)',input.requestId,sessionId,hash,JSON.stringify(response),timestamp)
      database.exec('COMMIT')
      return {...response,replayed:false}
    } catch(error){database.exec('ROLLBACK');throw error}
  }
  export function recordDecision(campaignId:string,sessionId:string,input:{requestId:string;decisionText:string;category:string}){
    sessionRow(campaignId,sessionId)
    const hash=digest({campaignId,sessionId,...input})
    const prior=one('SELECT sessionId,requestHash,responseJson FROM adventure_session_idempotency WHERE requestId=?',input.requestId)
    if(prior){if(prior.sessionId!==sessionId||prior.requestHash!==hash)throw new HttpError(409,'This idempotency key was already used for a different decision.');return {...(JSON.parse(String(prior.responseJson)) as {decision:Row;session:Row}),replayed:true}}
    const timestamp=now();database.exec('BEGIN IMMEDIATE')
    try{
      const raced=one('SELECT sessionId,requestHash,responseJson FROM adventure_session_idempotency WHERE requestId=?',input.requestId)
      if(raced){if(raced.sessionId!==sessionId||raced.requestHash!==hash)throw new HttpError(409,'This idempotency key was already used for a different decision.');database.exec('COMMIT');return {...(JSON.parse(String(raced.responseJson)) as {decision:Row;session:Row}),replayed:true}}
      const current=sessionRow(campaignId,sessionId);if(current.status!=='active')throw new HttpError(409,'Player decisions can only be recorded during an active session.')
      if(!current.currentSceneId)throw new HttpError(409,'The session has no current scene.')
      const decisionId=id(),sceneId=String(current.currentSceneId),characterId=String(current.characterId)
      run('INSERT INTO adventure_session_decisions (id,sessionId,sceneId,characterId,decisionText,category,createdAt,requestId) VALUES (?,?,?,?,?,?,?,?)',decisionId,sessionId,sceneId,characterId,input.decisionText,input.category||null,timestamp,input.requestId)
      run('UPDATE adventure_sessions SET lastActivityAt=? WHERE id=?',timestamp,sessionId)
      appendJournal(sessionId,'player_decision_recorded',sceneId,{decisionId,characterId,decisionText:input.decisionText,category:input.category||null},timestamp)
      const decision=one('SELECT * FROM adventure_session_decisions WHERE id=?',decisionId)!
      const response={decision,session:sessionRow(campaignId,sessionId)}
      run('INSERT INTO adventure_session_idempotency (requestId,sessionId,requestHash,responseJson,createdAt) VALUES (?,?,?,?,?)',input.requestId,sessionId,hash,JSON.stringify(response),timestamp)
      database.exec('COMMIT');return {...response,replayed:false}
    }catch(error){database.exec('ROLLBACK');throw error}
  }
  export function sceneDecisions(campaignId:string,sessionId:string,sceneId:string){
    sessionRow(campaignId,sessionId)
    if(!one('SELECT id FROM adventure_scenes WHERE id=? AND sessionId=?',sceneId,sessionId))throw new HttpError(404,'Scene not found in this session.')
    return many('SELECT * FROM adventure_session_decisions WHERE sessionId=? AND sceneId=? ORDER BY createdAt ASC,rowid ASC',sessionId,sceneId)
  }
  function clip(value:unknown,limit:number){const text=String(value??'');return text.length>limit?`${text.slice(0,limit)}…`:text}
  export function context(campaignId:string,sessionId:string){
    const s=sessionRow(campaignId,sessionId)
    const current=s.currentSceneId?one('SELECT * FROM adventure_scenes WHERE id=? AND sessionId=?',String(s.currentSceneId),sessionId)??null:null
    const locationId=current?.locationId===null||current?.locationId===undefined?null:String(current.locationId)
    const location=locationId?one('SELECT id,name,description,locationType FROM adventure_locations WHERE id=?',locationId):null
    const character=one(`SELECT c.id,c.name,c.species,c.characterClass,c.level,c.str,c.dex,c.con,c.int,c.wis,c.cha
      FROM characters c JOIN campaign_memberships m ON m.id=c.membershipId WHERE c.id=? AND m.campaignId=?`,String(s.characterId),campaignId)
    const npcs=locationId?many(`SELECT id,name,description,personality,disposition FROM adventure_npcs
      WHERE adventureId=? AND currentLocationId=? ORDER BY name COLLATE NOCASE LIMIT 8`,String(s.adventureId),locationId):[]
    const quests=many(`SELECT id,title,description,status FROM adventure_quests WHERE adventureId=? AND status='active' ORDER BY updatedAt DESC,rowid DESC LIMIT 10`,String(s.adventureId))
    const flags=many(`SELECT name,valueJson FROM adventure_story_flags WHERE adventureId=? AND (substr(name,1,7)='public_' OR substr(name,1,7)='player_') ORDER BY name COLLATE NOCASE LIMIT 20`,String(s.adventureId)).map((flag)=>({name:String(flag.name),value:JSON.parse(String(flag.valueJson)) as unknown}))
    const decisions=many(`SELECT id,sceneId,decisionText,category,createdAt FROM adventure_session_decisions WHERE sessionId=? ORDER BY createdAt DESC,rowid DESC LIMIT 10`,sessionId).reverse()
    const journal=many('SELECT sequence,eventType,sceneId,createdAt,details FROM adventure_session_journal WHERE sessionId=? ORDER BY sequence DESC LIMIT 20',sessionId).reverse()
    const safeJournal=journal.map((entry)=>{const details=JSON.parse(String(entry.details)) as Record<string,unknown>;const {overrideReason:_privateOverrideReason,...visibleDetails}=details;return {sequence:entry.sequence,eventType:entry.eventType,sceneId:entry.sceneId,createdAt:entry.createdAt,details:visibleDetails}})
    const scenes=many(`SELECT s.id,s.locationId,l.name AS locationName,s.title,s.description,s.status,s.sequence,s.createdAt,s.completedAt
      FROM adventure_scenes s LEFT JOIN adventure_locations l ON l.id=s.locationId WHERE s.sessionId=? ORDER BY s.sequence ASC`,sessionId)
    const destinations=locationId?many(`SELECT l.id,l.name,l.description,l.locationType
      FROM adventure_location_connections c JOIN adventure_locations l ON l.id=c.toLocationId
      WHERE c.adventureId=? AND c.fromLocationId=? ORDER BY l.name COLLATE NOCASE`,String(s.adventureId),locationId):[]
    return {session:{id:s.id,status:s.status,startedAt:s.startedAt,lastActivityAt:s.lastActivityAt},adventure:{id:s.adventureId,title:clip(s.adventureTitle,160),summary:clip(s.adventureDescription,2000)},character:character?{id:character.id,name:clip(character.name,120),species:clip(character.species,80),class:clip(character.characterClass,80),level:character.level,abilityScores:{str:character.str,dex:character.dex,con:character.con,int:character.int,wis:character.wis,cha:character.cha}}:null,currentScene:current?{id:current.id,sequence:current.sequence,title:clip(current.title,160),description:clip(current.description,2000),status:current.status}:null,scenes:scenes.map((scene)=>({id:scene.id,locationId:scene.locationId,locationName:scene.locationName,title:clip(scene.title,160),description:clip(scene.description,2000),status:scene.status,sequence:scene.sequence,createdAt:scene.createdAt,completedAt:scene.completedAt})),currentLocation:location?{id:location.id,name:clip(location.name,120),description:clip(location.description,1000),type:clip(location.locationType,80)}:null,connectedLocations:destinations.map((place)=>({id:place.id,name:clip(place.name,120),description:clip(place.description,800),type:clip(place.locationType,80)})),visibleNpcs:npcs.map((npc)=>({id:npc.id,name:clip(npc.name,120),description:clip(npc.description,700),personality:clip(npc.personality,300),disposition:clip(npc.disposition,100)})),activeQuests:quests.map((quest)=>({id:quest.id,title:clip(quest.title,160),description:clip(quest.description,800),status:quest.status})),publicStoryFlags:flags,recentPlayerDecisions:decisions.map((decision)=>({id:decision.id,sceneId:decision.sceneId,text:clip(decision.decisionText,1000),category:decision.category,createdAt:decision.createdAt})),recentJournalEvents:safeJournal}
  }
}

export = adventureSessionStore
