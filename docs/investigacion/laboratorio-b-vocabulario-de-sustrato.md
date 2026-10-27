# Laboratorio B — vocabulario de sustrato y validación de harness

Investigación interna sobre un método de optimización automática de harnesses de agentes: un árbol
editable de 8 componentes (prompt, guardrails, memoria, tool guidance, subagentes, skills, scripts,
plugins), separación en tres ejes ortogonales (método / sustrato / dominio), y validación estructural
pre-ejecución con feedback verbatim en el reintento.

## Resumen

Harness² **no es un harness de ejecución para agentes de uso general** (no es un Claude Code, ni un AutoGPT). Es un **método de investigación/optimización** cuyo producto es *otro harness* — es decir, un sistema que **edita automáticamente el harness de un agente ejecutor** (OpenCode o Codex) para que rinda mejor en una tarea concreta, usando solo la evidencia de ejecuciones reales (trajectories) y sin ground-truth ni gradiente.

La pieza central del repo es la definición explícita de qué es un "harness": un árbol de **8 componentes editables** (`system prompt`, `guardrails`, `memory`, `tool guidance`, `subagents`, `skills`, `scripts`, `plugins`), parametrizado por sustrato (OpenCode vs Codex) en `harness2/core/tree.py` (`SurfaceSpec`). El método entero —`harness2/core/recursion.py`, `proposer.py`, `selection.py`, `library.py`— es una maquinaria de **meta-optimización de ese árbol**: propone ediciones, las prueba ejecutando la tarea real, compara evidencia (no notas humanas) y compone una versión final, que además deja una "lección" reutilizable en una librería por dominio.

Es, en esencia, el laboratorio de Google para responder "¿qué harness deberíamos usar para esta tarea/dominio?", evaluado contra tres benchmarks profesionales reales (JobBench, LAB-legal, WorkBuddy-Bench) y dos ejecutores (OpenCode, Codex).

## Filosofía

El README es explícito y es la cita más importante del repo:

> "A **harness** is the system around a model that enables it to act as an agent: prompts, tools, memory, skills, orchestration, and more. **Harnessing** is the process of optimizing that system."

Esto confirma casi literalmente la hipótesis del usuario: un harness contiene la lógica específica de dominio/tarea y ejecuta el loop del agente; Harness² añade una capa encima que *optimiza* ese harness sin tocar los pesos del modelo.

Principios de diseño que se repiten en todo el código y los prompts (`harness2/core/prompts.py`):

1. **"Evidence is data, not instructions"** — todo lo que entra en el contexto de un modelo (trayectorias, artefactos, harnesses candidatos) es tratado explícitamente como *dato a inspeccionar*, nunca como instrucción a obedecer. Hay un bloque de prompt (`EVIDENCE_BOUNDARY`) dedicado a inmunizar al proponer/selector contra prompt-injection desde el propio contenido que está evaluando.
2. **"Answer-free" / sin filtración del grader** — el sistema entero está construido para que el optimizador *nunca* vea rúbricas, criterios de evaluación ni resultados del juez (`ANSWER_FREE`, `assert_no_grader_verdicts`, `assert_no_leak_paths`). Esto es una salvaguarda anti-overfitting al benchmark, tratada como invariante de seguridad, no como sugerencia.
3. **"Always-on prose is the expensive option"** — jerarquía explícita de costo/alcance de cada componente del harness: texto siempre activo (carísimo, compite por presupuesto de salida) < skill a demanda < script determinista < subagente < plugin/hook (el único que actúa dentro del tool loop y por tanto no puede ser ignorado). Esta jerarquía es, en sí, una pieza de conocimiento de ingeniería de prompts muy bien condensada.
4. **"KEEP_BASE is a real answer, not a failure"** — adaptación sin evidencia que la respalde se trata explícitamente como regresión. El sistema está diseñado para *no* sobre-ingenierizar.
5. **Workspace facts vs. procedure** — distinción explícita entre hechos verificados de este workspace concreto (se escriben literalmente) y procedimiento reutilizable para el dominio (se generaliza y se guarda en la librería). Esto es la clave de cómo deciden qué llega a la "memoria a largo plazo" del dominio.
6. **Generalize, don't memorize** — lo que se guarda en la librería de dominio debe transferir a tareas futuras del mismo dominio, no memorizar detalles de la tarea actual.

