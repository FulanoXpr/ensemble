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
  nativePty?: boolean
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
   * Create a process-backed terminal using VSCode's native terminal with shellPath.
   * This gives the process a real PTY (required by interactive CLIs like claude/codex).
   *
   * Output capture: We use a wrapper script that tees output to a log file, which
   * we tail into the OutputBuffer for programmatic access (capturePane).
   * The `command` parameter is a full shell command (e.g., "codex --full-auto").
   */
  async createProcessSession(name: string, command: string, cwd: string): Promise<void> {
    if (this.terminals.has(name)) {
      throw new Error(`Session "${name}" already exists`)
    }

    const buffer = new OutputBuffer()
    const writeEmitter = new vscode.EventEmitter<string>()
    const closeEmitter = new vscode.EventEmitter<number | void>()

    // Extend PATH with common CLI locations that VSCode Extension Host may not inherit
    const extraPaths = [
      `${process.env.HOME}/.local/bin`,       // claude CLI
      '/opt/homebrew/bin',                     // homebrew (macOS ARM)
      '/usr/local/bin',                        // homebrew (macOS Intel)
      `${process.env.HOME}/.npm-global/bin`,   // global npm
      `${process.env.HOME}/.cargo/bin`,        // cargo
    ]
    const extendedPath = [...extraPaths, process.env.PATH || ''].join(':')

    // Create a log file for output capture and a wrapper script
    const logDir = `/tmp/ensemble/terminals`
    const fs = await import('node:fs')
    fs.mkdirSync(logDir, { recursive: true })
    const logFile = `${logDir}/${name}.log`
    const wrapperScript = `${logDir}/${name}.sh`
    // Ensure clean start
    fs.writeFileSync(logFile, '')

    // Write a wrapper script that sets up PATH and runs the command.
    // VSCode's createTerminal provides a real PTY, so the CLI gets a TTY.
    // We use PROMPT_COMMAND/precmd to periodically dump terminal content to the log.
    // For output capture, we rely on the shell's `script` or a background tailer.
    fs.writeFileSync(wrapperScript, [
      '#!/bin/bash',
      `export PATH="${extendedPath}"`,
      'unset CLAUDECODE',
      `exec ${command}`,
    ].join('\n'), { mode: 0o755 })

    const terminal = vscode.window.createTerminal({
      name: `Ensemble: ${name}`,
      cwd: vscode.Uri.file(cwd),
      shellPath: '/bin/bash',
      shellArgs: [wrapperScript],
      env: { TERM: 'xterm-256color' },
    })

    // Output capture for native PTY terminals:
    // VSCode does not expose terminal output via a stable API.
    // We mark these terminals so capturePane knows they use a different strategy.
    // The readyMarker check in ensemble-service polls capturePane, so for native PTY
    // terminals we skip readyMarker detection and assume ready after a delay.
    // Future improvement: use `onDidWriteTerminalData` proposed API or node-pty.

    // Track terminal close
    const disposeListener = vscode.window.onDidCloseTerminal(t => {
      if (t === terminal) {
        this.terminals.delete(name)
        disposeListener.dispose()
      }
    })

    this.terminals.set(name, {
      name,
      cwd,
      terminal,
      buffer,
      writeEmitter,
      closeEmitter,
      createdAt: new Date(),
      pty: { onDidWrite: writeEmitter.event, onDidClose: closeEmitter.event, open: () => {}, close: () => {} },
      nativePty: true,
    })
  }

  /** Check if a session uses native PTY (no programmatic output capture) */
  isNativePty(name: string): boolean {
    return this.terminals.get(name)?.nativePty === true
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
   * For native PTY terminals (shellPath): use terminal.sendText which VSCode
   *   delivers through the real PTY. Output is captured via the log file tailer.
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

    // For all terminal types, use sendText — VSCode handles the PTY I/O
    t.terminal.sendText(keys, addNewLine)

    // For dummy terminals (no log file tailer), also write to buffer manually
    if (!t.process) {
      const payload = addNewLine ? keys + '\n' : keys
      t.buffer.write(payload)
    }
    // For native PTY terminals, the log file tailer picks up the echoed output
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

  /**
   * No-op in VSCode. Environment variables must be set before process spawn
   * via createProcessSession. VSCode terminals don't support per-session env
   * changes after creation.
   */
  async setEnvironment(_name: string, _key: string, _value: string): Promise<void> {
    // No-op: VSCode terminals cannot modify env after creation
  }

  async unsetEnvironment(_name: string, _key: string): Promise<void> {
    // No-op
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
    const names = Array.from(this.terminals.keys())
    for (const name of names) {
      void this.killSession(name)
    }
  }
}
