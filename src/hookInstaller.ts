import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EVENTS_DIR } from './hookWatcher';

/** Path to Claude Code settings file */
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/** Marker string to identify Agent Fleet hooks */
const HOOK_MARKER = '.agent-fleet';

/**
 * Get the hook command that writes events to the events directory.
 * Claude passes hook data as JSON through stdin, so we use cat to capture it.
 */
function getHookCommand(): string {
  // Claude passes hook event data as JSON through stdin
  // We simply capture it and write to a file with unique name
  return `bash -c 'mkdir -p "${EVENTS_DIR}" && cat > "${EVENTS_DIR}/$(date +%s%N)_$$.json"'`;
}

/** A single hook action */
interface HookAction {
  type: string;
  command: string;
}

/** A hook configuration with matcher and hooks array */
interface HookConfig {
  matcher?: string;
  hooks: HookAction[];
}

/** Claude Code settings structure */
interface ClaudeSettings {
  hooks?: {
    [key: string]: HookConfig[];
  };
  [key: string]: unknown;
}

/**
 * Handles installation and uninstallation of hooks into Claude Code
 */
export class HookInstaller {
  /**
   * Check if Claude Code is installed
   */
  static isClaudeInstalled(): boolean {
    const claudeDir = path.join(os.homedir(), '.claude');
    return fs.existsSync(claudeDir);
  }

  /**
   * Check if hooks are currently installed
   */
  static areHooksInstalled(): boolean {
    try {
      if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        return false;
      }

      const settings = HookInstaller.readSettings();
      if (!settings.hooks) {
        return false;
      }

      // Check if our hook marker is present in any hook action
      for (const configs of Object.values(settings.hooks)) {
        if (!Array.isArray(configs)) continue;
        for (const config of configs) {
          if (config.hooks) {
            for (const action of config.hooks) {
              if (action.command && action.command.includes(HOOK_MARKER)) {
                return true;
              }
            }
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Read Claude Code settings
   */
  private static readSettings(): ClaudeSettings {
    try {
      if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        return {};
      }
      const content = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * Write Claude Code settings
   */
  private static writeSettings(settings: ClaudeSettings): void {
    const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  }

  /**
   * Check if a hook config contains our marker
   */
  private static isOurHook(config: HookConfig): boolean {
    if (!config.hooks) return false;
    return config.hooks.some(
      action => action.command && action.command.includes(HOOK_MARKER)
    );
  }

  /**
   * Add a hook to the settings for a specific event type
   */
  private static addHook(
    settings: ClaudeSettings,
    eventType: string,
    matcher: string | undefined,
    command: string
  ): void {
    if (!settings.hooks) {
      settings.hooks = {};
    }

    if (!settings.hooks[eventType]) {
      settings.hooks[eventType] = [];
    }

    // Check if this exact hook already exists
    const exists = settings.hooks[eventType].some(
      config =>
        config.matcher === matcher &&
        config.hooks?.some(action => action.command === command)
    );

    if (!exists) {
      const hookConfig: HookConfig = {
        hooks: [{ type: 'command', command }],
      };
      if (matcher) {
        hookConfig.matcher = matcher;
      }
      settings.hooks[eventType].push(hookConfig);
    }
  }

  /**
   * Remove all Agent Fleet hooks from settings
   */
  private static removeOurHooks(settings: ClaudeSettings): boolean {
    if (!settings.hooks) return false;

    let removed = false;

    for (const eventType of Object.keys(settings.hooks)) {
      const configs = settings.hooks[eventType];
      if (!Array.isArray(configs)) continue;

      // Filter out our hooks, keep everything else
      const filtered = configs.filter(config => !HookInstaller.isOurHook(config));

      if (filtered.length !== configs.length) {
        removed = true;
      }

      if (filtered.length > 0) {
        settings.hooks[eventType] = filtered;
      } else {
        delete settings.hooks[eventType];
      }
    }

    // Clean up empty hooks object
    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    return removed;
  }

  /**
   * Install hooks into Claude Code settings
   */
  static install(): { success: boolean; message: string } {
    try {
      // Ensure events directory exists
      if (!fs.existsSync(EVENTS_DIR)) {
        fs.mkdirSync(EVENTS_DIR, { recursive: true });
      }

      const settings = HookInstaller.readSettings();
      const hookCommand = getHookCommand();

      // Remove any existing Agent Fleet hooks first (for clean reinstall)
      HookInstaller.removeOurHooks(settings);

      // Add our hooks using the new object format
      // matcher: "*" means match all tools/notifications
      HookInstaller.addHook(settings, 'PreToolUse', '*', hookCommand);
      HookInstaller.addHook(settings, 'PostToolUse', '*', hookCommand);
      HookInstaller.addHook(settings, 'Notification', '*', hookCommand);
      HookInstaller.addHook(settings, 'Stop', undefined, hookCommand);

      HookInstaller.writeSettings(settings);

      return {
        success: true,
        message: 'Agent Fleet hooks installed successfully. Restart Claude Code sessions for changes to take effect.',
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to install hooks: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Uninstall hooks from Claude Code settings
   */
  static uninstall(): { success: boolean; message: string } {
    try {
      if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        return {
          success: true,
          message: 'No Claude Code settings found. Nothing to uninstall.',
        };
      }

      const settings = HookInstaller.readSettings();

      if (!settings.hooks) {
        return {
          success: true,
          message: 'No hooks configured. Nothing to uninstall.',
        };
      }

      const removed = HookInstaller.removeOurHooks(settings);

      HookInstaller.writeSettings(settings);

      return {
        success: true,
        message: removed
          ? 'Agent Fleet hooks uninstalled successfully.'
          : 'Agent Fleet hooks were not installed. Nothing to uninstall.',
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to uninstall hooks: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
