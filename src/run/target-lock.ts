import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalThemePath } from "./theme-target";

export interface ThemeTargetLock {
  token: string;
  release(): void;
}

export interface ThemeTargetLockRecord {
  token: string;
  pid: number;
  mode: string;
  themePath: string;
  startedAt: string;
}

export interface ThemeTargetLockStatus {
  file: string;
  lock?: ThemeTargetLockRecord;
  /** 锁文件存在但记录无法解析：自动恢复与 doctor 都不判定其 owner，必须人工确认后删除。 */
  corrupt: boolean;
  recovery?: ThemeTargetLockRecord;
  recoveryPresent: boolean;
  active: boolean;
}

type LockRead =
  | { kind: "missing" }
  | { kind: "corrupt" }
  | { kind: "valid"; record: ThemeTargetLockRecord };

export class ThemeTargetBusyError extends Error {}

export function acquireThemeTargetLock(
  inputPath: string,
  mode: string,
  root = join(tmpdir(), "vite-plugin-shopify-theme", "locks"),
): ThemeTargetLock {
  const themePath = canonicalThemePath(inputPath);
  mkdirSync(root, { recursive: true });
  const file = lockFile(themePath, root);
  const recoveryFile = `${file}.recovery`;
  const record = lockRecord(themePath, mode);

  // 所有 contender 都先尊重 recovery guard。guard 仅覆盖数次同步 fs 操作；若 owner 在这段
  // 临界区被 SIGKILL，选择失败关闭而不是递归回收 guard（递归回收会重引入同一 TOCTOU）。
  if (existsSync(recoveryFile)) throw recoveryBusy(themePath, recoveryFile);

  try {
    publishRecord(file, record);
    return heldLock(file, record);
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
  }

  assertRecoverable(themePath, file);

  const recovery = lockRecord(themePath, "recover");
  try {
    publishRecord(recoveryFile, recovery);
  } catch (error) {
    if (isCode(error, "EEXIST")) throw recoveryBusy(themePath, recoveryFile);
    throw error;
  }

  try {
    // 取得恢复权后必须重新读取：此前的 stale 判断可能已被另一个 owner 替换。
    assertRecoverable(themePath, file);
    try {
      unlinkSync(file);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }

    try {
      publishRecord(file, record);
    } catch (error) {
      if (isCode(error, "EEXIST")) {
        const owner = readLock(file);
        if (owner.kind === "valid") throw activeRun(themePath, owner.record);
        throw new ThemeTargetBusyError(`${themePath} already has an active Theme Run`);
      }
      throw error;
    }
    return heldLock(file, record);
  } finally {
    unlinkOwned(recoveryFile, recovery.token);
  }
}

export function inspectThemeTargetLock(
  inputPath: string,
  root = join(tmpdir(), "vite-plugin-shopify-theme", "locks"),
): ThemeTargetLockStatus {
  const themePath = canonicalThemePath(inputPath);
  const file = lockFile(themePath, root);
  const current = readLock(file);
  const lock = current.kind === "valid" ? current.record : undefined;
  const recoveryFile = `${file}.recovery`;
  return {
    file,
    lock,
    corrupt: current.kind === "corrupt",
    recovery: readRecord(recoveryFile),
    recoveryPresent: existsSync(recoveryFile),
    active: Boolean(lock && processIsAlive(lock.pid)),
  };
}

// 只有「锁不存在」或「合法记录且 owner 已退出」可以进入恢复；损坏记录不猜 owner，失败关闭。
function assertRecoverable(themePath: string, file: string): void {
  const current = readLock(file);
  if (current.kind === "corrupt") throw corruptLock(themePath, file);
  if (current.kind === "valid" && processIsAlive(current.record.pid)) {
    throw activeRun(themePath, current.record);
  }
}

function lockFile(themePath: string, root: string): string {
  const name = createHash("sha256").update(themePath).digest("hex").slice(0, 24) + ".json";
  return join(root, name);
}

function lockRecord(themePath: string, mode: string): ThemeTargetLockRecord {
  return {
    token: randomUUID(),
    pid: process.pid,
    mode,
    themePath,
    startedAt: new Date().toISOString(),
  };
}

// 先把完整记录写入 token 专属的临时文件，再用 link 原子发布：目标已存在时 link 同样返回
// EEXIST，锁路径一经出现即为完整记录，不存在「已创建、未写入」的窗口。临时文件名带 token，
// 中断遗留也不会被当作锁或阻塞后续申请。
function publishRecord(file: string, record: ThemeTargetLockRecord): void {
  const temp = `${file}.${record.token}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(record, null, 2), { flag: "wx" });
    linkSync(temp, file);
  } finally {
    try {
      unlinkSync(temp);
    } catch {
      // Preserve the original publish error.
    }
  }
}

function heldLock(file: string, record: ThemeTargetLockRecord): ThemeTargetLock {
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

function readRecord(file: string): ThemeTargetLockRecord | undefined {
  const current = readLock(file);
  return current.kind === "valid" ? current.record : undefined;
}

function readLock(file: string): LockRead {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (error) {
    if (isCode(error, "ENOENT")) return { kind: "missing" };
    throw error;
  }
  try {
    const record = JSON.parse(content) as Partial<ThemeTargetLockRecord> | null;
    if (
      typeof record?.token === "string" &&
      Number.isInteger(record.pid) &&
      (record.pid as number) > 0 &&
      typeof record.mode === "string" &&
      typeof record.themePath === "string"
    ) {
      return { kind: "valid", record: record as ThemeTargetLockRecord };
    }
  } catch {
    // Fall through: unparsable content is a corrupt lock.
  }
  return { kind: "corrupt" };
}

function corruptLock(themePath: string, file: string): ThemeTargetBusyError {
  return new ThemeTargetBusyError(
    `${themePath} has an unreadable Theme Target Lock record; confirm no Theme Run is starting for this theme, then remove ${file}`,
  );
}

function activeRun(themePath: string, current: ThemeTargetLockRecord): ThemeTargetBusyError {
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
