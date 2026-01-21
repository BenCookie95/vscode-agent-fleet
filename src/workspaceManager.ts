import * as vscode from 'vscode';
import { StoredAgent } from './types';

/**
 * Manages workspace folder operations for focusing on agent directories.
 * Only one agent can be focused at a time - focusing a new agent
 * automatically removes the previously focused one.
 */
export class WorkspaceManager {
    private focusedAgentId: string | null = null;
    private focusedFolderUri: vscode.Uri | null = null;

    constructor(private context: vscode.ExtensionContext) {
        // Restore focused agent from storage
        this.focusedAgentId = context.globalState.get<string>('focusedAgentId') || null;
        const focusedPath = context.globalState.get<string>('focusedFolderPath');
        if (focusedPath) {
            this.focusedFolderUri = vscode.Uri.file(focusedPath);
        }
    }

    /**
     * Focus on an agent's workspace by adding its directory to the workspace folders.
     * If another agent is currently focused, it will be removed first.
     */
    focusWorkspace(agent: StoredAgent): boolean {
        const agentUri = vscode.Uri.file(agent.directory);

        // Check if this agent is already focused
        if (this.focusedAgentId === agent.id) {
            // Just ensure the folder is visible in explorer
            vscode.commands.executeCommand('workbench.view.explorer');
            return true;
        }

        // Check if this directory is already in the workspace (e.g., as the root)
        const existingFolders = vscode.workspace.workspaceFolders || [];
        const alreadyExists = existingFolders.some(
            folder => folder.uri.fsPath === agentUri.fsPath
        );

        if (alreadyExists) {
            // Already in workspace, just track it as focused
            this.setFocusedAgent(agent.id, agentUri);
            vscode.commands.executeCommand('workbench.view.explorer');
            return true;
        }

        // Find and remove the previously focused folder if it exists
        let removeIndex = -1;
        if (this.focusedFolderUri) {
            removeIndex = existingFolders.findIndex(
                folder => folder.uri.fsPath === this.focusedFolderUri!.fsPath
            );
            // Close the git repository in Source Control panel
            this.closeGitRepository(this.focusedFolderUri.fsPath);
        }

        // Perform the workspace update
        let success: boolean;
        if (removeIndex >= 0) {
            // Replace the old focused folder with the new one
            success = vscode.workspace.updateWorkspaceFolders(
                removeIndex,
                1,
                { uri: agentUri, name: `🤖 ${agent.name}` }
            );
        } else {
            // Add at the end of the workspace folders
            const insertIndex = existingFolders.length;
            success = vscode.workspace.updateWorkspaceFolders(
                insertIndex,
                0,
                { uri: agentUri, name: `🤖 ${agent.name}` }
            );
        }

        if (success) {
            this.setFocusedAgent(agent.id, agentUri);
            vscode.commands.executeCommand('workbench.view.explorer');
        }

        return success;
    }

    /**
     * Remove the currently focused agent's folder from the workspace.
     */
    unfocusWorkspace(): boolean {
        if (!this.focusedFolderUri) {
            return true; // Nothing to unfocus
        }

        // Close the git repository in Source Control panel
        this.closeGitRepository(this.focusedFolderUri.fsPath);

        const existingFolders = vscode.workspace.workspaceFolders || [];
        const removeIndex = existingFolders.findIndex(
            folder => folder.uri.fsPath === this.focusedFolderUri!.fsPath
        );

        if (removeIndex < 0) {
            // Folder not in workspace, just clear our tracking
            this.clearFocusedAgent();
            return true;
        }

        const success = vscode.workspace.updateWorkspaceFolders(removeIndex, 1);
        if (success) {
            this.clearFocusedAgent();
        }

        return success;
    }

    /**
     * Check if a specific agent is currently focused.
     */
    isFocused(agentId: string): boolean {
        return this.focusedAgentId === agentId;
    }

    /**
     * Get the ID of the currently focused agent.
     */
    getFocusedAgentId(): string | null {
        return this.focusedAgentId;
    }

    /**
     * Update tracking and persist the focused agent.
     */
    private setFocusedAgent(agentId: string, uri: vscode.Uri): void {
        this.focusedAgentId = agentId;
        this.focusedFolderUri = uri;
        this.context.globalState.update('focusedAgentId', agentId);
        this.context.globalState.update('focusedFolderPath', uri.fsPath);
    }

    /**
     * Clear tracking and persist.
     */
    private clearFocusedAgent(): void {
        this.focusedAgentId = null;
        this.focusedFolderUri = null;
        this.context.globalState.update('focusedAgentId', undefined);
        this.context.globalState.update('focusedFolderPath', undefined);
    }

    /**
     * Handle agent removal - unfocus if the removed agent was focused.
     */
    onAgentRemoved(agentId: string): void {
        if (this.focusedAgentId === agentId) {
            this.unfocusWorkspace();
        }
    }

    dispose(): void {
        // Nothing to dispose
    }

    /**
     * Close a git repository in the Source Control panel.
     * This prevents repositories from lingering after workspace folders are removed.
     */
    private closeGitRepository(directory: string): void {
        try {
            vscode.commands.executeCommand('git.closeRepository', directory);
        } catch {
            // Git extension may not be installed or command may fail - ignore
        }
    }
}
