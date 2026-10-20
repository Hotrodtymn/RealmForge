import crypto = require('node:crypto')
import database = require('./database')
import previewSchema = require('./worldPreviewSchema')
import worldConfig = require('./worldGenerationConfig')

type Preview = ReturnType<typeof previewSchema.validateWorldPreview>
type Configuration = ReturnType<typeof worldConfig.validateWorldGenerationConfig>

type SavedWorld = {
  campaign: Record<string, unknown>
  adventure: Record<string, unknown>
  referenceMap: {
    campaign: string
    adventure: string
    locations: Record<string, string>
    npcs: Record<string, string>
    mainQuest: string
    objectives: Record<string, string>
    openingScene: string
  }
}

type PreviewSnapshot = { preview: Preview; configuration: Configuration; model: string }
type Row = Record<string, unknown>
type SqlValue = string | number | null

const one = (sql: string, ...params: SqlValue[]) => database.prepare(sql).get(...params) as Row | undefined
const run = (sql: string, ...params: SqlValue[]) => database.prepare(sql).run(...params)
const id = () => crypto.randomUUID()
const now = () => new Date().toISOString()

function persistWorld(snapshot: PreviewSnapshot): SavedWorld {
  const { preview } = snapshot
  const timestamp = now()
  const campaignId = id()
  const adventureId = id()
  const locationIds = new Map<string, string>()
  const npcIds = new Map<string, string>()
  const objectiveIds = new Map<string, string>()
  const questId = id()
  const openingSceneId = id()
  let saved: SavedWorld | undefined

  database.exec('BEGIN IMMEDIATE')
  try {
    run('INSERT INTO campaigns (id,name,description,setting,createdAt) VALUES (?,?,?,?,?)',
      campaignId, preview.campaign.title, preview.campaign.premise, preview.campaign.setting, timestamp)
    const startingLocation = preview.locations.find((location) => location.key === preview.campaign.startingLocationKey)
    if (!startingLocation) throw new Error('Validated preview lost its starting location reference.')
    run('INSERT INTO adventures (id,campaignId,title,description,status,startingLocation,createdAt,updatedAt,startingLocationId) VALUES (?,?,?,?,?,?,?,?,?)',
      adventureId, campaignId, preview.campaign.title, preview.campaign.premise, 'draft', startingLocation.name, timestamp, timestamp, null)

    for (const location of preview.locations) {
      const locationId = id()
      locationIds.set(location.key, locationId)
      run('INSERT INTO adventure_locations (id,adventureId,name,description,locationType,dmNotes,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)',
        locationId, adventureId, location.name, location.description, location.kind, '', timestamp, timestamp)
    }

    const startingLocationId = locationIds.get(preview.campaign.startingLocationKey)
    if (!startingLocationId) throw new Error('Validated preview contains an unresolved campaign starting location.')
    run('UPDATE adventures SET startingLocationId=? WHERE id=?', startingLocationId, adventureId)

    for (const npc of preview.npcs) {
      const npcId = id()
      const locationId = locationIds.get(npc.locationKey)
      if (!locationId) throw new Error('Validated preview contains an unresolved NPC location.')
      npcIds.set(npc.key, npcId)
      run('INSERT INTO adventure_npcs (id,adventureId,name,description,personality,disposition,currentLocationId,dmNotes,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
        npcId, adventureId, npc.name, npc.role, npc.personality, '', locationId, `Motivation: ${npc.motivation}`, timestamp, timestamp)
    }

    run('INSERT INTO adventure_quests (id,adventureId,title,description,status,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
      questId, adventureId, preview.mainQuest.title, preview.mainQuest.description, 'available', timestamp, timestamp)
    preview.mainQuest.objectives.forEach((objective, sortOrder) => {
      const objectiveId = id()
      objectiveIds.set(objective.key, objectiveId)
      run('INSERT INTO adventure_objectives (id,questId,description,completed,sortOrder,createdAt,updatedAt) VALUES (?,?,?,0,?,?,?)',
        objectiveId, questId, objective.description, sortOrder, timestamp, timestamp)
    })
    preview.mainQuest.locationKeys.forEach((locationKey, sortOrder) => {
      const locationId = locationIds.get(locationKey)
      if (!locationId) throw new Error('Validated preview contains an unresolved quest location.')
      run('INSERT INTO adventure_quest_locations (questId,locationId,sortOrder,createdAt) VALUES (?,?,?,?)', questId, locationId, sortOrder, timestamp)
    })

    const openingLocationId = locationIds.get(preview.openingScene.locationKey)
    if (!openingLocationId || preview.openingScene.questKey !== preview.mainQuest.key) throw new Error('Validated preview contains an unresolved opening scene reference.')
    run('INSERT INTO adventure_scene_templates (id,adventureId,templateKey,sceneType,locationId,questId,title,description,createdAt) VALUES (?,?,? ,?,?,?,?,?,?)',
      openingSceneId, adventureId, preview.openingScene.key, 'opening', openingLocationId, questId, preview.openingScene.title, preview.openingScene.description, timestamp)

    run('INSERT INTO adventure_story_notes (id,adventureId,content,createdAt) VALUES (?,?,?,?)',
      id(), adventureId, `Central Mystery or Threat\n${preview.mysteryOrThreat}`, timestamp)
    run('INSERT INTO adventure_story_notes (id,adventureId,content,createdAt) VALUES (?,?,?,?)',
      id(), adventureId, `Possible Resolution (not a predetermined outcome)\n${preview.possibleResolution}`, timestamp)

    const campaign = one('SELECT id,name,description,setting,createdAt FROM campaigns WHERE id=?', campaignId)
    const adventure = one('SELECT * FROM adventures WHERE id=? AND campaignId=?', adventureId, campaignId)
    if (!campaign || !adventure) throw new Error('Persisted world could not be reloaded before commit.')
    saved = {
      campaign,
      adventure,
      referenceMap: {
        campaign: campaignId,
        adventure: adventureId,
        locations: Object.fromEntries(locationIds),
        npcs: Object.fromEntries(npcIds),
        mainQuest: questId,
        objectives: Object.fromEntries(objectiveIds),
        openingScene: openingSceneId,
      },
    }

    database.exec('COMMIT')
    return saved
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }

}

export = { persistWorld }
