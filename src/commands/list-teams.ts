import * as vscode from 'vscode'
import { listEnsembleTeams } from '../service/ensemble-service.js'
import type { EnsembleTeam } from '../core/types.js'

function formatTeamStatus(team: EnsembleTeam): string {
  const agentCount = team.agents.length
  const activeAgents = team.agents.filter(a => a.status === 'active').length
  return `${team.status} • ${activeAgents}/${agentCount} agents active`
}

function formatTeamDetail(team: EnsembleTeam): string {
  const agentNames = team.agents.map(a => `${a.name} (${a.program})`).join(', ')
  return `Agents: ${agentNames || 'none'}`
}

export async function listTeamsCommand(): Promise<void> {
  const result = listEnsembleTeams()
  const teams = result.data?.teams ?? []

  if (teams.length === 0) {
    vscode.window.showInformationMessage('No teams found. Use "Ensemble: Create Team" to get started.')
    return
  }

  const items: vscode.QuickPickItem[] = teams.map(team => ({
    label: team.name,
    description: formatTeamStatus(team),
    detail: `${team.description} | ${formatTeamDetail(team)}`,
  }))

  const selected = await vscode.window.showQuickPick(items, {
    title: `Ensemble Teams (${teams.length})`,
    placeHolder: 'Select a team to view details',
  })

  if (!selected) return

  const team = teams.find(t => t.name === selected.label)
  if (!team) return

  // Show team details as an info message
  const agentList = team.agents
    .map(a => `  ${a.name} (${a.program}) — ${a.status}`)
    .join('\n')

  const details = [
    `Team: ${team.name}`,
    `Status: ${team.status}`,
    `Task: ${team.description}`,
    `Created: ${new Date(team.createdAt).toLocaleString()}`,
    `Agents (${team.agents.length}):`,
    agentList || '  (none)',
    team.completedAt ? `Completed: ${new Date(team.completedAt).toLocaleString()}` : '',
  ].filter(Boolean).join('\n')

  vscode.window.showInformationMessage(details, { modal: true })
}
