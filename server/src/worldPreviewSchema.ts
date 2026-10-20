const keyPattern = '^[a-z][a-z0-9_]{1,39}$'

const ref = { type: 'string', pattern: keyPattern } as const
const shortText = { type: 'string', minLength: 1, maxLength: 500 } as const
const worldPreviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['campaign', 'locations', 'npcs', 'mainQuest', 'mysteryOrThreat', 'openingScene', 'possibleResolution'],
  properties: {
    campaign: {
      type: 'object', additionalProperties: false,
      required: ['key', 'title', 'premise', 'setting', 'startingLocationKey'],
      properties: {
        key: { const: 'campaign' },
        title: { type: 'string', minLength: 3, maxLength: 100 },
        premise: { type: 'string', minLength: 40, maxLength: 900 },
        setting: { type: 'string', minLength: 20, maxLength: 300 },
        startingLocationKey: ref,
      },
    },
    locations: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'name', 'kind', 'description', 'isStartingLocation'],
        properties: {
          key: ref,
          name: { type: 'string', minLength: 2, maxLength: 100 },
          kind: { type: 'string', minLength: 2, maxLength: 60 },
          description: { type: 'string', minLength: 30, maxLength: 700 },
          isStartingLocation: { type: 'boolean' },
        },
      },
    },
    npcs: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'name', 'role', 'personality', 'motivation', 'locationKey'],
        properties: {
          key: ref,
          name: { type: 'string', minLength: 2, maxLength: 100 },
          role: { type: 'string', minLength: 5, maxLength: 180 },
          personality: { type: 'string', minLength: 10, maxLength: 350 },
          motivation: { type: 'string', minLength: 10, maxLength: 350 },
          locationKey: ref,
        },
      },
    },
    mainQuest: {
      type: 'object', additionalProperties: false,
      required: ['key', 'title', 'description', 'objectives', 'locationKeys'],
      properties: {
        key: { const: 'main_quest' },
        title: { type: 'string', minLength: 5, maxLength: 120 },
        description: { type: 'string', minLength: 30, maxLength: 800 },
        objectives: {
          type: 'array', minItems: 2, maxItems: 3,
          items: {
            type: 'object', additionalProperties: false,
            required: ['key', 'description'],
            properties: {
              key: ref,
              description: { type: 'string', minLength: 8, maxLength: 300 },
            },
          },
        },
        locationKeys: { type: 'array', minItems: 1, maxItems: 3, items: ref },
      },
    },
    mysteryOrThreat: { type: 'string', minLength: 30, maxLength: 700 },
    openingScene: {
      type: 'object', additionalProperties: false,
      required: ['key', 'title', 'description', 'locationKey', 'questKey'],
      properties: {
        key: { const: 'opening_scene' },
        title: { type: 'string', minLength: 3, maxLength: 120 },
        description: { type: 'string', minLength: 40, maxLength: 900 },
        locationKey: ref,
        questKey: { const: 'main_quest' },
      },
    },
    possibleResolution: { type: 'string', minLength: 30, maxLength: 700 },
  },
} as const

type WorldPreview = {
  campaign: { key: string; title: string; premise: string; setting: string; startingLocationKey: string }
  locations: { key: string; name: string; kind: string; description: string; isStartingLocation: boolean }[]
  npcs: { key: string; name: string; role: string; personality: string; motivation: string; locationKey: string }[]
  mainQuest: { key: string; title: string; description: string; objectives: { key: string; description: string }[]; locationKeys: string[] }
  mysteryOrThreat: string
  openingScene: { key: string; title: string; description: string; locationKey: string; questKey: string }
  possibleResolution: string
}

class WorldPreviewValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'WorldPreviewValidationError' }
}

function record(value: unknown, label: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorldPreviewValidationError(`${label} must be an object.`)
  const object = value as Record<string, unknown>
  const actual = Object.keys(object)
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(object, key))) {
    throw new WorldPreviewValidationError(`${label} has missing or unexpected fields.`)
  }
  return object
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new WorldPreviewValidationError(`${label} must be text.`)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) throw new WorldPreviewValidationError(`${label} is outside its allowed length.`)
  return normalized
}

function reference(value: unknown, label: string): string {
  const key = text(value, label, 2, 40)
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(key) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(key)) {
    throw new WorldPreviewValidationError(`${label} must be a stable preview key, not a database identifier.`)
  }
  return key
}

function uniqueReferences(keys: string[]): void {
  if (new Set(keys).size !== keys.length) throw new WorldPreviewValidationError('Preview reference keys must be unique.')
}

