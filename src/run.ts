import { Trace, newId } from "./trace.js";
import { runPhase, type PhaseHandle, type PhaseParams } from "./phase.js";
import type { Substrate } from "./substrate.js";

export interface RunResult {
  accepted: boolean;
  reason: string;
  runId: string;
}

export class Run {
  readonly id: string;
  readonly trace: Trace;
  private readonly substrate: Substrate;
  private finished = false;

  constructor(opts: { substrate: Substrate; traceDbPath: string; id?: string }) {
    this.id = opts.id ?? newId("run");
    this.trace = new Trace(opts.traceDbPath);
    this.substrate = opts.substrate;
  }

  async phase<T>(params: PhaseParams, body: (ph: PhaseHandle) => Promise<T>): Promise<T> {
    if (this.finished) throw new Error(`run ${this.id} ya esta cerrado (finish() ya fue llamado)`);
    return runPhase({ runId: this.id, trace: this.trace, substrate: this.substrate }, params, body);
  }

  // Resuelve a la vez codigo de salida / estado de sesion / banner: nunca
  // puede quedar un run que corrio algo roto pero se registro como exitoso
  // en un lugar y no en otro.
  finish(accepted: boolean, reason: string): RunResult {
    if (this.finished) throw new Error(`run ${this.id} ya estaba cerrado`);
    this.trace.log({
      runId: this.id,
      phaseId: null,
      parentId: null,
      kind: "run_finish",
      payload: { accepted, reason },
    });
    this.trace.close();
    this.finished = true;
    return { accepted, reason, runId: this.id };
  }
}
