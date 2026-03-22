import * as vscode from 'vscode'
import { listEnsembleTeams, sendTeamMessage } from '../service/ensemble-service.js'

export async function sendMessageCommand(): Promise<void> {
  // Step 1: Load active teams
  const result = listEnsembleTeams()
  const teams = result.data?.teams ?? []
  const activeTeams = teams.filter(t => t.status === 'active')

  if (activeTeams.length === 0) {
    vscode.window.showInformationMessage('No active teams to message. Create a team first.')
    return
  }

  // Step 2: Quick pick to select a team
  const items: vscode.QuickPickItem[] = activeTeams.map(team => ({
    label: team.name,
    description: `${team.agents.length} agent(s)`,
    detail: team.description,
  }))

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Send Message to Team (1/2)',
    placeHolder: 'Select a team to message',
  })
  if (!selected) return

  const team = activeTeams.find(t => t.name === selected.label)
  if (!team) return

  // Step 3: Input box for message content
  const content = await vscode.window.showInputBox({
    title: 'Send Message to Team (2/2)',
    prompt: `Message to "${team.name}"`,
    placeHolder: 'e.g. Focus on the authentication module next',
    validateInput: (value) => value.trim() ? undefined : 'Message cannot be empty',
  })
  if (!content) return

  // Step 4: Send the message
  try {
    const sendResult = await sendTeamMessage(team.id, 'team', content.trim(), 'user')
    if (sendResult.data) {
      vscode.window.showInformationMessage(`Message sent to team "${team.name}".`)
    } else {
      vscode.window.showErrorMessage(`Failed to send message: ${sendResult.error ?? 'Unknown error'}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    vscode.window.showErrorMessage(`Failed to send message: ${message}`)
  }
}
