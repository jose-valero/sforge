# Laboratorio A — motor de fases, envelopes y gates

Investigación interna sobre un patrón de orquestación de SDLC con agentes: código determinista posee
secuenciación/reintentos/aceptación, agentes trabajan solo dentro de fases acotadas con contratos
tipados. Base de la Capa 1 de orbit-core.

## Resumen

SSSF es un **skill de Claude Code** (`.claude/skills/sssf/`) que, al instalarse ("estamparse") en cualquier repo, deposita un pequeño framework Python de **ADWs** (AI Developer Workflows): scripts deterministas que encadenan agentes de IA (vía el coding agent **Pi**, `github.com/mariozechner/pi-coding-agent`) dentro de "fases" tipadas, con contratos JSON estrictos entre fases, puertas de validación ("gates") posteriores a cada llamada, y un trazado completo a SQLite que una UI Vue/Vite (`apps/visualizer/`) consume por *polling*.

La idea central, repetida como mantra en el README: **"Agent proposes, code disposes"**. El agente nunca controla la secuencia, los reintentos ni el criterio de aceptación — eso lo posee código Python determinista. El agente solo trabaja *dentro* de una fase acotada (`kind="agent"`), con una entrada y una salida tipadas.

## Filosofía

1. **El problema que ataca**: "Dale a un modelo capaz todo tu SDLC y obtienes una máquina sin costuras" — sin límites de fase no puedes decir qué paso falló; sin criterio de aceptación nombrable, "terminado" significa "el agente dejó de hablar"; un reintento es un arranque en frío que tira todo lo aprendido; la única traza es una transcripción que hay que leer como novela; correr dos veces da dos sistemas distintos.

2. **La corrección no es "mejor prompt"**, es una decisión arquitectónica: *el código posee secuenciación, reintentos y aceptación; el agente posee solo el trabajo dentro de una fase acotada.* Todo lo demás —fases como unidad de traza, *envelopes* como único medio de paso de contexto, *gates* como definición de "hecho", corrección más barata que reinicio porque la sesión sigue viva— se deriva de esa única línea.

3. **"Los agentes son geniales. No siempre necesitas uno."** Si la invocación ya se conoce (`bun test`, `ruff check`), escríbela como código (`kind="code"`). Un agente redescubriendo tu test runner quema contexto para aprender lo que un subproceso ya sabe, y te cobra por el privilegio cada corrida. El costo no es solo tokens: es costo, velocidad y consistencia, y se paga en la corrida 100 y 1000, no en la 1.

4. **Tres principios rectores, explícitos**: **Observable** (todo evento va a SQLite mientras ocurre, no después), **Customizable** (un único YAML fija las "4 claves" de cada agente: contexto, modelo, prompt, herramientas — "no se trata de qué modelo es el mejor, sino de cuál es el correcto para esa fase"), **Reusable** (es un skill que se estampa en cualquier repo y luego se dobla a medida; los tests, prompts y roster que trae son arrancadores desechables, no el producto final).

5. Hay tres actores separados a propósito: **el ingeniero** (humano), **el código** (determinista), **los agentes** (acotados). "El truco no es correr más agentes. El truco es usar a los tres en el momento correcto."

## Arquitectura / Flujo

### Capas del skill

```
.claude/skills/sssf/
├── SKILL.md                 reglas duras + tabla de enrutamiento de peticiones
├── cookbooks/                9 "cookbooks" (playbooks) cargados perezosamente
├── references/               specs profundas: config.md, handoff.md, observability.md
├── scripts/                  install.py, make_config.py, make_adw.py (generadores)
├── apps/visualizer/           UI de solo-lectura (Vue + Vite sobre Bun, puerto 4600)
└── templates/                 EXACTAMENTE lo que install.py estampa en el repo destino
    ├── sssf.config.yaml       roster inicial de agentes
    ├── prompt_engineering/{agent}/system.md + user.md
    ├── harness_engineering/   extensiones de Pi (ej. subagentes)
    └── adws/
        ├── adw_*.py           12 workflows arrancadores
        └── adw_modules/       TODA la lógica de bajo nivel
```

