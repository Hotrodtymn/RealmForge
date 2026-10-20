import crypto = require('node:crypto')
import database = require('./database')
import HttpError = require('./httpError')

namespace storyMemoryStore {
  type Row = Record<string, unknown>
  type SqlValue = string | number | bigint | null | NodeJS.ArrayBufferView
  export type EvidenceStatus = 'observed' | 'npc_claim' | 'player_assertion' | 'uncertain'
  export type Category = 'discovery' | 'npc_statement' | 'relationship' | 'promise' | 'mystery' | 'environment' | 'player_fact' | 'other'
  export type Candidate = { category: Category; statement: string; verificationStatus: EvidenceStatus; evidenceQuote: string; relatedNpcId: string | null; relatedLocationId: string | null; relatedQuestId: string | null; supersedesMemoryId: string | null }
  export type Retraction = { memoryId: string; evidenceQuote: string }
  const now = () => new Date().toISOString()
  const id = () => crypto.randomUUID()
  const one = (sql: string, ...params: SqlValue[]) => database.prepare(sql).get(...params) as Row | undefined
  const many = (sql: string, ...params: SqlValue[]) => database.prepare(sql).all(...params) as unknown as Row[]
  const run = (sql: string, ...params: SqlValue[]) => database.prepare(sql).run(...params)

