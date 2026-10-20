import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')

namespace adventureStore {
  const now = () => new Date().toISOString()
  const id = () => crypto.randomUUID()
  type Row = Record<string, unknown>
  type SqlValue = string | number | bigint | null | NodeJS.ArrayBufferView
  const one = (sql: string, ...params: SqlValue[]) => database.prepare(sql).get(...params) as Row | undefined
  const many = (sql: string, ...params: SqlValue[]) => database.prepare(sql).all(...params) as unknown as Row[]
  const run = (sql: string, ...params: SqlValue[]) => database.prepare(sql).run(...params)

  export function requireCampaign(campaignId: string) {
    if (!one('SELECT id FROM campaigns WHERE id = ?', campaignId)) throw new HttpError(404, 'Campaign not found.')
  }
  export function getAdventure(campaignId: string, adventureId: string) {
    const row = one('SELECT * FROM adventures WHERE campaignId = ? AND id = ?', campaignId, adventureId)
    if (!row) throw new HttpError(404, 'Adventure not found in this campaign.')
    return row
  }
  export function listAdventures(campaignId: string) {
    requireCampaign(campaignId)
    return many('SELECT * FROM adventures WHERE campaignId = ? ORDER BY updatedAt DESC, rowid DESC', campaignId)
  }
  // Player-facing data is deliberately selected field-by-field. Never return DM notes,
  // private flags, or the management-only story notebook from this endpoint.
  export function playerView(campaignId: string, adventureId: string) {
    const adventure = getAdventure(campaignId, adventureId)
    const locations = many(`SELECT l.id,l.name,l.description,l.locationType,
      (SELECT json_group_array(json_object('id', t.id, 'name', t.name))
       FROM adventure_location_connections c JOIN adventure_locations t ON t.id=c.toLocationId
       WHERE c.fromLocationId=l.id) AS connections
      FROM adventure_locations l WHERE l.adventureId=? ORDER BY l.name COLLATE NOCASE`, adventureId)
      .map((location) => ({ ...location, connections: JSON.parse(String(location.connections)) as { id: string; name: string }[] }))
    const npcs = many(`SELECT id,name,description,personality,disposition,currentLocationId
      FROM adventure_npcs WHERE adventureId=? ORDER BY name COLLATE NOCASE`, adventureId)
    return {
      adventure: { id: adventure.id, campaignId: adventure.campaignId, title: adventure.title, description: adventure.description, status: adventure.status, startingLocation: adventure.startingLocation },
      locations,
      npcs,
    }
  }
  export function createAdventure(campaignId: string, input: { title: string; description: string; status: string; startingLocation: string }) {
    requireCampaign(campaignId)
    const timestamp = now(); const adventureId = id()
    run('INSERT INTO adventures (id,campaignId,title,description,status,startingLocation,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)', adventureId, campaignId, input.title, input.description, input.status, input.startingLocation, timestamp, timestamp)
    return getAdventure(campaignId, adventureId)
  }
  export function updateAdventure(campaignId: string, adventureId: string, input: { title: string; description: string; status: string; startingLocation: string }) {
    getAdventure(campaignId, adventureId)
    const location = input.startingLocation.trim()
      ? one('SELECT id FROM adventure_locations WHERE adventureId=? AND name=? COLLATE NOCASE ORDER BY rowid LIMIT 1', adventureId, input.startingLocation.trim())
      : undefined
    run('UPDATE adventures SET title=?,description=?,status=?,startingLocation=?,startingLocationId=?,updatedAt=? WHERE id=? AND campaignId=?', input.title, input.description, input.status, input.startingLocation, location?.id == null ? null : String(location.id), now(), adventureId, campaignId)
    return getAdventure(campaignId, adventureId)
  }
  export function getAdventureData(campaignId: string, adventureId: string) {
    getAdventure(campaignId, adventureId)
    const locations = many(`SELECT l.*, r.name AS relatedLocationName,
      (SELECT json_group_array(json_object('id', t.id, 'name', t.name)) FROM adventure_location_connections c JOIN adventure_locations t ON t.id=c.toLocationId WHERE c.fromLocationId=l.id) AS connections
      FROM adventure_locations l LEFT JOIN adventure_locations r ON r.id=l.relatedLocationId
      WHERE l.adventureId=? ORDER BY l.name COLLATE NOCASE`, adventureId).map((location)=>({...location,connections:JSON.parse(String(location.connections)) as {id:string;name:string}[]}))
    const npcs = many(`SELECT n.*, l.name AS currentLocationName FROM adventure_npcs n LEFT JOIN adventure_locations l ON l.id=n.currentLocationId WHERE n.adventureId=? ORDER BY n.name COLLATE NOCASE`, adventureId)
    const quests = many('SELECT * FROM adventure_quests WHERE adventureId=? ORDER BY updatedAt DESC', adventureId).map((quest) => ({
      ...quest,
      objectives: many('SELECT * FROM adventure_objectives WHERE questId=? ORDER BY sortOrder, createdAt', String(quest.id)),
      locations: many(`SELECT l.id,l.name,ql.sortOrder FROM adventure_quest_locations ql
        JOIN adventure_locations l ON l.id=ql.locationId WHERE ql.questId=? ORDER BY ql.sortOrder`, String(quest.id)),
      npcs: listQuestNpcs(adventureId, String(quest.id)),
    }))
    const openingScenes = many(`SELECT s.id,s.adventureId,s.templateKey,s.sceneType,s.locationId,l.name AS locationName,
      s.questId,q.title AS questTitle,s.title,s.description,s.createdAt
      FROM adventure_scene_templates s
      LEFT JOIN adventure_locations l ON l.id=s.locationId
      LEFT JOIN adventure_quests q ON q.id=s.questId
      WHERE s.adventureId=? ORDER BY s.createdAt,s.rowid`, adventureId)
    const storyFlags = many('SELECT name, valueJson, updatedAt FROM adventure_story_flags WHERE adventureId=? ORDER BY name COLLATE NOCASE', adventureId).map((flag) => ({ name: flag.name, value: JSON.parse(String(flag.valueJson)) as unknown, updatedAt: flag.updatedAt }))
    const storyNotes = many('SELECT id, content, createdAt FROM adventure_story_notes WHERE adventureId=? ORDER BY createdAt DESC', adventureId)
    return { locations, npcs, quests, openingScenes, storyFlags, storyNotes }
  }
  export function listLocations(adventureId: string) { return many('SELECT * FROM adventure_locations WHERE adventureId=? ORDER BY name COLLATE NOCASE', adventureId) }
  export function getLocation(adventureId: string, locationId: string) { return requireLocation(adventureId, locationId) }
  export function createLocation(adventureId: string, input: { name: string; description: string; locationType: string; dmNotes: string; narrativePurpose?: string; relatedLocationId?: string | null }) {
    if (input.relatedLocationId) requireLocation(adventureId, input.relatedLocationId)
    const timestamp=now(), locationId=id(); run('INSERT INTO adventure_locations (id,adventureId,name,description,locationType,dmNotes,narrativePurpose,relatedLocationId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)', locationId, adventureId, input.name, input.description, input.locationType, input.dmNotes, input.narrativePurpose ?? '', input.relatedLocationId ?? null, timestamp, timestamp)
    return one('SELECT * FROM adventure_locations WHERE id=?', locationId)
  }
  export function updateLocation(adventureId: string, locationId: string, input: { name: string; description: string; locationType: string; dmNotes: string; narrativePurpose?: string; relatedLocationId?: string | null }) {
    requireLocation(adventureId, locationId)
    if (input.relatedLocationId) requireLocation(adventureId, input.relatedLocationId)
    if (input.relatedLocationId === locationId) throw new HttpError(400, 'A location cannot be related to itself.')
    run('UPDATE adventure_locations SET name=?,description=?,locationType=?,dmNotes=?,narrativePurpose=COALESCE(?,narrativePurpose),relatedLocationId=COALESCE(?,relatedLocationId),updatedAt=? WHERE id=?', input.name, input.description, input.locationType, input.dmNotes, input.narrativePurpose ?? null, input.relatedLocationId ?? null, now(), locationId)
    return one('SELECT * FROM adventure_locations WHERE id=?', locationId)
  }
  export function setRelatedLocation(adventureId: string, locationId: string, relatedLocationId: string | null) {
    requireLocation(adventureId, locationId)
    if (relatedLocationId) requireLocation(adventureId, relatedLocationId)
    if (relatedLocationId === locationId) throw new HttpError(400, 'A location cannot be related to itself.')
    run('UPDATE adventure_locations SET relatedLocationId=?,updatedAt=? WHERE adventureId=? AND id=?', relatedLocationId, now(), adventureId, locationId)
    return getLocation(adventureId, locationId)
  }
  function requireLocation(adventureId: string, locationId: string) { const row=one('SELECT * FROM adventure_locations WHERE adventureId=? AND id=?', adventureId, locationId); if (!row) throw new HttpError(404, 'Location not found in this adventure.'); return row }
  export function connectLocations(adventureId: string, fromId: string, toId: string) {
    requireLocation(adventureId, fromId); requireLocation(adventureId, toId)
    if (fromId === toId) throw new HttpError(400, 'A location cannot connect to itself.')
    if (one('SELECT 1 FROM adventure_location_connections WHERE adventureId=? AND ((fromLocationId=? AND toLocationId=?) OR (fromLocationId=? AND toLocationId=?))', adventureId, fromId, toId, toId, fromId)) {
      throw new HttpError(409, 'These locations are already connected.')
    }
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      run('INSERT INTO adventure_location_connections (adventureId,fromLocationId,toLocationId,createdAt) VALUES (?,?,?,?)', adventureId, fromId, toId, timestamp)
      run('INSERT INTO adventure_location_connections (adventureId,fromLocationId,toLocationId,createdAt) VALUES (?,?,?,?)', adventureId, toId, fromId, timestamp)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      if (String(error).includes('UNIQUE')) throw new HttpError(409, 'These locations are already connected.')
      throw error
    }
    return listLocations(adventureId)
  }
  export function listNpcs(adventureId: string) { return many('SELECT n.*,l.name AS currentLocationName FROM adventure_npcs n LEFT JOIN adventure_locations l ON l.id=n.currentLocationId WHERE n.adventureId=? ORDER BY n.name COLLATE NOCASE', adventureId) }
  export function getNpc(adventureId: string, npcId: string) { const row=one('SELECT n.*,l.name AS currentLocationName FROM adventure_npcs n LEFT JOIN adventure_locations l ON l.id=n.currentLocationId WHERE n.adventureId=? AND n.id=?',adventureId,npcId); if (!row) throw new HttpError(404,'NPC not found in this adventure.'); return row }
  export function saveNpc(adventureId: string, npcId: string | null, input: { name: string; description: string; personality: string; disposition: string; currentLocationId: string | null; dmNotes: string; role?: string; motivation?: string; storyRelevance?: string }) {
    if (input.currentLocationId) requireLocation(adventureId, input.currentLocationId)
    const timestamp=now()
    if (npcId) { if (!one('SELECT id FROM adventure_npcs WHERE adventureId=? AND id=?', adventureId, npcId)) throw new HttpError(404,'NPC not found in this adventure.'); run('UPDATE adventure_npcs SET name=?,description=?,personality=?,disposition=?,currentLocationId=?,dmNotes=?,role=COALESCE(?,role),motivation=COALESCE(?,motivation),storyRelevance=COALESCE(?,storyRelevance),updatedAt=? WHERE id=?', input.name,input.description,input.personality,input.disposition,input.currentLocationId,input.dmNotes,input.role ?? null,input.motivation ?? null,input.storyRelevance ?? null,timestamp,npcId); return one('SELECT * FROM adventure_npcs WHERE id=?',npcId) }
    const newId=id(); run('INSERT INTO adventure_npcs (id,adventureId,name,description,personality,disposition,currentLocationId,dmNotes,role,motivation,storyRelevance,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',newId,adventureId,input.name,input.description,input.personality,input.disposition,input.currentLocationId,input.dmNotes,input.role ?? '',input.motivation ?? '',input.storyRelevance ?? '',timestamp,timestamp); return one('SELECT * FROM adventure_npcs WHERE id=?',newId)
  }
  export function listQuestNpcs(adventureId: string, questId: string) {
    if (!one('SELECT id FROM adventure_quests WHERE adventureId=? AND id=?', adventureId, questId)) throw new HttpError(404, 'Quest not found in this adventure.')
    return many(`SELECT n.id,n.name,qn.createdAt FROM adventure_quest_npcs qn JOIN adventure_npcs n ON n.id=qn.npcId
      WHERE qn.adventureId=? AND qn.questId=? ORDER BY qn.createdAt,n.name COLLATE NOCASE`, adventureId, questId)
  }
  // This helper participates in a caller-managed transaction during proposal approval.
  export function setQuestNpcs(adventureId: string, questId: string, npcIds: string[]) {
    if (!Array.isArray(npcIds) || new Set(npcIds).size !== npcIds.length) throw new HttpError(400, 'Quest NPC references must be a unique list.')
    if (!one('SELECT id FROM adventure_quests WHERE adventureId=? AND id=?', adventureId, questId)) throw new HttpError(404, 'Quest not found in this adventure.')
    for (const npcId of npcIds) if (!one('SELECT id FROM adventure_npcs WHERE adventureId=? AND id=?', adventureId, npcId)) throw new HttpError(404, 'NPC not found in this adventure.')
    run('DELETE FROM adventure_quest_npcs WHERE adventureId=? AND questId=?', adventureId, questId)
    for (const npcId of npcIds) run('INSERT INTO adventure_quest_npcs (adventureId,questId,npcId,createdAt) VALUES (?,?,?,?)', adventureId, questId, npcId, now())
    return listQuestNpcs(adventureId, questId)
  }
  export function listQuestLocations(adventureId: string, questId: string) {
    if (!one('SELECT id FROM adventure_quests WHERE adventureId=? AND id=?', adventureId, questId)) throw new HttpError(404, 'Quest not found in this adventure.')
    return many(`SELECT l.id,l.name,ql.sortOrder FROM adventure_quest_locations ql JOIN adventure_locations l ON l.id=ql.locationId
      WHERE ql.questId=? AND l.adventureId=? ORDER BY ql.sortOrder,l.name COLLATE NOCASE`, questId, adventureId)
  }
  export function setQuestLocations(adventureId: string, questId: string, locationIds: string[]) {
    if (!Array.isArray(locationIds) || new Set(locationIds).size !== locationIds.length) throw new HttpError(400, 'Quest location references must be a unique list.')
    if (!one('SELECT id FROM adventure_quests WHERE adventureId=? AND id=?', adventureId, questId)) throw new HttpError(404, 'Quest not found in this adventure.')
    for (const locationId of locationIds) requireLocation(adventureId, locationId)
    run('DELETE FROM adventure_quest_locations WHERE questId=?', questId)
    locationIds.forEach((locationId, sortOrder) => run('INSERT INTO adventure_quest_locations (questId,locationId,sortOrder,createdAt) VALUES (?,?,?,?)', questId, locationId, sortOrder, now()))
    return listQuestLocations(adventureId, questId)
  }
  export function listQuests(adventureId: string) { return many('SELECT * FROM adventure_quests WHERE adventureId=? ORDER BY updatedAt DESC', adventureId).map((quest)=>({...quest,id:String(quest.id),objectives:many('SELECT * FROM adventure_objectives WHERE questId=? ORDER BY sortOrder,createdAt',String(quest.id)),locations:listQuestLocations(adventureId,String(quest.id)),npcs:listQuestNpcs(adventureId,String(quest.id))})) }
  export function saveQuest(adventureId: string, questId: string | null, input: { title: string; description: string; status: string; trigger?: string }) {
    const timestamp=now()
    if (questId) { if (!one('SELECT id FROM adventure_quests WHERE adventureId=? AND id=?',adventureId,questId)) throw new HttpError(404,'Quest not found in this adventure.'); run('UPDATE adventure_quests SET title=?,description=?,status=?,trigger=COALESCE(?,trigger),updatedAt=? WHERE id=?',input.title,input.description,input.status,input.trigger ?? null,timestamp,questId); return listQuests(adventureId).find((q)=>q.id===questId) }
    const newId=id(); run('INSERT INTO adventure_quests (id,adventureId,title,description,status,trigger,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)',newId,adventureId,input.title,input.description,input.status,input.trigger ?? '',timestamp,timestamp); return listQuests(adventureId).find((q)=>q.id===newId)
  }
  export function addObjective(adventureId: string, questId: string, description: string, sortOrder: number) {
    if (!one('SELECT id FROM adventure_quests WHERE adventureId=? AND id=?',adventureId,questId)) throw new HttpError(404,'Quest not found in this adventure.')
    const timestamp=now(), objectiveId=id(); run('INSERT INTO adventure_objectives (id,questId,description,completed,sortOrder,createdAt,updatedAt) VALUES (?,?,?,0,?,?,?)',objectiveId,questId,description,sortOrder,timestamp,timestamp); return one('SELECT * FROM adventure_objectives WHERE id=?',objectiveId)
  }
  export function setObjective(adventureId: string, questId: string, objectiveId: string, completed: boolean) {
    if (!one('SELECT id FROM adventure_quests WHERE adventureId=? AND id=?',adventureId,questId) || !one('SELECT id FROM adventure_objectives WHERE questId=? AND id=?',questId,objectiveId)) throw new HttpError(404,'Objective not found in this quest.')
    run('UPDATE adventure_objectives SET completed=?,updatedAt=? WHERE id=?',completed?1:0,now(),objectiveId); return one('SELECT * FROM adventure_objectives WHERE id=?',objectiveId)
  }
  export function saveFlag(adventureId: string, name: string, value: unknown) { const valueJson=JSON.stringify(value); run('INSERT INTO adventure_story_flags (adventureId,name,valueJson,updatedAt) VALUES (?,?,?,?) ON CONFLICT(adventureId,name) DO UPDATE SET valueJson=excluded.valueJson,updatedAt=excluded.updatedAt',adventureId,name,valueJson,now()); return {name,value,updatedAt:now()} }
  export function addStoryNote(adventureId: string, content: string) { const timestamp=now(), noteId=id(); run('INSERT INTO adventure_story_notes (id,adventureId,content,createdAt) VALUES (?,?,?,?)',noteId,adventureId,content,timestamp); return one('SELECT * FROM adventure_story_notes WHERE id=?',noteId) }
}

export = adventureStore
