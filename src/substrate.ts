// La interfaz minima que Capa 1 necesita de "lo que ejecuta un agente de
// verdad". Un adaptador real (Claude Code headless, Codex, OpenCode...) es
// trabajo de Capa 0 y vive en src/substrates/ — aqui solo el contrato, mas
// un sustrato de eco determinista para poder probar fases "agent" sin
// invocar ningun modelo real.

import type { PhaseKind } from "./types.js";

// Contexto de enrutamiento: un sustrato simple lo ignora por completo; un
// router (Capa 0) lo usa para decidir a que sustrato/modelo mandar la
// llamada, sin que Capa 1 sepa que existe el concepto de "router".
export interface AgentRouteContext {
  kind: PhaseKind;
  owner: string;
  description: string;
}

export interface AgentCallParams {
  prompt: string;
  sessionId?: string;
  /** Override de modelo para esta llamada especifica, si el sustrato lo soporta. */
  model?: string;
  route?: AgentRouteContext;
}

// Costo como dimension de primera clase del trazado, no un anadido
// posterior: un sustrato real sabe cuanto gasto cada llamada, asi que el
// contrato lo deja hueco desde el dia uno en vez de retrofitearlo despues.
export interface AgentCallUsage {
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

export interface AgentCallResult {
  sessionId: string;
  raw: string;
  usage?: AgentCallUsage;
}

export interface Substrate {
  readonly name: string;
  callAgent(params: AgentCallParams): Promise<AgentCallResult>;
}

/**
 * NO invoca ningun modelo. `respond` decide que JSON (texto) devolver para
 * cada prompt — util para probar el loop de parseo/gates/reintentos de
 * Capa 1 de forma barata y reproducible antes de cablear un sustrato real.
 */
export function echoSubstrate(respond: (prompt: string, sessionId?: string) => string): Substrate {
  return {
    name: "echo",
    async callAgent({ prompt, sessionId }) {
      return { sessionId: sessionId ?? newSessionId(), raw: respond(prompt, sessionId) };
    },
  };
}

function newSessionId(): string {
  return `echo_${Math.random().toString(36).slice(2, 10)}`;
}
