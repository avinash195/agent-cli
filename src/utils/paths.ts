import { resolve, relative } from "path";
import { homedir } from "os";

export function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return filePath.replace("~", homedir());
  }
  return filePath;
}

export function resolvePath(filePath: string, cwd: string): string {
  const expanded = expandHome(filePath);
  return resolve(cwd, expanded);
}

export function validatePath(filePath: string, cwd: string): string {
  const resolved = resolvePath(filePath, cwd);
  const rel = relative(cwd, resolved);

  if (rel.startsWith("..") || resolve(cwd, rel) !== resolved) {
    throw new Error(
      `Path "${filePath}" resolves outside the working directory`
    );
  }

  return resolved;
}
