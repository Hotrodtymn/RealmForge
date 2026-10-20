import database = require('./database')
import adventureStore = require('./adventureStore')
import HttpError = require('./httpError')
import metadataStore = require('./worldExpansionApprovalMetadataStore')
import proposalSchema = require('./worldExpansionSchema')
import registryModule = require('./worldExpansionApprovalRegistry')

type Snapshot = {
  adventureId: string
  sessionId: string
  model: string
  generatedAt: string
  proposals: ReturnType<typeof proposalSchema.validateWorldExpansion>
}
type Proposal = Snapshot['proposals']['npcs'][number] | Snapshot['proposals']['locations'][number] | Snapshot['proposals']['quests'][number]
type ProposalType = 'npc' | 'location' | 'quest'
type Reference = { type: 'existing'; id: string } | { type: 'proposal'; key: string } | null
type ApprovalInput = { previewId: unknown; adventureId: string; selectedProposalKeys: unknown; edits?: unknown }
type ApprovedResult = { approved: Array<{ proposalKey: string; type: ProposalType; id: string; name: string }> }
type ApprovalRegistry = {
  approve<T>(previewId: unknown, adventureId: string, proposalKeys: unknown, persist: (snapshot: Snapshot, proposals: Proposal[], previewId: string, previouslyApprovedKeys: ReadonlySet<string>) => T): {
    value: T; replayed: boolean; remainingProposalKeys: string[]; expiresAt: string
  }
}

