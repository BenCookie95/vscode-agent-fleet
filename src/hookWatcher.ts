import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { HookEvent, AgentStatus } from './types';

/** Directory where hook events are written */
export const EVENTS_DIR = path.join(os.homedir(), '.agent-fleet', 'events');

/**
 * Watches for hook events from Claude Code CLI
 */
export class HookWatcher {
  private watcher: vscode.FileSystemWatcher | undefined;
  private disposables: vscode.Disposable[] = [];
  private onEventEmitter = new vscode.EventEmitter<HookEvent>();
  private processedFiles = new Set<string>();

  /** Fired when a hook event is received */
  readonly onEvent = this.onEventEmitter.event;

  /**
   * Start watching for hook events
   */
  start(): void {
    // Ensure events directory exists
    this.ensureEventsDir();

    // Create file system watcher for the events directory
    const pattern = new vscode.RelativePattern(EVENTS_DIR, '*.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.disposables.push(
      this.watcher.onDidCreate(uri => this.handleNewEvent(uri)),
      this.watcher.onDidChange(uri => this.handleNewEvent(uri))
    );

    // Process any existing events on startup
    this.processExistingEvents();
  }

  /**
   * Ensure the events directory exists
   */
  private ensureEventsDir(): void {
    try {
      if (!fs.existsSync(EVENTS_DIR)) {
        fs.mkdirSync(EVENTS_DIR, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create events directory:', error);
    }
  }

  /**
   * Process existing event files on startup
   */
  private processExistingEvents(): void {
    try {
      if (!fs.existsSync(EVENTS_DIR)) {
        return;
      }

      const files = fs.readdirSync(EVENTS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => path.join(EVENTS_DIR, f));

      // Sort by modification time and process most recent events
      const sortedFiles = files
        .map(f => ({ path: f, mtime: fs.statSync(f).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 100); // Only process last 100 events

      for (const file of sortedFiles) {
        this.processEventFile(file.path);
      }
    } catch (error) {
      console.error('Failed to process existing events:', error);
    }
  }

  /**
   * Handle a new event file
   */
  private handleNewEvent(uri: vscode.Uri): void {
    // Delay to ensure file is fully written before reading
    setTimeout(() => this.processEventFile(uri.fsPath), 100);
  }

  /**
   * Process an event file
   */
  private processEventFile(filePath: string): void {
    // Avoid processing the same file twice
    if (this.processedFiles.has(filePath)) {
      return;
    }
    this.processedFiles.add(filePath);

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const event = JSON.parse(content) as HookEvent;
      this.onEventEmitter.fire(event);

      // Clean up old event file after processing
      this.scheduleCleanup(filePath);
    } catch (error) {
      console.error(`Failed to process event file ${filePath}:`, error);
      vscode.window.showWarningMessage(`Agent Fleet: Failed to parse hook event`);
    }
  }

  /**
   * Schedule cleanup of an event file
   */
  private scheduleCleanup(filePath: string): void {
    // Clean up after a delay to ensure event is processed
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }, 5000);
  }

  /**
   * Map a hook event to an agent status
   */
  static mapEventToStatus(event: HookEvent): AgentStatus {
    switch (event.hook_event_name) {
      case 'PreToolUse':
      case 'PreCompact':
        // Starting a tool or compacting - agent is actively working
        return 'running';

      case 'PostToolUse':
        // Tool completed - agent is still running (may have more to do)
        return 'running';

      case 'Notification':
        switch (event.notification_type) {
          case 'permission_prompt':
            // Claude is asking for permission - user needs to respond
            return 'stuck';
          case 'idle_prompt':
            // Claude is waiting for user input (finished last task)
            return 'complete';
          case 'user_cancelled_tool_use':
            // User rejected the tool - Claude will respond and continue
            return 'running';
          default:
            // Any other notification type
            return 'complete';
        }

      case 'Stop':
        // Claude finished responding to the prompt
        return 'complete';

      case 'SessionEnd':
        // Claude session closed
        return 'idle';

      default:
        return 'idle';
    }
  }

  /**
   * Stop watching and clean up
   */
  dispose(): void {
    this.watcher?.dispose();
    this.disposables.forEach(d => d.dispose());
    this.onEventEmitter.dispose();
    this.processedFiles.clear();
  }
}
