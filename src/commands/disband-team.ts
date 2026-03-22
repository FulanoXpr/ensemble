import * as vscode from 'vscode'
import { listEnsembleTeams, disbandTeam } from '../service/ensemble-service.js'

export async function disbandTeamCommand(): Promise<void> {
  // Step 1: Load active teams
  const result = listEnsembleTeams()
  const teams = result.data?.teams ?? []
  const activeTeams = teams.filter(t => t.status === 'active' || t.status === 'forming')

  if (activeTeams.length === 0) {
    vscode.window.showInformationMessage('No active teams to disband.')
    return
  }

  // Step 2: Quick pick to select a team
  const items: vscode.QuickPickItem[] = activeTeams.map(team => ({
    label: team.name,
    description: `${team.agents.length} agent(s) • ${team.status}`,
    detail: team.description,
  }))

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Disband Team',
    placeHolder: 'Select a team to disband',
  })
  if (!selected) return

  const team = activeTeams.find(t => t.name === selected.label)
  if (!team) return

  // Step 3: Disband the team
  try {
    const disbandResult = await disbandTeam(team.id)
    if (disbandResult.data) {
      vscode.window.showInformationMessage(`Team "${team.name}" has been disbanded.`)
    } else {
      vscode.window.showErrorMessage(`Failed to disband team: ${disbandResult.error ?? 'Unknown error'}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    vscode.window.showErrorMessage(`Failed to disband team: ${message}`)
  }
}
