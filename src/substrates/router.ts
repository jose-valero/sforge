// El Substrate no nace como un adaptador fijo: nace como un enrutador con
// reglas declarativas + cadena de fallback. Hoy puede tener una sola regla
// ("todo va al mismo sitio") — lo que importa es que anadir un segundo
// sustrato despues no obliga a reescribir el contrato de Capa 1, solo a
// registrar otra regla.

import type { AgentCallParams, AgentCallResult, AgentRouteContext, Substrate } from "../substrate.js";

export interface RouteRule {
  /** Si se omite, la regla matchea cualquier llamada — util como default al final de la lista. */
  when?: (route: AgentRouteContext) => boolean;
  /** Nombre de un sustrato registrado en `substrates`. */
  substrate: string;
  /** Override de modelo para las llamadas que caigan en esta regla. */
  model?: string;
}

export interface RouterOptions {
  substrates: Record<string, Substrate>;
  /** Se evalua en orden; la primera regla que matchea gana. */
  rules: RouteRule[];
  /** Si el sustrato elegido lanza, se reintenta con el siguiente de esta lista, en orden. */
  fallback?: string[];
}

export class RoutingError extends Error {
  constructor(
    message: string,
    public readonly attempts: { substrate: string; error: unknown }[],
  ) {
    super(message);
  }
}

function pickRule(rules: RouteRule[], route: AgentRouteContext | undefined): RouteRule {
  for (const rule of rules) {
    if (!rule.when) return rule;
    if (route && rule.when(route)) return rule;
  }
  throw new Error(
    "ninguna regla de enrutamiento matcheo esta llamada, y no hay regla por defecto (sin `when`) al final de la lista",
  );
}

export function substrateRouter(opts: RouterOptions): Substrate {
  return {
    name: "router",
    async callAgent(params: AgentCallParams): Promise<AgentCallResult> {
      const rule = pickRule(opts.rules, params.route);
      const chain = [rule.substrate, ...(opts.fallback ?? []).filter((s) => s !== rule.substrate)];
      const attempts: { substrate: string; error: unknown }[] = [];

      for (const name of chain) {
        const substrate = opts.substrates[name];
        if (!substrate) throw new Error(`sustrato "${name}" no registrado en el router`);
        try {
          const callParams: AgentCallParams = { ...params };
          if (name === rule.substrate && rule.model) callParams.model = rule.model;
          return await substrate.callAgent(callParams);
        } catch (err) {
          attempts.push({ substrate: name, error: err });
        }
      }

      throw new RoutingError(
        `todos los sustratos de la cadena fallaron: ${chain.join(" -> ")}`,
        attempts,
      );
    },
  };
}
