import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')
import adventureSessionStore = require('./adventureSessionStore')

namespace aiSessionTurnStore {
  type Row = Record<string, unknown>
  type SqlValue = string | number | bigint | null | NodeJS.ArrayBufferView
  export type Turn = { id: string; sessionId: string; characterId: string; clientTurnId: string; action: string; response: string | null; status: 'pending' | 'completed' | 'failed'; createdAt: string; updatedAt: string; completedAt: string | null }
  export type TurnInput = { sessionId: string; characterId: string; action: string; clientTurnId: string }
  const now = () => new Date().toISOString()
  const id = () => crypto.randomUUID()
  const one = (sql: string, ...params: SqlValue[]) => database.prepare(sql).get(...params) as Row | undefined
  const many = (sql: string, ...params: SqlValue[]) => database.prepare(sql).all(...params) as unknown as Row[]
  const run = (sql: string, ...params: SqlValue[]) => database.prepare(sql).run(...params)

  function ownedSession(sessionId: string, characterId: string) {
    const row = one(`SELECT s.id,s.campaignId,s.adventureId,s.characterId,s.status,c.status AS characterStatus
      FROM adventure_sessions s JOIN characters c ON c.id=s.characterId
      WHERE s.id=? AND s.characterId=?`, sessionId, characterId)
    if (!row) throw new HttpError(404, 'Session and character do not match.')
    return row
  }

  export function claim(input: TurnInput, leaseMs: number): { turn: Turn; replayed: boolean } {
    const timestamp = now()
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      const session = ownedSession(input.sessionId, input.characterId)
      if (session.status !== 'active') throw new HttpError(409, 'AI turns can only be submitted to an active session.')
      if (session.characterStatus !== 'active' && session.characterStatus !== 'prepared') throw new HttpError(409, 'This character is not eligible to continue the session.')
      const prior = one('SELECT * FROM ai_session_turns WHERE sessionId=? AND clientTurnId=?', input.sessionId, input.clientTurnId)
      if (prior) {
        if (prior.characterId !== input.characterId || prior.action !== input.action) throw new HttpError(409, 'This client turn ID was already used for a different action.')
        if (prior.status === 'completed') {
          database.exec('COMMIT')
          return { turn: prior as unknown as Turn, replayed: true }
        }
        if (prior.status === 'pending' && String(prior.leaseExpiresAt ?? '') > timestamp) throw new HttpError(409, 'This action is still being narrated. Reload the conversation shortly.')
        run(`UPDATE ai_session_turns SET status='pending',response=NULL,updatedAt=?,completedAt=NULL,leaseExpiresAt=? WHERE id=?`, timestamp, leaseExpiresAt, prior.id as string)
        const turn = one('SELECT * FROM ai_session_turns WHERE id=?', prior.id as string)!
        database.exec('COMMIT')
        return { turn: turn as unknown as Turn, replayed: false }
      }
      const turnId = id()
      run(`INSERT INTO ai_session_turns (id,sessionId,characterId,clientTurnId,action,response,status,createdAt,updatedAt,completedAt,leaseExpiresAt)
        VALUES (?,?,?,?,?,NULL,'pending',?,?,NULL,?)`, turnId, input.sessionId, input.characterId, input.clientTurnId, input.action, timestamp, timestamp, leaseExpiresAt)
      const turn = one('SELECT * FROM ai_session_turns WHERE id=?', turnId)!
      database.exec('COMMIT')
      return { turn: turn as unknown as Turn, replayed: false }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  export function complete(turnId: string, response: string): Turn {
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      const turn = one('SELECT * FROM ai_session_turns WHERE id=?', turnId)
      if (!turn) throw new HttpError(404, 'AI turn not found.')
      if (turn.status === 'completed') { database.exec('COMMIT'); return turn as unknown as Turn }
      const session = one('SELECT status FROM adventure_sessions WHERE id=?', turn.sessionId as string)
      if (!session || session.status !== 'active') throw new HttpError(409, 'The session stopped before this narration could be saved. Retry only after resuming it.')
      run(`UPDATE ai_session_turns SET response=?,status='completed',updatedAt=?,completedAt=?,leaseExpiresAt=NULL WHERE id=? AND status='pending'`, response, timestamp, timestamp, turnId)
      run(`INSERT OR IGNORE INTO story_memory_extractions (id,sourceTurnId,status,attempts,diagnostic,leaseExpiresAt,createdAt,updatedAt)
        VALUES (?,?, 'queued',0,'',NULL,?,?)`, id(), turnId, timestamp, timestamp)
      const completed = one('SELECT * FROM ai_session_turns WHERE id=?', turnId)!
      database.exec('COMMIT')
      return completed as unknown as Turn
    } catch (error) { database.exec('ROLLBACK'); throw error }
  }

  export function fail(turnId: string): void {
    run(`UPDATE ai_session_turns SET status='failed',updatedAt=?,leaseExpiresAt=NULL WHERE id=? AND status='pending'`, now(), turnId)
  }

  export function list(sessionId: string, characterId: string): Turn[] {
    ownedSession(sessionId, characterId)
    return many(`SELECT id,sessionId,characterId,clientTurnId,action,response,status,createdAt,updatedAt,completedAt
      FROM ai_session_turns WHERE sessionId=? ORDER BY createdAt ASC,rowid ASC`, sessionId) as unknown as Turn[]
  }

  export function context(sessionId: string, characterId: string) {
    const session = ownedSession(sessionId, characterId)
    return {
      campaignId: String(session.campaignId), adventureId: String(session.adventureId),
      context: adventureSessionStore.context(String(session.campaignId), sessionId),
      recentTurns: many(`SELECT id,createdAt,action,response,status FROM ai_session_turns WHERE sessionId=? AND status='completed'
        ORDER BY createdAt DESC,rowid DESC LIMIT 8`, sessionId).reverse(),
    }
  }

}

export = aiSessionTurnStore
