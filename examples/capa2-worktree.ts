// Prueba de punta a punta de Capa 2: aislamiento FISICO por worktree
// (Laboratorio C) combinado con los permisos REACTIVOS de Capa 1 ya
// construidos (snapshot/diff/revert) operando DENTRO del worktree — las
// dos capas de seguridad juntas, tal como quedo en sintesis-orbit-core.md
// seccion 3. Corre contra un repo desechable en /tmp; nunca toca este repo.

import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { checkIsolation, createWorktree, removeWorktree } from "../src/isolation/worktree.js";
import { gitWorkspaceAdapter, enforceWrites } from "../src/permissions.js";

const repoPath = mkdtempSync(join(tmpdir(), "orbit-core-capa2-"));
execFileSync("git", ["init", "-q"], { cwd: repoPath });
execFileSync("git", ["config", "user.email", "demo@example.com"], { cwd: repoPath });
execFileSync("git", ["config", "user.name", "demo"], { cwd: repoPath });
writeFileSync(join(repoPath, "README.md"), "repo de demo\n");
execFileSync("git", ["add", "."], { cwd: repoPath });
execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repoPath });
console.log(`repo de demo: ${repoPath}`);

const main = async () => {
  // --- 1. scope check antes de crear nada (Laboratorio C) ---
  const before = await checkIsolation(repoPath);
  console.log(`\n[scope check] worktrees existentes: ${before.existingWorktrees.length}`);
  console.log(`[scope check] rutas sucias en el repo principal: ${before.dirtyPaths.length}`);

  // --- 2. crear el worktree aislado para la tarea ---
  const wt = await createWorktree({ repoPath, taskName: "Añadir Soporte de Facturación" });
  console.log(`\n[worktree] creado en: ${wt.path}`);
  console.log(`[worktree] rama: ${wt.branch}`);

  if (!existsSync(wt.path)) throw new Error("ERROR: el worktree no se creo en disco");

  const currentBranch = execFileSync("git", ["branch", "--show-current"], { cwd: wt.path })
    .toString()
    .trim();
  if (currentBranch !== wt.branch) {
    throw new Error(`ERROR: la rama activa en el worktree es "${currentBranch}", se esperaba "${wt.branch}"`);
  }
  console.log(`[worktree] confirmado: dentro del worktree, la rama activa es "${currentBranch}"`);

  // --- 3. trabajo "del agente" dentro del worktree: snapshot/diff/enforce de Capa 1 ---
  const snapshotBefore = await gitWorkspaceAdapter.snapshot(wt.path);
  execFileSync("mkdir", ["-p", join(wt.path, "allowed")]);
  writeFileSync(join(wt.path, "allowed", "invoice.ts"), "// modulo de facturacion\n");
  writeFileSync(join(wt.path, "debug-scratch.log"), "notas sueltas que no debieron commitearse\n");

  const snapshotAfter = await gitWorkspaceAdapter.snapshot(wt.path);
  const breaches = await enforceWrites({
    cwd: wt.path,
    allow: ["allowed/"],
    before: snapshotBefore,
    after: snapshotAfter,
  });
  console.log(`\n[permisos dentro del worktree] brechas detectadas: ${breaches.length}`);
  for (const b of breaches) console.log(`  - ${b.path} (${b.status}) -> ${b.outcome}`);

  if (!existsSync(join(wt.path, "allowed", "invoice.ts"))) {
    throw new Error("ERROR: el archivo permitido no deberia haberse tocado");
  }
  if (existsSync(join(wt.path, "debug-scratch.log"))) {
    throw new Error("ERROR: el archivo fuera de lo permitido deberia haberse revertido");
  }
  console.log("[permisos dentro del worktree] confirmado: lo permitido se conservo, lo demas se revirtio");

  // --- 4. aislamiento real: el repo principal nunca se ensucio ---
  const mainRepoStatus = execFileSync("git", ["status", "--porcelain"], { cwd: repoPath }).toString();
  if (mainRepoStatus.trim().length > 0) {
    throw new Error(`ERROR: el repo principal tiene cambios — el aislamiento fallo:\n${mainRepoStatus}`);
  }
  console.log("\n[aislamiento] confirmado: el repo principal sigue limpio, todo el trabajo quedo en el worktree");

  // --- 5. scope check vuelve a mostrar el worktree activo ---
  const mid = await checkIsolation(repoPath);
  console.log(`\n[scope check] worktrees activos ahora: ${mid.existingWorktrees.length}`);

  // --- 6. limpieza post-"merge" ---
  const outcome = await removeWorktree(wt, { force: true });
  console.log(`\n[limpieza] worktree removido: ${outcome}`);
  if (existsSync(wt.path)) throw new Error("ERROR: el directorio del worktree deberia haber desaparecido");

  console.log("\ntodas las pruebas de Capa 2 (aislamiento + permisos juntos) pasaron.");
};

main().catch((err) => {
  console.error("fallo la demo de Capa 2:", err);
  process.exitCode = 1;
});
