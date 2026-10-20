const dmModes = ['ai'] as const
const themes = ['dark-fantasy'] as const
const worldCreationModes = ['surprise'] as const
const lengths = ['short'] as const

type WorldGenerationConfig<TDmMode extends string = typeof dmModes[number], TTheme extends string = typeof themes[number]> = {
  dmMode: TDmMode
  theme: TTheme
  worldCreation: typeof worldCreationModes[number]
  length: typeof lengths[number]
}

class WorldGenerationConfigError extends Error {
  readonly fields: Record<string, string>
  constructor(fields: Record<string, string>) {
    super('World generation configuration is invalid.')
    this.name = 'WorldGenerationConfigError'
    this.fields = fields
  }
}

function validateWorldGenerationConfig(value: unknown): WorldGenerationConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorldGenerationConfigError({ body: 'Expected a JSON object.' })
  }
  const input = value as Record<string, unknown>
  const fields: Record<string, string> = {}
  const allowedKeys = ['dmMode', 'theme', 'worldCreation', 'length']
  for (const key of Object.keys(input)) if (!allowedKeys.includes(key)) fields[key] = 'This setting is not supported.'
  const choices: Record<string, readonly string[]> = { dmMode: dmModes, theme: themes, worldCreation: worldCreationModes, length: lengths }
  for (const [key, options] of Object.entries(choices)) {
    if (typeof input[key] !== 'string' || !options.includes(input[key])) fields[key] = `Choose one of: ${options.join(', ')}.`
  }
  if (Object.keys(fields).length) throw new WorldGenerationConfigError(fields)
  return input as WorldGenerationConfig
}

export = { validateWorldGenerationConfig, WorldGenerationConfigError }
