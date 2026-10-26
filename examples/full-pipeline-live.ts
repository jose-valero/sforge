// El pipeline real, encadenado: Capa 2 (worktree aislado) -> Capa 0
// (claudeCodeSubstrate, modelo real) -> Capa 1 (envelope + gates) ->
// permisos. Tarea genuina y configurable: pide tests unitarios reales para
// un modulo de Capa 1 que todavia no los tiene.
//
// GASTA CUOTA REAL y ESCRIBE UN ARCHIVO REAL — pero SIEMPRE dentro del
// worktree aislado, nunca toca `main` directamente. Este script no hace
// merge automatico: deja la rama lista para que la revises tu.
//
// Uso: tsx examples/full-pipeline-live.ts [modulo-sin-extension]
//   ej:  tsx examples/full-pipeline-live.ts envelope
//        tsx examples/full-pipeline-live.ts gate   (default)
//
// Imprime la URL del visor en vivo (src/observability/trace-server.ts) en
// cuanto se conoce el run, ANTES de la llamada lenta al modelo — abrela en
// el navegador mientras corre para ver las fases aparecer en tiempo real.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { Run } from "../src/run.js";
import { claudeCodeSubstrate } from "../src/substrates/claude-code.js";
import { defineEnvelope } from "../src/envelope.js";
import { envelopeSucceeded, filesExist, testsPass, runGates } from "../src/gate.js";
import { gitWorkspaceAdapter, enforceWrites } from "../src/permissions.js";
import { checkIsolation, createWorktree } from "../src/isolation/worktree.js";
import { startTraceViewer } from "../src/observability/trace-server.js";

const repoPath = dirname(dirname(fileURLToPath(import.meta.url))); // .../orbit-core
const MODULE = process.argv[2] ?? "gate";
const SOURCE_FILE_REL = `src/${MODULE}.ts`;
const TEST_FILE_REL = `src/${MODULE}.test.ts`;
const VIEWER_PORT = 4600;

const main = async () => {
  // --- -1. visor en vivo: arranca antes que nada, server generico ---
  startTraceViewer(VIEWER_PORT);
  console.log(`[visor] escuchando en http://localhost:${VIEWER_PORT}`);

  // --- 0. scope check: el repo principal debe estar limpio antes de empezar ---
  const scope = await checkIsolation(repoPath);
  console.log(`[scope check] worktrees activos: ${scope.existingWorktrees.length}`);
  if (scope.dirtyPaths.length > 0) {
    throw new Error(
      `el repo principal tiene cambios sin commitear (${scope.dirtyPaths.join(", ")}) — commitea o descarta antes de correr esto`,
    );
  }

  // --- 1. Capa 2: aislamiento fisico ---
  const wt = await createWorktree({ repoPath, taskName: `tests unitarios para ${MODULE}.ts` });
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

  // Imprimir la URL del visor YA, antes de la llamada lenta — con db/runId
  // conocidos, la pagina puede empezar a hacer poll aunque el archivo .db
  // todavia no exista (el server tolera esa carrera, ver trace-server.ts).
  const viewerUrl = `http://localhost:${VIEWER_PORT}/?db=${encodeURIComponent(dbPath)}&runId=${encodeURIComponent(run.id)}`;
  console.log(`\n[visor] abre esto en tu navegador AHORA para verlo en vivo:`);
  console.log(`  ${viewerUrl}\n`);

  const before = await gitWorkspaceAdapter.snapshot(wt.path);

  const envelope = await run.phase(
    {
      kind: "agent",
      owner: "builder",
      description: `escribe tests unitarios reales para ${SOURCE_FILE_REL} usando node:test nativo`,
    },
    (ph) =>
      ph.call({
        prompt: [
          `Lee el archivo ${SOURCE_FILE_REL} de este repo.`,
          `Escribe tests unitarios reales en ${TEST_FILE_REL}, usando node:test y node:assert/strict`,
          `(ya vienen con Node — no agregues dependencias nuevas, no uses tsx).`,
          `Cubre las funciones/exports publicos del modulo con casos reales de exito Y de fallo,`,
          `no solo el camino feliz.`,
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
  // .ts), que `tsx` resuelve. Se invoca el binario de tsx del repo
  // PRINCIPAL por ruta absoluta — no hace falta `npm install` por worktree.
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
  console.log(`\n(el visor sigue corriendo en http://localhost:${VIEWER_PORT} — Ctrl+C para cerrarlo)`);
};

main().catch((err) => {
  console.error("\nfallo el pipeline real:", err);
  process.exitCode = 1;
});
