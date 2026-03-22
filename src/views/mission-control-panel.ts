import * as vscode from 'vscode'
import {
  getTeamFeed, getEnsembleTeam, sendTeamMessage, disbandTeam,
} from '../service/ensemble-service.js'
import { resolveAgentProgram } from '../core/agent-config.js'
import { getAgentTokenUsage } from '../core/agent-spawner.js'
import type { EnsembleTeam, EnsembleMessage, EnsembleTeamAgent } from '../core/types.js'

const AGENT_COLORS: Record<string, string> = {
  blue: '#4a9eff',
  green: '#4caf50',
  yellow: '#ffc107',
  magenta: '#e040fb',
  cyan: '#00bcd4',
  white: '#ffffff',
}

/** Maximum messages to keep in the webview feed to prevent lag */
const MAX_MESSAGES = 200

/** Polling interval in milliseconds */
const POLL_INTERVAL_MS = 2000

interface AgentInfo {
  name: string
  program: string
  color: string
  icon: string
  status: string
  tokenUsage: string
}

export class MissionControlPanel {
  private static readonly panels = new Map<string, MissionControlPanel>()

  private readonly panel: vscode.WebviewPanel
  private readonly teamId: string
  private readonly teamName: string
  private pollTimer?: ReturnType<typeof setInterval>
  private lastMessageTimestamp?: string
  private disposed = false

  private constructor(
    panel: vscode.WebviewPanel,
    teamId: string,
    teamName: string,
    extensionUri: vscode.Uri,
  ) {
    this.panel = panel
    this.teamId = teamId
    this.teamName = teamName

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [extensionUri],
    }

    panel.webview.html = this.getHtml()

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(
      (msg: { command: string; to?: string; content?: string }) => {
        void this.handleWebviewMessage(msg)
      },
    )

    // Cleanup on dispose
    panel.onDidDispose(() => {
      this.dispose()
    })

