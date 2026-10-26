# Laboratorio C — aislamiento y disciplina de prueba

Investigación interna sobre una colección de prácticas de calidad para agentes: aislamiento por
worktree, evidencia verificable antes de reclamar éxito, y mecanismos anti-trampa contra un gate de
revisión externo.

## Resumen

`rstack` no es un framework ni una app: es una **colección de siete Agent Skills** (formato `SKILL.md` de Claude Code, compatible con Cursor y Codex) más un **`AGENTS.md`** que actúa de orquestador declarativo. Cada skill es una carpeta con un `SKILL.md` (instrucciones en markdown + frontmatter YAML) y, en algunos casos, scripts (`scripts/*.py`, `scripts/*.sh`) que el agente invoca por línea de comandos. No hay runtime propio ni orquestador en código: la "orquestación" es un documento que el agente lee e interpreta para decidir qué pasos aplican a la tarea.

Idea central, del README: *"Use it if you want an agent to work in its own worktree, follow your project's architecture, prove each change with evidence, and stop only when Greptile rates the PR 5/5."* rstack cubre el trayecto completo **de una tarea a un PR revisado y fusionable**, en cuatro fases (Isolate → Build → Prove → Ship) seleccionadas condicionalmente según el tipo de tarea.

De los siete skills, **tres son originales** (`new-feature`, `code-structure`, `evidence-driven-testing`) y **cuatro vendorizados** de otros proyectos (`before-and-after` de Vercel, `greploop`/`greploop-apps` de Greptile, `unslop` de un plugin de Cursor), cada uno con su licencia propia. rstack los junta mediante `AGENTS.md`.

## Filosofía

1. **Selección condicional de pasos, no pipeline rígido.** `AGENTS.md`: "Choose the applicable parts of this workflow for the requested task". Revisiones de solo lectura no necesitan worktree ni PR; ediciones de documentación no necesitan evidencia de runtime ni revisión de bot.

2. **La arquitectura del proyecto gana siempre.** `code-structure/SKILL.md`: el patrón actions/services es *"a default for projects without a convention"*, no una regla universal.

3. **Evidencia en vez de confianza.** Grabar video, anotarlo en vivo con afirmaciones tipo Jest (`test_start`, `assertion` con `passed/failed/untested`), entregar `evidence.mp4` + `report.md` + `manifest.json` verificables. Reproducir el fallo antes de arreglarlo.

4. **Aislamiento estricto multi-agente.** Un worktree y una rama por tarea y por agente, nunca commitear a `main`, nunca `--force` (solo `--force-with-lease` en la rama propia), nunca tocar el worktree de otro agente.

5. **Criterio de "terminado" objetivo y externo.** `greploop` exige review de Greptile con score 5/5 y cero hallazgos sin resolver, con tope de iteraciones y obligación de reportar el score real si no se llega a 5/5.

6. **Comunicación limpia como última milla.** `unslop` se aplica al texto que leerán humanos (commits, PRs, comentarios).

rstack se posiciona como un **pipeline de calidad de ingeniería "agent-first"**: no enseña a programar, sino a comportarse como colaborador disciplinado (aislar su trabajo, seguir convenciones existentes, demostrar lo que dice, someterse a revisión externa antes de reclamar éxito).

## Arquitectura / Flujo

Flujo maestro en `AGENTS.md`:

```
1. Isolate  → /new-feature
2. Build    → /code-structure (si aplica)
3. Prove    → /evidence-driven-testing
4. Ship     → PR + /before-and-after (si hay visuales) + /greploop (hasta 5/5)
             ↳ /unslop transversal a todo texto para humanos
```

Ningún skill llama a otro por código; la "invocación" es textual, vía el frontmatter `description` (carga automática heurística) o manual con `/nombre-skill`. `AGENTS.md` es el único lugar que define orden y condiciones de uso conjunto.

Reglas multi-agente (`AGENTS.md`): nunca commitear a `main`; un worktree/rama por tarea-agente; "scope check" con `gh pr list` / `gh pr diff <n> --name-only`; lockfiles se resuelven regenerando, nunca a mano; los worktrees no aíslan puertos de dev-server ni BDs compartidas (`lsof -i :<port>`).

Checks del propio repo: `python3 -m pytest tests/ -q` + `git diff --check`.

### new-feature

`new-feature/SKILL.md` (original). Aísla cada tarea en su propio worktree+rama desde `origin/main`.

Pasos: 1) chequear aislamiento existente (`git worktree list`, `git status --short`); 2) `git fetch origin`; 3) scope check vía `gh pr list`/`gh pr diff`; 4) nombrar tarea `lowercase-with-hyphens` + sufijo único (ej. `user-auth-0816a`); 5) `git worktree add <dir>/<task-name> -b <prefix>/<task-name> origin/main`; 6) entrar y verificar `git branch --show-current`.

Limpieza post-merge: `git worktree remove` + `git branch -D` (forzado porque tras squash/rebase merge, `-d` se niega aunque esté integrado).

### code-structure

