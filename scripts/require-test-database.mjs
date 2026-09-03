const url = process.env.TEST_DATABASE_URL?.trim()

if (!url) {
  console.error('TEST_DATABASE_URL is required for the PostgreSQL test lane. No PostgreSQL tests ran.')
  process.exit(1)
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
  console.error('Refusing to test: TEST_DATABASE_URL must not equal DATABASE_URL.')
  process.exit(1)
}

let parsed
try {
  parsed = new URL(url)
} catch {
  console.error('TEST_DATABASE_URL is not a valid database URL.')
  process.exit(1)
}

if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  console.error('TEST_DATABASE_URL must use postgres:// or postgresql://.')
  process.exit(1)
}

console.error('PostgreSQL required lane enabled. The credential value is intentionally not printed.')
