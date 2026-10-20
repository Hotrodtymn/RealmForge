import database = require('./database')

type EntityType = 'npc' | 'location' | 'quest'
type EvidenceRelationship = 'established_fact' | 'reported_claim' | 'creative_inspiration'
type EvidenceReference = {
  sourceType: 'player_action' | 'dm_narration' | 'story_memory' | 'existing_entity'
  sourceId: string
  quote: string
  relationship: EvidenceRelationship
  sourceLabel: string
}
type ApprovalMetadataInput = {
  adventureId: string
  entityType: EntityType
  entityId: string
  previewId: string
  proposalKey: string
  proposalType: EntityType
  evidence: EvidenceReference[]
  uncertainty: 'observed' | 'npc_claim' | 'player_assertion' | 'uncertain'
  approvedAt: string
}
type ApprovalMetadata = ApprovalMetadataInput & { origin: 'ai_assisted_dm_approved' }
type Row = Record<string, unknown>

const validTypes = new Set<EntityType>(['npc', 'location', 'quest'])
const validUncertainty = new Set<ApprovalMetadataInput['uncertainty']>(['observed', 'npc_claim', 'player_assertion', 'uncertain'])
const validRelationships = new Set<EvidenceRelationship>(['established_fact', 'reported_claim', 'creative_inspiration'])
const validSourceTypes = new Set<EvidenceReference['sourceType']>(['player_action', 'dm_narration', 'story_memory', 'existing_entity'])
const proposalKeyPattern = /^[a-z][a-z0-9_]{1,39}$/
const previewIdPattern = /^[A-Za-z0-9_-]{40,60}$/

function validateInput(input: ApprovalMetadataInput) {
  if (!input || !input.adventureId.trim() || !input.entityId.trim() || input.entityId.length > 80) throw new Error('Approval metadata requires an adventure and entity identifier.')
  if (!validTypes.has(input.entityType) || input.proposalType !== input.entityType) throw new Error('Approval metadata entity and proposal types must match.')
  if (!previewIdPattern.test(input.previewId) || !proposalKeyPattern.test(input.proposalKey)) throw new Error('Approval metadata preview and proposal identifiers are invalid.')
  if (!validUncertainty.has(input.uncertainty) || !input.approvedAt.trim() || input.approvedAt.length > 40) throw new Error('Approval metadata uncertainty or timestamp is invalid.')
  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 3) throw new Error('Approval metadata requires one to three evidence references.')
  for (const evidence of input.evidence) {
    if (!validSourceTypes.has(evidence.sourceType) || !evidence.sourceId.trim() || evidence.sourceId.length > 80
      || !evidence.quote.trim() || evidence.quote.length > 2000 || !evidence.sourceLabel.trim() || evidence.sourceLabel.length > 240
      || !validRelationships.has(evidence.relationship)) throw new Error('Approval metadata contains an invalid evidence reference.')
  }
}

// This helper intentionally participates in, but never manages, a transaction.
function writeApprovedProposalMetadata(input: ApprovalMetadataInput): void {
  validateInput(input)
  database.prepare(`INSERT INTO adventure_world_expansion_approvals
    (adventureId,entityType,entityId,previewId,proposalKey,proposalType,evidenceJson,uncertainty,approvedAt,origin)
    VALUES (?,?,?,?,?,?,?,?,?,'ai_assisted_dm_approved')`).run(
    input.adventureId, input.entityType, input.entityId, input.previewId, input.proposalKey, input.proposalType,
    JSON.stringify(input.evidence), input.uncertainty, input.approvedAt)
}

function getApprovedProposalMetadata(adventureId: string, entityType: EntityType, entityId: string): ApprovalMetadata | null {
  if (!validTypes.has(entityType)) throw new Error('Unknown adventure entity type.')
  const row = database.prepare(`SELECT adventureId,entityType,entityId,previewId,proposalKey,proposalType,evidenceJson,uncertainty,approvedAt,origin
    FROM adventure_world_expansion_approvals WHERE adventureId=? AND entityType=? AND entityId=?`).get(adventureId, entityType, entityId) as Row | undefined
  if (!row) return null
  return {
    adventureId: String(row.adventureId), entityType: String(row.entityType) as EntityType, entityId: String(row.entityId),
    previewId: String(row.previewId), proposalKey: String(row.proposalKey), proposalType: String(row.proposalType) as EntityType,
    evidence: JSON.parse(String(row.evidenceJson)) as EvidenceReference[],
    uncertainty: String(row.uncertainty) as ApprovalMetadataInput['uncertainty'], approvedAt: String(row.approvedAt),
    origin: String(row.origin) as ApprovalMetadata['origin'],
  }
}

function hasApprovalIdentity(previewId: string, proposalKey: string): boolean {
  return Boolean(database.prepare('SELECT 1 FROM adventure_world_expansion_approvals WHERE previewId=? AND proposalKey=?').get(previewId, proposalKey))
}

function getApprovedProposalByIdentity(previewId: string, proposalKey: string): { adventureId: string; entityType: EntityType; entityId: string } | null {
  const row = database.prepare('SELECT adventureId,entityType,entityId FROM adventure_world_expansion_approvals WHERE previewId=? AND proposalKey=?').get(previewId, proposalKey) as Row | undefined
  if (!row) return null
  return { adventureId: String(row.adventureId), entityType: String(row.entityType) as EntityType, entityId: String(row.entityId) }
}

export = { writeApprovedProposalMetadata, getApprovedProposalMetadata, hasApprovalIdentity, getApprovedProposalByIdentity }