`code-structure/SKILL.md` (original). Guía de diseño, no script: patrón de dos capas — actions (reglas de negocio, transiciones de estado, auth, reintentos) y services (interacción con proveedores/SDKs, ejecución de comandos, health checks, resultados estructurados) — **solo cuando el proyecto no tiene convención propia**.

Regla mnemotécnica: *"What this product flow means" → actions; "How to do this operation reliably" → services.* Checklist de migración de 6 pasos (extraer un bloque → reemplazar un caller → verificar → migrar el resto, nunca refactor masivo de golpe). Anti-patrones: "God service", "Leaky service", "Inconsistent API", "Over-abstraction". Ejemplo TS de `sendWelcomeEmail` compartido entre `userSignup.ts` y `adminInvite.ts`.

### evidence-driven-testing

`evidence-driven-testing/SKILL.md` (v1.2, original) + `scripts/evidence.py` (1358 líneas) + `scripts/run-playwright.sh` + `scripts/playwright/` (Playwright pineado). El skill más elaborado técnicamente.

Flujo de 5 pasos: 1) preparar pantalla (maximizar, anotar commit/rama exactos); 2) iniciar grabación (`python3 $EVIDENCE start --output .artifacts/<task> --commit ... --branch ...`) + anotación `setup`; 3) testear vía computer use anotando `test_start`/`assertion --result passed|failed|untested` (mensajes <80 caracteres, una assertion por cambio de estado significativo, nunca skip silencioso); 4) `stop` quema anotaciones en el video, verifica con `ffprobe`, escribe `report.md`/`manifest.json`; extraer frames en cada timestamp para confirmar visualmente; 5) publicar como comentario de PR (subida manual del `.mp4`, `gh pr comment` no adjunta video).

Detalles técnicos de `evidence.py`: captura nativa multiplataforma (X11/Wayland-wlroots/avfoundation/gdigrab; GNOME/KDE Wayland explícitamente no soportados); raw grabado como MPEG-TS para sobrevivir a crashes (`kill -9`); parada segura sin reciclar PID (pidfd en Linux, proceso "supervisor" en macOS/Windows); comando `doctor`. Caminos alternos: `cua-driver` sin GUI nativa de computer-use; camino headless con `before-and-after` o script Playwright desechable instalado fuera del proyecto objetivo. Cambios no-UI (API/performance, render, comportamiento de agente, bugfixes) también exigen evidencia medible, incluyendo reproducir el fallo antes del fix.

### before-and-after

`before-and-after/SKILL.md` (vendorizado de vercel-labs/before-and-after, PolyForm Shield 1.0.0) + `scripts/upload-and-copy.sh` + `scripts/adapters/{0x0st.sh,blob.sh}`.

Envuelve el CLI `@vercel/before-and-after` (frontmatter `allowed-tools` restringe comandos Bash permitidos). Advertencia: nunca usar el paquete `before-and-after` sin el scope `@vercel/`. Flags: `--mobile`/`--tablet`/`--size`/`--full`/`-s selector`/`--markdown`/`--upload-url`. Adaptadores de subida pluggables vía `IMAGE_ADAPTER`. Reglas: nunca cambiar de rama o stashear trabajo de otra tarea para el "before"; reusar capturas existentes; manejo de 401/403 de Vercel vía `vercel inspect`. Integración con PR vía `gh pr edit --body-file`.

### greploop

`greploop/SKILL.md` (v2.0, vendorizado de greptileai/skills, MIT) + `scripts/github_review.py` (257 líneas) + `references/{github.md,gitlab-api.md,graphql-queries.md,perforce.md}`.

Ciclo de revisión hasta **5/5 sin hallazgos accionables**, con mecanismos anti-trampa: 1) confirmar revisión objetivo y cap (default 10); 2) lanzar intento (espera ≤10 min, nunca reusar score viejo); 3) leer resumen completo y paginar hilos no resueltos vía GraphQL; 4) si 5/5 y checks pasan, terminar; si no, arreglar hallazgos válidos, documentar falsos positivos, nunca perseguir el score cambiando código correcto; 5) checks, commit de archivos de la tarea, push, resolver solo hilos con fix publicado; 6) nuevo intento si queda cap (head distinto invalida el intento previo).

`github_review.py`: `start` evita duplicar trigger si ya hay check corriendo (salvo `--stuck-after`, 1800s default), snapshot antes de postear; `wait` solo lectura, pagina todo, rechaza checks/resúmenes viejos; `confidence(body)` extrae score vía regex ignorando code-fences y HTML, solo acepta si hay score único no ambiguo; `evaluate(...)` filtra por head/timestamp, distingue PR review vs. comentario de issue, maneja "Too many files changed" sugiriendo `@greptile-apps`. Bots de confianza: `greptile-apps[bot]`, `greptile-apps-staging[bot]`.

### greploop-apps

`greploop-apps/SKILL.md` (vendorizado, MIT) — **sin implementación propia**, solo entrypoint que dice "lee `greploop` y usa `--trigger @greptile-apps`" para PRs grandes que el trigger normal rechaza.

### unslop

