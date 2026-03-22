import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock vscode (transitively required by ensemble-service and its dependencies)
vi.mock('vscode', () => ({
  window: { createTerminal: vi.fn(() => ({ sendText: vi.fn(), dispose: vi.fn() })) },
  EventEmitter: class {
    event = vi.fn()
    fire = vi.fn()
    dispose = vi.fn()
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}))

// Mock ensemble-service so the HTTP layer can be tested in isolation
vi.mock('../../src/service/ensemble-service.js', () => ({
  listEnsembleTeams: vi.fn(() => ({ data: { teams: [] }, status: 200 })),
  getEnsembleTeam: vi.fn(() => ({ error: 'Team not found', status: 404 })),
  createEnsembleTeam: vi.fn(async () => ({ data: { team: { id: 'new-team' } }, status: 201 })),
  getTeamFeed: vi.fn(() => ({ data: { messages: [] }, status: 200 })),
  sendTeamMessage: vi.fn(async () => ({ data: { message: { id: 'msg-1' } }, status: 200 })),
  disbandTeam: vi.fn(async () => ({ data: { team: { id: 'team-1', status: 'disbanded' } }, status: 200 })),
}))

import { EmbeddedServer } from '../../src/service/embedded-server.js'
import http from 'node:http'

// Helper: make an HTTP request and return parsed JSON + status
function request(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(Buffer.concat(chunks).toString()) })
        } catch {
          resolve({ status: res.statusCode ?? 0, data: null })
        }
      })
    })

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

describe('EmbeddedServer', () => {
  let server: EmbeddedServer
  let port: number

  beforeEach(async () => {
    server = new EmbeddedServer(0) // port 0 = OS-assigned random port
    port = await server.start()
  })

  afterEach(async () => {
    await server.stop()
    vi.clearAllMocks()
  })

  it('starts and returns a non-zero port', () => {
    expect(port).toBeGreaterThan(0)
    expect(server.getPort()).toBe(port)
  })

  it('GET /api/v1/health returns 200 with status ok', async () => {
    const { status, data } = await request(port, 'GET', '/api/v1/health')
    expect(status).toBe(200)
    expect(data).toMatchObject({ status: 'ok', version: '0.1.0', runtime: 'vscode' })
  })

  it('GET /api/ensemble/teams returns 200 with empty teams array', async () => {
    const { status, data } = await request(port, 'GET', '/api/ensemble/teams')
    expect(status).toBe(200)
    expect(data).toMatchObject({ teams: [] })
  })

  it('POST /api/ensemble/teams creates a team', async () => {
    const { status, data } = await request(port, 'POST', '/api/ensemble/teams', {
      name: 'test-team', description: 'Test', agents: [],
    })
    expect(status).toBe(201)
    expect(data).toMatchObject({ team: { id: 'new-team' } })
  })

  it('GET /api/ensemble/teams/:id returns 404 for unknown team', async () => {
    const { status, data } = await request(port, 'GET', '/api/ensemble/teams/no-such-team')
    expect(status).toBe(404)
    expect(data).toMatchObject({ error: 'Team not found' })
  })

  it('POST /api/ensemble/teams/:id sends a message', async () => {
    const { status, data } = await request(port, 'POST', '/api/ensemble/teams/team-1', {
      content: 'Hello team', to: 'team',
    })
    expect(status).toBe(200)
    expect(data).toMatchObject({ message: { id: 'msg-1' } })
  })

  it('POST /api/ensemble/teams/:id returns 400 when content is missing', async () => {
    const { status, data } = await request(port, 'POST', '/api/ensemble/teams/team-1', {
      to: 'team',
    })
    expect(status).toBe(400)
    expect(data).toMatchObject({ error: 'Missing content or to field' })
  })

  it('POST /api/ensemble/teams/:id returns 400 when to is missing', async () => {
    const { status, data } = await request(port, 'POST', '/api/ensemble/teams/team-1', {
      content: 'Hello',
    })
    expect(status).toBe(400)
    expect(data).toMatchObject({ error: 'Missing content or to field' })
  })

  it('DELETE /api/ensemble/teams/:id disbands the team', async () => {
    const { status, data } = await request(port, 'DELETE', '/api/ensemble/teams/team-1')
    expect(status).toBe(200)
    expect(data).toMatchObject({ team: { status: 'disbanded' } })
  })

  it('POST /api/ensemble/teams/:id/disband disbands the team', async () => {
    const { status, data } = await request(port, 'POST', '/api/ensemble/teams/team-1/disband')
    expect(status).toBe(200)
    expect(data).toMatchObject({ team: { status: 'disbanded' } })
  })

  it('GET /api/ensemble/teams/:id/feed returns messages', async () => {
    const { status, data } = await request(port, 'GET', '/api/ensemble/teams/team-1/feed')
    expect(status).toBe(200)
    expect(data).toMatchObject({ messages: [] })
  })

  it('OPTIONS request returns 204', async () => {
    const { status } = await request(port, 'OPTIONS', '/api/ensemble/teams')
    expect(status).toBe(204)
  })

  it('unknown path returns 404', async () => {
    const { status, data } = await request(port, 'GET', '/api/not-a-real-route')
    expect(status).toBe(404)
    expect(data).toMatchObject({ error: 'Not found' })
  })

  it('sets CORS headers for localhost origin', async () => {
    return new Promise<void>((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/api/v1/health',
        method: 'GET',
        headers: { 'Origin': 'http://localhost:3000' },
      }
      const req = http.request(options, (res) => {
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')
        resolve()
      })
      req.on('error', reject)
      req.end()
    })
  })

  it('does not set CORS header for non-localhost origin', async () => {
    return new Promise<void>((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/api/v1/health',
        method: 'GET',
        headers: { 'Origin': 'https://evil.example.com' },
      }
      const req = http.request(options, (res) => {
        expect(res.headers['access-control-allow-origin']).toBeUndefined()
        resolve()
      })
      req.on('error', reject)
      req.end()
    })
  })

  it('stop() resolves cleanly', async () => {
    const server2 = new EmbeddedServer(0)
    await server2.start()
    await expect(server2.stop()).resolves.toBeUndefined()
  })

  it('stop() resolves immediately when server was never started', async () => {
    const server3 = new EmbeddedServer(0)
    await expect(server3.stop()).resolves.toBeUndefined()
  })
})