  export function claim(sessionId: string, characterId: string, turnId: string, leaseMs: number) {
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      const turn = one(`SELECT t.*,s.campaignId,s.adventureId,s.status AS sessionStatus
        FROM ai_session_turns t JOIN adventure_sessions s ON s.id=t.sessionId
        WHERE t.id=? AND t.sessionId=? AND t.characterId=? AND t.status='completed' AND s.characterId=?`, turnId, sessionId, characterId, characterId)
      if (!turn) throw new HttpError(404, 'Completed session turn not found.')
      let job = one('SELECT * FROM story_memory_extractions WHERE sourceTurnId=?', turnId)
      if (!job) {
        run(`INSERT INTO story_memory_extractions (id,sourceTurnId,status,attempts,diagnostic,leaseExpiresAt,createdAt,updatedAt)
          VALUES (?,?, 'queued',0,'',NULL,?,?)`, id(), turnId, timestamp, timestamp)
        job = one('SELECT * FROM story_memory_extractions WHERE sourceTurnId=?', turnId)!
      }
      if (job.status === 'completed') { database.exec('COMMIT'); return { turn, job, alreadyComplete: true } }
      if (job.status === 'running' && String(job.leaseExpiresAt ?? '') > timestamp) throw new HttpError(409, 'Story memory extraction is already running.')
      if (Number(job.attempts) >= 20) throw new HttpError(409, 'Story memory extraction reached its retry limit.')
      const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()
      run(`UPDATE story_memory_extractions SET status='running',attempts=attempts+1,diagnostic='',leaseExpiresAt=?,updatedAt=? WHERE id=?`, leaseExpiresAt, timestamp, job.id as string)
      job = one('SELECT * FROM story_memory_extractions WHERE id=?', job.id as string)!
      database.exec('COMMIT')
      return { turn, job, alreadyComplete: false }
    } catch (error) { database.exec('ROLLBACK'); throw error }
  }

  export function activeForExtraction(campaignId: string, adventureId: string, sessionId: string, limit = 12) {
    return many(`SELECT id,category,statement,verificationStatus,relatedNpcId,relatedLocationId,relatedQuestId
      FROM story_memories WHERE campaignId=? AND adventureId=? AND sessionId=? AND status='active'
      ORDER BY CASE category WHEN 'mystery' THEN 0 WHEN 'promise' THEN 1 ELSE 2 END, updatedAt DESC LIMIT ?`, campaignId, adventureId, sessionId, limit)
  }

  export function saveExtraction(turnId: string, campaignId: string, adventureId: string, sessionId: string, candidates: Candidate[], retractions: Retraction[], allowedSupersessions: Set<string>) {
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      const job = one(`SELECT e.id,e.status,t.action,t.response FROM story_memory_extractions e
        JOIN ai_session_turns t ON t.id=e.sourceTurnId WHERE e.sourceTurnId=? AND t.status='completed' AND t.sessionId=?`, turnId, sessionId)
      if (!job) throw new HttpError(409, 'Story memory extraction is not queued for this completed turn.')
      if (job.status === 'completed') { database.exec('COMMIT'); return { saved: 0, duplicates: 0, retracted: 0 } }
      let saved = 0, duplicates = 0, retracted = 0
      for (const candidate of candidates) {
        const normalized = candidate.statement.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
        const dedupeKey = crypto.createHash('sha256').update(JSON.stringify([candidate.category, candidate.verificationStatus, candidate.relatedNpcId, candidate.relatedLocationId, candidate.relatedQuestId, normalized])).digest('hex')
        const existing = one(`SELECT id FROM story_memories WHERE adventureId=? AND sessionId=? AND dedupeKey=? AND status='active'`, adventureId, sessionId, dedupeKey)
        let memoryId: string
        if (existing) {
          memoryId = String(existing.id); duplicates += 1
          run('UPDATE story_memories SET updatedAt=? WHERE id=?', timestamp, memoryId)
          run('INSERT INTO story_memory_events (id,memoryId,eventType,sourceTurnId,relatedMemoryId,reason,createdAt) VALUES (?,?,\'reinforced\',?,NULL,?,?)', id(), memoryId, turnId, candidate.evidenceQuote, timestamp)
        } else {
          memoryId = id()
          run(`INSERT INTO story_memories (id,campaignId,adventureId,sessionId,category,statement,verificationStatus,relatedNpcId,relatedLocationId,relatedQuestId,sourceTurnId,evidenceQuote,dedupeKey,status,supersededByMemoryId,createdAt,updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',NULL,?,?)`, memoryId,campaignId,adventureId,sessionId,candidate.category,candidate.statement,candidate.verificationStatus,candidate.relatedNpcId,candidate.relatedLocationId,candidate.relatedQuestId,turnId,candidate.evidenceQuote,dedupeKey,timestamp,timestamp)
          run('INSERT INTO story_memory_events (id,memoryId,eventType,sourceTurnId,relatedMemoryId,reason,createdAt) VALUES (?,?,\'created\',?,NULL,?,?)', id(), memoryId, turnId, candidate.evidenceQuote, timestamp)
          saved += 1
        }
        if (candidate.supersedesMemoryId && allowedSupersessions.has(candidate.supersedesMemoryId) && memoryId !== candidate.supersedesMemoryId) {
          const old = one(`SELECT id FROM story_memories WHERE id=? AND campaignId=? AND adventureId=? AND sessionId=? AND status='active' AND category=? AND verificationStatus=?`, candidate.supersedesMemoryId,campaignId,adventureId,sessionId,candidate.category,candidate.verificationStatus)
          if (old) {
            run(`UPDATE story_memories SET status='superseded',supersededByMemoryId=?,updatedAt=? WHERE id=?`, memoryId,timestamp,old.id as string)
            run('INSERT INTO story_memory_events (id,memoryId,eventType,sourceTurnId,relatedMemoryId,reason,createdAt) VALUES (?,?,\'superseded\',?,?,?,?)', id(), old.id as string, turnId, memoryId, candidate.evidenceQuote, timestamp)
          }
        }
      }
      for (const retraction of retractions) {
        const memory = one(`SELECT id FROM story_memories WHERE id=? AND campaignId=? AND adventureId=? AND sessionId=? AND status='active'`, retraction.memoryId,campaignId,adventureId,sessionId)
        if (memory) {
          run(`UPDATE story_memories SET status='retracted',updatedAt=? WHERE id=?`, timestamp, memory.id as string)
          run('INSERT INTO story_memory_events (id,memoryId,eventType,sourceTurnId,relatedMemoryId,reason,createdAt) VALUES (?,?,\'retracted\',?,NULL,?,?)', id(), memory.id as string, turnId, retraction.evidenceQuote, timestamp)
          retracted += 1
        }
      }
      run(`UPDATE story_memory_extractions SET status='completed',diagnostic='',leaseExpiresAt=NULL,updatedAt=? WHERE id=?`, timestamp, job.id as string)
      database.exec('COMMIT')
      return { saved, duplicates, retracted }
    } catch (error) { database.exec('ROLLBACK'); throw error }
  }

  export function failExtraction(turnId: string, diagnostic: string) {
    run(`UPDATE story_memory_extractions SET status='failed',diagnostic=?,leaseExpiresAt=NULL,updatedAt=? WHERE sourceTurnId=? AND status='running'`, diagnostic.slice(0, 500), now(), turnId)
  }

  export function retract(sessionId: string, characterId: string, memoryId: string, reason: string, sourceTurnId: string | null = null) {
    const timestamp = now()
    database.exec('BEGIN IMMEDIATE')
    try {
      const memory = one(`SELECT m.* FROM story_memories m JOIN adventure_sessions s ON s.id=m.sessionId
        WHERE m.id=? AND m.sessionId=? AND s.characterId=? AND m.status='active'`, memoryId, sessionId, characterId)
      if (!memory) throw new HttpError(404, 'Active story memory not found for this session.')
      run(`UPDATE story_memories SET status='retracted',updatedAt=? WHERE id=?`, timestamp, memoryId)
      run('INSERT INTO story_memory_events (id,memoryId,eventType,sourceTurnId,relatedMemoryId,reason,createdAt) VALUES (?,?,\'retracted\',?,NULL,?,?)', id(), memoryId, sourceTurnId, reason.slice(0,500), timestamp)
      database.exec('COMMIT')
      return one('SELECT * FROM story_memories WHERE id=?', memoryId)
    } catch (error) { database.exec('ROLLBACK'); throw error }
  }

  export function listForSession(campaignId: string, adventureId: string, sessionId: string, characterId: string) {
    const session = one('SELECT id FROM adventure_sessions WHERE id=? AND campaignId=? AND adventureId=? AND characterId=?', sessionId,campaignId,adventureId,characterId)
    if (!session) throw new HttpError(404, 'Session and character do not match this adventure.')
    const memories = many(`SELECT m.*,n.name AS relatedNpcName,l.name AS relatedLocationName,q.title AS relatedQuestTitle,
      t.createdAt AS sourceTurnCreatedAt,e.status AS extractionStatus,e.diagnostic AS extractionDiagnostic
      FROM story_memories m JOIN ai_session_turns t ON t.id=m.sourceTurnId
      LEFT JOIN adventure_npcs n ON n.id=m.relatedNpcId LEFT JOIN adventure_locations l ON l.id=m.relatedLocationId
      LEFT JOIN adventure_quests q ON q.id=m.relatedQuestId LEFT JOIN story_memory_extractions e ON e.sourceTurnId=m.sourceTurnId
      WHERE m.campaignId=? AND m.adventureId=? AND m.sessionId=? ORDER BY m.createdAt DESC,m.rowid DESC`, campaignId,adventureId,sessionId)
    const extractionRows = many(`SELECT e.sourceTurnId,e.status,e.attempts,e.diagnostic,e.updatedAt,t.createdAt AS sourceTurnCreatedAt,t.action
      FROM story_memory_extractions e JOIN ai_session_turns t ON t.id=e.sourceTurnId JOIN adventure_sessions s ON s.id=t.sessionId
      WHERE s.id=? AND s.characterId=? AND e.status IN ('queued','running','failed') ORDER BY e.updatedAt DESC`, sessionId,characterId)
    const history = new Map<string, Row[]>()
    for (const event of many(`SELECT id,memoryId,eventType,sourceTurnId,relatedMemoryId,reason,createdAt FROM story_memory_events
      WHERE memoryId IN (SELECT id FROM story_memories WHERE sessionId=?) ORDER BY createdAt,rowid`, sessionId)) {
      const key=String(event.memoryId); const rows=history.get(key)??[]; rows.push(event);history.set(key,rows)
    }
    return { memories: memories.map((memory)=>({...memory,history:history.get(String(memory.id))??[]})), extractionIssues: extractionRows }
  }

  export function recentForContext(campaignId: string, adventureId: string, sessionId: string, visibleNpcIds: string[], locationId: string | null, limit = 12) {
    const npcMarks = visibleNpcIds.map(()=>'?').join(',')
    const relevant = [locationId?'relatedLocationId=?':null,visibleNpcIds.length?`relatedNpcId IN (${npcMarks})`:null].filter(Boolean).join(' OR ')||'0'
    const params: SqlValue[] = [campaignId,adventureId,sessionId]
    if (locationId) params.push(locationId)
    params.push(...visibleNpcIds,limit)
    return many(`SELECT id,category,statement,verificationStatus,relatedNpcId,relatedLocationId,relatedQuestId,updatedAt
      FROM story_memories WHERE campaignId=? AND adventureId=? AND sessionId=? AND status='active'
      ORDER BY CASE WHEN (${relevant}) THEN 0 ELSE 1 END,
        CASE category WHEN 'mystery' THEN 0 WHEN 'promise' THEN 1 WHEN 'discovery' THEN 2 ELSE 3 END,
        updatedAt DESC LIMIT ?`, ...params)
  }

  // World expansion gets its own small, read-only memory projection so proposal evidence
  // can be checked against the original memory source without exposing unrelated sessions.
  export function recentForWorldExpansion(campaignId: string, adventureId: string, sessionId: string, limit = 8) {
    return many(`SELECT id,category,statement,verificationStatus,evidenceQuote,sourceTurnId,relatedNpcId,relatedLocationId,relatedQuestId,updatedAt
      FROM story_memories WHERE campaignId=? AND adventureId=? AND sessionId=? AND status='active'
      ORDER BY updatedAt DESC,rowid DESC LIMIT ?`, campaignId, adventureId, sessionId, limit)
  }
}

export = storyMemoryStore
