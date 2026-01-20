import * as vscode from 'vscode';
import { GitService } from './gitService';

/** URI scheme for git HEAD content */
export const GIT_HEAD_SCHEME = 'agent-fleet-git';

/**
 * Provides git HEAD file content for diff comparison
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private gitService: GitService;

  constructor(gitService: GitService) {
    this.gitService = gitService;
  }

  /**
   * Provide text content for a git HEAD URI
   * URI format: agent-fleet-git:/path/to/file?directory=/repo/root
   */
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // Parse the directory from query string
    const params = new URLSearchParams(uri.query);
    const directory = params.get('directory');

    if (!directory) {
      return '';
    }

    // The path is the relative file path
    const filePath = uri.path;

    try {
      return await this.gitService.getFileAtHead(directory, filePath);
    } catch {
      return '';
    }
  }
}

/**
 * Create a URI for the HEAD version of a file
 */
export function createGitHeadUri(directory: string, relativePath: string): vscode.Uri {
  return vscode.Uri.parse(`${GIT_HEAD_SCHEME}:${relativePath}?directory=${encodeURIComponent(directory)}`);
}
