import * as vscode from 'vscode'

export async function showMissionControlCommand(): Promise<void> {
  vscode.window.showInformationMessage('Mission Control will be available in Phase 4')
}
