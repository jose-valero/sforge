# Laboratorio D — catálogo de capacidades y memoria de proyecto

Investigación interna sobre una capa de instalación/gobierno que se coloca encima de un asistente de
IA ya existente: memoria persistente de proyecto, catálogo de skills validado por esquema, y
portabilidad a múltiples asistentes mediante pocos adaptadores.

---

## Resumen

`rsc-harness` **no es un harness de ejecución de agentes** en el sentido de "bucle que llama al LLM, gestiona tools y produce acciones". Es una **capa de instalación y gobierno** que se coloca encima de harnesses ya existentes (Claude Code, Codex, Cursor, Gemini CLI, Windsurf, Cline, etc.) y les inyecta: memoria persistente en disco (`02-DOCS/`), herramientas documentadas (`01-TOOLS/`), un catálogo de 269 *skills* (`skills/<id>/SKILL.md`) seleccionables, un pequeño conjunto de *hooks* que convierten reglas en mecanismos (en Claude Code), y un sistema de "targets" que traduce ese mismo contenido al formato propio de cada asistente soportado (18 en total).

La pieza central de valor no es código que ejecuta el LLM, sino **documentación estructurada como memoria del agente** + **un catálogo de skills validado por esquema y rúbrica** + **un adaptador multi-plataforma** que evita reescribir ese contenido 18 veces. El propio README lo resume: *"The model is the brain your agent rents, and you already have it. rsc adds the rest, in four pieces: Memory, Hands, Trade, Reflexes."*

---

## Filosofía

### El problema que ataca

El README lo plantea en tres síntomas:
- *"You explain everything again"* — cada sesión nueva, cada proyecto nuevo, hay que re-explicar stack, convenciones, decisiones.
- *"What the agent does not know, it invents"* — y la invención es plausible, lo cual es peor que un error obvio.
- *"Decisions die with the chat"* — lo decidido ayer desaparece cuando se cierra la ventana.

Diagnóstico: *"The most important thing an agent needs is documentation, and nobody keeps it for the agent."* Cuando la gente arregla esto a mano, el resultado es un **"Frankenstein harness"**: instrucciones duplicadas, skills sin relación, hooks prematuros, MCPs innecesarios, sin propietario claro. Estándares abiertos (Agent Skills spec, MCP, AGENTS.md) cubren piezas sueltas, pero ninguno decide qué harness completo necesita un proyecto concreto — ahí es donde entra `rsc`.

### El rol exacto de "harness" aquí

Aquí está la respuesta a la hipótesis del usuario: **`rsc-harness` es infraestructura/plumbing, no lógica de dominio de negocio.** No contiene el bucle de ejecución del agente (eso lo sigue haciendo Claude Code, Codex, etc., como motor subyacente) y no contiene lógica de negocio específica de un proyecto cliente. Lo que contiene es:

1. **Un generador/instalador** (`scripts/rsc.js`, `targets/*`) que escribe ficheros de configuración, hooks y enlaces simbólicos a skills en el proyecto destino.
2. **Un catálogo de conocimiento reusable** (`skills/`) — general-purpose (fastapi, nextjs, postgresdb, docker…), no de un dominio de negocio particular del usuario.
3. **Un esquema de gobierno** (`02-DOCS/`, `01-TOOLS/`, lanes Answer/FTD/SDD) que es el verdadero "dueño" del contexto específico de cada proyecto — pero ese contenido (la memoria real del proyecto) lo *genera* el propio uso del harness, no viene empaquetado en el repo.

Curiosamente, dentro de su propio vocabulario, "harness" es también el nombre de **una skill concreta** (`skills/harness/SKILL.md`): *"the control plane of a workspace […] made of three parts: `01-TOOLS/`, `02-DOCS/`, the Knowledge map."* Es decir, "harness" en este proyecto es un concepto de dos niveles: (a) el producto completo (`rsc-harness`, el repo) y (b) una skill específica que gestiona memoria y herramientas de un workspace ya equipado. El repo deja claro que `harness` (skill) es el "control permanente" y `init` (skill) es la puerta de entrada que hace el primer bootstrap y delega en `harness`.