## Arquitectura / Flujo

### Las tres recursiones (paper)

- **Task-level recursion (Propose–Probe–Compose)**: para una tarea dada, (1) *Propose* — dos "editores" de harness, uno INV (invariante/procedimental) y otro DOM (específico del dominio), proponen ediciones a partir de la evidencia de rollouts base; (2) *Probe* — cada candidato se ejecuta de verdad (rollout real); (3) *Compose* — un "compositor" fusiona/selecciona entre los candidatos basándose en la evidencia de ejecución (trayectoria + artefacto producido), nunca en el texto del harness por sí solo.
- **Harnessing-level recursion**: tras adoptar un harness final para una tarea, un "reflector de experiencia" extrae una lección respaldada por evidencia y la añade a una librería persistente por dominio (`core/library.py`), que las tareas futuras del mismo dominio leen antes de proponer sus propias ediciones.
- **Modos de escalado del recursion budget `k`** (`core/recursion.py`):
  - `run_parallel` ("agg"): **WIDTH** — explora `2k` candidatos (k INV + k DOM) desde la misma evidencia base, y produce `k` composiciones independientes en paralelo.
  - `run_sequential` ("seq"): **DEPTH** — `k` pasos Propose–Probe–Compose anidados, cada uno editando el checkpoint anterior, acumulando evidencia de todas las rondas previas.

### Presupuesto de ejecución (contabilidad exacta)

`core/ledger.py` fija la identidad formal del método: cada tarea cuesta **R = 4k rollouts** (k base compartidos + 2k candidatos + k finales) y **P = 3k sesiones de mejora** (k INV + k DOM + k composiciones). `Ledger.assert_identity()` hace *fail-fast* si el conteo real no coincide — incluyendo detección de labels duplicados (un run que silenciosamente sobreescribió a otro). Esto es rigor de "contabilidad de presupuesto experimental" poco común en repos de agentes.

### El árbol c1..c8 y su validación (`harness2/core/tree.py`)

`SurfaceSpec` define, por sustrato, qué rutas son editables (archivos "always-on", directorio de skills, subagentes, scripts, plugin dir, archivo de hooks), con límites de tamaño (`always_on_max`) y reglas de nombres (`_NAME = r"[a-z0-9][a-z0-9_\-]*"`). `validate()` aplica invariantes duras **antes de gastar un solo rollout**:
- toda skill necesita frontmatter `description:` y, dependiendo del sustrato, `name:` coincidente, o se descarta silenciosamente al cargar;
- toda skill debe estar *nombrada textualmente* en el texto always-on (si no, "es peso muerto" — regla "EVERY SKILL NEEDS A TRIGGER LINE");
- todo script referenciado debe existir en el árbol;
- scripts deben compilar (`compile(src, rel, "exec")`);
- hooks deben cumplir el esquema JSON `{"hooks": {<Event>: [...]}}` con tipo `"command"`;
- el texto always-on no puede exceder un cap de caracteres.

`diff_summary()` y `diversity()` (Jaccard por línea entre árboles candidatos) sirven para medir si la composición colapsó a una sola variante o realmente diversificó.

### El contrato de evidencia (`harness2/core/context.py`)

Documento clave: el *único* canal por el que la evidencia llega a un modelo proponente/selector es un árbol de archivos en disco (`context/task.md`, `context/rollouts/<label>.md`, `context/deliverables/...`, `context/harness/`, `context/library/INDEX.md`, `context/pool/<label>/`), nunca texto embebido en el prompt — así nada se trunca por presupuesto de prompt. `mission()` solo construye un "puntero corto" a esa evidencia.

