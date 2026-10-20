const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const test = require('node:test')
const assert = require('node:assert/strict')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realmforge-identity-journal-'))
const databasePath = path.join(dataDir, 'realmforge.sqlite')
const legacy = new DatabaseSync(databasePath)
legacy.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE campaigns(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,setting TEXT NOT NULL,createdAt TEXT NOT NULL);
  CREATE TABLE players(id TEXT PRIMARY KEY,displayName TEXT NOT NULL,createdAt TEXT NOT NULL);
  CREATE TABLE campaign_memberships(id TEXT PRIMARY KEY,campaignId TEXT NOT NULL REFERENCES campaigns(id),playerId TEXT NOT NULL REFERENCES players(id),displayName TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(campaignId,playerId));
  CREATE TABLE characters(id TEXT PRIMARY KEY,membershipId TEXT NOT NULL REFERENCES campaign_memberships(id),name TEXT NOT NULL,species TEXT NOT NULL,characterClass TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
`)
legacy.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?)').run('legacy-campaign', 'Old Campaign', '', '', '2024-01-01T00:00:00.000Z')
legacy.prepare('INSERT INTO players VALUES(?,?,?)').run('legacy-player', 'Old Player', '2024-01-02T00:00:00.000Z')
legacy.prepare('INSERT INTO campaign_memberships VALUES(?,?,?,?,?)').run('legacy-membership', 'legacy-campaign', 'legacy-player', 'Old Player', '2024-01-02T00:00:00.000Z')
legacy.prepare('INSERT INTO characters VALUES(?,?,?,?,?,?,?,?)').run('legacy-character', 'legacy-membership', 'Legacy Hero', 'Human', 'Ranger', 'active', '2024-01-03T00:00:00.000Z', '2024-01-03T00:00:00.000Z')
legacy.close()
process.env.REALMFORGE_DATA_DIR = dataDir
require('tsx/cjs')
const db = require('../src/database.ts')
const identity = require('../src/identityJournalStore.ts')
const characterStore = require('../src/playerCharacterStore.ts')
const HttpError = require('../src/httpError.ts')
const now = '2025-02-01T00:00:00.000Z'
const newCampaign = (id, name) => db.prepare('INSERT INTO campaigns(id,name,description,setting,createdAt) VALUES(?,?,?,?,?)').run(id, name, '', '', now)
const expectStatus = (operation, status) => assert.throws(operation, (error) => error instanceof HttpError && error.status === status)

test('additive identity, membership, ownership, and journal services preserve legacy data and enforce scope', (t) => {
  t.after(() => { try { db.close() } catch {} fs.rmSync(dataDir, { recursive: true, force: true }) })

  const migratedPlayer = db.prepare('SELECT status,updatedAt FROM players WHERE id=?').get('legacy-player')
  assert.deepEqual({ ...migratedPlayer }, { status: 'active', updatedAt: '2024-01-02T00:00:00.000Z' })
  assert.deepEqual({ ...db.prepare('SELECT role,status,joinedAt FROM campaign_memberships WHERE id=?').get('legacy-membership') }, {
    role: 'player', status: 'active', joinedAt: '2024-01-02T00:00:00.000Z',
  })
  assert.equal(db.prepare('SELECT name FROM characters WHERE id=?').get('legacy-character').name, 'Legacy Hero')
  assert.equal(identity.getCharacterOwner('legacy-character'), null)
  assert.equal(identity.listUnassignedCharacters('legacy-campaign').length, 1)

  expectStatus(() => identity.createPlayerIdentity('   '), 400)
  const player = identity.createPlayerIdentity('Sable')
  assert.equal(player.status, 'active')
  const renamed = identity.updatePlayerDisplayName(player.id, 'Sable Vale')
  assert.equal(renamed.displayName, 'Sable Vale')
  identity.setPlayerStatus(player.id, 'inactive')
  assert.equal(identity.listPlayerIdentities().find((item) => item.id === player.id).status, 'inactive')
  expectStatus(() => identity.setPlayerStatus(player.id, 'sleeping'), 400)
  identity.setPlayerStatus(player.id, 'active')

  newCampaign('second-campaign', 'Second Campaign')
  const shared = identity.createMembership('legacy-campaign', player.id, 'player', 'active')
  assert.equal(shared.status, 'active')
  assert.equal(identity.createMembership('second-campaign', player.id).campaignId, 'second-campaign')
  expectStatus(() => identity.createMembership('legacy-campaign', player.id), 409)
  const dm = identity.createPlayerIdentity('Dungeon Master')
  identity.createMembership('legacy-campaign', dm.id, 'dm', 'active')
  const outsider = identity.createPlayerIdentity('Outsider')
  const outsiderMembership = identity.createMembership('second-campaign', outsider.id, 'player', 'active')
  expectStatus(() => identity.updatePlayerDisplayName(outsider.id, 'Sable Vale'), 409)
  expectStatus(() => identity.createMembership('no-campaign', dm.id), 404)
  const inactive = identity.createMembership('legacy-campaign', identity.createPlayerIdentity('Invitee').id, 'player', 'invited')
  assert.equal(identity.updateMembership('legacy-campaign', inactive.playerId, 'player', 'active').status, 'active')
  assert.equal(identity.updateMembership('legacy-campaign', player.id, 'player', 'inactive').status, 'inactive')
  expectStatus(() => identity.listCampaignMemberships('legacy-campaign', player.id), 403)
  identity.updateMembership('legacy-campaign', player.id, 'player', 'active')

  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
  const hero = characterStore.createCharacter('legacy-campaign', player.id, {
    name: 'Sable One', species: 'Elf', characterClass: 'Rogue', level: 1, abilityScores: scores, status: 'prepared',
  })
  const heroTwo = characterStore.createCharacter('legacy-campaign', player.id, {
    name: 'Sable Two', species: 'Human', characterClass: 'Bard', level: 1, abilityScores: scores, status: 'prepared',
  })
  assert.equal(identity.getCharacterOwner(hero.id), null)
  expectStatus(() => identity.assignCharacterOwner(hero.id, player.id, player.id), 403)
  expectStatus(() => identity.assignCharacterOwner(hero.id, player.id, 'missing-player'), 403)
  expectStatus(() => identity.assignCharacterOwner(hero.id, outsider.id, dm.id), 403)
  assert.throws(() => db.prepare('INSERT INTO character_ownership(characterId,membershipId,assignedAt,assignedByPlayerId) VALUES(?,?,?,?)').run(hero.id, outsiderMembership.id, now, dm.id), /Character owner and assigning DM must belong to the character campaign/)
  identity.assignCharacterOwner(hero.id, player.id, dm.id)
  identity.assignCharacterOwner(heroTwo.id, player.id, dm.id)
  assert.equal(identity.getCharacterOwner(hero.id).playerId, player.id)
  assert.equal(identity.getCharacterOwner(heroTwo.id).playerId, player.id)
  assert.equal(identity.listUnassignedCharacters('legacy-campaign').some((item) => item.id === 'legacy-character'), true)

  const privateEntry = identity.createCharacterJournalEntry(player.id, hero.id, 'A hidden thought', 'I do not trust the magistrate.')
  const remainsPrivate = identity.createCharacterJournalEntry(player.id, hero.id, 'Another thought', 'This stays between me and my journal.')
  assert.equal(privateEntry.visibility, 'private')
  assert.equal(identity.listCharacterJournalEntries(player.id, hero.id).length, 2)
  assert.equal(identity.listPartySharedCharacterJournalEntries(dm.id, hero.id).length, 0)
  expectStatus(() => identity.listCharacterJournalEntries(dm.id, hero.id), 403)
  expectStatus(() => identity.setJournalVisibility(dm.id, privateEntry.id, 'party'), 403)
  expectStatus(() => identity.promoteJournalEntry(player.id, privateEntry.id), 409)
  identity.setJournalVisibility(player.id, privateEntry.id, 'party')
  assert.equal(identity.listCharacterJournalEntries(player.id, hero.id).find((entry) => entry.id === privateEntry.id).visibility, 'party')
  assert.equal(identity.listPartySharedCharacterJournalEntries(dm.id, hero.id).length, 1)
  assert.equal(identity.listPartySharedCharacterJournalEntries(dm.id, hero.id)[0].id, privateEntry.id)
  assert.equal(identity.listCharacterJournalEntries(player.id, hero.id).find((entry) => entry.id === remainsPrivate.id).visibility, 'private')
  const promoted = identity.promoteJournalEntry(player.id, privateEntry.id)
  assert.equal(promoted.replayed, false)
  assert.equal(promoted.entry.sourceCharacterEntryId, privateEntry.id)
  assert.equal(promoted.entry.campaignId, 'legacy-campaign')
  assert.equal(promoted.entry.authorPlayerId, player.id)
  assert.equal(identity.promoteJournalEntry(player.id, privateEntry.id).replayed, true)
  assert.equal(identity.listCampaignLog('legacy-campaign', dm.id).length, 1)
  expectStatus(() => identity.listCampaignLog('second-campaign', dm.id), 403)
  expectStatus(() => identity.createCampaignLogEntry('missing-player', 'legacy-campaign', 'Leak', 'No access'), 403)
  expectStatus(() => identity.createCharacterJournalEntry(player.id, 'legacy-character', 'Legacy note', 'No assigned owner'), 403)

  // Restart against the same isolated database: migration is repeatable and records remain intact.
  db.close()
  const loader = require.resolve('tsx/cjs')
  const restart = spawnSync(process.execPath, ['-r', loader, '-e', "const db=require('./src/database.ts'); const result=db.prepare('PRAGMA integrity_check').get(); if(result.integrity_check!=='ok') process.exitCode=1; db.close()"], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, REALMFORGE_DATA_DIR: dataDir }, encoding: 'utf8',
  })
  assert.equal(restart.status, 0, restart.stderr || restart.stdout)
  const persisted = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal(persisted.prepare('SELECT count(*) AS count FROM campaigns').get().count, 2)
  assert.equal(persisted.prepare('SELECT count(*) AS count FROM character_ownership').get().count, 2)
  assert.equal(persisted.prepare('SELECT count(*) AS count FROM campaign_log_entries').get().count, 1)
  assert.deepEqual({ ...persisted.prepare('SELECT displayName,status FROM players WHERE id=?').get(player.id) }, { displayName: 'Sable Vale', status: 'active' })
  assert.equal(persisted.prepare('SELECT visibility FROM character_journal_entries WHERE id=?').get(privateEntry.id).visibility, 'party')
  assert.equal(persisted.prepare('SELECT visibility FROM character_journal_entries WHERE id=?').get(remainsPrivate.id).visibility, 'private')
  assert.equal(persisted.prepare('SELECT name FROM characters WHERE id=?').get('legacy-character').name, 'Legacy Hero')
  assert.equal(persisted.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  persisted.close()
})
