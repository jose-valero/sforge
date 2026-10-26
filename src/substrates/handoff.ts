// Protocolo de traspaso entre sustratos distintos — no resumption dentro
// del mismo (eso ya lo cubre sessionId), sino transferir el estado de una
// tarea en curso a un sustrato/proveedor distinto cuando el original no
// puede seguir (cuota agotada, caido, lo que sea). Motivado por un problema
// real documentado en investigacion/laboratorio-f: los primeros traspasos
// manuales fueron caoticos (trabajo repetido, decisiones perdidas) hasta
// que el protocolo quedo explicito y escrito, no improvisado cada vez.

import type { Trace } from "../trace.js";

export interface HandoffPackage {
  runId: string;
  fromSubstrate: string;
  toSubstrate: string;
  createdAt: string;
  /** Resumen legible, pensado para sembrar el prompt del sustrato que retoma. */
  brief: string;
  /** Cursor del ultimo evento visto — el que retoma no debe repetir trabajo ya trazado. */
  traceCursor: number;
  originSessionId?: string;
}

export function buildHandoff(opts: {
  runId: string;
  fromSubstrate: string;
  toSubstrate: string;
  trace: Trace;
  originSessionId?: string;
}): HandoffPackage {
  const events = opts.trace.since(opts.runId, 0);
  const lastEvent = events.at(-1);
  const phaseStarts = events.filter((e) => e.kind === "phase_start").length;
  const phaseEnds = events.filter((e) => e.kind === "phase_end");
  const failed = phaseEnds.filter((e) => {
    const payload = JSON.parse(e.payload) as { status?: string };
    return payload.status === "fail";
  }).length;

  const brief = [
    `Run ${opts.runId}: ${phaseStarts} fase(s) iniciada(s), ${phaseEnds.length} cerrada(s) (${failed} fallida(s)).`,
    `Traspaso de sustrato "${opts.fromSubstrate}" a "${opts.toSubstrate}".`,
    lastEvent
      ? `Continua desde el evento #${lastEvent.id} (${lastEvent.kind}) — no repitas trabajo ya visible en la traza.`
      : "El run no tiene eventos previos todavia.",
  ].join("\n");

  return {
    runId: opts.runId,
    fromSubstrate: opts.fromSubstrate,
    toSubstrate: opts.toSubstrate,
    createdAt: new Date().toISOString(),
    brief,
    traceCursor: lastEvent?.id ?? 0,
    originSessionId: opts.originSessionId,
  };
}

/** Texto listo para anteponer al prompt del sustrato que retoma la tarea. */
export function handoffPrompt(pkg: HandoffPackage): string {
  return (
    `${pkg.brief}\n\n` +
    `Este es un traspaso de contexto entre sustratos dentro del mismo run de orbit-core — ` +
    `no es una tarea nueva, es continuacion. Si necesitas mas detalle del que trae este resumen, ` +
    `consulta la traza completa del run.`
  );
}
