import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { load } from "js-yaml";
import { SkillFrontmatter, type Skill } from "./types.js";

export class SkillParseError extends Error {
  constructor(
    public readonly path: string,
    public readonly issues: string[],
  ) {
    super(`skill invalida en ${path}: ${issues.join("; ")}`);
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillFile(path: string): Skill {
  const raw = readFileSync(path, "utf8");
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new SkillParseError(path, ['no se encontro frontmatter YAML ("---" ... "---") al inicio del archivo']);
  }
  const [, frontmatterRaw, body] = match;

  let frontmatterData: unknown;
  try {
    frontmatterData = load(frontmatterRaw ?? "");
  } catch (err) {
    throw new SkillParseError(path, [`YAML invalido: ${(err as Error).message}`]);
  }

  const result = SkillFrontmatter.safeParse(frontmatterData);
  if (!result.success) {
    throw new SkillParseError(
      path,
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }

  const id = basename(dirname(path));
  if (result.data.name !== id) {
    throw new SkillParseError(path, [
      `frontmatter.name ("${result.data.name}") no coincide con el nombre del directorio ("${id}")`,
    ]);
  }

  return { id, frontmatter: result.data, body: (body ?? "").trim(), path };
}
