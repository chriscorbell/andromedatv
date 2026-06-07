import fs from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import process from 'node:process'
import { PassThrough } from 'node:stream'

import { createApp } from '../../server/dist/app.js'
import { ensureInitialAdmin } from '../../server/dist/bootstrap.js'
import { initDb } from '../../server/dist/db.js'

const rootDir = process.cwd()
const dataDir = path.join(rootDir, '.tmp', 'e2e')
const dbPath = path.join(dataDir, 'andromeda-e2e.db')
const hlsOutputRoot = path.join(dataDir, 'hls')
const libraryRoot = path.join(dataDir, 'library')
const seriesRoot = path.join(libraryRoot, 'series')
const bumpsRoot = path.join(libraryRoot, 'bumps')
const staticDir = path.join(rootDir, 'dist')

let nextFixturePid = 41_000
let currentPlayoutProcess = null

class FixturePlayoutProcess extends EventEmitter {
  constructor(mediaTitle) {
    super()
    this.completed = false
    this.killed = false
    this.mediaTitle = mediaTitle
    this.pid = nextFixturePid
    this.stderr = new PassThrough()
    nextFixturePid += 1
  }

  complete() {
    if (this.completed) {
      return false
    }

    this.completed = true
    this.emit('exit', 0, null)
    return true
  }

  kill(signal = 'SIGTERM') {
    if (this.completed) {
      return true
    }

    this.completed = true
    this.killed = true
    this.emit('exit', null, signal)
    return true
  }
}

async function ensureCleanDataDir() {
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.mkdir(dataDir, { recursive: true })
}

async function createFixtureLibrary() {
  await fs.mkdir(path.join(seriesRoot, 'Acceptance Series'), { recursive: true })
  await fs.mkdir(bumpsRoot, { recursive: true })
  await fs.writeFile(
    path.join(seriesRoot, 'Acceptance Series', 'episode-01.mp4'),
    'fixture episode 01',
  )
  await fs.writeFile(
    path.join(seriesRoot, 'Acceptance Series', 'episode-02.mp4'),
    'fixture episode 02',
  )
  await fs.writeFile(path.join(bumpsRoot, '01-bump.mp4'), 'fixture bump')
}

function probeFixtureMedia(filePath) {
  return Promise.resolve({
    audioCodec: 'aac',
    durationSeconds: filePath.includes('bump') ? 5 : 30,
    videoCodec: 'h264',
  })
}

async function writeFixtureHls({ mediaAsset, outputRoot }) {
  await fs.rm(outputRoot, { recursive: true, force: true })
  await fs.mkdir(outputRoot, { recursive: true })

  const playlistPath = path.join(outputRoot, 'hls.m3u8')
  const segmentName = `segment-${mediaAsset.id}.ts`
  await fs.writeFile(
    playlistPath,
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:1',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXTINF:1.0,',
      segmentName,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'),
  )
  await fs.writeFile(path.join(outputRoot, segmentName), Buffer.alloc(188, 0x47))

  const playoutProcess = new FixturePlayoutProcess(mediaAsset.title)
  currentPlayoutProcess = playoutProcess
  return { playlistPath, process: playoutProcess }
}

async function main() {
  await ensureCleanDataDir()
  await createFixtureLibrary()

  const db = await initDb(dbPath)
  await ensureInitialAdmin({
    db,
    nickname: 'andromedatv',
    password: 'supersecret',
  })

  const internalFixtureOptions = {
    bumpsRoot,
    now: () => new Date(),
    probeMediaAsset: probeFixtureMedia,
    random: () => 0,
    seriesAllowlist: ['Acceptance Series'],
    seriesRoot,
  }

  const app = createApp({
    corsOrigin: '*',
    db,
    ersatzBaseUrl: new URL('http://127.0.0.1:1'),
    internalPlayout: {
      ...internalFixtureOptions,
      hlsOutputRoot,
      transcodeLiveHls: writeFixtureHls,
    },
    internalSchedule: internalFixtureOptions,
    jwtSecret: 'playwright-secret',
    serveStatic: true,
    staticDir,
    statusApiMode: 'public',
  })

  app.post('/__e2e/complete-playout', (_req, res) => {
    if (!currentPlayoutProcess || currentPlayoutProcess.completed) {
      return res.status(409).json({ error: 'No active fixture playout' })
    }

    const mediaTitle = currentPlayoutProcess.mediaTitle
    currentPlayoutProcess.complete()
    return res.json({ ok: true, mediaTitle })
  })

  const server = app.listen(3001, '127.0.0.1', () => {
    console.log('andromeda e2e app listening on 3001')
  })

  server.requestTimeout = 0
  server.timeout = 0
  server.keepAliveTimeout = 75_000
  server.headersTimeout = 90_000

  const shutdown = () => {
    server.close(() => {
      void db.close().finally(() => {
        process.exit(0)
      })
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error('Failed to start e2e app server', error)
  process.exit(1)
})
