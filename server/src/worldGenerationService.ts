import readOllamaConfig = require('./ollamaConfig')
import ollama = require('./ollamaService')
import previewSchema = require('./worldPreviewSchema')
import worldConfig = require('./worldGenerationConfig')
import worldPreviewRegistry = require('./worldPreviewRegistry')

type GenerationConfig = ReturnType<typeof worldConfig.validateWorldGenerationConfig>

class WorldGenerationService {
  constructor(private readonly generate: (prompt: string, options: {
    timeoutMs?: number; format?: 'json' | Record<string, unknown>; numPredict?: number; maxResponseChars?: number
  }) => ReturnType<typeof ollama.ollamaService.generate> =
    (prompt, options) => ollama.ollamaService.generate(prompt, options)) {}

  async preview(configuration: GenerationConfig) {
    const config = readOllamaConfig()
    const prompt = [
      'Create one original, internally coherent dark-fantasy D&D adventure preview for a starting-level character.',
      'This is a preview only. Do not refer to database IDs or claim that any RealmForge data has been saved.',
      'Use the requested generation configuration exactly. Keep the scope short enough for one opening session.',
      'Create a campaign premise and setting, exactly three distinct locations, exactly three NPCs, one main quest with two or three objectives, one central mystery or threat, one opening scene, and a possible resolution that leaves meaningful choices to the player.',
      'Make every entity key a short, lowercase, stable-looking snake_case reference key within this response, never a UUID. Use campaign key "campaign", main quest key "main_quest", and opening scene key "opening_scene". Every NPC locationKey, mainQuest locationKeys entry, campaign startingLocationKey, and opening scene locationKey must refer to a location key defined in locations. openingScene.questKey must be "main_quest". Mark exactly one location isStartingLocation=true and make it match campaign.startingLocationKey. Keep every entity key unique.',
      'Return only one JSON object matching the supplied JSON Schema. All string values must contain useful, nonblank content and must fit the schema limits. Do not add markdown fences or other fields.',
      `Generation configuration: ${JSON.stringify(configuration)}`,
    ].join('\n\n')

    let lastValidationError: Error | undefined
    const attempts = 2
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const retryPrompt = attempt === 1 ? prompt : [
        prompt,
        'Validation retry: the previous response could not be accepted. Generate a complete new preview and carefully ensure every field, stable key, and cross-reference satisfies the requested schema. Do not explain the retry.',
      ].join('\n\n')
      let generated: Awaited<ReturnType<typeof this.generate>>
      try {
        generated = await this.generate(retryPrompt, {
          timeoutMs: attempt === 1 ? config.worldGenerationTimeoutMs : config.worldGenerationRetryTimeoutMs,
          numPredict: config.worldGenerationNumPredict,
          maxResponseChars: config.worldGenerationMaxResponseChars,
          format: previewSchema.worldPreviewJsonSchema as unknown as Record<string, unknown>,
        })
      } catch (error) {
        if (error instanceof ollama.OllamaError && error.kind === 'malformed' && attempt < attempts) {
          lastValidationError = error
          continue
        }
        throw error
      }

      try {
        if (generated.truncated) throw new previewSchema.WorldPreviewValidationError('Model response exceeded the configured preview limit.')
        let parsed: unknown
        try { parsed = JSON.parse(generated.response) as unknown } catch {
          throw new previewSchema.WorldPreviewValidationError('Model response was not valid JSON.')
        }
        const preview = previewSchema.validateWorldPreview(parsed)
        const issued = worldPreviewRegistry.worldPreviewRegistry.issue({
          preview,
          configuration,
          model: generated.model,
        })
        return {
          model: generated.model,
          metadata: { previewOnly: true, generatedAt: new Date().toISOString(), attempts: attempt, configuration, expiresAt: issued.expiresAt },
          previewToken: issued.token,
          preview,
        }
      } catch (error) {
        if (!(error instanceof previewSchema.WorldPreviewValidationError)) throw error
        lastValidationError = error
      }
    }

    // Never silently replace rejected model output with application-authored content.
    void lastValidationError
    throw new previewSchema.WorldPreviewValidationError('The local model could not produce a valid structured preview after one retry.')
  }
}

const worldGenerationService = new WorldGenerationService()
export = { WorldGenerationService, worldGenerationService }
