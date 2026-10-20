import readOllamaConfig = require('./ollamaConfig')

type OllamaConfig = ReturnType<typeof readOllamaConfig>
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type GenerateOptions = {
  timeoutMs?: number
  format?: 'json' | Record<string, unknown>
  numPredict?: number
  numCtx?: number
  maxResponseChars?: number
  onDiagnostic?: (event: { stage: 'health_check' | 'generation'; durationMs: number; ollamaTimings?: Record<string, number>; doneReason?: string; responseCharCount?: number; outputTokenCount?: number; truncated?: boolean }) => void
}

function reportDiagnostic(callback: GenerateOptions['onDiagnostic'], event: Parameters<NonNullable<GenerateOptions['onDiagnostic']>>[0]) {
  try { callback?.(event) } catch { /* Diagnostics must never affect generation. */ }
}

class OllamaError extends Error {
  readonly kind: 'unavailable' | 'timeout' | 'malformed' | 'missing-model' | 'generation'

  constructor(kind: OllamaError['kind'], message: string) {
    super(message)
    this.name = 'OllamaError'
    this.kind = kind
  }
}

class OllamaService {
  constructor(
    private readonly config: OllamaConfig = readOllamaConfig(),
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  get model(): string { return this.config.model }

  private async request(path: string, init?: RequestInit, timeoutMs = this.config.timeoutMs): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new OllamaError('timeout', 'Ollama did not respond before the request timed out.')
      }
      throw new OllamaError('unavailable', 'Ollama is unavailable. Start the local Ollama service and try again.')
    }
  }

  async health(): Promise<{ connectionStatus: 'online' | 'offline'; model: string; modelAvailable: boolean; error?: string }> {
    try {
      const response = await this.request('/api/tags')
      if (!response.ok) throw new OllamaError('unavailable', 'Ollama is reachable but could not list installed models.')
      let payload: unknown
      try { payload = await response.json() } catch { throw new OllamaError('malformed', 'Ollama returned an unreadable model list.') }
      if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { models?: unknown }).models)) {
        throw new OllamaError('malformed', 'Ollama returned an invalid model list.')
      }
      const models = (payload as { models: unknown[] }).models
      const modelAvailable = models.some((entry) => entry && typeof entry === 'object' &&
        (entry as { name?: unknown }).name === this.config.model)
      return {
        connectionStatus: 'online', model: this.config.model, modelAvailable,
        ...(!modelAvailable ? { error: `The configured model ${this.config.model} is not installed in Ollama.` } : {}),
      }
    } catch (error) {
      const message = error instanceof OllamaError ? error.message : 'Ollama is unavailable.'
      return { connectionStatus: error instanceof OllamaError && error.kind === 'malformed' ? 'online' : 'offline', model: this.config.model, modelAvailable: false, error: message }
    }
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<{ model: string; response: string; truncated: boolean; responseCharCount: number; doneReason?: string; outputTokenCount?: number }> {
    const healthStartedAt = Date.now()
    const availability = await this.health()
    reportDiagnostic(options.onDiagnostic, { stage: 'health_check', durationMs: Date.now() - healthStartedAt })
    if (!availability.modelAvailable) {
      throw new OllamaError(availability.connectionStatus === 'online' ? 'missing-model' : 'unavailable',
        availability.error ?? 'The configured Ollama model is unavailable.')
    }

    const requestBody: Record<string, unknown> = {
      model: this.config.model, prompt, stream: false,
      options: {
        temperature: this.config.temperature,
        num_predict: options.numPredict ?? this.config.numPredict,
        num_ctx: options.numCtx ?? this.config.numCtx,
      },
    }
    if (options.format !== undefined) requestBody.format = options.format
    const generationStartedAt = Date.now()
    let ollamaTimings: Record<string, number> | undefined
    let generationMetadata: { doneReason?: string; responseCharCount?: number; outputTokenCount?: number; truncated?: boolean } = {}
    try {
      const response = await this.request('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      }, options.timeoutMs ?? this.config.timeoutMs)
      if (!response.ok) {
        if (response.status === 404) throw new OllamaError('missing-model', 'The configured Ollama model is not installed.')
        throw new OllamaError('generation', 'Ollama could not complete the test generation request.')
      }
      let payload: unknown
      try { payload = await response.json() } catch { throw new OllamaError('malformed', 'Ollama returned an unreadable generation response.') }
      if (!payload || typeof payload !== 'object' || typeof (payload as { response?: unknown }).response !== 'string') {
        throw new OllamaError('malformed', 'Ollama returned an invalid generation response.')
      }
      const data = payload as Record<string, unknown>
      const doneReason = typeof data.done_reason === 'string' ? data.done_reason : undefined
      const outputTokenCount = typeof data.eval_count === 'number' && Number.isFinite(data.eval_count) ? data.eval_count : undefined
      ollamaTimings = Object.fromEntries(
        ['total_duration', 'load_duration', 'prompt_eval_duration', 'eval_duration', 'prompt_eval_count', 'eval_count']
          .filter((key) => typeof data[key] === 'number' && Number.isFinite(data[key]))
          .map((key) => [key, key.endsWith('_duration') ? Number(data[key]) / 1_000_000 : Number(data[key])]),
      )
      const generated = (payload as { response: string }).response
      const maxResponseChars = options.maxResponseChars ?? this.config.maxResponseChars
      generationMetadata = {
        ...(doneReason !== undefined ? { doneReason } : {}),
        responseCharCount: generated.length,
        ...(outputTokenCount !== undefined ? { outputTokenCount } : {}),
        truncated: generated.length > maxResponseChars,
      }
      return {
        model: this.config.model,
        response: generated.slice(0, maxResponseChars),
        truncated: generated.length > maxResponseChars,
        responseCharCount: generated.length,
        ...(doneReason !== undefined ? { doneReason } : {}),
        ...(outputTokenCount !== undefined ? { outputTokenCount } : {}),
      }
    } finally {
      reportDiagnostic(options.onDiagnostic, { stage: 'generation', durationMs: Date.now() - generationStartedAt, ...(ollamaTimings ? { ollamaTimings } : {}), ...generationMetadata })
    }
  }
}

const ollamaService = new OllamaService()

export = { OllamaError, OllamaService, ollamaService }
