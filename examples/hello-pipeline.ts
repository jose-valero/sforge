// Ejemplo de punta a punta de Capa 1, SIN tocar ningun modelo real:
//   human -> agent (con un fallo de JSON deliberado, para probar el
//   reprompt) -> code (gate de "tests") -> chequeo de permisos (con una
//   escritura fuera de lo permitido, para probar deteccion + revert) -> finish.
//
// El "proyecto que se orquesta" es un repo git desechable en /tmp — nunca el
// propio orbit-core ni el directorio del usuario. Nada de esto hace commit
// ni toca git en "shadow fiend".

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";

import { Run } from "../src/run.js";
import { echoSubstrate } from "../src/substrate.js";
import { defineEnvelope } from "../src/envelope.js";
import { envelopeSucceeded, testsPass, runGates } from "../src/gate.js";
import { gitWorkspaceAdapter, enforceWrites } from "../src/permissions.js";
import { Trace } from "../src/trace.js";

// --- 0. sandbox desechable para demostrar permisos sin tocar nada real ---
const sandbox = mkdtempSync(join(tmpdir(), "orbit-core-demo-"));
execFileSync("git", ["init", "-q"], { cwd: sandbox });
execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "init"], { cwd: sandbox });
mkdirSync(join(sandbox, "allowed"), { recursive: true });
console.log(`sandbox de demo: ${sandbox}`);

// --- 1. sustrato de eco: devuelve JSON roto la primera vez, valido despues ---
let agentCalls = 0;
const planSchema = defineEnvelope({ plan: z.string().min(1) });

const substrate = echoSubstrate((prompt) => {
  agentCalls += 1;
  if (agentCalls === 1) return "esto no es JSON {{{";
  return JSON.stringify({
    status: "success",
    summary: "plan generado",
    plan: "escribir allowed/output.txt y dejar en paz lo demas",
  });
});

const traceDbPath = join(sandbox, "trace.db");
const run = new Run({ substrate, traceDbPath });

const main = async () => {
  // --- fase humana: solo registra la intencion, no ejecuta nada ---
  await run.phase(
    { kind: "human", owner: "jose", description: "pide un plan corto y lo aplica en el sandbox" },
    async (ph) => {
      ph.log("intent", { task: "demo end-to-end de Capa 1" });
    },
  );

  // --- fase agent: prueba el loop de autocorreccion de verdad ---
  const planEnvelope = await run.phase(
    { kind: "agent", owner: "planner", description: "redacta un plan corto en formato JSON" },
    async (ph) =>
      ph.call({
        prompt: "Devuelve {status, summary, plan} en JSON.",
        schema: planSchema,
        gates: [envelopeSucceeded],
      }),
  );
  console.log(`plan (tras ${agentCalls} llamadas al sustrato): "${planEnvelope.plan}"`);

  // --- snapshot ANTES de que nada escriba ---
  const before = await gitWorkspaceAdapter.snapshot(sandbox);

  // --- fase code: aplica el plan (y "sin querer" toca algo fuera de lo permitido) ---
  await run.phase(
    { kind: "code", owner: "apply-plan", description: "escribe el output del plan en disco" },
    async (ph) => {
      writeFileSync(join(sandbox, "allowed", "output.txt"), planEnvelope.plan);
      writeFileSync(join(sandbox, "oops.txt"), "esto no deberia haberse escrito aqui");
      ph.log("files_written", ["allowed/output.txt", "oops.txt"]);
    },
  );

  // --- gate de codigo: una suite de "tests" real (exit code, no grep de stdout) ---
  const testGate = testsPass(["node", "-e", "process.exit(0)"]);
  const [testReport] = await runGates(undefined, [testGate]);
  console.log(`gate tests_pass -> passed=${testReport!.passed}`);

  // --- permisos: snapshot DESPUES + enforce ---
  const after = await gitWorkspaceAdapter.snapshot(sandbox);
  const breaches = await enforceWrites({
    cwd: sandbox,
    allow: ["allowed/"],
    before,
    after,
  });

  console.log(`brechas de permisos detectadas: ${breaches.length}`);
  for (const b of breaches) console.log(`  - ${b.path} (${b.status}) -> ${b.outcome}`);

  const oopsStillThere = existsSync(join(sandbox, "oops.txt"));
  const allowedStillThere = existsSync(join(sandbox, "allowed", "output.txt"));
  console.log(`oops.txt revertido correctamente: ${!oopsStillThere}`);
  console.log(`allowed/output.txt se conservo: ${allowedStillThere}`);

  const result = run.finish(true, "demo de Capa 1 completada de punta a punta");
  console.log("\nrun.finish() ->", result);
};

main()
  .then(() => {
    // --- prueba de que el trazado realmente quedo grabado (un solo camino) ---
    const trace = new Trace(traceDbPath);
    const events = trace.since(run.id, 0);
    trace.close();
    console.log(`\neventos grabados en trace.db: ${events.length}`);
    for (const e of events) console.log(`  [${e.id}] ${e.kind}`);
    writeFileSync(join(sandbox, "events.json"), JSON.stringify(events, null, 2));
    console.log(`\ntrace completa: ${join(sandbox, "events.json")}`);
  })
  .catch((err) => {
    console.error("fallo el pipeline de ejemplo:", err);
    process.exitCode = 1;
  });
