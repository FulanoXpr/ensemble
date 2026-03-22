import type { AgentRuntime } from './agent-runtime-interface.js'

let _runtime: AgentRuntime

export function getRuntime(): AgentRuntime {
  if (!_runtime) throw new Error('Runtime not initialized. Call setRuntime() first.')
  return _runtime
}

export function setRuntime(runtime: AgentRuntime): void {
  _runtime = runtime
}
