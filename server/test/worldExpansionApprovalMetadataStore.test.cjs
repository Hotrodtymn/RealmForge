require('tsx/cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-world-approval-metadata-'))
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
`)
legacy.prepare('INSERT INTO campaigns VALUES (?,?,?,?,?)').run('legacy-campaign', 'Legacy Campaign', '', '', timestamp)
legacy.prepare('INSERT INTO adventures VALUES (?,?,?,?,?,?,?,?)').run('legacy-adventure', 'legacy-campaign', 'Legacy Adventure', '', 'draft', '', timestamp, timestamp)
legacy.prepare('INSERT INTO adventure_locations VALUES (?,?,?,?,?,?,?,?)').run('legacy-location', 'legacy-adventure', 'Old Bridge', 'An existing manually authored place.', 'Bridge', '', timestamp, timestamp)
legacy.prepare('INSERT INTO adventure_npcs VALUES (?,?,?,?,?,?,?,?,?,?)').run('legacy-npc', 'legacy-adventure', 'Old Guide', 'An existing manually authored NPC.', 'Steady', 'Neutral', 'legacy-location', '', timestamp, timestamp)
legacy.prepare('INSERT INTO adventure_quests VALUES (?,?,?,?,?,?,?)').run('legacy-quest', 'legacy-adventure', 'Old Task', 'An existing manually authored quest.', 'available', timestamp, timestamp)
legacy.close()
process.env.REALMFORGE_DATA_DIR = dataDir
const database = require('../src/database.ts')
const store = require('../src/worldExpansionApprovalMetadataStore.ts')
const adventureStore = require('../src/adventureStore.ts')

const previewId = 'A'.repeat(43)
const metadata = (overrides = {}) => ({
  adventureId: 'legacy-adventure', entityType: 'npc', entityId: 'legacy-npc', previewId, proposalKey: 'npc_sable', proposalType: 'npc',
  evidence: [
    { sourceType: 'dm_narration', sourceId: 'conversation-1-narration', quote: 'A supplied exact excerpt.', relationship: 'established_fact', sourceLabel: 'DM narration · turn 1' },
    { sourceType: 'story_memory', sourceId: 'memory-2', quote: 'A separate verified quote.', relationship: 'creative_inspiration', sourceLabel: 'Story memory · mystery' },
  ],
  uncertainty: 'uncertain', approvedAt: timestamp, ...overrides,
})

test.after(() => {
  try { database.close() } catch {}
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('additive migration preserves legacy entities and metadata helpers enforce scope, identity, and caller-owned transactions', () => {
  const legacyRows = {
    campaign: database.prepare('SELECT name FROM campaigns WHERE id=?').get('legacy-campaign'),
    adventure: database.prepare('SELECT title FROM adventures WHERE id=?').get('legacy-adventure'),
    location: database.prepare('SELECT name FROM adventure_locations WHERE id=?').get('legacy-location'),
    npc: database.prepare('SELECT name FROM adventure_npcs WHERE id=?').get('legacy-npc'),
    quest: database.prepare('SELECT title FROM adventure_quests WHERE id=?').get('legacy-quest'),
  }
  assert.deepEqual(JSON.parse(JSON.stringify(legacyRows)), {
    campaign: { name: 'Legacy Campaign' }, adventure: { title: 'Legacy Adventure' },
    location: { name: 'Old Bridge' }, npc: { name: 'Old Guide' }, quest: { title: 'Old Task' },
  })
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='adventure_world_expansion_approvals'").get().count, 1)

  store.writeApprovedProposalMetadata(metadata())
  assert.equal(store.hasApprovalIdentity(previewId, 'npc_sable'), true)
  assert.deepEqual(store.getApprovedProposalMetadata('legacy-adventure', 'npc', 'legacy-npc'), { ...metadata(), origin: 'ai_assisted_dm_approved' })
  assert.equal(store.getApprovedProposalMetadata('legacy-adventure', 'location', 'legacy-npc'), null)
  const locationMetadata = metadata({ entityType: 'location', entityId: 'legacy-location', proposalType: 'location', previewId: 'C'.repeat(43), proposalKey: 'location_oldbridge', uncertainty: 'observed' })
  const questMetadata = metadata({ entityType: 'quest', entityId: 'legacy-quest', proposalType: 'quest', previewId: 'D'.repeat(43), proposalKey: 'quest_oldtask', uncertainty: 'npc_claim' })
  store.writeApprovedProposalMetadata(locationMetadata)
  store.writeApprovedProposalMetadata(questMetadata)
  assert.deepEqual(store.getApprovedProposalMetadata('legacy-adventure', 'location', 'legacy-location'), { ...locationMetadata, origin: 'ai_assisted_dm_approved' })
  assert.deepEqual(store.getApprovedProposalMetadata('legacy-adventure', 'quest', 'legacy-quest'), { ...questMetadata, origin: 'ai_assisted_dm_approved' })
  assert.throws(() => store.writeApprovedProposalMetadata(metadata({ adventureId: 'missing-adventure' })), /FOREIGN KEY|adventure/i)
  assert.throws(() => store.writeApprovedProposalMetadata(metadata({ adventureId: 'legacy-adventure', entityId: 'legacy-location' })), /must belong to its adventure/)
  database.prepare('INSERT INTO campaigns (id,name,description,setting,createdAt) VALUES (?,?,?,?,?)').run('other-campaign', 'Other Campaign', '', '', timestamp)
  database.prepare('INSERT INTO adventures (id,campaignId,title,description,status,startingLocation,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)').run('other-adventure', 'other-campaign', 'Other Adventure', '', 'draft', '', timestamp, timestamp)
  const foreignLocation = adventureStore.createLocation('other-adventure', { name: 'Other Place', description: '', locationType: 'Test', dmNotes: '' })
  assert.throws(() => store.writeApprovedProposalMetadata(metadata({ entityType: 'location', proposalType: 'location', entityId: String(foreignLocation.id), previewId: 'E'.repeat(43), proposalKey: 'location_cross_scope' })), /must belong to its adventure/)
  assert.throws(() => store.writeApprovedProposalMetadata(metadata({ proposalType: 'location' })), /types must match/)
  assert.throws(() => store.writeApprovedProposalMetadata(metadata({ evidence: [] })), /one to three evidence references/)
  assert.throws(() => store.writeApprovedProposalMetadata(metadata({ previewId: 'B'.repeat(43) })), /UNIQUE/)
  assert.equal(store.hasApprovalIdentity('B'.repeat(43), 'npc_sable'), false)

  const manualLocation = adventureStore.createLocation('legacy-adventure', { name: 'Manual Addition', description: '', locationType: 'Test', dmNotes: '' })
  const manualNpc = adventureStore.saveNpc('legacy-adventure', null, { name: 'Manual NPC', description: '', personality: '', disposition: 'Neutral', currentLocationId: manualLocation.id, dmNotes: '' })
  const manualQuest = adventureStore.saveQuest('legacy-adventure', null, { title: 'Manual Quest', description: '', status: 'available' })
  assert.equal(store.getApprovedProposalMetadata('legacy-adventure', 'location', String(manualLocation.id)), null)
  assert.equal(store.getApprovedProposalMetadata('legacy-adventure', 'npc', String(manualNpc.id)), null)
  assert.equal(store.getApprovedProposalMetadata('legacy-adventure', 'quest', String(manualQuest.id)), null)

  const before = Number(database.prepare('SELECT COUNT(*) AS count FROM adventure_locations').get().count)
  database.exec("CREATE TRIGGER fail_approval_metadata BEFORE INSERT ON adventure_world_expansion_approvals BEGIN SELECT RAISE(ABORT,'injected metadata failure'); END")
  database.exec('BEGIN IMMEDIATE')
  try {
    adventureStore.createLocation('legacy-adventure', { name: 'Transactional Location', description: '', locationType: 'Test', dmNotes: '' })
    assert.throws(() => store.writeApprovedProposalMetadata(metadata({ entityType: 'location', proposalType: 'location', entityId: 'legacy-location', proposalKey: 'location_roll_back' })), /injected metadata failure/)
  } finally { database.exec('ROLLBACK') }
  database.exec('DROP TRIGGER fail_approval_metadata')
  assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM adventure_locations').get().count), before)
  assert.equal(database.prepare("SELECT 1 FROM adventure_locations WHERE name='Transactional Location'").get(), undefined)

  const repeatedInit = spawnSync(process.execPath, ['-r', 'tsx/cjs', '-e', "require('./src/database.ts').close()"], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, REALMFORGE_DATA_DIR: dataDir }, encoding: 'utf8',
  })
  assert.equal(repeatedInit.status, 0, repeatedInit.stderr)
  const reopened = new DatabaseSync(dbPath, { readOnly: true })
  assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM adventure_world_expansion_approvals').get().count, 3)
  reopened.close()
})
