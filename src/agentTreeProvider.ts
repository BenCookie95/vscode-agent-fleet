import * as vscode from 'vscode';
import * as path from 'path';
import { AgentState, AgentStatus, ChangedFile, HookEvent, StoredAgent } from './types';
import { AgentStorage } from './storage';
import { GitService } from './gitService';
import { HookWatcher } from './hookWatcher';

/**
 * Tree item types
 */
type TreeItemType = 'agent' | 'file';

/**
 * Tree item for agents and their changed files
 */
export class AgentTreeItem extends vscode.TreeItem {
    constructor(
        public readonly type: TreeItemType,
        public readonly agentId: string,
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly agentState?: AgentState,
        public readonly changedFile?: ChangedFile
    ) {
        super(label, collapsibleState);
        this.contextValue = type;
    }
}

/**
 * Provides tree data for the Agent Fleet sidebar
 */
export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** Event fired when an agent's status changes */
    private _onStatusChange = new vscode.EventEmitter<{ agentId: string; directory: string; oldStatus: AgentStatus; newStatus: AgentStatus }>();
    readonly onStatusChange = this._onStatusChange.event;

    /** Runtime status for each agent (keyed by directory path) */
    private agentStatuses: Map<string, AgentStatus> = new Map();

    /** Cached changed files for each agent */
    private changedFilesCache: Map<string, ChangedFile[]> = new Map();

    constructor(
        private storage: AgentStorage,
        private gitService: GitService,
        private hookWatcher: HookWatcher
    ) {
        // Listen for hook events
        hookWatcher.onEvent(event => this.handleHookEvent(event));
    }

    /**
     * Handle incoming hook events
     */
    private handleHookEvent(event: HookEvent): void {
        const newStatus = HookWatcher.mapEventToStatus(event);
        const oldStatus = this.agentStatuses.get(event.cwd) || 'idle';

        if (oldStatus !== newStatus) {
            this.agentStatuses.set(event.cwd, newStatus);

            // Find agent ID for this directory
            const agents = this.storage.getAgents();
            const agent = agents.find(a => a.directory === event.cwd);
            if (agent) {
                this._onStatusChange.fire({
                    agentId: agent.id,
                    directory: event.cwd,
                    oldStatus,
                    newStatus,
                });
            }
        } else {
            this.agentStatuses.set(event.cwd, newStatus);
        }

        this.refresh();
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Get status for an agent
     */
    getAgentStatus(directory: string): AgentStatus {
        return this.agentStatuses.get(directory) || 'idle';
    }

    /**
     * Set status for an agent
     */
    setAgentStatus(directory: string, status: AgentStatus): void {
        const oldStatus = this.agentStatuses.get(directory) || 'idle';

        if (oldStatus !== status) {
            this.agentStatuses.set(directory, status);

            // Find agent ID for this directory
            const agents = this.storage.getAgents();
            const agent = agents.find(a => a.directory === directory);
            if (agent) {
                this._onStatusChange.fire({
                    agentId: agent.id,
                    directory,
                    oldStatus,
                    newStatus: status,
                });
            }
        } else {
            this.agentStatuses.set(directory, status);
        }

        this.refresh();
    }

    /**
     * Get tree item representation
     */
    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children of a tree element
     */
    async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
        if (!element) {
            // Root level: return all agents
            return this.getAgentItems();
        }

        if (element.type === 'agent') {
            // Agent level: return changed files
            return this.getChangedFileItems(element.agentId, element.agentState!);
        }

        return [];
    }

    /**
     * Get all agent tree items
     */
    private async getAgentItems(): Promise<AgentTreeItem[]> {
        const agents = this.storage.getAgents();
        const items: AgentTreeItem[] = [];

        for (const agent of agents) {
            const status = this.getAgentStatus(agent.directory);
            const state: AgentState = { ...agent, status };

            // Pre-fetch changed files for collapse state
            const changedFiles = await this.getChangedFilesForAgent(agent);
            const hasChildren = changedFiles.length > 0;

            const item = new AgentTreeItem(
                'agent',
                agent.id,
                agent.name,
                hasChildren
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                state
            );

            // Set icon based on status
            item.iconPath = this.getStatusIcon(status);

            // Set tooltip with details
            item.tooltip = new vscode.MarkdownString(
                `**${agent.name}**\n\n` +
                `Status: ${this.getStatusLabel(status)}\n\n` +
                `Directory: \`${agent.directory}\`\n\n` +
                `Changed files: ${changedFiles.length}`
            );

            // Set description (shown to the right of the label)
            item.description = agent.directory;

            // Set command to select agent on click
            item.command = {
                command: 'agentFleet.selectAgent',
                title: 'Select Agent',
                arguments: [item],
            };

            items.push(item);
        }

        return items;
    }

    /**
     * Get changed file items for an agent
     */
    private async getChangedFileItems(agentId: string, agent: AgentState): Promise<AgentTreeItem[]> {
        const changedFiles = await this.getChangedFilesForAgent(agent);
        return changedFiles.map(file => {
            const item = new AgentTreeItem(
                'file',
                agentId,
                file.path,
                vscode.TreeItemCollapsibleState.None,
                agent,
                file
            );

            // Set icon based on git status
            item.iconPath = this.getFileStatusIcon(file.status);
            item.tooltip = `${this.getFileStatusLabel(file.status)}: ${file.path}`;
            item.description = file.status;

            // Set command to open diff on click
            // Use gitRoot for proper diff resolution with nested repos
            // filePath relative to gitRoot = absolutePath minus gitRoot prefix
            const relativeToGitRoot = path.relative(file.gitRoot, file.absolutePath);
            item.command = {
                command: 'agentFleet.openFileDiff',
                title: 'Open Diff',
                arguments: [file.gitRoot, relativeToGitRoot, file.status],
            };

            return item;
        });
    }

    /**
     * Get changed files for an agent (with caching)
     */
    private async getChangedFilesForAgent(agent: StoredAgent): Promise<ChangedFile[]> {
        // Check cache first
        const cached = this.changedFilesCache.get(agent.id);
        if (cached) {
            return cached;
        }

        const files = await this.gitService.getChangedFiles(agent.directory);
        this.changedFilesCache.set(agent.id, files);

        // Invalidate cache after a delay
        setTimeout(() => {
            this.changedFilesCache.delete(agent.id);
        }, 5000);

        return files;
    }

    /**
     * Get icon for agent status
     */
    private getStatusIcon(status: AgentStatus): vscode.ThemeIcon {
        switch (status) {
            case 'idle':
                return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.blue'));
            case 'running':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
            case 'stuck':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
            case 'complete':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    /**
     * Get label for agent status
     */
    private getStatusLabel(status: AgentStatus): string {
        switch (status) {
            case 'idle':
                return 'Idle';
            case 'running':
                return 'Running';
            case 'stuck':
                return 'Waiting for input';
            case 'complete':
                return 'Complete';
            default:
                return 'Unknown';
        }
    }

    /**
     * Get icon for file status
     */
    private getFileStatusIcon(status: string): vscode.ThemeIcon {
        switch (status) {
            case 'M':
                return new vscode.ThemeIcon('edit', new vscode.ThemeColor('charts.yellow'));
            case 'A':
                return new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.green'));
            case 'D':
                return new vscode.ThemeIcon('trash', new vscode.ThemeColor('charts.red'));
            case '?':
                return new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.purple'));
            case 'R':
                return new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('charts.blue'));
            case 'U':
                return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.orange'));
            default:
                return new vscode.ThemeIcon('file');
        }
    }

    /**
     * Get label for file status
     */
    private getFileStatusLabel(status: string): string {
        switch (status) {
            case 'M':
                return 'Modified';
            case 'A':
                return 'Added';
            case 'D':
                return 'Deleted';
            case '?':
                return 'Untracked';
            case 'R':
                return 'Renamed';
            case 'U':
                return 'Conflicted';
            default:
                return 'Changed';
        }
    }

    /**
     * Clear changed files cache
     */
    clearCache(): void {
        this.changedFilesCache.clear();
    }

    /**
     * Get all agents with their current status
     */
    getAgentsWithStatus(): AgentState[] {
        const agents = this.storage.getAgents();
        return agents.map(agent => ({
            ...agent,
            status: this.getAgentStatus(agent.directory),
        }));
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
        this._onStatusChange.dispose();
    }
}
