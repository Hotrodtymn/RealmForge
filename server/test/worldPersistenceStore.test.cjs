require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const previewFixture = require('./worldPreviewFixture.cjs')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-world-store-'))
process.env.REALMFORGE_DATA_DIR = dataDir
const database = require('../src/database.ts')
const store = require('../src/worldPersistenceStore.ts')
const dbPath = path.join(dataDir, 'realmforge.sqlite')

const config = { dmMode: 'ai', theme: 'dark-fantasy', worldCreation: 'surprise', length: 'short' }
const snapshot = () => ({ preview: previewFixture(), configuration: config, model: 'llama3.1:8b' })
const counts = () => Object.fromEntries(['campaigns','adventures','adventure_locations','adventure_npcs','adventure_quests','adventure_objectives','adventure_quest_locations','adventure_scene_templates','adventure_story_notes'].map((table) => [table, Number(database.prepare('SELECT COUNT(*) n FROM ' + table).get().n)]))

test.after(() => {
  try { database.close() } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('persistence maps preview references and preserves an existing campaign and adventure', () => {
  const timestamp = new Date().toISOString()
  database.prepare('INSERT INTO campaigns (id,name,description,setting,createdAt) VALUES (?,?,?,?,?)').run('existing-campaign', 'The Ashen Crown', 'Existing campaign description', 'Existing setting', timestamp)
  database.prepare('INSERT INTO adventures (id,campaignId,title,description,status,startingLocation,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('existing-adventure', 'existing-campaign', 'The Whispering Flask', 'Existing adventure description', 'draft', '', timestamp, timestamp)
  const originalCampaign = database.prepare('SELECT * FROM campaigns WHERE id=?').get('existing-campaign')
  const originalAdventure = database.prepare('SELECT * FROM adventures WHERE id=?').get('existing-adventure')
  const before = counts()

  const saved = store.persistWorld(snapshot())
  assert.equal(saved.campaign.name, 'The Bell Beneath the Fen')
  assert.equal(saved.adventure.status, 'draft')
  assert.ok(saved.referenceMap.campaign)
  assert.ok(saved.referenceMap.locations.location_chapel)
  assert.ok(saved.referenceMap.npcs.npc_edda)
  assert.ok(saved.referenceMap.mainQuest)
  assert.ok(saved.referenceMap.objectives.objective_choose_fate)
  assert.ok(saved.referenceMap.openingScene)
  assert.equal(database.prepare('SELECT * FROM campaigns WHERE id=?').get('existing-campaign').name, originalCampaign.name)
  assert.equal(database.prepare('SELECT * FROM adventures WHERE id=?').get('existing-adventure').title, originalAdventure.title)
  assert.deepEqual(counts(), Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value + (key === 'campaigns' || key === 'adventures' ? 1 : key === 'adventure_locations' || key === 'adventure_npcs' ? 3 : key === 'adventure_objectives' || key === 'adventure_quest_locations' ? 3 : key === 'adventure_quests' || key === 'adventure_scene_templates' ? 1 : 2)])))

  const locations = database.prepare('SELECT id,name FROM adventure_locations WHERE adventureId=?').all(saved.referenceMap.adventure)
  const locationByName = Object.fromEntries(locations.map((location) => [location.name, location.id]))
  const startingLocation = database.prepare('SELECT startingLocationId,startingLocation FROM adventures WHERE id=?').get(saved.referenceMap.adventure)
  assert.equal(startingLocation.startingLocationId, locationByName['Morrowfen Causeway'])
  assert.equal(startingLocation.startingLocation, 'Morrowfen Causeway')
  assert.equal(database.prepare('SELECT currentLocationId,dmNotes FROM adventure_npcs WHERE id=?').get(saved.referenceMap.npcs.npc_edda).currentLocationId, locationByName['Morrowfen Causeway'])
  assert.match(database.prepare('SELECT dmNotes FROM adventure_npcs WHERE id=?').get(saved.referenceMap.npcs.npc_edda).dmNotes, /Motivation:/)

  const questLocationNames = database.prepare(`SELECT l.name FROM adventure_quest_locations ql JOIN adventure_locations l ON l.id=ql.locationId
    WHERE ql.questId=? ORDER BY ql.sortOrder`).all(saved.referenceMap.mainQuest).map((row) => row.name)
  assert.deepEqual(questLocationNames, ['Morrowfen Causeway', 'Sunken Chapel', 'Old Ferry House'])
  const opening = database.prepare(`SELECT s.title,s.description,l.name AS locationName,q.title AS questTitle
    FROM adventure_scene_templates s JOIN adventure_locations l ON l.id=s.locationId
    JOIN adventure_quests q ON q.id=s.questId WHERE s.id=?`).get(saved.referenceMap.openingScene)
  assert.equal(opening.title, 'A Toll Through the Rain')
  assert.equal(opening.locationName, 'Morrowfen Causeway')
  assert.equal(opening.questTitle, 'Answer the Drowned Bell')
  assert.equal(database.prepare('SELECT COUNT(*) n FROM adventure_sessions WHERE adventureId=?').get(saved.referenceMap.adventure).n, 0)
  assert.match(database.prepare('SELECT content FROM adventure_story_notes WHERE adventureId=? AND content LIKE ?').get(saved.referenceMap.adventure, 'Central Mystery%').content, /repeating a warning/)
})

test('persistence transaction rolls back all inserts if an objective insert fails', () => {
  const before = counts()
  database.exec("CREATE TRIGGER fail_world_objective BEFORE INSERT ON adventure_objectives BEGIN SELECT RAISE(ABORT, 'injected objective failure'); END")
  assert.throws(() => store.persistWorld(snapshot()), /injected objective failure/)
  database.exec('DROP TRIGGER fail_world_objective')
  assert.deepEqual(counts(), before)
})
