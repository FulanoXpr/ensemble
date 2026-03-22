# Ensemble for VSCode

## What This Is

Fork of [michelhelsdingen/ensemble](https://github.com/michelhelsdingen/ensemble) — converting a tmux-based multi-agent CLI orchestrator into a native VSCode extension. The original coordinates AI agents (Claude Code, Codex, Gemini CLI) into collaborative teams using tmux sessions and an HTTP server.

## Architecture

**Hybrid approach:**
- Agents run in VSCode **Pseudoterminals** (`vscode.Pseudoterminal`) — interactive + programmatic I/O via `OutputBuffer`
- **Embedded HTTP server** on localhost:23000 (same API as original, no external setup)
- **Webview sidebar** for team configuration and agent status
- **Webview "Mission Control" panel** — live message feed, token metrics, timeline, diff preview, message injection
- Zero tmux dependency

**Key abstraction:** The original repo has an `AgentRuntime` interface in `lib/agent-runtime.ts` that abstracts all tmux operations. We implement `VSCodeRuntime` against this interface, so the entire service layer (registry, spawner, watchdog, staged-workflow) works with minimal changes.

## Tech Stack

- TypeScript (strict mode, ES2022 target)
- VSCode Extension API (^1.95.0)
- esbuild for bundling (CJS output, `vscode` external)
- vitest for testing
- Vanilla JS + CSS for webview UIs (no React)
- Node.js `http` for embedded server
- `uuid` as only runtime dependency

## Project Structure

```
src/
  extension.ts              — activate/deactivate entry point
  constants.ts              — Shared constants
  runtime/
    vscode-runtime.ts       — VSCodeRuntime implements AgentRuntime
    output-buffer.ts        — Ring buffer replacing tmux capture-pane
  core/                     — Ported from original lib/ with adaptations
    types.ts                — All type definitions (EnsembleTeam, AgentProgram, etc.)
    agent-runtime-interface.ts — AgentRuntime interface (extracted from original)
    runtime-singleton.ts    — getRuntime()/setRuntime()
    agent-config.ts         — Agent config loader (reads agents.json)
    ensemble-registry.ts    — Team/message persistence (file-based)
    ensemble-paths.ts       — Path resolution (uses globalStorageUri)
    collab-paths.ts         — Collab runtime paths (/tmp/ensemble for ephemeral data)
    agent-spawner.ts        — Spawns agents via VSCodeRuntime (local only in v1)
    agent-watchdog.ts       — Detects idle/stalled agents
    worktree-manager.ts     — Git worktree isolation per agent
    staged-workflow.ts      — Plan/exec/verify staged workflow
    hosts-config.ts         — Simplified to local-only
  service/
    ensemble-service.ts     — Core orchestration logic
    embedded-server.ts      — HTTP server embedded in extension
  commands/                 — VSCode command palette handlers
  views/
    sidebar-provider.ts     — WebviewViewProvider for sidebar
    mission-control-panel.ts — WebviewPanel for dashboard
  webview/                  — HTML/JS/CSS for webviews
test/
  unit/                     — vitest unit tests
  integration/              — VSCode extension host tests
```

## Build & Test

```bash
npm install
npm run compile          # esbuild bundle → dist/extension.js
npm run watch            # esbuild watch mode
npm test                 # vitest run
npm run test:watch       # vitest watch
```

To test the extension: `code --extensionDevelopmentPath=.`

## Critical Technical Decisions

1. **CJS output** — esbuild bundles to `format: 'cjs'` because VSCode extensions require CommonJS. All ported modules must use `__dirname` instead of `import.meta.url`.

2. **Lazy registry initialization** — `ensemble-registry.ts` must NOT call `getEnsembleRegistryDir()` at module level. The extension context (`globalStorageUri`) isn't available until `activate()` runs. Use lazy getters.

3. **No `--dangerously-skip-permissions`** — Removed from bundled `agents.json`. Users opt in via the `ensemble.claudeSkipPermissions` setting (with confirmation dialog).

4. **Process-backed Pseudoterminals** — Real agents spawn via `child_process.spawn` piped through the PTY. `sendKeys` writes directly to `proc.stdin` for process-backed terminals (not `terminal.sendText`) to avoid buffer duplication.

5. **Local only (v1)** — No remote agent support. All `isSelf()` checks return true. Remote host code paths are stubbed/removed.

6. **Ephemeral vs persistent paths** — Collab runtime data (delivery files, prompts) goes to `/tmp/ensemble`. Registry data (teams.json, message feeds) goes to `globalStorageUri`.

## Conventions

- Follow existing Ensemble code style (no semicolons optionally, but consistent within files)
- One responsibility per file, well-defined interfaces
- Tests use vitest with `vi.mock('vscode', ...)` for mocking the VSCode API
- Commit messages: `feat:`, `fix:`, `docs:`, `test:` prefixes
- All webview communication via `postMessage` / `onDidReceiveMessage`

## Implementation Plan

Full plan at `docs/superpowers/plans/2026-03-22-ensemble-vscode-extension.md`
