import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')

namespace playerCharacterStore {
  export type CharacterStatus = 'active' | 'prepared' | 'dead' | 'retired'

  export interface CampaignPlayer {
    id: string
    playerId: string
    displayName: string
    createdAt: string
  }

  export interface AbilityScores {
    str: number
    dex: number
    con: number
    int: number
    wis: number
    cha: number
  }

  export interface NewCharacter {
    name: string
    species: string
    characterClass: string
    level: number
    abilityScores: AbilityScores
    status: 'active' | 'prepared'
  }

  export interface Character extends AbilityScores {
    id: string
    name: string
    species: string
    characterClass: string
    level: number
    status: CharacterStatus
    manualAcOverride: number | null
    createdAt: string
    updatedAt: string
  }

  export interface CharacterSheet extends Character {
    savingThrowProficiencies: string[]
    skillProficiencies: string[]
    weaponProficiencies: string[]
  }

  export interface CharacterSheetUpdate {
    level: number
    abilityScores: AbilityScores
    savingThrowProficiencies: string[]
    skillProficiencies: string[]
    weaponProficiencies?: string[]
    manualAcOverride?: number | null
  }

  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  function requireCampaign(campaignId: string): void {
    const row = database.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId)
    if (!row) throw new HttpError(404, 'Campaign not found.')
  }

  function requireMembership(campaignId: string, playerId: string): CampaignPlayer {
    const row = database.prepare(`
      SELECT id, playerId, displayName, createdAt
      FROM campaign_memberships
      WHERE campaignId = ? AND playerId = ?
    `).get(campaignId, playerId)
    if (!row) throw new HttpError(404, 'Player is not in this campaign.')
    return row as unknown as CampaignPlayer
  }

  function getCharacter(campaignId: string, playerId: string, characterId: string): Character {
    const row = database.prepare(`
      SELECT c.id, c.name, c.species, c.characterClass, c.level,
        c.str, c.dex, c.con, c.int, c.wis, c.cha, c.status, c.manualAcOverride, c.createdAt, c.updatedAt
      FROM characters c
      JOIN campaign_memberships m ON m.id = c.membershipId
      WHERE c.id = ? AND m.campaignId = ? AND m.playerId = ?
    `).get(characterId, campaignId, playerId)
    if (!row) throw new HttpError(404, 'Character not found for this player and campaign.')
    return row as unknown as Character
  }

  export function listPlayers(campaignId: string): CampaignPlayer[] {
    requireCampaign(campaignId)
    return database.prepare(`
      SELECT id, playerId, displayName, createdAt
      FROM campaign_memberships
      WHERE campaignId = ?
      ORDER BY createdAt ASC, rowid ASC
    `).all(campaignId) as unknown as CampaignPlayer[]
  }

  export function addPlayer(campaignId: string, displayName: string): CampaignPlayer {
    return transaction(() => {
      requireCampaign(campaignId)
      const duplicate = database.prepare(`
        SELECT 1 FROM campaign_memberships
        WHERE campaignId = ? AND displayName = ? COLLATE NOCASE
      `).get(campaignId, displayName)
      if (duplicate) throw new HttpError(409, 'A player with this display name is already in the campaign.')

      const playerId = crypto.randomUUID()
      const membershipId = crypto.randomUUID()
      const createdAt = new Date().toISOString()

      database.prepare('INSERT INTO players (id, displayName, createdAt) VALUES (?, ?, ?)')
        .run(playerId, displayName, createdAt)
      database.prepare(`
        INSERT INTO campaign_memberships (id, campaignId, playerId, displayName, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `).run(membershipId, campaignId, playerId, displayName, createdAt)

      return { id: membershipId, playerId, displayName, createdAt }
    })
  }

  export function listCharacters(campaignId: string, playerId: string): Character[] {
    const membership = requireMembership(campaignId, playerId)
    return database.prepare(`
      SELECT id, name, species, characterClass, level, str, dex, con, int, wis, cha,
        status, manualAcOverride, createdAt, updatedAt
      FROM characters
      WHERE membershipId = ?
      ORDER BY createdAt DESC, rowid DESC
    `).all(membership.id) as unknown as Character[]
  }

  export function getCharacterSheet(campaignId: string, playerId: string, characterId: string): CharacterSheet {
    const character = getCharacter(campaignId, playerId, characterId)
    const rows = database.prepare(`
      SELECT kind, proficiencyKey FROM character_proficiencies WHERE characterId = ?
    `).all(characterId) as unknown as { kind: string; proficiencyKey: string }[]
    return {
      ...character,
      savingThrowProficiencies: rows.filter((row) => row.kind === 'saving_throw').map((row) => row.proficiencyKey),
      skillProficiencies: rows.filter((row) => row.kind === 'skill').map((row) => row.proficiencyKey),
      weaponProficiencies: (database.prepare('SELECT weaponDefinitionId FROM character_weapon_proficiencies WHERE characterId = ? ORDER BY weaponDefinitionId').all(characterId) as { weaponDefinitionId: string }[]).map((row) => row.weaponDefinitionId),
    }
  }

  export function updateCharacterSheet(campaignId: string, playerId: string, characterId: string, input: CharacterSheetUpdate): CharacterSheet {
    return transaction(() => {
      const existingCharacter = getCharacter(campaignId, playerId, characterId)
      const { abilityScores } = input
      database.prepare(`
        UPDATE characters SET level = ?, str = ?, dex = ?, con = ?, int = ?, wis = ?, cha = ?, manualAcOverride = ?, updatedAt = ?
        WHERE id = ?
      `).run(input.level, abilityScores.str, abilityScores.dex, abilityScores.con, abilityScores.int,
        abilityScores.wis, abilityScores.cha, input.manualAcOverride === undefined ? existingCharacter.manualAcOverride : input.manualAcOverride,
        new Date().toISOString(), characterId)
      database.prepare('DELETE FROM character_proficiencies WHERE characterId = ?').run(characterId)
      const insert = database.prepare(`
        INSERT INTO character_proficiencies (characterId, kind, proficiencyKey) VALUES (?, ?, ?)
      `)
      for (const key of input.savingThrowProficiencies) insert.run(characterId, 'saving_throw', key)
      for (const key of input.skillProficiencies) insert.run(characterId, 'skill', key)
      if (input.weaponProficiencies !== undefined) {
        database.prepare('DELETE FROM character_weapon_proficiencies WHERE characterId = ?').run(characterId)
        const insertWeapon = database.prepare('INSERT INTO character_weapon_proficiencies (characterId, weaponDefinitionId) VALUES (?, ?)')
        for (const key of input.weaponProficiencies) insertWeapon.run(characterId, key)
      }
      return getCharacterSheet(campaignId, playerId, characterId)
    })
  }

  export function createCharacter(campaignId: string, playerId: string, input: NewCharacter): Character {
    return transaction(() => {
      const membership = requireMembership(campaignId, playerId)
      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      const { abilityScores } = input

      if (input.status === 'active') {
        database.prepare("UPDATE characters SET status = 'prepared', updatedAt = ? WHERE membershipId = ? AND status = 'active'")
          .run(createdAt, membership.id)
      }

      database.prepare(`
        INSERT INTO characters (
          id, membershipId, name, species, characterClass, level,
          str, dex, con, int, wis, cha, status, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, membership.id, input.name, input.species, input.characterClass, input.level,
        abilityScores.str, abilityScores.dex, abilityScores.con,
        abilityScores.int, abilityScores.wis, abilityScores.cha,
        input.status, createdAt, createdAt,
      )

      return getCharacter(campaignId, playerId, id)
    })
  }

  export function activateCharacter(campaignId: string, playerId: string, characterId: string): Character {
    return transaction(() => {
      const membership = requireMembership(campaignId, playerId)
      const character = getCharacter(campaignId, playerId, characterId)
      if (character.status === 'dead' || character.status === 'retired') {
        throw new HttpError(409, `A ${character.status} character cannot be activated.`)
      }

      const now = new Date().toISOString()
      database.prepare("UPDATE characters SET status = 'prepared', updatedAt = ? WHERE membershipId = ? AND status = 'active' AND id != ?")
        .run(now, membership.id, characterId)
      database.prepare("UPDATE characters SET status = 'active', updatedAt = ? WHERE id = ?")
        .run(now, characterId)

      return getCharacter(campaignId, playerId, characterId)
    })
  }

  export function markCharacterDead(campaignId: string, playerId: string, characterId: string): Character {
    return transaction(() => {
      const character = getCharacter(campaignId, playerId, characterId)
      if (character.status === 'retired') throw new HttpError(409, 'A retired character cannot be marked dead.')
      if (character.status !== 'dead') {
        database.prepare("UPDATE characters SET status = 'dead', updatedAt = ? WHERE id = ?")
          .run(new Date().toISOString(), characterId)
      }
      return getCharacter(campaignId, playerId, characterId)
    })
  }

  export function retireCharacter(campaignId: string, playerId: string, characterId: string): Character {
    return transaction(() => {
      const character = getCharacter(campaignId, playerId, characterId)
      if (character.status === 'dead') throw new HttpError(409, 'A dead character cannot be retired.')
      if (character.status !== 'retired') {
        database.prepare("UPDATE characters SET status = 'retired', updatedAt = ? WHERE id = ?")
          .run(new Date().toISOString(), characterId)
      }
      return getCharacter(campaignId, playerId, characterId)
    })
  }
}

export = playerCharacterStore