const editableFields: Record<ProposalType, readonly string[]> = {
  npc: ['name', 'description', 'role', 'personality', 'motivation', 'relevance'],
  location: ['name', 'description', 'locationType', 'narrativePurpose'],
  quest: ['title', 'description', 'objectives', 'trigger'],
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const textBounds: Record<string, [number, number]> = {
  name: [2, 100], description: [10, 280], role: [2, 80], personality: [2, 120], motivation: [2, 140], relevance: [10, 160],
  locationType: [2, 60], narrativePurpose: [10, 140], title: [3, 90], trigger: [5, 140],
}

function proposalType(proposal: Proposal): ProposalType {
  if ('role' in proposal) return 'npc'
  if ('locationType' in proposal) return 'location'
  return 'quest'
}

function validateRequest(input: ApprovalInput) {
  if (typeof input.adventureId !== 'string' || !uuidPattern.test(input.adventureId)) throw new HttpError(400, 'Provide a valid adventureId UUID.')
  if (!Array.isArray(input.selectedProposalKeys) || input.selectedProposalKeys.length === 0) throw new HttpError(400, 'Select at least one proposal to approve.')
  if (input.selectedProposalKeys.length > 3 || input.selectedProposalKeys.some((key) => typeof key !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(key))) throw new HttpError(400, 'Selected proposal keys are invalid.')
  if (new Set(input.selectedProposalKeys).size !== input.selectedProposalKeys.length) throw new HttpError(400, 'A proposal may be selected only once.')
  if (input.edits !== undefined && (!input.edits || typeof input.edits !== 'object' || Array.isArray(input.edits))) throw new HttpError(400, 'Edits must be an object keyed by selected proposal key.')
}

function validateEdits(proposals: Proposal[], editsValue: unknown): Map<string, Proposal> {
  const edits = (editsValue ?? {}) as Record<string, unknown>
  const byKey = new Map(proposals.map((proposal) => [proposal.key, proposal]))
  for (const key of Object.keys(edits)) if (!byKey.has(key)) throw new HttpError(400, `Edits may only target selected proposal ${key}.`)
  const result = new Map<string, Proposal>()
  for (const proposal of proposals) {
    const editValue = edits[proposal.key]
    let merged: Proposal = proposal
    if (editValue !== undefined) {
      if (!editValue || typeof editValue !== 'object' || Array.isArray(editValue)) throw new HttpError(400, `Edits for ${proposal.key} must be an object.`)
      const fields = editValue as Record<string, unknown>
      const type = proposalType(proposal)
      for (const [field, value] of Object.entries(fields)) {
        if (!editableFields[type].includes(field)) throw new HttpError(400, `Field ${field} cannot be edited for ${type} proposals.`)
        if (field === 'objectives') {
          if (!Array.isArray(value) || value.length < 1 || value.length > 2 || value.some((item) => typeof item !== 'string' || item.trim().length < 5 || item.trim().length > 140)) {
            throw new HttpError(400, 'Quest objectives must contain one or two entries of 5 to 140 characters.')
          }
          ;(fields as Record<string, unknown>)[field] = value.map((item) => (item as string).trim())
        } else {
          const bounds = textBounds[field]
          if (!bounds || typeof value !== 'string' || value.trim().length < bounds[0] || value.trim().length > bounds[1]) {
            throw new HttpError(400, `${field} must contain ${bounds?.[0] ?? 1} to ${bounds?.[1] ?? 0} characters.`)
          }
          ;(fields as Record<string, unknown>)[field] = value.trim()
        }
      }
      merged = { ...proposal, ...fields } as Proposal
    }
    try { merged = proposalSchema.validateApprovedProposalContent(merged) as Proposal }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Edited proposal content is invalid.') }
    result.set(proposal.key, merged)
  }
  return result
}

function normalizeName(value: string) { return value.trim().toLocaleLowerCase('en-US') }

function requireApprovalSchema() {
  const required: Record<string, string[]> = {
    adventure_npcs: ['role', 'motivation', 'storyRelevance'],
    adventure_locations: ['narrativePurpose', 'relatedLocationId'],
    adventure_quests: ['trigger'],
    adventure_quest_npcs: ['adventureId', 'questId', 'npcId'],
    adventure_world_expansion_approvals: ['previewId', 'proposalKey', 'evidenceJson', 'uncertainty'],
  }
  const missing: string[] = []
  for (const [table, columns] of Object.entries(required)) {
    const actual = new Set((database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name))
    for (const column of columns) if (!actual.has(column)) missing.push(`${table}.${column}`)
  }
  if (missing.length) throw new HttpError(503, 'World Expansion approval storage is not initialized. Back up the database and start RealmForge normally to apply its additive migration.', { storage: 'schema_not_ready' })
}

class WorldExpansionApprovalService {
  constructor(private readonly registry: ApprovalRegistry = registryModule.worldExpansionApprovalRegistry) {}

  approve(input: ApprovalInput) {
    validateRequest(input)
    try {
      return this.registry.approve(input.previewId, input.adventureId, input.selectedProposalKeys, (snapshot, originalSelected, previewId, previouslyApprovedKeys) => this.persist(snapshot, originalSelected, input.edits, previewId, previouslyApprovedKeys))
    } catch (error) {
      if (error instanceof registryModule.ApprovalPreviewError) throw error
      if (error instanceof HttpError) throw error
      throw new HttpError(409, 'World Expansion approval could not be saved. No partial changes were committed.')
    }
  }

  private persist(snapshot: Snapshot, originalSelected: Proposal[], edits: unknown, previewId: string, previouslyApprovedKeys: ReadonlySet<string>): ApprovedResult {
    database.exec('BEGIN IMMEDIATE')
    try {
      requireApprovalSchema()
      const adventure = database.prepare('SELECT campaignId FROM adventures WHERE id=?').get(snapshot.adventureId) as { campaignId: string } | undefined
      const session = database.prepare('SELECT status FROM adventure_sessions WHERE id=? AND adventureId=?').get(snapshot.sessionId, snapshot.adventureId) as { status: string } | undefined
      if (!adventure || !session || !['active', 'paused'].includes(session.status)) throw new HttpError(409, 'The preview adventure or source session is no longer available for approval.')
      adventureStore.getAdventure(adventure.campaignId, snapshot.adventureId)

      const selected = validateEdits(originalSelected, edits)
      const selectedByKey = new Map([...selected].map(([key, proposal]) => [key, proposalType(proposal)]))
      const selectedKeys = new Set(selected.keys())
      for (const proposal of selected.values()) {
        if (metadataStore.hasApprovalIdentity(String((snapshot as any).previewId ?? ''), proposal.key)) {
          throw new HttpError(409, `Proposal ${proposal.key} was already approved.`)
        }
        const type = proposalType(proposal)
        const displayName = 'objectives' in proposal ? proposal.title : proposal.name
        const existingNames = type === 'npc'
          ? (adventureStore.listNpcs(snapshot.adventureId) as Array<Record<string, unknown>>).map((row) => String(row.name))
          : type === 'location'
            ? (adventureStore.listLocations(snapshot.adventureId) as Array<Record<string, unknown>>).map((row) => String(row.name))
            : (adventureStore.listQuests(snapshot.adventureId) as Array<Record<string, unknown>>).map((row) => String(row.title))
        if (existingNames.some((name) => normalizeName(name) === normalizeName(displayName))) throw new HttpError(409, `${type} proposal ${proposal.key} duplicates an existing adventure entity.`)
        if ([...selected.values()].some((other) => other.key !== proposal.key && proposalType(other) === type && normalizeName('objectives' in other ? other.title : other.name) === normalizeName(displayName))) {
          throw new HttpError(409, `Selected ${type} proposals contain duplicate names.`)
        }
      }

      const validateReference = (reference: Reference, expected: 'npc' | 'location', label: string) => {
        if (reference === null) return
        if (reference.type === 'existing') {
          if (!uuidPattern.test(reference.id)) throw new HttpError(400, `${label} has an invalid existing reference.`)
          if (expected === 'npc') adventureStore.getNpc(snapshot.adventureId, reference.id)
          else adventureStore.getLocation(snapshot.adventureId, reference.id)
          return
        }
        if (reference.type !== 'proposal') throw new HttpError(400, `${label} has an invalid proposal reference.`)
        if (selectedByKey.get(reference.key) === expected && selectedKeys.has(reference.key)) return
        const previouslySaved = previouslyApprovedKeys.has(reference.key) ? metadataStore.getApprovedProposalByIdentity(previewId, reference.key) : null
        if (!previouslySaved || previouslySaved.adventureId !== snapshot.adventureId || previouslySaved.entityType !== expected) {
          throw new HttpError(400, `${label} references a proposal that was not selected for approval.`)
        }
        if (expected === 'npc') adventureStore.getNpc(snapshot.adventureId, previouslySaved.entityId)
        else adventureStore.getLocation(snapshot.adventureId, previouslySaved.entityId)
      }
      for (const proposal of selected.values()) {
        if ('role' in proposal) validateReference(proposal.locationRef, 'location', `NPC ${proposal.key} location`)
        else if ('locationType' in proposal) validateReference(proposal.relatedLocationRef, 'location', `Location ${proposal.key} relation`)
        else {
          for (const ref of proposal.npcRefs) validateReference(ref, 'npc', `Quest ${proposal.key} NPC reference`)
          for (const ref of proposal.locationRefs) validateReference(ref, 'location', `Quest ${proposal.key} location reference`)
        }
      }

      const persistedIds = new Map<string, string>()
      const approved: ApprovedResult['approved'] = []
      const locations = [...selected.values()].filter((proposal): proposal is Snapshot['proposals']['locations'][number] => 'locationType' in proposal)
      const npcs = [...selected.values()].filter((proposal): proposal is Snapshot['proposals']['npcs'][number] => 'role' in proposal)
      const quests = [...selected.values()].filter((proposal): proposal is Snapshot['proposals']['quests'][number] => 'objectives' in proposal)

      for (const proposal of locations) {
        const row = adventureStore.createLocation(snapshot.adventureId, {
          name: proposal.name, description: proposal.description, locationType: proposal.locationType, dmNotes: '', narrativePurpose: proposal.narrativePurpose,
        }) as Record<string, unknown>
        persistedIds.set(proposal.key, String(row.id))
        approved.push({ proposalKey: proposal.key, type: 'location', id: String(row.id), name: proposal.name })
      }
      const resolve = (reference: Reference): string | null => {
        if (reference === null) return null
        if (reference.type === 'existing') return reference.id
        if (persistedIds.has(reference.key)) return persistedIds.get(reference.key) as string
        if (previouslyApprovedKeys.has(reference.key)) {
          const previous = metadataStore.getApprovedProposalByIdentity(previewId, reference.key)
          if (previous?.adventureId === snapshot.adventureId) return previous.entityId
        }
        return null
      }
      for (const proposal of locations) {
        if (proposal.relatedLocationRef) {
          const relatedId = resolve(proposal.relatedLocationRef)
          if (!relatedId) throw new HttpError(400, `Location ${proposal.key} has an unresolved related-location reference.`)
          adventureStore.setRelatedLocation(snapshot.adventureId, persistedIds.get(proposal.key) as string, relatedId)
        }
      }
      for (const proposal of npcs) {
        const row = adventureStore.saveNpc(snapshot.adventureId, null, {
          name: proposal.name, description: proposal.description, personality: proposal.personality, disposition: '',
          currentLocationId: resolve(proposal.locationRef), dmNotes: '', role: proposal.role, motivation: proposal.motivation, storyRelevance: proposal.relevance,
        }) as Record<string, unknown>
        persistedIds.set(proposal.key, String(row.id))
        approved.push({ proposalKey: proposal.key, type: 'npc', id: String(row.id), name: proposal.name })
      }
      for (const proposal of quests) {
        const row = adventureStore.saveQuest(snapshot.adventureId, null, {
          title: proposal.title, description: proposal.description, status: 'available', trigger: proposal.trigger,
        }) as Record<string, unknown>
        const questId = String(row.id)
        persistedIds.set(proposal.key, questId)
        proposal.objectives.forEach((objective, index) => adventureStore.addObjective(snapshot.adventureId, questId, objective, index))
        const npcIds = proposal.npcRefs.map(resolve).filter((id): id is string => id !== null)
        const locationIds = proposal.locationRefs.map(resolve).filter((id): id is string => id !== null)
        adventureStore.setQuestNpcs(snapshot.adventureId, questId, npcIds)
        adventureStore.setQuestLocations(snapshot.adventureId, questId, locationIds)
        approved.push({ proposalKey: proposal.key, type: 'quest', id: questId, name: proposal.title })
      }

      const approvedAt = new Date().toISOString()
      for (const proposal of selected.values()) {
        const type = proposalType(proposal)
        const entityId = persistedIds.get(proposal.key)
        if (!entityId) throw new HttpError(500, `Proposal ${proposal.key} was not persisted.`)
        metadataStore.writeApprovedProposalMetadata({
          adventureId: snapshot.adventureId, entityType: type, entityId, previewId,
          proposalKey: proposal.key, proposalType: type, evidence: proposal.evidence, uncertainty: proposal.uncertainty, approvedAt,
        })
      }
      database.exec('COMMIT')
      return { approved }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}

const worldExpansionApprovalService = new WorldExpansionApprovalService()
export = { WorldExpansionApprovalService, worldExpansionApprovalService }
