import express = require('express')
import playerCharacterStore = require('./playerCharacterStore')
import inventoryStore = require('./inventoryStore')

const router = express.Router()
const scoreNames = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
const skillNames = [
  'acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history', 'insight',
  'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance',
  'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival',
] as const
const textLimits = { name: 80, species: 60, characterClass: 60 }

function objectBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null
}

function validateText(value: unknown, label: string, limit: number, required: boolean, errors: Record<string, string>): string {
  if (typeof value !== 'string') {
    if (required || value !== undefined) errors[label] = 'Must be text.'
    return ''
  }
  const normalized = value.trim()
  const humanLabel = label === 'name' ? 'Character name' : label === 'displayName' ? 'Display name' : label
  if (required && normalized.length === 0) errors[label] = `${humanLabel} is required.`
  else if (normalized.length > limit) errors[label] = `Must be ${limit} characters or fewer.`
  return normalized
}

router.get('/:campaignId/players', (request, response, next) => {
  try {
    response.json({ players: playerCharacterStore.listPlayers(request.params.campaignId) })
  } catch (error) {
    next(error)
  }
})

router.post('/:campaignId/players', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) {
    response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } })
    return
  }

  const errors: Record<string, string> = {}
  const displayName = validateText(body.displayName, 'displayName', 80, true, errors)
  if (displayName.length === 0 && !errors.displayName) errors.displayName = 'Display name is required.'
  if (Object.keys(errors).length > 0) {
    response.status(400).json({ error: 'Validation failed', fields: errors })
    return
  }

  try {
    response.status(201).json({ player: playerCharacterStore.addPlayer(request.params.campaignId, displayName) })
  } catch (error) {
    next(error)
  }
})

router.get('/:campaignId/players/:playerId/characters', (request, response, next) => {
  try {
    response.json({ characters: playerCharacterStore.listCharacters(request.params.campaignId, request.params.playerId) })
  } catch (error) {
    next(error)
  }
})

router.post('/:campaignId/players/:playerId/characters', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) {
    response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } })
    return
  }

  const errors: Record<string, string> = {}
  const name = validateText(body.name, 'name', textLimits.name, true, errors)
  const species = validateText(body.species, 'species', textLimits.species, true, errors)
  const characterClass = validateText(body.class, 'class', textLimits.characterClass, true, errors)
  const rawLevel = body.level
  let level = 1
  if (rawLevel !== undefined && (!Number.isInteger(rawLevel) || (rawLevel as number) < 1 || (rawLevel as number) > 20)) {
    errors.level = 'Level must be a whole number from 1 to 20.'
  } else if (rawLevel !== undefined) {
    level = rawLevel as number
  }

  const rawScores = objectBody(body.abilityScores)
  const abilityScores: playerCharacterStore.AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
  if (!rawScores) {
    errors.abilityScores = 'Provide all six ability scores.'
  } else {
    for (const score of scoreNames) {
      const value = rawScores[score]
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 30) {
        errors[score] = 'Ability scores must be whole numbers from 1 to 30.'
      } else {
        abilityScores[score] = value as number
      }
    }
  }

  const requestedStatus = body.status
  let status: 'prepared' | 'active' = 'prepared'
  if (requestedStatus !== undefined) {
    if (requestedStatus !== 'prepared' && requestedStatus !== 'active') {
      errors.status = 'New characters may be prepared or active.'
    } else {
      status = requestedStatus
    }
  }

  if (Object.keys(errors).length > 0) {
    response.status(400).json({ error: 'Validation failed', fields: errors })
    return
  }

  const input: playerCharacterStore.NewCharacter = { name, species, characterClass, level, abilityScores, status }
  try {
    response.status(201).json({ character: playerCharacterStore.createCharacter(request.params.campaignId, request.params.playerId, input) })
  } catch (error) {
    next(error)
  }
})

