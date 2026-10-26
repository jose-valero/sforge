// "tools es una lista de capacidades, writes es la frontera". Esto no
// previene que un agente escriba fuera de lo permitido — lo DETECTA despues
// y revierte lo que pueda. Es una red de seguridad reactiva, pensada para
// combinarse con aislamiento previo (worktree/sandbox), no para sustituirlo.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ChangeStatus = "modified" | "added" | "deleted" | "untracked";

export interface ChangedPath {
  path: string;
  status: ChangeStatus;
}

export interface WorkspaceSnapshot {
  takenAt: string;
  paths: Record<string, string>;
}

export interface WorkspaceAdapter {
  snapshot(cwd: string): Promise<WorkspaceSnapshot>;
  diff(before: WorkspaceSnapshot, after: WorkspaceSnapshot): ChangedPath[];
  revert(cwd: string, path: string): Promise<"reverted" | "left-dirty">;
}

// Implementacion por defecto. Cualquier otro tipo de "workspace" (un bucket,
// una API, un sistema de archivos sin control de versiones) implementa el
// mismo WorkspaceAdapter y el resto de Capa 1 no se entera del cambio.
export const gitWorkspaceAdapter: WorkspaceAdapter = {
  async snapshot(cwd) {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    const paths: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const status = line.slice(0, 2).trim();
      const path = line.slice(3);
      paths[path] = status;
    }
    return { takenAt: new Date().toISOString(), paths };
  },

  diff(before, after) {
    const changed: ChangedPath[] = [];
    for (const [path, status] of Object.entries(after.paths)) {
      if (before.paths[path] === status) continue;
      const status_: ChangeStatus =
        status === "??" ? "untracked" : path in before.paths ? "modified" : "added";
      changed.push({ path, status: status_ });
    }
    for (const path of Object.keys(before.paths)) {
      if (!(path in after.paths)) changed.push({ path, status: "deleted" });
    }
    return changed;
  },

  async revert(cwd, path) {
    try {
      await execFileAsync("git", ["checkout", "--", path], { cwd });
      return "reverted";
    } catch {
      try {
        await execFileAsync("git", ["clean", "-f", "--", path], { cwd });
        return "reverted";
      } catch {
        return "left-dirty";
      }
    }
  },
};

export interface PermissionBreach {
  path: string;
  status: ChangeStatus;
  outcome: "reverted" | "left-dirty";
}

export async function enforceWrites(opts: {
  cwd: string;
  allow: string[]; // prefijos de ruta permitidos para este actor
  before: WorkspaceSnapshot;
  after: WorkspaceSnapshot;
  adapter?: WorkspaceAdapter;
}): Promise<PermissionBreach[]> {
  const adapter = opts.adapter ?? gitWorkspaceAdapter;
  const changed = adapter.diff(opts.before, opts.after);
  const breaches: PermissionBreach[] = [];

  for (const change of changed) {
    const isAllowed = opts.allow.some((prefix) => change.path.startsWith(prefix));
    if (isAllowed) continue;

    const wasDirtyBefore = change.path in opts.before.paths;
    if (wasDirtyBefore) {
      // Ya estaba sucio antes de que el agente corriera: no fingimos
      // arreglarlo, lo reportamos tal cual en vez de pretender que se
      // restauro algo que ya estaba perdido de antemano.
      breaches.push({ path: change.path, status: change.status, outcome: "left-dirty" });
      continue;
    }

    const outcome = await adapter.revert(opts.cwd, change.path);
    breaches.push({ path: change.path, status: change.status, outcome });
  }

  return breaches;
}
