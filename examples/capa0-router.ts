// Prueba de punta a punta de Capa 0 SIN credenciales reales: el adaptador
// real (claudeCodeSubstrate) esta escrito y typecheckea, pero no se puede
// correr en esta sesion porque el CLI de `claude` no tiene login propio en
// esta maquina (verificado con `claude doctor`). Lo que SI se prueba aqui,
// de verdad, es el mecanismo que no depende de eso: enrutamiento
// declarativo, fallback automatico cuando un sustrato falla, y el paquete
// de traspaso construido desde una traza real.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { Run } from "../src/run.js";
import { echoSubstrate } from "../src/substrate.js";
import { substrateRouter, RoutingError } from "../src/substrates/router.js";
import { buildHandoff, handoffPrompt } from "../src/substrates/handoff.js";
import { defineEnvelope } from "../src/envelope.js";

const schema = defineEnvelope({ note: z.string() });
const dbPath = join(mkdtempSync(join(tmpdir(), "sforge-capa0-")), "trace.db");

// --- 1. un sustrato "primario" que SIEMPRE falla, y uno de respaldo que funciona ---
const primary = echoSubstrate(() => {
  throw new Error("sustrato primario caido (simulado)");
});
const backup = echoSubstrate(() =>
  JSON.stringify({ status: "success", summary: "respondido por el backup", note: "ok" }),
);

const router = substrateRouter({
  substrates: { primary, backup },
  rules: [{ substrate: "primary" }], // una sola regla: todo va a "primary"
  fallback: ["backup"],
});

const run1 = new Run({ substrate: router, traceDbPath: dbPath, id: "run_fallback_demo" });

const demo1 = async () => {
  const result = await run1.phase(
    { kind: "agent", owner: "planner", description: "prueba que el router cae al backup si falla" },
    (ph) => ph.call({ prompt: "x", schema }),
  );
  console.log(`[fallback] respuesta via router: "${result.note}" (${result.summary})`);
  run1.finish(true, "demo de fallback completada");
};

// --- 2. enrutamiento declarativo por rol: dos owners distintos, dos sustratos distintos ---
const forPlanner = echoSubstrate(() =>
  JSON.stringify({ status: "success", summary: "plan", note: "vengo-del-sustrato-de-planner" }),
);
const forReviewer = echoSubstrate(() =>
  JSON.stringify({ status: "success", summary: "review", note: "vengo-del-sustrato-de-reviewer" }),
);

const routerByRole = substrateRouter({
  substrates: { forPlanner, forReviewer },
  rules: [
    { when: (r) => r.owner === "planner", substrate: "forPlanner" },
    { when: (r) => r.owner === "reviewer", substrate: "forReviewer" },
  ],
});

const run2 = new Run({ substrate: routerByRole, traceDbPath: dbPath, id: "run_routing_demo" });

const demo2 = async () => {
  const planResult = await run2.phase(
    { kind: "agent", owner: "planner", description: "debe enrutarse al sustrato de planner" },
    (ph) => ph.call({ prompt: "x", schema }),
  );
  const reviewResult = await run2.phase(
    { kind: "agent", owner: "reviewer", description: "debe enrutarse al sustrato de reviewer" },
    (ph) => ph.call({ prompt: "x", schema }),
  );
  console.log(`[routing] planner -> "${planResult.note}"`);
  console.log(`[routing] reviewer -> "${reviewResult.note}"`);
  if (planResult.note === reviewResult.note) {
    throw new Error("el enrutamiento por rol NO funciono: ambos llegaron al mismo sustrato");
  }
  run2.finish(true, "demo de enrutamiento por rol completada");
};

// --- 3. router sin fallback: debe fallar limpio con RoutingError, no colgarse ---
const demo3 = async () => {
  const routerSinFallback = substrateRouter({
    substrates: { primary },
    rules: [{ substrate: "primary" }],
  });
  const run3 = new Run({ substrate: routerSinFallback, traceDbPath: dbPath, id: "run_no_fallback_demo" });
  try {
    await run3.phase({ kind: "agent", owner: "x", description: "debe fallar, no hay fallback configurado" }, (ph) =>
      ph.call({ prompt: "x", schema }),
    );
    throw new Error("ERROR: deberia haber lanzado RoutingError");
  } catch (err) {
    if (!(err instanceof RoutingError)) {
      run3.finish(false, "fallo de forma inesperada");
      throw err;
    }
    console.log(`[sin fallback] fallo limpio como se esperaba: ${err.message}`);
    run3.finish(false, "demo de fallo sin fallback completada (comportamiento esperado)");
  }
};

// --- 4. paquete de traspaso, construido desde la traza real del run 1 ---
const demo4 = async () => {
  const { Trace } = await import("../src/trace.js");
  const trace = new Trace(dbPath);
  const pkg = buildHandoff({
    runId: "run_fallback_demo",
    fromSubstrate: "primary",
    toSubstrate: "otro-proveedor",
    trace,
    originSessionId: "sesion-de-ejemplo",
  });
  trace.close();
  console.log("\n[handoff] paquete construido desde la traza real:");
  console.log(JSON.stringify(pkg, null, 2));
  console.log("\n[handoff] prompt listo para sembrar al sustrato que retoma:");
  console.log(handoffPrompt(pkg));
};

const main = async () => {
  await demo1();
  await demo2();
  await demo3();
  await demo4();
  console.log("\ntodas las pruebas de Capa 0 (sin credenciales) pasaron.");
};

main().catch((err) => {
  console.error("fallo la demo de Capa 0:", err);
  process.exitCode = 1;
});
