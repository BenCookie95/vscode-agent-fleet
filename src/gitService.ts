import * as path from 'path';
import * as fs from 'fs';
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
     * Find all git repository roots within a directory.
     * If the directory itself is a git repo, returns just that.
     * Otherwise, scans immediate subdirectories for git repos (worktree support).
     */
    async findGitRoots(directory: string): Promise<string[]> {
        // First check if the directory itself is a git repo
        if (await this.isGitRepo(directory)) {
            return [directory];
        }

        // Scan subdirectories for git repos
        const gitRoots: string[] = [];
        try {
            const entries = await fs.promises.readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const subDir = path.join(directory, entry.name);
                    if (await this.isGitRepo(subDir)) {
                        gitRoots.push(subDir);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to scan directory ${directory}:`, error);
        }

        return gitRoots;
    }

    /**
     * Get changed files in a directory (supports worktrees with multiple nested git repos)
     */
    async getChangedFiles(directory: string): Promise<ChangedFile[]> {
        const gitRoots = await this.findGitRoots(directory);
        const allChangedFiles: ChangedFile[] = [];

        for (const gitRoot of gitRoots) {
            try {
                const git = this.getGit(gitRoot);
                const status: StatusResult = await git.status();

                // Calculate prefix for files from nested repos
                const isNested = gitRoot !== directory;
                const prefix = isNested ? path.relative(directory, gitRoot) : '';

                const addFile = (file: string, fileStatus: GitFileStatus) => {
                    const displayPath = prefix ? path.join(prefix, file) : file;
                    allChangedFiles.push({
                        path: displayPath,
                        status: fileStatus,
                        absolutePath: path.join(gitRoot, file),
                        gitRoot: gitRoot,
                    });
                };

                // Modified files
                for (const file of status.modified) {
                    addFile(file, 'M');
                }

                // Added/staged files
                for (const file of status.created) {
                    addFile(file, 'A');
                }

                // Deleted files
                for (const file of status.deleted) {
                    addFile(file, 'D');
                }

                // Untracked files
                for (const file of status.not_added) {
                    addFile(file, '?');
                }

                // Renamed files
                for (const file of status.renamed) {
                    addFile(file.to, 'R');
                }

                // Conflicted files
                for (const file of status.conflicted) {
                    addFile(file, 'U');
                }
            } catch (error) {
                console.error(`Failed to get git status for ${gitRoot}:`, error);
            }
        }

        return allChangedFiles;
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
