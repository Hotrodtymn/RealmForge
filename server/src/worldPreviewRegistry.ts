import crypto = require('node:crypto')
import readOllamaConfig = require('./ollamaConfig')

type PreviewSnapshot = {
  preview: ReturnType<typeof import('./worldPreviewSchema').validateWorldPreview>
  configuration: ReturnType<typeof import('./worldGenerationConfig').validateWorldGenerationConfig>
  model: string
}

type PreviewRecord<TSnapshot> = {
  snapshot: TSnapshot
  createdAt: number
  expiresAt: number
  state: 'ready' | 'saving' | 'saved'
  savedValue?: unknown
}

class PreviewTokenError extends Error {
  readonly code: 'invalid' | 'expired' | 'in-progress' | 'capacity'
  constructor(code: PreviewTokenError['code'], message: string) {
    super(message)
    this.name = 'PreviewTokenError'
    this.code = code
  }
}

class WorldPreviewRegistry<TSnapshot = PreviewSnapshot> {
  private readonly records = new Map<string, PreviewRecord<TSnapshot>>()
  private readonly expiredTokens = new Map<string, number>()

  constructor(private readonly options: {
    ttlMs?: number
    maxEntries?: number
    now?: () => number
    tokenFactory?: () => string
  } = {}) {}

  private get ttlMs() { return this.options.ttlMs ?? readOllamaConfig().worldPreviewTokenTtlMs }
  private get maxEntries() { return this.options.maxEntries ?? readOllamaConfig().worldPreviewTokenMaxEntries }
  private now() { return this.options.now?.() ?? Date.now() }

  private rememberExpired(token: string, now: number) {
    this.expiredTokens.delete(token)
    this.expiredTokens.set(token, now + this.ttlMs)
    while (this.expiredTokens.size > this.maxEntries) this.expiredTokens.delete(this.expiredTokens.keys().next().value as string)
  }

  private prune(now: number) {
    for (const [token, expiresAt] of this.expiredTokens) if (expiresAt <= now) this.expiredTokens.delete(token)
    for (const [token, record] of this.records) {
      if (record.expiresAt <= now && record.state !== 'saving') {
        this.records.delete(token)
        this.rememberExpired(token, now)
      }
    }
  }

  issue(snapshot: TSnapshot): { token: string; expiresAt: string } {
    const now = this.now()
    this.prune(now)
    if (this.records.size >= this.maxEntries) {
      const evictable = [...this.records.entries()].find(([, record]) => record.state === 'ready')
      if (evictable) this.records.delete(evictable[0])
      else throw new PreviewTokenError('capacity', 'The local preview registry is full. Save or wait for an existing preview to expire.')
    }
    const token = this.options.tokenFactory?.() ?? crypto.randomBytes(32).toString('base64url')
    const expiresAt = now + this.ttlMs
    this.records.set(token, { snapshot, createdAt: now, expiresAt, state: 'ready' })
    return { token, expiresAt: new Date(expiresAt).toISOString() }
  }

  save<TSaved>(token: unknown, persist: (snapshot: TSnapshot) => TSaved): { value: TSaved; replayed: boolean; expiresAt: string } {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      throw new PreviewTokenError('invalid', 'Preview token is invalid or unknown.')
    }
    const now = this.now()
    const targetedRecord = this.records.get(token)
    if (targetedRecord && targetedRecord.expiresAt <= now) {
      this.records.delete(token)
      this.rememberExpired(token, now)
      throw new PreviewTokenError('expired', 'This preview token has expired. Generate a new preview before saving.')
    }
    this.prune(now)
    const record = this.records.get(token)
    if (!record) {
      if (this.expiredTokens.has(token)) throw new PreviewTokenError('expired', 'This preview token has expired. Generate a new preview before saving.')
      throw new PreviewTokenError('invalid', 'Preview token is invalid or unknown.')
    }
    if (record.state === 'saved') return { value: record.savedValue as TSaved, replayed: true, expiresAt: new Date(record.expiresAt).toISOString() }
    if (record.state === 'saving') throw new PreviewTokenError('in-progress', 'This preview is already being saved.')

    record.state = 'saving'
    try {
      const value = persist(record.snapshot)
      record.savedValue = value
      record.state = 'saved'
      return { value, replayed: false, expiresAt: new Date(record.expiresAt).toISOString() }
    } catch (error) {
      record.state = 'ready'
      throw error
    }
  }
}

const worldPreviewRegistry = new WorldPreviewRegistry()
export = { WorldPreviewRegistry, PreviewTokenError, worldPreviewRegistry }