`SKILL.md` es notable por su disciplina de **carga perezosa**: al arrancar, el orquestador (el propio Claude Code operando el skill) solo debe leer `cookbooks/sssf_overview.md`, listar los `adw_*.py` y sus docstrings `Phases:`, imprimir una tabla, y **esperar la petición del ingeniero**. Explícitamente prohíbe inventariar el repo, consultar la base de trazas, o diagnosticar fallos viejos sin que se haya pedido — "el estado ofrecido voluntariamente es estado adivinado", "gasta el contexto que la tarea real necesita", "está obsoleto al llegar porque la siguiente corrida cambia el propio sistema que describe". Cada cookbook se carga solo cuando una petición concreta lo amerita, vía una tabla de enrutamiento.

### El roster de agentes (`sssf.config.yaml`)

Un YAML con `defaults` (modelo, `thinking`, `protected_files`, `data_dir`) y una lista `agents`, cada uno con: `name`, `model` (formato obligatorio `provider/model-id`), `thinking` (`off|minimal|low|medium|high|xhigh|max`), `color` (swatch para su carril en la UI), `purpose`, `prompt_engineering` (rutas a `system.md`/`user.md`), `harness_engineering` (extensiones Pi), `tools` (lista de capacidades) y **`writes`** (límite de escritura — ver más abajo). Cinco agentes de arranque: `planner`, `builder`, `scout` (recon de solo lectura), `reviewer`, `documenter`. **No hay agente `tester`** porque correr una suite es un comando conocido, es decir código.

Clave de diseño: **"tools es una lista de capacidades, writes es la frontera"**. `bash` corre cualquier cosa (incluido `git checkout`) y `write` alcanza cualquier ruta — así que una lista de herramientas nunca puede hacer verdadero "este agente no cambia nada". Eso se aplica en código, después de cada llamada, comparando el árbol de trabajo antes/después.

### Fases: el primitivo único

Todo run es una secuencia de `run.phase(PhaseParams(name, kind, owner, description, retries=0))`, un *context manager* único para tres tipos/carriles:
- **engineer**: carril humano (input del sistema).
- **agent**: `ph.call(AgentCall(output_type=..., prompt=..., previous=..., gates=[...]))` — prompt entra, *envelope* tipado sale, *gates* verifican.
- **code**: paso determinista independiente (commit, migración, correr tests/lint) — nunca enterrado dentro de una fase de agente, así la traza muestra exactamente cuándo corrió código y cuándo trabajaba un agente.

**"El éxito debe ganarse"**: toda fase arranca en `fail`; solo una salida limpia la vuelve `success`; una fase de agente además exige que el *envelope* parsee y que todos los *gates* salgan verdes. `run.finish(accepted=bool, reason=...)` resuelve a la vez el código de salida, el estado de sesión y el banner de consola — evita la trampa de un *run* que corrió una suite roja pero quedó registrado como verde en todas partes salvo el `$?` de CI.

Hay un validador (`field_validator`) en `PhaseParams.description` que **rechaza en tiempo de construcción** una descripción vacía o que sea un simple eco del nombre de fase (`commit_plan: "Commit the plan"` falla) — fuerza a que cada fase documente su intención real, porque la descripción es la única frase que la traza, la consola y la UI muestran.

### Envelopes y gates

Un agente tiene exactamente **dos canales de salida**: archivos de referencia en `context_handoff/`, y una **respuesta JSON final válida** parseada contra el tipo declarado en la llamada (`EnvelopeBase` y subclases: `PlanOutput`, `BuildOutput`, `ScoutOutput`, `ReviewOutput`, `DocumentOutput`, `GenericOutput`, además de adaptadores `VerifyOutput`/`ChangesOutput` para envolver resultados deterministas de código como si fueran reportes de agente). `EnvelopeBase` exige `status: success|fail`, y `status="fail"` hace fallar la fase aunque el JSON parsee — "un agente declarando su propio fracaso no es una fase exitosa".

