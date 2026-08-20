import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalThemePath } from "./theme-target";

export interface ThemeTargetLock {
  token: string;
  release(): void;
}

interface LockRecord {
  token: string;
  pid: number;
  mode: string;
  themePath: string;
  startedAt: string;
}

export class ThemeTargetBusyError extends Error {}

export function acquireThemeTargetLock(
  inputPath: string,
  mode: string,
  root = join(tmpdir(), "vite-plugin-shopify-theme", "locks"),
): ThemeTargetLock {
  const themePath = canonicalThemePath(inputPath);
  mkdirSync(root, { recursive: true });
  const name = createHash("sha256").update(themePath).digest("hex").slice(0, 24) + ".json";
  const file = join(root, name);
  const recoveryFile = `${file}.recovery`;
  const record = lockRecord(themePath, mode);

  // 所有 contender 都先尊重 recovery guard。guard 仅覆盖数次同步 fs 操作；若 owner 在这段
  // 临界区被 SIGKILL，选择失败关闭而不是递归回收 guard（递归回收会重引入同一 TOCTOU）。
  if (existsSync(recoveryFile)) throw recoveryBusy(themePath, recoveryFile);

  try {
    createOwnedFile(file, record);
    return heldLock(file, record);
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
  }

  const current = readRecord(file);
  if (current && processIsAlive(current.pid)) throw activeRun(themePath, current);

  const recovery = lockRecord(themePath, "recover");
  try {
    createOwnedFile(recoveryFile, recovery);
  } catch (error) {
    if (isCode(error, "EEXIST")) throw recoveryBusy(themePath, recoveryFile);
    throw error;
  }

  try {
    // 取得恢复权后必须重新读取：此前的 stale 判断可能已被另一个 owner 替换。
    const latest = readRecord(file);
    if (latest && processIsAlive(latest.pid)) throw activeRun(themePath, latest);
    try {
      unlinkSync(file);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }

    try {
      createOwnedFile(file, record);
    } catch (error) {
      if (isCode(error, "EEXIST")) {
        const owner = readRecord(file);
        if (owner) throw activeRun(themePath, owner);
        throw new ThemeTargetBusyError(`${themePath} already has an active Theme Run`);
      }
      throw error;
    }
    return heldLock(file, record);
  } finally {
    unlinkOwned(recoveryFile, recovery.token);
  }
}

function lockRecord(themePath: string, mode: string): LockRecord {
  return {
    token: randomUUID(),
    pid: process.pid,
    mode,
    themePath,
    startedAt: new Date().toISOString(),
  };
}

function createOwnedFile(file: string, record: LockRecord): void {
  const fd = openSync(file, "wx");
  try {
    writeFileSync(fd, JSON.stringify(record, null, 2));
  } catch (error) {
    try {
      unlinkSync(file);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  } finally {
    closeSync(fd);
  }
}

function heldLock(file: string, record: LockRecord): ThemeTargetLock {
  return {
    token: record.token,
    release() {
      unlinkOwned(file, record.token);
    },
  };
}

function unlinkOwned(file: string, token: string): void {
  try {
    const current = readRecord(file);
    if (current?.token === token) unlinkSync(file);
  } catch {
    // The file was already removed or replaced; never delete another owner's lock.
  }
}

function readRecord(file: string): LockRecord | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as LockRecord;
  } catch {
    return undefined;
  }
}

function activeRun(themePath: string, current: LockRecord): ThemeTargetBusyError {
  return new ThemeTargetBusyError(
    `${themePath} already has an active Theme Run (${current.mode}, pid ${current.pid})`,
  );
}

function recoveryBusy(themePath: string, recoveryFile: string): ThemeTargetBusyError {
  const recovery = readRecord(recoveryFile);
  const owner = recovery ? ` (pid ${recovery.pid})` : "";
  return new ThemeTargetBusyError(
    `${themePath} has a Theme Target Lock recovery in progress${owner}; if that process no longer exists, remove ${recoveryFile}`,
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM");
  }
}

function isCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}
