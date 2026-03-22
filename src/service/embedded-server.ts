/**
 * EmbeddedServer — HTTP server that starts/stops with the VSCode extension lifecycle.
 * Provides REST endpoints for the Ensemble multi-agent collaboration service.
 */

import http from 'node:http'
import {
  createEnsembleTeam, getEnsembleTeam, listEnsembleTeams,
  getTeamFeed, sendTeamMessage, disbandTeam,
} from './ensemble-service.js'

export class EmbeddedServer {
  private server: http.Server | null = null
  private actualPort: number

  constructor(private port: number = 23000) {
    this.actualPort = port
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => void this.handleRequest(req, res))
      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server!.address() as { port: number }
        this.actualPort = addr.port
        resolve(this.actualPort)
      })
      this.server.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
  }

  getPort(): number { return this.actualPort }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS — validate localhost origins
    const origin = req.headers.origin || ''
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      res.setHeader('Access-Control-Allow-Origin', origin)
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const pathname = url.pathname

    try {
      // Health
      if (pathname === '/api/v1/health' && req.method === 'GET') {
        return this.json(res, 200, { status: 'ok', version: '0.1.0', runtime: 'vscode' })
      }

      // List teams
      if (pathname === '/api/ensemble/teams' && req.method === 'GET') {
        const result = listEnsembleTeams()
        return this.json(res, result.status, result.data || { error: result.error })
      }

      // Create team
      if (pathname === '/api/ensemble/teams' && req.method === 'POST') {
        const body = await this.readBody(req)
        const result = await createEnsembleTeam(JSON.parse(body))
        return this.json(res, result.status, result.data || { error: result.error })
      }

      // Team routes with :id
      const teamMatch = pathname.match(/^\/api\/ensemble\/teams\/([^/]+)$/)
      const feedMatch = pathname.match(/^\/api\/ensemble\/teams\/([^/]+)\/feed$/)
      const disbandMatch = pathname.match(/^\/api\/ensemble\/teams\/([^/]+)\/disband$/)

      if (disbandMatch && req.method === 'POST') {
        const result = await disbandTeam(disbandMatch[1])
        return this.json(res, result.status, result.data || { error: result.error })
      }

      if (feedMatch && req.method === 'GET') {
        const since = url.searchParams.get('since') || undefined
        const result = getTeamFeed(feedMatch[1], since)
        return this.json(res, result.status, result.data || { error: result.error })
      }

      if (teamMatch) {
        const teamId = teamMatch[1]

        if (req.method === 'GET') {
          const result = getEnsembleTeam(teamId)
          return this.json(res, result.status, result.data || { error: result.error })
        }

        if (req.method === 'POST') {
          const body = await this.readBody(req)
          const { content, from, to, id, timestamp } = JSON.parse(body) as Record<string, string>
          if (!content || !to) {
            return this.json(res, 400, { error: 'Missing content or to field' })
          }
          const result = await sendTeamMessage(teamId, to, content, from, id, timestamp)
          return this.json(res, result.status, result.data || { error: result.error })
        }

        if (req.method === 'DELETE') {
          const result = await disbandTeam(teamId)
          return this.json(res, result.status, result.data || { error: result.error })
        }
      }

      this.json(res, 404, { error: 'Not found' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.json(res, 500, { error: message })
    }
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString()))
      req.on('error', reject)
    })
  }
}
