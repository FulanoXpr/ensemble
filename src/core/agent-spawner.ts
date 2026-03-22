import { v4 as uuidv4 } from 'uuid'
import { getRuntime } from './runtime-singleton.js'
import { getSelfHostId } from './hosts-config.js'
import { buildAgentCommand } from './agent-config.js'

export interface SpawnedAgent {
  id: string
  name: string
  program: string
  sessionName: string
  workingDirectory: string
  hostId: string
}

interface SpawnAgentOptions {
  name: string
  program: string
  workingDirectory: string
  hostId?: string
}

function computeSessionName(agentName: string): string {
  return agentName.replace(/[^a-zA-Z0-9\-_.]/g, '')
}

export async function spawnLocalAgent(options: SpawnAgentOptions): Promise<SpawnedAgent> {
  const runtime = getRuntime()
  const agentId = uuidv4()
  const sessionName = computeSessionName(options.name)
  const cwd = options.workingDirectory || process.cwd()
  const hostId = options.hostId || getSelfHostId()

  const startCommand = buildAgentCommand(options.program)

  // Use createProcessSession if available (VSCodeRuntime), otherwise fallback
  if ('createProcessSession' in runtime) {
    await (runtime as any).createProcessSession(sessionName, startCommand, cwd)
  } else {
    await runtime.createSession(sessionName, cwd)
    await new Promise(r => setTimeout(r, 300))
    await runtime.sendKeys(sessionName, startCommand, { literal: true, enter: true })
  }

  return { id: agentId, name: options.name, program: options.program, sessionName, workingDirectory: cwd, hostId }
}

export async function killLocalAgent(sessionName: string): Promise<void> {
  const runtime = getRuntime()
  try {
    await runtime.killSession(sessionName)
  } catch {
    // Session may already be gone
  }
}

export async function getAgentTokenUsage(sessionName: string): Promise<string> {
  try {
    const runtime = getRuntime()
    const output = await runtime.capturePane(sessionName, 100)

    const claudeKMatch = output.match(/(\d+(?:\.\d+)?k)\s*tokens/i)
    if (claudeKMatch) return `~${claudeKMatch[1]} tokens`

    const claudeFullMatch = output.match(/([\d,]+)\s*tokens/i)
    if (claudeFullMatch) return `~${claudeFullMatch[1]} tokens`

    const codexPctMatch = output.match(/(\d+)%\s*left/i)
    if (codexPctMatch) return `${codexPctMatch[1]}% budget left`

    return 'unknown'
  } catch {
    return 'unknown'
  }
}
