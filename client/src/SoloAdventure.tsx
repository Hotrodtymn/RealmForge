import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { canRecordDecision, chooseSession, playerCharacterSummary, sceneSelection } from './soloAdventureView.mjs'
import SessionConversation from './SessionConversation'
import './SoloAdventure.css'

type Campaign = { id: string; name: string; setting?: string }
type Character = { id: string; name: string; species: string; characterClass: string; level: number; status: string }
type Player = { playerId: string; displayName: string; characters: Character[] }
type Adventure = { id: string; campaignId: string; title: string; description: string; status: string; startingLocation: string }
type Place = { id: string; name: string; description: string; locationType: string; connections?: Place[] }
type Npc = { id: string; name: string; description: string; personality: string; disposition: string; currentLocationId: string | null }
type Session = { id: string; campaignId: string; adventureId: string; characterId: string; characterName: string; status: 'active'|'paused'|'completed'; startedAt: string; lastActivityAt: string; completedAt: string | null }
type Scene = { id: string; locationId: string | null; locationName: string | null; title: string; description: string; status: string; sequence: number; createdAt: string; completedAt: string | null }
type Journal = { sequence: number; eventType: string; sceneId: string | null; createdAt: string; details: Record<string, unknown> }
type AiTurn = { id: string; sessionId: string; characterId: string; clientTurnId: string; action: string; response: string | null; status: 'pending' | 'completed' | 'failed'; createdAt: string; updatedAt: string; completedAt: string | null }
type SpellSlot = { level: number; maximum: number; remaining: number; expended: number }
type PlayerContext = {
  session: { id: string; status: Session['status']; startedAt: string; lastActivityAt: string }
  adventure: { id: string; title: string; summary: string }
  character: { id: string; name: string; species: string; class: string; level: number } | null
  currentScene: Scene | null; scenes: Scene[]
  currentLocation: { id: string; name: string; description: string; type: string } | null
  connectedLocations: { id: string; name: string; description: string; type: string }[]
  visibleNpcs: { id: string; name: string; description: string; personality: string; disposition: string }[]
  recentJournalEvents: Journal[]
}
type Payload = { error?: string; fields?: Record<string, string> }
const API = 'http://localhost:3001/api'
const eventLabels: Record<string, string> = { session_started: 'Session started', session_paused: 'Session paused', session_resumed: 'Session resumed', session_completed: 'Session completed', scene_entered: 'Scene entered', scene_completed: 'Scene completed', player_decision_recorded: 'Player decision', location_changed: 'Location changed' }
const requestKey = () => crypto.randomUUID()
async function read<T>(response: Response): Promise<T & Payload> { return await response.json() as T & Payload }

