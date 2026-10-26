# Capa 3 — catálogo de capacidades (v0 mínimo)

Ver [`DESIGN.md`](./DESIGN.md), [`CAPA0.md`](./CAPA0.md), [`CAPA2.md`](./CAPA2.md). Esta es la primera
pieza de Capa 3 según el orden de ataque de
[`../sintesis-orbit-core.md`](../sintesis-orbit-core.md) sección 5: el *mecanismo* del catálogo
(schema + manifest generado), con 3 skills reales propias — no cientos.

## Qué hay en `src/catalog/`

- **`types.ts`** — `SkillFrontmatter` (Zod, no JSON Schema + ajv): nombre `lowercase-con-guiones`,
  descripción, tags, `recommends`, `origin`, `profiles`. Un solo validador en todo orbit-core, no
  dos.
- **`parse.ts`** — `parseSkillFile()`: lee `SKILL.md`, separa frontmatter YAML (`js-yaml`, única
  dependencia nueva de esta capa) del cuerpo, valida contra el schema, confirma que
  `frontmatter.name` coincide con el nombre del directorio.
- **`manifest.ts`** — `scanSkills()` + `buildManifest()`: genera el manifest a partir de las skills
  en disco; `recommends` se filtra a ids que de verdad existen (el grafo nunca apunta a un nodo
  inexistente) — `manifestsEqual()` para un "drift check" tipo CI.
- **`evals.ts`** — `loadSkillEvals()` + `lintEvals()`: casos declarativos `should_trigger` /
  `should_not_trigger` / `route_to` por skill, y un lint estructural que confirma que todo
  `route_to` apunta a una skill real.

## Qué hay en `skills/` (3 skills reales, no cientos)

- `orbit-core-phase-design` — diseñar Phase/Envelope/Gate.
- `orbit-core-worktree-isolation` — aislamiento físico (incluye el bug real de Capa 2 documentado
  ahí mismo, para que no se repita).
- `orbit-core-permissions-policy` — qué puede escribir un agente.

Cada una usa la convención "NOT x (that is sibling)" en su `description` y se recomienda a las
otras dos vía `recommends` — un grafo de 3 nodos completamente conectado, confirmado por el ejemplo
(5 `recommends` declarados, 5 sobreviven al filtro — ninguno apunta a una skill que no exista).

## Por qué Zod y no JSON Schema + ajv

El Laboratorio D (la fuente de este patrón) usa JSON Schema validado con `ajv`. Aquí usamos Zod
porque ya es la única librería de validación de Capa 1 (el patrón de "tríada sincronizada" de
`defineEnvelope`) — introducir una segunda librería para el mismo trabajo (validar forma de datos)
habría sido duplicar sin ninguna razón real.

## Qué NO se construyó todavía (a propósito)

- **Ejecutar los evals de verdad contra un juez.** `lintEvals()` solo valida la *estructura* de los
  casos (que `route_to` apunte a algo real) — decidir si un prompt dado *de verdad* dispara una
  skill requiere un modelo real juzgando, lo cual depende de Capa 0 (bloqueada por credenciales, ver
  `CAPA0.md`). El mecanismo de evals está listo para cuando eso se desbloquee; no se simuló un
  "juez" falso para aparentar que esto ya corre de punta a punta.
- **`consult`-style ranking** (buscar skills relevantes por palabra clave/stack detectado) —
  mencionado en el Laboratorio D, no construido aquí; el catálogo de hoy se consulta leyendo
  `manifest.json` directamente.
- **Perfiles `minimal | core | full`** están en el schema y se usan en las 3 skills (`core`), pero
  no hay todavía ningún mecanismo que instale un subconjunto según perfil — es solo metadato por
  ahora.

## Qué se probó de verdad

`examples/capa3-catalog.ts` (`npm run example:capa3`) corre contra las skills reales del propio
repo (no un fixture descartable) y confirma, con aserciones reales:

1. Las 3 skills se parsean y validan sin error.
2. Los 5 `recommends` declarados sobreviven al filtro (ninguno apunta a una skill inexistente).
3. El manifest escrito en disco no tiene drift al regenerarse (comparación determinista, ignorando
   el timestamp).
4. Los 12 casos de eval (4 por skill) cargan y pasan el lint sin problemas.

Aparte, un chequeo de casos negativos (no incluido en el ejemplo principal, corrido una vez en esta
sesión) confirmó que el *lado del fallo* también funciona: un `frontmatter.name` que no coincide con
el directorio se rechaza, un `recommends` a una skill inexistente se filtra de verdad (no solo
cuando todo es válido), y `lintEvals` detecta un `route_to` roto.