function validateWorldPreview(value: unknown): WorldPreview {
  const root = record(value, 'Preview', ['campaign', 'locations', 'npcs', 'mainQuest', 'mysteryOrThreat', 'openingScene', 'possibleResolution'])
  const campaignRaw = record(root.campaign, 'Campaign', ['key', 'title', 'premise', 'setting', 'startingLocationKey'])
  const campaign = {
    key: reference(campaignRaw.key, 'Campaign key'),
    title: text(campaignRaw.title, 'Campaign title', 3, 100),
    premise: text(campaignRaw.premise, 'Campaign premise', 40, 900),
    setting: text(campaignRaw.setting, 'Campaign setting', 20, 300),
    startingLocationKey: reference(campaignRaw.startingLocationKey, 'Starting location key'),
  }
  if (campaign.key !== 'campaign') throw new WorldPreviewValidationError('Campaign key must be campaign.')

  if (!Array.isArray(root.locations) || root.locations.length !== 3) throw new WorldPreviewValidationError('Preview must contain exactly three locations.')
  const locations = root.locations.map((raw, index) => {
    const location = record(raw, `Location ${index + 1}`, ['key', 'name', 'kind', 'description', 'isStartingLocation'])
    if (typeof location.isStartingLocation !== 'boolean') throw new WorldPreviewValidationError('Location starting marker must be boolean.')
    return {
      key: reference(location.key, `Location ${index + 1} key`),
      name: text(location.name, `Location ${index + 1} name`, 2, 100),
      kind: text(location.kind, `Location ${index + 1} kind`, 2, 60),
      description: text(location.description, `Location ${index + 1} description`, 30, 700),
      isStartingLocation: location.isStartingLocation,
    }
  })
  const locationKeys = locations.map((location) => location.key)
  const startingLocations = locations.filter((location) => location.isStartingLocation)
  if (startingLocations.length !== 1 || startingLocations[0]?.key !== campaign.startingLocationKey) {
    throw new WorldPreviewValidationError('Campaign starting location must reference the single location marked as the start.')
  }

  if (!Array.isArray(root.npcs) || root.npcs.length !== 3) throw new WorldPreviewValidationError('Preview must contain exactly three NPCs.')
  const npcs = root.npcs.map((raw, index) => {
    const npc = record(raw, `NPC ${index + 1}`, ['key', 'name', 'role', 'personality', 'motivation', 'locationKey'])
    const locationKey = reference(npc.locationKey, `NPC ${index + 1} location key`)
    if (!locationKeys.includes(locationKey)) throw new WorldPreviewValidationError(`NPC ${index + 1} references an unknown location.`)
    return {
      key: reference(npc.key, `NPC ${index + 1} key`),
      name: text(npc.name, `NPC ${index + 1} name`, 2, 100),
      role: text(npc.role, `NPC ${index + 1} role`, 5, 180),
      personality: text(npc.personality, `NPC ${index + 1} personality`, 10, 350),
      motivation: text(npc.motivation, `NPC ${index + 1} motivation`, 10, 350),
      locationKey,
    }
  })

  const questRaw = record(root.mainQuest, 'Main quest', ['key', 'title', 'description', 'objectives', 'locationKeys'])
  const questKey = reference(questRaw.key, 'Main quest key')
  if (questKey !== 'main_quest') throw new WorldPreviewValidationError('Main quest key must be main_quest.')
  if (!Array.isArray(questRaw.objectives) || questRaw.objectives.length < 2 || questRaw.objectives.length > 3) {
    throw new WorldPreviewValidationError('Main quest must have two or three objectives.')
  }
  const objectives = questRaw.objectives.map((raw, index) => {
    const objective = record(raw, `Objective ${index + 1}`, ['key', 'description'])
    return {
      key: reference(objective.key, `Objective ${index + 1} key`),
      description: text(objective.description, `Objective ${index + 1} description`, 8, 300),
    }
  })
  if (!Array.isArray(questRaw.locationKeys) || questRaw.locationKeys.length < 1 || questRaw.locationKeys.length > 3) {
    throw new WorldPreviewValidationError('Main quest must reference one to three locations.')
  }
  const questLocationKeys = questRaw.locationKeys.map((key, index) => reference(key, `Quest location ${index + 1}`))
  if (new Set(questLocationKeys).size !== questLocationKeys.length || questLocationKeys.some((key) => !locationKeys.includes(key))) {
    throw new WorldPreviewValidationError('Main quest contains an unknown or duplicate location reference.')
  }
  const mainQuest = {
    key: questKey,
    title: text(questRaw.title, 'Main quest title', 5, 120),
    description: text(questRaw.description, 'Main quest description', 30, 800),
    objectives,
    locationKeys: questLocationKeys,
  }

  const sceneRaw = record(root.openingScene, 'Opening scene', ['key', 'title', 'description', 'locationKey', 'questKey'])
  const scene = {
    key: reference(sceneRaw.key, 'Opening scene key'),
    title: text(sceneRaw.title, 'Opening scene title', 3, 120),
    description: text(sceneRaw.description, 'Opening scene description', 40, 900),
    locationKey: reference(sceneRaw.locationKey, 'Opening scene location key'),
    questKey: reference(sceneRaw.questKey, 'Opening scene quest key'),
  }
  if (scene.key !== 'opening_scene' || !locationKeys.includes(scene.locationKey) || scene.questKey !== questKey) {
    throw new WorldPreviewValidationError('Opening scene contains an unknown or mismatched location/quest reference.')
  }
  const allKeys = [campaign.key, ...locationKeys, ...npcs.map((npc) => npc.key), questKey, ...objectives.map((objective) => objective.key), scene.key]
  uniqueReferences(allKeys)

  return {
    campaign, locations, npcs, mainQuest,
    mysteryOrThreat: text(root.mysteryOrThreat, 'Mystery or threat', 30, 700),
    openingScene: scene,
    possibleResolution: text(root.possibleResolution, 'Possible resolution', 30, 700),
  }
}

export = { worldPreviewJsonSchema, validateWorldPreview, WorldPreviewValidationError }
