// "El exito debe ganarse": toda fase arranca en fail; solo una salida limpia
// la sube a success. Una fase "agent" ademas exige que el envelope parsee Y
// que todos los gates registrados pasen.

import type { z } from "zod";
import { EnvelopeParseError, parseEnvelope } from "./envelope.js";
import { runGates, type Gate } from "./gate.js";
import type { Substrate } from "./substrate.js";
import type { PhaseKind } from "./types.js";
import type { Trace } from "./trace.js";
import { newId } from "./trace.js";

export interface AgentCallSpec<S extends z.ZodTypeAny> {
  prompt: string;
  schema: S;
  gates?: Gate<z.infer<S>>[];
  /** reprompts de la MISMA sesion, nunca arranque en frio. */
  maxJsonFixAttempts?: number;
}

export class GateFailure extends Error {
  constructor(public readonly reports: { gate: string; passed: boolean }[]) {
    super(`gate(s) fallidos: ${reports.filter((r) => !r.passed).map((r) => r.gate).join(", ")}`);
  }
}

export interface PhaseHandle {
  readonly id: string;
  log(kind: string, payload: unknown): void;
  /** Solo valido en fases kind="agent": llama al sustrato, parsea, corrige, verifica gates. */
  call<S extends z.ZodTypeAny>(spec: AgentCallSpec<S>): Promise<z.infer<S>>;
}

export function assertRealDescription(description: string, owner: string): void {
  const d = description.trim();
  if (d.length < 12) {
    throw new Error(`descripcion de fase demasiado corta para ser util: "${d}"`);
  }
  if (d.toLowerCase() === owner.trim().toLowerCase()) {
    throw new Error(`la descripcion no puede ser solo el nombre del owner ("${d}")`);
  }
}

export interface PhaseParams {
  kind: PhaseKind;
  owner: string;
  description: string;
  /** reintentos del CUERPO completo de la fase si lanza — no confundir con maxJsonFixAttempts. */
  retries?: number;
}

export async function runPhase<T>(
  ctx: { runId: string; trace: Trace; substrate: Substrate; parentId?: string },
  params: PhaseParams,
  body: (ph: PhaseHandle) => Promise<T>,
): Promise<T> {
  assertRealDescription(params.description, params.owner);
  const retries = params.retries ?? 0;
  const id = newId("ph");
  const startedAt = Date.now();

  ctx.trace.log({
    runId: ctx.runId,
    phaseId: id,
    parentId: ctx.parentId ?? null,
    kind: "phase_start",
    payload: { kind: params.kind, owner: params.owner, description: params.description },
  });

  const handle: PhaseHandle = {
    id,
    log(kind, payload) {
      ctx.trace.log({ runId: ctx.runId, phaseId: id, parentId: ctx.parentId ?? null, kind, payload });
    },
    async call(spec) {
      if (params.kind !== "agent") {
        throw new Error(`ph.call() solo es valido en fases kind="agent" (esta es "${params.kind}")`);
      }
      const maxFix = spec.maxJsonFixAttempts ?? 2;
      const envelope = await (async function attempt(
        prompt: string,
        sessionId: string | undefined,
        fixAttempt: number,
      ): Promise<z.infer<typeof spec.schema>> {
        const route = { kind: params.kind, owner: params.owner, description: params.description };
        const result = await ctx.substrate.callAgent({ prompt, sessionId, route });
        if (result.usage) handle.log("usage", result.usage);
        try {
          return parseEnvelope(spec.schema, result.raw);
        } catch (err) {
          if (!(err instanceof EnvelopeParseError)) throw err;
          handle.log("envelope_parse_retry", { attempt: fixAttempt, feedback: err.feedback() });
          if (fixAttempt === maxFix) throw err;
          const corrected = `${spec.prompt}\n\nTu respuesta anterior fallo validacion:\n${err.feedback()}\n\nCorrige y reemite SOLO el JSON valido.`;
          return attempt(corrected, result.sessionId, fixAttempt + 1);
        }
      })(spec.prompt, undefined, 0);

      handle.log("envelope", envelope);

      const reports = await runGates(envelope, spec.gates ?? []);
      for (const r of reports) handle.log("gate_result", r);
      const failed = reports.filter((r) => !r.passed);
      if (failed.length > 0) throw new GateFailure(reports);
      if ((envelope as { status?: string }).status === "fail") {
        throw new Error(`el agente declaro status="fail": ${(envelope as { summary?: string }).summary}`);
      }

      return envelope;
    },
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await body(handle);
      ctx.trace.log({
        runId: ctx.runId,
        phaseId: id,
        parentId: ctx.parentId ?? null,
        kind: "phase_end",
        payload: { status: "success", durationMs: Date.now() - startedAt },
      });
      return result;
    } catch (err) {
      lastErr = err;
      handle.log("phase_attempt_failed", { attempt, error: String(err) });
      if (attempt < retries) continue;
    }
  }

  ctx.trace.log({
    runId: ctx.runId,
    phaseId: id,
    parentId: ctx.parentId ?? null,
    kind: "phase_end",
    payload: { status: "fail", error: String(lastErr), durationMs: Date.now() - startedAt },
  });
  throw lastErr;
}
