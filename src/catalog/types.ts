// Formato de skill (Laboratorio D): frontmatter YAML validado + cuerpo en
// markdown. Usamos Zod para la validacion estructural en vez de JSON
// Schema + ajv (que era la eleccion del laboratorio de origen) porque Zod
// ya es la unica libreria de validacion de todo orbit-core (Capa 1) — dos
// librerias para el mismo trabajo seria duplicar sin razon.

import { z } from "zod";

export const SkillFrontmatter = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "debe ser lowercase-con-guiones (ej. mi-skill-nueva)"),
  description: z
    .string()
    .min(10, "demasiado corta para ser util")
    .max(1024, "demasiado larga — una skill, no un ensayo"),
  tags: z.array(z.string()).min(1, "al menos una etiqueta, para que `consult` la pueda encontrar"),
  recommends: z.array(z.string()).optional(),
  origin: z.string().default("orbit-core"),
  profiles: z.array(z.enum(["minimal", "core", "full"])).optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

export interface Skill {
  /** = nombre del directorio; debe coincidir con frontmatter.name. */
  id: string;
  frontmatter: SkillFrontmatter;
  body: string;
  path: string;
}
