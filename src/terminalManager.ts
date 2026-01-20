import * as vscode from 'vscode';
import { Agent } from './types';

/**
 * Manages terminal instances for agents
 */
export class TerminalManager {
  private terminals: Map<string, vscode.Terminal> = new Map();
  private disposables: vscode.Disposable[] = [];
  private onTerminalClosedEmitter = new vscode.EventEmitter<string>();

  /** Fired when a terminal is closed (agentId) */
  readonly onTerminalClosed = this.onTerminalClosedEmitter.event;

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

    const terminal = vscode.window.createTerminal({
      name: `Agent: ${agent.name}`,
      cwd: agent.directory,
      iconPath: new vscode.ThemeIcon('hubot'),
    });

    this.terminals.set(agent.id, terminal);

    // Auto-run claude command
    if (runClaude) {
      terminal.sendText('claude');
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