Hay **tripwires activos** (no solo convención) contra fuga de información:
- `assert_no_leak_paths` — rechaza cualquier archivo en el árbol de evidencia que matchee un glob de "respuesta/clave" declarado por el adaptador del benchmark.
- `assert_no_grader_verdicts` / `assert_tree_has_no_grader_verdicts` — escanea por nombre de archivo *y* por contenido una lista de marcadores (`"deterministic_eval_summary"`, `"pass_rate"`, etc.) y **lanza excepción** si algo del output del juez llegaría al contexto de un modelo. El comentario en el código dice explícitamente: *"A tripwire on the adapters' read boundary, not the defence itself: if it fires, find the read path that produced the match rather than widening the marker list."* — es decir, estos tripwires no son silenciables ni se amplían para "pasar"; obligan a corregir la fuga real.

### El proponer (`harness2/core/proposer.py`)

`Proposer` lanza sesiones agenticas reales contra uno de dos canales (`claude_cli` o `opencode`), cada llamada con reintentos, *content-addressed caching* (`_call_fingerprint` — hash de label+mission+system+contenido completo del context_dir), *harvesting* del workspace editado (`harvest="context/harness"` — así es como el árbol editado "vuelve" sin un formato de salida separado: el modelo edita archivos en disco y esos archivos *son* la propuesta), y una variable de entorno `_DROP_ENV` que purga credenciales de Anthropic del entorno del proponer antes de lanzar el subproceso (higiene de secretos).

### Selección y biblioteca (`selection.py`, `library.py`)

- La selección final es **ciega**: los candidatos se anonimizan con IDs estables (`assign_ids`, shuffle determinista con seed basada en hash de task/k/mode) y el selector solo ve el *artefacto producido*, nunca el harness que lo generó — para que la elección refleje calidad de resultado, no "qué tan elaborado se ve el prompt".
- Tras adoptar, `reflect_adoption` → `_distil` genera una "experiencia" estructurada: qué hizo cada edición (`<edits>` con verdicts `helped|hurt|no observed effect|confounded`) y, si hay evidencia suficiente, una lección `<cue, lesson, evidence, confidence>` transferible.
- `core/library.py` persiste por `(run, modo, dominio)` el árbol completo adoptado + `EXPERIENCE.md`, y reconstruye un `INDEX.md` legible. Las tareas de un mismo dominio se ejecutan en orden y solo leen entradas anteriores (consistencia de "no mirar al futuro"); dominios distintos pueden correr en paralelo.

### Sustratos (`harness2/substrate/`)

`Substrate` (Protocol en `substrate/base.py`) es la interfaz que separa "lo que un framework de agentes posee" (materializar el árbol en archivos nativos, ejecutar rollouts, renderizar trayectorias al formato común `[ACTION]/[OBSERVATION]/[ERROR]`, preflight de salud) de la lógica del método. Hay dos implementaciones: `opencode.py` y `codex.py`. Importante: Codex corre **con su sandbox desactivado** y con acceso de red sin restringir por defecto — el propio repo documenta esto como riesgo y pide mitigarlo a nivel de red (firewall de egress), no a nivel de configuración de la herramienta.

### El seam de benchmark (`harness2/core/spec.py`)

`BenchmarkAdapter` (Protocol) es el contrato completo que un benchmark debe implementar: `tasks()`, `domain_of()`, `task_prompt()`, `execute()`, `delivered()`, `trajectory()`, `deliverable_text()`, `base_harness()`, `validate_tree()`, `score()`. El comentario del docstring es la mejor frase de diseño del repo: *"Three axes stay separate — method (recursion, prompts, selection, library), substrate (the agent framework a solver rollout runs under) and benchmark (a `BenchSpec` value plus an adapter)."* Esta separación de tres ejes ortogonales es exactamente el tipo de arquitectura "domain-agnostic engine + pluggable adapters" que el usuario está buscando para sforge.

`BenchPrompts.__post_init__` incluso **valida en runtime** que el texto de dominio no contenga palabras como "benchmark", "evaluation", "grader", "rubric", "score" — fuerza estructuralmente a que el adaptador describa el *trabajo*, no su medición.

### CLI y ciclo de vida de un run

