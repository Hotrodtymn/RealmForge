import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')

namespace identityJournalStore {
  export type PlayerStatus = 'active' | 'inactive'
  export type MembershipRole = 'dm' | 'player'
  export type MembershipStatus = 'invited' | 'active' | 'inactive' | 'removed'
  export type JournalVisibility = 'private' | 'party'
  export type CampaignLogType = 'session_recap' | 'discovery' | 'quest_update' | 'npc_information' | 'location_information' | 'player_contribution' | 'general_note'
  type Row = Record<string, unknown>

  export interface PlayerIdentity { id: string; displayName: string; status: PlayerStatus; createdAt: string; updatedAt: string }
  export interface CampaignMembership { id: string; campaignId: string; playerId: string; displayName: string; role: MembershipRole; status: MembershipStatus; joinedAt: string; createdAt: string }
  export interface JournalEntry { id: string; characterId: string; authorPlayerId: string; title: string; content: string; visibility: JournalVisibility; createdAt: string; updatedAt: string }
  export interface CampaignLogEntry { id: string; campaignId: string; authorPlayerId: string | null; title: string; content: string; entryType: CampaignLogType; sourceCharacterEntryId: string | null; createdAt: string; updatedAt: string }

  const now = () => new Date().toISOString()
  const id = () => crypto.randomUUID()
  const one = (sql: string, ...params: (string | number | null)[]) => database.prepare(sql).get(...params) as Row | undefined
  const many = (sql: string, ...params: (string | number | null)[]) => database.prepare(sql).all(...params) as unknown as Row[]
  const run = (sql: string, ...params: (string | number | null)[]) => database.prepare(sql).run(...params)
  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try { const result = operation(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }
  function text(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > max) {
      throw new HttpError(400, 'Validation failed', { [field]: `Enter between 1 and ${max} characters.` })
    }
    return value.trim()
  }
  function requirePlayer(playerId: string): PlayerIdentity {
    const player = one('SELECT id,displayName,status,createdAt,updatedAt FROM players WHERE id=?', playerId)
    if (!player) throw new HttpError(404, 'Player identity not found.')
    return player as unknown as PlayerIdentity
  }
  function requireCampaign(campaignId: string): void {
    if (!one('SELECT id FROM campaigns WHERE id=?', campaignId)) throw new HttpError(404, 'Campaign not found.')
  }
  function membership(campaignId: string, playerId: string): CampaignMembership {
    const result = one(`SELECT m.id,m.campaignId,m.playerId,m.displayName,m.role,m.status,m.joinedAt,m.createdAt
      FROM campaign_memberships m WHERE m.campaignId=? AND m.playerId=?`, campaignId, playerId)
    if (!result) throw new HttpError(404, 'Player is not a member of this campaign.')
    return result as unknown as CampaignMembership
  }
  function requireActiveMember(campaignId: string, playerId: string): CampaignMembership {
    const result = one(`SELECT m.id,m.campaignId,m.playerId,m.displayName,m.role,m.status,m.joinedAt,m.createdAt
      FROM campaign_memberships m JOIN players p ON p.id=m.playerId
      WHERE m.campaignId=? AND m.playerId=? AND m.status='active' AND p.status='active'`, campaignId, playerId)
    if (!result) throw new HttpError(403, 'An active campaign membership is required.')
    return result as unknown as CampaignMembership
  }
  function requireCharacter(characterId: string): { id: string; campaignId: string; legacyMembershipId: string } {
    const row = one(`SELECT c.id,m.campaignId,m.id AS legacyMembershipId FROM characters c
      JOIN campaign_memberships m ON m.id=c.membershipId WHERE c.id=?`, characterId)
    if (!row) throw new HttpError(404, 'Character not found.')
    return { id: String(row.id), campaignId: String(row.campaignId), legacyMembershipId: String(row.legacyMembershipId) }
  }
  function requireOwnedCharacter(characterId: string, playerId: string): { id: string; campaignId: string } {
    const row = one(`SELECT c.id,campaign.campaignId FROM character_ownership o
      JOIN campaign_memberships owner ON owner.id=o.membershipId
      JOIN characters c ON c.id=o.characterId
      JOIN campaign_memberships campaign ON campaign.id=c.membershipId
      WHERE c.id=? AND owner.playerId=? AND owner.status='active' AND campaign.campaignId=owner.campaignId`, characterId, playerId)
    if (!row) throw new HttpError(403, 'This player does not own the character.')
    requireActiveMember(String(row.campaignId), playerId)
    return { id: String(row.id), campaignId: String(row.campaignId) }
  }
  function identityRow(playerId: string): PlayerIdentity { return requirePlayer(playerId) }
  function journalRow(entryId: string): JournalEntry {
    const row = one('SELECT id,characterId,authorPlayerId,title,content,visibility,createdAt,updatedAt FROM character_journal_entries WHERE id=?', entryId)
    if (!row) throw new HttpError(404, 'Character journal entry not found.')
    return row as unknown as JournalEntry
  }
  function campaignLogRow(entryId: string): CampaignLogEntry {
    const row = one('SELECT id,campaignId,authorPlayerId,title,content,entryType,sourceCharacterEntryId,createdAt,updatedAt FROM campaign_log_entries WHERE id=?', entryId)
    if (!row) throw new HttpError(404, 'Campaign Log entry not found.')
    return row as unknown as CampaignLogEntry
  }

