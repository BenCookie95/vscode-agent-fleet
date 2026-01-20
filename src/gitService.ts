import * as path from 'path';
import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import { ChangedFile, GitFileStatus } from './types';

/**
 * Provides git status information for agent directories
 */
export class GitService {
  private gitInstances: Map<string, SimpleGit> = new Map();

  /**
   * Get or create a SimpleGit instance for a directory
   */
  private getGit(directory: string): SimpleGit {
    let git = this.gitInstances.get(directory);
    if (!git) {
      git = simpleGit(directory);
      this.gitInstances.set(directory, git);
    }
    return git;
  }

  /**
   * Check if a directory is a git repository
   */
  async isGitRepo(directory: string): Promise<boolean> {
    try {
      const git = this.getGit(directory);
      await git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get changed files in a directory
   */
  async getChangedFiles(directory: string): Promise<ChangedFile[]> {
    try {
      const git = this.getGit(directory);
      const status: StatusResult = await git.status();
      const changedFiles: ChangedFile[] = [];

      // Modified files
      for (const file of status.modified) {
        changedFiles.push({
          path: file,
          status: 'M',
          absolutePath: path.join(directory, file),
        });
      }

      // Added/staged files
      for (const file of status.created) {
        changedFiles.push({
          path: file,
          status: 'A',
          absolutePath: path.join(directory, file),
        });
      }

      // Deleted files
      for (const file of status.deleted) {
        changedFiles.push({
          path: file,
          status: 'D',
          absolutePath: path.join(directory, file),
        });
      }

      // Untracked files
      for (const file of status.not_added) {
        changedFiles.push({
          path: file,
          status: '?',
          absolutePath: path.join(directory, file),
        });
      }

      // Renamed files
      for (const file of status.renamed) {
        changedFiles.push({
          path: file.to,
          status: 'R',
          absolutePath: path.join(directory, file.to),
        });
      }

      // Conflicted files
      for (const file of status.conflicted) {
        changedFiles.push({
          path: file,
          status: 'U',
          absolutePath: path.join(directory, file),
        });
      }

      return changedFiles;
    } catch (error) {
      console.error(`Failed to get git status for ${directory}:`, error);
      return [];
    }
  }

  /**
   * Get the HEAD commit hash for diff comparison
   */
  async getHeadRef(directory: string): Promise<string> {
    try {
      const git = this.getGit(directory);
      const log = await git.log({ maxCount: 1 });
      return log.latest?.hash || 'HEAD';
    } catch {
      return 'HEAD';
    }
  }

  /**
   * Get file content at HEAD revision
   */
  async getFileAtHead(directory: string, filePath: string): Promise<string> {
    try {
      const git = this.getGit(directory);
      // Use git show to get file content at HEAD
      const content = await git.show([`HEAD:${filePath}`]);
      return content;
    } catch {
      // File might not exist at HEAD (new file)
      return '';
    }
  }

  /**
   * Clear cached git instance for a directory
   */
  clearCache(directory: string): void {
    this.gitInstances.delete(directory);
  }

  /**
   * Clear all cached git instances
   */
  clearAllCaches(): void {
    this.gitInstances.clear();
  }
}
