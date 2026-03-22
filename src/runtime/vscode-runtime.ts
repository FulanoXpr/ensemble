import * as vscode from 'vscode'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { OutputBuffer } from './output-buffer.js'
import type { AgentRuntime, DiscoveredSession } from '../core/agent-runtime-interface.js'

/**
 * Internal record tracking each managed pseudoterminal.
 */
interface ManagedTerminal {
  name: string
  cwd: string
  terminal: vscode.Terminal
  buffer: OutputBuffer
  writeEmitter: vscode.EventEmitter<string>
  closeEmitter: vscode.EventEmitter<number | void>
  createdAt: Date
  pty: vscode.Pseudoterminal
  process?: ChildProcess
  env?: Record<string, string>
}

/**
 * Exported helper: split a command string into {command, args}.
 * Handles simple quoting but is not a full shell parser.
 */
export function parseCommand(commandStr: string): { command: string; args: string[] } {
  const parts: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < commandStr.length; i++) {
    const ch = commandStr[i]
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (ch === ' ' && !inSingle && !inDouble) {
      if (current.length > 0) {
        parts.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current.length > 0) {
    parts.push(current)
  }

  const [command = '', ...args] = parts
  return { command, args }
}

/**
 * VSCodeRuntime — AgentRuntime backed by VSCode Pseudoterminals.
 *
 * Two modes:
 *   1. Dummy terminals (createSession) — no real process, useful for testing.
 *   2. Process-backed terminals (createProcessSession) — real child_process.spawn.
 */
export class VSCodeRuntime implements AgentRuntime {
  readonly type = 'vscode' as const

  private terminals = new Map<string, ManagedTerminal>()

  // ── Discovery ─────────────────────────────────────────────

  async listSessions(): Promise<DiscoveredSession[]> {
    return Array.from(this.terminals.values()).map(t => ({
      name: t.name,
      windows: 1,
      createdAt: t.createdAt.toISOString(),
      workingDirectory: t.cwd,
    }))
  }

  // ── Existence / status ────────────────────────────────────

  async sessionExists(name: string): Promise<boolean> {
    return this.terminals.has(name)
  }

  async getWorkingDirectory(name: string): Promise<string> {
    const t = this.terminals.get(name)
    return t?.cwd ?? ''
  }

  async isInCopyMode(_name: string): Promise<boolean> {
    // VSCode terminals don't have a copy mode concept
    return false
  }

  async cancelCopyMode(_name: string): Promise<void> {
    // No-op for VSCode
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /**
   * Create a "dummy" pseudoterminal — no real process.
   * Good for testing and for terminal panels that are driven entirely
   * through simulateOutput / sendKeys.
   *
   * NOTE: We do NOT pass `cwd` to createTerminal when using a custom pty
   * because VSCode ignores it.
   */
  async createSession(name: string, cwd: string): Promise<void> {
    if (this.terminals.has(name)) {
      throw new Error(`Session "${name}" already exists`)
    }

    const writeEmitter = new vscode.EventEmitter<string>()
    const closeEmitter = new vscode.EventEmitter<number | void>()
    const buffer = new OutputBuffer()

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => {},
      close: () => {},
      handleInput: (_data: string) => {
        // Dummy terminal — nothing to forward to
      },
    }

    const terminal = vscode.window.createTerminal({ name, pty })

    this.terminals.set(name, {
      name,
      cwd,
      terminal,
      buffer,
      writeEmitter,
      closeEmitter,
      createdAt: new Date(),
      pty,
    })
  }

  /**
   * Create a process-backed pseudoterminal.
   * Spawns `command` via child_process.spawn with shell:true.
   * Process stdout/stderr feed into both the writeEmitter (terminal display)
   * and the OutputBuffer (programmatic capture).
   */
  async createProcessSession(name: string, command: string, cwd: string): Promise<void> {
    if (this.terminals.has(name)) {
      throw new Error(`Session "${name}" already exists`)
    }

    const writeEmitter = new vscode.EventEmitter<string>()
    const closeEmitter = new vscode.EventEmitter<number | void>()
    const buffer = new OutputBuffer()

    const proc = spawn(command, [], { cwd, shell: true, stdio: 'pipe' })

    const feedData = (data: Buffer | string) => {
      const text = data.toString()
      writeEmitter.fire(text)
      buffer.write(text)
    }

    proc.stdout?.on('data', feedData)
    proc.stderr?.on('data', feedData)
    proc.on('close', (code) => {
      closeEmitter.fire(code ?? 0)
    })

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => {},
      close: () => {
        if (!proc.killed) {
          proc.kill()
        }
      },
      handleInput: (data: string) => {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write(data)
        }
      },
    }

    const terminal = vscode.window.createTerminal({ name, pty })

    this.terminals.set(name, {
      name,
      cwd,
      terminal,
      buffer,
      writeEmitter,
      closeEmitter,
      createdAt: new Date(),
      pty,
      process: proc,
    })
  }

  async killSession(name: string): Promise<void> {
    const t = this.terminals.get(name)
    if (!t) return

    if (t.process && !t.process.killed) {
      t.process.kill()
    }
    t.terminal.dispose()
    t.writeEmitter.dispose()
    t.closeEmitter.dispose()
    this.terminals.delete(name)
  }

  async renameSession(oldName: string, newName: string): Promise<void> {
    const t = this.terminals.get(oldName)
    if (!t) throw new Error(`Session "${oldName}" not found`)
    if (this.terminals.has(newName)) throw new Error(`Session "${newName}" already exists`)

    t.name = newName
    this.terminals.delete(oldName)
    this.terminals.set(newName, t)
    // Note: VSCode Terminal API does not support renaming after creation.
    // The internal tracking is updated, but the tab name remains unchanged.
  }

  // ── I/O ───────────────────────────────────────────────────

  /**
   * Send keystrokes to a terminal.
   *
   * For process-backed terminals: write directly to proc.stdin
   *   (avoids echo duplication from terminal.sendText).
   * For dummy terminals: use terminal.sendText and write to buffer manually.
   */
  async sendKeys(
    name: string,
    keys: string,
    opts?: { literal?: boolean; enter?: boolean },
  ): Promise<void> {
    const t = this.terminals.get(name)
    if (!t) throw new Error(`Session "${name}" not found`)

    const addNewLine = opts?.enter !== false

    if (t.process) {
      // Process-backed: write directly to stdin
      const payload = addNewLine ? keys + '\n' : keys
      if (t.process.stdin && !t.process.stdin.destroyed) {
        t.process.stdin.write(payload)
      }
    } else {
      // Dummy terminal: use sendText (which triggers handleInput in our mock)
      // and manually write to buffer so capturePane sees it
      t.terminal.sendText(keys, addNewLine)
      const payload = addNewLine ? keys + '\n' : keys
      t.buffer.write(payload)
    }
  }

  /**
   * Read a file's content and send it to the terminal with literal=true, enter=true.
   */
  async pasteFromFile(name: string, filePath: string): Promise<void> {
    const content = await readFile(filePath, 'utf-8')
    await this.sendKeys(name, content, { literal: true, enter: true })
  }

  /**
   * Return the last N lines from the terminal's output buffer.
   * Returns '' for unknown sessions.
   */
  async capturePane(name: string, lines?: number): Promise<string> {
    const t = this.terminals.get(name)
    if (!t) return ''
    return t.buffer.capture(lines)
  }

  // ── Environment ───────────────────────────────────────────

  async setEnvironment(name: string, key: string, value: string): Promise<void> {
    const t = this.terminals.get(name)
    if (!t) throw new Error(`Session "${name}" not found`)
    if (!t.env) t.env = {}
    t.env[key] = value
    // For process-backed terminals we could write export commands,
    // but the primary use is passing env at spawn time.
  }

  async unsetEnvironment(name: string, key: string): Promise<void> {
    const t = this.terminals.get(name)
    if (!t) throw new Error(`Session "${name}" not found`)
    if (t.env) {
      delete t.env[key]
    }
  }

  // ── PTY / Attach ──────────────────────────────────────────

  getAttachCommand(name: string): { command: string; args: string[] } {
    // In VSCode, there's no external attach — the terminal IS the view.
    // Return a no-op command.
    return { command: 'echo', args: [`Terminal "${name}" is embedded in VSCode`] }
  }

  // ── Extension-specific methods (not in AgentRuntime) ──────

  /**
   * Simulate output arriving on the terminal — fires writeEmitter and writes to buffer.
   * Useful for testing without a real process.
   */
  simulateOutput(name: string, data: string): void {
    const t = this.terminals.get(name)
    if (!t) throw new Error(`Session "${name}" not found`)
    t.writeEmitter.fire(data)
    t.buffer.write(data)
  }

  /**
   * Get the underlying VSCode Terminal for a session.
   */
  getTerminal(name: string): vscode.Terminal | undefined {
    return this.terminals.get(name)?.terminal
  }

  /**
   * Get the OutputBuffer for a session.
   */
  getBuffer(name: string): OutputBuffer | undefined {
    return this.terminals.get(name)?.buffer
  }

  /**
   * Kill all terminals and clean up.
   */
  disposeAll(): void {
    for (const [name] of this.terminals) {
      // Use void to fire-and-forget the async killSession
      void this.killSession(name)
    }
  }
}
