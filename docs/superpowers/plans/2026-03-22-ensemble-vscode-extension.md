# Ensemble for VSCode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Ensemble from a tmux-based CLI multi-agent orchestrator into a native VSCode extension where agents run in pseudoterminals, orchestration happens via an embedded HTTP server, and monitoring lives in Webview panels.

**Architecture:** Hybrid approach — agents run in VSCode Pseudoterminals (interactive + programmatic I/O), a Webview sidebar handles team configuration, and a Webview "Mission Control" panel provides a real-time dashboard with message feed, token metrics, timeline, and diff preview. The existing `AgentRuntime` interface in `lib/agent-runtime.ts` is the key abstraction: we implement `VSCodeRuntime` against it, and the entire service layer (registry, spawner, watchdog, staged-workflow) works with zero changes to business logic.

**Tech Stack:** TypeScript, VSCode Extension API (`vscode.Pseudoterminal`, `vscode.WebviewViewProvider`, `vscode.WebviewPanel`), Node.js `http` for embedded server, vanilla JS + CSS for webview UIs (no React dependency to keep extension lean), vitest for unit tests.

---

## Scope Check

This plan covers 4 phases that each produce working, testable software:

| Phase | What it delivers | Testable outcome |
|-------|-----------------|------------------|
| 1. Foundation | Extension scaffold + `VSCodeRuntime` + ported core | Agent spawns in VSCode terminal, readyMarker detected |
| 2. Server & Commands | Embedded HTTP server + command palette | Can create/disband teams via commands, API works |
| 3. Sidebar | Webview sidebar for team management | Visual team creation, agent status display |
| 4. Mission Control | Dashboard webview panel | Live feed, token metrics, message injection, diff preview |

---

## File Structure

```
ensemble-vscode/
  package.json                    — Extension manifest (commands, views, config, activation)
  tsconfig.json                   — TypeScript config targeting ES2022 + VSCode types
  .vscodeignore                   — Exclude source from packaged extension
  esbuild.config.mjs              — Bundle extension + webviews

  src/
    extension.ts                  — activate() / deactivate() entry point
    constants.ts                  — Shared constants (ports, timeouts, channel names)

    runtime/
      vscode-runtime.ts           — VSCodeRuntime implements AgentRuntime using Pseudoterminal
      output-buffer.ts            — Ring buffer that captures pseudoterminal output (replaces tmux capture-pane)

    core/                         — Ported from original lib/ with minimal changes
      types.ts                    — Re-export from original types/
      agent-runtime-interface.ts  — AgentRuntime interface extracted (adds 'vscode' to type union)
      runtime-singleton.ts        — getRuntime()/setRuntime() singleton
      agent-config.ts             — Adapted: reads agents.json from extension context, replaces import.meta.url with __dirname
      ensemble-registry.ts        — Adapted: lazy getEnsembleRegistryDir() call (not module-level)
      ensemble-paths.ts           — Adapted: uses globalStorageUri instead of ~/.ensemble
      collab-paths.ts             — Adapted: ephemeral data stays in /tmp/ensemble, registry data in globalStorageUri
      agent-spawner.ts            — Rewritten: uses VSCodeRuntime instead of tmux, removes remote agent support (v1 = local only)
      agent-watchdog.ts           — Reused as-is (depends only on AgentRuntime interface)
      worktree-manager.ts         — Reused as-is (pure git operations)
      staged-workflow.ts          — Adapted: stub out postRemoteSessionCommand import (not available in v1)
      hosts-config.ts             — Simplified: only "self" host in v1

    service/
      ensemble-service.ts         — Adapted from services/ensemble-service.ts (removes remote agent paths)
      embedded-server.ts          — HTTP server on localhost:23000, started in activate()

    commands/
      create-team.ts              — Command: ensemble.createTeam (quick-pick UI)
      disband-team.ts             — Command: ensemble.disbandTeam
      show-mission-control.ts     — Command: ensemble.showMissionControl
      send-message.ts             — Command: ensemble.sendMessage (input box)
      list-teams.ts               — Command: ensemble.listTeams (quick-pick)

    views/
      sidebar-provider.ts         — WebviewViewProvider for the sidebar
      mission-control-panel.ts    — WebviewPanel factory for the dashboard

    webview/
      sidebar.html                — Sidebar webview entry
      sidebar.js                  — Sidebar logic (team creation form, agent status cards)
      sidebar.css                 — Sidebar styles
      mission-control.html        — Dashboard webview entry
      mission-control.js          — Dashboard logic (feed, timeline, metrics, diff, message input)
      mission-control.css         — Dashboard styles
      shared.css                  — Shared design tokens (colors, typography)

  media/
    icon.png                      — Extension icon
    agents/                       — Per-agent icons (claude.svg, codex.svg, gemini.svg)

  test/
    unit/
      vscode-runtime.test.ts      — VSCodeRuntime with mock Pseudoterminal
      output-buffer.test.ts       — Ring buffer behavior
      agent-spawner.test.ts       — Spawn logic with mocked runtime
      ensemble-service.test.ts    — Service integration tests
      embedded-server.test.ts     — HTTP endpoint tests
    integration/
      extension.test.ts           — VSCode extension host tests (activate, commands)
```

### Files from original Ensemble that are REUSED as-is:
- `types/ensemble.ts` → copied to `src/core/types.ts`
- `types/agent-program.ts` → copied to `src/core/types.ts`
- `lib/agent-watchdog.ts` → copied to `src/core/agent-watchdog.ts`
- `lib/worktree-manager.ts` → copied to `src/core/worktree-manager.ts`
- `agents.json` → copied to root (bundled with extension, **with `--dangerously-skip-permissions` removed** — users opt in via settings)
- `collab-templates.json` → copied to root (bundled with extension)

### Files that need ADAPTATION (logic preserved, imports/paths changed):
- `lib/agent-config.ts` → `src/core/agent-config.ts` (use `__dirname` instead of `import.meta.url`, add extension context path resolution)
- `lib/ensemble-registry.ts` → `src/core/ensemble-registry.ts` (make `getEnsembleRegistryDir()` lazy — call per-invocation, not at module level)
- `lib/ensemble-paths.ts` → `src/core/ensemble-paths.ts` (use globalStorageUri)
- `lib/collab-paths.ts` → `src/core/collab-paths.ts` (ephemeral runtime data stays in `/tmp/ensemble` for performance; registry data uses globalStorageUri)
- `lib/staged-workflow.ts` → `src/core/staged-workflow.ts` (stub out `postRemoteSessionCommand` as no-op; remove remote host code paths)
- `lib/hosts-config.ts` → `src/core/hosts-config.ts` (simplified to local-only)
- `services/ensemble-service.ts` → `src/service/ensemble-service.ts` (remove remote paths)
- `server.ts` → `src/service/embedded-server.ts` (embedded, no standalone)

### Files that are NEW (the core innovation):
- `src/runtime/vscode-runtime.ts` — The `VSCodeRuntime` class
- `src/runtime/output-buffer.ts` — Pseudoterminal output capture
- `src/extension.ts` — Extension lifecycle
- `src/commands/*` — All command handlers
- `src/views/*` — Webview providers
- `src/webview/*` — Webview HTML/JS/CSS
- `package.json` — Extension manifest (completely new)

