import { sep } from "node:path";

export interface ReloadScope {
  themeDir: string;
  vitifyDir: string;
  extraDirs: string[];
  snippet: string;
}

export function shouldReload(file: string, scope: ReloadScope): boolean {
  const inTheme = file.startsWith(scope.themeDir + sep) && !file.startsWith(scope.vitifyDir + sep);
  const inExtra = scope.extraDirs.some((directory) => file.startsWith(directory + sep));
  if (!inTheme && !inExtra) return false;
  return !file.endsWith(`${sep}${scope.snippet}`);
}
