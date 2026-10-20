require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-world-proposal-storage-'))
const dbPath = path.join(dataDir, 'realmforge.sqlite')
const timestamp = new Date().toISOString()
const legacy = new DatabaseSync(dbPath)
legacy.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE campaigns (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,setting TEXT NOT NULL,createdAt TEXT NOT NULL);
  CREATE TABLE adventures (id TEXT PRIMARY KEY,campaignId TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',startingLocation TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
  CREATE TABLE adventure_locations (id TEXT PRIMARY KEY,adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',locationType TEXT NOT NULL DEFAULT '',dmNotes TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
  CREATE TABLE adventure_npcs (id TEXT PRIMARY KEY,adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',personality TEXT NOT NULL DEFAULT '',disposition TEXT NOT NULL DEFAULT '',currentLocationId TEXT REFERENCES adventure_locations(id) ON DELETE SET NULL,dmNotes TEXT NOT NULL DEFAULT '',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
  CREATE TABLE adventure_quests (id TEXT PRIMARY KEY,adventureId TEXT NOT NULL REFERENCES adventures(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'available',createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
  CREATE TABLE adventure_objectives (id TEXT PRIMARY KEY,questId TEXT NOT NULL REFERENCES adventure_quests(id) ON DELETE CASCADE,description TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,sortOrder INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
  CREATE TABLE adventure_quest_locations (questId TEXT NOT NULL REFERENCES adventure_quests(id) ON DELETE CASCADE,locationId TEXT NOT NULL REFERENCES adventure_locations(id) ON DELETE CASCADE,sortOrder INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL,PRIMARY KEY(questId,locationId));
`)
legacy.prepare('INSERT INTO campaigns VALUES (?,?,?,?,?)').run('campaign-a', 'A', '', '', timestamp)
legacy.prepare('INSERT INTO campaigns VALUES (?,?,?,?,?)').run('campaign-b', 'B', '', '', timestamp)
legacy.prepare('INSERT INTO adventures VALUES (?,?,?,?,?,?,?,?)').run('adventure-a', 'campaign-a', 'A', '', 'active', '', timestamp, timestamp)
legacy.prepare('INSERT INTO adventures VALUES (?,?,?,?,?,?,?,?)').run('adventure-b', 'campaign-b', 'B', '', 'active', '', timestamp, timestamp)
legacy.prepare('INSERT INTO adventure_locations VALUES (?,?,?,?,?,?,?,?)').run('legacy-location', 'adventure-a', 'Old Bridge', 'Manual place', 'Bridge', '', timestamp, timestamp)
legacy.prepare('INSERT INTO adventure_npcs VALUES (?,?,?,?,?,?,?,?,?,?)').run('legacy-npc', 'adventure-a', 'Old Guide', 'Manual person', 'Steady', 'Neutral', 'legacy-location', '', timestamp, timestamp)
legacy.prepare('INSERT INTO adventure_quests VALUES (?,?,?,?,?,?,?)').run('legacy-quest', 'adventure-a', 'Old Task', 'Manual quest', 'available', timestamp, timestamp)
legacy.close()

process.env.REALMFORGE_DATA_DIR = dataDir
const database = require('../src/database.ts')
const store = require('../src/adventureStore.ts')

test.after(() => {
  try { database.close() } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('additive migration preserves manual rows and supports complete proposal fields and scoped relationships', () => {
  const oldNpc = store.getNpc('adventure-a', 'legacy-npc')
  const oldLocation = store.getLocation('adventure-a', 'legacy-location')
  const oldQuest = store.listQuests('adventure-a').find((quest) => quest.id === 'legacy-quest')
  assert.equal(oldNpc.role, '')
  assert.equal(oldNpc.motivation, '')
  assert.equal(oldLocation.narrativePurpose, '')
  assert.equal(oldLocation.relatedLocationId, null)
  assert.equal(oldQuest.trigger, '')

  const setting = store.createLocation('adventure-a', {
    name: 'Ash Observatory', description: 'A roofless watch station.', locationType: 'Observatory', dmNotes: '',
    narrativePurpose: 'It could point toward the hidden source.', relatedLocationId: 'legacy-location',
  })
  assert.equal(setting.narrativePurpose, 'It could point toward the hidden source.')
  assert.equal(setting.relatedLocationId, 'legacy-location')
  assert.equal(store.getAdventureData('campaign-a', 'adventure-a').locations.find((entry) => entry.id === setting.id).relatedLocationName, 'Old Bridge')

  const npc = store.saveNpc('adventure-a', null, {
    name: 'Eira Vale', description: 'A careful scholar.', personality: 'Thoughtful', disposition: 'Neutral', currentLocationId: setting.id, dmNotes: '',
    role: 'Scholar', motivation: 'Understand the old ruins.', storyRelevance: 'She may offer a lead.',
  })
  assert.deepEqual({ role: npc.role, personality: npc.personality, motivation: npc.motivation, description: npc.description, storyRelevance: npc.storyRelevance }, {
    role: 'Scholar', personality: 'Thoughtful', motivation: 'Understand the old ruins.', description: 'A careful scholar.', storyRelevance: 'She may offer a lead.',
  })

  const quest = store.saveQuest('adventure-a', null, { title: 'Follow the Whispers', description: 'Trace the night voices.', status: 'available', trigger: 'A possible lead emerges.' })
  store.addObjective('adventure-a', quest.id, 'Ask Eira about the observatory.', 0)
  store.setQuestNpcs('adventure-a', quest.id, [npc.id])
  store.setQuestLocations('adventure-a', quest.id, [setting.id])
  const storedQuest = store.listQuests('adventure-a').find((entry) => entry.id === quest.id)
  assert.equal(storedQuest.trigger, 'A possible lead emerges.')
  assert.equal(storedQuest.objectives[0].description, 'Ask Eira about the observatory.')
  assert.deepEqual(storedQuest.npcs.map((entry) => entry.id), [npc.id])
  assert.deepEqual(storedQuest.locations.map((entry) => entry.id), [setting.id])

  const otherNpc = store.saveNpc('adventure-b', null, { name: 'Foreign NPC', description: '', personality: '', disposition: '', currentLocationId: null, dmNotes: '' })
  assert.throws(() => store.setQuestNpcs('adventure-a', quest.id, [otherNpc.id]), /NPC not found in this adventure/)
  assert.throws(() => store.setQuestLocations('adventure-a', quest.id, ['legacy-location-foreign']), /Location not found in this adventure/)
  assert.throws(() => store.setRelatedLocation('adventure-a', setting.id, 'missing-location'), /Location not found in this adventure/)
  assert.throws(() => store.setRelatedLocation('adventure-a', setting.id, setting.id), /cannot be related to itself/)
  assert.throws(() => database.prepare('INSERT INTO adventure_quest_npcs (adventureId,questId,npcId,createdAt) VALUES (?,?,?,?)').run('adventure-a', quest.id, otherNpc.id, timestamp), /FOREIGN KEY/)
  assert.throws(() => database.prepare('UPDATE adventure_locations SET relatedLocationId=? WHERE id=?').run(otherNpc.id, setting.id), /same adventure/)

  const beforeNpcCount = Number(database.prepare('SELECT COUNT(*) AS count FROM adventure_npcs WHERE adventureId=?').get('adventure-a').count)
  database.exec('BEGIN IMMEDIATE')
  try {
    const rollbackNpc = store.saveNpc('adventure-a', null, { name: 'Rollback NPC', description: '', personality: '', disposition: '', currentLocationId: null, dmNotes: '', role: 'Test' })
    store.setQuestNpcs('adventure-a', quest.id, [rollbackNpc.id])
    database.exec('ROLLBACK')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM adventure_npcs WHERE adventureId=?').get('adventure-a').count), beforeNpcCount)
  assert.deepEqual(store.listQuestNpcs('adventure-a', quest.id).map((entry) => entry.id), [npc.id])

  const repeatedInit = spawnSync(process.execPath, ['-r', 'tsx/cjs', '-e', "require('./src/database.ts').close()"], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, REALMFORGE_DATA_DIR: dataDir }, encoding: 'utf8',
  })
  assert.equal(repeatedInit.status, 0, repeatedInit.stderr)
  const reopened = new DatabaseSync(dbPath, { readOnly: true })
  assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(reopened.prepare('SELECT name FROM adventure_locations WHERE id=?').get('legacy-location').name, 'Old Bridge')
  assert.equal(reopened.prepare('SELECT title FROM adventure_quests WHERE id=?').get('legacy-quest').title, 'Old Task')
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.prepare('SELECT role,motivation,storyRelevance FROM adventure_npcs WHERE id=?').get(npc.id))), {
    role: 'Scholar', motivation: 'Understand the old ruins.', storyRelevance: 'She may offer a lead.',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(reopened.prepare('SELECT narrativePurpose,relatedLocationId FROM adventure_locations WHERE id=?').get(setting.id))), {
    narrativePurpose: 'It could point toward the hidden source.', relatedLocationId: 'legacy-location',
  })
  assert.equal(reopened.prepare('SELECT trigger FROM adventure_quests WHERE id=?').get(quest.id).trigger, 'A possible lead emerges.')
  assert.equal(reopened.prepare('SELECT npcId FROM adventure_quest_npcs WHERE questId=?').get(quest.id).npcId, npc.id)
  assert.equal(reopened.prepare('SELECT locationId FROM adventure_quest_locations WHERE questId=?').get(quest.id).locationId, setting.id)
  assert.equal(reopened.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='adventure_quest_npcs'").get().count, 1)
  reopened.close()

  database.prepare('DELETE FROM adventure_npcs WHERE adventureId=? AND id=?').run('adventure-a', npc.id)
  assert.deepEqual(store.listQuestNpcs('adventure-a', quest.id), [])
  database.prepare('DELETE FROM adventure_locations WHERE adventureId=? AND id=?').run('adventure-a', setting.id)
  assert.deepEqual(store.listQuestLocations('adventure-a', quest.id), [])
  database.prepare('DELETE FROM adventure_locations WHERE adventureId=? AND id=?').run('adventure-a', 'legacy-location')
  assert.equal(database.prepare('SELECT currentLocationId FROM adventure_npcs WHERE id=?').get('legacy-npc').currentLocationId, null)
})
