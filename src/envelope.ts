// El contrato de salida de cualquier fase "agent": siempre status + summary,
// mas lo que cada caso de uso necesite. La regla clave (y que rompe mas
// pipelines de lo que parece): el tipo Zod, el ejemplo que ve el modelo en
// el prompt, y el `schema` que se pasa a ph.call() tienen que ser la MISMA
// cosa. defineEnvelope() existe para que solo haya un sitio donde se
// declara esa forma.

import { z } from "zod";

export const EnvelopeBase = z.object({
  status: z.enum(["success", "fail"]),
  summary: z.string().min(1, "summary no puede estar vacio"),
});
export type EnvelopeBase = z.infer<typeof EnvelopeBase>;

export function defineEnvelope<Shape extends z.ZodRawShape>(shape: Shape) {
  return EnvelopeBase.extend(shape);
}

export class EnvelopeParseError extends Error {
  constructor(
    public readonly issues: { path: string; message: string }[],
    public readonly raw: string,
  ) {
    super("el envelope no cumple el schema declarado");
  }

  // Texto que se reinyecta al agente para que se autocorrija, sin reiniciar
  // la sesion. Formato legible, no un stack trace.
  feedback(): string {
    return this.issues.map((i) => `- ${i.path || "(root)"}: ${i.message}`).join("\n");
  }
}

export function parseEnvelope<S extends z.ZodTypeAny>(schema: S, raw: string): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new EnvelopeParseError([{ path: "", message: "la respuesta no es JSON valido" }], raw);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new EnvelopeParseError(issues, raw);
  }
  return result.data;
}
