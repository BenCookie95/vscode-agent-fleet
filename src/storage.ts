import * as vscode from 'vscode';
import { StoredAgent } from './types';

const STORAGE_KEY = 'agentFleet.agents';

/**
 * Handles persistence of agents using VSCode's globalState
 */
export class AgentStorage {
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Get all stored agents
   */
  getAgents(): StoredAgent[] {
    return this.context.globalState.get<StoredAgent[]>(STORAGE_KEY, []);
  }

  /**
   * Get a single agent by ID
   */
  getAgent(id: string): StoredAgent | undefined {
    return this.getAgents().find(agent => agent.id === id);
  }

  /**
   * Get a single agent by directory path
   */
  getAgentByDirectory(directory: string): StoredAgent | undefined {
    return this.getAgents().find(agent => agent.directory === directory);
  }

  /**
   * Add a new agent
   */
  async addAgent(agent: StoredAgent): Promise<void> {
    const agents = this.getAgents();
    agents.push(agent);
    await this.context.globalState.update(STORAGE_KEY, agents);
  }

  /**
   * Remove an agent by ID
   */
  async removeAgent(id: string): Promise<void> {
    const agents = this.getAgents().filter(agent => agent.id !== id);
    await this.context.globalState.update(STORAGE_KEY, agents);
  }

  /**
   * Update an existing agent
   */
  async updateAgent(id: string, updates: Partial<StoredAgent>): Promise<void> {
    const agents = this.getAgents().map(agent => {
      if (agent.id === id) {
        return { ...agent, ...updates };
      }
      return agent;
    });
    await this.context.globalState.update(STORAGE_KEY, agents);
  }

  /**
   * Clear all agents (for testing/reset)
   */
  async clearAll(): Promise<void> {
    await this.context.globalState.update(STORAGE_KEY, []);
  }

  /**
   * Generate a unique agent ID
   */
  static generateId(): string {
    return `agent-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
