# Síntesis: de 8 laboratorios a orbit-core

Base: ocho líneas de investigación interna propia, documentadas en [`investigacion/`](investigacion/)
(Laboratorios A–H — A–E de la primera ronda, F–H de una segunda ronda hecha ya con Capa 1 construida,
para corregir rumbo antes de invertir en Capa 0).

## 1. La hipótesis harness-vs-factory, confirmada con evidencia

Las cinco líneas de investigación, leídas juntas, convergen en la misma definición de "harness" — y confirman la intuición original casi palabra por palabra:

> **Laboratorio B** — formulación encontrada en esa investigación: *"A harness is the system around a model that enables it to act as an agent: prompts, tools, memory, skills, orchestration, and more. Harnessing is the process of optimizing that system."*

Un harness = el árbol de 8 componentes que el Laboratorio B formaliza (system prompt, guardrails, memoria, tool guidance, subagentes, skills, scripts, plugins/hooks) **aplicado a un dominio/proyecto concreto**. Es donde vive la lógica de negocio.

Una factory = la capa que decide **qué harness usar, cómo se construye, cómo se valida y cómo se le da seguimiento**, sin saber nada del dominio. Y sí, una factory necesita uno o más harnesses como motor — nunca ejecuta trabajo real por sí sola.

Lo interesante es que cada laboratorio aterriza en un punto distinto de ese espectro:

| Laboratorio | Qué es realmente | Dónde vive la lógica de negocio |
|---|---|---|
| **A** | Un harness de dominio (SDLC de código) construido sobre primitivas de orquestación limpias | En los prompts/agentes (`planner`, `builder`, `reviewer`...) y en el script de calidad — el framework (`Phase`, `Envelope`, `Gate`, permisos, trazado) es agnóstico |
| **B** | Investigación sobre cómo *optimizar* un harness, no un harness en sí | En los adaptadores de benchmark — el árbol c1-c8 y el método de validación son agnósticos |
| **C** | Un conjunto de prácticas de calidad/disciplina que se inyectan a un harness ya existente | No tiene lógica de negocio propia; asume que ya existe un repo con arquitectura — es "higiene" transversal |
| **D** | Infraestructura de instalación + catálogo de capacidades + portabilidad multi-asistente | Explícitamente *no* lleva lógica de negocio — la memoria real del proyecto es un efecto emergente del uso, no viene incluida |

Conclusión: **ninguno de los cuatro es "la factory" completa**. El Laboratorio A es el único que de verdad separa mecánicamente código-determinista de agente-acotado con un framework reusable. Los otros tres aportan piezas que le faltan: portabilidad multi-asistente (D), disciplina de prueba/calidad (C), y un vocabulario riguroso para versionar/validar harnesses (B).

## 2. Qué aporta cada laboratorio, en una frase

- **A** → el esqueleto de orquestación: fase, envelope tipado, gate post-hoc, permisos reactivos, trazado a un solo camino de datos.
- **B** → el vocabulario para describir y validar *cualquier* harness (árbol c1-c8) + la separación en tres ejes ortogonales (método / sustrato / dominio).
- **C** → la fase de "Prove" (evidencia verificable antes de reclamar éxito) y los mecanismos anti-trampa de un gate de revisión externo.
- **D** → el catálogo de capacidades validado por esquema + el patrón de adaptador de 3 capas para portar el mismo contenido a muchos asistentes distintos.
- **E** → revisores en paralelo con modelo distinto al builder (anti-sesgo) + un gate de riesgo de despliegue independiente del gate de calidad.

## 3. Solapamientos reales (no hay que llevarse todo)

- **Los gates internos del Laboratorio A** y **el gate de revisión externo del Laboratorio C** resuelven el mismo problema (criterio de "terminado" verificable) a distinta escala: A es determinista sobre un envelope; C es un juez externo con mecanismos anti-trampa. orbit-core debería tener **un solo concepto de "gate"** con dos implementaciones posibles (interno/determinista vs. externo/juez), no dos sistemas paralelos.
- **El árbol c1-c8 del Laboratorio B** y **el catálogo de skills/memoria del Laboratorio D** describen casi la misma cosa (qué compone un harness) desde ángulos distintos: B lo hace formal y versionable; D lo hace práctico e instalable. Son complementarios, no redundantes — B da el *esquema*, D da el *mecanismo de instalación y portabilidad*.
- **Los permisos reactivos del Laboratorio A** (snapshot + diff) y **el aislamiento por worktree del Laboratorio C** atacan el mismo riesgo (un agente daña el repo) en capas distintas: A es reactivo dentro de un mismo working tree; C es preventivo vía aislamiento físico. orbit-core adopta **ambos, en capas**: aislamiento físico primero, detección/rollback como red de seguridad adicional.

## 3bis. Dos patrones del Laboratorio E (no estaban en A–D)

El Laboratorio E — una demostración en producción de la misma línea de investigación del Laboratorio D — aporta dos piezas que ningún otro laboratorio cubría:

