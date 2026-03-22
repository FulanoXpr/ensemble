import * as vscode from 'vscode'
import { createTeamCommand } from './create-team.js'
import { disbandTeamCommand } from './disband-team.js'
import { sendMessageCommand } from './send-message.js'
import { listTeamsCommand } from './list-teams.js'
import { showMissionControlCommand } from './show-mission-control.js'

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('ensemble.createTeam', createTeamCommand),
    vscode.commands.registerCommand('ensemble.disbandTeam', disbandTeamCommand),
    vscode.commands.registerCommand('ensemble.sendMessage', sendMessageCommand),
    vscode.commands.registerCommand('ensemble.listTeams', listTeamsCommand),
    vscode.commands.registerCommand('ensemble.showMissionControl', showMissionControlCommand),
  )
}
