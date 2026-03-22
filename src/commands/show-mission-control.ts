import * as vscode from 'vscode'
import { listEnsembleTeams } from '../service/ensemble-service.js'
import { MissionControlPanel } from '../views/mission-control-panel.js'

let _extensionUri: vscode.Uri | undefined

/** Call once during activation to store the extension URI for webview resource roots. */
export function initMissionControlUri(extensionUri: vscode.Uri): void {
  _extensionUri = extensionUri
}

/**
 * Command handler for ensemble.showMissionControl.
 * Accepts an optional teamId argument (e.g. when invoked from the sidebar).
 */
export async function showMissionControlCommand(teamId?: string): Promise<void> {
  if (!_extensionUri) {
    vscode.window.showErrorMessage('Ensemble: extension URI not initialized.')
    return
  }

  const result = listEnsembleTeams()
  const teams = result.data?.teams?.filter(t => t.status === 'active' || t.status === 'forming') ?? []

  // If a specific teamId was provided, try to open it directly
  if (teamId) {
    const team = teams.find(t => t.id === teamId)
    if (team) {
      MissionControlPanel.show(team.id, team.name, _extensionUri)
      return
    }
    // Team not found among active teams — fall through to picker
  }

  if (teams.length === 0) {
    vscode.window.showInformationMessage('No active teams. Create one first.')
    return
  }

  if (teams.length === 1) {
    MissionControlPanel.show(teams[0].id, teams[0].name, _extensionUri)
    return
  }

  const picked = await vscode.window.showQuickPick(
    teams.map(t => ({ label: t.name, description: `${t.agents.length} agents`, teamId: t.id })),
    { placeHolder: 'Select team to monitor' },
  )
  if (picked) {
    MissionControlPanel.show(picked.teamId, picked.label, _extensionUri)
  }
}
