// Prueba de punta a punta de Capa 3: escanea skills/ (3 skills reales sobre
// el propio orbit-core, no cientos inventadas), genera el manifest,
// confirma que no hay drift contra el manifest en disco, y lintea los
// evals de enrutamiento. Nada de esto invoca un modelo — eso queda
// bloqueado igual que Capa 0 (ver CAPA0.md); lo que se prueba aqui es el
// MECANISMO: parseo, validacion de schema, filtrado de referencias.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scanSkills, buildManifest, manifestsEqual } from "../src/catalog/manifest.js";
import { loadSkillEvals, lintEvals } from "../src/catalog/evals.js";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "..", "skills");
const manifestPath = join(skillsDir, "manifest.json");

const main = async () => {
  // --- 1. escanear y validar cada SKILL.md contra el schema ---
  const skills = scanSkills(skillsDir);
  console.log(`skills encontradas: ${skills.length}`);
  for (const s of skills) console.log(`  - ${s.id} (${s.frontmatter.tags.join(", ")})`);
  if (skills.length === 0) throw new Error("ERROR: no se encontro ninguna skill — algo esta mal con la ruta");

  // --- 2. generar el manifest y confirmar que recommends no perdio referencias validas ---
  const manifest = buildManifest(skills);
  const totalRecommendsDeclarados = skills.reduce((n, s) => n + (s.frontmatter.recommends?.length ?? 0), 0);
  const totalRecommendsEnManifest = manifest.skills.reduce((n, e) => n + e.recommends.length, 0);
  console.log(
    `\nrecommends declarados: ${totalRecommendsDeclarados}, sobrevivieron al filtro: ${totalRecommendsEnManifest}`,
  );
  if (totalRecommendsEnManifest !== totalRecommendsDeclarados) {
    throw new Error(
      "ERROR: algun `recommends` se filtro porque apuntaba a una skill inexistente — revisa los nombres",
    );
  }

  // --- 3. escribir el manifest y probar que es deterministico (drift check tipo CI) ---
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nmanifest escrito en: ${manifestPath}`);

  const onDisk = JSON.parse(readFileSync(manifestPath, "utf8"));
  const regenerated = buildManifest(scanSkills(skillsDir));
  const driftOk = manifestsEqual(onDisk, regenerated);
  console.log(`drift check (regenerar y comparar, ignorando generatedAt): ${driftOk ? "sin drift" : "CON DRIFT"}`);
  if (!driftOk) throw new Error("ERROR: el manifest en disco no coincide con uno recien generado");

  // --- 4. cargar y lintear los evals de enrutamiento de cada skill ---
  const evalsBySkill: Record<string, ReturnType<typeof loadSkillEvals>> = {};
  let totalCases = 0;
  for (const s of skills) {
    const dir = dirname(s.path);
    const evals = loadSkillEvals(dir);
    evalsBySkill[s.id] = evals;
    if (evals) totalCases += evals.cases.length;
  }
  console.log(`\ncasos de eval cargados: ${totalCases} (de ${skills.length} skills)`);

  const knownIds = new Set(skills.map((s) => s.id));
  const issues = lintEvals(evalsBySkill, knownIds);
  console.log(`lint de evals: ${issues.length === 0 ? "sin problemas" : `${issues.length} problema(s)`}`);
  for (const i of issues) console.log(`  - [${i.skillId}#${i.caseIndex}] ${i.problem}`);
  if (issues.length > 0) throw new Error("ERROR: hay evals con route_to apuntando a skills inexistentes");

  console.log("\ntodas las pruebas de Capa 3 (catálogo) pasaron.");
};

main().catch((err) => {
  console.error("fallo la demo de Capa 3:", err);
  process.exitCode = 1;
});
