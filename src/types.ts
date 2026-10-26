// Primitivas compartidas de Capa 1. Nada aquí sabe de SDLC, de Sentry, ni de
// ningun dominio concreto: eso vive siempre una capa mas arriba.

export type PhaseKind = "human" | "agent" | "code";
export type PhaseStatus = "fail" | "success";

export interface GateCheck {
  item: string;
  ok: boolean;
  note?: string;
}

export interface GateReport {
  gate: string;
  passed: boolean;
  checks: GateCheck[];
}