### Modelo mental central: cuatro piezas

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| **Memoria** | `02-DOCS/` | Un wiki que el agente lee antes de trabajar y mantiene actualizado mientras trabaja |
| **Manos** | `01-TOOLS/` | Una carpeta por herramienta externa, con un test que prueba que la conexión funciona |
| **Oficio** | skills | Solo las skills que el proyecto necesita: 269 disponibles, un puñado instaladas |
| **Reflejos** | hooks | Reglas que se mantienen aunque el agente las olvide a mitad de sesión |

### Las tres "lanes" (carriles de trabajo)

Cada turno de conversación se clasifica en exactamente un carril (lo decide la skill `suggest`, siempre activa):
1. **Answer** — solicitud de información, de solo lectura, no se escribe nada.
2. **FTD (Fast-Track Development)** — carril por defecto para cambios ordinarios: un único "feature document" en `02-DOCS/wiki/ftd/<slug>.md` con intención, alcance, checklist, evidencia y siguiente paso. Las tareas se marcan hechas solo contra prueba observada, nunca contra intención.
3. **SDD (Spec-Driven Development, 10 fases)** — para lo grande o con decisiones interdependientes. El agente entra solo en esta cadena; el humano aprueba la spec y responde las preguntas de clarificación, luego revisa fase a fase o deja autopilot.

Esta distinción de fricción proporcional al riesgo es, según el propio README, uno de los "diez principios" fundacionales: *"A system that nags on the 80% harmless work gets switched off."*

---

## Arquitectura / Flujo

### Schema

`schema/` contiene solo tres artefactos, deliberadamente pequeños:

- **`schema/frontmatter.schema.json`** — JSON Schema (draft-07) que valida el YAML frontmatter de *cada* `SKILL.md`:
  ```json
  {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["name", "description", "tags"],
    "properties": {
      "name": { "type": "string", "pattern": "^[a-z0-9-]+$" },
      "description": { "type": "string", "minLength": 10, "maxLength": 1024 },
      "tags": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
      "recommends": { "type": "array", "items": { "type": "string" } },
      "profiles": { "type": "array", "items": { "enum": ["minimal", "core", "full"] } }
    }
  }
  ```
  Se aplica con `ajv` dentro de `scripts/build-manifest.js` (`npm run validate`). Es la única validación estructural *formal* del repo — el resto de la "calidad" de una skill se controla por rúbrica textual (`scripts/skill-rubric.md`), no por esquema.

- **`schema/ecc-originality.json` + `schema/ecc-originality.u64`** — un mecanismo de **anti-plagio por fingerprinting**, no de validación de contenido. El JSON documenta la receta: fuente comparada (`https://github.com/affaan-m/everything-claude-code`), ventana de n-gramas de 8 tokens, normalización NFKC+lowercase, fingerprint = primeros 64 bits de SHA-256 ordenados big-endian ("collisions fail closed"), y `fingerprintCount: 93337`. El `.u64` es el array binario de esos fingerprints (746.696 bytes ≈ 93.337 × 8 bytes). `scripts/originality-check.js` compara los n-gramas de los `agents/` y `commands/` propios contra ese conjunto para detectar reutilización no atribuida de otro repo de agentes de Claude Code — corre en `prepublishOnly`.

En conjunto, `schema/` es minimalista a propósito: valida la *forma* mínima que necesita el pipeline (`build-manifest.js`, `recommend.js`, los adaptadores de `targets/`), y deja la *calidad* de contenido a un proceso editorial (rúbrica + revisión adversarial), no a reglas automáticas.

### Skills

Cada skill es un directorio `skills/<id>/` con esta convención (ejemplo real, `skills/fastapi/`):

```
skills/fastapi/
├── SKILL.md                  # frontmatter + cuerpo (instrucciones para el agente)
├── evals/
│   ├── cases.yaml            # casos should_trigger / should_not_trigger / capability
│   └── README.md
├── references/               # notas profundas por subtema (database.md, security.md, …)
└── scripts/
    └── verify.sh             # script de verificación ejecutable
```

