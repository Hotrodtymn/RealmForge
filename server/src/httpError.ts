class HttpError extends Error {
  readonly status: number
  readonly fields: Record<string, string> | undefined
  readonly details: Record<string, unknown> | undefined

  constructor(status: number, message: string, fields?: Record<string, string>, details?: Record<string, unknown>) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.fields = fields
    this.details = details
  }
}

export = HttpError
