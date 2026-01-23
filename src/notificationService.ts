import * as vscode from 'vscode';
import { AgentState, AgentStatus, StoredAgent } from './types';

/**
 * Service for notifying users about agent status changes.
 * Provides toast notifications and a status bar item.
 */
export class NotificationService {
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];
    /** Track pending notifications by agent ID - when dismissed, we ignore the action */
    private pendingNotifications: Map<string, { dismissed: boolean }> = new Map();

    constructor() {
        // Create status bar item on the left side
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'agentFleet.showAgentQuickPick';
        this.statusBarItem.tooltip = 'Click to view agents';
        this.statusBarItem.show();

        this.disposables.push(this.statusBarItem);
    }

    /**
     * Update the status bar with current agent counts.
     */
    updateStatusBar(agents: AgentState[]): void {
        if (agents.length === 0) {
            this.statusBarItem.text = '$(hubot) No agents';
            return;
        }

        const counts = {
            running: 0,
            stuck: 0,
            complete: 0,
            idle: 0,
        };

        for (const agent of agents) {
            if (agent.status in counts) {
                counts[agent.status]++;
            }
        }

        // Build status text - only show non-zero counts
        const parts: string[] = [];

        if (counts.running > 0) {
            parts.push(`$(sync~spin) ${counts.running}`);
        }
        if (counts.stuck > 0) {
            parts.push(`$(warning) ${counts.stuck}`);
        }
        if (counts.complete > 0) {
            parts.push(`$(check) ${counts.complete}`);
        }
        if (counts.idle > 0) {
            parts.push(`$(circle-outline) ${counts.idle}`);
        }

        if (parts.length === 0) {
            this.statusBarItem.text = `$(hubot) ${agents.length} agents`;
        } else {
            this.statusBarItem.text = `$(hubot) ${parts.join(' ')}`;
        }

        // Update tooltip with more detail
        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `**Agent Fleet**\n\n` +
            `Running: ${counts.running}\n\n` +
            `Stuck: ${counts.stuck}\n\n` +
            `Complete: ${counts.complete}\n\n` +
            `Idle: ${counts.idle}\n\n` +
            `_Click to view agents_`
        );
    }

    /**
     * Notify the user when an agent's status changes to an important state.
     */
    async notifyStatusChange(
        agent: StoredAgent,
        newStatus: AgentStatus,
        oldStatus: AgentStatus
    ): Promise<void> {
        // Only notify for transitions to stuck or complete
        if (newStatus === oldStatus) {
            return;
        }

        // Track this notification
        const notificationState = { dismissed: false };
        this.pendingNotifications.set(agent.id, notificationState);

        if (newStatus === 'stuck') {
            const action = await vscode.window.showWarningMessage(
                `Agent "${agent.name}" is waiting for input`,
                'Open Terminal',
                'Dismiss'
            );

            // Remove from pending
            this.pendingNotifications.delete(agent.id);

            // If dismissed by terminal focus, ignore the action
            if (notificationState.dismissed) {
                return;
            }

            if (action === 'Open Terminal') {
                vscode.commands.executeCommand('agentFleet.openTerminal', {
                    type: 'agent',
                    agentId: agent.id
                });
            }
        } else if (newStatus === 'complete') {
            const action = await vscode.window.showInformationMessage(
                `Agent "${agent.name}" completed!`,
                'Focus Workspace',
                'Open Terminal',
                'Dismiss'
            );

            // Remove from pending
            this.pendingNotifications.delete(agent.id);

            // If dismissed by terminal focus, ignore the action
            if (notificationState.dismissed) {
                return;
            }

            if (action === 'Focus Workspace') {
                vscode.commands.executeCommand('agentFleet.focusWorkspace', {
                    type: 'agent',
                    agentId: agent.id
                });
            } else if (action === 'Open Terminal') {
                vscode.commands.executeCommand('agentFleet.openTerminal', {
                    type: 'agent',
                    agentId: agent.id
                });
            } else {
                // Dismiss or close - reset status
                vscode.commands.executeCommand('agentFleet.resetAgentStatus', agent.id);
            }
        }
    }

    /**
     * Dismiss any pending notification for an agent.
     * This marks the notification as dismissed so we ignore any action when the promise resolves.
     */
    dismissNotification(agentId: string): void {
        const pending = this.pendingNotifications.get(agentId);
        if (pending) {
            pending.dismissed = true;
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
