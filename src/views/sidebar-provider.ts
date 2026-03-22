import * as vscode from 'vscode'
import { loadTeams } from '../core/ensemble-registry.js'
import type { EnsembleTeam } from '../core/types.js'

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView
  private _refreshTimer?: ReturnType<typeof setInterval>

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    }

    webviewView.webview.html = this.getHtml()

    webviewView.webview.onDidReceiveMessage(async (message: { command: string; teamId?: string }) => {
      switch (message.command) {
        case 'createTeam':
          await vscode.commands.executeCommand('ensemble.createTeam')
          break
        case 'disbandTeam':
          if (message.teamId) {
            await vscode.commands.executeCommand('ensemble.disbandTeam', message.teamId)
          }
          break
        case 'openMissionControl':
          if (message.teamId) {
            await vscode.commands.executeCommand('ensemble.showMissionControl', message.teamId)
          }
          break
        case 'refresh':
          this.sendTeams()
          break
      }
    })

    // Send initial data
    this.sendTeams()

    // Auto-refresh every 5 seconds
    this._refreshTimer = setInterval(() => {
      if (webviewView.visible) {
        this.sendTeams()
      }
    }, 5000)

    webviewView.onDidDispose(() => {
      if (this._refreshTimer) {
        clearInterval(this._refreshTimer)
        this._refreshTimer = undefined
      }
    })
  }

  private sendTeams(): void {
    if (!this._view) return
    let teams: EnsembleTeam[] = []
    try {
      teams = loadTeams()
    } catch {
      // Registry not yet initialized or no teams file — treat as empty
    }
    this._view.webview.postMessage({ command: 'updateTeams', teams })
  }

  private getHtml(): string {
    // Note: innerHTML usage below is safe — content is rendered inside a VSCode
    // webview sandbox with a strict CSP (no external scripts). All user-supplied
    // strings are escaped through the esc() helper before insertion.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 12px; margin: 0; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
    .header h3 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-sideBarSectionHeader-foreground); }
    .create-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 2px; cursor: pointer; font-size: 12px; }
    .create-btn:hover { background: var(--vscode-button-hoverBackground); }
    .empty { color: var(--vscode-descriptionForeground); font-size: 12px; text-align: center; padding: 20px 0; }
    .team-card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; margin-bottom: 8px; }
    .team-name { font-weight: bold; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .status-active { background: #4caf50; }
    .status-forming { background: #ff9800; }
    .status-disbanded { background: #9e9e9e; }
    .status-completed { background: #2196f3; }
    .status-failed { background: #f44336; }
    .status-paused { background: #9e9e9e; }
    .agents-list { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 4px 0; }
    .card-actions { display: flex; gap: 6px; margin-top: 8px; }
    .card-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 8px; border-radius: 2px; cursor: pointer; font-size: 11px; }
    .card-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .card-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .card-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="header">
    <h3>Teams</h3>
    <button class="create-btn" onclick="send('createTeam')">+ New</button>
  </div>
  <div id="teams"></div>
  <script>
    const vscode = acquireVsCodeApi();
    function send(command, data) { vscode.postMessage({ command, ...(data || {}) }); }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'updateTeams') renderTeams(msg.teams);
    });

    function renderTeams(teams) {
      const container = document.getElementById('teams');
      if (!teams || !teams.length) {
        container.textContent = '';
        const p = document.createElement('p');
        p.className = 'empty';
        p.innerHTML = 'No active teams.<br>Create one to get started.';
        container.appendChild(p);
        return;
      }
      container.textContent = '';
      teams.forEach(t => {
        const card = document.createElement('div');
        card.className = 'team-card';

        const nameRow = document.createElement('div');
        nameRow.className = 'team-name';

        const dot = document.createElement('span');
        dot.className = 'status-dot status-' + String(t.status || '');
        nameRow.appendChild(dot);

        const nameText = document.createTextNode(t.name || '');
        nameRow.appendChild(nameText);
        card.appendChild(nameRow);

        const agentsList = document.createElement('div');
        agentsList.className = 'agents-list';
        if (t.agents && t.agents.length) {
          agentsList.textContent = t.agents.map(a => a.name + ' (' + a.program + ')').join(', ');
        } else {
          agentsList.textContent = 'No agents';
        }
        card.appendChild(agentsList);

        const actions = document.createElement('div');
        actions.className = 'card-actions';

        const dashBtn = document.createElement('button');
        dashBtn.className = 'card-btn primary';
        dashBtn.textContent = 'Dashboard';
        dashBtn.addEventListener('click', () => send('openMissionControl', { teamId: t.id }));
        actions.appendChild(dashBtn);

        if (t.status === 'active' || t.status === 'forming') {
          const disbandBtn = document.createElement('button');
          disbandBtn.className = 'card-btn';
          disbandBtn.textContent = 'Disband';
          disbandBtn.addEventListener('click', () => send('disbandTeam', { teamId: t.id }));
          actions.appendChild(disbandBtn);
        }

        card.appendChild(actions);
        container.appendChild(card);
      });
    }

    // Request initial data
    send('refresh');
  </script>
</body>
</html>`
  }
}