1. **Diversidad deliberada de modelos como mecanismo anti-sesgo.** El modelo que construye (builder) nunca es el que revisa: cada revisor usa una familia de modelo distinta a la del builder, y la elección de modelo por revisor es deliberada (uno especializado en computer-use para UI, uno "menor" a propósito para code review porque es la tarea que menos preocupa). La razón explícita: el modelo que escribió el código estaría sesgado si se usara a sí mismo para revisar su propio trabajo. Esto es más fino que el reviewer único del Laboratorio A o el juez externo del C — propone **multiplicidad de revisores, cada uno con modelo distinto al autor**, no solo un segundo par de ojos.
2. **Un gate de riesgo de despliegue, separado del gate de calidad.** Después de que los revisores aprueban (gate de calidad, ya cubierto por A/C), hay un paso adicional que clasifica el *riesgo de negocio* del cambio (¿toca backend/core/DB o es cosmético?) y decide merge automático a `main` vs. PR + aprobación humana obligatoria — reforzado con hooks/código, nunca solo con el criterio del agente clasificador. Ningún otro laboratorio modela esto como *gate independiente*: A tiene gates de calidad pero no un gate de "¿esto necesita que un humano lo vea antes de producción?".

Ambos patrones son agnósticos de dominio (no dependen de qué construye el agente) y encajan en la Capa 2 (pipeline de calidad) sin romper nada de lo ya propuesto — se añaden como sub-pasos, no como una capa nueva.

## 3ter. Segunda ronda (F–H): qué cambió con Capa 1 ya construida

Con el motor de Capa 1 ya funcionando, una segunda ronda de investigación (un reporte de campo real,
señales de mercado, y un sistema comparable con UI propia) confirmó dos decisiones y motivó un
cambio real de alcance para la Capa 0 que viene:

- **Confirmado dos veces, por fuentes distintas**: un layer de reporting/UI visual deja de ser
  opcional a cierta escala de uso — tanto el reporte de campo (Laboratorio F) como el sistema
  comparable (Laboratorio H) llegan a la misma conclusión por caminos distintos. No se construye
  ahora (es Capa 3+), pero deja de ser "quizás algún día" para ser "cuando llegue el momento, ya
  sabemos por qué".
- **Aplicado ya en Capa 1**: costo (tokens, USD, duración) como dimensión de primera clase del
  trazado, no un añadido posterior — motivado por el Laboratorio G y validado por un caso real de
  gasto evitable en el Laboratorio F. Ver `../DESIGN.md`.
- **Cambia el alcance de Capa 0** (todavía no construida): en vez de un único adaptador de sustrato
  fijo, el `Substrate` debería nacer como un enrutador con reglas declarativas (qué modelo para qué
  tipo de fase) más una cadena de fallback entre proveedores, y debería poder producir/consumir un
  paquete de traspaso serializable para continuar una tarea sobre un sustrato distinto al que
  empezó. Esto responde a un problema real y costoso documentado en el Laboratorio F (traspasos
  manuales caóticos al agotarse la cuota de un proveedor) con un mecanismo concreto observado en el
  Laboratorio H (enrutamiento declarativo con fallback automático).
- **Evaluado y descartado conscientemente**: un sandbox de VM de nube como aislamiento (Laboratorio
  H) — más fuerte que worktree, pero resuelve un problema que no tenemos hoy; queda anotado como
  adaptador opcional de Capa 2 para más adelante, no como requisito.
- **Una fuente revisada y descartada por bajo valor** (parte del Laboratorio G): una guía genérica
  tipo "qué es una AI software factory" no aportó ningún mecanismo nuevo — se documenta que se
  revisó, para no tener que releerla.

## 4. Arquitectura en capas de orbit-core

```
┌─────────────────────────────────────────────────────────┐
│ Capa 4 — Harness de proyecto (NO es parte de orbit-core) │
│ Agentes/prompts/criterios de calidad específicos de       │
│ cada proyecto                                              │
├─────────────────────────────────────────────────────────┤
│ Capa 3 — Catálogo de capacidades (lab. D)            ✅ v0  │
│ Skills con schema validado, evals de routing,              │
│ convención "NOT x (that is sibling)"                       │
├─────────────────────────────────────────────────────────┤
│ Capa 2 — Pipeline de calidad (lab. C + A + E)               │
│ Aislamiento (worktree)                              ✅ v0   │
│ → Build → Revisores en paralelo con modelos distintos        │
│ al builder → Gate de calidad → Gate de riesgo de              │
│ despliegue (auto-merge vs. humano) → Ship       (pendiente)  │
├─────────────────────────────────────────────────────────┤
│ Capa 1 — Motor de orquestación (lab. A, generalizado)       │
│ Phase / Envelope+tríada / Gate / Permisos post-hoc /        │
│ Trazado de un solo camino / Resumption de sesión    ✅ v0   │
├─────────────────────────────────────────────────────────┤
│ Capa 0 — Enrutador de sustrato (lab. B + D + H)              │
│ Protocol por sustrato (Claude Code, Codex, OpenCode...) +    │
│ reglas declarativas de enrutamiento con fallback +            │
│ traspaso serializable entre sustratos        ✅ v0, en vivo  │
└─────────────────────────────────────────────────────────┘
```

