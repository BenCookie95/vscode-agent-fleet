import * as vscode from 'vscode';
import * as path from 'path';
import { AgentStorage } from './storage';
import { TerminalManager } from './terminalManager';
import { AgentTreeProvider, AgentTreeItem } from './agentTreeProvider';
import { HookInstaller } from './hookInstaller';
import { StoredAgent } from './types';
import { createGitHeadUri } from './gitContentProvider';
import { WorkspaceManager } from './workspaceManager';

/**
 * Registers all extension commands
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    storage: AgentStorage,
    terminalManager: TerminalManager,
    treeProvider: AgentTreeProvider,
    workspaceManager: WorkspaceManager
): void {
    // Add Agent command
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.addAgent', async () => {
            // Prompt user to select a directory
            const uris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Agent Directory',
                title: 'Select Directory for New Agent',
            });

            if (!uris || uris.length === 0) {
                return;
            }

            const directory = uris[0].fsPath;

            // Check if agent already exists for this directory
            const existing = storage.getAgentByDirectory(directory);
            if (existing) {
                vscode.window.showWarningMessage(
                    `An agent already exists for this directory: ${existing.name}`
                );
                return;
            }

            // Create agent
            const name = path.basename(directory);
            const agent: StoredAgent = {
                id: AgentStorage.generateId(),
                name,
                directory,
                createdAt: Date.now(),
            };

            await storage.addAgent(agent);

            // Create terminal and run claude
            terminalManager.createTerminal(agent, true);

            // Refresh tree
            treeProvider.refresh();
        })
    );

    // Remove Agent command
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.removeAgent', async (item: AgentTreeItem) => {
            if (!item || item.type !== 'agent') {
                return;
            }

            const agent = storage.getAgent(item.agentId);
            if (!agent) {
                return;
            }

            // Confirm removal
            const confirm = await vscode.window.showWarningMessage(
                `Remove agent "${agent.name}"? This will close its terminal.`,
                { modal: true },
                'Remove'
            );

            if (confirm !== 'Remove') {
                return;
            }

            // Close terminal
            terminalManager.closeTerminal(agent.id);

            // Unfocus workspace if this agent was focused
            workspaceManager.onAgentRemoved(agent.id);

            // Remove from storage
            await storage.removeAgent(agent.id);

            // Refresh tree
            treeProvider.refresh();
        })
    );

    // Refresh Agents command
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.refreshAgents', () => {
            treeProvider.clearCache();
            treeProvider.refresh();
        })
    );

    // Open Terminal command
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.openTerminal', (item: AgentTreeItem) => {
            if (!item || item.type !== 'agent') {
                return;
            }

            const agent = storage.getAgent(item.agentId);
            if (!agent) {
                return;
            }

            // Create terminal if it doesn't exist, otherwise show it
            if (!terminalManager.hasTerminal(agent.id)) {
                terminalManager.createTerminal(agent, true);
            }
            terminalManager.showTerminal(agent.id);

            // Reset status from "complete" to "idle" to acknowledge the completion
            if (treeProvider.getAgentStatus(agent.directory) === 'complete') {
                treeProvider.setAgentStatus(agent.directory, 'idle');
            }
        })
    );

    // Open File Diff command (internal command for tree item click)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'agentFleet.openFileDiff',
            async (directory: string, filePath: string, status: string) => {
                const absolutePath = path.join(directory, filePath);
                const uri = vscode.Uri.file(absolutePath);

                if (status === 'D') {
                    // Deleted file - can't open it
                    return;
                }

                if (status === '?') {
                    // Untracked file - just open it
                    await vscode.commands.executeCommand('vscode.open', uri);
                    return;
                }

                // For modified/added files, show diff between HEAD and working tree
                try {
                    // Create URI for the HEAD version using our content provider
                    const headUri = createGitHeadUri(directory, filePath);

                    // Use vscode.diff to show the comparison
                    await vscode.commands.executeCommand(
                        'vscode.diff',
                        headUri,
                        uri,
                        `${filePath} (HEAD ↔ Working Tree)`
                    );
                } catch {
                    // Fallback: just open the file
                    await vscode.commands.executeCommand('vscode.open', uri);
                }
            }
        )
    );

    // Install Hooks command
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.installHooks', async () => {
            if (!HookInstaller.isClaudeInstalled()) {
                vscode.window.showErrorMessage(
                    'Claude Code does not appear to be installed. Please install Claude Code first.'
                );
                return;
            }

            const result = HookInstaller.install();

            if (result.success) {
                vscode.window.showInformationMessage(result.message);
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        })
    );

    // Uninstall Hooks command
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.uninstallHooks', async () => {
            const result = HookInstaller.uninstall();

            if (result.success) {
                vscode.window.showInformationMessage(result.message);
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        })
    );

    // Handle tree item selection (show terminal)
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.selectAgent', (item: AgentTreeItem) => {
            if (item && item.type === 'agent') {
                const agent = storage.getAgent(item.agentId);
                if (agent) {
                    if (terminalManager.hasTerminal(agent.id)) {
                        terminalManager.showTerminal(agent.id);
                    }

                    // Reset status from "complete" to "idle" to acknowledge the completion
                    if (treeProvider.getAgentStatus(agent.directory) === 'complete') {
                        treeProvider.setAgentStatus(agent.directory, 'idle');
                    }
                }
            }
        })
    );

    // Focus Workspace command - adds agent directory to workspace
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.focusWorkspace', (item: AgentTreeItem | { type: string; agentId: string }) => {
            if (!item || item.type !== 'agent') {
                return;
            }

            const agent = storage.getAgent(item.agentId);
            if (!agent) {
                return;
            }

            const success = workspaceManager.focusWorkspace(agent);
            if (!success) {
                vscode.window.showErrorMessage(`Failed to focus workspace on "${agent.name}"`);
            }

            // Reset status from "complete" to "idle" to acknowledge the completion
            if (treeProvider.getAgentStatus(agent.directory) === 'complete') {
                treeProvider.setAgentStatus(agent.directory, 'idle');
            }
        })
    );

    // Unfocus Workspace command - removes focused agent from workspace
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.unfocusWorkspace', () => {
            const focusedId = workspaceManager.getFocusedAgentId();
            if (!focusedId) {
                return;
            }

            workspaceManager.unfocusWorkspace();
        })
    );

    // Show Agent Quick Pick command - for status bar click
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.showAgentQuickPick', async () => {
            const agents = treeProvider.getAgentsWithStatus();
            if (agents.length === 0) {
                return;
            }

            const items = agents.map(agent => {
                const statusIcon = getStatusIcon(agent.status);
                const focused = workspaceManager.isFocused(agent.id) ? ' (focused)' : '';
                return {
                    label: `${statusIcon} ${agent.name}${focused}`,
                    description: agent.directory,
                    agent,
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select an agent',
            });

            if (selected) {
                // Show options for the selected agent
                const actions = ['Focus Workspace', 'Open Terminal'];
                const action = await vscode.window.showQuickPick(actions, {
                    placeHolder: `Action for ${selected.agent.name}`,
                });

                if (action === 'Focus Workspace') {
                    workspaceManager.focusWorkspace(selected.agent);
                } else if (action === 'Open Terminal') {
                    if (!terminalManager.hasTerminal(selected.agent.id)) {
                        terminalManager.createTerminal(selected.agent, true);
                    }
                    terminalManager.showTerminal(selected.agent.id);

                    // Reset status from "complete" to "idle" to acknowledge the completion
                    if (treeProvider.getAgentStatus(selected.agent.directory) === 'complete') {
                        treeProvider.setAgentStatus(selected.agent.directory, 'idle');
                    }
                }
            }
        })
    );

    // Focus Workspace from Terminal context menu
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.focusWorkspaceFromTerminal', (terminal: vscode.Terminal) => {
            if (!terminal) {
                // If no terminal passed, try the active terminal
                terminal = vscode.window.activeTerminal!;
                if (!terminal) {
                    return;
                }
            }

            // Our terminals are named "Agent: <name>"
            if (!terminal.name.startsWith('Agent: ')) {
                vscode.window.showWarningMessage('This terminal is not an Agent Fleet terminal');
                return;
            }

            const agentName = terminal.name.substring('Agent: '.length);

            // Find the agent by name
            const agents = storage.getAgents();
            const agent = agents.find(a => a.name === agentName);

            if (!agent) {
                vscode.window.showErrorMessage(`Agent "${agentName}" not found`);
                return;
            }

            const success = workspaceManager.focusWorkspace(agent);
            if (!success) {
                vscode.window.showErrorMessage(`Failed to focus workspace on "${agent.name}"`);
            }
        })
    );

    // Reset Agent Status command (internal for notifications)
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.resetAgentStatus', (agentId: string) => {
            if (!agentId) {
                return;
            }

            const agent = storage.getAgent(agentId);
            if (!agent) {
                return;
            }

            // Only reset if currently complete
            if (treeProvider.getAgentStatus(agent.directory) === 'complete') {
                treeProvider.setAgentStatus(agent.directory, 'idle');
            }
        })
    );

    // Set Status to Idle command (manual override for stuck agents)
    context.subscriptions.push(
        vscode.commands.registerCommand('agentFleet.setStatusIdle', (item: AgentTreeItem) => {
            if (!item || item.type !== 'agent') {
                return;
            }

            const agent = storage.getAgent(item.agentId);
            if (!agent) {
                return;
            }

            // Force status to idle regardless of current state
            treeProvider.setAgentStatus(agent.directory, 'idle');
        })
    );
}

/**
 * Get status icon for quick pick display
 */
function getStatusIcon(status: string): string {
    switch (status) {
        case 'running':
            return '$(sync~spin)';
        case 'stuck':
            return '$(warning)';
        case 'complete':
            return '$(check)';
        case 'idle':
        default:
            return '$(circle-outline)';
    }
}