function SoloAdventure({ campaigns, onReturnToManagement, onOpenRoster, playerMode = false, welcomeMessage = 'Welcome, Adventurer.', initialSelection }: { campaigns: Campaign[]; onReturnToManagement: () => void; onOpenRoster: (campaignId: string) => void; playerMode?: boolean; welcomeMessage?: string; initialSelection?: { campaignId: string; adventureId: string; sessionId: string } }) {
  const initialCampaignId = initialSelection?.campaignId ?? ''
  const initialAdventureId = initialSelection?.adventureId ?? ''
  const initialSessionId = initialSelection?.sessionId ?? ''
  const [campaignId, setCampaignId] = useState(() => initialCampaignId)
  const [adventures, setAdventures] = useState<Adventure[]>([])
  const [adventureId, setAdventureId] = useState(() => initialAdventureId)
  const [adventure, setAdventure] = useState<Adventure | null>(null)
  const [places, setPlaces] = useState<Place[]>([])
  const [npcs, setNpcs] = useState<Npc[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionId, setSessionId] = useState(() => initialSessionId)
  const [session, setSession] = useState<Session | null>(null)
  const [playerContext, setPlayerContext] = useState<PlayerContext | null>(null)
  const [characterId, setCharacterId] = useState('')
  const [startLocationId, setStartLocationId] = useState('')
  const [decision, setDecision] = useState('')
  const [aiAction, setAiAction] = useState('')
  const [aiTurns, setAiTurns] = useState<AiTurn[]>([])
  const [aiTurnsLoading, setAiTurnsLoading] = useState(false)
  const [aiTurnsLoadError, setAiTurnsLoadError] = useState('')
  const [aiTurnBusy, setAiTurnBusy] = useState(false)
  const [aiTurnError, setAiTurnError] = useState('')
  const aiTurnRequest = useRef<{ action: string; clientTurnId: string } | null>(null)
  const aiTurnBusyRef = useRef(false)
  const [selectedSceneId, setSelectedSceneId] = useState('')
  const [loading, setLoading] = useState(false)
  const [campaignRetry, setCampaignRetry] = useState(0)
  const [adventureRetry, setAdventureRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [decisionBusy, setDecisionBusy] = useState(false)
  const decisionBusyRef = useRef(false)
  const [spellSlots, setSpellSlots] = useState<SpellSlot[] | null>(null)
  const [spellSlotsLoading, setSpellSlotsLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const campaign = campaigns.find((item) => item.id === campaignId)
  const characters = useMemo(() => players.flatMap((player) => player.characters.map((character) => ({ ...character, playerId: player.playerId, playerName: player.displayName }))), [players])
  const route = `${API}/campaigns/${campaignId}`
  const sceneView = sceneSelection(playerContext?.scenes ?? [], playerContext?.currentScene ?? null, selectedSceneId)
  const selectedScene = sceneView.scene
  const viewingCurrentScene = sceneView.isCurrent
  const decisionEnabled = canRecordDecision(session?.status ?? '', viewingCurrentScene, decision, decisionBusy)

  const loadContext = useCallback(async (id: string) => {
    if (!id || !campaignId) { setPlayerContext(null); setSession(null); return }
    setLoading(true); setError('')
    try {
      const response = await fetch(`${route}/sessions/${id}/context`)
      const result = await read<{ context?: PlayerContext }>(response)
      if (!response.ok || !result.context) throw new Error(result.error || 'Could not open the player-safe session view.')
      setPlayerContext(result.context)
      const current = sessions.find((item) => item.id === id)
      setSession(current ?? { id, campaignId, adventureId, characterId: result.context.character?.id ?? '', characterName: result.context.character?.name ?? 'Adventurer', status: result.context.session.status, startedAt: result.context.session.startedAt, lastActivityAt: result.context.session.lastActivityAt, completedAt: null })
      setSelectedSceneId(result.context.currentScene?.id ?? '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load session.') }
    finally { setLoading(false) }
  }, [adventureId, campaignId, route, sessions])

  useEffect(() => {
    if (!campaigns.length) { setCampaignId(''); return }
    if (!campaigns.some((item) => item.id === campaignId)) setCampaignId(campaigns.find((item) => item.id === initialCampaignId)?.id ?? campaigns[0]!.id)
  }, [campaigns, campaignId, initialCampaignId])

  useEffect(() => {
    let cancelled = false
    async function loadCampaign() {
      if (!campaignId) return
      setLoading(true); setError(''); setNotice(''); setSessionId(''); setPlayerContext(null); setSession(null)
      try {
        const [adventureResponse, rosterResponse] = await Promise.all([fetch(`${route}/adventures`), fetch(`${route}/players`)] )
        const [adventureResult, rosterResult] = await Promise.all([read<{ adventures?: Adventure[] }>(adventureResponse), read<{ players?: Omit<Player, 'characters'>[] }>(rosterResponse)])
        if (!adventureResponse.ok) throw new Error(adventureResult.error || 'Could not load adventures.')
        if (!rosterResponse.ok) throw new Error(rosterResult.error || 'Could not load campaign roster.')
        const roster = await Promise.all((rosterResult.players ?? []).map(async (player) => {
          const response = await fetch(`${route}/players/${player.playerId}/characters`)
          const result = await read<{ characters?: Character[] }>(response)
          if (!response.ok) throw new Error(result.error || 'Could not load campaign characters.')
          return { ...player, characters: result.characters ?? [] }
        }))
        if (cancelled) return
        setAdventures(adventureResult.adventures ?? []); setPlayers(roster)
        const available = roster.flatMap((player) => player.characters)
        setCharacterId((current) => available.some((item) => item.id === current) ? current : (available.find((item) => item.status === 'active')?.id ?? available[0]?.id ?? ''))
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load campaign data.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void loadCampaign()
    return () => { cancelled = true }
  }, [campaignId, campaignRetry, route])

  useEffect(() => {
    let cancelled = false
    async function loadAdventure() {
      if (!campaignId || !adventureId) { setAdventure(null); setPlaces([]); setNpcs([]); setSessions([]); setSessionId(''); setSession(null); setPlayerContext(null); return }
      setLoading(true); setError(''); setSessionId(''); setSession(null); setPlayerContext(null)
      try {
        const [viewResponse, sessionsResponse] = await Promise.all([fetch(`${route}/adventures/${adventureId}/player-view`), fetch(`${route}/adventures/${adventureId}/sessions`)])
        const [view, list] = await Promise.all([read<{ adventure?: Adventure; locations?: Place[]; npcs?: Npc[] }>(viewResponse), read<{ sessions?: Session[] }>(sessionsResponse)])
        if (!viewResponse.ok || !view.adventure) throw new Error(view.error || 'Could not load this adventure.')
        if (!sessionsResponse.ok) throw new Error(list.error || 'Could not load sessions.')
        if (cancelled) return
        setAdventure(view.adventure); setPlaces(view.locations ?? []); setNpcs(view.npcs ?? []); setSessions(list.sessions ?? [])
        const match = (view.locations ?? []).find((place) => place.name.toLocaleLowerCase() === view.adventure!.startingLocation.trim().toLocaleLowerCase())
        setStartLocationId((current) => (view.locations ?? []).some((place) => place.id === current) ? current : (match?.id ?? ''))
        const rows = list.sessions ?? []
        const requestedSession = campaignId === initialCampaignId && adventureId === initialAdventureId ? initialSessionId : ''
        setSessionId(requestedSession && rows.some((item) => item.id === requestedSession) ? requestedSession : chooseSession(rows))
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load adventure sessions.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void loadAdventure()
    return () => { cancelled = true }
  }, [adventureId, adventureRetry, campaignId, initialAdventureId, initialCampaignId, initialSessionId, route])

  useEffect(() => { if (sessionId) void loadContext(sessionId); else { setSession(null); setPlayerContext(null) } }, [sessionId, loadContext])

  useEffect(() => {
    setAiTurns([]); setAiAction(''); setAiTurnError(''); setAiTurnsLoadError(''); aiTurnRequest.current = null
    setSession(null); setPlayerContext(null); setAiTurnsLoading(Boolean(sessionId))
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || !session || session.id !== sessionId || !session.characterId) return
    const controller = new AbortController()
    setAiTurnsLoading(true); setAiTurnsLoadError('')
    fetch(`${API}/ai/session/${sessionId}/turns?characterId=${encodeURIComponent(session.characterId)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await read<{ turns?: AiTurn[] }>(response)
        if (!response.ok) throw new Error(result.error || 'Could not load this session conversation.')
        setAiTurnsLoadError('')
        setAiTurns(Array.isArray(result.turns) ? result.turns : [])
      })
      .catch((cause) => { if (!controller.signal.aborted) setAiTurnsLoadError(cause instanceof Error ? cause.message : 'Could not load this session conversation.') })
      .finally(() => { if (!controller.signal.aborted) setAiTurnsLoading(false) })
    return () => controller.abort()
  }, [sessionId, session?.id, session?.characterId])

  const refreshSession = async (id = sessionId) => {
    const [contextResponse, listResponse] = await Promise.all([fetch(`${route}/sessions/${id}/context`), fetch(`${route}/adventures/${adventureId}/sessions`)] )
    const [contextResult, listResult] = await Promise.all([read<{ context?: PlayerContext }>(contextResponse), read<{ sessions?: Session[] }>(listResponse)])
    if (!contextResponse.ok || !contextResult.context) throw new Error(contextResult.error || 'Could not refresh session.')
    if (!listResponse.ok) throw new Error(listResult.error || 'Could not refresh session list.')
    const rows = listResult.sessions ?? []
    setSessions(rows); setSession(rows.find((item) => item.id === id) ?? null); setPlayerContext(contextResult.context)
    setSelectedSceneId(contextResult.context.currentScene?.id ?? '')
  }

  const startSession = async (event: FormEvent) => {
    event.preventDefault(); if (!campaignId || !adventureId || !characterId) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${route}/adventures/${adventureId}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestKey(), characterId, locationId: startLocationId || null }) })
      const result = await read<{ session?: Session }>(response)
      if (!response.ok || !result.session) throw new Error(result.error || 'Could not start session.')
      setNotice('Your session is ready.'); setSessionId(result.session.id); setSessions((rows) => [result.session!, ...rows.filter((row) => row.id !== result.session!.id)])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start session.') }
    finally { setBusy(false) }
  }


  const loadTurns = async (id: string, selectedCharacterId: string) => {
    setAiTurnsLoading(true); setAiTurnsLoadError('')
    try {
      const response = await fetch(`${API}/ai/session/${id}/turns?characterId=${encodeURIComponent(selectedCharacterId)}`)
      const result = await read<{ turns?: AiTurn[] }>(response)
      if (!response.ok) throw new Error(result.error || 'Could not load this session conversation.')
      setAiTurns(Array.isArray(result.turns) ? result.turns : [])
    } catch (cause) { setAiTurnsLoadError(cause instanceof Error ? cause.message : 'Could not load this session conversation.') }
    finally { setAiTurnsLoading(false) }
  }

  const submitAiAction = async (event?: FormEvent, retry = false, retryTurn?: AiTurn) => {
    event?.preventDefault()
    const actionText = retryTurn?.action ?? aiAction
    if (!session || !playerContext?.character?.id || session.status !== 'active' || !viewingCurrentScene || aiTurnBusyRef.current || !actionText.trim()) return
    let request = retryTurn ? { action: retryTurn.action, clientTurnId: retryTurn.clientTurnId } : aiTurnRequest.current
    if (!retry || !request || request.action !== actionText.trim()) {
      request = { action: actionText.trim(), clientTurnId: requestKey() }
      aiTurnRequest.current = request
    }
    aiTurnBusyRef.current = true
    setAiTurnBusy(true); setAiTurnError('')
    const optimistic: AiTurn = { id: request.clientTurnId, sessionId: session.id, characterId: playerContext.character.id, clientTurnId: request.clientTurnId, action: request.action, response: null, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null }
    setAiTurns((rows) => rows.some((turn) => turn.clientTurnId === optimistic.clientTurnId) ? rows : [...rows, optimistic])
    try {
      const response = await fetch(`${API}/ai/session/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, characterId: playerContext.character.id, action: request.action, clientTurnId: request.clientTurnId }) })
      const result = await read<{ turn?: AiTurn }>(response)
      if (!response.ok || !result.turn) throw new Error(result.error || Object.values(result.fields ?? {}).join(' ') || 'The Dungeon Master could not complete this action.')
      setAiTurns((rows) => [...rows.filter((turn) => turn.clientTurnId !== result.turn!.clientTurnId), result.turn!].sort((left, right) => left.createdAt.localeCompare(right.createdAt)))
      setAiAction((current) => current.trim() === request!.action ? '' : current); aiTurnRequest.current = null
    } catch (cause) {
      setAiTurnError(cause instanceof Error ? cause.message : 'The Dungeon Master could not complete this action. Your action is retained for a safe retry.')
      try {
        const transcriptResponse = await fetch(`${API}/ai/session/${session.id}/turns?characterId=${encodeURIComponent(playerContext.character.id)}`)
        const transcript = await read<{ turns?: AiTurn[] }>(transcriptResponse)
        if (transcriptResponse.ok && transcript.turns) setAiTurns(transcript.turns)
      } catch { /* Keep the optimistic pending turn visible until retry or reload. */ }
    } finally { aiTurnBusyRef.current = false; setAiTurnBusy(false) }
  }

  const lifecycle = async (action: 'pause'|'resume'|'complete') => {
    if (!session) return
    if (action === 'complete' && !window.confirm('Complete this adventure session? Its scenes and journal will remain available as read-only history.')) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${route}/sessions/${session.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestKey() }) })
      const result = await read<{ session?: Session }>(response)
      if (!response.ok) throw new Error(result.error || `Could not ${action} this session.`)
      await refreshSession(session.id); setNotice(`Session ${action === 'complete' ? 'completed' : action === 'pause' ? 'paused' : 'resumed'}.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update session.') }
    finally { setBusy(false) }
  }

  const submitDecision = async (event: FormEvent) => {
    event.preventDefault(); if (!session || session.status !== 'active' || !decision.trim() || decisionBusyRef.current) return
    decisionBusyRef.current = true
    setDecisionBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${route}/sessions/${session.id}/decisions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestKey(), decisionText: decision }) })
      const result = await read<{ decision?: { decisionText: string } }>(response)
      if (!response.ok) throw new Error(result.error || Object.values(result.fields ?? {}).join(' ') || 'Could not record that decision.')
      setDecision(''); await refreshSession(session.id); setNotice('Decision recorded in the current scene.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record that decision.') }
    finally { decisionBusyRef.current = false; setDecisionBusy(false) }
  }

  const moveTo = async (place: PlayerContext['connectedLocations'][number]) => {
    if (!session || !playerContext?.currentScene || session.status !== 'active' || !viewingCurrentScene || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`${route}/sessions/${session.id}/scenes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: requestKey(), locationId: place.id, title: place.name, description: place.description }) })
      const result = await read<{ session?: Session }>(response)
      if (!response.ok) throw new Error(result.error || 'Could not enter that location. Movement must follow a recorded connection.')
      await refreshSession(session.id); setNotice(`Entered ${place.name}.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not move to that location.') }
    finally { setBusy(false) }
  }

  const currentCharacter = characters.find((item) => item.id === playerContext?.character?.id)
  const characterSummary = playerCharacterSummary(playerContext?.character ?? null)
  const currentNpcs = (playerContext?.visibleNpcs ?? []).length ? playerContext!.visibleNpcs : npcs.filter((npc) => npc.currentLocationId === playerContext?.currentLocation?.id)
  const changeCampaign = (id: string) => { setCampaignId(id); setAdventureId(''); setSessionId(''); setSession(null); setPlayerContext(null); setAdventure(null); setSessions([]) }
  const locationChangeLabel = (entry: Journal) => {
    const fromId = typeof entry.details.fromLocationId === 'string' ? entry.details.fromLocationId : ''
    const toId = typeof entry.details.toLocationId === 'string' ? entry.details.toLocationId : ''
    const from = places.find((place) => place.id === fromId)?.name ?? (fromId ? 'Previous location' : 'Starting point')
    const to = places.find((place) => place.id === toId)?.name ?? (toId ? 'Location' : 'Unassigned')
    return `${from} → ${to}`
  }

  useEffect(() => {
    let cancelled = false
    async function loadSpellSlots() {
      if (!campaignId || !currentCharacter?.playerId || !currentCharacter.id) { setSpellSlots(null); return }
      setSpellSlotsLoading(true)
      try {
        const response = await fetch(`${API}/campaigns/${campaignId}/players/${currentCharacter.playerId}/characters/${currentCharacter.id}/spellcasting`)
        const result = await read<{ slots?: SpellSlot[] }>(response)
        if (!response.ok) throw new Error(result.error || 'Spell slots unavailable.')
        if (!cancelled) setSpellSlots(result.slots ?? [])
      } catch { if (!cancelled) setSpellSlots(null) }
      finally { if (!cancelled) setSpellSlotsLoading(false) }
    }
    void loadSpellSlots()
    return () => { cancelled = true }
  }, [campaignId, currentCharacter?.id, currentCharacter?.playerId])

  return <section className="solo-page" aria-labelledby="solo-heading">
    <div className="solo-topline"><div><span className="solo-kicker">PLAYER VIEW · NO DM NOTES</span><h1 id="solo-heading">{playerMode ? welcomeMessage : "Solo Adventure"}</h1><p>Enter a saved session, record a choice, and follow the path through the story.</p></div>{!playerMode && <button type="button" className="solo-management-button" onClick={onReturnToManagement}>← Adventure management</button>}</div>
    <div className="solo-selectors">
      <label><span>Campaign</span><select value={campaignId} onChange={(event) => changeCampaign(event.target.value)}><option value="">Choose a campaign</option>{campaigns.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label><span>Adventure</span><select value={adventureId} onChange={(event) => setAdventureId(event.target.value)} disabled={!campaignId}><option value="">Choose an adventure</option>{adventures.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.status}</option>)}</select></label>
      {adventure && <label><span>Saved session</span><select value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Start a new session</option>{sessions.map((item) => <option key={item.id} value={item.id}>{item.characterName} · {item.status} · {new Date(item.startedAt).toLocaleDateString()}</option>)}</select></label>}
    </div>
    {error && <div className="solo-message error" role="alert">{error}<button type="button" onClick={() => sessionId ? void loadContext(sessionId) : adventureId ? setAdventureRetry((key) => key + 1) : campaignId ? setCampaignRetry((key) => key + 1) : undefined}>Retry</button></div>}
    {notice && <div className="solo-message success" role="status">✦ {notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {loading && <div className="solo-loading" role="status">Opening your adventure…</div>}
    {!campaigns.length && !loading && <div className="solo-empty"><strong>No campaigns yet</strong><span>{playerMode ? 'A local campaign manager can make an adventure available here.' : 'Create a campaign and adventure in management to begin.'}</span></div>}
    {campaignId && !adventures.length && !loading && !error && <div className="solo-empty"><strong>No adventures in {campaign?.name}</strong><span>{playerMode ? 'No adventures are currently available for this campaign.' : 'Return to adventure management to create or activate an adventure.'}</span></div>}
    {adventure && !session && !loading && <div className="solo-start-card"><div><span className="solo-kicker">BEGIN A NEW SESSION</span><h2>{adventure.title}</h2><p>{adventure.description || 'No player-facing adventure summary has been written.'}</p></div><form onSubmit={(event) => void startSession(event)}><label><span>Character</span><select value={characterId} onChange={(event) => setCharacterId(event.target.value)} required><option value="">Choose a character</option>{characters.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.playerName} · {item.status}</option>)}</select></label><label><span>Starting location</span><select value={startLocationId} onChange={(event) => setStartLocationId(event.target.value)}><option value="">No location selected</option>{places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>{!characters.length && <p className="solo-muted">{playerMode ? 'No characters are available in this campaign.' : 'Add a character to this campaign before starting a session.'}</p>}<button className="solo-primary-button" type="submit" disabled={busy || !characterId}>{busy ? 'Starting…' : 'Start adventure'}</button></form></div>}
    {session && playerContext && <>
      <header className="solo-session-header"><div><span className="solo-kicker">{campaign?.name} · {playerContext.adventure.title}</span><h2>{playerContext.character?.name ?? session.characterName}</h2><p>{playerContext.character ? `Level ${playerContext.character.level} ${playerContext.character.species} ${playerContext.character.class}` : 'Character details unavailable'}</p></div><div className="solo-session-controls"><span className={`solo-status ${session.status}`}>{session.status}</span>{session.status === 'active' && <button type="button" onClick={() => void lifecycle('pause')} disabled={busy}>Pause</button>}{session.status === 'paused' && <button type="button" onClick={() => void lifecycle('resume')} disabled={busy}>Resume</button>}{session.status !== 'completed' && <button type="button" className="solo-complete" onClick={() => void lifecycle('complete')} disabled={busy}>Complete</button>}</div></header>
      <div className="solo-grid">
        <main className="solo-primary-column">
          <section className="solo-panel solo-scene-panel" aria-labelledby="scene-heading"><div className="solo-panel-heading"><div><span className="solo-kicker">{viewingCurrentScene ? 'CURRENT SCENE' : 'PREVIOUS SCENE · READ ONLY'}</span><h3 id="scene-heading">{selectedScene?.title ?? 'No scene recorded'}</h3></div>{selectedScene && <span className="solo-sequence">SCENE {selectedScene.sequence}</span>}</div>{selectedScene?.description ? <p className="solo-scene-description">{selectedScene.description}</p> : <p className="solo-muted">No scene description has been recorded.</p>}{selectedScene?.locationName && <div className="solo-location-line">⌖ {selectedScene.locationName}</div>}{!viewingCurrentScene && <button type="button" className="solo-text-button" onClick={() => setSelectedSceneId(playerContext.currentScene?.id ?? '')}>Return to current scene</button>}</section>
          <SessionConversation turns={aiTurns} loading={aiTurnsLoading} loadError={aiTurnsLoadError} busy={aiTurnBusy} error={aiTurnError} action={aiAction} sessionActive={session.status === 'active'} currentScene={viewingCurrentScene} onActionChange={(value) => { setAiAction(value); if (aiTurnRequest.current?.action !== value.trim()) aiTurnRequest.current = null }} onSubmit={(event) => void submitAiAction(event)} onRetry={() => void submitAiAction(undefined, true)} onReload={() => { if (session) void loadTurns(session.id, session.characterId) }} onRetryTurn={(turn) => { aiTurnRequest.current = { action: turn.action, clientTurnId: turn.clientTurnId }; setAiAction(turn.action); void submitAiAction(undefined, true, turn) }} />
          <section className="solo-panel solo-action-panel" aria-labelledby="decision-heading"><div className="solo-panel-heading"><div><span className="solo-kicker">SESSION RECORD</span><h3 id="decision-heading">Record a decision</h3></div></div><p className="solo-muted">This records a choice in the session journal without requesting AI narration.</p><form onSubmit={(event) => void submitDecision(event)}><label className="solo-sr-only" htmlFor="solo-decision">Describe your character’s decision</label><textarea id="solo-decision" rows={4} maxLength={2000} value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="Describe what your character does…" disabled={session.status !== 'active' || !viewingCurrentScene || decisionBusy} /><div className="solo-form-footer"><small>{decision.length}/2000 · Your text is recorded as written.</small><button className="solo-primary-button" type="submit" disabled={!decisionEnabled}>{decisionBusy ? 'Recording…' : 'Record decision'}</button></div></form>{session.status !== 'active' && <p className="solo-muted">Resume this session to record decisions.</p>}</section>
          <section className="solo-panel"><div className="solo-panel-heading"><div><span className="solo-kicker">TRAVEL</span><h3>Connected locations</h3></div></div>{!viewingCurrentScene ? <p className="solo-muted">Return to the current scene before traveling.</p> : session.status !== 'active' ? <p className="solo-muted">Resume this session to travel.</p> : playerContext.connectedLocations.length ? <div className="solo-destinations">{playerContext.connectedLocations.map((place) => <article key={place.id}><div><strong>{place.name}</strong><small>{place.type || 'Location'}</small>{place.description && <p>{place.description}</p>}</div><button type="button" onClick={() => void moveTo(place)} disabled={busy}>Enter</button></article>)}</div> : <p className="solo-muted">No connected destinations are recorded from this location.</p>}</section>
        </main>
        <aside className="solo-support-column">
          <section className="solo-panel solo-character-panel"><div className="solo-panel-heading"><div><span className="solo-kicker">CHARACTER</span><h3>{characterSummary?.name ?? 'Unavailable'}</h3></div></div>{characterSummary ? <dl><div><dt>Player</dt><dd>{currentCharacter?.playerName ?? 'Campaign member'}</dd></div><div><dt>Species</dt><dd>{characterSummary.species || 'Not set'}</dd></div><div><dt>Class</dt><dd>{characterSummary.class || 'Not set'}</dd></div><div><dt>Level</dt><dd>{characterSummary.level ?? 'Not recorded'}</dd></div></dl> : <p className="solo-muted">Character details are unavailable for this session.</p>}{spellSlotsLoading ? <p className="solo-muted">Loading spell slots…</p> : spellSlots === null ? <p className="solo-muted">Spell slot data is unavailable.</p> : spellSlots.length ? <div className="solo-spell-slots"><h4>Spell slots</h4>{spellSlots.map((slot) => <div key={slot.level}><span>Level {slot.level}</span><strong>{slot.remaining}/{slot.maximum}</strong></div>)}</div> : characterSummary && <p className="solo-muted">No spell slots are configured for this character.</p>}<p className="solo-data-note">HP, AC, and conditions are not shown here because the current API stores those values per encounter, not as a persistent character profile.</p>{!playerMode && <button type="button" className="solo-text-button" onClick={() => onOpenRoster(campaignId)}>Open campaign roster →</button>}</section>
          <section className="solo-panel"><div className="solo-panel-heading"><div><span className="solo-kicker">THE WORLD</span><h3>{playerContext.currentLocation?.name ?? 'Location not set'}</h3></div></div>{playerContext.currentLocation?.description ? <p className="solo-support-copy">{playerContext.currentLocation.description}</p> : <p className="solo-muted">No public location description is available.</p>}{currentNpcs.length ? <div className="solo-npc-list"><h4>Present characters</h4>{currentNpcs.map((npc) => <article key={npc.id}><strong>{npc.name}</strong>{npc.disposition && <small>{npc.disposition}</small>}{npc.description && <p>{npc.description}</p>}{npc.personality && <p>{npc.personality}</p>}</article>)}</div> : <p className="solo-muted">No NPCs are recorded at this location.</p>}</section>
          <section className="solo-panel solo-history-panel"><div className="solo-panel-heading"><div><span className="solo-kicker">CHRONICLE</span><h3>Scene history</h3></div></div>{playerContext.scenes.length ? <ol className="solo-scene-list">{playerContext.scenes.map((scene) => <li key={scene.id} className={scene.id === playerContext.currentScene?.id ? 'current' : ''}><button type="button" onClick={() => setSelectedSceneId(scene.id)} aria-current={scene.id === playerContext.currentScene?.id ? 'step' : undefined}><span>{scene.sequence}</span><div><strong>{scene.title}</strong><small>{scene.locationName ?? 'No location'} · {scene.id === playerContext.currentScene?.id ? 'Current' : 'Read only'}</small></div></button></li>)}</ol> : <p className="solo-muted">No scenes have been entered.</p>}</section>
          <section className="solo-panel solo-journal-panel"><div className="solo-panel-heading"><div><span className="solo-kicker">SESSION RECORD</span><h3>Recent events</h3></div></div>{playerContext.recentJournalEvents.length ? <ol className="solo-journal">{playerContext.recentJournalEvents.map((entry) => <li key={entry.sequence}><span>{eventLabels[entry.eventType] ?? 'Adventure event'}</span><time>{new Date(entry.createdAt).toLocaleString()}</time>{typeof entry.details.title === 'string' && <p>{entry.details.title}</p>}{entry.eventType === 'location_changed' && <p>{locationChangeLabel(entry)}</p>}{typeof entry.details.decisionText === 'string' && <p>{entry.details.decisionText}</p>}</li>)}</ol> : <p className="solo-muted">No events have been recorded.</p>}</section>
        </aside>
      </div>
    </>}
  </section>
}

export default SoloAdventure
