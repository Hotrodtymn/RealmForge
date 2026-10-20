import { useEffect, useMemo, useReducer, useState } from 'react'
import { approvalPayload, ApprovalRequestError, createReviewState, dependencyProblems, editableFields, proposalDependencies, proposalDisplayName, reviewReducer, submitApproval, type ProposalKind, type ReviewProposal } from './worldExpansionReview'

type SessionOption = { id: string; characterId: string; characterName: string; status: 'active' | 'paused' | 'completed' }
type Evidence = { sourceType: string; sourceId: string; sourceLabel: string; relationship: 'established_fact' | 'reported_claim' | 'creative_inspiration'; quote: string }
type Reference = { type: 'existing'; id: string } | { type: 'proposal'; key: string } | null
type BaseProposal = ReviewProposal & { key: string; evidence: Evidence[]; uncertainty: string; duplicateOf?: { id: string; name: string }; duplicateProposalKey?: string }
type NpcProposal = BaseProposal & { name: string; description: string; role: string; personality: string; motivation: string; locationRef: Reference; relevance: string }
type LocationProposal = BaseProposal & { name: string; description: string; locationType: string; relatedLocationRef: Reference; narrativePurpose: string }
type QuestProposal = BaseProposal & { title: string; description: string; objectives: string[]; npcRefs: Reference[]; locationRefs: Reference[]; trigger: string }
type Preview = { previewId: string; model: string; metadata: { previewOnly: true; proposalCount: number; expiresAt: string }; proposals: { npcs: NpcProposal[]; locations: LocationProposal[]; quests: QuestProposal[] } }
type ExistingLocation = { id: string; name: string }
type ExistingNpc = { id: string; name: string }
type ApprovalResponse = { approved: Array<{ proposalKey: string; type: ProposalKind; id: string; name: string }>; metadata: { remainingProposalKeys: string[]; expiresAt: string }; error?: string }
const API = 'http://localhost:3001/api'

