import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import spellRules = require('./spellRules')
type SpellDefinition = spellRules.SpellDefinition
type SpellAbility = spellRules.SpellAbility

// Keep the locally authored, versioned starter catalog addressable by the same
// foreign key used for user-created spells and spellbook membership.
for (const spell of spellRules.STARTER_SPELLS) {
  database.prepare(`INSERT OR IGNORE INTO character_spells(id, ownerCharacterId, name, level, school, castingTime, castingTimeCategory, rangeText, components, materialDetails, duration, concentration, ritual, description, sourceVersion, createdAt)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(spell.id, spell.name, spell.level, spell.school, spell.castingTime, spell.castingTimeCategory ?? 'special', spell.range, spell.components.join(','), spell.materialDetails, spell.duration, Number(spell.concentration), Number(spell.ritual), spell.description, spell.sourceVersion, '2024-01-01T00:00:00.000Z')
}

namespace spellStore {
  export interface SpellcastingConfig { enabled: boolean; ability: SpellAbility | null; notes: string; spellAttackBonus: number | null; spellSaveDc: number | null; warning: string | null }
  export interface SpellSlot { level: number; maximum: number; remaining: number; expended: number }
  export interface SpellbookEntry extends SpellDefinition { prepared: boolean; alwaysPrepared: boolean; addedAt: string }

  function transaction<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE')
    try { const result = operation(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }

  function requireCharacter(campaignId: string, playerId: string, characterId: string): Record<string, unknown> {
    const row = database.prepare(`SELECT c.id, c.level, c.int, c.wis, c.cha FROM characters c
      JOIN campaign_memberships m ON m.id = c.membershipId WHERE c.id = ? AND m.campaignId = ? AND m.playerId = ?`).get(characterId, campaignId, playerId)
    if (!row) throw new HttpError(404, 'Character not found for this player and campaign.')
    return row as Record<string, unknown>
  }

  function config(character: Record<string, unknown>): SpellcastingConfig {
    const row = database.prepare('SELECT enabled, ability, notes FROM character_spellcasting WHERE characterId = ?').get(String(character.id)) as { enabled: number; ability: SpellAbility | null; notes: string } | undefined
    const enabled = Boolean(row?.enabled)
    const ability = row?.ability ?? null
    const warning = enabled && !ability ? 'Choose a spellcasting ability to calculate spell attack bonus and save DC.' : !enabled ? 'Spellcasting is disabled for this character.' : null
    const abilityScore = ability ? Number(character[ability]) : null
    const prof = Math.floor((Number(character.level) - 1) / 4) + 2
    const abilityMod = abilityScore === null ? null : Math.floor((abilityScore - 10) / 2)
    return { enabled, ability, notes: row?.notes ?? '', spellAttackBonus: enabled && abilityMod !== null ? abilityMod + prof : null, spellSaveDc: enabled && abilityMod !== null ? 8 + abilityMod + prof : null, warning }
  }

  function fromDb(row: Record<string, unknown>): SpellDefinition {
    return { id: String(row.id), name: String(row.name), level: Number(row.level), school: String(row.school), castingTime: String(row.castingTime), castingTimeCategory: (row.castingTimeCategory ?? 'special') as spellRules.CastingTimeCategory, range: String(row.rangeText), components: String(row.components).split(',').filter(Boolean), materialDetails: String(row.materialDetails), duration: String(row.duration), concentration: Boolean(row.concentration), ritual: Boolean(row.ritual), description: String(row.description), sourceVersion: String(row.sourceVersion), resolutionType: (row.resolutionType ?? 'none') as spellRules.SpellResolutionType, savingThrowAbility: (row.savingThrowAbility ?? null) as spellRules.AbilityKey | null, attackType: (row.attackType ?? null) as spellRules.SpellAttackType | null, targetGuidance: String(row.targetGuidance ?? ''), resolutionNotes: String(row.resolutionNotes ?? ''), effectType: (row.effectType ?? 'none') as spellRules.SpellEffectType, effectFormula: String(row.effectFormula ?? ''), damageType: (row.damageType ?? null) as string | null, effectModifier: Number(row.effectModifier ?? 0), includeSpellcastingModifier: Boolean(row.includeSpellcastingModifier), saveSuccessEffect: (row.saveSuccessEffect ?? null) as spellRules.SaveSuccessEffect | null, upcastMode: (row.upcastMode ?? 'none') as spellRules.UpcastMode, upcastDiceCount: Number(row.upcastDiceCount ?? 0), upcastDieSize: (row.upcastDieSize ?? null) as number | null, upcastModifier: Number(row.upcastModifier ?? 0), effectNotes: String(row.effectNotes ?? ''), ...(row.ownerCharacterId ? { custom: true } : {}) }
  }

  function library(characterId: string, query = '', level?: number, school = ''): SpellDefinition[] {
    const customRows = database.prepare('SELECT * FROM character_spells WHERE ownerCharacterId = ? ORDER BY name COLLATE NOCASE').all(characterId) as unknown as Record<string, unknown>[]
    return spellRules.filterSpells([...spellRules.STARTER_SPELLS, ...customRows.map(fromDb)], query, level, school)
  }

  export function listLibrary(campaignId: string, playerId: string, characterId: string, query = '', level?: number, school = ''): SpellDefinition[] {
    requireCharacter(campaignId, playerId, characterId)
    return library(characterId, query, level, school)
  }

  export function getSpellcasting(campaignId: string, playerId: string, characterId: string) {
    const character = requireCharacter(campaignId, playerId, characterId)
    const entries = database.prepare(`SELECT s.*, b.prepared, b.alwaysPrepared, b.addedAt FROM character_spellbook b
      JOIN character_spells s ON s.id = b.spellId WHERE b.characterId = ? ORDER BY s.level, s.name COLLATE NOCASE`).all(characterId) as unknown as Record<string, unknown>[]
    const slots = database.prepare('SELECT level, maximum, remaining FROM character_spell_slots WHERE characterId = ? ORDER BY level').all(characterId) as unknown as { level: number; maximum: number; remaining: number }[]
    return { config: config(character), spells: entries.map((row) => ({ ...fromDb(row), prepared: Boolean(row.prepared), alwaysPrepared: Boolean(row.alwaysPrepared), addedAt: String(row.addedAt) })), slots: slots.map((slot) => ({ ...slot, expended: slot.maximum - slot.remaining })) }
  }

  export function updateConfig(campaignId: string, playerId: string, characterId: string, input: { enabled: boolean; ability: SpellAbility | null; notes: string }): SpellcastingConfig {
    const character = requireCharacter(campaignId, playerId, characterId)
    database.prepare(`INSERT INTO character_spellcasting(characterId, enabled, ability, notes, updatedAt) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(characterId) DO UPDATE SET enabled = excluded.enabled, ability = excluded.ability, notes = excluded.notes, updatedAt = excluded.updatedAt`)
      .run(characterId, Number(input.enabled), input.ability, input.notes, new Date().toISOString())
    return config(character)
  }

  function findSpell(characterId: string, spellId: string): SpellDefinition {
    const staticSpell = spellRules.STARTER_SPELLS.find((spell) => spell.id === spellId)
    if (staticSpell) return staticSpell
    const row = database.prepare('SELECT * FROM character_spells WHERE id = ? AND ownerCharacterId = ?').get(spellId, characterId) as Record<string, unknown> | undefined
    if (!row) throw new HttpError(404, 'Spell not found in this character’s available spell library.')
    return fromDb(row)
  }

  export function addSpell(campaignId: string, playerId: string, characterId: string, spellId: string): SpellbookEntry {
    requireCharacter(campaignId, playerId, characterId)
    const spell = findSpell(characterId, spellId)
    const addedAt = new Date().toISOString()
    try { database.prepare('INSERT INTO character_spellbook(characterId, spellId, prepared, alwaysPrepared, addedAt) VALUES (?, ?, 0, 0, ?)').run(characterId, spellId, addedAt) }
    catch (error) {
      if ((error as Error).message.includes('UNIQUE')) throw new HttpError(409, 'This spell is already in the character’s spellbook.')
      throw error
    }
    return { ...spell, prepared: false, alwaysPrepared: false, addedAt }
  }

  export function createCustomSpell(campaignId: string, playerId: string, characterId: string, spell: Omit<SpellDefinition, 'id' | 'sourceVersion' | 'custom'>): SpellbookEntry {
    requireCharacter(campaignId, playerId, characterId)
    const id = `custom-${crypto.randomUUID()}`
    const addedAt = new Date().toISOString()
    transaction(() => {
      database.prepare(`INSERT INTO character_spells(id, ownerCharacterId, name, level, school, castingTime, castingTimeCategory, rangeText, components, materialDetails, duration, concentration, ritual, description, sourceVersion, resolutionType, savingThrowAbility, attackType, targetGuidance, resolutionNotes, effectType, effectFormula, damageType, effectModifier, includeSpellcastingModifier, saveSuccessEffect, upcastMode, upcastDiceCount, upcastDieSize, upcastModifier, effectNotes, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, characterId, spell.name, spell.level, spell.school, spell.castingTime, spell.castingTimeCategory ?? 'special', spell.range, spell.components.join(','), spell.materialDetails, spell.duration, Number(spell.concentration), Number(spell.ritual), spell.description, 'User-created', spell.resolutionType ?? 'none', spell.savingThrowAbility ?? null, spell.attackType ?? null, spell.targetGuidance ?? '', spell.resolutionNotes ?? '', spell.effectType ?? 'none', spell.effectFormula ?? '', spell.damageType ?? null, spell.effectModifier ?? 0, Number(spell.includeSpellcastingModifier ?? false), spell.saveSuccessEffect ?? null, spell.upcastMode ?? 'none', spell.upcastDiceCount ?? 0, spell.upcastDieSize ?? null, spell.upcastModifier ?? 0, spell.effectNotes ?? '', addedAt)
      database.prepare('INSERT INTO character_spellbook(characterId, spellId, prepared, alwaysPrepared, addedAt) VALUES (?, ?, 0, 0, ?)').run(characterId, id, addedAt)
    })
    return { ...spell, id, sourceVersion: 'User-created', custom: true, prepared: false, alwaysPrepared: false, addedAt }
  }

  export function setPreparation(campaignId: string, playerId: string, characterId: string, spellId: string, prepared: boolean): SpellbookEntry {
    requireCharacter(campaignId, playerId, characterId)
    findSpell(characterId, spellId)
    const result = database.prepare('UPDATE character_spellbook SET prepared = ? WHERE characterId = ? AND spellId = ?').run(Number(prepared), characterId, spellId)
    if (result.changes === 0) throw new HttpError(404, 'Spell is not in this character’s spellbook.')
    const entry = database.prepare(`SELECT s.*, b.prepared, b.alwaysPrepared, b.addedAt FROM character_spellbook b JOIN character_spells s ON s.id = b.spellId WHERE b.characterId = ? AND b.spellId = ?`).get(characterId, spellId) as Record<string, unknown>
    return { ...fromDb(entry), prepared: Boolean(entry.prepared), alwaysPrepared: Boolean(entry.alwaysPrepared), addedAt: String(entry.addedAt) }
  }

  export function removeSpell(campaignId: string, playerId: string, characterId: string, spellId: string): void {
    requireCharacter(campaignId, playerId, characterId)
    const spell = findSpell(characterId, spellId)
    const result = database.prepare('DELETE FROM character_spellbook WHERE characterId = ? AND spellId = ?').run(characterId, spellId)
    if (result.changes === 0) throw new HttpError(404, 'Spell is not in this character’s spellbook.')
    if (spell.custom) database.prepare('DELETE FROM character_spells WHERE id = ? AND ownerCharacterId = ?').run(spellId, characterId)
  }

  export function setSlot(campaignId: string, playerId: string, characterId: string, level: number, maximum: number, remaining: number) {
    requireCharacter(campaignId, playerId, characterId)
    database.prepare(`INSERT INTO character_spell_slots(characterId, level, maximum, remaining, updatedAt) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(characterId, level) DO UPDATE SET maximum = excluded.maximum, remaining = excluded.remaining, updatedAt = excluded.updatedAt`)
      .run(characterId, level, maximum, remaining, new Date().toISOString())
    return { level, maximum, remaining, expended: maximum - remaining }
  }

  export function changeSlot(campaignId: string, playerId: string, characterId: string, level: number, action: 'expend' | 'restore') {
    requireCharacter(campaignId, playerId, characterId)
    return transaction(() => {
      const slot = database.prepare('SELECT maximum, remaining FROM character_spell_slots WHERE characterId = ? AND level = ?').get(characterId, level) as { maximum: number; remaining: number } | undefined
      if (!slot || slot.maximum === 0) throw new HttpError(409, 'Configure at least one slot at this level first.')
      if (action === 'expend' && slot.remaining === 0) throw new HttpError(409, 'No remaining slots at this level.')
      if (action === 'restore' && slot.remaining === slot.maximum) throw new HttpError(409, 'All slots at this level are already available.')
      const remaining = slot.remaining + (action === 'restore' ? 1 : -1)
      database.prepare('UPDATE character_spell_slots SET remaining = ?, updatedAt = ? WHERE characterId = ? AND level = ?').run(remaining, new Date().toISOString(), characterId, level)
      return { level, maximum: slot.maximum, remaining, expended: slot.maximum - remaining }
    })
  }

  export function restoreAll(campaignId: string, playerId: string, characterId: string): SpellSlot[] {
    requireCharacter(campaignId, playerId, characterId)
    database.prepare('UPDATE character_spell_slots SET remaining = maximum, updatedAt = ? WHERE characterId = ?').run(new Date().toISOString(), characterId)
    return (database.prepare('SELECT level, maximum, remaining FROM character_spell_slots WHERE characterId = ? ORDER BY level').all(characterId) as unknown as { level: number; maximum: number; remaining: number }[]).map((slot) => ({ ...slot, expended: 0 }))
  }
}

export = spellStore
