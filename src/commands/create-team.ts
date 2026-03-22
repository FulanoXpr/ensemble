import * as vscode from 'vscode'
import { createEnsembleTeam } from '../service/ensemble-service.js'
import { loadAgentsConfig } from '../core/agent-config.js'

export async function createTeamCommand(): Promise<void> {
  // Step 1: Ask for team name
  const teamName = await vscode.window.showInputBox({
    title: 'Create Ensemble Team (1/3)',
    prompt: 'Enter a name for the team',
    placeHolder: 'e.g. refactor-session',
    validateInput: (value) => value.trim() ? undefined : 'Team name cannot be empty',
  })
  if (!teamName) return

  // Step 2: Ask for task description
  const description = await vscode.window.showInputBox({
    title: 'Create Ensemble Team (2/3)',
    prompt: 'Describe the task for this team',
    placeHolder: 'e.g. Refactor the authentication module and add tests',
    validateInput: (value) => value.trim() ? undefined : 'Task description cannot be empty',
  })
  if (!description) return

  // Step 3: Select agents from agents.json (multi-select quick pick)
  const agentsConfig = loadAgentsConfig()
  const agentKeys = Object.keys(agentsConfig)
  const defaultAgents = new Set(['claude', 'codex'])

  const agentItems: vscode.QuickPickItem[] = agentKeys.map(key => ({
    label: agentsConfig[key].name,
    description: agentsConfig[key].command,
    detail: `Flags: ${agentsConfig[key].flags.join(' ') || '(none)'}`,
    picked: defaultAgents.has(key),
  }))

  const selectedItems = await vscode.window.showQuickPick(agentItems, {
    title: 'Create Ensemble Team (3/3)',
    placeHolder: 'Select agents for this team (default: claude + codex)',
    canPickMany: true,
  })
  if (!selectedItems || selectedItems.length === 0) return

  // Resolve selected agent names back to program keys
  const selectedPrograms = selectedItems.map(item => item.label)

  // Step 4: Get workspace folder as working directory
  const workspaceFolders = vscode.workspace.workspaceFolders
  const workingDirectory = workspaceFolders?.[0]?.uri.fsPath

  // Step 5: Create the team
  try {
    const result = await createEnsembleTeam({
      name: teamName.trim(),
      description: description.trim(),
      agents: selectedPrograms.map(program => ({ program })),
      feedMode: 'live',
      workingDirectory,
    })

    if (result.data) {
      vscode.window.showInformationMessage(
        `Team "${result.data.team.name}" created with ${result.data.team.agents.length} agent(s).`
      )
    } else {
      vscode.window.showErrorMessage(`Failed to create team: ${result.error ?? 'Unknown error'}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    vscode.window.showErrorMessage(`Failed to create team: ${message}`)
  }
}