router.get('/:campaignId/players/:playerId/characters/:characterId/sheet', (request, response, next) => {
  try {
    response.json({ sheet: playerCharacterStore.getCharacterSheet(
      request.params.campaignId, request.params.playerId, request.params.characterId,
    ) })
  } catch (error) {
    next(error)
  }
})

router.put('/:campaignId/players/:playerId/characters/:characterId/sheet', (request, response, next) => {
  const body = objectBody(request.body)
  if (!body) {
    response.status(400).json({ error: 'Validation failed', fields: { body: 'Expected a JSON object.' } })
    return
  }

  const errors: Record<string, string> = {}
  const rawLevel = body.level
  if (!Number.isInteger(rawLevel) || (rawLevel as number) < 1 || (rawLevel as number) > 20) {
    errors.level = 'Level must be a whole number from 1 to 20.'
  }
  const rawScores = objectBody(body.abilityScores)
  const abilityScores: playerCharacterStore.AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
  if (!rawScores) {
    errors.abilityScores = 'Provide all six ability scores.'
  } else {
    for (const score of scoreNames) {
      const value = rawScores[score]
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 30) {
        errors[score] = 'Ability scores must be whole numbers from 1 to 30.'
      } else {
        abilityScores[score] = value as number
      }
    }
  }

  function validateProficiencies(value: unknown, field: string, allowed: readonly string[]): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !allowed.includes(item))) {
      errors[field] = 'Choose only valid proficiencies.'
      return []
    }
    return [...new Set(value as string[])]
  }
  const savingThrowProficiencies = validateProficiencies(body.savingThrowProficiencies, 'savingThrowProficiencies', scoreNames)
  const skillProficiencies = validateProficiencies(body.skillProficiencies, 'skillProficiencies', skillNames)
  const weaponProficiencies = body.weaponProficiencies === undefined
    ? undefined
    : validateProficiencies(body.weaponProficiencies, 'weaponProficiencies', inventoryStore.weaponDefinitions)
  let manualAcOverride: number | null | undefined
  if (body.manualAcOverride === undefined) manualAcOverride = undefined
  else if (body.manualAcOverride === null || body.manualAcOverride === '') manualAcOverride = null
  else if (!Number.isInteger(body.manualAcOverride) || (body.manualAcOverride as number) < 1 || (body.manualAcOverride as number) > 50) {
    errors.manualAcOverride = 'Manual AC override must be a whole number from 1 to 50, or left blank.'
    manualAcOverride = null
  } else manualAcOverride = body.manualAcOverride as number

  if (Object.keys(errors).length > 0) {
    response.status(400).json({ error: 'Validation failed', fields: errors })
    return
  }
  try {
    response.json({ sheet: playerCharacterStore.updateCharacterSheet(
      request.params.campaignId,
      request.params.playerId,
      request.params.characterId,
      { level: rawLevel as number, abilityScores, savingThrowProficiencies, skillProficiencies,
        ...(weaponProficiencies === undefined ? {} : { weaponProficiencies }),
        ...(manualAcOverride === undefined ? {} : { manualAcOverride }),
      },
    ) })
  } catch (error) {
    next(error)
  }
})

router.post('/:campaignId/players/:playerId/characters/:characterId/activate', (request, response, next) => {
  try {
    response.json({ character: playerCharacterStore.activateCharacter(request.params.campaignId, request.params.playerId, request.params.characterId) })
  } catch (error) {
    next(error)
  }
})

router.post('/:campaignId/players/:playerId/characters/:characterId/dead', (request, response, next) => {
  try {
    response.json({ character: playerCharacterStore.markCharacterDead(request.params.campaignId, request.params.playerId, request.params.characterId) })
  } catch (error) {
    next(error)
  }
})

router.post('/:campaignId/players/:playerId/characters/:characterId/retire', (request, response, next) => {
  try {
    response.json({ character: playerCharacterStore.retireCharacter(request.params.campaignId, request.params.playerId, request.params.characterId) })
  } catch (error) {
    next(error)
  }
})

export = router