Scripts de entrada (`pyproject.toml` → `[project.scripts]`): `harness2` (ejecuta el sweep de adaptación), `harness2-judge`, `harness2-report`, `harness2-setup`, `harness2-check`, `harness2-demo`, `harness2-bridge`. Flujo típico: `harness2-setup <bench>` (clona dependencias pineadas, aplica parches, construye entornos) → `harness2-check` (verifica credenciales/config sin llamar al modelo) → `harness2 --bench ... --k N --mode parallel|sequential` (el sweep real, costoso) → `harness2-judge` → `harness2-report`. Todo resultado vive en `runs/<bench>/...` y es **reanudable** (resume) repitiendo el mismo comando; usar un namespace nuevo (`HARNESS2_RUNS_DIR`) al cambiar modelos o selección de tareas.

## Abstracciones y Convenciones Clave

- **`Tree = dict[str, str]`** (`core/tree.py`) — la abstracción más simple y potente del repo: un harness completo es solo un mapa ruta→contenido. Todo lo demás (validación, diff, escritura a disco, diversidad) son funciones puras sobre ese dict.
- **`SurfaceSpec`** — parametriza en datos (no en código) todo lo que difiere entre sustratos: qué archivos son always-on, su cap de tamaño, regex de nombres de skill, si requiere `mode: subagent`, el esquema de hooks soportado, etc. Añadir un tercer sustrato (p.ej. Claude Code nativo) implicaría, en teoría, solo escribir un nuevo `SurfaceSpec` + implementación de `Substrate`.
- **"Omitted-is-inherited"** — el contrato de edición: una propuesta solo emite los archivos que cambia; lo que no toca se hereda sin reescritura. Elegante y barato de diffear/auditar.
- **`BenchPrompts` / `BenchSpec`** — el "molde" que cada benchmark rellena con valores (nunca con ramas de código): texto del trabajo, "levers" por dimensión INV/DOM, yardstick de buen proceso, criterios de selección, modo de instalación. `resolve_channel_model` fuerza que canal y modelo se sobreescriban juntos (nunca uno sin el otro) para evitar un mismatch silencioso bare-id vs provider-prefixed.
- **`RunView`** — explícitamente *nunca lleva un score* (comentario: "Never carries a score"). El pipeline de recursión/selección es ciego al juez por construcción de tipos, no solo por convención.
- **Ledger / identidad R=4k, P=3k** — contabilidad formal y verificable del presupuesto experimental por tarea.
- **Anonimización de candidatos con IDs estables** (`assign_ids`) — shuffle determinista basado en hash de `task_id|k|mode`, reproducible entre reruns.
- **Formato de trayectoria compartido** `[ACTION]/[OBSERVATION]/[ERROR]` — normaliza lo que cada sustrato produce a una gramática común legible por los modelos proponentes.
- **`harness2-bridge`** — un proxy LiteLLM local que permite usar modelos Vertex (Gemini/Claude) a través de la Responses API que Codex espera, preservando credenciales ADC y "thought signatures" de Gemini en llamadas a herramientas.

## Fortalezas

