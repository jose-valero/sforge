# orbit-core — Capa 1 (motor) + Capa 0 (sustrato) + Capa 2 (aislamiento) + Capa 3 (catálogo), v0

Primitivas agnósticas de dominio: ninguna sabe qué estás construyendo, solo cómo ejecutarlo con
disciplina. Para el porqué de cada decisión: Capa 1 en [`DESIGN.md`](./DESIGN.md), Capa 0 en
[`CAPA0.md`](./CAPA0.md), Capa 2 en [`CAPA2.md`](./CAPA2.md), Capa 3 en [`CAPA3.md`](./CAPA3.md). Para
cómo encaja esto en el resto de `orbit-core`, ver
[`../sintesis-orbit-core.md`](../sintesis-orbit-core.md).

## Capa 1 — las piezas

- **`Phase`** (`src/phase.ts`) — unidad de trabajo. `kind: "human" | "agent" | "code"`. Arranca en
  `fail`; solo una salida limpia la sube a `success`. Una `description` trivial o vacía se rechaza
  al construirla, no en code review.
- **`Envelope`** (`src/envelope.ts`) — el contrato de salida de una fase `agent`: siempre
  `{status, summary, ...}`, definido una sola vez con `defineEnvelope()` para que el schema, el
  ejemplo que ve el modelo y el tipo en TypeScript nunca diverjan.
- **`Gate`** (`src/gate.ts`) — verifica una afirmación después del hecho. `envelopeSucceeded`,
  `filesExist`, `filesNonEmpty`, `testsPass(cmd)` vienen incluidos; cualquier función
  `(envelope) => GateReport` sirve.
- **Permisos** (`src/permissions.ts`) — `snapshot()` antes, `enforceWrites()` después: cualquier
  ruta tocada fuera de lo permitido se revierte automáticamente cuando es posible.
- **`Trace`** (`src/trace.ts`) — SQLite (WAL, `node:sqlite` nativo) como único camino de datos,
  consultable por cursor. Costo (tokens, USD, duración) es una dimensión de primera clase.
- **`Substrate`** (`src/substrate.ts`) — el contrato: el único punto donde Capa 1 habla con "lo que
  ejecuta un agente de verdad". `echoSubstrate` es un stub determinista para pruebas.
- **`Run`** (`src/run.ts`) — amarra fases + trazado + `finish(accepted, reason)`.

## Capa 0 — las piezas (`src/substrates/`)

- **`substrateRouter()`** (`router.ts`) — reglas declarativas de enrutamiento + cadena de fallback
  entre sustratos.
- **`claudeCodeSubstrate()`** (`claude-code.ts`) — adaptador real a Claude Code headless. ✅
  Verificado en vivo contra un modelo real (ver `CAPA0.md`).
- **`buildHandoff()` / `handoffPrompt()`** (`handoff.ts`) — traspaso serializable de una tarea en
  curso a un sustrato distinto al que empezó.

## Capa 2 — las piezas (`src/isolation/`, v0: solo aislamiento)

- **`checkIsolation()` / `createWorktree()` / `removeWorktree()`** (`worktree.ts`) — aislamiento
  físico por worktree (Laboratorio C): cada tarea en su propia copia de trabajo y su propia rama,
  fuera del árbol del repo principal, combinado con los permisos reactivos de Capa 1 como segunda
  capa de seguridad dentro del worktree.

## Capa 3 — las piezas (`src/catalog/` + `skills/`)

- **`parseSkillFile()`** (`catalog/parse.ts`) — lee un `SKILL.md` (frontmatter YAML + cuerpo), valida
  contra schema (Zod, no una segunda librería de validación).
- **`scanSkills()` / `buildManifest()` / `manifestsEqual()`** (`catalog/manifest.ts`) — genera
  `skills/manifest.json`, filtra `recommends` a ids que de verdad existen, drift check tipo CI.
- **`loadSkillEvals()` / `lintEvals()`** (`catalog/evals.ts`) — casos declarativos de enrutamiento
  (`should_trigger`/`route_to`) por skill, con lint estructural de referencias.
- **`skills/`** — 3 skills reales sobre el propio orbit-core (`orbit-core-phase-design`,
  `orbit-core-worktree-isolation`, `orbit-core-permissions-policy`), cruzadas entre sí con la
  convención "NOT x (that is sibling)".

## Probarlo

```bash
npm install
npm run example         # Capa 1 de punta a punta, sandbox git desechable en /tmp
npm run example:capa0   # Capa 0: router, fallback y traspaso — sin credenciales
npm run example:capa2   # Capa 2: aislamiento por worktree + permisos de Capa 1 juntos
npm run example:capa3   # Capa 3: catálogo, manifest, drift check, lint de evals
npm run typecheck

npm run example:capa0-live   # ⚠️ GASTA CUOTA REAL — llama a un modelo de verdad (haiku, prompt mínimo)
```

Los primeros cuatro ejemplos no tocan este repo, no hacen commits, y no gastan cuota. El último
(`example:capa0-live`) sí invoca un modelo real a través de `claudeCodeSubstrate` — corre solo
cuando quieras verificar la integración en vivo.

## Qué falta (deliberadamente, ver DESIGN.md / CAPA0.md / CAPA2.md / CAPA3.md)

Revisores en paralelo + gate de riesgo de despliegue (resto de "Capa 2 — Pipeline de calidad"),
ejecutar los evals de Capa 3 contra un juez real, resumption de sesión (`--resume`) con
`claudeCodeSubstrate` probada en una segunda llamada encadenada, y adaptadores a otros sustratos más
allá de Claude Code.