**El contrato de salida es una tríada sincronizada**: (a) el tipo Pydantic en `data_types.py`, (b) el ejemplo JSON en la sección `## Report` del `user.md` del agente, (c) `output_type=` en el sitio de la llamada. Regla explícita: "cambia uno, cambia los tres en el mismo edit" (sugieren `grep` del nombre del tipo para encontrar todos los sitios).

Los **gates** (`gates.py`) son funciones `gate(envelope, run) -> GateReport` que verifican *afirmaciones*, nunca predicciones — corren **después** de que el agente terminó, contra lo que el propio *envelope* declaró (`artifacts_exist`, `files_non_empty`, `json_parses`, `diff_matches_claims`, `verdict_consistent`, y la fábrica `tests_pass(cmd)`). `GateReport` registra un `check(item, ok, note)` por cada cosa examinada, así un gate verde dice *qué* verificó, no solo que pasó.

**Mecanismo de corrección, no de reinicio** (`agents.py::execute`): si el JSON no parsea, se reintenta hasta `JSON_FIX_ATTEMPTS=2` veces **re-prompteando la misma sesión** de Pi (`--session-id` es *create-or-continue*) con un mensaje de corrección exacto. Si los gates fallan, se reintenta hasta `phase.retries` veces con un mensaje "Your previous response failed validation: - ... Fix these problems, then re-emit ONLY your Report JSON." El contexto nunca se pierde; una sesión fría tira todo lo que el agente ya aprendió.

### Permisos como verificación post-hoc (`permissions.py`)

Antes de cada llamada de agente se toma un `snapshot()` del árbol git (numstat de archivos trackeados + lista de no-trackeados). Después de la llamada, `enforce()` compara y calcula `changed_paths`. Cualquier ruta tocada que no esté permitida por `agent.writes` (o por `protected_files` del roster) es una **brecha** (`PermissionBreach`) — no un gate (no se puede "corregir" reprompteando, porque la escritura indebida ya ocurrió). El sistema intenta **revertir** automáticamente (`git checkout -- path`, o borrar un archivo no-trackeado nuevo), y si la ruta ya estaba sucia *antes* de que el agente corriera, lo deja igual y reporta `"REVERTED-BY-AGENT (uncommitted work lost, cannot restore)"` en vez de fingir que lo arregló. Caso de uso real citado en el código: un `builder` con `bash` corrió `git checkout adws/` y descartó cambios no comiteados en el propio chequeo de calidad que lo iba a juzgar — de ahí nace este módulo.

### La traza (observabilidad)

Un solo camino de datos: **"agents write to SQLite, readers poll SQLite"**. `agent_pi.py` sigue el stdout JSONL de Pi línea por línea y el `tracer.py` inserta cada evento mientras el agente sigue trabajando (verificado: *tool calls* visibles a mitad de corrida, no en lote al final). Diez tipos de evento en 7 tablas (`sessions`, `phases`, `events`, `envelopes`, `gate_results`, `agent_sessions`, `processes`). Cada evento se registra contra `adw_id` + `phase_id`, y `parent_id` anida *spans*. `processes` mapea `adw_id → pid` para poder encontrar y matar una corrida colgada (`just kill <adw_id>`), y una corrida matada por SIGTERM/SIGINT finaliza su propia traza como `fail` en vez de quedar `running` para siempre.