1. **Rigor experimental real**: contabilidad exacta de presupuesto (`Ledger.assert_identity`), caching por fingerprint de contenido, reproducibilidad vía seeds documentada explícitamente (`docs/EXPERIMENTS.md`), partición train/test reproducible (`scripts/split_tasks.py`), comparación contra baseline (`harness2-judge --bases`). Esto es mucho más riguroso que la mayoría de repos de "agentic harness" open-source.
2. **Separación de ejes de diseño limpísima**: método vs. sustrato vs. benchmark, con Protocols explícitos (`BenchmarkAdapter`, `SubstrateLike`, `Substrate`) en vez de herencia. Permite razonar sobre cada eje independientemente.
3. **Seguridad de evidencia tomada en serio como invariante, no como guideline**: los tripwires `assert_no_leak_paths` / `assert_no_grader_verdicts` lanzan excepción (no logging/warning) y el propio código documenta que **no se deben silenciar ampliando la lista de marcadores** sino corrigiendo el leak real. Muy poco común ver esta disciplina en código de investigación.
4. **La jerarquía de costo de componentes del harness** (always-on text > skill > script > subagent > plugin/hook, en orden de preferencia inverso) es una pieza de conocimiento de ingeniería de agentes genuinamente transferible, condensada en los prompts de `core/prompts.py`.
5. **Selección ciega al harness, basada en artefacto producido** — evita que el "compositor" se autoevalúe o que el selector sea engañado por un harness verboso/sofisticado en apariencia.
6. **Librería de experiencia con niveles de verdict (`helped|hurt|no observed effect|confounded`)** — distingue explícitamente correlación de causalidad y prefiere "confounded" a una atribución inventada; esto es higiene epistemológica poco frecuente en sistemas de "agent memory".
7. **Reintentos con feedback verbatim**: cuando una propuesta de harness falla validación, el error se reinyecta textualmente en el siguiente intento (`_run_stage` en `recursion.py`), cerrando el loop propose→validate→retry sin intervención humana.
8. **Documentación operativa excelente** (`docs/SETUP.md`, `BENCHMARKS.md`, `EXPERIMENTS.md`) con advertencias concretas de seguridad (p.ej. que un rollout de Codex en JobBench descargó la rúbrica sin que se le pidiera, y la recomendación de bloquear hosts a nivel de red).

## Debilidades

1. **No es un harness de producción, es un harness de *investigación sobre harnesses***. No hay loop de ejecución "para un usuario final" — todo gira en torno a benchmarks con un juez (`score()`) y rollouts caros (4k por tarea). Adaptarlo a "construir software rápido" requeriría eliminar casi toda la capa de optimización experimental y quedarse solo con el árbol c1..c8 + validación + sustratos.
2. **Fuertemente acoplado a la noción de "tarea aislada con un deliverable comparable"**: el modelo de selección ciega (comparar artefactos anónimos) asume que cada rollout produce un artefacto autocontenible que se puede juzgar sin contexto del proceso. Para software iterativo (un PR que modifica un repo vivo, con historia y dependencias), ese modelo de "artefacto único comparable" no aplica directamente.
3. **El "dominio" es plano y de un solo nivel** (`domain_of(task_id)` → una sola carpeta en la librería). No hay jerarquía de dominios ni composición entre librerías de distintos dominios — para un software factory con muchos proyectos/módulos relacionados esto sería limitante.
4. **Dependencia dura de Vertex AI / Google Cloud** (`GOOGLE_CLOUD_PROJECT`, ADC, ids con prefijo `google-vertex/...`) y de dos ejecutores concretos (OpenCode, Codex). Portarlo a otro proveedor de modelos o a Claude Code nativo como sustrato exigiría escribir un nuevo `Substrate` + `SurfaceSpec`, lo cual el código permite pero no viene gratis.
5. **Coste**: cada tarea cuesta 4k rollouts + 3k sesiones de modelo por diseño (`k=1` ya es 4 rollouts + 3 sesiones). Esto es aceptable para investigación (puntuar mejoras de harness en benchmarks) pero carísimo como mecanismo *en vivo* para cada tarea de desarrollo real.
6. **La lógica de negocio real sí vive fuera de `harness2/core`**: en los adaptadores de benchmark (`harness2/benchmarks/jobbench.py`, `workbuddy.py`, `lab.py`) y en `third_party/*_runner` (parches sobre los repos originales de los benchmarks). Es decir, confirma la hipótesis del usuario pero al revés de lo esperado: el "harness" en el sentido de árbol c1..c8 es genérico y reutilizable, pero *quién ejecuta la tarea y cómo se puntúa* (la lógica específica del dominio) vive en los adaptadores — exactamente el patrón que sforge querría replicar, salvo que aquí el "runner de la tarea" (OpenCode/Codex ejecutando contra un benchmark) es él mismo bastante pesado y específico de benchmark (contenedores Docker para WorkBuddy, entornos venv pineados por benchmark, etc.).
7. **Ninguna gestión de memoria/contexto "en vivo" dentro de una sola sesión larga** — toda la gestión de contexto aquí es *entre* rollouts (construir árboles de evidencia para el proponer), no *dentro* de una ejecución larga de agente (eso lo delega enteramente a OpenCode/Codex como cajas negras).
8. **El paper es de 2026 y usa modelos (GLM-5, Gemini 3.5 Flash) y referencias que no puedo verificar de forma independiente** — hay que tomar las cifras de mejora reportadas (hasta 11.8 puntos) con la cautela normal de cualquier benchmark propio.

