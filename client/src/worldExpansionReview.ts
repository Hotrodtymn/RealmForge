export type ProposalKind = 'npc' | 'location' | 'quest'
export type ReviewProposal = { key: string; name?: string; title?: string; role?: string; description: string; personality?: string; motivation?: string; relevance?: string; locationType?: string; narrativePurpose?: string; objectives?: string[]; trigger?: string; locationRef?: { type: 'proposal'; key: string } | { type: 'existing'; id: string } | null; relatedLocationRef?: { type: 'proposal'; key: string } | { type: 'existing'; id: string } | null; npcRefs?: Array<{ type: 'proposal'; key: string } | { type: 'existing'; id: string } | null>; locationRefs?: Array<{ type: 'proposal'; key: string } | { type: 'existing'; id: string } | null> }
export type ReviewState = { selectedKeys: Set<string>; savedEdits: Record<string, Record<string, unknown>>; editingKey: string | null; draft: Record<string, unknown> }
export type ReviewAction = { type: 'toggle'; key: string } | { type: 'edit'; key: string; values: Record<string, unknown> } | { type: 'change'; field: string; value: unknown } | { type: 'save-edit' } | { type: 'cancel-edit' } | { type: 'approved'; keys: string[] } | { type: 'reset' }
export type ApprovalEdit = Record<string, string | string[]>

export function createReviewState(): ReviewState {
  return { selectedKeys: new Set(), savedEdits: {}, editingKey: null, draft: {} }
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  if (action.type === 'reset') return createReviewState()
  if (action.type === 'toggle') {
    const selectedKeys = new Set(state.selectedKeys)
    selectedKeys.has(action.key) ? selectedKeys.delete(action.key) : selectedKeys.add(action.key)
    return { ...state, selectedKeys }
  }
  if (action.type === 'edit') return { ...state, editingKey: action.key, draft: { ...action.values } }
  if (action.type === 'change') return { ...state, draft: { ...state.draft, [action.field]: action.value } }
  if (action.type === 'save-edit') {
    if (!state.editingKey) return state
    return { ...state, savedEdits: { ...state.savedEdits, [state.editingKey]: { ...state.draft } }, editingKey: null, draft: {} }
  }
  if (action.type === 'cancel-edit') return { ...state, editingKey: null, draft: {} }
  const selectedKeys = new Set(state.selectedKeys)
  const savedEdits = { ...state.savedEdits }
  for (const key of action.keys) { selectedKeys.delete(key); delete savedEdits[key] }
  return { ...state, selectedKeys, savedEdits, editingKey: null, draft: {} }
}

export function proposalDisplayName(proposal: ReviewProposal): string { return proposal.title ?? proposal.name ?? 'Untitled proposal' }

export function proposalDependencies(proposal: ReviewProposal): string[] {
  const references = [proposal.locationRef, proposal.relatedLocationRef, ...(proposal.npcRefs ?? []), ...(proposal.locationRefs ?? [])]
  return [...new Set(references.flatMap((reference) => reference?.type === 'proposal' ? [reference.key] : []))]
}

export function dependencyProblems(proposals: ReviewProposal[], selectedKeys: Set<string>, approvedKeys: Set<string>): Array<{ proposalKey: string; dependencyKey: string }> {
  const known = new Set(proposals.map((proposal) => proposal.key))
  return proposals.filter((proposal) => selectedKeys.has(proposal.key)).flatMap((proposal) => proposalDependencies(proposal)
    .filter((key) => !approvedKeys.has(key) && (!known.has(key) || !selectedKeys.has(key)))
    .map((dependencyKey) => ({ proposalKey: proposal.key, dependencyKey })))
}

export function approvalPayload(previewId: string, adventureId: string, selectedKeys: Set<string>, savedEdits: Record<string, Record<string, unknown>>) {
  const edits = Object.fromEntries([...selectedKeys].filter((key) => savedEdits[key]).map((key) => [key, savedEdits[key]]))
  return { previewId, adventureId, selectedProposalKeys: [...selectedKeys], ...(Object.keys(edits).length ? { edits } : {}) }
}

export function approvalError(status: number, message?: string): string {
  if (status === 404) return 'This preview is unknown or belongs to another adventure. Generate a new preview before reviewing proposals.'
  if (status === 410) return 'This preview has expired. Generate a new preview to continue; no proposals were approved.'
  if (status === 503) return 'Approval storage is not available yet. Start the backend after its approved storage migration is installed, then generate a fresh preview.'
  if (status === 409) return message || 'The approval could not be completed. Check for proposals already approved or transaction conflicts; no partial changes were committed.'
  if (status === 400) return message || 'The selected proposals or edits need attention.'
  return message || `Approval failed (HTTP ${status}). No success was confirmed.`
}

export class ApprovalRequestError extends Error {
  readonly uncertain: boolean
  constructor(message: string, uncertain: boolean) { super(message); this.name = 'ApprovalRequestError'; this.uncertain = uncertain }
}

export async function submitApproval<T>(payload: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<T> {
  let response: Response
  let result: any
  try {
    response = await fetcher('http://localhost:3001/api/ai/world/expand/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    result = await response.json()
  } catch {
    throw new ApprovalRequestError('The connection failed while submitting approval. The outcome may be unknown; no request was retried. Check the adventure before deciding whether to try again.', true)
  }
  if (!response.ok) throw new ApprovalRequestError(approvalError(response.status, result?.error), false)
  return result as T
}

export function editableFields(kind: ProposalKind): Array<{ key: string; label: string; multiline?: boolean; list?: boolean }> {
  if (kind === 'npc') return [
    { key: 'name', label: 'Name' }, { key: 'description', label: 'Description', multiline: true }, { key: 'role', label: 'Role', multiline: true },
    { key: 'personality', label: 'Personality', multiline: true }, { key: 'motivation', label: 'Motivation', multiline: true }, { key: 'relevance', label: 'Story relevance', multiline: true },
  ]
  if (kind === 'location') return [
    { key: 'name', label: 'Name' }, { key: 'description', label: 'Description', multiline: true }, { key: 'locationType', label: 'Location type' }, { key: 'narrativePurpose', label: 'Narrative purpose', multiline: true },
  ]
  return [
    { key: 'title', label: 'Title' }, { key: 'description', label: 'Description', multiline: true }, { key: 'objectives', label: 'Objectives (one per line)', multiline: true, list: true }, { key: 'trigger', label: 'Narrative trigger', multiline: true },
  ]
}
