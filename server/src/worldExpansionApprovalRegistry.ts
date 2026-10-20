import crypto = require('node:crypto')
import readOllamaConfig = require('./ollamaConfig')
import proposalSchema = require('./worldExpansionSchema')

type PreviewSnapshot = {
  adventureId: string
  sessionId: string
  model: string
  generatedAt: string
  proposals: ReturnType<typeof proposalSchema.validateWorldExpansion>
}
type Proposal = PreviewSnapshot['proposals']['npcs'][number] | PreviewSnapshot['proposals']['locations'][number] | PreviewSnapshot['proposals']['quests'][number]
type PreviewRecord = {
  snapshot: PreviewSnapshot
  expiresAt: number
  approvedKeys: Set<string>
  approving: boolean
}

class ApprovalPreviewError extends Error {
  constructor(readonly code: 'invalid' | 'expired' | 'adventure' | 'unknown-proposal' | 'duplicate-selection' | 'already-approved' | 'empty-selection' | 'in-progress' | 'capacity', message: string) {
    super(message)
    this.name = 'ApprovalPreviewError'
  }
}

class WorldExpansionApprovalRegistry {
  private readonly records = new Map<string, PreviewRecord>()
  private readonly expired = new Map<string, number>()

  constructor(private readonly options: { ttlMs?: number; maxEntries?: number; now?: () => number; tokenFactory?: () => string } = {}) {}
  private get ttlMs() { return this.options.ttlMs ?? readOllamaConfig().worldPreviewTokenTtlMs }
  private get maxEntries() { return this.options.maxEntries ?? readOllamaConfig().worldPreviewTokenMaxEntries }
  private now() { return this.options.now?.() ?? Date.now() }

  private prune(now: number) {
    for (const [token, expiry] of this.expired) if (expiry <= now) this.expired.delete(token)
    for (const [token, record] of this.records) {
      if (record.expiresAt <= now && !record.approving) {
        this.records.delete(token)
        this.expired.set(token, now + this.ttlMs)
      }
    }
    while (this.expired.size > this.maxEntries) this.expired.delete(this.expired.keys().next().value as string)
  }

  issue(snapshot: PreviewSnapshot) {
    const now = this.now()
    this.prune(now)
    if (this.records.size >= this.maxEntries) throw new ApprovalPreviewError('capacity', 'The local World Expansion preview registry is full. Wait for a preview to expire.')
    const token = this.options.tokenFactory?.() ?? crypto.randomBytes(32).toString('base64url')
    const expiresAt = now + this.ttlMs
    this.records.set(token, { snapshot, expiresAt, approvedKeys: new Set(), approving: false })
    return { previewId: token, expiresAt: new Date(expiresAt).toISOString() }
  }

  approve<T>(previewId: unknown, adventureId: string, proposalKeys: unknown, persist: (snapshot: PreviewSnapshot, proposals: Proposal[], previewId: string, previouslyApprovedKeys: ReadonlySet<string>) => T) {
    if (typeof previewId !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(previewId)) throw new ApprovalPreviewError('invalid', 'Preview ID is invalid or unknown.')
    const now = this.now()
    const current = this.records.get(previewId)
    if (current && current.expiresAt <= now) {
      this.records.delete(previewId)
      this.expired.set(previewId, now + this.ttlMs)
      throw new ApprovalPreviewError('expired', 'This World Expansion preview has expired. Generate a new preview.')
    }
    this.prune(now)
    const record = this.records.get(previewId)
    if (!record) {
      if (this.expired.has(previewId)) throw new ApprovalPreviewError('expired', 'This World Expansion preview has expired. Generate a new preview.')
      throw new ApprovalPreviewError('invalid', 'Preview ID is invalid or unknown.')
    }
    if (record.snapshot.adventureId !== adventureId) throw new ApprovalPreviewError('adventure', 'Preview does not belong to this adventure.')
    if (!Array.isArray(proposalKeys) || proposalKeys.length === 0) throw new ApprovalPreviewError('empty-selection', 'Select at least one proposal to approve.')
    if (proposalKeys.length > 3 || proposalKeys.some((key) => typeof key !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(key))) {
      throw new ApprovalPreviewError('unknown-proposal', 'Selected proposal keys are invalid.')
    }
    const keys = proposalKeys as string[]
    if (new Set(keys).size !== keys.length) throw new ApprovalPreviewError('duplicate-selection', 'A proposal may be selected only once.')
    const all = [...record.snapshot.proposals.npcs, ...record.snapshot.proposals.locations, ...record.snapshot.proposals.quests] as Proposal[]
    const byKey = new Map(all.map((proposal) => [proposal.key, proposal]))
    const selected = keys.map((key) => {
      const proposal = byKey.get(key)
      if (!proposal) throw new ApprovalPreviewError('unknown-proposal', 'A selected proposal is not part of this preview.')
      if (record.approvedKeys.has(key)) throw new ApprovalPreviewError('already-approved', 'A selected proposal was already approved.')
      return proposal
    })
    if (record.approving) throw new ApprovalPreviewError('in-progress', 'This preview is already being approved.')
    record.approving = true
    try {
      const value = persist(record.snapshot, selected, previewId, new Set(record.approvedKeys))
      for (const key of keys) record.approvedKeys.add(key)
      const remainingProposalKeys = all.filter((proposal) => !record.approvedKeys.has(proposal.key)).map((proposal) => proposal.key)
      return { value, replayed: false, remainingProposalKeys, expiresAt: new Date(record.expiresAt).toISOString() }
    } finally {
      record.approving = false
    }
  }
}

const worldExpansionApprovalRegistry = new WorldExpansionApprovalRegistry()
export = { WorldExpansionApprovalRegistry, ApprovalPreviewError, worldExpansionApprovalRegistry }