    // Send initial full state, then start polling
    void this.sendFullState()
    this.startPolling()
  }

  static show(teamId: string, teamName: string, extensionUri: vscode.Uri): void {
    const existing = MissionControlPanel.panels.get(teamId)
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      'ensemble.missionControl',
      `Mission Control: ${teamName}`,
      vscode.ViewColumn.One,
      { retainContextWhenHidden: true },
    )

    const instance = new MissionControlPanel(panel, teamId, teamName, extensionUri)
    MissionControlPanel.panels.set(teamId, instance)
  }

  private dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
    MissionControlPanel.panels.delete(this.teamId)
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      if (this.disposed) return
      void this.sendIncrementalUpdate()
    }, POLL_INTERVAL_MS)
  }

  private async sendFullState(): Promise<void> {
    const result = getEnsembleTeam(this.teamId)
    if (!result.data) return

    const { team, messages } = result.data
    const capped = messages.slice(-MAX_MESSAGES)
    const agents = await this.buildAgentInfo(team)

    if (capped.length > 0) {
      this.lastMessageTimestamp = capped[capped.length - 1].timestamp
    }

    this.postMessage({
      command: 'fullState',
      team: {
        id: team.id,
        name: team.name,
        status: team.status,
        createdAt: team.createdAt,
      },
      agents,
      messages: capped,
    })
  }

  private async sendIncrementalUpdate(): Promise<void> {
    const feedResult = getTeamFeed(this.teamId, this.lastMessageTimestamp)
    const newMessages = feedResult.data?.messages ?? []

    // Also refresh agent info for token updates
    const teamResult = getEnsembleTeam(this.teamId)
    const team = teamResult.data?.team
    const agents = team ? await this.buildAgentInfo(team) : []

    if (newMessages.length > 0) {
      this.lastMessageTimestamp = newMessages[newMessages.length - 1].timestamp
    }

    this.postMessage({
      command: 'incrementalUpdate',
      team: team ? {
        id: team.id,
        name: team.name,
        status: team.status,
        createdAt: team.createdAt,
      } : undefined,
      agents,
      newMessages,
    })
  }

  private async buildAgentInfo(team: EnsembleTeam): Promise<AgentInfo[]> {
    const infos: AgentInfo[] = []
    for (const agent of team.agents) {
      const program = resolveAgentProgram(agent.program)
      const colorHex = AGENT_COLORS[program.color] ?? AGENT_COLORS['white']
      let tokenUsage = 'unknown'
      if (agent.status === 'active') {
        const sessionName = `${team.name}-${agent.name}`
        tokenUsage = await getAgentTokenUsage(sessionName)
      }
      infos.push({
        name: agent.name,
        program: agent.program,
        color: colorHex,
        icon: program.icon,
        status: agent.status,
        tokenUsage,
      })
    }
    return infos
  }

  private async handleWebviewMessage(msg: { command: string; to?: string; content?: string }): Promise<void> {
    switch (msg.command) {
      case 'sendMessage':
        if (msg.to && msg.content) {
          await sendTeamMessage(this.teamId, msg.to, msg.content, 'user')
        }
        break
      case 'requestFeed':
        await this.sendFullState()
        break
      case 'disbandTeam':
        await disbandTeam(this.teamId)
        vscode.window.showInformationMessage(`Team "${this.teamName}" has been disbanded.`)
        break
      case 'showDiff':
        // Placeholder: could open a vscode diff editor
        vscode.window.showInformationMessage('Diff view not yet implemented.')
        break
    }
  }

  private postMessage(msg: unknown): void {
    if (!this.disposed) {
      void this.panel.webview.postMessage(msg)
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ---- Header ---- */
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    .header-title {
      font-size: 14px;
      font-weight: 600;
    }
    .status-badge {
      font-size: 11px;
      padding: 1px 8px;
      border-radius: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    .status-badge.active { background: #2e7d32; color: #c8e6c9; }
    .status-badge.forming { background: #e65100; color: #ffe0b2; }
    .status-badge.paused { background: #616161; color: #e0e0e0; }
    .status-badge.disbanded { background: #424242; color: #bdbdbd; }
    .status-badge.completed { background: #1565c0; color: #bbdefb; }
    .status-badge.failed { background: #c62828; color: #ffcdd2; }
    .duration {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .spacer { flex: 1; }
    .disband-btn {
      background: #c62828;
      color: #fff;
      border: none;
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      font-family: var(--vscode-font-family, sans-serif);
    }
    .disband-btn:hover { background: #d32f2f; }

    /* ---- Agent cards ---- */
    .agents-row {
      display: flex;
      gap: 8px;
      padding: 8px 14px;
      overflow-x: auto;
      flex-shrink: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .agent-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      min-width: 160px;
      flex-shrink: 0;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    .agent-icon {
      font-size: 18px;
      width: 24px;
      text-align: center;
      flex-shrink: 0;
    }
    .agent-details {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .agent-name {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .agent-program {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .agent-tokens {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .agent-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .agent-status-dot.active { background: #4caf50; }
    .agent-status-dot.spawning { background: #ff9800; }
    .agent-status-dot.idle { background: #9e9e9e; }
    .agent-status-dot.done { background: #2196f3; }
    .agent-status-dot.failed { background: #f44336; }

    /* ---- Message feed ---- */
    .feed {
      flex: 1;
      overflow-y: auto;
      padding: 8px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .msg {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 3px 0;
    }
    .msg-time {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, monospace);
      flex-shrink: 0;
      padding-top: 2px;
      min-width: 60px;
    }
    .msg-sender {
      font-size: 11px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 3px;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .msg-content {
      font-size: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.4;
      flex: 1;
      min-width: 0;
    }
    .msg.system .msg-sender {
      background: rgba(158, 158, 158, 0.2);
      color: var(--vscode-descriptionForeground);
    }
    .msg.system .msg-content {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .msg.user-msg .msg-sender {
      background: rgba(33, 150, 243, 0.3);
      color: #90caf9;
    }

    /* ---- Input bar ---- */
    .input-bar {
      display: flex;
      gap: 6px;
      padding: 8px 14px;
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      align-items: center;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    .input-bar select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      padding: 4px 6px;
      border-radius: 3px;
      font-size: 12px;
      font-family: var(--vscode-font-family, sans-serif);
      flex-shrink: 0;
    }
    .input-bar input {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-family: var(--vscode-font-family, sans-serif);
      outline: none;
    }
    .input-bar input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .send-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-family: var(--vscode-font-family, sans-serif);
      flex-shrink: 0;
    }
    .send-btn:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <span class="header-title" id="teamName"></span>
    <span class="status-badge" id="statusBadge"></span>
    <span class="duration" id="duration"></span>
    <span class="spacer"></span>
    <button class="disband-btn" id="disbandBtn">Disband Team</button>
  </div>

  <!-- Agent cards -->
  <div class="agents-row" id="agentsRow"></div>

  <!-- Message feed -->
  <div class="feed" id="feed"></div>

  <!-- Input bar -->
  <div class="input-bar">
    <select id="recipientSelect">
      <option value="team">team</option>
    </select>
    <input type="text" id="messageInput" placeholder="Type a message..." />
    <button class="send-btn" id="sendBtn">Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const MAX_FEED_MESSAGES = ${MAX_MESSAGES};

    // State
    let teamCreatedAt = null;
    let agentNames = [];
    let feedCount = 0;
    let autoScroll = true;

    // Color map for sender badges (populated from agent info)
    const senderColors = {};

    // Elements
    const teamNameEl = document.getElementById('teamName');
    const statusBadgeEl = document.getElementById('statusBadge');
    const durationEl = document.getElementById('duration');
    const agentsRowEl = document.getElementById('agentsRow');
    const feedEl = document.getElementById('feed');
    const recipientSelect = document.getElementById('recipientSelect');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const disbandBtn = document.getElementById('disbandBtn');

    // Duration timer
    let durationTimer = null;
    function startDurationTimer() {
      if (durationTimer) clearInterval(durationTimer);
      durationTimer = setInterval(updateDuration, 1000);
    }
    function updateDuration() {
      if (!teamCreatedAt) return;
      const elapsed = Date.now() - new Date(teamCreatedAt).getTime();
      if (elapsed < 0) { durationEl.textContent = '00:00:00'; return; }
      const h = Math.floor(elapsed / 3600000);
      const m = Math.floor((elapsed % 3600000) / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      durationEl.textContent =
        String(h).padStart(2, '0') + ':' +
        String(m).padStart(2, '0') + ':' +
        String(s).padStart(2, '0');
    }

    // Detect if user has scrolled away from bottom
    feedEl.addEventListener('scroll', function() {
      const threshold = 40;
      autoScroll = (feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight) < threshold;
    });

    function scrollToBottom() {
      if (autoScroll) {
        feedEl.scrollTop = feedEl.scrollHeight;
      }
    }

    // Escape text for safe display
    function esc(str) {
      if (!str) return '';
      return String(str);
    }

    // Update header
    function updateHeader(team) {
      if (!team) return;
      teamNameEl.textContent = team.name || '';
      statusBadgeEl.textContent = team.status || '';
      statusBadgeEl.className = 'status-badge ' + (team.status || '');
      teamCreatedAt = team.createdAt;
      updateDuration();
    }

    // Update agent cards
    function updateAgents(agents) {
      if (!agents) return;

      // Store colors for message rendering
      agents.forEach(function(a) { senderColors[a.name] = a.color; });

      // Update recipient dropdown
      agentNames = agents.map(function(a) { return a.name; });
      updateRecipientDropdown();

      // Rebuild agent cards
      while (agentsRowEl.firstChild) agentsRowEl.removeChild(agentsRowEl.firstChild);

      agents.forEach(function(agent) {
        var card = document.createElement('div');
        card.className = 'agent-card';

        var iconEl = document.createElement('span');
        iconEl.className = 'agent-icon';
        iconEl.style.color = agent.color;
        iconEl.textContent = agent.icon;
        card.appendChild(iconEl);

        var details = document.createElement('div');
        details.className = 'agent-details';

        var nameEl = document.createElement('span');
        nameEl.className = 'agent-name';
        nameEl.textContent = agent.name;
        nameEl.style.color = agent.color;
        details.appendChild(nameEl);

        var progEl = document.createElement('span');
        progEl.className = 'agent-program';
        progEl.textContent = agent.program;
        details.appendChild(progEl);

        var tokensEl = document.createElement('span');
        tokensEl.className = 'agent-tokens';
        tokensEl.textContent = agent.tokenUsage;
        details.appendChild(tokensEl);

        card.appendChild(details);

        var dotEl = document.createElement('span');
        dotEl.className = 'agent-status-dot ' + agent.status;
        card.appendChild(dotEl);

        agentsRowEl.appendChild(card);
      });
    }

    function updateRecipientDropdown() {
      var currentVal = recipientSelect.value;
      while (recipientSelect.firstChild) recipientSelect.removeChild(recipientSelect.firstChild);

      var teamOpt = document.createElement('option');
      teamOpt.value = 'team';
      teamOpt.textContent = 'team';
      recipientSelect.appendChild(teamOpt);

      agentNames.forEach(function(name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        recipientSelect.appendChild(opt);
      });

      // Restore selection if still valid
      if (currentVal && (currentVal === 'team' || agentNames.indexOf(currentVal) >= 0)) {
        recipientSelect.value = currentVal;
      }
    }

    // Render a single message DOM element
    function createMessageEl(msg) {
      var row = document.createElement('div');
      row.className = 'msg';
      if (msg.from === 'ensemble') row.className += ' system';
      if (msg.from === 'user') row.className += ' user-msg';

      var timeEl = document.createElement('span');
      timeEl.className = 'msg-time';
      if (msg.timestamp) {
        var d = new Date(msg.timestamp);
        timeEl.textContent =
          String(d.getHours()).padStart(2, '0') + ':' +
          String(d.getMinutes()).padStart(2, '0') + ':' +
          String(d.getSeconds()).padStart(2, '0');
      }
      row.appendChild(timeEl);

      var senderEl = document.createElement('span');
      senderEl.className = 'msg-sender';
      senderEl.textContent = msg.from || 'unknown';
      var sColor = senderColors[msg.from];
      if (sColor) {
        senderEl.style.background = sColor + '33';
        senderEl.style.color = sColor;
      }
      row.appendChild(senderEl);

      var contentEl = document.createElement('span');
      contentEl.className = 'msg-content';
      contentEl.textContent = msg.content || '';
      row.appendChild(contentEl);

      return row;
    }

    // Render full message list
    function renderMessages(messages) {
      while (feedEl.firstChild) feedEl.removeChild(feedEl.firstChild);
      feedCount = 0;
      if (!messages) return;
      var capped = messages.slice(-MAX_FEED_MESSAGES);
      capped.forEach(function(msg) {
        feedEl.appendChild(createMessageEl(msg));
        feedCount++;
      });
      // Force scroll to bottom on full render
      autoScroll = true;
      scrollToBottom();
    }

    // Append new messages incrementally
    function appendMessages(newMessages) {
      if (!newMessages || newMessages.length === 0) return;
      newMessages.forEach(function(msg) {
        feedEl.appendChild(createMessageEl(msg));
        feedCount++;
      });
      // Trim if over limit
      while (feedCount > MAX_FEED_MESSAGES && feedEl.firstChild) {
        feedEl.removeChild(feedEl.firstChild);
        feedCount--;
      }
      scrollToBottom();
    }

    // Handle messages from extension
    window.addEventListener('message', function(event) {
      var data = event.data;
      if (!data || !data.command) return;

      switch (data.command) {
        case 'fullState':
          updateHeader(data.team);
          updateAgents(data.agents);
          renderMessages(data.messages);
          startDurationTimer();
          break;
        case 'incrementalUpdate':
          if (data.team) updateHeader(data.team);
          if (data.agents) updateAgents(data.agents);
          if (data.newMessages) appendMessages(data.newMessages);
          break;
      }
    });

    // Send message
    function doSend() {
      var content = messageInput.value.trim();
      if (!content) return;
      var to = recipientSelect.value;
      vscode.postMessage({ command: 'sendMessage', to: to, content: content });
      messageInput.value = '';
      messageInput.focus();
    }

    sendBtn.addEventListener('click', doSend);
    messageInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    // Disband
    disbandBtn.addEventListener('click', function() {
      vscode.postMessage({ command: 'disbandTeam' });
    });

    // Request initial feed
    vscode.postMessage({ command: 'requestFeed' });
  </script>
</body>
</html>`
  }
}
