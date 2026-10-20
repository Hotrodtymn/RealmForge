import type { FormEvent, KeyboardEvent } from 'react'

type AiTurn = { id: string; sessionId: string; characterId: string; clientTurnId: string; action: string; response: string | null; status: 'pending' | 'completed' | 'failed'; createdAt: string; updatedAt: string; completedAt: string | null }

export default function SessionConversation({ turns, loading, loadError, busy, error, action, sessionActive, currentScene, onActionChange, onSubmit, onRetry, onReload, onRetryTurn }: {
  turns: AiTurn[]
  loading: boolean
  loadError: string
  busy: boolean
  error: string
  action: string
  sessionActive: boolean
  currentScene: boolean
  onActionChange: (value: string) => void
  onSubmit: (event?: FormEvent) => void
  onRetry: () => void
  onReload: () => void
  onRetryTurn: (turn: AiTurn) => void
}) {
  const canSubmit = sessionActive && currentScene && !loading && !loadError && !busy && Boolean(action.trim())
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      if (canSubmit) onSubmit()
    }
  }
  return <section className="solo-panel solo-conversation-panel" aria-labelledby="conversation-heading"><div className="solo-panel-heading"><div><span className="solo-kicker">AI DUNGEON MASTER</span><h3 id="conversation-heading">Adventure conversation</h3></div>{turns.length > 0 && <span className="solo-turn-count">{turns.length} {turns.length === 1 ? 'TURN' : 'TURNS'}</span>}</div>
    {loading ? <p className="solo-muted" role="status">Restoring this session’s conversation…</p> : turns.length === 0 ? <p className="solo-muted">No actions have been sent to the Dungeon Master yet. The opening scene remains above.</p> : <ol className="solo-conversation-list">{turns.map((turn) => <li key={turn.id} className={`solo-conversation-turn ${turn.status}`}><article className="solo-player-message"><span>YOU · {new Date(turn.createdAt).toLocaleString()}</span><p>{turn.action}</p></article>{turn.status === 'completed' && turn.response ? <article className="solo-dm-message"><span>REALMFORGE DM</span><p>{turn.response}</p></article> : turn.status === 'failed' ? <div className="solo-turn-status failed">The response did not complete. Your action is preserved. <button type="button" onClick={() => onRetryTurn(turn)} disabled={busy || loading || !sessionActive || !currentScene}>Retry this action</button></div> : <div className="solo-turn-status" role="status">{turn.status === 'pending' ? <>The Dungeon Master is considering your action… <button type="button" onClick={() => onRetryTurn(turn)} disabled={busy || loading || !sessionActive || !currentScene}>Retry if interrupted</button></> : 'The Dungeon Master is considering your action…'}</div>}</li>)}</ol>}
    {loadError && <div className="solo-message error" role="alert">{loadError}<button type="button" onClick={onReload} disabled={loading}>Retry conversation</button></div>}
    {error && <div className="solo-message error" role="alert">{error}<button type="button" onClick={onRetry} disabled={busy || !sessionActive || !currentScene || !action.trim()}>Retry action</button></div>}
    <form className="solo-ai-action-form" onSubmit={(event) => onSubmit(event)}><label htmlFor="solo-ai-action">Describe what your character does</label><textarea id="solo-ai-action" rows={4} maxLength={2000} value={action} onKeyDown={keyDown} onChange={(event) => onActionChange(event.target.value)} placeholder="What do you do? For example: I ask the ferryman why the bell is ringing." disabled={!sessionActive || busy || loading || Boolean(loadError) || !currentScene} /><div className="solo-form-footer"><small>{action.length}/2000 · Ctrl/Cmd+Enter submits; Enter adds a line. AI narration does not change game mechanics.</small><button className="solo-primary-button" type="submit" disabled={!canSubmit}>{busy ? 'Awaiting the Dungeon Master…' : 'Submit Action'}</button></div></form>
    {!sessionActive && <p className="solo-muted">Resume this session to continue the conversation.</p>}{!currentScene && <p className="solo-muted">Return to the current scene before submitting a new action.</p>}
  </section>
}
