// A DIFERENCIA de capa0-router.ts, este ejemplo SI gasta cuota real: invoca
// un modelo de verdad a traves de claudeCodeSubstrate. Deliberadamente
// separado de npm run example:capa0 (que es gratis y no necesita
// credenciales) para que nunca corra sin que alguien lo pida a proposito.
// Usa haiku y un prompt minimo para mantener el costo bajo.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { Run } from "../src/run.js";
import { claudeCodeSubstrate } from "../src/substrates/claude-code.js";
import { defineEnvelope } from "../src/envelope.js";
import { envelopeSucceeded } from "../src/gate.js";

const cwd = mkdtempSync(join(tmpdir(), "orbit-core-capa0-live-"));
const dbPath = join(cwd, "trace.db");

const schema = defineEnvelope({ note: z.string().min(1) });

const substrate = claudeCodeSubstrate({
  cwd,
  model: "haiku",
  maxBudgetUsd: 0.5, // tope de seguridad, no deberia ni acercarse con este prompt
});

const run = new Run({ substrate, traceDbPath: dbPath });

const main = async () => {
  const envelope = await run.phase(
    { kind: "agent", owner: "verificador", description: "prueba en vivo del adaptador real de Capa 0" },
    (ph) =>
      ph.call({
        prompt:
          'Responde UNICAMENTE con este JSON exacto, sin texto antes ni despues: ' +
          '{"status":"success","summary":"verificacion en vivo","note":"capa-0-funciona"}',
        schema,
        gates: [envelopeSucceeded],
      }),
  );

  console.log(`envelope recibido: ${JSON.stringify(envelope)}`);
  if (envelope.note !== "capa-0-funciona") {
    throw new Error(`el modelo no siguio el formato exacto pedido (note="${envelope.note}")`);
  }

  const { Trace } = await import("../src/trace.js");
  const trace = new Trace(dbPath);
  const events = trace.since(run.id, 0);
  const usageEvent = events.find((e) => e.kind === "usage");
  trace.close();

  console.log(`\neventos de traza: ${events.length}`);
  if (usageEvent) {
    console.log(`costo real registrado en la traza: ${usageEvent.payload}`);
  } else {
    console.log("ADVERTENCIA: no se registro ningun evento de 'usage' en la traza");
  }

  run.finish(true, "verificacion en vivo de Capa 0 completada");
  console.log("\nCapa 0 verificada de punta a punta contra un modelo real.");
};

main().catch((err) => {
  console.error("fallo la verificacion en vivo de Capa 0:", err);
  process.exitCode = 1;
});