La consulta completa de transporte es un cursor por `rowid`:
```sql
select * from events where adw_id = ? and rowid > ? order by rowid limit 500;
```
Vista en vivo e historial completo son la misma consulta a distinta cadencia — no hay *ingest endpoint*, ni WebSocket, ni *backfill*, ni ruta de *replay* separada. Toda conexión abre en modo WAL (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`) para que las lecturas nunca bloqueen a los escritores.

Detalle fino de métricas: `context_tokens`/`context_window` miden **ocupación** de la ventana de contexto tras el último turno (lo que importa para no reventar el contexto), mientras `tokens`/`total_tokens` miden **gasto acumulado** (lo que importa para el costo) — son preguntas distintas y el sistema las separa con cuidado, replicando el cálculo que hace Pi mismo (`calculateContextTokens`).

### Los 12 ADWs arrancadores

Todos con la misma forma CLI: `uv run adws/adw_*.py "<prompt o ruta a prompt.md>" [--config ...] [--adw-id a1b2c3d4]`.

| ADW | Cadena |
|---|---|
| `adw_prompt` | ingeniero → \<agente\> (uno, con `--agent NAME`) |
| `adw_scout` | ingeniero → scout (solo lectura) |
| `adw_plan` | ingeniero → planner |
| `adw_build` | ingeniero → builder |
| `adw_quality` | ingeniero → code(quality), sin agentes |
| `adw_plan_build` | planner, builder, git(commit) |
| `adw_build_test` | builder, code(test), bucle de arreglo acotado |
| `adw_build_review` | builder, reviewer, bucle de revisión acotado |
| `adw_plan_build_test` | plan, build, code(test), git(commit) — "la cadena estándar" |
| `adw_plan_build_test_quality` | igual + gates de lint/typecheck/build |
| `adw_document` | code(git diff), documenter |
| `adw_simple_sdlc` | plan → build → test → review → document, **3 commits de 3 autores distintos** |

`--adw-id` es opcional en todos: omitido, se acuña un id nuevo; dado, el *run* se une a esa sesión — mismos directorios, mismo `context_handoff/`, y **cada agente retoma su propia ventana de contexto existente** vía `agent_map.json` en vez de arrancar en frío. Así se encadenan workflows manualmente: `adw_plan.py` imprime un `adw_id`, luego `adw_build_test.py --adw-id <id>` continúa esa misma sesión.

### Rol humano vs. agente

El humano ("engineer") es una fase (`kind="engineer"`) que registra la petición entrante — siempre la primera fase de cualquier ADW. Más allá de eso, el humano opera el *skill* (pide instalación, pide crear/ajustar un ADW, lanza y observa corridas) pero **nunca** hace el trabajo de planificar/construir/revisar en lugar de un agente — eso lo prohíbe explícitamente `SKILL.md` ("You do no ADW work yourself"). El agente trabaja solo dentro de su fase acotada; el código decide todo lo demás (secuencia, reintentos, aceptación, commits).

## Prompts y Convenciones Clave

- **Patrón de `user.md`**: un h3 (`### prompt`, `### previous_envelope`, `### context_handoff_dir`) por cada variable inyectada vía plantilla (`{{prompt}}`, `{{previous_envelope}}`, `{{context_handoff_dir}}`), luego `## Task`, luego `## Report` con el JSON exacto a devolver — "ONLY valid JSON matching X — no prose before or after". El `system.md` se queda estático: solo Purpose + Instructions (la identidad del agente vive ahí; la forma de la tarea vive en el `user.md` de cada sitio de llamada).
- **Convención del planner** (`prompt_engineering/planner/user.md`): escribe el plan en `context_handoff_dir/plan.md` para el builder, y **copia** (no retipea) ese archivo a `specs/<adw_id>_<slug>.md` en el repo — listando `specs/` primero para elegir un nombre libre, nunca sobrescribiendo una spec existente (usa `_v2`, `_v3`...). Un `commit_message` propio describe *ese documento de spec*, no el trabajo que describe.
- **Convención del reviewer** (`prompt_engineering/reviewer/*`): su spec es `context_handoff_dir/plan.md` si existe, si no el `prompt` crudo. Juzga el código en disco, nunca el resumen del builder; parte de `previous_envelope.changed_files` y usa `git diff` para lo que falte. Desglosa la spec en requisitos concretos y falla cada uno con evidencia `file:line`. Explícitamente fuera de su alcance: correr tests, opiniones de estilo, refactors, o cualquier cosa que la petición no pidiera ("trabajo no pedido no es bloqueante por sí mismo; trabajo pedido y faltante siempre lo es"). No cambia nada — todo hallazgo regresa al builder.
- **`verdict_consistent` gate**: verifica que el *envelope* de revisión sea coherente consigo mismo (no "approved=true" con items bloqueantes, no "approved=false" sin nombrar ningún problema) — sin leer una línea del diff.
- **Instrucción repetida en varios prompts**: "heredas el entorno de shell del operador... llama a herramientas por su nombre simple (`bun`, `uv`, `pytest`), nunca busques el binario ni caigas a una ruta absoluta"; y "juzga cualquier comando por su código de salida, nunca escaneando la salida por palabras — `error` dentro de una salida que pasó es texto, no un fallo."
- **Regla de los "4 parámetros"**: cualquier función con más de 4 parámetros recibe UN objeto concreto en su lugar (`AgentCall`, `PhaseParams` son el patrón).
- **`quality.py`**: cada bloque (`test`, `lint`, `typecheck`, `build`) es un placeholder `echo "PLACEHOLDER ..."` que sale con código 0 y se delata a sí mismo — "una suite verde en una instalación fresca" es el primer riesgo nombrado en la tabla de "dónde puede fallar" del README. El `argv` debe ser **lista**, nunca string de shell (evita *shell injection*); los binarios se llaman por nombre simple.
- **`install.py`** es idempotente: saltea archivos que ya existen y reporta lo saltado (doble uso como *drift check*); `--force` sobreescribe TODO lo estampado, incluido `sssf.config.yaml` y los prompts del usuario.
- **Generadores**: `make_config.py` y `make_adw.py "--name X --agents a,b"` generan el esqueleto YAML/Python por convención, pero no crean las entradas de config ni los archivos de prompt — eso es manual primero.

## Fortalezas

1. **La separación código/agente está verdaderamente aplicada en código**, no solo documentada: `permissions.py` compara snapshots de árbol git antes/después y revierte escrituras no autorizadas; `PhaseParams.description` literalmente lanza una excepción si el autor intenta hacer trampa con la documentación de intención; `run.finish(accepted=...)` resuelve exit-code/estado/banner como una sola decisión atómica para que nunca puedan discrepar.
2. **El mecanismo de corrección sobre sesión viva** (reprompt con `--session-id` create-or-continue, bounded por `JSON_FIX_ATTEMPTS`/`retries`) es genuinamente más barato que un reinicio frío y está bien razonado: la ventana de contexto que ya aprendió el problema no se pierde.
3. **La tríada sincronizada tipo/ejemplo-JSON/output_type** como disciplina explícita para evitar *drift* entre lo que el tipo Pydantic exige, lo que el prompt le pide al modelo, y lo que el código espera recibir — un problema real y subestimado en sistemas con LLMs.
4. **Diseño de observabilidad simple y honesto**: un único camino de datos (`agents → sqlite → poll`), sin WebSocket, sin ingest endpoint, WAL para que lecturas no bloqueen escrituras, y una distinción cuidadosa entre "ocupación de contexto" (`context_tokens`) y "gasto acumulado" (`total_tokens`) que muchos sistemas confunden.
5. **"No siempre necesitas un agente"** llevado hasta las últimas consecuencias: no hay agente `tester` — correr una suite es código; el reviewer explícitamente no corre tests; cada *envelope* de "resultado determinista" (`VerifyOutput`, `ChangesOutput`) se disfraza de reporte de agente solo para viajar por la misma puerta, sin que el agente consumidor note la diferencia.
6. **Carga perezosa disciplinada del propio skill** (`SKILL.md`): rechaza explícitamente el reflejo de "inventariar todo antes de que te pidan algo" — útil como patrón general para cualquier agente orquestador con mucha documentación disponible.
7. **Honestidad documental**: la sección "Where it can still fail" del README es una lista concreta de fallos reales observados (placeholders verdes, patrón de modelo ambiguo, agentes colgados sin trazar nada, drift de la tríada, gates verdes con mal output, brechas de permiso) — no marketing.
8. **Ergonomía de reanudación de sesión entre ADWs** (`--adw-id` + `agent_map.json`) permite construir cadenas largas incrementalmente sin perder contexto de cada agente individual, y detecta drift de modelo para forzar sesión nueva en vez de un resume incorrecto.

## Debilidades

1. **Mono-rama, sin sandbox, sin control de versiones del propio trabajo del agente** — el README lo admite explícitamente: "corre en tu branch actual. No hay sandbox, no hay branch por corrida, no hay merge step, no hay nube, no hay fase de aprobación humana." Para trabajo real esto es una laguna seria: un `builder` sin sandbox con `bash` puede, en teoría, hacer daño real al repo del operador mientras corre (los permisos solo detectan y revierten *después*, no previenen durante).
2. **V1 es mono-proveedor de harness**: solo Pi (`coding_agent: pi`); `claude_code` está "schema-valid pero stubbed" — no hay soporte real multiagente con distintos harnesses coexistiendo todavía, aunque el *roster* sí permite mezclar modelos/proveedores dentro de Pi.
3. **Sin verdadero tester agente ni rigor de testing más allá de "exit code 0"**: el acoplamiento con `quality.py` es deliberadamente mínimo — placeholders que hay que reemplazar a mano, sin ninguna guía sobre cobertura, aserciones de calidad del test, tests de regresión generados, property-based testing, etc. "Pasar los tests" y "la suite es buena" son cuestiones completamente fuera de alcance.
4. **Sin orquestación multiagente concurrente real**: todo es secuencial dentro de un ADW (fase tras fase); el único paralelismo mencionado es *subagentes* del propio Pi dentro de una sola fase (ej. el scout puede lanzar sub-recon), no múltiples agentes de fases distintas trabajando en paralelo coordinados por el framework.
5. **Sin estado cruzado entre proyectos / sin aprendizaje acumulado**: cada repo estampado tiene su propio `sssf.db`, su propio roster, sus propios prompts — no hay mecanismo para que lecciones aprendidas en un proyecto (patrones de fallo, mejores prompts, gates útiles) se propaguen automáticamente a otro proyecto estampado con el mismo skill. Es "reusable" en el sentido de poder copiar-pegar el skill, no en el sentido de tener una capa de memoria/meta-aprendizaje entre runs o entre repos.
6. **Gates mecánicos, no semánticos**: los propios autores lo admiten ("gates verifican lo que un predicado puede verificar, no calidad de plan ni buen gusto de código") — la calidad real recae enteramente en el `reviewer` agente o en el humano leyendo. No hay ningún mecanismo de "LLM-as-judge" más estructurado que esa única fase de revisión.
7. **La capa de permisos es reactiva, no preventiva**: detecta y revierte después del hecho; si el daño es irreversible (p. ej. un `rm -rf` fuera del control de versiones, o una llamada de red con efectos externos), no hay nada que lo prevenga durante la ejecución del agente — solo detección posterior sobre el árbol git.
8. **Acoplado a convención de proyecto único con git**: `commit_all` asume un repo git con un working tree; no hay abstracción para, por ejemplo, monorepos con múltiples repos git, o proyectos sin control de versiones.
9. **El "control plane" es un conjunto de scripts Python invocados por CLI uno a la vez** (`uv run adws/adw_X.py`), no un daemon/servidor orquestador persistente; encadenar ADWs requiere que el humano (o un agente orquestador) decida manualmente el siguiente paso y pase `--adw-id`. No hay un "scheduler" que decida automáticamente qué ADW correr después según el resultado del anterior, salvo dentro de un único script (los bucles acotados de fix/test).

## Qué rescatar para orbit-core

Dado que orbit-core busca ser una **capa de orquestación agnóstica de dominio** (vs. un *harness* que contiene lógica específica de proyecto), varias piezas de SSSF son directamente trasplantables como **primitivas de la capa de orquestación**, separadas de cualquier lógica de negocio del proyecto concreto:

1. **El primitivo de "fase" de 3 carriles (`engineer`/`agent`/`code`) como unidad atómica de trazabilidad y de "éxito debe ganarse"** — esto es puro mecanismo de orquestación, no depende del dominio. Vale la pena adoptarlo casi literal: todo run es una secuencia de fases con `kind`, `owner`, `description` obligatoria y no-trivial, estado por defecto `fail`.
2. **El contrato de envelope tipado + "tríada sincronizada" (tipo/ejemplo-en-prompt/output_type)** como disciplina general para evitar *drift* — esto es agnóstico de dominio y resuelve un problema real en cualquier *software factory* con LLMs. Se puede generalizar como "regla de higiene" que orbit-core aplique a *cualquier* módulo específico de proyecto que defina sus propios tipos de salida.
3. **Gates como verificación de afirmaciones post-hoc, desacoplados del contenido del dominio** — el *mecanismo* (`gate(envelope, run) -> GateReport`, violaciones listadas, reintentos acotados vía reprompt de la misma sesión) es agnóstico; lo que varía por proyecto es *qué* gates se registran (eso sí pertenece al "harness" específico del proyecto, análogo a `quality.py`).
4. **Separación explícita `tools` (capacidad) vs. `writes`/permisos (frontera enforced en código, post-hoc, con rollback)** — este patrón de snapshot-antes/snapshot-después + rollback selectivo es un mecanismo de seguridad genérico y reutilizable para *cualquier* agente con acceso de escritura, independiente del dominio del proyecto.
5. **El patrón de observabilidad de un solo camino de datos (sqlite WAL + polling por cursor, sin ingest endpoint)** — simple, robusto, y trasplantable como la capa de trazado de orbit-core; el esquema de eventos (`phase_start/agent_start/tool_call/handoff/gate_pass/gate_fail/log/agent_end/phase_end/error`) es un buen punto de partida genérico para cualquier *runner* multiagente, no solo para SDLC.
6. **Resumption de sesión vía `--adw-id` + mapa `agente→session_id` con detección de drift de modelo** — mecanismo genérico de orquestación para encadenar ejecuciones sin perder contexto, aplicable a cualquier *grafo* de trabajo con agentes, no solo a planificar/construir/revisar código.
7. **La regla "si la invocación ya se conoce, es código, no agente"** — esto es más una heurística de diseño que un mecanismo, pero vale la pena llevarla a orbit-core como principio rector explícito en su propia documentación/skill, igual que SSSF lo hace como regla dura #8.

Lo que **NO** conviene llevar tal cual (porque es específico del dominio "SDLC de código" que SSSF modela, y debería vivir en el *harness* de cada proyecto concreto, no en la capa agnóstica de orbit-core):
- Los agentes concretos (`planner`/`builder`/`scout`/`reviewer`/`documenter`) y sus prompts — son una instancia de dominio (ingeniería de software), no la orquestación en sí.
- `quality.py` y sus bloques `test/lint/typecheck/build` — específicos de SDLC.
- Los 12 ADWs arrancadores concretos — son recetas de dominio sobre el primitivo genérico de fases.
- El acoplamiento a git/commits como la única forma de "codificar" output — útil para SDLC, no para "software factory" agnóstica de dominio en sentido amplio (aunque para construcción de software específicamente sigue siendo razonable).

En síntesis: SSSF es un excelente ejemplo de **harness de dominio (ingeniería de software) construido sobre primitivas de orquestación limpias**. Para orbit-core, el valor está en extraer esas primitivas (fase, envelope+tríada, gate, permisos post-hoc, trazado de un solo camino, resumption de sesión) como la capa agnóstica, y tratar todo lo que SSSF llama "lo que se estampa y se dobla" (prompts, agentes, quality.py, ADWs concretos) como el equivalente a lo que orbit-core llamaría el *harness* específico de cada proyecto.
