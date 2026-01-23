import * as vscode from 'vscode';
import { Agent } from './types';

/**
 * Manages terminal instances for agents
 */
export class TerminalManager {
    private terminals: Map<string, vscode.Terminal> = new Map();
    private disposables: vscode.Disposable[] = [];
    private onTerminalClosedEmitter = new vscode.EventEmitter<string>();
    private onTerminalFocusedEmitter = new vscode.EventEmitter<string>();

    /** Fired when a terminal is closed (agentId) */
    readonly onTerminalClosed = this.onTerminalClosedEmitter.event;

    /** Fired when an agent terminal is focused (agentId) */
    readonly onTerminalFocused = this.onTerminalFocusedEmitter.event;

    constructor() {
        // Listen for terminal close events
        this.disposables.push(
            vscode.window.onDidCloseTerminal(terminal => {
                // Find which agent this terminal belonged to
                for (const [agentId, agentTerminal] of this.terminals) {
                    if (agentTerminal === terminal) {
                        this.terminals.delete(agentId);
                        this.onTerminalClosedEmitter.fire(agentId);
                        break;
                    }
                }
            })
        );

        // Listen for terminal focus events
        this.disposables.push(
            vscode.window.onDidChangeActiveTerminal(terminal => {
                if (terminal) {
                    // Find which agent this terminal belongs to
                    for (const [agentId, agentTerminal] of this.terminals) {
                        if (agentTerminal === terminal) {
                            this.onTerminalFocusedEmitter.fire(agentId);
                            break;
                        }
                    }
                }
            })
        );
    }

    /**
     * Reclaim existing VS Code terminals that match our agent naming pattern.
     * This is useful after extension reload to reconnect with terminals that
     * VS Code preserved but we lost track of.
     */
    reclaimExistingTerminals(agents: Agent[]): void {
        const existingTerminals = vscode.window.terminals;

        for (const terminal of existingTerminals) {
            // Our terminals are named "Agent: <name>"
            if (terminal.name.startsWith('Agent: ')) {
                const agentName = terminal.name.substring('Agent: '.length);

                // Find the matching agent
                const agent = agents.find(a => a.name === agentName);
                if (agent && !this.terminals.has(agent.id)) {
                    // Reclaim this terminal
                    this.terminals.set(agent.id, terminal);
                    console.log(`Reclaimed existing terminal for agent: ${agent.name}`);
                }
            }
        }
    }

    /**
     * Build the claude command with all configured flags
     */
    private buildClaudeCommand(): string {
        const config = vscode.workspace.getConfiguration('agentFleet');
        const parts: string[] = ['claude'];

        // Model selection
        const model = config.get<string>('claude.model');
        if (model) {
            parts.push('--model', model);
        }

        // System prompt additions
        const appendSystemPrompt = config.get<string>('claude.appendSystemPrompt');
        if (appendSystemPrompt) {
            // Escape single quotes for shell
            const escaped = appendSystemPrompt.replace(/'/g, "'\\''");
            parts.push('--append-system-prompt', `'${escaped}'`);
        }

        const appendSystemPromptFile = config.get<string>('claude.appendSystemPromptFile');
        if (appendSystemPromptFile) {
            parts.push('--append-system-prompt-file', `'${appendSystemPromptFile}'`);
        }

        // Allowed tools
        const allowedTools = config.get<string[]>('claude.allowedTools') || [];
        for (const tool of allowedTools) {
            parts.push('--allowedTools', `'${tool}'`);
        }

        // Skip permissions (dangerous!)
        const skipPermissions = config.get<boolean>('claude.skipPermissions');
        if (skipPermissions) {
            parts.push('--dangerously-skip-permissions');
        }

        // Verbose mode
        const verbose = config.get<boolean>('claude.verbose');
        if (verbose) {
            parts.push('--verbose');
        }

        // Additional directories
        const additionalDirs = config.get<string[]>('claude.additionalDirs') || [];
        for (const dir of additionalDirs) {
            parts.push('--add-dir', `'${dir}'`);
        }

        // Extra flags (user-defined)
        const extraFlags = config.get<string>('claude.extraFlags');
        if (extraFlags) {
            parts.push(extraFlags);
        }

        return parts.join(' ');
    }

    /**
     * Create a terminal for an agent and optionally run claude
     */
    createTerminal(agent: Agent, runClaude: boolean = true): vscode.Terminal {
        // Check if terminal already exists
        const existing = this.terminals.get(agent.id);
        if (existing) {
            return existing;
        }

        // Get shell path from settings
        const config = vscode.workspace.getConfiguration('agentFleet');
        const shellPath = config.get<string>('shellPath') || undefined;

        const terminal = vscode.window.createTerminal({
            name: `Agent: ${agent.name}`,
            cwd: agent.directory,
            iconPath: new vscode.ThemeIcon('hubot'),
            shellPath: shellPath,
        });

        this.terminals.set(agent.id, terminal);

        // Auto-run claude command with configured flags
        if (runClaude) {
            const claudeCommand = this.buildClaudeCommand();
            terminal.sendText(claudeCommand);
        }

        return terminal;
    }

    /**
     * Show/focus an agent's terminal
     */
    showTerminal(agentId: string): void {
        const terminal = this.terminals.get(agentId);
        if (terminal) {
            terminal.show();
        }
    }

    /**
     * Get the terminal for an agent
     */
    getTerminal(agentId: string): vscode.Terminal | undefined {
        return this.terminals.get(agentId);
    }

    /**
     * Check if an agent has an active terminal
     */
    hasTerminal(agentId: string): boolean {
        return this.terminals.has(agentId);
    }

    /**
     * Close an agent's terminal
     */
    closeTerminal(agentId: string): void {
        const terminal = this.terminals.get(agentId);
        if (terminal) {
            terminal.dispose();
            this.terminals.delete(agentId);
        }
    }

    /**
     * Send text to an agent's terminal
     */
    sendText(agentId: string, text: string): void {
        const terminal = this.terminals.get(agentId);
        if (terminal) {
            terminal.sendText(text);
        }
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.onTerminalClosedEmitter.dispose();
        // Note: We don't close terminals on extension deactivation
        // as the user may want to keep them
    }
}
