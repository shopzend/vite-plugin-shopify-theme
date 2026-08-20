import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export function assertDevBranch(repoPath: string, branches: string[]): void {
  const branch = currentBranch(repoPath);
  if (!branches.some((prefix) => branch.startsWith(prefix))) {
    throw new Error(
      `[shopify-theme] dev branch check failed: current "${branch}", need ${branches.join(" | ")}`,
    );
  }
}

export function currentBranch(repoPath: string): string {
  const head = readFileSync(join(gitDir(repoPath), "HEAD"), "utf8").trim();
  const refPrefix = "ref: refs/heads/";
  if (!head.startsWith(refPrefix)) {
    throw new Error(`[shopify-theme] dev branch check failed: not on a branch at ${repoPath}`);
  }
  return head.slice(refPrefix.length);
}

export function gitDir(repoPath: string): string {
  const dotGit = join(repoPath, ".git");
  let isDirectory: boolean;
  try {
    isDirectory = statSync(dotGit).isDirectory();
  } catch {
    throw new Error(`[shopify-theme] dev branch check failed: no git repo at ${repoPath}`);
  }
  if (isDirectory) return dotGit;

  const prefix = "gitdir: ";
  const content = readFileSync(dotGit, "utf8").trim();
  if (!content.startsWith(prefix)) {
    throw new Error(`[shopify-theme] dev branch check failed: malformed .git file at ${repoPath}`);
  }
  return resolve(repoPath, content.slice(prefix.length));
}
