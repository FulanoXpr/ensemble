import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the vscode module before importing the runtime
vi.mock('vscode', () => {
  class MockEventEmitter {
    private listeners: Function[] = []
    event = (listener: Function) => {
      this.listeners.push(listener)
      return { dispose: () => {} }
    }
    fire = (data: any) => {
      this.listeners.forEach(l => l(data))
    }
    dispose = () => {
      this.listeners = []
    }
  }

  return {
    window: {
      createTerminal: vi.fn((opts: any) => {
        const terminal = {
          name: opts.name,
          sendText: vi.fn((text: string, addNewLine?: boolean) => {
            if (opts.pty?.handleInput) {
              opts.pty.handleInput(text + (addNewLine !== false ? '\n' : ''))
            }
          }),
          dispose: vi.fn(() => {
            if (opts.pty?.close) opts.pty.close()
          }),
        }
        // Trigger open after a tick
        setTimeout(() => opts.pty?.open?.(), 0)
        return terminal
      }),
    },
    EventEmitter: MockEventEmitter,
    Uri: { file: (p: string) => ({ fsPath: p }) },
  }
})

import { VSCodeRuntime, parseCommand } from '../../src/runtime/vscode-runtime'

describe('VSCodeRuntime', () => {
  let runtime: VSCodeRuntime

  beforeEach(() => {
    runtime = new VSCodeRuntime()
  })

  it('has type "vscode"', () => {
    expect(runtime.type).toBe('vscode')
  })

  it('createSession creates and tracks a session', async () => {
    await runtime.createSession('test-agent', '/tmp/work')
    expect(await runtime.sessionExists('test-agent')).toBe(true)
  })

  it('createSession throws if session already exists', async () => {
    await runtime.createSession('dup', '/tmp')
    await expect(runtime.createSession('dup', '/tmp')).rejects.toThrow(
      'Session "dup" already exists',
    )
  })

  it('sessionExists returns false for unknown sessions', async () => {
    expect(await runtime.sessionExists('nonexistent')).toBe(false)
  })

  it('getWorkingDirectory returns the cwd for a known session', async () => {
    await runtime.createSession('agent-a', '/home/user/project')
    expect(await runtime.getWorkingDirectory('agent-a')).toBe('/home/user/project')
  })

  it('getWorkingDirectory returns empty string for unknown session', async () => {
    expect(await runtime.getWorkingDirectory('ghost')).toBe('')
  })

  it('killSession removes the session', async () => {
    await runtime.createSession('doomed', '/tmp')
    expect(await runtime.sessionExists('doomed')).toBe(true)
    await runtime.killSession('doomed')
    expect(await runtime.sessionExists('doomed')).toBe(false)
  })

  it('killSession is a no-op for unknown sessions', async () => {
    // Should not throw
    await runtime.killSession('nonexistent')
  })

  it('capturePane returns buffer contents after simulateOutput', async () => {
    await runtime.createSession('capture-test', '/tmp')
    runtime.simulateOutput('capture-test', 'Hello world\r\n')
    runtime.simulateOutput('capture-test', 'Second line\r\n')
    const output = await runtime.capturePane('capture-test')
    expect(output).toContain('Hello world')
    expect(output).toContain('Second line')
  })

  it('capturePane respects line count parameter', async () => {
    await runtime.createSession('lines-test', '/tmp')
    runtime.simulateOutput('lines-test', 'line1\nline2\nline3\nline4\n')
    const last2 = await runtime.capturePane('lines-test', 2)
    expect(last2).toContain('line3')
    expect(last2).toContain('line4')
    expect(last2).not.toContain('line1')
  })

  it('capturePane returns empty string for unknown sessions', async () => {
    const output = await runtime.capturePane('dead-session')
    expect(output).toBe('')
  })

  it('listSessions returns tracked sessions', async () => {
    await runtime.createSession('alpha', '/tmp/a')
    await runtime.createSession('beta', '/tmp/b')
    const sessions = await runtime.listSessions()
    expect(sessions).toHaveLength(2)
    const names = sessions.map(s => s.name).sort()
    expect(names).toEqual(['alpha', 'beta'])
    expect(sessions[0].windows).toBe(1)
    expect(sessions[0].workingDirectory).toBeTruthy()
  })

  it('listSessions returns empty array when no sessions exist', async () => {
    const sessions = await runtime.listSessions()
    expect(sessions).toEqual([])
  })

  it('sendKeys writes to dummy terminal buffer', async () => {
    await runtime.createSession('keys-test', '/tmp')
    await runtime.sendKeys('keys-test', 'echo hello')
    const output = await runtime.capturePane('keys-test')
    expect(output).toContain('echo hello')
  })

  it('sendKeys throws for unknown session', async () => {
    await expect(runtime.sendKeys('ghost', 'test')).rejects.toThrow(
      'Session "ghost" not found',
    )
  })

  it('renameSession updates tracking', async () => {
    await runtime.createSession('old-name', '/tmp')
    await runtime.renameSession('old-name', 'new-name')
    expect(await runtime.sessionExists('old-name')).toBe(false)
    expect(await runtime.sessionExists('new-name')).toBe(true)
  })

  it('renameSession throws for unknown session', async () => {
    await expect(runtime.renameSession('ghost', 'new')).rejects.toThrow(
      'Session "ghost" not found',
    )
  })

  it('renameSession throws if new name already exists', async () => {
    await runtime.createSession('first', '/tmp')
    await runtime.createSession('second', '/tmp')
    await expect(runtime.renameSession('first', 'second')).rejects.toThrow(
      'Session "second" already exists',
    )
  })

  it('isInCopyMode always returns false', async () => {
    await runtime.createSession('copy-test', '/tmp')
    expect(await runtime.isInCopyMode('copy-test')).toBe(false)
  })

  it('getAttachCommand returns echo command', () => {
    const { command, args } = runtime.getAttachCommand('my-term')
    expect(command).toBe('echo')
    expect(args[0]).toContain('my-term')
  })

  it('getTerminal returns the vscode.Terminal for a session', async () => {
    await runtime.createSession('term-test', '/tmp')
    const terminal = runtime.getTerminal('term-test')
    expect(terminal).toBeDefined()
    expect(terminal!.name).toBe('term-test')
  })

  it('getTerminal returns undefined for unknown session', () => {
    expect(runtime.getTerminal('ghost')).toBeUndefined()
  })

  it('getBuffer returns the OutputBuffer for a session', async () => {
    await runtime.createSession('buf-test', '/tmp')
    const buf = runtime.getBuffer('buf-test')
    expect(buf).toBeDefined()
  })

  it('getBuffer returns undefined for unknown session', () => {
    expect(runtime.getBuffer('ghost')).toBeUndefined()
  })

  it('simulateOutput throws for unknown session', () => {
    expect(() => runtime.simulateOutput('ghost', 'data')).toThrow(
      'Session "ghost" not found',
    )
  })

  it('disposeAll kills all terminals', async () => {
    await runtime.createSession('a', '/tmp')
    await runtime.createSession('b', '/tmp')
    runtime.disposeAll()
    // After disposeAll, sessions should be cleared (async, so wait a tick)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await runtime.sessionExists('a')).toBe(false)
    expect(await runtime.sessionExists('b')).toBe(false)
  })

  it('setEnvironment and unsetEnvironment work', async () => {
    await runtime.createSession('env-test', '/tmp')
    // Should not throw
    await runtime.setEnvironment('env-test', 'MY_VAR', 'value')
    await runtime.unsetEnvironment('env-test', 'MY_VAR')
  })

  it('setEnvironment throws for unknown session', async () => {
    await expect(runtime.setEnvironment('ghost', 'K', 'V')).rejects.toThrow(
      'Session "ghost" not found',
    )
  })
})