function WorldExpansionPanel({ campaignId, adventureId, locations, npcs, onApproved }: { campaignId: string; adventureId: string; locations: ExistingLocation[]; npcs: ExistingNpc[]; onApproved: () => Promise<void> }) {
  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [sessionId, setSessionId] = useState('')
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pendingKeys, setPendingKeys] = useState<string[]>([])
  const [approvedKeys, setApprovedKeys] = useState<Set<string>>(new Set())
  const [review, dispatch] = useReducer(reviewReducer, undefined, createReviewState)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const selected = sessions.find((session) => session.id === sessionId)
  const allProposals = useMemo(() => preview ? [...preview.proposals.npcs, ...preview.proposals.locations, ...preview.proposals.quests] : [], [preview])
  const visibleProposals = allProposals.filter((proposal) => pendingKeys.includes(proposal.key))
  const problems = dependencyProblems(visibleProposals, review.selectedKeys, approvedKeys)

  useEffect(() => {
    let current = true
    setSessions([]); setSessionId(''); setPreview(null); setError(''); setNotice(''); setPendingKeys([]); setApprovedKeys(new Set()); dispatch({ type: 'reset' })
    if (!campaignId || !adventureId) return () => { current = false }
    setLoadingSessions(true)
    void fetch(`${API}/campaigns/${campaignId}/adventures/${adventureId}/sessions`)
      .then(async (response) => {
        const body = await response.json() as { sessions?: SessionOption[]; error?: string }
        if (!response.ok) throw new Error(body.error || 'Could not load sessions.')
        if (!current) return
        const available = (body.sessions ?? []).filter((session) => session.status === 'active' || session.status === 'paused')
        setSessions(available); setSessionId(available[0]?.id ?? '')
      })
      .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'Could not load sessions.') })
      .finally(() => { if (current) setLoadingSessions(false) })
    return () => { current = false }
  }, [campaignId, adventureId])

  const referenceName = (reference: Reference | undefined, type: 'location' | 'npc') => {
    if (!reference) return 'No linked location'
    if (reference.type === 'proposal') {
      const proposal = allProposals.find((item) => item.key === reference.key)
      return proposal ? `Proposed: ${proposalDisplayName(proposal)}` : `Proposed ${reference.key}`
    }
    const existing = type === 'location' ? locations.find((item) => item.id === reference.id) : npcs.find((item) => item.id === reference.id)
    return existing ? `Existing: ${existing.name}` : 'Existing entity'
  }

  const generate = async () => {
    if (!selected) return
    setGenerating(true); setError(''); setNotice(''); setPreview(null); setPendingKeys([]); setApprovedKeys(new Set()); setConfirmationOpen(false)
    dispatch({ type: 'reset' })
    try {
      const response = await fetch(`${API}/ai/world/expand/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adventureId, sessionId: selected.id, characterId: selected.characterId }) })
      const body = await response.json() as Preview & { error?: string; kind?: string }
      if (!response.ok) throw new Error(body.error || 'World expansion could not be generated.')
      setPreview(body); setPendingKeys([...body.proposals.npcs, ...body.proposals.locations, ...body.proposals.quests].map((proposal) => proposal.key))
      dispatch({ type: 'reset' })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'World expansion could not be generated.') }
    finally { setGenerating(false) }
  }

  const approve = async () => {
    if (!preview || !review.selectedKeys.size || problems.length) return
    setApproving(true); setError(''); setNotice(''); setConfirmationOpen(false)
    try {
      const body = approvalPayload(preview.previewId, adventureId, review.selectedKeys, review.savedEdits)
      const result = await submitApproval<ApprovalResponse>(body)
      const approved = result.approved ?? []
      const keys = approved.map((entry) => entry.proposalKey)
      setApprovedKeys((current) => new Set([...current, ...keys]))
      setPendingKeys(result.metadata.remainingProposalKeys)
      dispatch({ type: 'approved', keys })
      const summary = approved.map((entry) => `${entry.type}: ${entry.name}`).join(', ')
      setNotice(approved.length ? `Approved ${approved.length} proposal${approved.length === 1 ? '' : 's'}: ${summary}. Unselected proposals remain preview-only.` : 'Approval completed with no created entities reported.')
      try { await onApproved() } catch { setError('Approval succeeded, but the adventure lists could not refresh. Use the adventure refresh/reopen action to reload saved entities. Do not submit this approval again.') }
    } catch (cause) {
      if (cause instanceof ApprovalRequestError) setError(cause.message)
      else setError('Approval could not be completed. Check the adventure before deciding whether to try again.')
    } finally { setApproving(false) }
  }

  const renderEvidence = (items: Evidence[]) => <WorldExpansionEvidence items={items}/>
  const renderWarning = (proposal: BaseProposal) => proposal.duplicateOf
    ? <p className="world-expansion-warning" role="note">Possible duplicate of existing entity “{proposal.duplicateOf.name}”. This suggestion is not a replacement or update.</p>
    : proposal.duplicateProposalKey ? <p className="world-expansion-warning" role="note">Possible duplicate of proposal “{proposal.duplicateProposalKey}”.</p> : null

  const renderProposal = (kind: ProposalKind, proposal: BaseProposal) => {
    const fields = editableFields(kind)
    const displayed = { ...proposal, ...review.savedEdits[proposal.key] } as BaseProposal
    const title = proposalDisplayName(displayed)
    const editing = review.editingKey === proposal.key
    const dependencies = proposalDependencies(proposal)
    const references = kind === 'npc'
      ? [{ label: 'Location', value: referenceName(proposal.locationRef, 'location') }]
      : kind === 'location'
        ? [{ label: 'Related location', value: referenceName(proposal.relatedLocationRef, 'location') }]
        : [
          { label: 'Related NPCs', value: (proposal.npcRefs ?? []).map((ref) => referenceName(ref, 'npc')).join(', ') || 'None' },
          { label: 'Related locations', value: (proposal.locationRefs ?? []).map((ref) => referenceName(ref, 'location')).join(', ') || 'None' },
        ]
    return <article className="world-expansion-card review-card" key={proposal.key}>
      <ProposalNotice/>
      <div className="world-expansion-card-heading"><div><small>{kind.toUpperCase()} PROPOSAL</small><h4>{title}</h4></div><span className="world-expansion-uncertainty">{proposal.uncertainty.replaceAll('_', ' ')}</span></div>
      <label className="world-expansion-select"><input type="checkbox" checked={review.selectedKeys.has(proposal.key)} onChange={() => dispatch({ type: 'toggle', key: proposal.key })} disabled={approving || Boolean(review.editingKey)}/><span>Select for approval</span></label>
      {renderWarning(proposal)}
      {editing ? <div className="world-expansion-edit-form" aria-label={`Edit ${title}`}>
        <p>Unsaved review edits affect only this approval request. Evidence and provenance remain server-validated and cannot be edited.</p>
        {fields.map((field) => <label key={field.key}><span>{field.label}</span>{field.multiline
          ? <textarea rows={field.key === 'objectives' ? 4 : 3} value={field.list ? (Array.isArray(review.draft[field.key]) ? (review.draft[field.key] as string[]).join('\n') : '') : String(review.draft[field.key] ?? '')} onChange={(event) => dispatch({ type: 'change', field: field.key, value: field.list ? event.target.value.split('\n') : event.target.value })}/>
          : <input value={String(review.draft[field.key] ?? '')} onChange={(event) => dispatch({ type: 'change', field: field.key, value: event.target.value })}/>}</label>)}
        <div className="world-expansion-card-actions"><button type="button" className="text-button" onClick={() => dispatch({ type: 'save-edit' })}>Save Changes</button><button type="button" className="adventure-link-button" onClick={() => dispatch({ type: 'cancel-edit' })}>Cancel Editing</button></div>
      </div> : <>
        <p>{displayed.description}</p>
        {kind === 'npc' && <dl><div><dt>Role</dt><dd>{displayed.role}</dd></div><div><dt>Personality</dt><dd>{displayed.personality}</dd></div><div><dt>Motivation</dt><dd>{displayed.motivation}</dd></div><div><dt>Story relevance</dt><dd>{displayed.relevance}</dd></div></dl>}
        {kind === 'location' && <dl><div><dt>Type</dt><dd>{displayed.locationType}</dd></div><div><dt>Narrative purpose</dt><dd>{displayed.narrativePurpose}</dd></div></dl>}
        {kind === 'quest' && <><dl><div><dt>Narrative trigger</dt><dd>{displayed.trigger}</dd></div></dl><ol>{(displayed.objectives ?? []).map((objective, index) => <li key={`${proposal.key}-${index}`}>{objective}</li>)}</ol></>}
        {dependencies.length > 0 && <p className="world-expansion-dependency" role="note">References proposed entities: {dependencies.map((key) => proposalDisplayName(allProposals.find((item) => item.key === key) ?? { key, description: '' })).join(', ')}. Select those proposals too, or approve them first.</p>}
        <button type="button" className="adventure-link-button" onClick={() => dispatch({ type: 'edit', key: proposal.key, values: Object.fromEntries(fields.map((field) => { const value = review.savedEdits[proposal.key]?.[field.key] ?? (proposal as any)[field.key]; return [field.key, field.list ? [...((value as string[] | undefined) ?? [])] : String(value ?? '')] })) })} disabled={approving || Boolean(review.editingKey)}>Edit proposal</button>
      </>}
      <dl className="world-expansion-reference-list">{references.map((reference) => <div key={reference.label}><dt>{reference.label}</dt><dd>{reference.value}</dd></div>)}</dl>
      {renderEvidence(proposal.evidence)}
    </article>
  }

  return <section className="world-expansion-panel" aria-labelledby="world-expansion-title">
    <div className="world-expansion-header"><div><small>AI WORLD EXPANSION · REVIEW</small><h3 id="world-expansion-title">Grounded suggestions</h3><p>Suggestions use the selected session’s saved conversation and story memories. Preview content is not saved until you explicitly approve selected proposals.</p><p className="world-expansion-grounding-note">Evidence describes established context, a reported claim, or creative inspiration. A citation does not establish that a proposed character, place, quest, or event already exists.</p></div></div>
    <div className="world-expansion-controls">
      <label><span>Session and character</span><select value={sessionId} onChange={(event) => { setSessionId(event.target.value); setPreview(null); setPendingKeys([]); setApprovedKeys(new Set()); setError(''); setNotice(''); setConfirmationOpen(false); dispatch({ type: 'reset' }) }} disabled={loadingSessions || generating || approving}>
        <option value="">{loadingSessions ? 'Loading sessions…' : sessions.length ? 'Choose a session' : 'No active or paused sessions'}</option>
        {sessions.map((session) => <option key={session.id} value={session.id}>{session.characterName} · {session.status}</option>)}
      </select></label>
      <button type="button" className="text-button" onClick={() => void generate()} disabled={!selected || generating || approving}>{generating ? 'Gathering story threads…' : preview ? 'Generate New Preview' : '✧ Generate World Expansion'}</button>
    </div>
    {error && <p className="world-expansion-error" role="alert">{error}</p>}
    {notice && <p className="world-expansion-success" role="status">{notice}</p>}
    {generating && <p className="adventure-empty-inline" role="status">Ollama is reviewing the selected adventure context. This may take a little while.</p>}
    {preview && <div className="world-expansion-results" aria-live="polite">
      <div className="world-expansion-result-heading"><span>{pendingKeys.length} pending proposal{pendingKeys.length === 1 ? '' : 's'} · {preview.model} · expires {new Date(preview.metadata.expiresAt).toLocaleString()}</span><strong>REVIEW REQUIRED · NOT SAVED</strong></div>
      {visibleProposals.map((proposal) => renderProposal('role' in proposal ? 'npc' : 'locationType' in proposal ? 'location' : 'quest', proposal as BaseProposal))}
      {pendingKeys.length === 0 && <p className="adventure-empty-inline">All proposals in this preview have been approved or there were no grounded additions.</p>}
      {pendingKeys.length > 0 && <div className="world-expansion-approval">
        {problems.length > 0 && <div className="world-expansion-dependency" role="alert"><strong>Resolve proposal dependencies:</strong><ul>{problems.map((item) => <li key={`${item.proposalKey}-${item.dependencyKey}`}>{proposalDisplayName(allProposals.find((proposal) => proposal.key === item.proposalKey) ?? { key: item.proposalKey, description: '' })} requires {proposalDisplayName(allProposals.find((proposal) => proposal.key === item.dependencyKey) ?? { key: item.dependencyKey, description: '' })}. Select that proposal or approve it first.</li>)}</ul></div>}
        <button type="button" className="section-create-button" disabled={!review.selectedKeys.size || problems.length > 0 || approving} onClick={() => setConfirmationOpen(true)}>Review and Approve ({review.selectedKeys.size})</button>
      </div>}
      {confirmationOpen && <div className="world-expansion-confirm" role="dialog" aria-modal="true" aria-labelledby="world-expansion-confirm-title">
        <h4 id="world-expansion-confirm-title">Confirm selected proposals</h4><p>{review.selectedKeys.size} proposal{review.selectedKeys.size === 1 ? '' : 's'} will be saved to this adventure:</p>
        <ul>{visibleProposals.filter((proposal) => review.selectedKeys.has(proposal.key)).map((proposal) => <li key={proposal.key}><strong>{proposalDisplayName({ ...proposal, ...review.savedEdits[proposal.key] })}</strong> · {'role' in proposal ? 'NPC' : 'locationType' in proposal ? 'Location' : 'Quest'}{proposalDependencies(proposal).length > 0 && <span> · depends on {proposalDependencies(proposal).map((key) => proposalDisplayName(allProposals.find((item) => item.key === key) ?? { key, description: '' })).join(', ')}</span>}</li>)}</ul>
        <p>Only these selected proposals and saved creative edits will be submitted. Evidence, provenance, and uncertainty remain unchanged.</p>
        <div className="world-expansion-card-actions"><button type="button" className="cancel-button" onClick={() => setConfirmationOpen(false)} disabled={approving}>Cancel</button><button type="button" className="section-create-button" onClick={() => void approve()} disabled={approving || !review.selectedKeys.size || problems.length > 0}>{approving ? 'Saving proposals…' : 'Confirm approval'}</button></div>
      </div>}
    </div>}
    <small className="world-expansion-disclaimer">Preview-only proposals remain unsaved unless explicitly selected and approved. A backend restart or expiration invalidates the preview.</small>
  </section>
}

export default WorldExpansionPanel

export function WorldExpansionEvidence({ items }: { items: Evidence[] }) {
  return <div className="world-expansion-evidence"><strong>Evidence and provenance</strong>{items.map((item, index) => <blockquote className={`relationship-${item.relationship}`} key={`${item.sourceType}-${item.sourceId}-${index}`}>{item.quote}<span className="world-expansion-relationship">{relationshipLabel(item.relationship)}</span><small>{item.sourceLabel} · Provenance: {item.sourceType.replaceAll('_', ' ')}</small></blockquote>)}</div>
}

export function ProposalNotice() { return <p className="world-expansion-proposal-note" role="note">New creative proposal · not established campaign history</p> }
function relationshipLabel(value: Evidence['relationship']) { return value.replaceAll('_', ' ') }
