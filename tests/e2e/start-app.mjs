import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import process from 'node:process'

const rootDir = process.cwd()
const dataDir = path.join(rootDir, '.tmp', 'e2e')
const dbPath = path.join(dataDir, 'andromeda-e2e.db')
const jwtSecretPath = path.join(dataDir, 'jwt-secret')

async function ensureCleanDataDir() {
  await fs.mkdir(dataDir, { recursive: true })
  await Promise.all([
    fs.rm(dbPath, { force: true }),
    fs.rm(`${dbPath}-wal`, { force: true }),
    fs.rm(`${dbPath}-shm`, { force: true }),
    fs.rm(jwtSecretPath, { force: true }),
  ])
}

async function main() {
  await ensureCleanDataDir()

  const child = spawn('node', ['server/dist/index.js'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: '3001',
      DB_PATH: dbPath,
      JWT_SECRET_PATH: jwtSecretPath,
      JWT_SECRET: 'playwright-secret',
      ERSATZTV_BASE_URL: 'http://127.0.0.1:8409',
      INITIAL_ADMIN_NICKNAME: 'andromedatv',
      INITIAL_ADMIN_PASSWORD: 'supersecret',
      CORS_ORIGIN: '*',
    },
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })

  const shutdown = () => {
    child.kill('SIGTERM')
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('Failed to start e2e app server', error)
  process.exit(1)
})
