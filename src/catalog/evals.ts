// Evals de enrutamiento (Laboratorio D): casos declarativos que dicen que
// prompts DEBERIAN disparar una skill y cuales NO — y, si no, a que skill
// hermana deberian enrutarse. Aqui solo vive el MECANISMO (schema +
// validacion estructural + lint de referencias). Juzgar cada caso de
// verdad contra un modelo requiere un sustrato real — bloqueado igual que
// Capa 0 (ver sforge/CAPA0.md), no es parte de este archivo.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const EvalCase = z.object({
  prompt: z.string().min(1),
  should_trigger: z.boolean(),
  why: z.string().min(1),
  /** Solo tiene sentido cuando should_trigger=false: a que skill deberia ir en su lugar. */
  route_to: z.string().optional(),
});
export type EvalCase = z.infer<typeof EvalCase>;

export const SkillEvals = z.object({ cases: z.array(EvalCase).min(1) });
export type SkillEvals = z.infer<typeof SkillEvals>;

export class EvalParseError extends Error {
  constructor(
    public readonly path: string,
    public readonly issues: string[],
  ) {
    super(`evals invalidos en ${path}: ${issues.join("; ")}`);
  }
}

/** `null` si la skill no tiene evals.json — no es obligatorio tener uno. */
export function loadSkillEvals(skillDir: string): SkillEvals | null {
  const path = join(skillDir, "evals.json");
  if (!existsSync(path)) return null;

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new EvalParseError(path, [`JSON invalido: ${(err as Error).message}`]);
  }

  const result = SkillEvals.safeParse(data);
  if (!result.success) {
    throw new EvalParseError(
      path,
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data;
}

export interface EvalLintIssue {
  skillId: string;
  caseIndex: number;
  problem: string;
}

/**
 * Lint estructural, sin invocar ningun modelo: todo `route_to` debe apuntar
 * a un id que de verdad existe en el catalogo — mismo principio que el
 * filtrado de `recommends` en manifest.ts.
 */
export function lintEvals(
  evalsBySkill: Record<string, SkillEvals | null>,
  knownIds: Set<string>,
): EvalLintIssue[] {
  const issues: EvalLintIssue[] = [];
  for (const [skillId, evals] of Object.entries(evalsBySkill)) {
    if (!evals) continue;
    evals.cases.forEach((c, i) => {
      if (c.should_trigger && c.route_to) {
        issues.push({
          skillId,
          caseIndex: i,
          problem: `should_trigger=true no deberia traer route_to ("${c.route_to}")`,
        });
      }
      if (!c.should_trigger && c.route_to && !knownIds.has(c.route_to)) {
        issues.push({
          skillId,
          caseIndex: i,
          problem: `route_to apunta a una skill inexistente: "${c.route_to}"`,
        });
      }
    });
  }
  return issues;
}