`unslop/SKILL.md` (vendorizado de cursor/plugins-pstack, MIT; frontmatter editado para auto-aplicarse sin `/unslop` explícito). Checklist de 4 pasos (escanear patrones → reescribir → "añadir alma" → autoauditoría). Categorías catalogadas: grandilocuencia ("testament to"), vocabulario IA (delve, crucial, intricate, tapestry...), formas rebuscadas de decir "es" (serves as, boasts), raya/colon/negrita excesivos, title case, emojis decorativos, artefactos de chatbot ("I hope this helps!"), relleno, jerga-metáfora abstracta (substrate, vector, nexus, flywheel, con reemplazo concreto sugerido), y la regla "say what it does, not how it feels" (nombrar mecanismo o número en vez de sensación).

## Prompts y convenciones clave

- Frontmatter estándar: `name`, `description` (clave real de auto-trigger, siempre "Use when..."), opcional `license`, `compatibility`, `metadata.version/author`, `allowed-tools`.
- "Mental model" de cierre en `code-structure` y `unslop`: diagrama de decisión de 3-4 líneas.
- Guardrails en imperativo negativo muy específicos ("Never present `--source test` as UI evidence", "Do not raise the cap automatically").
- Variables de entorno en mayúsculas como contrato prosa-comando: `$EVIDENCE`, `$SESSION`, `$REVIEW`.
- Separación código/instrucciones: lógica determinista en scripts (`evidence.py`, `github_review.py`, `upload-and-copy.sh`), juicio del agente en el `SKILL.md`.
- Tests sintéticos: `tests/test_evidence.py` (865 líneas), `tests/test_github_review.py` (304), `tests/test_playwright_runner.py` (80) — fixtures locales, sin depender de hardware real ni Greptile en vivo.
- Convención de nombres de rama/worktree: `<prefix>/<task-name>`, `task-name` = `lowercase-with-hyphens` + sufijo único.

## Fortalezas

- Composabilidad real sin runtime propio; cada skill es independiente y reusable (cuatro de hecho vienen de otros repos).
- Selección condicional de pasos evita ceremonia innecesaria, explícitamente documentada.
- Mecanismos anti-trampa bien pensados contra el propio agente (freshness checks en `github_review.py`, prohibición de evidencia sintética en `evidence.py`).
- Ingeniería de scripts no trivial y multiplataforma (manejo de pidfd/supervisor para evitar PIDs reciclados).
- Higiene operativa de multi-agente trasplantada de prácticas de equipos reales.
- `unslop` es aplicable fuera del dominio de código.
- Transparencia sobre procedencia y licencias de cada skill vendorizado.

## Debilidades

- Cero scaffolding de proyecto: asume que ya existe un repo con arquitectura y CI, no ayuda a crear uno desde cero.
- Fuerte acoplamiento a GitHub (y a Greptile); GitLab/Perforce están documentados pero no implementados con el mismo detalle.
- Dependencia de herramientas externas pagas/propietarias (Greptile, licencia PolyForm Shield de Vercel, `cua-driver`).
- Alcance limitado a "feature/fix → PR revisado": no cubre requisitos, descomposición de tareas grandes, ni coordinación anticipada entre agentes.
- Grabación de video como evidencia es costosa/frágil en muchos entornos CI (GNOME/KDE Wayland sin soporte nativo, dependencia de ffmpeg con libx264+`ass`).
- Sin memoria/aprendizaje acumulado entre tareas sobre el mismo repo.
- El "scope check" es heurístico y manual, sin locking real.
- `greploop-apps` es en la práctica un parche de UX sobre una limitación de Greptile, evidencia de indirección excesiva en algunos puntos.

## Qué rescatar para orbit-core

1. El patrón "AGENTS.md como orquestador declarativo + skills independientes con trigger condition propio" es trasplantable directamente: cada stage de orbit-core debería declarar su propia condición de activación en vez de vivir en un pipeline fijo hardcodeado.
2. La fase "Prove" es la pieza más valiosa y generalizable: video/log anotado con assertions tipadas (`passed/failed/untested`) + manifest verificable + "reproducir el fallo antes del fix", generalizable con adaptadores por tipo de artefacto (UI, API, CLI, ML) en vez de un solo recorder de pantalla.
3. Los mecanismos anti-trampa de `greploop` (rechazo de scores stale, verificación de head antes/después, prohibición de re-trigger innecesario, reporte honesto del resultado real) son un patrón reusable para cualquier "gate" de calidad automatizado del factory.
4. `code-structure` es plantilla reusable para futuros "skills de arquitectura" (tabla Do/Don't + anti-patrones + mental model corto, siempre subordinado a la convención existente del proyecto).
5. `unslop` es portable casi tal cual como stage transversal de higiene de comunicación para cualquier output textual de cualquier agente del factory.
6. La convención worktree/branch por tarea-agente de `new-feature` es la base mínima de aislamiento si orbit-core correrá agentes en paralelo sobre el mismo repo.
7. No rescatar el acoplamiento concreto a GitHub/Greptile/Vercel: abstraer detrás de interfaces "code review provider" y "visual evidence provider".
8. Vacío que orbit-core debe llenar y que rstack no cubre: scaffolding inicial de proyecto, definición de requisitos, descomposición de trabajo — rstack empieza donde ya hay una tarea bien definida sobre un repo existente.
