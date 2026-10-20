const uncertaintyValues = ['observed', 'npc_claim', 'player_assertion', 'uncertain'] as const
const evidenceRelationships = ['established_fact', 'reported_claim', 'creative_inspiration'] as const
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const previewKey = { type: 'string', pattern: '^[a-z][a-z0-9_]{1,39}$' } as const
const boundedText = (minLength: number, maxLength: number) => ({ type: 'string', minLength, maxLength })
const worldReferenceSchema = { anyOf: [
  { type: 'object', additionalProperties: false, required: ['type', 'id'], properties: { type: { const: 'existing' }, id: { type: 'string', minLength: 1, maxLength: 80 } } },
  { type: 'object', additionalProperties: false, required: ['type', 'key'], properties: { type: { const: 'proposal' }, key: previewKey } },
  { type: 'null' },
] } as const
const evidenceSchema = { type: 'array', minItems: 1, maxItems: 3, items: {
  type: 'object', additionalProperties: false, required: ['sourceId', 'creativeInspiration'], properties: {
    sourceId: { type: 'string', minLength: 1, maxLength: 80 },
    creativeInspiration: { type: 'boolean' },
  },
} } as const
const uncertaintySchema = { type: 'string', enum: uncertaintyValues } as const

const worldExpansionJsonSchema = {
  type: 'object', additionalProperties: false, required: ['npcs', 'locations', 'quests'], properties: {
    npcs: { type: 'array', maxItems: 1, items: {
      type: 'object', additionalProperties: false,
      required: ['key', 'name', 'description', 'role', 'personality', 'motivation', 'locationRef', 'relevance', 'evidence', 'uncertainty'],
      properties: {
        key: previewKey, name: boundedText(2, 100), description: boundedText(10, 280), role: boundedText(2, 80),
        personality: boundedText(2, 120), motivation: boundedText(2, 140), locationRef: worldReferenceSchema,
        relevance: boundedText(10, 160), evidence: evidenceSchema, uncertainty: uncertaintySchema,
      },
    } },
    locations: { type: 'array', maxItems: 1, items: {
      type: 'object', additionalProperties: false,
      required: ['key', 'name', 'description', 'locationType', 'relatedLocationRef', 'narrativePurpose', 'evidence', 'uncertainty'],
      properties: {
        key: previewKey, name: boundedText(2, 100), description: boundedText(10, 280), locationType: boundedText(2, 60),
        relatedLocationRef: worldReferenceSchema, narrativePurpose: boundedText(10, 140), evidence: evidenceSchema, uncertainty: uncertaintySchema,
      },
    } },
    quests: { type: 'array', maxItems: 1, items: {
      type: 'object', additionalProperties: false,
      required: ['key', 'title', 'description', 'objectives', 'npcRefs', 'locationRefs', 'trigger', 'evidence', 'uncertainty'],
      properties: {
        key: previewKey, title: boundedText(3, 90), description: boundedText(10, 280),
        objectives: { type: 'array', minItems: 1, maxItems: 2, items: boundedText(5, 140) },
        npcRefs: { type: 'array', maxItems: 1, items: worldReferenceSchema },
        locationRefs: { type: 'array', maxItems: 1, items: worldReferenceSchema },
        trigger: boundedText(5, 140), evidence: evidenceSchema, uncertainty: uncertaintySchema,
      },
    } },
  },
} as const