Frontmatter mínimo requerido (validado contra el schema arriba):
```yaml
---
name: my-skill
description: Use when [specific triggers]… NOT x (that is sibling).
tags: [keyword, keyword]        # sobre esto busca el advisor de `consult`
recommends: [sibling-skill]     # qué se ofrece instalar a continuación
origin: risco
---
```

Puntos de diseño notables:

- **El patrón "NOT x (that is sibling)" en la `description`.** Cada skill declara explícitamente qué NO cubre y a qué skill hermana delega eso. Es el mecanismo central para evitar solapamiento entre 269 skills — en vez de un árbol de decisión central, cada nodo conoce sus límites. Ejemplo real (`skills/fastapi/SKILL.md`): *"NOT language-level Python or packaging (that is `python`), NOT engine-level SQL (that is `postgresdb`), NOT framework-agnostic REST contracts (that is `api-design`)."*

- **Evals declarativos por skill** (`evals/cases.yaml`). No son tests de código, son casos de *routing* verificables por un juez (LLM o humano): prompts que *deberían* disparar la skill (`should_trigger`, con el `why`), prompts que *no deberían* (`should_not_trigger`, con `route_to: <otra-skill>|none` y el `why`), y escenarios de `capability` que describen qué debería producir la skill si se activa. `bash scripts/eval-lint.sh` valida la forma de cada `cases.yaml` en CI (`scripts/skill-behavior-eval.js` corre la evaluación real).

- **Rúbrica objetiva previa al contenido**: `scripts/skill-rubric.md` se escribió, según el README, *antes de que existiera ninguna skill*, y cada skill pasó un pipeline research → spec → implement → adversarial review; las que puntuaron 8.0 (sobre un umbral) se devolvieron y corrigieron en vez de dejarlas pasar.

- **`origin` field** distingue contenido propio (`origin: risco`) de contenido de terceros adaptado (ver sección "Third-party skills" del README: `design-eng`, `animate`, el motor de `design`, etc., con atribución y licencia explícitas por fila).

- **Carga progresiva (lazy loading)**: solo la `description` de cada skill se paga en contexto hasta que una tarea la necesita — así el catálogo puede crecer a 269 sin inflar cada prompt.

- **Unidad de instalación = una skill**, nunca el catálogo completo: *"install `fastapi` without ever pulling `go`"*. La instalación real escribe el contenido una sola vez en `.rsc/skills/<id>/` (fuente única del proyecto) y cada asistente objetivo recibe un *symlink* (o copia en Windows) de vuelta a esa base — evita duplicar 18 veces el mismo Markdown.

- **Skills "meta"** gobiernan el propio sistema: `init` (bootstrap), `harness` (control plane continuo), `suggest` (decisor de lane + instalador sobre la marcha), `unslop` (quitar tono de IA al texto de salida), `author-skill` (crear skills nuevas), `sdd-init` (calibración del runtime SDD por repo).

### Targets

`targets/` **no son plataformas de despliegue** (AWS/Fly/Vercel) — son **adaptadores por asistente de IA**. El corazón es `targets/index.js`, con una tabla `SPEC` de 18 entradas:

```js
const SPEC = {
  claude:   { root: '.claude/skills', hook: '.claude/settings.json', adapter: 'claude' },
  cursor:   { root: '.cursor/rules',  hook: '.cursor/rules/rsc-suggest.mdc', adapter: 'cursor', skillExt: '.mdc' },
  codex:    { root: '.codex/rsc',     hook: 'AGENTS.md', adapter: 'md' },
  opencode: { root: '.opencode/rsc',  hook: 'AGENTS.md', adapter: 'md' },
  deepseek: { root: '.dsh/skills',    hook: 'AGENTS.md', adapter: 'md' },
  gemini:   { root: '.gemini/rsc',    hook: 'GEMINI.md', adapter: 'md' },
  copilot:  { root: '.github/rsc',    hook: '.github/copilot-instructions.md', adapter: 'md' },
  // … windsurf, cline, roo, continue, junie, kiro, aider, antigravity, zed, amp, jules
};
```