  // These operations intentionally remain internal until authenticated request context exists.
  export function createPlayerIdentity(displayNameInput: unknown): PlayerIdentity {
    const displayName = text(displayNameInput, 'displayName', 80)
    const timestamp = now(); const playerId = id()
    run('INSERT INTO players(id,displayName,status,createdAt,updatedAt) VALUES(?,?,\'active\',?,?)', playerId, displayName, timestamp, timestamp)
    return identityRow(playerId)
  }
  export function updatePlayerDisplayName(playerId: string, displayNameInput: unknown): PlayerIdentity {
    const displayName = text(displayNameInput, 'displayName', 80)
    requirePlayer(playerId)
    const conflict = one(`SELECT 1 FROM campaign_memberships target
      WHERE target.playerId<>? AND target.displayName=? COLLATE NOCASE
        AND EXISTS (SELECT 1 FROM campaign_memberships own WHERE own.playerId=? AND own.campaignId=target.campaignId)`, playerId, displayName, playerId)
    if (conflict) throw new HttpError(409, 'That display name is already used by another member of one of this player’s campaigns.')
    const timestamp = now()
    transaction(() => {
      run('UPDATE players SET displayName=?,updatedAt=? WHERE id=?', displayName, timestamp, playerId)
      run('UPDATE campaign_memberships SET displayName=? WHERE playerId=?', displayName, playerId)
    })
    return identityRow(playerId)
  }
  export function setPlayerStatus(playerId: string, status: PlayerStatus): PlayerIdentity {
    if (status !== 'active' && status !== 'inactive') throw new HttpError(400, 'Player status must be active or inactive.')
    requirePlayer(playerId)
    run('UPDATE players SET status=?,updatedAt=? WHERE id=?', status, now(), playerId)
    return identityRow(playerId)
  }
  export function listPlayerIdentities(): PlayerIdentity[] {
    return many('SELECT id,displayName,status,createdAt,updatedAt FROM players ORDER BY createdAt,rowid').map((row) => row as unknown as PlayerIdentity)
  }
  export function createMembership(campaignId: string, playerId: string, role: MembershipRole = 'player', status: MembershipStatus = 'active'): CampaignMembership {
    if (role !== 'dm' && role !== 'player') throw new HttpError(400, 'Membership role must be dm or player.')
    if (!['invited', 'active', 'inactive', 'removed'].includes(status)) throw new HttpError(400, 'Invalid membership status.')
    requireCampaign(campaignId); const player = requirePlayer(playerId)
    if (status === 'active' && player.status !== 'active') throw new HttpError(409, 'An inactive player cannot join as an active member.')
    if (one('SELECT id FROM campaign_memberships WHERE campaignId=? AND playerId=?', campaignId, playerId)) throw new HttpError(409, 'This player already has a membership record in the campaign.')
    const membershipId = id(); const timestamp = now(); const joinedAt = status === 'active' ? timestamp : ''
    run(`INSERT INTO campaign_memberships(id,campaignId,playerId,displayName,role,status,joinedAt,createdAt)
      VALUES(?,?,?,?,?,?,?,?)`, membershipId, campaignId, playerId, player.displayName, role, status, joinedAt, timestamp)
    return membership(campaignId, playerId)
  }
  export function updateMembership(campaignId: string, playerId: string, role: MembershipRole, status: MembershipStatus): CampaignMembership {
    if (role !== 'dm' && role !== 'player') throw new HttpError(400, 'Membership role must be dm or player.')
    if (!['invited', 'active', 'inactive', 'removed'].includes(status)) throw new HttpError(400, 'Invalid membership status.')
    const current = membership(campaignId, playerId); const player = requirePlayer(playerId)
    if (status === 'active' && player.status !== 'active') throw new HttpError(409, 'An inactive player cannot have an active membership.')
    run('UPDATE campaign_memberships SET role=?,status=?,joinedAt=CASE WHEN ?=\'active\' AND joinedAt=\'\' THEN ? ELSE joinedAt END WHERE id=?', role, status, status, now(), current.id)
    return membership(campaignId, playerId)
  }
  export function listCampaignMemberships(campaignId: string, actorPlayerId: string): CampaignMembership[] {
    requireActiveMember(campaignId, actorPlayerId)
    return many(`SELECT id,campaignId,playerId,displayName,role,status,joinedAt,createdAt
      FROM campaign_memberships WHERE campaignId=? ORDER BY createdAt,rowid`, campaignId).map((row) => row as unknown as CampaignMembership)
  }
  export function assignCharacterOwner(characterId: string, ownerPlayerId: string, actorPlayerId: string): void {
    const character = requireCharacter(characterId)
    const actor = requireActiveMember(character.campaignId, actorPlayerId)
    if (actor.role !== 'dm') throw new HttpError(403, 'Only a Dungeon Master may assign character ownership.')
    const owner = requireActiveMember(character.campaignId, ownerPlayerId)
    const existing = one('SELECT membershipId FROM character_ownership WHERE characterId=?', characterId)
    if (existing && String(existing.membershipId) !== owner.id) throw new HttpError(409, 'This character already has a different owner.')
    if (existing) return
    run('INSERT INTO character_ownership(characterId,membershipId,assignedAt,assignedByPlayerId) VALUES(?,?,?,?)', characterId, owner.id, now(), actorPlayerId)
  }
  export function unassignCharacterOwner(characterId: string, actorPlayerId: string): void {
    const character = requireCharacter(characterId)
    const actor = requireActiveMember(character.campaignId, actorPlayerId)
    if (actor.role !== 'dm') throw new HttpError(403, 'Only a Dungeon Master may change character ownership.')
    run('DELETE FROM character_ownership WHERE characterId=?', characterId)
  }
  export function getCharacterOwner(characterId: string): { playerId: string; displayName: string; assignedAt: string } | null {
    requireCharacter(characterId)
    const row = one(`SELECT p.id AS playerId,p.displayName,o.assignedAt FROM character_ownership o
      JOIN campaign_memberships m ON m.id=o.membershipId JOIN players p ON p.id=m.playerId WHERE o.characterId=?`, characterId)
    return row ? row as { playerId: string; displayName: string; assignedAt: string } : null
  }
  export function listUnassignedCharacters(campaignId: string): { id: string; name: string; campaignId: string }[] {
    requireCampaign(campaignId)
    return many(`SELECT c.id,c.name,m.campaignId FROM characters c
      JOIN campaign_memberships m ON m.id=c.membershipId
      LEFT JOIN character_ownership o ON o.characterId=c.id
      WHERE m.campaignId=? AND o.characterId IS NULL ORDER BY c.createdAt,c.rowid`, campaignId) as unknown as { id: string; name: string; campaignId: string }[]
  }
  export function createCharacterJournalEntry(actorPlayerId: string, characterId: string, titleInput: unknown, contentInput: unknown): JournalEntry {
    const title = text(titleInput, 'title', 160); const content = text(contentInput, 'content', 12000)
    requireOwnedCharacter(characterId, actorPlayerId)
    const entryId = id(); const timestamp = now()
    run(`INSERT INTO character_journal_entries(id,characterId,authorPlayerId,title,content,visibility,createdAt,updatedAt)
      VALUES(?,?,?,?,?,'private',?,?)`, entryId, characterId, actorPlayerId, title, content, timestamp, timestamp)
    return journalRow(entryId)
  }
  export function listCharacterJournalEntries(actorPlayerId: string, characterId: string): JournalEntry[] {
    requireOwnedCharacter(characterId, actorPlayerId)
    return many(`SELECT id,characterId,authorPlayerId,title,content,visibility,createdAt,updatedAt
      FROM character_journal_entries WHERE characterId=? ORDER BY createdAt DESC,rowid DESC`, characterId).map((row) => row as unknown as JournalEntry)
  }
  export function listPartySharedCharacterJournalEntries(actorPlayerId: string, characterId: string): JournalEntry[] {
    const character = requireCharacter(characterId)
    requireActiveMember(character.campaignId, actorPlayerId)
    return many(`SELECT id,characterId,authorPlayerId,title,content,visibility,createdAt,updatedAt
      FROM character_journal_entries WHERE characterId=? AND visibility='party' ORDER BY createdAt DESC,rowid DESC`, characterId).map((row) => row as unknown as JournalEntry)
  }
  export function updateCharacterJournalEntry(actorPlayerId: string, entryId: string, titleInput: unknown, contentInput: unknown): JournalEntry {
    const entry = journalRow(entryId); requireOwnedCharacter(entry.characterId, actorPlayerId)
    const title = text(titleInput, 'title', 160); const content = text(contentInput, 'content', 12000)
    run('UPDATE character_journal_entries SET title=?,content=?,updatedAt=? WHERE id=?', title, content, now(), entryId)
    return journalRow(entryId)
  }
  export function setJournalVisibility(actorPlayerId: string, entryId: string, visibility: JournalVisibility): JournalEntry {
    const entry = journalRow(entryId); requireOwnedCharacter(entry.characterId, actorPlayerId)
    if (visibility !== 'private' && visibility !== 'party') throw new HttpError(400, 'Visibility must be private or party.')
    run('UPDATE character_journal_entries SET visibility=?,updatedAt=? WHERE id=?', visibility, now(), entryId)
    return journalRow(entryId)
  }
  export function createCampaignLogEntry(actorPlayerId: string, campaignId: string, titleInput: unknown, contentInput: unknown, entryType: CampaignLogType = 'general_note'): CampaignLogEntry {
    const title = text(titleInput, 'title', 160); const content = text(contentInput, 'content', 12000)
    const allowed: CampaignLogType[] = ['session_recap','discovery','quest_update','npc_information','location_information','player_contribution','general_note']
    if (!allowed.includes(entryType)) throw new HttpError(400, 'Invalid Campaign Log entry type.')
    requireActiveMember(campaignId, actorPlayerId)
    const entryId = id(); const timestamp = now()
    run(`INSERT INTO campaign_log_entries(id,campaignId,authorPlayerId,title,content,entryType,sourceCharacterEntryId,createdAt,updatedAt)
      VALUES(?,?,?,?,?,?,NULL,?,?)`, entryId, campaignId, actorPlayerId, title, content, entryType, timestamp, timestamp)
    return campaignLogRow(entryId)
  }
  export function listCampaignLog(campaignId: string, actorPlayerId: string): CampaignLogEntry[] {
    requireActiveMember(campaignId, actorPlayerId)
    return many(`SELECT id,campaignId,authorPlayerId,title,content,entryType,sourceCharacterEntryId,createdAt,updatedAt
      FROM campaign_log_entries WHERE campaignId=? ORDER BY createdAt DESC,rowid DESC`, campaignId).map((row) => row as unknown as CampaignLogEntry)
  }
  export function promoteJournalEntry(actorPlayerId: string, entryId: string, entryType: CampaignLogType = 'player_contribution'): { entry: CampaignLogEntry; replayed: boolean } {
    const journal = journalRow(entryId); const character = requireOwnedCharacter(journal.characterId, actorPlayerId)
    const allowed: CampaignLogType[] = ['session_recap','discovery','quest_update','npc_information','location_information','player_contribution','general_note']
    if (!allowed.includes(entryType)) throw new HttpError(400, 'Invalid Campaign Log entry type.')
    const current = one('SELECT id,campaignId FROM campaign_log_entries WHERE sourceCharacterEntryId=?', entryId)
    if (current) {
      if (String(current.campaignId) !== character.campaignId) throw new HttpError(409, 'This journal entry was already promoted to another campaign.')
      return { entry: campaignLogRow(String(current.id)), replayed: true }
    }
    if (journal.visibility !== 'party') throw new HttpError(409, 'Share this journal entry with the party before adding it to the Campaign Log.')
    return transaction(() => {
      const raced = one('SELECT id,campaignId FROM campaign_log_entries WHERE sourceCharacterEntryId=?', entryId)
      if (raced) {
        if (String(raced.campaignId) !== character.campaignId) throw new HttpError(409, 'This journal entry was already promoted to another campaign.')
        return { entry: campaignLogRow(String(raced.id)), replayed: true }
      }
      const entryIdNew = id(); const timestamp = now()
      run(`INSERT INTO campaign_log_entries(id,campaignId,authorPlayerId,title,content,entryType,sourceCharacterEntryId,createdAt,updatedAt)
        VALUES(?,?,?,?,?,?,?,?,?)`, entryIdNew, character.campaignId, actorPlayerId, journal.title, journal.content, entryType, entryId, journal.createdAt, timestamp)
      return { entry: campaignLogRow(entryIdNew), replayed: false }
    })
  }
}

export = identityJournalStore
