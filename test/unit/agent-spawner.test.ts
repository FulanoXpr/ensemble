import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock agent-config so buildAgentCommand returns a predictable value
vi.mock('../../src/core/agent-config', () => ({
  buildAgentCommand: vi.fn((program: string) => `${program} --mock-flag`),
}))

// Mock hosts-config so getSelfHostId returns a predictable value
vi.mock('../../src/core/hosts-config', () => ({
  getSelfHostId: vi.fn(() => 'test-host'),
  isSelf: vi.fn(() => true),
  getHostById: vi.fn(() => undefined),
}))

import { setRuntime } from '../../src/core/runtime-singleton'
import { spawnLocalAgent, killLocalAgent, getAgentTokenUsage } from '../../src/core/agent-spawner'
import type { AgentRuntime, DiscoveredSession } from '../../src/core/agent-runtime-interface'

function makeMockRuntime(overrides: Partial<AgentRuntime & { createProcessSession?: (...args: any[]) => Promise<void> }> = {}): AgentRuntime & { createProcessSession?: (...args: any[]) => Promise<void> } {
  return {
    type: 'vscode' as const,
    listSessions: vi.fn(async (): Promise<DiscoveredSession[]> => []),
    sessionExists: vi.fn(async () => false),
    getWorkingDirectory: vi.fn(async () => ''),
    isInCopyMode: vi.fn(async () => false),
    cancelCopyMode: vi.fn(async () => {}),
    createSession: vi.fn(async () => {}),
    killSession: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
    pasteFromFile: vi.fn(async () => {}),
    capturePane: vi.fn(async () => ''),
    setEnvironment: vi.fn(async () => {}),
    unsetEnvironment: vi.fn(async () => {}),
    getAttachCommand: vi.fn(() => ({ command: 'echo', args: [] })),
    createProcessSession: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('spawnLocalAgent', () => {
  let mockRuntime: ReturnType<typeof makeMockRuntime>

  beforeEach(() => {
    mockRuntime = makeMockRuntime()
    setRuntime(mockRuntime)
  })

  it('returns a SpawnedAgent with the correct fields', async () => {
    const agent = await spawnLocalAgent({
      name: 'test-agent',
      program: 'claude',
      workingDirectory: '/tmp/work',
    })

    expect(agent.name).toBe('test-agent')
    expect(agent.program).toBe('claude')
    expect(agent.workingDirectory).toBe('/tmp/work')
    expect(agent.sessionName).toBe('test-agent')
    expect(agent.hostId).toBe('test-host')
    expect(typeof agent.id).toBe('string')
    expect(agent.id).toHaveLength(36) // UUID v4 format
  })

  it('generates a unique id for each spawned agent', async () => {
    const a = await spawnLocalAgent({ name: 'a', program: 'claude', workingDirectory: '/tmp' })
    const b = await spawnLocalAgent({ name: 'b', program: 'claude', workingDirectory: '/tmp' })
    expect(a.id).not.toBe(b.id)
  })

  it('uses createProcessSession when available on the runtime', async () => {
    await spawnLocalAgent({
      name: 'test-agent',
      program: 'claude',
      workingDirectory: '/tmp/work',
    })

    expect(mockRuntime.createProcessSession).toHaveBeenCalledOnce()
    expect(mockRuntime.createProcessSession).toHaveBeenCalledWith(
      'test-agent',
      'claude --mock-flag',
      '/tmp/work',
    )
  })

  it('falls back to createSession + sendKeys when createProcessSession is absent', async () => {
    const fallbackRuntime = makeMockRuntime()
    delete (fallbackRuntime as any).createProcessSession
    setRuntime(fallbackRuntime)

    await spawnLocalAgent({
      name: 'fallback-agent',
      program: 'codex',
      workingDirectory: '/tmp/fb',
    })

    expect(fallbackRuntime.createSession).toHaveBeenCalledWith('fallback-agent', '/tmp/fb')
    expect(fallbackRuntime.sendKeys).toHaveBeenCalledWith(
      'fallback-agent',
      'codex --mock-flag',
      { literal: true, enter: true },
    )
  })

  it('sanitizes session name by removing invalid characters', async () => {
    const agent = await spawnLocalAgent({
      name: 'my agent! @#$',
      program: 'claude',
      workingDirectory: '/tmp',
    })

    // Invalid chars stripped — only letters, numbers, hyphens, dots, underscores
    expect(agent.sessionName).toBe('myagent')
  })

  it('uses hostId option when provided', async () => {
    const agent = await spawnLocalAgent({
      name: 'remote-agent',
      program: 'claude',
      workingDirectory: '/tmp',
      hostId: 'custom-host-123',
    })

    expect(agent.hostId).toBe('custom-host-123')
  })

  it('uses process.cwd() when workingDirectory is empty', async () => {
    const agent = await spawnLocalAgent({
      name: 'cwd-agent',
      program: 'claude',
      workingDirectory: '',
    })

    expect(agent.workingDirectory).toBe(process.cwd())
  })
})

describe('killLocalAgent', () => {
  let mockRuntime: ReturnType<typeof makeMockRuntime>

  beforeEach(() => {
    mockRuntime = makeMockRuntime()
    setRuntime(mockRuntime)
  })

  it('calls killSession on the runtime', async () => {
    await killLocalAgent('my-session')
    expect(mockRuntime.killSession).toHaveBeenCalledWith('my-session')
  })

  it('does not throw when killSession throws (session already gone)', async () => {
    mockRuntime.killSession = vi.fn(async () => {
      throw new Error('Session not found')
    })

    await expect(killLocalAgent('ghost-session')).resolves.toBeUndefined()
  })

  it('does not throw for an unknown session name', async () => {
    await expect(killLocalAgent('nonexistent')).resolves.toBeUndefined()
  })
})

describe('getAgentTokenUsage', () => {
  let mockRuntime: ReturnType<typeof makeMockRuntime>

  beforeEach(() => {
    mockRuntime = makeMockRuntime()
    setRuntime(mockRuntime)
  })

  it('parses abbreviated k-style token count', async () => {
    mockRuntime.capturePane = vi.fn(async () => 'Context: 45.2k tokens used')
    const usage = await getAgentTokenUsage('my-session')
    expect(usage).toBe('~45.2k tokens')
  })

  it('parses integer k-style token count', async () => {
    mockRuntime.capturePane = vi.fn(async () => 'Used 12k tokens so far')
    const usage = await getAgentTokenUsage('my-session')
    expect(usage).toBe('~12k tokens')
  })

  it('parses full numeric token count', async () => {
    mockRuntime.capturePane = vi.fn(async () => 'Total: 12,345 tokens consumed')
    const usage = await getAgentTokenUsage('my-session')
    expect(usage).toBe('~12,345 tokens')
  })

  it('parses codex percentage budget pattern', async () => {
    mockRuntime.capturePane = vi.fn(async () => '42% left in budget')
    const usage = await getAgentTokenUsage('my-session')
    expect(usage).toBe('42% budget left')
  })

  it('returns "unknown" when no token pattern is found', async () => {
    mockRuntime.capturePane = vi.fn(async () => 'No relevant info here')
    const usage = await getAgentTokenUsage('my-session')
    expect(usage).toBe('unknown')
  })

  it('returns "unknown" when capturePane throws', async () => {
    mockRuntime.capturePane = vi.fn(async () => {
      throw new Error('Session gone')
    })
    const usage = await getAgentTokenUsage('dead-session')
    expect(usage).toBe('unknown')
  })

  it('returns "unknown" for an empty pane', async () => {
    mockRuntime.capturePane = vi.fn(async () => '')
    const usage = await getAgentTokenUsage('empty-session')
    expect(usage).toBe('unknown')
  })

  it('prefers k-style match over full numeric match', async () => {
    // "45.2k tokens" contains both a k-style and a numeric match opportunity;
    // the k-style branch fires first
    mockRuntime.capturePane = vi.fn(async () => '45.2k tokens remaining')
    const usage = await getAgentTokenUsage('my-session')
    expect(usage).toBe('~45.2k tokens')
  })
})
