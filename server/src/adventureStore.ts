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
    run('UPDATE adventures SET title=?,description=?,status=?,startingLocation=?,updatedAt=? WHERE id=? AND campaignId=?', input.title, input.description, input.status, input.startingLocation, now(), adventureId, campaignId)
    return getAdventure(campaignId, adventureId)
  }
  export function getAdventureData(campaignId: string, adventureId: string) {
    getAdventure(campaignId, adventureId)
    const locations = many(`SELECT l.*, (SELECT json_group_array(json_object('id', t.id, 'name', t.name)) FROM adventure_location_connections c JOIN adventure_locations t ON t.id=c.toLocationId WHERE c.fromLocationId=l.id) AS connections FROM adventure_locations l WHERE l.adventureId=? ORDER BY l.name COLLATE NOCASE`, adventureId).map((location)=>({...location,connections:JSON.parse(String(location.connections)) as {id:string;name:string}[]}))
    const npcs = many(`SELECT n.*, l.name AS currentLocationName FROM adventure_npcs n LEFT JOIN adventure_locations l ON l.id=n.currentLocationId WHERE n.adventureId=? ORDER BY n.name COLLATE NOCASE`, adventureId)
    const quests = many('SELECT * FROM adventure_quests WHERE adventureId=? ORDER BY updatedAt DESC', adventureId).map((quest) => ({ ...quest, objectives: many('SELECT * FROM adventure_objectives WHERE questId=? ORDER BY sortOrder, createdAt', String(quest.id)) }))
    const storyFlags = many('SELECT name, valueJson, updatedAt FROM adventure_story_flags WHERE adventureId=? ORDER BY name COLLATE NOCASE', adventureId).map((flag) => ({ name: flag.name, value: JSON.parse(String(flag.valueJson)) as unknown, updatedAt: flag.updatedAt }))
    const storyNotes = many('SELECT id, content, createdAt FROM adventure_story_notes WHERE adventureId=? ORDER BY createdAt DESC', adventureId)
    return { locations, npcs, quests, storyFlags, storyNotes }
  }
  export function listLocations(adventureId: string) { return many('SELECT * FROM adventure_locations WHERE adventureId=? ORDER BY name COLLATE NOCASE', adventureId) }
  export function getLocation(adventureId: string, locationId: string) { return requireLocation(adventureId, locationId) }
  export function createLocation(adventureId: string, input: { name: string; description: string; locationType: string; dmNotes: string }) {
    const timestamp=now(), locationId=id(); run('INSERT INTO adventure_locations (id,adventureId,name,description,locationType,dmNotes,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)', locationId, adventureId, input.name, input.description, input.locationType, input.dmNotes, timestamp, timestamp)
    return one('SELECT * FROM adventure_locations WHERE id=?', locationId)
  }
  export function updateLocation(adventureId: string, locationId: string, input: { name: string; description: string; locationType: string; dmNotes: string }) {
    requireLocation(adventureId, locationId); run('UPDATE adventure_locations SET name=?,description=?,locationType=?,dmNotes=?,updatedAt=? WHERE id=?', input.name, input.description, input.locationType, input.dmNotes, now(), locationId)
    return one('SELECT * FROM adventure_locations WHERE id=?', locationId)
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
  export function saveNpc(adventureId: string, npcId: string | null, input: { name: string; description: string; personality: string; disposition: string; currentLocationId: string | null; dmNotes: string }) {
    if (input.currentLocationId) requireLocation(adventureId, input.currentLocationId)
    const timestamp=now()
    if (npcId) { if (!one('SELECT id FROM adventure_npcs WHERE adventureId=? AND id=?', adventureId, npcId)) throw new HttpError(404,'NPC not found in this adventure.'); run('UPDATE adventure_npcs SET name=?,description=?,personality=?,disposition=?,currentLocationId=?,dmNotes=?,updatedAt=? WHERE id=?', input.name,input.description,input.personality,input.disposition,input.currentLocationId,input.dmNotes,timestamp,npcId); return one('SELECT * FROM adventure_npcs WHERE id=?',npcId) }
    const newId=id(); run('INSERT INTO adventure_npcs (id,adventureId,name,description,personality,disposition,currentLocationId,dmNotes,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',newId,adventureId,input.name,input.description,input.personality,input.disposition,input.currentLocationId,input.dmNotes,timestamp,timestamp); return one('SELECT * FROM adventure_npcs WHERE id=?',newId)
  }
  export function listQuests(adventureId: string) { return many('SELECT * FROM adventure_quests WHERE adventureId=? ORDER BY updatedAt DESC', adventureId).map((quest)=>({...quest,id:String(quest.id),objectives:many('SELECT * FROM adventure_objectives WHERE questId=? ORDER BY sortOrder,createdAt',String(quest.id))})) }
  export function saveQuest(adventureId: string, questId: string | null, input: { title: string; description: string; status: string }) {
    const timestamp=now()
    if (questId) { if (!one('SELECT id FROM adventure_quests WHERE adventureId=? AND id=?',adventureId,questId)) throw new HttpError(404,'Quest not found in this adventure.'); run('UPDATE adventure_quests SET title=?,description=?,status=?,updatedAt=? WHERE id=?',input.title,input.description,input.status,timestamp,questId); return listQuests(adventureId).find((q)=>q.id===questId) }
    const newId=id(); run('INSERT INTO adventure_quests (id,adventureId,title,description,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',newId,adventureId,input.title,input.description,input.status,timestamp,timestamp); return listQuests(adventureId).find((q)=>q.id===newId)
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
