// Aislamiento PREVENTIVO por worktree (Laboratorio C): cada tarea corre en
// su propia copia de trabajo y su propia rama, nunca en el working tree
// principal. Esto se combina con los permisos REACTIVOS de Capa 1
// (snapshot/diff/revert, src/permissions.ts) como red de seguridad
// adicional DENTRO del worktree — las dos capas trabajan juntas, ninguna
// sustituye a la otra (ver sintesis-orbit-core.md, seccion 3).

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeHandle {
  path: string;
  branch: string;
  taskName: string;
  baseRef: string;
  repoPath: string;
}

export interface IsolationStatus {
  /** Rutas absolutas de worktrees que ya existen para este repo (incluido el principal). */
  existingWorktrees: string[];
  /** Rutas con cambios sin commitear en el working tree principal. */
  dirtyPaths: string[];
}

export interface CreateWorktreeOptions {
  repoPath: string;
  /** Nombre legible de la tarea — se convierte a lowercase-with-hyphens + sufijo unico. */
  taskName: string;
  branchPrefix?: string;
  /** Punto de partida del worktree. Default: HEAD (funciona con o sin remoto configurado). */
  baseRef?: string;
  /**
   * Donde se crean los worktrees. Relativo, se resuelve junto al repo (nunca
   * dentro de el — un worktree adentro ensucia el `git status` del repo
   * principal, justo lo que el aislamiento existe para evitar). Absoluto,
   * se usa tal cual. Default: directorio hermano "<repo>.worktrees".
   */
  worktreesDir?: string;
}

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos (á->a, ñ->n via NFD+combining mark strip)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function resolveWorktreesRoot(repoPath: string, worktreesDir?: string): string {
  if (worktreesDir && isAbsolute(worktreesDir)) return worktreesDir;
  if (worktreesDir) return join(dirname(repoPath), worktreesDir);
  return join(dirname(repoPath), `${basename(repoPath)}.worktrees`);
}

function uniqueSuffix(): string {
  return randomBytes(3).toString("hex");
}

/** Scope check (Laboratorio C): mirar antes de crear, no asumir que el terreno esta limpio. */
export async function checkIsolation(repoPath: string): Promise<IsolationStatus> {
  const [worktreeOut, statusOut] = await Promise.all([
    execFileAsync("git", ["worktree", "list", "--porcelain"], { cwd: repoPath }),
    execFileAsync("git", ["status", "--porcelain"], { cwd: repoPath }),
  ]);

  const existingWorktrees = worktreeOut.stdout
    .split(/\n\n+/)
    .map((block) => /^worktree (.+)$/m.exec(block)?.[1])
    .filter((p): p is string => Boolean(p));

  const dirtyPaths = statusOut.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));

  return { existingWorktrees, dirtyPaths };
}

export async function createWorktree(opts: CreateWorktreeOptions): Promise<WorktreeHandle> {
  const taskSlug = `${slugify(opts.taskName)}-${uniqueSuffix()}`;
  const branch = `${opts.branchPrefix ?? "task"}/${taskSlug}`;
  const baseRef = opts.baseRef ?? "HEAD";
  const worktreePath = join(resolveWorktreesRoot(opts.repoPath, opts.worktreesDir), taskSlug);

  await execFileAsync("git", ["worktree", "add", worktreePath, "-b", branch, baseRef], {
    cwd: opts.repoPath,
  });

  return { path: worktreePath, branch, taskName: taskSlug, baseRef, repoPath: opts.repoPath };
}

export type RemoveOutcome = "removed" | "left-dirty";

export async function removeWorktree(
  handle: WorktreeHandle,
  opts: { force?: boolean; deleteBranch?: boolean } = {},
): Promise<RemoveOutcome> {
  const args = ["worktree", "remove", handle.path];
  if (opts.force) args.push("--force");

  try {
    await execFileAsync("git", args, { cwd: handle.repoPath });
  } catch {
    if (!opts.force) return "left-dirty";
    throw new Error(`no se pudo quitar el worktree en ${handle.path} incluso con --force`);
  }

  if (opts.deleteBranch ?? true) {
    // -D forzado: tras un merge con squash/rebase, -d se niega aunque la
    // rama ya este integrada (observado en el Laboratorio C).
    await execFileAsync("git", ["branch", "-D", handle.branch], { cwd: handle.repoPath });
  }

  return "removed";
}
