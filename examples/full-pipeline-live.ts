// El pipeline real, encadenado: Capa 2 (worktree aislado) -> Capa 0
// (claudeCodeSubstrate, modelo real) -> Capa 1 (envelope + gates) ->
// permisos. Tarea genuina, no sintetica: orbit-core no tiene tests
// unitarios para src/gate.ts todavia — se lo pedimos de verdad al modelo,
// y el gate final corre esos tests de verdad (node --experimental-strip-types
// --test, sin tsx ni node_modules: el worktree es un checkout limpio).
//
// GASTA CUOTA REAL y ESCRIBE UN ARCHIVO REAL — pero SIEMPRE dentro del
// worktree aislado, nunca toca `main` directamente. Este script no hace
// merge automatico: deja la rama lista para que la revises tu.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { Run } from "../src/run.js";
import { claudeCodeSubstrate } from "../src/substrates/claude-code.js";
import { defineEnvelope } from "../src/envelope.js";
import { envelopeSucceeded, filesExist, testsPass, runGates } from "../src/gate.js";
import { gitWorkspaceAdapter, enforceWrites } from "../src/permissions.js";
import { checkIsolation, createWorktree } from "../src/isolation/worktree.js";

const repoPath = dirname(dirname(fileURLToPath(import.meta.url))); // .../orbit-core
const TEST_FILE_REL = "src/gate.test.ts";

const main = async () => {
  // --- 0. scope check: el repo principal debe estar limpio antes de empezar ---
  const scope = await checkIsolation(repoPath);
  console.log(`[scope check] worktrees activos: ${scope.existingWorktrees.length}`);
  if (scope.dirtyPaths.length > 0) {
    throw new Error(
      `el repo principal tiene cambios sin commitear (${scope.dirtyPaths.join(", ")}) — commitea o descarta antes de correr esto`,
    );
  }

  // --- 1. Capa 2: aislamiento fisico ---
  const wt = await createWorktree({ repoPath, taskName: "tests unitarios para gate.ts" });
  console.log(`\n[worktree] ${wt.path}`);
  console.log(`[worktree] rama: ${wt.branch}`);

  // --- 2. Capa 0 + Capa 1: pedirle al modelo real que escriba los tests ---
  const substrate = claudeCodeSubstrate({
    cwd: wt.path,
    model: "sonnet",
    permissionMode: "acceptEdits",
    allowedTools: ["Read", "Write", "Edit"],
    maxBudgetUsd: 2,
  });

  const dbPath = join(wt.path, "trace.db");
  const run = new Run({ substrate, traceDbPath: dbPath });
  const schema = defineEnvelope({ filesWritten: z.array(z.string()) });

  const before = await gitWorkspaceAdapter.snapshot(wt.path);

  const envelope = await run.phase(
    {
      kind: "agent",
      owner: "builder",
      description: "escribe tests unitarios reales para src/gate.ts usando node:test nativo",
    },
    (ph) =>
      ph.call({
        prompt: [
          `Lee el archivo src/gate.ts de este repo.`,
          `Escribe tests unitarios reales en ${TEST_FILE_REL}, usando node:test y node:assert/strict`,
          `(ya vienen con Node — no agregues dependencias nuevas, no uses tsx).`,
          `Cubre envelopeSucceeded, filesExist, filesNonEmpty, testsPass y runGates,`,
          `incluyendo al menos un caso donde el gate falla de verdad (no solo el camino feliz).`,
          `Cuando termines de escribir el archivo, responde UNICAMENTE con este JSON`,
          `(sin texto antes ni despues, sin bloque de codigo markdown):`,
          `{"status":"success","summary":"<resumen corto>","filesWritten":["${TEST_FILE_REL}"]}`,
        ].join(" "),
        schema,
        gates: [envelopeSucceeded, filesExist([join(wt.path, TEST_FILE_REL)])],
      }),
  );

  console.log(`\n[builder] ${envelope.summary}`);
  console.log(`[builder] archivos declarados: ${envelope.filesWritten.join(", ")}`);

  // --- 3. gate real: correr los tests que el agente escribio, de verdad ---
  // El worktree es un checkout limpio sin node_modules propio; el test file
  // sigue la convencion del repo (imports con extension .js sobre fuentes
  // .ts), que `tsx` resuelve pero el `--experimental-strip-types` nativo de
  // Node no. Se invoca el binario de tsx del repo PRINCIPAL por ruta
  // absoluta — no hace falta `npm install` dentro de cada worktree.
  const tsxBin = join(repoPath, "node_modules", ".bin", "tsx");
  const [testGate] = await runGates(undefined, [
    testsPass([tsxBin, "--test", TEST_FILE_REL], { cwd: wt.path }),
  ]);
  console.log(`\n[gate] tsx --test ${TEST_FILE_REL} -> passed=${testGate!.passed}`);
  if (!testGate!.passed) {
    throw new Error("los tests que escribio el agente NO pasan — el pipeline rechaza el resultado");
  }

  // --- 4. permisos: confirmar que solo toco el archivo esperado ---
  const after = await gitWorkspaceAdapter.snapshot(wt.path);
  const breaches = await enforceWrites({ cwd: wt.path, allow: [TEST_FILE_REL], before, after });
  console.log(`\n[permisos] brechas fuera de lo permitido: ${breaches.length}`);
  for (const b of breaches) console.log(`  - ${b.path} (${b.status}) -> ${b.outcome}`);

  run.finish(true, "pipeline real completado: tests escritos y pasando, dentro de worktree aislado");

  console.log(`\n--- listo ---`);
  console.log(`worktree: ${wt.path}`);
  console.log(`rama: ${wt.branch}`);
  console.log(`este script NO hace merge automatico — revisa y mergea a mano si te convence.`);
};

main().catch((err) => {
  console.error("\nfallo el pipeline real:", err);
  process.exitCode = 1;
});
