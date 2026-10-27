# Capa 1 — decisiones de diseño

Este paquete es la primera pieza real de `sforge` (ver [`./docs/sintesis-sforge.md`](./docs/sintesis-sforge.md)
y [`./docs/investigacion/laboratorio-a-motor-de-fases.md`](./docs/investigacion/laboratorio-a-motor-de-fases.md)). Implementa
el motor de orquestación de la Capa 1: `Phase`, `Envelope`, `Gate`, permisos post-hoc y trazado — generalizado
fuera de SDLC, que es el dominio en el que vive el Laboratorio A (su fuente de investigación original).

## Por qué TypeScript/Node, no Python

El Laboratorio A (la fuente principal de Capa 1) está en Python. Decidí portar a TypeScript por tres razones
concretas, no por preferencia personal:

1. **El sustrato principal que vas a orquestar es Claude Code**, que es un CLI de Node. Un motor en el mismo
   runtime que su sustrato más importante se integra con menos fricción (hooks, MCP servers, `settings.json`
   son todos JSON/JS-nativos).
2. **El modelo de distribución que ya validó el Laboratorio D** (la investigación que más se parece a "cómo se
   instala esto en un proyecto real") es un paquete npm instalable con `npx`. Si `sforge` también crece
   hacia eso, empezar en el mismo ecosistema evita una migración después.
3. **Zod es un equivalente directo de Pydantic** para el patrón de "tríada sincronizada" (schema, ejemplo en
   el prompt, `output_type` del sitio de llamada) que el Laboratorio A usa — no se pierde rigor de tipos al
   cambiar de lenguaje.

Esto es una decisión tomada, no una pregunta abierta — si más adelante un sustrato concreto obliga a Python
(por ejemplo, porque el framework de agentes del día es Python-first), Capa 0 es exactamente el punto donde
eso se aísla sin tocar Capa 1.

## Generalizaciones hechas sobre el Laboratorio A (y por qué)

- **`PhaseKind` es `"human" | "agent" | "code"`**, no `"engineer" | "agent" | "code"`. "Engineer" asume que
  quien aprueba es un ingeniero de software; el Laboratorio E ya muestra un caso (tareas de marketing/ventas)
  donde el humano en el loop no programa. Capa 1 no debe asumirlo.
- **No hay un tipo `"gate de calidad"` y otro `"gate de riesgo"`.** Son dos usos del mismo primitivo `Gate`,
  aplicados en fases distintas. Esa distinción es una decisión de *pipeline* (Capa 2), no del motor. Si Capa 1
  hubiera codificado esa dualidad, cualquier pipeline que necesitara un tercer tipo de gate habría estado
  atascado.
- **`WorkspaceAdapter` es una interfaz, con git como implementación por defecto**, no la única. El Laboratorio A
  asume git en toda su capa de permisos; aquí el mecanismo de snapshot/diff/revert está separado de que el
  almacenamiento subyacente sea un repo git.
- **`Substrate` es el seam explícito con Capa 0.** El Laboratorio A está acoplado a un único coding agent
  (hardcoded). Aquí ni siquiera existe un adaptador real todavía — `echoSubstrate` es deliberadamente un stub
  de pruebas, no una implementación con la que construir nada en producción. Cablear Claude Code (headless,
  con resumption de sesión) es el siguiente trabajo real, y vive fuera de este paquete.

## Cambios de una segunda ronda de investigación (Laboratorios F–H)

Una ronda posterior de investigación de campo (ver `./docs/investigacion/laboratorio-f-*.md` a
`laboratorio-h-*.md`) confirmó dos decisiones ya tomadas y motivó un cambio concreto:

- **Confirmado:** `Trace` vive fuera de cualquier conversación de agente (SQLite externo). Un
  reporte de campo documentó fallos de traspaso de contexto justamente por tener trazas atrapadas
  dentro de la sesión de un orquestador — nuestro diseño ya evita ese problema.
- **Confirmado:** `Trace.since(runId, cursor)` (consulta por cursor) es compatible tal cual con un
  futuro transporte de streaming hacia una UI, sin rediseño.
- **Cambio aplicado:** `AgentCallResult.usage` (`src/substrate.ts`) y `durationMs` en el payload de
  `phase_end` (`src/phase.ts`). El costo (tokens, USD, duración) es una dimensión de primera clase
  del trazado desde ahora, no algo a retrofitear cuando ya duela. `echoSubstrate` no reporta `usage`
  (sería inventar números falsos) — el campo queda listo para cuando Capa 0 cablee un sustrato real
  que sí sepa cuánto gastó cada llamada.
- **Anotado para Capa 0 (próximo trabajo, cambia su alcance):** el `Substrate` no debería nacer
  como un adaptador único fijo por `Run`, sino como un enrutador con reglas declarativas
  (qué modelo para qué tipo de fase) y una cadena de fallback automático entre proveedores — y
  debería poder producir/consumir un "paquete de traspaso" serializable para cuando un agente deba
  continuar sobre un sustrato distinto al que empezó. Ambos requisitos vienen de problemas reales
  documentados en el Laboratorio F (traspasos manuales caóticos al agotar cuota) y una solución
  concreta observada en el Laboratorio H (enrutamiento declarativo con fallback). No se implementan
  todavía — cambian el *diseño* de Capa 0, no el código ya construido de Capa 1.

## Qué NO se construyó todavía (a propósito)

- **Capa 0 ya tiene código real, verificado en vivo** (`src/substrates/`: router, adaptador a Claude
  Code, traspaso) — ver [`CAPA0.md`](./CAPA0.md). El bloqueo de credenciales que hubo al principio
  ya se resolvió (`claude auth login`); `claudeCodeSubstrate` corrió de punta a punta contra un
  modelo real.
- **Capa 2 ya tiene su v0 (solo aislamiento)** (`src/isolation/worktree.ts`) — ver [`CAPA2.md`](./CAPA2.md).
  `permissions.ts` sigue siendo la red de seguridad *reactiva* (snapshot/diff/revert); el aislamiento
  *preventivo* por worktree es una capa aparte que la complementa, no la reemplaza — las dos se prueban
  juntas en `examples/capa2-worktree.ts`. Pendiente: el resto del pipeline de calidad de Capa 2
  (revisores en paralelo, gate de riesgo de despliegue).
- **Capa 3 ya tiene su v0** (`src/catalog/`, `skills/`) — ver [`CAPA3.md`](./CAPA3.md). Schema con
  Zod, manifest generado con drift check, 3 skills reales propias. Pendiente: correr los evals de
  enrutamiento contra un juez real — ahora desbloqueado técnicamente (Capa 0 ya funciona), pero
  todavía no implementado.
- **Multi-sustrato (resto de Capa 0, más allá de Claude Code).** Ver `./docs/sintesis-sforge.md`
  sección 5 para el orden de ataque completo.
- **`node:sqlite` sigue siendo experimental** en Node 22 (funciona, pero Node lo marca así). Si eso se vuelve
  un problema real de estabilidad, migrar a `better-sqlite3` es un cambio contenido a `trace.ts` — el resto
  del motor no sabe que SQLite existe, solo conoce `Trace.log()` / `Trace.since()`.

## Qué se probó de verdad (no solo que compila)

`examples/hello-pipeline.ts` corre de punta a punta contra un sandbox git desechable en `/tmp` (nunca toca
este repo) y demuestra, con assertions reales, no solo con `console.log`:

1. Una fase `agent` cuyo primer intento devuelve JSON roto a propósito — el reintento con feedback verbatim
   (`envelope_parse_retry` en la traza) corrige sin reiniciar la sesión.
2. Un gate que falla de verdad marca la fase como fallida y lanza (`GateFailure`) — probado aparte con un
   gate que siempre falla, confirmando que no hay forma de "colarse" a `success`.
3. Permisos: una escritura fuera de lo permitido (`oops.txt`) se detecta y se revierte; una escritura dentro
   de lo permitido (`allowed/output.txt`) se conserva intacta.
4. El trazado queda grabado en SQLite con WAL, consultable por cursor — 12 eventos en orden, un solo camino
   de datos.

Correrlo: `npm install && npm run example` (dentro de `sforge/`).
