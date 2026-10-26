import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseSkillFile, SkillParseError } from "./parse.js";
import type { Skill } from "./types.js";

/** Escanea `<skillsDir>/<id>/SKILL.md` — un directorio por skill, un SKILL.md cada uno. */
export function scanSkills(skillsDir: string): Skill[] {
  if (!existsSync(skillsDir)) return [];
  const entries = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const skills: Skill[] = [];
  const errors: SkillParseError[] = [];

  for (const entry of entries) {
    const skillPath = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    try {
      skills.push(parseSkillFile(skillPath));
    } catch (err) {
      if (err instanceof SkillParseError) errors.push(err);
      else throw err;
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `${errors.length} skill(s) invalida(s):\n` + errors.map((e) => `- ${e.message}`).join("\n"),
    );
  }

  return skills;
}

export interface SkillManifestEntry {
  id: string;
  description: string;
  tags: string[];
  recommends: string[];
  origin: string;
  profiles?: string[];
}

export interface SkillManifest {
  generatedAt: string;
  count: number;
  skills: SkillManifestEntry[];
}

/**
 * `recommends` se filtra a ids que de verdad existen en el catalogo — el
 * grafo de recomendaciones nunca apunta a un nodo inexistente (patron del
 * Laboratorio D: `known.has(r)` antes de incluir una recomendacion).
 */
export function buildManifest(skills: Skill[]): SkillManifest {
  const knownIds = new Set(skills.map((s) => s.id));
  const entries: SkillManifestEntry[] = skills
    .map((s) => ({
      id: s.id,
      description: s.frontmatter.description,
      tags: s.frontmatter.tags,
      recommends: (s.frontmatter.recommends ?? []).filter((r) => knownIds.has(r)),
      origin: s.frontmatter.origin,
      profiles: s.frontmatter.profiles,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { generatedAt: new Date().toISOString(), count: entries.length, skills: entries };
}

/** Compara dos manifests ignorando `generatedAt` — para un "manifest:check" tipo CI. */
export function manifestsEqual(a: SkillManifest, b: SkillManifest): boolean {
  const strip = (m: SkillManifest) => JSON.stringify({ ...m, generatedAt: undefined });
  return strip(a) === strip(b);
}