describe('parseCommand', () => {
  it('splits a simple command', () => {
    const result = parseCommand('echo hello world')
    expect(result.command).toBe('echo')
    expect(result.args).toEqual(['hello', 'world'])
  })

  it('handles single-word command', () => {
    const result = parseCommand('ls')
    expect(result.command).toBe('ls')
    expect(result.args).toEqual([])
  })

  it('handles quoted arguments', () => {
    const result = parseCommand('echo "hello world" foo')
    expect(result.command).toBe('echo')
    expect(result.args).toEqual(['hello world', 'foo'])
  })

  it('handles single-quoted arguments', () => {
    const result = parseCommand("echo 'hello world' bar")
    expect(result.command).toBe('echo')
    expect(result.args).toEqual(['hello world', 'bar'])
  })

  it('handles extra whitespace', () => {
    const result = parseCommand('  echo   hello  ')
    expect(result.command).toBe('echo')
    expect(result.args).toEqual(['hello'])
  })

  it('handles empty string', () => {
    const result = parseCommand('')
    expect(result.command).toBe('')
    expect(result.args).toEqual([])
  })

  it('handles complex CLI command', () => {
    const result = parseCommand('claude --dangerously-skip-permissions -p "do something"')
    expect(result.command).toBe('claude')
    expect(result.args).toEqual(['--dangerously-skip-permissions', '-p', 'do something'])
  })
})