type EntityType = 'npc' | 'location' | 'quest'
type SourceType = 'player_action' | 'dm_narration' | 'story_memory' | 'existing_entity'
type WorldReference = { type: 'existing'; id: string } | { type: 'proposal'; key: string } | null
type EvidenceRelationship = typeof evidenceRelationships[number]
type Evidence = { sourceType: SourceType; sourceId: string; quote: string; relationship: EvidenceRelationship; sourceLabel: string }
type ProposalBase = { key: string; evidence: Evidence[]; uncertainty: typeof uncertaintyValues[number]; duplicateOf?: { id: string; name: string }; duplicateProposalKey?: string }
type NpcProposal = ProposalBase & { name: string; description: string; role: string; personality: string; motivation: string; locationRef: WorldReference; relevance: string }
type LocationProposal = ProposalBase & { name: string; description: string; locationType: string; relatedLocationRef: WorldReference; narrativePurpose: string }
type QuestProposal = ProposalBase & { title: string; description: string; objectives: string[]; npcRefs: WorldReference[]; locationRefs: WorldReference[]; trigger: string }
type WorldExpansion = { npcs: NpcProposal[]; locations: LocationProposal[]; quests: QuestProposal[] }
type ValidationContext = {
  existing: Record<EntityType, Array<{ id: string; name: string; evidenceText: string }>>
  existingReferenceIds?: Partial<Record<EntityType, string[]>>
  sources: Map<SourceType, Map<string, string>>
  sourceUncertainty?: Map<string, typeof uncertaintyValues[number]>
  sourceLabels: Map<SourceType, Map<string, string>>
  evidenceCatalog: Map<string, Array<{ sourceType: SourceType; sourceId: string; sourceText: string; sourceLabel: string; uncertainty?: typeof uncertaintyValues[number] }>>
}

type HistoricalLanguageDiagnostic = {
  validation: 'historical_language'
  proposalType: 'npc' | 'location' | 'quest'
  fieldName: string
  patternId: string
  conditionalClauseDetected: boolean
  establishedFactEvidenceAvailable: boolean
  exactEstablishedFactQuoteCoversMatch: boolean
  decision: 'rejected'
}

type EvidenceReferenceDiagnostic = {
  validation: 'evidence_reference'
  proposalType: EntityType
  fieldName: string
  ruleId: string
  failureClassification: 'invalid_shape' | 'unknown_source' | 'ambiguous_source' | 'duplicate_source' | 'unsafe_classification'
  decision: 'rejected'
}

class WorldExpansionValidationError extends Error {
  constructor(message: string, readonly diagnostic?: HistoricalLanguageDiagnostic | EvidenceReferenceDiagnostic) { super(message); this.name = 'WorldExpansionValidationError' }
}

function object(value: unknown, label: string, required: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorldExpansionValidationError(`${label} must be an object.`)
  const result = value as Record<string, unknown>
  if (Object.keys(result).length !== required.length || required.some((key) => !Object.hasOwn(result, key))) throw new WorldExpansionValidationError(`${label} has missing or unexpected fields.`)
  return result
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new WorldExpansionValidationError(`${label} must be text.`)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) throw new WorldExpansionValidationError(`${label} is outside its allowed length.`)
  return normalized
}

function exactSourceId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80 || value.trim() !== value) {
    throw new WorldExpansionValidationError(`${label} must exactly identify a supplied evidence source.`)
  }
  return value
}