Cada capa es trasplantable con bastante literalidad desde su laboratorio de origen — ya está detallado en el "Qué rescatar para orbit-core" de cada archivo en `investigacion/`. Lo que NO debería entrar en la Capa 0-3 (porque es lógica de negocio, no factory): los agentes concretos del Laboratorio A (`planner`/`builder`/...), los cientos de skills concretos del Laboratorio D (son contenido del catálogo, no el mecanismo del catálogo), y toda la maquinaria de meta-optimización del Laboratorio B (es investigación, no algo que corra en caliente por tarea).

**Estado actual**: las cuatro capas tienen un v0 real y probado — **Capa 0 incluida, en vivo**, no solo con stubs. El bloqueo de credenciales inicial (`claude` sin login propio) se resolvió con `claude auth login`; `claudeCodeSubstrate` corrió de punta a punta contra un modelo real (`npm run example:capa0-live`, gasta cuota real a propósito — separado de los demás ejemplos que son gratis): el envelope parseó, el gate pasó, y el costo real (tokens + USD) quedó grabado en la traza, no como placeholder. Capa 1: `Phase`/`Envelope`/`Gate`/permisos/trazado. Capa 2: aislamiento físico por worktree + permisos de Capa 1 juntos (`../CAPA2.md`). Capa 3: catálogo con schema Zod, manifest con drift check, 3 skills reales cruzadas entre sí (`../CAPA3.md`). Falta el resto del pipeline de calidad de Capa 2 (revisores en paralelo, gate de riesgo) y correr los evals de Capa 3 contra un juez real — ya no bloqueado por credenciales, solo pendiente de construirse.

## 5. Qué construir primero (para no caer en los 3 meses de diseño)

Orden de ataque recomendado, de más a menos maduro/barato de construir:

1. **Capa 1 (motor de orquestación)** — ✅ hecho (v0): `Phase`/`Envelope`/`Gate`/permisos/trazado funcionando y probados de punta a punta contra un sustrato de pruebas.
2. **Capa 0 (un adaptador real + el enrutador mínimo alrededor)** — ✅ hecho y **verificado en vivo**.
   El router/fallback/traspaso están probados de verdad (`npm run example:capa0`, gratis); el
   adaptador a Claude Code corrió contra un modelo real (`npm run example:capa0-live`, gasta cuota
   real a propósito) después de resolver el login del CLI (`claude auth login`). Ver
   `../CAPA0.md`.
3. **Capa 2 (pipeline de calidad mínimo)** — ✅ hecho (v0, solo aislamiento): worktree físico (lab. C)
   combinado con los permisos de Capa 1, probado de verdad (`npm run example:capa2`), incluyendo un
   bug real que solo apareció al correrlo (el worktree por defecto quedaba dentro del repo y lo
   ensuciaba — corregido a directorio hermano). Pendiente: revisores en paralelo + gate de riesgo de
   despliegue (lab. E) — ya no bloqueado por falta de sustrato (Capa 0 funciona), solo pendiente de
   construirse.
4. **Capa 3 (catálogo de capacidades)** — ✅ hecho (v0): schema con Zod (no una segunda librería de
   validación), manifest generado con drift check, evals de enrutamiento linteados, 3 skills reales
   sobre el propio orbit-core (no cientos), probado de verdad incluyendo el lado del fallo
   (`npm run example:capa3` + un chequeo negativo corrido aparte). Pendiente: ejecutar los evals
   contra un juez real — técnicamente desbloqueado, todavía sin implementar.
5. **Meta-optimización (lab. B)** — ignorar por completo hasta que orbit-core tenga al menos un proyecto real funcionando con las capas 0-3. Es la pieza de mayor costo y menor urgencia.

**Milestone de éxito**: no "la arquitectura de 5 capas está completa", sino "usé orbit-core para llevar una tarea real de mi propio proyecto de punta a punta, con traza completa y al menos un gate automático". Las cuatro capas tienen ya un v0 probado por separado — incluida Capa 0 en vivo. Lo que falta para el milestone completo es encadenarlas en un solo pipeline real, no desbloquear nada más.

## 6. Próximo paso sugerido

Encadenar lo ya probado por separado en un solo pipeline real: una tarea que pase por worktree
aislado (Capa 2) → una fase `agent` contra `claudeCodeSubstrate` real (Capa 0) → gates (Capa 1) →
opcionalmente consultando el catálogo de skills (Capa 3) — sobre un proyecto de verdad, no un
sandbox desechable. Esa es la primera verificación genuina de punta a punta del sistema completo.