---

## Phase 1: Foundation — Extension Scaffold + VSCodeRuntime + Core Port

### Task 1: Scaffold the VSCode extension

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.vscodeignore`
- Create: `src/extension.ts`
- Create: `src/constants.ts`

- [ ] **Step 1: Initialize package.json as a VSCode extension**

```json
{
  "name": "ensemble-vscode",
  "displayName": "Ensemble — Multi-Agent Collaboration",
  "description": "Orchestrate AI agents (Claude Code, Codex, Gemini CLI) into collaborative teams inside VSCode",
  "version": "0.1.0",
  "publisher": "fulano",
  "engines": { "vscode": "^1.95.0" },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "ensemble.createTeam", "title": "Ensemble: Create Team" },
      { "command": "ensemble.disbandTeam", "title": "Ensemble: Disband Team" },
      { "command": "ensemble.showMissionControl", "title": "Ensemble: Show Mission Control" },
      { "command": "ensemble.sendMessage", "title": "Ensemble: Send Message to Team" },
      { "command": "ensemble.listTeams", "title": "Ensemble: List Teams" }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "ensemble",
          "title": "Ensemble",
          "icon": "media/icon.png"
        }
      ]
    },
    "views": {
      "ensemble": [
        {
          "type": "webview",
          "id": "ensemble.sidebar",
          "name": "Teams"
        }
      ]
    },
    "configuration": {
      "title": "Ensemble",
      "properties": {
        "ensemble.serverPort": {
          "type": "number",
          "default": 23000,
          "description": "Port for the embedded Ensemble HTTP server"
        },
        "ensemble.agentsConfigPath": {
          "type": "string",
          "default": "",
          "description": "Custom path to agents.json (leave empty for bundled default)"
        },
        "ensemble.autoDisband": {
          "type": "boolean",
          "default": true,
          "description": "Automatically disband teams when agents signal completion"
        },
        "ensemble.useWorktrees": {
          "type": "boolean",
          "default": false,
          "description": "Isolate each agent in its own git worktree"
        },
        "ensemble.claudeSkipPermissions": {
          "type": "boolean",
          "default": false,
          "description": "Pass --dangerously-skip-permissions to Claude Code (requires confirmation dialog)"
        }
      }
    }
  },
  "scripts": {
    "compile": "esbuild src/extension.ts --bundle --outdir=dist --external:vscode --format=cjs --platform=node",
    "watch": "npm run compile -- --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/uuid": "^9.0.0",
    "@types/vscode": "^1.95.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  },
  "dependencies": {
    "uuid": "^9.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create minimal extension.ts**

```typescript
import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Ensemble')
  outputChannel.appendLine('Ensemble extension activated')

  // Store context globally for other modules to access
  globalContext = context
}

export function deactivate() {}

let globalContext: vscode.ExtensionContext | undefined
export function getExtensionContext(): vscode.ExtensionContext {
  if (!globalContext) throw new Error('Extension not activated')
  return globalContext
}
```

- [ ] **Step 4: Create constants.ts**

```typescript
export const DEFAULT_SERVER_PORT = 23000
export const EXTENSION_ID = 'ensemble-vscode'
export const OUTPUT_CHANNEL_NAME = 'Ensemble'
export const IDLE_CHECK_INTERVAL_MS = 15_000
export const AGENT_READY_TIMEOUT_MS = 60_000
export const OUTPUT_BUFFER_MAX_LINES = 2000
```

- [ ] **Step 5: Create .vscodeignore**

```
src/**
test/**
node_modules/**
.git/**
tsconfig.json
esbuild.config.mjs
.eslintrc.json
*.ts
!dist/**
```

- [ ] **Step 6: Install dependencies and verify compilation**

Run: `npm install && npx tsc --noEmit`
Expected: Clean compilation with no errors

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .vscodeignore src/extension.ts src/constants.ts
git commit -m "feat: scaffold VSCode extension with manifest and entry point"
```

---

### Task 2: Implement OutputBuffer — ring buffer for terminal capture

**Files:**
- Create: `src/runtime/output-buffer.ts`
- Create: `test/unit/output-buffer.test.ts`

This is the critical building block that replaces `tmux capture-pane`. Every pseudoterminal will have an OutputBuffer that stores the last N lines of output.

- [ ] **Step 1: Write failing tests for OutputBuffer**

```typescript
// test/unit/output-buffer.test.ts
import { describe, it, expect } from 'vitest'
import { OutputBuffer } from '../../src/runtime/output-buffer'

describe('OutputBuffer', () => {
  it('stores written data and returns it via capture', () => {
    const buf = new OutputBuffer(100)
    buf.write('Hello world\r\n')
    buf.write('Second line\r\n')
    expect(buf.capture()).toContain('Hello world')
    expect(buf.capture()).toContain('Second line')
  })

  it('respects max lines limit', () => {
    const buf = new OutputBuffer(3)
    buf.write('line1\r\nline2\r\nline3\r\nline4\r\nline5\r\n')
    const captured = buf.capture()
    expect(captured).not.toContain('line1')
    expect(captured).not.toContain('line2')
    expect(captured).toContain('line3')
    expect(captured).toContain('line4')
    expect(captured).toContain('line5')
  })

  it('capture with lineCount returns only last N lines', () => {
    const buf = new OutputBuffer(100)
    buf.write('a\r\nb\r\nc\r\nd\r\n')
    const last2 = buf.capture(2)
    expect(last2).not.toContain('a')
    expect(last2).not.toContain('b')
    expect(last2).toContain('c')
    expect(last2).toContain('d')
  })

  it('handles data without trailing newline', () => {
    const buf = new OutputBuffer(100)
    buf.write('partial')
    expect(buf.capture()).toContain('partial')
  })

  it('strips ANSI escape codes when capturing', () => {
    const buf = new OutputBuffer(100)
    buf.write('\x1b[32mgreen text\x1b[0m\r\n')
    expect(buf.capture()).toContain('green text')
    expect(buf.capture()).not.toContain('\x1b')
  })

  it('includes(text) searches the buffer content', () => {
    const buf = new OutputBuffer(100)
    buf.write('Agent is ready >\r\n')
    expect(buf.includes('ready')).toBe(true)
    expect(buf.includes('nothere')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/output-buffer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement OutputBuffer**

```typescript
// src/runtime/output-buffer.ts

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g

export class OutputBuffer {
  private lines: string[] = []
  private partial = ''

  constructor(private readonly maxLines: number = 2000) {}

  write(data: string): void {
    const text = this.partial + data
    const parts = text.split(/\r?\n/)
    // Last element is either empty (if data ended with newline) or a partial line
    this.partial = parts.pop() ?? ''

    for (const line of parts) {
      this.lines.push(line)
    }

    // Trim to maxLines
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(this.lines.length - this.maxLines)
    }
  }

  capture(lineCount?: number): string {
    const allLines = this.partial
      ? [...this.lines, this.partial]
      : [...this.lines]

    const selected = lineCount
      ? allLines.slice(-lineCount)
      : allLines

    return selected
      .map(line => line.replace(ANSI_REGEX, ''))
      .join('\n')
  }

  includes(text: string): boolean {
    return this.capture().includes(text)
  }

  clear(): void {
    this.lines = []
    this.partial = ''
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/output-buffer.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime/output-buffer.ts test/unit/output-buffer.test.ts
git commit -m "feat: add OutputBuffer ring buffer for pseudoterminal capture"
```

---

### Task 3: Implement VSCodeRuntime — the core AgentRuntime for VSCode

**Files:**
- Create: `src/runtime/vscode-runtime.ts`
- Create: `test/unit/vscode-runtime.test.ts`

This is the single most important piece of the extension. It implements the `AgentRuntime` interface from the original Ensemble using VSCode's `Pseudoterminal` API instead of tmux.

- [ ] **Step 1: Write failing tests for VSCodeRuntime**

```typescript
// test/unit/vscode-runtime.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock vscode module
vi.mock('vscode', () => ({
  window: {
    createTerminal: vi.fn(),
  },
  EventEmitter: vi.fn().mockImplementation(() => ({
    event: vi.fn(),
    fire: vi.fn(),
  })),
}))

import { VSCodeRuntime } from '../../src/runtime/vscode-runtime'

describe('VSCodeRuntime', () => {
  let runtime: VSCodeRuntime

  beforeEach(() => {
    runtime = new VSCodeRuntime()
  })

  it('has type "vscode"', () => {
    expect(runtime.type).toBe('vscode')
  })

  it('createSession creates a pseudoterminal and tracks it', async () => {
    await runtime.createSession('test-agent', '/tmp/test')
    expect(await runtime.sessionExists('test-agent')).toBe(true)
  })

  it('sessionExists returns false for unknown sessions', async () => {
    expect(await runtime.sessionExists('nonexistent')).toBe(false)
  })

  it('killSession removes the session', async () => {
    await runtime.createSession('doomed-agent', '/tmp/test')
    await runtime.killSession('doomed-agent')
    expect(await runtime.sessionExists('doomed-agent')).toBe(false)
  })

  it('capturePane returns buffer contents', async () => {
    await runtime.createSession('capture-test', '/tmp/test')
    // Simulate terminal output by writing directly to the buffer
    runtime.simulateOutput('capture-test', 'Hello from agent\r\n')
    const output = await runtime.capturePane('capture-test', 50)
    expect(output).toContain('Hello from agent')
  })

  it('capturePane returns empty string for dead sessions', async () => {
    const output = await runtime.capturePane('ghost', 50)
    expect(output).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/vscode-runtime.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement VSCodeRuntime**

```typescript
// src/runtime/vscode-runtime.ts
import * as vscode from 'vscode'
import { OutputBuffer } from './output-buffer'
import type { AgentRuntime, DiscoveredSession } from '../core/agent-runtime-interface'

interface ManagedTerminal {
  name: string
  cwd: string
  terminal: vscode.Terminal
  buffer: OutputBuffer
  writeEmitter: vscode.EventEmitter<string>
  closeEmitter: vscode.EventEmitter<number | void>
  createdAt: string
  pty: vscode.Pseudoterminal
}

export class VSCodeRuntime implements AgentRuntime {
  readonly type = 'vscode' as const
  private terminals = new Map<string, ManagedTerminal>()

  async listSessions(): Promise<DiscoveredSession[]> {
    return Array.from(this.terminals.values()).map(t => ({
      name: t.name,
      windows: 1,
      createdAt: t.createdAt,
      workingDirectory: t.cwd,
    }))
  }

  async sessionExists(name: string): Promise<boolean> {
    return this.terminals.has(name)
  }

  async getWorkingDirectory(name: string): Promise<string> {
    return this.terminals.get(name)?.cwd ?? ''
  }

  async isInCopyMode(): Promise<boolean> {
    return false // Not applicable in VSCode
  }

  async cancelCopyMode(): Promise<void> {
    // No-op in VSCode
  }

  async createSession(name: string, cwd: string): Promise<void> {
    if (this.terminals.has(name)) {
      await this.killSession(name)
    }

    const buffer = new OutputBuffer(2000)
    const writeEmitter = new vscode.EventEmitter<string>()
    const closeEmitter = new vscode.EventEmitter<number | void>()

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: () => {},
      close: () => {
        this.terminals.delete(name)
      },
      handleInput: (data: string) => {
        // Echo user input back and forward to the underlying process
        // For now, this is handled by sendKeys which writes directly
        writeEmitter.fire(data)
      },
    }

    // Note: cwd is NOT passed to createTerminal when using a custom pty —
    // VSCode ignores it. The cwd is passed to child_process.spawn in createProcessSession.
    const terminal = vscode.window.createTerminal({
      name: `Ensemble: ${name}`,
      pty,
    })

    this.terminals.set(name, {
      name,
      cwd,
      terminal,
      buffer,
      writeEmitter,
      closeEmitter,
      createdAt: new Date().toISOString(),
      pty,
    })
  }

  async killSession(name: string): Promise<void> {
    const managed = this.terminals.get(name)
    if (!managed) return
    managed.terminal.dispose()
    this.terminals.delete(name)
  }

  async renameSession(_oldName: string, _newName: string): Promise<void> {
    // VSCode terminals cannot be renamed after creation
    // We'd need to recreate — skip for v1
  }

  async sendKeys(
    name: string,
    keys: string,
    opts: { literal?: boolean; enter?: boolean } = {},
  ): Promise<void> {
    const managed = this.terminals.get(name)
    if (!managed) throw new Error(`Session ${name} not found`)

    const text = opts.literal ? keys : keys

    // For process-backed terminals, write directly to stdin to avoid
    // the echo duplication from terminal.sendText → handleInput → stdin → stdout → buffer.
    // For dummy terminals (no process), use sendText which triggers handleInput.
    if (managed.process) {
      managed.process.stdin?.write(text + (opts.enter ? '\n' : ''))
    } else {
      managed.terminal.sendText(text, opts.enter ?? false)
      // Only write to buffer for non-process terminals (process terminals
      // get buffer writes from stdout naturally)
      managed.buffer.write(text + (opts.enter ? '\r\n' : ''))
    }
  }

  async pasteFromFile(name: string, filePath: string): Promise<void> {
    const fs = await import('fs')
    const content = fs.readFileSync(filePath, 'utf-8')
    await this.sendKeys(name, content, { literal: true, enter: true })
  }

  async capturePane(name: string, lines: number = 2000): Promise<string> {
    const managed = this.terminals.get(name)
    if (!managed) return ''
    return managed.buffer.capture(lines)
  }

  async setEnvironment(_name: string, _key: string, _value: string): Promise<void> {
    // VSCode terminals don't support per-session env changes after creation
  }

  async unsetEnvironment(_name: string, _key: string): Promise<void> {
    // No-op
  }

  getAttachCommand(name: string): { command: string; args: string[] } {
    return { command: 'echo', args: [`VSCode terminal: ${name}`] }
  }

  // --- Extension-specific methods ---

  /** Get the VSCode Terminal instance for direct access */
  getTerminal(name: string): vscode.Terminal | undefined {
    return this.terminals.get(name)?.terminal
  }

  /** Get the output buffer for direct access */
  getBuffer(name: string): OutputBuffer | undefined {
    return this.terminals.get(name)?.buffer
  }

  /** Simulate output from the process (for testing and for process-spawned terminals) */
  simulateOutput(name: string, data: string): void {
    const managed = this.terminals.get(name)
    if (!managed) return
    managed.writeEmitter.fire(data)
    managed.buffer.write(data)
  }

  /** Dispose all terminals */
  disposeAll(): void {
    for (const [name] of this.terminals) {
      const managed = this.terminals.get(name)
      managed?.terminal.dispose()
    }
    this.terminals.clear()
  }
}
```

**IMPORTANT NOTE:** The Pseudoterminal approach above is a "controlled terminal" — it renders output we fire via `writeEmitter`. But for real agent CLI processes, we need a different approach: we spawn the actual CLI process and pipe its stdout/stderr into the pseudoterminal. This will be refined in Task 4 (agent-spawner) where we use `child_process.spawn` and pipe to both the terminal display and the OutputBuffer.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/vscode-runtime.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime/vscode-runtime.ts test/unit/vscode-runtime.test.ts
git commit -m "feat: implement VSCodeRuntime with Pseudoterminal-based agent sessions"
```

---

### Task 4: Implement real process-backed Pseudoterminals

**Files:**
- Modify: `src/runtime/vscode-runtime.ts` (add `createProcessSession` method)
- Create: `test/unit/process-terminal.test.ts`

The VSCodeRuntime from Task 3 creates "dummy" pseudoterminals. For real agents, we need to spawn a CLI process (`claude`, `codex`, `gemini`) and pipe its I/O through the pseudoterminal so both the user sees it AND we capture it programmatically.

- [ ] **Step 1: Write failing test for process-backed sessions**

```typescript
// test/unit/process-terminal.test.ts
import { describe, it, expect, vi } from 'vitest'
import { parseCommand } from '../../src/runtime/vscode-runtime'

// We test the command parsing helper independently of vscode
describe('parseCommand', () => {
  it('splits a simple command into command and args', () => {
    const result = parseCommand('echo hello')
    expect(result.command).toBe('echo')
    expect(result.args).toEqual(['hello'])
  })

  it('splits command with flags correctly', () => {
    const result = parseCommand('codex --full-auto')
    expect(result.command).toBe('codex')
    expect(result.args).toEqual(['--full-auto'])
  })

  it('handles command with no args', () => {
    const result = parseCommand('gemini')
    expect(result.command).toBe('gemini')
    expect(result.args).toEqual([])
  })
})
```

And export a `parseCommand` helper from `vscode-runtime.ts`:
```typescript
export function parseCommand(commandStr: string): { command: string; args: string[] } {
  const [command, ...args] = commandStr.split(/\s+/)
  return { command, args }
}
```

- [ ] **Step 2: Implement createProcessSession in VSCodeRuntime**

Add to `src/runtime/vscode-runtime.ts`:

```typescript
/**
 * Create a session that spawns a real CLI process.
 * The process stdout/stderr feed into both the pseudoterminal display
 * AND the OutputBuffer for programmatic capture.
 */
async createProcessSession(name: string, command: string, cwd: string): Promise<void> {
  if (this.terminals.has(name)) {
    await this.killSession(name)
  }

  const buffer = new OutputBuffer(2000)
  const writeEmitter = new vscode.EventEmitter<string>()
  const closeEmitter = new vscode.EventEmitter<number | void>()

  const [cmd, ...args] = command.split(/\s+/)
  let proc: import('child_process').ChildProcess | null = null

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {
      const cp = require('child_process') as typeof import('child_process')
      proc = cp.spawn(cmd, args, {
        cwd,
        env: { ...process.env, CLAUDECODE: undefined },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        writeEmitter.fire(text)
        buffer.write(text)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        writeEmitter.fire(text)
        buffer.write(text)
      })

      proc.on('close', (code) => {
        closeEmitter.fire(code ?? 0)
      })
    },
    close: () => {
      proc?.kill('SIGTERM')
      this.terminals.delete(name)
    },
    handleInput: (data: string) => {
      // Forward user keyboard input to the process stdin
      proc?.stdin?.write(data)
    },
  }

  const terminal = vscode.window.createTerminal({
    name: `Ensemble: ${name}`,
    pty,
  })

  this.terminals.set(name, {
    name,
    cwd,
    terminal,
    buffer,
    writeEmitter,
    closeEmitter,
    createdAt: new Date().toISOString(),
    pty,
  })
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run test/unit/process-terminal.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/runtime/vscode-runtime.ts test/unit/process-terminal.test.ts
git commit -m "feat: add process-backed pseudoterminals for real CLI agent spawning"
```

---

### Task 5: Extract AgentRuntime interface and port core types

**Files:**
- Create: `src/core/agent-runtime-interface.ts`
- Create: `src/core/types.ts`

- [ ] **Step 1: Extract the AgentRuntime interface from original code**

Copy the interface from `lib/agent-runtime.ts` lines 20-55 into `src/core/agent-runtime-interface.ts`. Add `'vscode'` to the type union:

```typescript
// src/core/agent-runtime-interface.ts
export interface DiscoveredSession {
  name: string
  windows: number
  createdAt: string
  workingDirectory: string
}

export interface AgentRuntime {
  readonly type: 'tmux' | 'vscode' | 'happy' | 'docker' | 'api' | 'direct'
  listSessions(): Promise<DiscoveredSession[]>
  sessionExists(name: string): Promise<boolean>
  getWorkingDirectory(name: string): Promise<string>
  isInCopyMode(name: string): Promise<boolean>
  cancelCopyMode(name: string): Promise<void>
  createSession(name: string, cwd: string): Promise<void>
  killSession(name: string): Promise<void>
  renameSession(oldName: string, newName: string): Promise<void>
  sendKeys(name: string, keys: string, opts?: { literal?: boolean; enter?: boolean }): Promise<void>
  pasteFromFile(name: string, filePath: string): Promise<void>
  capturePane(name: string, lines?: number): Promise<string>
  setEnvironment(name: string, key: string, value: string): Promise<void>
  unsetEnvironment(name: string, key: string): Promise<void>
  getAttachCommand(name: string, socketPath?: string): { command: string; args: string[] }
}
```

- [ ] **Step 2: Copy and consolidate types**

Copy `types/ensemble.ts` and `types/agent-program.ts` into `src/core/types.ts` as a single file with all type exports.

- [ ] **Step 3: Commit**

```bash
git add src/core/agent-runtime-interface.ts src/core/types.ts
git commit -m "feat: extract AgentRuntime interface and consolidate core types"
```

---

### Task 6: Port core modules with path adaptation

**Files:**
- Create: `src/core/ensemble-paths.ts`
- Create: `src/core/collab-paths.ts`
- Create: `src/core/agent-config.ts`
- Create: `src/core/hosts-config.ts`
- Copy: `src/core/ensemble-registry.ts`
- Copy: `src/core/agent-watchdog.ts`
- Copy: `src/core/worktree-manager.ts`
- Copy: `src/core/staged-workflow.ts`

- [ ] **Step 1: Create ensemble-paths.ts using VSCode globalStorageUri**

```typescript
// src/core/ensemble-paths.ts
import * as vscode from 'vscode'
import path from 'path'

let _storageDir: string | undefined

export function initEnsemblePaths(context: vscode.ExtensionContext): void {
  _storageDir = context.globalStorageUri.fsPath
}

export function getEnsembleRegistryDir(): string {
  if (!_storageDir) {
    // Fallback for testing or when extension context not available
    return path.join(process.env.HOME || '/tmp', '.ensemble')
  }
  return path.join(_storageDir, 'registry')
}
```

- [ ] **Step 2: Create collab-paths.ts adapted for extension storage**

Port `lib/collab-paths.ts` — change `~/.ensemble/collabs` to use `getEnsembleRegistryDir()` as base. Keep all function signatures identical.

- [ ] **Step 3: Create simplified hosts-config.ts (local only)**

```typescript
// src/core/hosts-config.ts
import os from 'os'

export function getSelfHostId(): string {
  return os.hostname()
}

export function isSelf(hostId: string): boolean {
  return !hostId || hostId === getSelfHostId()
}

export function getHostById(_hostId: string): { url: string } | undefined {
  return undefined // v1: local only, no remote hosts
}
```

- [ ] **Step 4: Create agent-config.ts adapted for extension context**

Port `lib/agent-config.ts` — change path resolution to look for `agents.json` in the extension's root directory (bundled) or a user-configured path via `ensemble.agentsConfigPath` setting.

- [ ] **Step 5: Copy and adapt modules**

Copy these files with import path adjustments:
- `lib/agent-watchdog.ts` → `src/core/agent-watchdog.ts` (change imports only)
- `lib/worktree-manager.ts` → `src/core/worktree-manager.ts` (change imports only)

These files need functional adaptation:
- `lib/ensemble-registry.ts` → `src/core/ensemble-registry.ts`:
  - **CRITICAL:** Replace module-level `const ENSEMBLE_DIR = getEnsembleRegistryDir()` with a lazy getter function. The original calls `getEnsembleRegistryDir()` at import time, but our version requires `initEnsemblePaths(context)` to have been called first. Change to: `function getDir() { return getEnsembleRegistryDir() }` and use `getDir()` in every function instead of `ENSEMBLE_DIR`.
- `lib/staged-workflow.ts` → `src/core/staged-workflow.ts`:
  - **CRITICAL:** Remove `import { postRemoteSessionCommand } from './agent-spawner'` — this function doesn't exist in our v1 spawner. Replace remote-host code paths with no-ops or remove the `if (!isSelf(hostId))` branches entirely.

Change all imports to reference `./types`, `./agent-runtime-interface`, etc.
**CRITICAL:** Replace all uses of `import.meta.url` / `fileURLToPath` with `__dirname` (works in CJS bundles).

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/core/
git commit -m "feat: port core modules to extension with path adaptation"
```

---

### Task 7: Rewrite agent-spawner for VSCode

**Files:**
- Create: `src/core/agent-spawner.ts`
- Create: `test/unit/agent-spawner.test.ts`

The spawner is rewritten to use `VSCodeRuntime.createProcessSession()` instead of tmux. Remote agent support is removed for v1.

- [ ] **Step 1: Write failing tests**

```typescript
// test/unit/agent-spawner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('vscode', () => ({
  window: { createTerminal: vi.fn() },
  EventEmitter: vi.fn().mockImplementation(() => ({
    event: vi.fn(), fire: vi.fn(),
  })),
  Uri: { file: (p: string) => ({ fsPath: p }) },
}))

import { spawnLocalAgent, killLocalAgent } from '../../src/core/agent-spawner'

describe('spawnLocalAgent', () => {
  it('returns a SpawnedAgent with correct fields', async () => {
    const agent = await spawnLocalAgent({
      name: 'test-claude',
      program: 'claude',
      workingDirectory: '/tmp/test',
    })
    expect(agent.name).toBe('test-claude')
    expect(agent.program).toBe('claude')
    expect(agent.id).toBeTruthy()
    expect(agent.sessionName).toBe('test-claude')
  })
})
```

- [ ] **Step 2: Implement agent-spawner.ts**

```typescript
// src/core/agent-spawner.ts
import { v4 as uuidv4 } from 'uuid'
import { getRuntime } from './runtime-singleton'
import { getSelfHostId } from './hosts-config'
import { buildAgentCommand } from './agent-config'
import type { OutputBuffer } from '../runtime/output-buffer'

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

export async function spawnLocalAgent(options: SpawnAgentOptions): Promise<SpawnedAgent> {
  const runtime = getRuntime()
  const agentId = uuidv4()
  const sessionName = options.name.replace(/[^a-zA-Z0-9\-_.]/g, '')
  const cwd = options.workingDirectory || process.cwd()
  const hostId = options.hostId || getSelfHostId()

  const startCommand = buildAgentCommand(options.program)

  // Use createProcessSession if runtime supports it, otherwise fall back
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
    await runtime.sendKeys(sessionName, '\x03', { enter: false }) // Ctrl+C
    await new Promise(r => setTimeout(r, 500))
    await runtime.killSession(sessionName)
  } catch {
    try { await runtime.killSession(sessionName) } catch { /* ok */ }
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
```

- [ ] **Step 3: Create runtime-singleton.ts**

```typescript
// src/core/runtime-singleton.ts
import type { AgentRuntime } from './agent-runtime-interface'

let _runtime: AgentRuntime

export function getRuntime(): AgentRuntime {
  if (!_runtime) throw new Error('Runtime not initialized. Call setRuntime() first.')
  return _runtime
}

export function setRuntime(runtime: AgentRuntime): void {
  _runtime = runtime
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/agent-spawner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-spawner.ts src/core/runtime-singleton.ts test/unit/agent-spawner.test.ts
git commit -m "feat: rewrite agent-spawner for VSCode pseudoterminals"
```

---

## Phase 2: Server & Commands

### Task 8: Port ensemble-service.ts

**Files:**
- Create: `src/service/ensemble-service.ts`
- Create: `test/unit/ensemble-service.test.ts`

Port the service layer from `services/ensemble-service.ts`. Remove remote agent code paths, Telegram notifications (replaced by VSCode notifications in a later task), and observations API posting.

- [ ] **Step 1: Port ensemble-service.ts with local-only scope**

Copy `services/ensemble-service.ts` to `src/service/ensemble-service.ts`. Make these changes:
- Remove all `spawnRemote`, `killRemoteAgent`, `postRemoteSessionCommand`, `isRemoteSessionReady` imports and usage
- Remove Telegram notification code
- Remove observations API posting
- Change all imports to point to `../core/*`
- Replace remote-host code paths with `throw new Error('Remote agents not supported in v1')`
- Keep: team creation, message routing, idle detection, auto-disband, worktree management, staged workflow

- [ ] **Step 2: Write basic integration test**

```typescript
// test/unit/ensemble-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('vscode', () => ({
  window: { createTerminal: vi.fn() },
  EventEmitter: vi.fn().mockImplementation(() => ({ event: vi.fn(), fire: vi.fn() })),
  Uri: { file: (p: string) => ({ fsPath: p }) },
}))

import { listEnsembleTeams } from '../../src/service/ensemble-service'

describe('EnsembleService', () => {
  it('listEnsembleTeams returns empty array when no teams exist', () => {
    const result = listEnsembleTeams()
    expect(result.status).toBe(200)
    expect(result.data?.teams).toEqual([])
  })
})
```

- [ ] **Step 3: Run test**

Run: `npx vitest run test/unit/ensemble-service.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/service/ensemble-service.ts test/unit/ensemble-service.test.ts
git commit -m "feat: port ensemble-service to extension (local-only, no remote agents)"
```

---

### Task 9: Create embedded HTTP server

**Files:**
- Create: `src/service/embedded-server.ts`
- Create: `test/unit/embedded-server.test.ts`

Port `server.ts` to run inside the extension process. Same endpoints, same behavior, but starts/stops with extension lifecycle.

- [ ] **Step 1: Write failing test**

```typescript
// test/unit/embedded-server.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { EmbeddedServer } from '../../src/service/embedded-server'

describe('EmbeddedServer', () => {
  const server = new EmbeddedServer(0) // port 0 = random available port

  afterAll(async () => {
    await server.stop()
  })

  it('starts and responds to health check', async () => {
    const port = await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
```

- [ ] **Step 2: Implement EmbeddedServer**

Port `server.ts` into a class that can be started/stopped programmatically. Keep all existing routes. Remove standalone `process.on` signal handlers (extension manages lifecycle).

```typescript
// src/service/embedded-server.ts
import http from 'http'
import { createEnsembleTeam, getEnsembleTeam, listEnsembleTeams,
         getTeamFeed, sendTeamMessage, disbandTeam } from './ensemble-service'

export class EmbeddedServer {
  private server: http.Server | null = null

  constructor(private port: number = 23000) {}

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res))
      this.server.listen(this.port, '127.0.0.1', () => {
        const addr = this.server!.address() as { port: number }
        this.port = addr.port
        resolve(this.port)
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

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS — allow any localhost origin (webviews use postMessage, not CORS,
    // but external tools like curl or other extensions may hit these endpoints)
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
    const path = url.pathname

    // Health
    if (path === '/api/v1/health' && req.method === 'GET') {
      this.json(res, 200, { status: 'ok', version: '0.1.0', runtime: 'vscode' })
      return
    }

    // Teams CRUD — same routes as original server.ts
    // GET /api/ensemble/teams
    // POST /api/ensemble/teams
    // GET /api/ensemble/teams/:id
    // POST /api/ensemble/teams/:id (send message)
    // DELETE /api/ensemble/teams/:id
    // GET /api/ensemble/teams/:id/feed
    // ... (implement each route handler calling ensemble-service functions)

    this.json(res, 404, { error: 'Not found' })
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
}
```

- [ ] **Step 3: Run test**

Run: `npx vitest run test/unit/embedded-server.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/service/embedded-server.ts test/unit/embedded-server.test.ts
git commit -m "feat: add embedded HTTP server for API compatibility"
```

---

### Task 10: Wire up extension.ts with full lifecycle

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Update extension.ts to initialize everything on activate**

```typescript
import * as vscode from 'vscode'
import { VSCodeRuntime } from './runtime/vscode-runtime'
import { setRuntime } from './core/runtime-singleton'
import { initEnsemblePaths } from './core/ensemble-paths'
import { EmbeddedServer } from './service/embedded-server'
import { registerCommands } from './commands'
import { SidebarProvider } from './views/sidebar-provider'

let server: EmbeddedServer | undefined
let runtime: VSCodeRuntime | undefined

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Ensemble')

  // 1. Init paths
  initEnsemblePaths(context)

  // 2. Init runtime
  runtime = new VSCodeRuntime()
  setRuntime(runtime)

  // 3. Start embedded server
  const port = vscode.workspace.getConfiguration('ensemble').get<number>('serverPort') ?? 23000
  server = new EmbeddedServer(port)
  try {
    const actualPort = await server.start()
    output.appendLine(`Ensemble server started on port ${actualPort}`)
  } catch (err) {
    output.appendLine(`Failed to start server: ${err}`)
    vscode.window.showWarningMessage(`Ensemble: Could not start server on port ${port}`)
  }

  // 4. Register commands
  registerCommands(context)

  // 5. Register sidebar
  const sidebarProvider = new SidebarProvider(context.extensionUri)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ensemble.sidebar', sidebarProvider)
  )

  output.appendLine('Ensemble extension activated')
}

export async function deactivate() {
  runtime?.disposeAll()
  await server?.stop()
}
```

- [ ] **Step 2: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire extension lifecycle with runtime, server, and commands"
```

---

### Task 11: Implement command palette commands

**Files:**
- Create: `src/commands/index.ts`
- Create: `src/commands/create-team.ts`
- Create: `src/commands/disband-team.ts`
- Create: `src/commands/send-message.ts`
- Create: `src/commands/list-teams.ts`
- Create: `src/commands/show-mission-control.ts`

- [ ] **Step 1: Create commands/index.ts registration**

```typescript
// src/commands/index.ts
import * as vscode from 'vscode'
import { createTeamCommand } from './create-team'
import { disbandTeamCommand } from './disband-team'
import { sendMessageCommand } from './send-message'
import { listTeamsCommand } from './list-teams'
import { showMissionControlCommand } from './show-mission-control'

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ensemble.createTeam', createTeamCommand),
    vscode.commands.registerCommand('ensemble.disbandTeam', disbandTeamCommand),
    vscode.commands.registerCommand('ensemble.sendMessage', sendMessageCommand),
    vscode.commands.registerCommand('ensemble.listTeams', listTeamsCommand),
    vscode.commands.registerCommand('ensemble.showMissionControl', showMissionControlCommand),
  )
}
```

- [ ] **Step 2: Implement create-team command with multi-step quick pick**

```typescript
// src/commands/create-team.ts
import * as vscode from 'vscode'
import { createEnsembleTeam } from '../service/ensemble-service'
import { loadAgentsConfig } from '../core/agent-config'

export async function createTeamCommand(): Promise<void> {
  // Step 1: Team name
  const name = await vscode.window.showInputBox({
    prompt: 'Team name',
    placeHolder: 'e.g., feature-auth',
  })
  if (!name) return

  // Step 2: Task description
  const description = await vscode.window.showInputBox({
    prompt: 'Task description',
    placeHolder: 'What should the team work on?',
  })
  if (!description) return

  // Step 3: Select agents
  const agentsConfig = loadAgentsConfig()
  const agentNames = Object.keys(agentsConfig)
  const selected = await vscode.window.showQuickPick(
    agentNames.map(name => ({ label: name, picked: name === 'claude' || name === 'codex' })),
    { canPickMany: true, placeHolder: 'Select agents for the team' },
  )
  if (!selected || selected.length < 2) {
    vscode.window.showWarningMessage('Need at least 2 agents for a team')
    return
  }

  // Step 4: Working directory
  const workspaceFolders = vscode.workspace.workspaceFolders
  const cwd = workspaceFolders?.[0]?.uri.fsPath || process.cwd()

  const result = await createEnsembleTeam({
    name,
    description,
    agents: selected.map((s, i) => ({ program: s.label, role: i === 0 ? 'lead' : 'member' })),
    workingDirectory: cwd,
    useWorktrees: vscode.workspace.getConfiguration('ensemble').get<boolean>('useWorktrees') ?? false,
  })

  if (result.error) {
    vscode.window.showErrorMessage(`Failed to create team: ${result.error}`)
  } else {
    vscode.window.showInformationMessage(`Team "${name}" created with ${selected.length} agents`)
    // Auto-open mission control
    vscode.commands.executeCommand('ensemble.showMissionControl')
  }
}
```

- [ ] **Step 3: Implement remaining commands** (disband, send-message, list-teams, show-mission-control)

Each follows same pattern: quick pick for team selection, input box for content, call service function, show result.

- [ ] **Step 4: Commit**

```bash
git add src/commands/
git commit -m "feat: add command palette commands for team management"
```

---

## Phase 3: Sidebar Webview

### Task 12: Create sidebar webview provider

**Files:**
- Create: `src/views/sidebar-provider.ts`
- Create: `src/webview/sidebar.html`
- Create: `src/webview/sidebar.js`
- Create: `src/webview/sidebar.css`
- Create: `src/webview/shared.css`

- [ ] **Step 1: Implement SidebarProvider**

```typescript
// src/views/sidebar-provider.ts
import * as vscode from 'vscode'
import { listEnsembleTeams } from '../service/ensemble-service'

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private refreshInterval?: NodeJS.Timeout

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    webviewView.webview.html = this.getHtml(webviewView.webview)

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'createTeam':
          vscode.commands.executeCommand('ensemble.createTeam')
          break
        case 'disbandTeam':
          vscode.commands.executeCommand('ensemble.disbandTeam')
          break
        case 'openMissionControl':
          vscode.commands.executeCommand('ensemble.showMissionControl')
          break
        case 'refresh':
          this.sendTeamsUpdate()
          break
      }
    })

    // Auto-refresh every 5 seconds
    this.refreshInterval = setInterval(() => this.sendTeamsUpdate(), 5000)
    webviewView.onDidDispose(() => {
      if (this.refreshInterval) clearInterval(this.refreshInterval)
    })

    this.sendTeamsUpdate()
  }

  private sendTeamsUpdate(): void {
    const result = listEnsembleTeams()
    this.view?.webview.postMessage({
      command: 'updateTeams',
      teams: result.data?.teams ?? [],
    })
  }

  private getHtml(webview: vscode.Webview): string {
    // Return HTML with inline CSS and JS for the sidebar
    // Shows: team cards with status, agent list, action buttons
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>/* sidebar.css inlined */</style>
</head>
<body>
  <div id="app">
    <div class="header">
      <h2>Ensemble</h2>
      <button id="create-btn" title="Create Team">+</button>
    </div>
    <div id="teams-container">
      <p class="empty-state">No active teams</p>
    </div>
  </div>
  <script>/* sidebar.js inlined */</script>
</body>
</html>`
  }
}
```

- [ ] **Step 2: Build the sidebar HTML/JS/CSS**

The sidebar webview displays:
- "Create Team" button at the top
- List of active teams as cards showing:
  - Team name and status badge
  - Agent icons with status indicators (green = active, yellow = idle, red = failed)
  - Message count
  - "Open Dashboard" button per team
  - "Disband" button per team

The JS communicates with the extension via `vscode.postMessage()` and receives updates via `window.addEventListener('message', ...)`.

- [ ] **Step 3: Commit**

```bash
git add src/views/sidebar-provider.ts src/webview/
git commit -m "feat: add sidebar webview for team management"
```

---

## Phase 4: Mission Control Dashboard

### Task 13: Create Mission Control webview panel

**Files:**
- Create: `src/views/mission-control-panel.ts`
- Create: `src/webview/mission-control.html`
- Create: `src/webview/mission-control.js`
- Create: `src/webview/mission-control.css`

- [ ] **Step 1: Implement MissionControlPanel**

```typescript
// src/views/mission-control-panel.ts
import * as vscode from 'vscode'
import { getTeamFeed, getEnsembleTeam, sendTeamMessage } from '../service/ensemble-service'
import { getAgentTokenUsage } from '../core/agent-spawner'
import { resolveAgentProgram } from '../core/agent-config'

export class MissionControlPanel {
  private static panels = new Map<string, MissionControlPanel>()
  private panel: vscode.WebviewPanel
  private teamId: string
  private feedInterval?: NodeJS.Timeout
  private lastMessageTimestamp?: string

  static show(teamId: string, teamName: string, extensionUri: vscode.Uri): void {
    const existing = MissionControlPanel.panels.get(teamId)
    if (existing) {
      existing.panel.reveal()
      return
    }
    new MissionControlPanel(teamId, teamName, extensionUri)
  }

  private constructor(teamId: string, teamName: string, extensionUri: vscode.Uri) {
    this.teamId = teamId

    this.panel = vscode.window.createWebviewPanel(
      'ensemble.missionControl',
      `Mission Control: ${teamName}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [extensionUri], retainContextWhenHidden: true },
    )

    this.panel.webview.html = this.getHtml()

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'sendMessage':
          await sendTeamMessage(this.teamId, message.to, message.content, 'user')
          break
        case 'requestFeed':
          this.sendFeedUpdate()
          break
      }
    })

    // Poll for updates every 2 seconds
    this.feedInterval = setInterval(() => {
      this.sendFeedUpdate()
      this.sendMetricsUpdate()
    }, 2000)

    this.panel.onDidDispose(() => {
      if (this.feedInterval) clearInterval(this.feedInterval)
      MissionControlPanel.panels.delete(teamId)
    })

    MissionControlPanel.panels.set(teamId, this)
    this.sendFullState()
  }

  private sendFullState(): void {
    const result = getEnsembleTeam(this.teamId)
    if (!result.data) return

    this.panel.webview.postMessage({
      command: 'fullState',
      team: result.data.team,
      messages: result.data.messages,
    })
  }

  private sendFeedUpdate(): void {
    const result = getTeamFeed(this.teamId, this.lastMessageTimestamp)
    if (!result.data?.messages.length) return

    const newMessages = result.data.messages
    this.lastMessageTimestamp = newMessages[newMessages.length - 1].timestamp

    this.panel.webview.postMessage({
      command: 'newMessages',
      messages: newMessages,
    })
  }

  private async sendMetricsUpdate(): Promise<void> {
    const result = getEnsembleTeam(this.teamId)
    if (!result.data) return

    const metrics = await Promise.all(
      result.data.team.agents
        .filter(a => a.status === 'active')
        .map(async (agent) => ({
          name: agent.name,
          program: agent.program,
          tokens: await getAgentTokenUsage(`${result.data!.team.name}-${agent.name}`),
          status: agent.status,
          color: resolveAgentProgram(agent.program).color,
          icon: resolveAgentProgram(agent.program).icon,
        })),
    )

    this.panel.webview.postMessage({ command: 'metrics', agents: metrics })
  }

  private getHtml(): string {
    // Full mission control dashboard HTML
    // Components:
    // 1. Header bar: team name, status, duration timer, disband button
    // 2. Agent status cards: icon, name, program, token usage, status indicator
    // 3. Message feed: scrollable feed with agent-colored messages, timestamps
    // 4. Timeline: horizontal bar showing who spoke when (relative time blocks)
    // 5. Message input: text area + "To" selector (team or specific agent) + send button
    // 6. Diff preview panel: when a file-changed message is detected, show inline diff
    return `<!DOCTYPE html>...`  // Full HTML implementation
  }
}
```

- [ ] **Step 2: Build the Mission Control HTML/JS/CSS**

The dashboard webview has these sections:

**Header bar:**
- Team name, status badge, live duration counter
- "Disband Team" button

**Agent cards (horizontal row):**
- Per-agent: icon (from agents.json), name, program name, token usage counter, status dot
- Colors match agent config (blue for Codex, green for Claude, yellow for Gemini)

**Message feed (main area, scrollable):**
- Each message shows: timestamp, sender badge (colored), content
- Auto-scrolls to bottom on new messages
- System messages (from "ensemble") shown in gray

**Timeline (below feed):**
- Horizontal time blocks showing which agent was active when
- Color-coded by agent

**Message input (bottom bar):**
- Recipient selector dropdown: "team" or individual agent names
- Text input
- Send button
- Sends via `vscode.postMessage({ command: 'sendMessage', to, content })`

**Diff preview (collapsible right panel):**
- When messages contain file path references, detect and show a "View Diff" button
- On click, uses VSCode's diff editor API via postMessage to extension

- [ ] **Step 3: Wire diff preview to VSCode**

In `mission-control-panel.ts`, handle diff request:

```typescript
case 'showDiff':
  const uri = vscode.Uri.file(message.filePath)
  vscode.commands.executeCommand('vscode.diff',
    vscode.Uri.parse(`git:${message.filePath}`),
    uri,
    `Diff: ${message.filePath}`,
  )
  break
