import * as vscode from 'vscode'

let globalContext: vscode.ExtensionContext | undefined

export function activate(context: vscode.ExtensionContext) {
  globalContext = context

  const outputChannel = vscode.window.createOutputChannel('Ensemble')
  outputChannel.appendLine('Ensemble extension activated')
}

export function deactivate() {
  globalContext = undefined
}

export function getExtensionContext(): vscode.ExtensionContext {
  if (!globalContext) throw new Error('Extension not activated')
  return globalContext
}
