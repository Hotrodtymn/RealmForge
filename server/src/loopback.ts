function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address
  return normalized === '127.0.0.1' || normalized === '::1'
}

export = isLoopbackAddress
