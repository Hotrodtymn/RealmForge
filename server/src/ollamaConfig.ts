type OllamaConfig = {
  baseUrl: string
  model: string
  timeoutMs: number
  narrationTimeoutMs: number
  memoryExtractionTimeoutMs: number
  worldGenerationTimeoutMs: number
  worldGenerationRetryTimeoutMs: number
  worldGenerationMaxResponseChars: number
  worldGenerationNumPredict: number
  worldPreviewTokenTtlMs: number
  worldPreviewTokenMaxEntries: number
  maxResponseChars: number
  temperature: number
  numPredict: number
  numCtx: number
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function localBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || 'http://127.0.0.1:11434'
  try {
    const parsed = new URL(candidate)
    const localHost = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname.toLowerCase())
    if (parsed.protocol !== 'http:' || !localHost || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return 'http://127.0.0.1:11434'
    }
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return 'http://127.0.0.1:11434'
  }
}

function readOllamaConfig(env: NodeJS.ProcessEnv = process.env): OllamaConfig {
  const requestedModel = env.OLLAMA_MODEL?.trim()
  return {
    baseUrl: localBaseUrl(env.OLLAMA_BASE_URL),
    model: requestedModel && requestedModel.length <= 100 ? requestedModel : 'llama3.1:8b',
    timeoutMs: boundedNumber(env.OLLAMA_REQUEST_TIMEOUT_MS, 30_000, 100, 120_000),
    narrationTimeoutMs: boundedNumber(env.OLLAMA_NARRATION_TIMEOUT_MS, 180_000, 1_000, 300_000),
    memoryExtractionTimeoutMs: boundedNumber(env.OLLAMA_MEMORY_EXTRACTION_TIMEOUT_MS, 180_000, 1_000, 300_000),
    worldGenerationTimeoutMs: boundedNumber(env.OLLAMA_WORLD_TIMEOUT_MS, 240_000, 1_000, 300_000),
    worldGenerationRetryTimeoutMs: boundedNumber(env.OLLAMA_WORLD_RETRY_TIMEOUT_MS, 90_000, 1_000, 300_000),
    worldGenerationMaxResponseChars: boundedNumber(env.OLLAMA_WORLD_MAX_RESPONSE_CHARS, 12_000, 2_000, 24_000),
    worldGenerationNumPredict: boundedNumber(env.OLLAMA_WORLD_NUM_PREDICT, 1_600, 256, 2_048),
    worldPreviewTokenTtlMs: boundedNumber(env.OLLAMA_WORLD_PREVIEW_TTL_MS, 900_000, 10_000, 3_600_000),
    worldPreviewTokenMaxEntries: boundedNumber(env.OLLAMA_WORLD_PREVIEW_MAX_ENTRIES, 50, 1, 200),
    maxResponseChars: boundedNumber(env.OLLAMA_MAX_RESPONSE_CHARS, 1_200, 100, 8_000),
    temperature: boundedNumber(env.OLLAMA_TEMPERATURE, 0.2, 0, 2),
    numPredict: boundedNumber(env.OLLAMA_NUM_PREDICT, 256, 1, 2_048),
    numCtx: boundedNumber(env.OLLAMA_NUM_CTX, 2_048, 256, 16_384),
  }
}

export = readOllamaConfig
