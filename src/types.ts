/**
 * Agent status reflecting the current state of an AI coding CLI session
 */
export type AgentStatus = 'idle' | 'running' | 'stuck' | 'complete';

/**
 * Represents a single AI coding agent (CLI session)
 */
export interface Agent {
  /** Unique identifier for this agent */
  id: string;
  /** Display name (usually directory name) */
  name: string;
  /** Absolute path to the agent's working directory */
  directory: string;
  /** Timestamp when the agent was created */
  createdAt: number;
}

/**
 * Stored agent data (persisted to globalState)
 * Status is transient and derived from hooks/terminals
 */
export interface StoredAgent {
  id: string;
  name: string;
  directory: string;
  createdAt: number;
}

/**
 * Runtime agent state (includes transient status)
 */
export interface AgentState extends Agent {
  status: AgentStatus;
}

/**
 * Hook event types from Claude Code CLI
 */
export type HookEventType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'Notification'
  | 'Stop'
  | 'SessionStart'
  | 'SessionEnd';

/**
 * Notification subtypes
 */
export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'user_cancelled_tool_use'
  | 'message';

/**
 * Hook event written by Claude to stdin (JSON format)
 * Field names use snake_case as provided by Claude
 */
export interface HookEvent {
  /** Session ID from Claude Code */
  session_id: string;
  /** Working directory where the CLI is running */
  cwd: string;
  /** Event type (PreToolUse, PostToolUse, Notification, Stop, etc.) */
  hook_event_name: HookEventType;
  /** For Notification events */
  notification_type?: NotificationType;
  /** Tool name for PreToolUse/PostToolUse */
  tool_name?: string;
  /** Message content */
  message?: string;
  /** Reason for the event */
  reason?: string;
}

/**
 * Git file status from `git status --porcelain`
 */
export type GitFileStatus = 'M' | 'A' | 'D' | '?' | 'R' | 'C' | 'U';

/**
 * Changed file information from git
 */
export interface ChangedFile {
  /** Relative path to the file */
  path: string;
  /** Git status code */
  status: GitFileStatus;
  /** Absolute path to the file */
  absolutePath: string;
}
