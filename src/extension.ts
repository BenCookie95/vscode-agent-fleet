import * as vscode from 'vscode';
import { AgentStorage } from './storage';
import { TerminalManager } from './terminalManager';
import { GitService } from './gitService';
import { HookWatcher } from './hookWatcher';
import { HookInstaller } from './hookInstaller';
import { AgentTreeProvider } from './agentTreeProvider';
import { registerCommands } from './commands';
import { GitContentProvider, GIT_HEAD_SCHEME } from './gitContentProvider';
import { WorkspaceManager } from './workspaceManager';
import { NotificationService } from './notificationService';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('Agent Fleet extension is activating...');

    // Initialize core services
    const storage = new AgentStorage(context);
    const terminalManager = new TerminalManager();
    const gitService = new GitService();
    const hookWatcher = new HookWatcher();
    const workspaceManager = new WorkspaceManager(context);
    const notificationService = new NotificationService();

    // Initialize git content provider for diffs
    const gitContentProvider = new GitContentProvider(gitService);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(GIT_HEAD_SCHEME, gitContentProvider)
    );

    // Initialize tree provider
    const treeProvider = new AgentTreeProvider(storage, gitService, hookWatcher);

    // Register tree view
    const treeView = vscode.window.createTreeView('agentFleetView', {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });

    // Handle tree item selection
    context.subscriptions.push(
        treeView.onDidChangeSelection(e => {
            if (e.selection.length > 0) {
                const item = e.selection[0];
                if (item.type === 'agent') {
                    const agent = storage.getAgent(item.agentId);
                    if (agent && terminalManager.hasTerminal(agent.id)) {
                        terminalManager.showTerminal(agent.id);

                        // Reset status from "complete" to "idle" to acknowledge the completion
                        if (treeProvider.getAgentStatus(agent.directory) === 'complete') {
                            treeProvider.setAgentStatus(agent.directory, 'idle');
                        }
                    }
                }
            }
        })
    );

    // Register commands
    registerCommands(context, storage, terminalManager, treeProvider, workspaceManager);

    // Start hook watcher
    hookWatcher.start();

    // Wire up notification service to status changes
    context.subscriptions.push(
        treeProvider.onStatusChange(event => {
            const agent = storage.getAgent(event.agentId);
            if (agent) {
                notificationService.notifyStatusChange(agent, event.newStatus, event.oldStatus);
            }
            // Update status bar with current agent states
            notificationService.updateStatusBar(treeProvider.getAgentsWithStatus());
        })
    );

    // Update status bar initially
    notificationService.updateStatusBar(treeProvider.getAgentsWithStatus());

    // Update status bar when tree data changes (e.g., agent added/removed)
    context.subscriptions.push(
        treeProvider.onDidChangeTreeData(() => {
            notificationService.updateStatusBar(treeProvider.getAgentsWithStatus());
        })
    );

    // Handle terminal close events
    context.subscriptions.push(
        terminalManager.onTerminalClosed(agentId => {
            const agent = storage.getAgent(agentId);
            if (agent) {
                treeProvider.setAgentStatus(agent.directory, 'idle');
            }
        })
    );

    // Check if hooks are installed and prompt if not
    if (HookInstaller.isClaudeInstalled() && !HookInstaller.areHooksInstalled()) {
        vscode.window
            .showInformationMessage(
                'Agent Fleet hooks are not installed. Install them to see real-time agent status updates.',
                'Install Hooks',
                'Later'
            )
            .then(selection => {
                if (selection === 'Install Hooks') {
                    vscode.commands.executeCommand('agentFleet.installHooks');
                }
            });
    }

    // Restore terminals for existing agents on startup
    const agents = storage.getAgents();

    // Reclaim any existing VS Code terminals that match our agents
    // This handles the case where terminals persist across extension reloads
    terminalManager.reclaimExistingTerminals(agents);

    // Note: We don't auto-create terminals on startup to avoid spawning
    // multiple claude instances unexpectedly. Users can manually
    // open terminals using the context menu.

    // Register disposables
    context.subscriptions.push(
        treeView,
        treeProvider,
        terminalManager,
        hookWatcher,
        workspaceManager,
        notificationService
    );

    console.log('Agent Fleet extension activated successfully.');
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
    console.log('Agent Fleet extension deactivated.');
}