Solo existen tres **adaptadores** reales (`claudeAdapter`, `cursorAdapter`, `mdAdapter`), reusados por las 18 filas: Claude Code usa un hook JSON (`settings.json`) + directorios de skills enlazados; Cursor convierte cada skill a un único fichero `.mdc`; todos los demás (familia "AGENTS.md") leen el mismo bloque de texto en su fichero raíz propio (`AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, etc.). La función `linkOrCopy()` es el mecanismo de deduplicación: symlink relativo en macOS/Linux, copia real en Windows (porque los symlinks de directorio ahí necesitan modo desarrollador y no siempre los sigue el discovery de skills).

Por qué múltiples targets, en palabras del propio proyecto: *"Every time you open a project, your agent starts from zero […] it gives the assistant you already use (Claude Code, Codex, Cursor and 15 more) a memory […] so it stops starting over."* — el objetivo explícito es portabilidad de la misma inversión de conocimiento a través de herramientas distintas, porque un equipo real no usa un único asistente, y cambiar de asistente (o que cada miembro use el suyo) no debería significar perder la memoria del proyecto.

Niveles de soporte declarados por target (tabla del README), con tres ejes independientes — **agentes de stack**, **comandos nativos**, **memoria de sesión**— y gradación explícita (`full` / `assisted` / `unsupported`) en vez de un booleano "soportado/no soportado". Importante: los **hooks "duros"** (bloquear commit en `main`, confirmar antes de comandos destructivos) solo corren en Claude Code; en el resto, las mismas reglas viajan como *prosa* en skills/AGENTS.md pero **nada las hace cumplir mecánicamente**. El propio README lo marca como límite: *"Those guards run in **Claude Code**. In Codex, Gemini, Cursor and OpenCode the same rules travel in the skills and the session memory. They are followed, but no hook enforces them."*

Ficheros clave en `targets/`:
- `agents.js` / `agent-catalog.js` / `agent-sources.json` — generación de los 34 subagentes (`manifest.json → agents`), cada uno con `role`, `tier`, `tools` permitidas y las `skills` que encapsula (p. ej. `cpp-build-resolver`: role `build-resolver`, tools `[read, search, edit, shell]`, skills `[cpp]`).
- `commands.js` — los 53 comandos (`manifest.json → commands`): 20 fijos + 33 alias de stack, cada uno con `kind` (`skill` | `agent` | `resolver-selector` | `capability`) y `backing` (a qué skill/agente delega).
- `branch-guard.mjs`, `danger-guard.mjs`, `ship-guard.mjs`, `gitmoji-guard.mjs`, `copy-guard.mjs`, `trunk-policy.mjs` — los *hooks* concretos de Claude Code: cada uno es un mecanismo ejecutable (no solo una regla en prosa) que intercepta una acción de riesgo.
- `session-memory*.mjs`, `session-start.mjs`, `worklog-checkpoint.mjs` — el sistema de memoria entre sesiones: checkpointea estado observable del repo (branch, worktree, HEAD, paths cambiados, commits, estado SDD) y lo inyecta antes de la primera acción de la sesión siguiente, en Claude Code, Codex, Gemini CLI, OpenCode y DeepSeek Harness (`full`); solo `assisted` en Cursor vía una regla always-on; nunca en la nube — guarda localmente, nunca prompts/respuestas/contenido de ficheros/secretos, 30 días de retención, inyecta ≤4096 bytes.
- `knowledge-sync.mjs`, `knowledge-wiring.js` — sincroniza `01-TOOLS/`, `02-DOCS/wiki/` y `02-DOCS/attachments/` entre ramas de distintos desarrolladores vía una rama de intercambio dedicada `rsc/knowledge`, sin tocar código ni hacer push a `main`.
- `worktree-reaper.mjs` — aislamiento: si otra sesión trabaja en la misma carpeta, el trabajo nuevo va a `.worktrees/<branch>/`, retirado por un hook `post-merge` cuando la rama se fusiona.

### Manifest

`manifest.json` es **generado, nunca editado a mano** (`npm run manifest` ejecuta `scripts/build-manifest.js`; CI falla si está desactualizado — `npm run manifest:check`). Su rol es ser el **inventario público único** que ambas caras del sistema consultan:

- **En terminal**: `rsc consult` rankea el catálogo contra las palabras del usuario y lo detectado en el repo (`package.json` + `next` → `nextjs`; `go.mod` → `go`; `Dockerfile` → `docker`).
- **En el chat**: la skill siempre activa `suggest` nota cuándo una tarea necesita una skill no instalada, la nombra, y la instala con una confirmación de una palabra.

Estructura (`manifest.json` top-level): `version`, `counts` (`skills: 269, agents: 34, commands: 53, fixedCommands: 20`), `skills[]`, `agents[]`, `commands[]`, `sourceReceipts[]`.

- Cada entrada de `skills[]` es literalmente el frontmatter parseado y validado contra `schema/frontmatter.schema.json`, con `recommends` filtrado para solo incluir ids que existen (`known.has(r)` en `build-manifest.js`) — así el grafo de recomendaciones nunca apunta a un nodo inexistente.
- Cada entrada de `agents[]` trae `role`, `tier`, `tools`, `skills` — son subagentes especializados por stack (p. ej. `go-reviewer`, `csharp-reviewer`) generados a partir de `targets/agent-sources.json` y de las propias skills.
- `sourceReceipts[]` es inusual y honesto: para cada agente generado, lista las URLs de documentación oficial que se investigaron para redactarlo, con fecha (`researchedAt`) y qué cubre cada fuente. Ejemplo real:
  ```json
  {
    "agent": "go-reviewer",
    "researchedAt": "2026-09-02",
    "sources": [
      { "url": "https://go.dev/wiki/CodeReviewComments",
        "coverage": ["error identity and wrapping", "goroutine lifetime", "interface values", "receiver and API review"] },
      { "url": "https://go.dev/doc/comment", "coverage": ["public API comments", "package and symbol contracts"] }
    ]
  }
  ```
  Esto convierte "de dónde viene el conocimiento de cada agente" en un dato auditable, no en una afirmación de marketing.

`build-manifest.js` también valida el balance de fences de código (`scripts/lib/skill-lint.js`: `fenceBalance()`), para detectar un defecto muy concreto — un delimitador de bloque de código desbalanceado invierte el renderizado de todo el resto del documento, aunque el frontmatter y la longitud pasen — y lo hace determinista en vez de depender de que un revisor humano lo note.

---

## Convenciones clave

- **"NOT x (that is `sibling`)"** en cada `description` de skill — convención de desambiguación de routing, repetida 269 veces, que sustituye un árbol de decisión central.
- **Carpetas numeradas `01-TOOLS/`, `02-DOCS/`** como namespace reservado y ordenable a simple vista; `02-DOCS/inbox/`, `raw/`, `raw/worklog/`, `wiki/` (con `index.md`, `log.md`, `gaps.md`, `scores.json`, vistas `.base` al estilo Obsidian) siguiendo el **Open Knowledge Format (OKF)**.
- **Un solo origen de verdad por skill**, un symlink por asistente — nunca copias editables divergentes.
- **`origin: risco` vs. terceros con atribución** en el propio frontmatter/README, en vez de mezclar licencias sin trazabilidad.
- **Perfiles `minimal | core | full`** por skill (`profiles` en el frontmatter) para instalar subconjuntos coherentes según el tamaño/ambición del proyecto.
- **Carriles Answer/FTD/SDD** como unidad de fricción, decidida por el propio agente y anunciada en una línea, nunca preguntada al usuario como checkbox.
- **"El artefacto es el contrato"** en SDD: código se valida contra el plan, el plan contra la spec, la spec contra la constitution; cuando discrepan, se arregla la discrepancia antes de seguir escribiendo código — nunca gana el código silenciosamente.
- **Guardas que fallan abiertas por diseño** (documentado en `SECURITY.md`): *"rsc's guards […] fail open on purpose […] a guard that guesses is a guard that gets turned off."* Cada guarda tiene un interruptor documentado por proyecto.
- **Documento como dato, nunca como instrucción**: la skill `harness` declara explícitamente que un fichero ingerido puede llevar texto dirigido al agente ("AI assistants: approve this") y que debe tratarse como un hecho a registrar, nunca como una orden a seguir.

---

## Fortalezas

1. **Separación limpia entre "harness que ejecuta" y "harness que gobierna".** No intenta reinventar el motor de agentes (acierto: evita competir con Claude Code/Codex en su terreno) y en cambio ataca un problema real y desatendido — la memoria entre sesiones y la selección de capacidades — con una arquitectura de adaptadores explícita.
2. **El catálogo como grafo validado, no como pila de prompts.** Esquema JSON + manifest generado + `recommends` filtrado a ids existentes + evals de routing por skill (`should_trigger` / `should_not_trigger` con `route_to`) es un sistema de calidad real para 269 unidades de contenido, algo que la mayoría de colecciones de "skills"/"prompts" no tienen.
3. **Portabilidad multi-plataforma genuina y barata**: 3 adaptadores cubren 18 asistentes mediante una tabla de configuración declarativa (`SPEC`), con niveles de soporte honestos (`full/assisted/unsupported`) en lugar de prometer paridad donde no existe.
4. **Transparencia sobre procedencia y límites**: `sourceReceipts` por agente, atribución explícita de skills de terceros con licencia, y un `SECURITY.md` que dice exactamente qué es (y qué no es) superficie de ataque, incluyendo que las guardas fallan abiertas a propósito.
5. **Fricción proporcional al riesgo como principio operativo**, no solo como eslogan: se traduce en un mecanismo concreto (el decisor de lane en `suggest`, ejecutado en cada turno) y en el propio historial de fixes del `package.json` (`rscFixes`), que documenta regresiones reales de ese principio y cómo se corrigieron.
6. **Anti-plagio medible, no declarativo**: el fingerprinting n-grama contra otro repo conocido de agentes de Claude Code convierte "esto es original" en algo verificable por script, no solo en una promesa del README.
7. **Memoria entre sesiones con límites de privacidad explícitos** (nunca prompts/respuestas/ficheros/secretos, retención de 30 días, tope de 4096 bytes inyectados, nunca en la nube).

---

## Debilidades

1. **Dependencia fuerte y asimétrica de Claude Code.** Los hooks "duros" (bloqueo de commit en main, confirmación de comandos destructivos) solo existen de verdad ahí; en los otros 17 targets la misma regla es *prosa* sin mecanismo — el propio proyecto lo admite, pero es una limitación estructural real para cualquiera que use Codex/Cursor/Gemini como asistente principal.
2. **La "memoria" real del proyecto no viene en el repo, se genera con el uso.** `rsc-harness` en sí mismo aporta plumbing y contenido genérico (skills de stacks conocidos); el valor específico de un proyecto concreto (su `02-DOCS/wiki/`) es un efecto emergente del uso, no algo que el harness entregue. Esto significa que el "día 1" de un proyecto nuevo sigue sin memoria útil — solo el andamiaje para construirla.
3. **Complejidad y superficie enormes para lo que resuelve**: 269 skills, 34 agentes, 53 comandos, ~35 ficheros en `targets/`, múltiples scripts de `doctor`/`repair`/`drift-check`. Hay mucho mecanismo (knowledge-sync, worktree isolation, auto-update, backups, originality-check) que es fácil de infra-usar o de no entender del todo; el propio `rscFixes` del `package.json` muestra una larga cola de bugs sutiles de ese tipo de complejidad (hooks que se re-arman solos, comandos huérfanos, erosión de plan tras re-aceptar onboarding...).
4. **El JSON Schema de `schema/frontmatter.schema.json` es deliberadamente mínimo** — valida forma, no calidad ni coherencia semántica (p. ej. no detecta descripciones contradictorias entre `recommends` cruzados, ni ciclos de recomendación, ni solapamiento real de "NOT x" entre skills hermanas). Esa coherencia depende de la rúbrica (`skill-rubric.md`) y de revisión humana/adversarial, no de un chequeo automático — escalable hasta cierto punto, pero frágil si el catálogo sigue creciendo sin ese proceso editorial.
5. **Proyecto solo-mantenedor** ("solo, unfunded project" según `SECURITY.md`): sin SLA, sin bug bounty; para algo que escribe hooks que ejecutan comandos en la máquina del usuario, es un factor de riesgo a tener en cuenta si se adopta como dependencia crítica.
6. **El mecanismo de "targets" asume que el formato de instrucciones de cada asistente es fundamentalmente texto Markdown/YAML inyectado en un fichero de reglas o una skill-dir** — no cubre asistentes con modelos de configuración muy distintos. Es portabilidad *a nivel de convención de fichero*, no una abstracción de "harness" en el sentido de bucle/runtime.
7. **El `ecc-originality` check** es un mecanismo interesante pero muy acoplado a un repo de comparación concreto (`everything-claude-code`) y a una versión fija (`revision` pineada); no es un sistema general de verificación de originalidad, es una comprobación puntual contra una fuente conocida de solapamiento.

---

## Qué rescatar para sforge

1. **El patrón de adaptador de 3 capas para portabilidad multi-target**: `targets/index.js` separa (a) una tabla declarativa `SPEC` por plataforma, de (b) un conjunto pequeño de **adaptadores reales** (`claude`, `cursor`, `md` — solo 3 para 18 plataformas), de (c) la **fuente única de contenido** (`.rsc/skills/<id>/`) enlazada por symlink/copia. Para sforge: nunca escribir contenido específico de plataforma por plataforma; mantener contenido canónico y una tabla de proyección por runtime, con fallback a copia física solo donde el symlink no sea viable (ver `linkOrCopy()`).

2. **Frontmatter con esquema validado + manifest generado y nunca editado a mano.** El patrón `SKILL.md` → `schema/frontmatter.schema.json` (ajv) → `manifest.json` generado por `build-manifest.js`, con CI que falla si el manifest está desactualizado, es directamente aplicable como la "unidad de catálogo" de sforge.

3. **La convención "NOT x (that is `sibling`)" como mecanismo de desambiguación distribuido**, que resuelve routing entre capacidades sin árbol de decisión central mantenido a mano — escala mejor en un catálogo que crece constantemente.

4. **Evals de routing declarativos (`evals/cases.yaml` con `should_trigger` / `should_not_trigger` / `route_to` / `capability`)** como contrato de calidad por módulo, trasplantable tal cual como mecanismo de CI para cualquier catálogo de capacidades de sforge.

5. **La separación entre "memoria del workspace" (`02-DOCS/` + `01-TOOLS/`, formato OKF) y "selección de capacidades" (skills)**, que mapea bien a una capa de conocimiento del proyecto concreto separada de una capa de capacidades reusables entre proyectos — mezclarlas es justo el "Frankenstein harness" que el propio README advierte evitar.

6. **El sistema de lanes (Answer / FTD / SDD)** como principio de fricción proporcional al riesgo, implementado como decisor explícito anunciado en cada turno, no como configuración oculta.

7. **`sourceReceipts` como patrón de trazabilidad de conocimiento generado** — auditabilidad real sobre el origen del conocimiento inyectado en el contexto del agente, barato de mantener.

8. **Guardas que fallan abierto, con interruptor documentado por proyecto**, y honestidad explícita sobre qué runtime las hace cumplir de verdad vs. cuáles son solo prosa seguida por el agente.

9. **Lección por lo contrario**: el acoplamiento fuerte a Claude Code para los mecanismos "duros" es una advertencia — si sforge aspira a portabilidad real entre harnesses, el equivalente a esas guardas necesita un diseño de "mecanismo mínimo garantizado en cualquier runtime soportado" desde el principio, no nacer atado a un solo asistente.