function attributedNarration(sourceText: string, quote: string): boolean {
  const index = sourceText.indexOf(quote)
  const prefix = sourceText.slice(Math.max(0, index - 100), index)
  const attributionPattern = /\b(?:says?|said|claims?|claimed|reports?|reported|tells?|told|rumou?rs?|believes?)\s*[:;,]?\s*[“"'‘]?\s*$/i
  return attributionPattern.test(prefix)
    || /^\s*[^.!?\n]{1,100}\b(?:says?|said|claims?|claimed|reports?|reported|tells?|told|rumou?rs?|believes?)\s*[:;,]?\s*[“"'‘]/i.test(sourceText)
}

function classifyEvidenceSource(source: { sourceType: SourceType; sourceText: string; uncertainty?: typeof uncertaintyValues[number] }, creativeInspiration: boolean, label: string, proposalType: EntityType, fieldName: string): EvidenceRelationship {
  if (creativeInspiration) return 'creative_inspiration'
  if (source.sourceType === 'existing_entity') return 'established_fact'
  if (source.sourceType === 'player_action') return 'reported_claim'
  if (source.sourceType === 'dm_narration') return attributedNarration(source.sourceText, source.sourceText) ? 'reported_claim' : 'established_fact'
  if (source.sourceType === 'story_memory') {
    if (source.uncertainty === 'observed') return 'established_fact'
    if (source.uncertainty === 'npc_claim' || source.uncertainty === 'player_assertion') return 'reported_claim'
  }
  throw new WorldExpansionValidationError(`${label} has uncertain provenance and may only be used as creative inspiration.`, {
    validation: 'evidence_reference', proposalType, fieldName, ruleId: 'source_provenance_classification',
    failureClassification: 'unsafe_classification', decision: 'rejected',
  })
}

function rejectHistoricalProposalLanguage(
  fields: Array<{ fieldName: string; value: string }>,
  proposalType: HistoricalLanguageDiagnostic['proposalType'],
  label: string,
  evidenceValue: Evidence[],
) {
  const patterns = [
    { id: 'past_copula', expression: /\b(?:was|were)\b/gi },
    { id: 'past_auxiliary', expression: /\bhad\b/gi },
    { id: 'present_perfect_history', expression: /\bhas\s+(?:been|[a-z]{3,}ed|known|seen|found|left|gone|done|made|built|written|spoken|held|lost|won|taken|given|told|said|brought|bought|caught|thought|read|met|kept|felt|heard|sent|spent|stood|shown|grown|drawn|flown|broken|chosen|driven|eaten|fallen|forgotten|hidden|ridden|risen|shaken|stolen|thrown|worn)\b/gi },
    { id: 'historical_adverb', expression: /\b(?:once|previously|already|formerly)\b/gi },
    { id: 'historical_time_phrase', expression: /\b(?:long ago|last night|last week|last month|last year)\b/gi },
  ]
  for (const { fieldName, value } of fields) {
    for (const { id: patternId, expression } of patterns) {
      let match: RegExpExecArray | null
      while ((match = expression.exec(value)) !== null) {
        const sentenceBoundaries = /[.!?;]/g
        let start = 0
        let end = value.length
        let boundary: RegExpExecArray | null
        while ((boundary = sentenceBoundaries.exec(value)) !== null) {
          if (boundary.index < match.index) start = boundary.index + 1
          else { end = boundary.index; break }
        }
        const before = value.slice(start, match.index)
        const after = value.slice(match.index + match[0].length, end)
        const conditionalClauseDetected = /\bif\b/i.test(before)
          && /\b(?:could|might|would|should)\b/i.test(after)
        const establishedFactEvidenceAvailable = evidenceValue.some((source) => source.relationship === 'established_fact')
        const exactEstablishedFactQuoteCoversMatch = evidenceValue.some((source) => {
          if (source.relationship !== 'established_fact') return false
          const sentence = value.slice(start, end).trim()
          return sentence.length >= 12 && source.quote.includes(sentence)
        })
        if (!conditionalClauseDetected && !exactEstablishedFactQuoteCoversMatch) {
          throw new WorldExpansionValidationError(`${label} describes proposed content as established past history; rephrase it as a possibility.`, {
            validation: 'historical_language', proposalType, fieldName, patternId, conditionalClauseDetected,
            establishedFactEvidenceAvailable, exactEstablishedFactQuoteCoversMatch, decision: 'rejected',
          })
        }
      }
      expression.lastIndex = 0
    }
  }
}

function key(value: unknown, label: string): string {
  const result = text(value, label, 2, 40)
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(result) || uuidPattern.test(result)) throw new WorldExpansionValidationError(`${label} must be a temporary proposal key, not a database ID.`)
  return result
}

function reference(value: unknown, label: string, expectedType: EntityType, proposalTypes: Map<string, EntityType>, context: ValidationContext): WorldReference {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorldExpansionValidationError(`${label} must be null or a valid entity reference.`)
  const raw = value as Record<string, unknown>
  if (raw.type === 'existing' && Object.keys(raw).length === 2 && typeof raw.id === 'string') {
    const eligibleIds = context.existingReferenceIds?.[expectedType]
    const found = eligibleIds === undefined ? context.existing[expectedType].some((entry) => entry.id === raw.id) : eligibleIds.includes(raw.id)
    if (!found) throw new WorldExpansionValidationError(`${label} references an unknown existing ${expectedType}.`)
    return { type: 'existing', id: text(raw.id, label, 1, 80) }
  }
  if (raw.type === 'proposal' && Object.keys(raw).length === 2) {
    const proposalKey = key(raw.key, `${label} proposal key`)
    if (proposalTypes.get(proposalKey) !== expectedType) throw new WorldExpansionValidationError(`${label} references an unknown or incompatible proposal.`)
    return { type: 'proposal', key: proposalKey }
  }
  throw new WorldExpansionValidationError(`${label} must identify an existing ${expectedType} or a proposal key.`)
}

function evidence(value: unknown, label: string, context: ValidationContext, proposalType: EntityType): Evidence[] {
  const reject = (fieldName: string, ruleId: string, failureClassification: EvidenceReferenceDiagnostic['failureClassification'], message: string): never => {
    throw new WorldExpansionValidationError(message, { validation: 'evidence_reference', proposalType, fieldName, ruleId, failureClassification, decision: 'rejected' })
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return reject('evidence', 'evidence_count', 'invalid_shape', `${label} must contain one to three source references.`)
  const usedIds = new Set<string>()
  return value.map((raw, index) => {
    const fieldName = `evidence[${index}]`
    const rejectItem = (ruleId: string, failureClassification: EvidenceReferenceDiagnostic['failureClassification'], message: string): never => reject(fieldName, ruleId, failureClassification, message)
    let item: Record<string, unknown>
    try { item = object(raw, `${label} ${index + 1}`, ['sourceId', 'creativeInspiration']) }
    catch { return rejectItem('evidence_fields_exact', 'invalid_shape', `${label} ${index + 1} must contain only a source ID and creative-inspiration flag.`) }
    if (typeof item.creativeInspiration !== 'boolean') {
      return rejectItem('creative_inspiration_flag', 'invalid_shape', `${label} must indicate whether the source is used as creative inspiration.`)
    }
    let sourceId: string
    try { sourceId = exactSourceId(item.sourceId, `${label} source ID`) }
    catch { return rejectItem('source_id_exact', 'unknown_source', `${label} source ID must exactly identify one supplied catalog source.`) }
    if (usedIds.has(sourceId)) return rejectItem('source_id_unique', 'duplicate_source', `${label} must not repeat an evidence source.`)
    usedIds.add(sourceId)
    const matches = context.evidenceCatalog.get(sourceId) ?? []
    if (matches.length === 0) return rejectItem('source_id_supplied', 'unknown_source', `${label} references an unknown evidence source.`)
    if (matches.length !== 1 || !matches[0]) return rejectItem('source_id_unambiguous', 'ambiguous_source', `${label} references an ambiguous evidence source.`)
    const source = matches[0]
    const relationship = classifyEvidenceSource(source, item.creativeInspiration, `${label} source`, proposalType, fieldName)
    return { sourceType: source.sourceType, sourceId: source.sourceId, quote: source.sourceText, relationship, sourceLabel: source.sourceLabel }
  })
}

function validateUncertainty(item: Record<string, unknown>, value: Evidence[], label: string, context: ValidationContext) {
  const uncertainty = item.uncertainty as typeof uncertaintyValues[number]
  if (uncertainty === 'npc_claim' && !value.some((source) => (
    (source.sourceType === 'dm_narration' && attributedNarration(context.sources.get(source.sourceType)?.get(source.sourceId) ?? '', source.quote))
    || (source.sourceType === 'story_memory' && context.sourceUncertainty?.get(source.sourceId) === 'npc_claim')
  ))) {
    throw new WorldExpansionValidationError(`${label} cannot use NPC-claim uncertainty without an attributed NPC source.`)
  }
  for (const source of value) {
    if (source.sourceType === 'player_action' && uncertainty !== 'player_assertion' && uncertainty !== 'uncertain') {
      throw new WorldExpansionValidationError(`${label} cannot treat a player action or claim as an observed world fact.`)
    }
    if (source.sourceType === 'story_memory') {
      const original = context.sourceUncertainty?.get(source.sourceId)
      if (original && original !== 'observed' && uncertainty !== original && uncertainty !== 'uncertain') {
        throw new WorldExpansionValidationError(`${label} cannot promote an uncertain story memory to an observed fact.`)
      }
    }
    if (source.sourceType === 'dm_narration') {
      const sourceText = context.sources.get(source.sourceType)?.get(source.sourceId) ?? ''
      if (attributedNarration(sourceText, source.quote) && uncertainty !== 'npc_claim' && uncertainty !== 'uncertain') {
        throw new WorldExpansionValidationError(`${label} cannot turn an attributed NPC statement into an observed world fact.`)
      }
    }
    if (source.relationship === 'established_fact') {
      const sourceIsAuthoritative = source.sourceType === 'existing_entity'
        || (source.sourceType === 'story_memory' && context.sourceUncertainty?.get(source.sourceId) === 'observed')
        || source.sourceType === 'dm_narration'
      if (!sourceIsAuthoritative) {
        throw new WorldExpansionValidationError(`${label} cannot classify a claim, player statement, or uncertain memory as an established fact.`)
      }
      if (source.sourceType === 'dm_narration') {
        const sourceText = context.sources.get(source.sourceType)?.get(source.sourceId) ?? ''
        if (attributedNarration(sourceText, source.quote)) {
          throw new WorldExpansionValidationError(`${label} cannot classify an attributed narration quote as an established fact.`)
        }
      }
    }
    if (source.relationship === 'reported_claim') {
      const validClaimSource = source.sourceType === 'player_action'
        || (source.sourceType === 'story_memory' && context.sourceUncertainty?.get(source.sourceId) !== undefined && context.sourceUncertainty.get(source.sourceId) !== 'observed')
        || source.sourceType === 'dm_narration'
      if (!validClaimSource || uncertainty === 'observed') {
        throw new WorldExpansionValidationError(`${label} can label reported claims only when their source and uncertainty preserve the claim.`)
      }
      if (source.sourceType === 'dm_narration') {
        const sourceText = context.sources.get(source.sourceType)?.get(source.sourceId) ?? ''
        if (!attributedNarration(sourceText, source.quote)) {
          throw new WorldExpansionValidationError(`${label} can classify narration as a reported claim only when it is attributed in the source.`)
        }
      }
    }
  }
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function markDuplicates<T extends { key: string; evidence: Evidence[]; uncertainty: typeof uncertaintyValues[number] }>(
  proposals: T[], records: Array<{ id: string; name: string; evidenceText: string }>, getName: (proposal: T) => string,
): T[] {
  const seen = new Map<string, string>()
  return proposals.map((proposal) => {
    const name = getName(proposal)
    const normalized = normalizedName(name)
    const existing = records.find((record) => normalizedName(record.name) === normalized)
    const samePreview = seen.get(normalized)
    seen.set(normalized, proposal.key)
    if (existing) return { ...proposal, duplicateOf: { id: existing.id, name: existing.name } }
    if (samePreview) return { ...proposal, duplicateProposalKey: samePreview }
    return proposal
  })
}

function validateWorldExpansion(value: unknown, context: ValidationContext): WorldExpansion {
  const root = object(value, 'World expansion', ['npcs', 'locations', 'quests'])
  for (const group of ['npcs', 'locations', 'quests'] as const) {
    if (!Array.isArray(root[group]) || root[group].length > 1) throw new WorldExpansionValidationError(`World expansion ${group} must contain at most one proposal.`)
  }
  const allRaw = [...root.npcs as unknown[], ...root.locations as unknown[], ...root.quests as unknown[]]
  const rawKeys = allRaw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new WorldExpansionValidationError(`Proposal ${index + 1} must be an object.`)
    return key((entry as Record<string, unknown>).key, `Proposal ${index + 1} key`)
  })
  if (new Set(rawKeys).size !== rawKeys.length) throw new WorldExpansionValidationError('Temporary proposal keys must be unique.')
  const proposalTypes = new Map<string, EntityType>()
  for (const item of root.npcs as Array<Record<string, unknown>>) proposalTypes.set(String(item.key), 'npc')
  for (const item of root.locations as Array<Record<string, unknown>>) proposalTypes.set(String(item.key), 'location')
  for (const item of root.quests as Array<Record<string, unknown>>) proposalTypes.set(String(item.key), 'quest')
  const usedEvidence = (item: Record<string, unknown>, label: string, proposalType: EntityType) => evidence(item.evidence, `${label} evidence`, context, proposalType)
  const uncertainty = (item: Record<string, unknown>, label: string, evidenceValue: Evidence[]) => {
    if (!uncertaintyValues.includes(item.uncertainty as typeof uncertaintyValues[number])) throw new WorldExpansionValidationError(`${label} must preserve an uncertainty classification.`)
    validateUncertainty(item, evidenceValue, label, context)
    return item.uncertainty as typeof uncertaintyValues[number]
  }
  const npcs = (root.npcs as unknown[]).map((raw, index): NpcProposal => {
    const label = `NPC proposal ${index + 1}`
    const item = object(raw, label, ['key', 'name', 'description', 'role', 'personality', 'motivation', 'locationRef', 'relevance', 'evidence', 'uncertainty'])
    const evidenceValue = usedEvidence(item, label, 'npc')
    const description = text(item.description, `${label} description`, 10, 280)
    const relevance = text(item.relevance, `${label} relevance`, 10, 160)
    rejectHistoricalProposalLanguage([{ fieldName: 'description', value: description }, { fieldName: 'relevance', value: relevance }], 'npc', label, evidenceValue)
    return { key: key(item.key, `${label} key`), name: text(item.name, `${label} name`, 2, 100), description, role: text(item.role, `${label} role`, 2, 80), personality: text(item.personality, `${label} personality`, 2, 120), motivation: text(item.motivation, `${label} motivation`, 2, 140), locationRef: reference(item.locationRef, `${label} location`, 'location', proposalTypes, context), relevance, evidence: evidenceValue, uncertainty: uncertainty(item, label, evidenceValue) }
  })
  const locations = (root.locations as unknown[]).map((raw, index): LocationProposal => {
    const label = `Location proposal ${index + 1}`
    const item = object(raw, label, ['key', 'name', 'description', 'locationType', 'relatedLocationRef', 'narrativePurpose', 'evidence', 'uncertainty'])
    const evidenceValue = usedEvidence(item, label, 'location')
    const description = text(item.description, `${label} description`, 10, 280)
    const narrativePurpose = text(item.narrativePurpose, `${label} narrative purpose`, 10, 140)
    rejectHistoricalProposalLanguage([{ fieldName: 'description', value: description }, { fieldName: 'narrativePurpose', value: narrativePurpose }], 'location', label, evidenceValue)
    return { key: key(item.key, `${label} key`), name: text(item.name, `${label} name`, 2, 100), description, locationType: text(item.locationType, `${label} type`, 2, 60), relatedLocationRef: reference(item.relatedLocationRef, `${label} related location`, 'location', proposalTypes, context), narrativePurpose, evidence: evidenceValue, uncertainty: uncertainty(item, label, evidenceValue) }
  })
  const quests = (root.quests as unknown[]).map((raw, index): QuestProposal => {
    const label = `Quest proposal ${index + 1}`
    const item = object(raw, label, ['key', 'title', 'description', 'objectives', 'npcRefs', 'locationRefs', 'trigger', 'evidence', 'uncertainty'])
    if (!Array.isArray(item.objectives) || item.objectives.length < 1 || item.objectives.length > 2) throw new WorldExpansionValidationError(`${label} must contain one or two objectives.`)
    if (!Array.isArray(item.npcRefs) || item.npcRefs.length > 1 || !Array.isArray(item.locationRefs) || item.locationRefs.length > 1) throw new WorldExpansionValidationError(`${label} has too many or invalid entity references.`)
    const evidenceValue = usedEvidence(item, label, 'quest')
    const description = text(item.description, `${label} description`, 10, 280)
    const objectives = item.objectives.map((entry, objectiveIndex) => text(entry, `${label} objective ${objectiveIndex + 1}`, 5, 140))
    const trigger = text(item.trigger, `${label} trigger`, 5, 140)
    rejectHistoricalProposalLanguage([{ fieldName: 'description', value: description }, ...objectives.map((value, index) => ({ fieldName: `objectives[${index}]`, value })), { fieldName: 'trigger', value: trigger }], 'quest', label, evidenceValue)
    return { key: key(item.key, `${label} key`), title: text(item.title, `${label} title`, 3, 90), description, objectives, npcRefs: item.npcRefs.map((entry, refIndex) => reference(entry, `${label} NPC reference ${refIndex + 1}`, 'npc', proposalTypes, context)), locationRefs: item.locationRefs.map((entry, refIndex) => reference(entry, `${label} location reference ${refIndex + 1}`, 'location', proposalTypes, context)), trigger, evidence: evidenceValue, uncertainty: uncertainty(item, label, evidenceValue) }
  })
  const withDuplicates = {
    npcs: markDuplicates(npcs, context.existing.npc, (item) => item.name),
    locations: markDuplicates(locations, context.existing.location, (item) => item.name),
    quests: markDuplicates(quests, context.existing.quest, (item) => item.title),
  }
  return withDuplicates
}

// DM edits may change only creative fields. This function reuses the preview's
// original server-resolved evidence when applying the same text and historical
// language checks used for generated proposals.
function validateApprovedProposalContent(value: unknown): NpcProposal | LocationProposal | QuestProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorldExpansionValidationError('Approved proposal must be an object.')
  const proposal = value as Record<string, any>
  const evidenceValue = proposal.evidence as Evidence[]
  if (!Array.isArray(evidenceValue) || evidenceValue.length < 1 || evidenceValue.length > 3) throw new WorldExpansionValidationError('Approved proposal evidence is invalid.')
  if (Object.hasOwn(proposal, 'role')) {
    const description = text(proposal.description, 'NPC description', 10, 280)
    const relevance = text(proposal.relevance, 'NPC relevance', 10, 160)
    rejectHistoricalProposalLanguage([{ fieldName: 'description', value: description }, { fieldName: 'relevance', value: relevance }], 'npc', 'NPC proposal', evidenceValue)
    return { ...proposal, name: text(proposal.name, 'NPC name', 2, 100), description, role: text(proposal.role, 'NPC role', 2, 80), personality: text(proposal.personality, 'NPC personality', 2, 120), motivation: text(proposal.motivation, 'NPC motivation', 2, 140), relevance } as NpcProposal
  }
  if (Object.hasOwn(proposal, 'locationType')) {
    const description = text(proposal.description, 'Location description', 10, 280)
    const narrativePurpose = text(proposal.narrativePurpose, 'Location narrative purpose', 10, 140)
    rejectHistoricalProposalLanguage([{ fieldName: 'description', value: description }, { fieldName: 'narrativePurpose', value: narrativePurpose }], 'location', 'Location proposal', evidenceValue)
    return { ...proposal, name: text(proposal.name, 'Location name', 2, 100), description, locationType: text(proposal.locationType, 'Location type', 2, 60), narrativePurpose } as LocationProposal
  }
  if (Array.isArray(proposal.objectives)) {
    if (proposal.objectives.length < 1 || proposal.objectives.length > 2) throw new WorldExpansionValidationError('Quest must contain one or two objectives.')
    const description = text(proposal.description, 'Quest description', 10, 280)
    const objectives = proposal.objectives.map((entry: unknown, index: number) => text(entry, `Quest objective ${index + 1}`, 5, 140))
    const trigger = text(proposal.trigger, 'Quest trigger', 5, 140)
    rejectHistoricalProposalLanguage([{ fieldName: 'description', value: description }, ...objectives.map((value: string, index: number) => ({ fieldName: `objectives[${index}]`, value })), { fieldName: 'trigger', value: trigger }], 'quest', 'Quest proposal', evidenceValue)
    return { ...proposal, title: text(proposal.title, 'Quest title', 3, 90), description, objectives, trigger } as QuestProposal
  }
  throw new WorldExpansionValidationError('Approved proposal type is invalid.')
}

export = { worldExpansionJsonSchema, validateWorldExpansion, validateApprovedProposalContent, WorldExpansionValidationError }
