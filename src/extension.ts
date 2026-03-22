import * as vscode from 'vscode'
import { VSCodeRuntime } from './runtime/vscode-runtime.js'
import { setRuntime } from './core/runtime-singleton.js'
import { initEnsemblePaths } from './core/ensemble-paths.js'
import { EmbeddedServer } from './service/embedded-server.js'
import { registerCommands } from './commands/index.js'

let server: EmbeddedServer | undefined
let runtime: VSCodeRuntime | undefined

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Ensemble')
  context.subscriptions.push(output)

  // 1. Init paths
  initEnsemblePaths(context.globalStorageUri.fsPath)

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

  output.appendLine('Ensemble extension activated')
}

export async function deactivate() {
  runtime?.disposeAll()
  await server?.stop()
}