## Qué rescatar para sforge

1. **El árbol de componentes editables (c1..c8) como vocabulario común de "qué es un harness"**: system prompt, guardrails, memoria, tool guidance, subagentes, skills, scripts, plugins/hooks — con su jerarquía explícita de costo/alcance. Esto es directamente aplicable como *esquema* para que sforge describa y versiona el harness de cada proyecto, independientemente del framework de ejecución elegido.
2. **La separación en tres ejes ortogonales (método / sustrato / dominio-proyecto)** vía Protocols — es el patrón exacto para que sforge separe: (a) el motor de orquestación domain-agnostic, (b) el adaptador al framework de agentes concreto (Claude Code, OpenCode, Codex, lo que sea), y (c) el adaptador al proyecto/dominio concreto (cómo se ejecuta una tarea, qué cuenta como "entregado", cómo se puntúa/verifica).
3. **Validación de harness pre-ejecución, con reglas duras y feedback verbatim en el reintento**: antes de "gastar" una ejecución cara, validar estructuralmente la propuesta (sintaxis, referencias a archivos existentes, triggers de skills, caps de tamaño) y, si falla, reinyectar el error textual para que el siguiente intento se autocorrija. Aplicable directamente al loop de generación de agentes de sforge.
4. **Los tripwires de "evidence is data, not instructions" y "no judge/verdict leakage" como invariantes de tipo, no de convención**: si sforge alguna vez usa un modelo para evaluar el trabajo de otro agente, aislar estrictamente qué contexto ve el evaluador (y aserciones explícitas, no solo prompts, que impidan fugas) es una práctica a copiar literalmente.
5. **El concepto de librería de experiencia por dominio, con verdicts tipados (`helped|hurt|no observed effect|confounded`) y campos `cue/lesson/evidence/confidence`**: una forma disciplinada de hacer "memoria a largo plazo entre tareas" que evita que el sistema memorice ruido o alucine causalidad. SForge podría adoptar este esquema para su propia capa de "lecciones aprendidas por proyecto/dominio".
6. **"Omitted is inherited" como contrato de edición de harness** — simplifica enormemente el versionado y el diffing de harnesses entre iteraciones; aplicable a cómo sforge versiona configuraciones de agente.
7. **Lo que NO rescatar tal cual**: la maquinaria entera de recursión Propose-Probe-Compose con presupuesto 4k/3k, pensada para *investigar* qué harness es mejor en benchmarks académicos. Para un software factory en producción, esto se traduciría más razonablemente en un proceso *mucho* más ligero: generar una propuesta de harness, validarla estructuralmente, probarla en una tarea real, y versionar el resultado — sin los k candidatos paralelos ni la selección ciega por anonimización, que son costosos y están diseñados para producir *evidencia estadística* más que para producir *rápidamente* un buen harness utilizable.
8. **Conclusión de encaje**: Harness² confirma que "harness" = sistema específico de tarea/dominio que ejecuta el loop del agente (prompts, memoria, skills, tools) — y aporta un vocabulario y una disciplina de validación/versionado de ese harness que vale la pena adoptar como *capa de esquema* bajo la capa de orquestación domain-agnostic de sforge. Pero la capa de *meta-optimización* del propio harness (todo `core/recursion.py`, `selection.py`, `ledger.py`) es investigación de Google sobre *cómo automejorar un harness contra un benchmark*, no un componente que sforge deba ejecutar en caliente en cada tarea — es, como mucho, inspiración para un proceso *offline* y ocasional de "auto-tuning de harness" sobre un conjunto de tareas de referencia del propio proyecto.
