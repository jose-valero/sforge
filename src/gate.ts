// Un gate verifica una AFIRMACION despues de que algo ya paso, nunca predice.
// Capa 1 no distingue "gate de calidad" de "gate de riesgo" — esa es una
// decision de Capa 2 (que gates se registran, y en que fase). Aqui solo
// vive el mecanismo: una funcion (envelope) => GateReport.

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";
import type { GateReport } from "./types.js";

const execFileAsync = promisify(execFile);

export type Gate<E = unknown> = (envelope: E) => GateReport | Promise<GateReport>;

export const envelopeSucceeded: Gate<{ status: string }> = (envelope) => ({
  gate: "envelope_status",
  passed: envelope.status === "success",
  checks: [{ item: "status", ok: envelope.status === "success", note: envelope.status }],
});

export function filesExist(paths: string[]): Gate {
  return () => {
    const checks = paths.map((p) => ({ item: p, ok: existsSync(p) }));
    return { gate: "files_exist", passed: checks.every((c) => c.ok), checks };
  };
}

export function filesNonEmpty(paths: string[]): Gate {
  return () => {
    const checks = paths.map((p) => {
      const ok = existsSync(p) && statSync(p).size > 0;
      return { item: p, ok, note: ok ? undefined : "no existe o esta vacio" };
    });
    return { gate: "files_non_empty", passed: checks.every((c) => c.ok), checks };
  };
}

// Fabrica de gate para "si la invocacion ya se conoce, es codigo, no
// agente": correr un comando y juzgar por exit code, nunca escaneando
// stdout por la palabra "error".
export function testsPass(cmd: string[], opts: { cwd?: string } = {}): Gate {
  return async () => {
    try {
      const [bin, ...args] = cmd;
      if (!bin) throw new Error("cmd vacio");
      await execFileAsync(bin, args, { cwd: opts.cwd });
      return { gate: "tests_pass", passed: true, checks: [{ item: cmd.join(" "), ok: true }] };
    } catch (err) {
      const code = (err as { code?: number }).code ?? "?";
      return {
        gate: "tests_pass",
        passed: false,
        checks: [{ item: cmd.join(" "), ok: false, note: `exit ${code}` }],
      };
    }
  };
}

export async function runGates<E>(envelope: E, gates: Gate<E>[]): Promise<GateReport[]> {
  const reports: GateReport[] = [];
  for (const gate of gates) reports.push(await gate(envelope));
  return reports;
}
