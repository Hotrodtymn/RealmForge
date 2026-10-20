const leaseSafetyMarginMs = 30_000

function extractionLeaseMs(extractionTimeoutMs: number, healthTimeoutMs: number) {
  return extractionTimeoutMs + healthTimeoutMs + leaseSafetyMarginMs
}

export = { extractionLeaseMs }