```

- [ ] **Step 4: Commit**

```bash
git add src/views/mission-control-panel.ts src/webview/mission-control.*
git commit -m "feat: add Mission Control dashboard webview with live feed, metrics, and message input"
```

---

### Task 14: Build and bundle with esbuild

**Files:**
- Create: `esbuild.config.mjs`

- [ ] **Step 1: Create esbuild config**

```javascript
// esbuild.config.mjs
import { context } from 'esbuild'

const isWatch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  minify: !isWatch,
}

// Extension bundle
const ctx = await context({
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
})

if (isWatch) {
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
```

- [ ] **Step 2: Update package.json scripts**

```json
"compile": "node esbuild.config.mjs",
"watch": "node esbuild.config.mjs --watch"
```

- [ ] **Step 3: Build and verify**

Run: `npm run compile`
Expected: `dist/extension.js` created, no errors

- [ ] **Step 4: Commit**

```bash
git add esbuild.config.mjs
git commit -m "feat: add esbuild config for extension bundling"
```

---

### Task 15: End-to-end smoke test

- [ ] **Step 1: Manual smoke test in VSCode Extension Host**

Run: `code --extensionDevelopmentPath=.`

Verify:
1. Extension activates (check Output channel "Ensemble")
2. Sidebar appears in activity bar
3. "Ensemble: Create Team" appears in command palette
4. HTTP server responds: `curl http://127.0.0.1:23000/api/v1/health`
5. Create a team with 2 agents (Claude + Codex) — agents spawn in VSCode terminals
6. Messages appear in Mission Control dashboard
7. Can inject a message via the dashboard
8. Disband team — terminals close

- [ ] **Step 2: Commit any fixes from smoke test**

- [ ] **Step 3: Tag v0.1.0**

```bash
git tag -a v0.1.0 -m "v0.1.0: Ensemble for VSCode — initial working version"
```

---

### Task 15.5: Bundle agents.json and collab-templates.json

**Files:**
- Copy: `agents.json` (from original repo root)
- Copy: `collab-templates.json` (from original repo root)

- [ ] **Step 1: Copy agents.json and remove dangerous flags**

Copy `agents.json` to the extension root. Remove `--dangerously-skip-permissions` from the Claude entry. The `ensemble.claudeSkipPermissions` setting will add it back at runtime in `buildAgentCommand()` if the user opts in (with a confirmation dialog).

- [ ] **Step 2: Copy collab-templates.json**

Copy as-is to extension root.

- [ ] **Step 3: Verify .vscodeignore does NOT exclude these files**

The `.vscodeignore` should not list `agents.json` or `collab-templates.json` — they must be bundled.

- [ ] **Step 4: Commit**

```bash
git add agents.json collab-templates.json
git commit -m "feat: bundle agent configs and collab templates"
```

---

## Known Gaps (deferred to v2)

1. **AgentProvider plugin interface**: The brainstorm mentioned a plugin architecture for third-party agent providers to register new agent types programmatically. v1 uses `agents.json` as the configuration mechanism. v2 should add an extension point (`vscode.extensions.all` pattern or contribution point) for registering `AgentProvider` implementations.

2. **File watcher for diff detection**: The Mission Control diff preview relies on parsing file path references in messages. A `vscode.workspace.createFileSystemWatcher` would provide reliable change detection regardless of message format.

3. **`pasteFromFile` for TUI agents**: Codex and Gemini use `pasteFromFile` as their input method because they can't handle large text via sendKeys in tmux. In process-backed terminals, writing large text to `proc.stdin` may work but needs explicit testing. If it doesn't, we may need a clipboard-based approach or chunked writes with delays.

4. **Remote agents**: v1 is local-only. Remote agent support requires network transport for the `AgentRuntime` interface.

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Pseudoterminal can't capture real CLI output | Task 4 uses `child_process.spawn` piped through PTY — tested with `echo` first, then real agents |
| VSCode's Pseudoterminal doesn't handle interactive TUIs well | Claude Code and Codex use line-based I/O, not full TUI. Gemini CLI may need `shell: true` |
| `sendKeys` vs `handleInput` confusion | `sendKeys` writes via `terminal.sendText()` for programmatic use; `handleInput` forwards user keyboard input to process stdin |
| Webview postMessage is async and lossy | Feed polling every 2s ensures eventual consistency. Full state sent on panel open. |
| Extension activation blocks VSCode | Server start is async, runtime init is sync but fast. No blocking in activate(). |
| agents.json not found at runtime | Fallback to bundled default + user-configurable path in settings |
| `import.meta.url` breaks in CJS bundle | All ported modules replace `import.meta.url`/`fileURLToPath` with `__dirname` |
| `ensemble-registry.ts` calls `getEnsembleRegistryDir()` at module level before init | Changed to lazy getter called per-function, not at import time |
| `--dangerously-skip-permissions` shipped by default | Removed from bundled `agents.json`; opt-in via `ensemble.claudeSkipPermissions` setting with confirmation dialog |
| Large prompt delivery to TUI agents via stdin may hang | Test with chunked writes + delays; fall back to temp file + `cat < file` if needed |
