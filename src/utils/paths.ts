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

function isUnderDirectory(resolved: string, base: string): boolean {
  const rel = relative(base, resolved);
  return !rel.startsWith("..") && rel !== "" && resolve(base, rel) === resolved;
}

export function validatePath(
  filePath: string,
  cwd: string,
  allowedPaths: string[] = []
): string {
  const expanded = expandHome(filePath);
  const resolved = expanded.startsWith("/")
    ? resolve(expanded)
    : resolvePath(filePath, cwd);

  const rel = relative(cwd, resolved);
  if (!rel.startsWith("..") && resolve(cwd, rel) === resolved) {
    return resolved;
  }

  for (const allowed of allowedPaths) {
    const allowedResolved = resolve(allowed);
    if (resolved === allowedResolved || isUnderDirectory(resolved, allowedResolved)) {
      return resolved;
    }
  }

  throw new Error(
    `Path "${filePath}" resolves outside the working directory`
  );
}
