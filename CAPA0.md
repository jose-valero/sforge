# Capa 0 — enrutador de sustrato

Ver [`DESIGN.md`](./DESIGN.md) para Capa 1 y [`../sintesis-orbit-core.md`](../sintesis-orbit-core.md)
sección 3ter para por qué Capa 0 cambió de alcance (de "un adaptador fijo" a "un enrutador con
fallback") antes de empezar a construirla.

## Qué hay en `src/substrates/`

- **`router.ts`** — `substrateRouter()`: reglas declarativas (`when(route) => substrate`), evaluadas
  en orden; si el sustrato elegido lanza, reintenta con la cadena de `fallback` dada. Cero
  dependencias del resto de Capa 1 — implementa el mismo `Substrate` que `echoSubstrate`, así que es
  intercambiable sin tocar `phase.ts`.
- **`claude-code.ts`** — `claudeCodeSubstrate()`: adaptador real, invoca el CLI de `claude` en modo
  headless (`-p --output-format json`) como subproceso. Usa `--resume` para continuar una sesión,
  `--fallback-model` nativo del CLI para respaldo *entre modelos de un mismo proveedor*,
  `--permission-prompts none` por defecto (un subproceso sin humano esperando no debe poder
  colgarse en un prompt de permiso), y `--max-budget-usd` si se configura.
- **`handoff.ts`** — `buildHandoff()` / `handoffPrompt()`: empaqueta el estado de un run (desde su
  `Trace` real) en algo serializable para sembrar el prompt de un sustrato distinto al que empezó la
  tarea. Traspaso *entre proveedores*, no resumption dentro del mismo.

## Qué se probó de verdad, sin credenciales

`examples/capa0-router.ts` corre cuatro casos reales (no mocks de aserción, comportamiento real):

1. Un sustrato "primario" que siempre falla + uno de respaldo — el router cae al backup
   automáticamente y la fase termina en éxito.
2. Enrutamiento declarativo por `owner`: dos roles (`planner`/`reviewer`) llegan a sustratos
   distintos según la regla — confirmado comparando las respuestas, no solo que no hubo excepción.
3. Un router sin `fallback` configurado falla limpio con `RoutingError` (no se cuelga, no lanza algo
   genérico) cuando su único sustrato falla.
4. `buildHandoff()` construido desde la traza SQLite real de un run ya terminado — el paquete trae
   el cursor correcto del último evento y un resumen generado a partir de los eventos reales, no de
   datos inventados.

Correrlo: `npm run example:capa0`.

Separado, el parser de `claude-code.ts` (`is_error`, clasificación de error de auth, extracción de
`session_id`/`usage`/`total_cost_usd`) se verificó contra una respuesta **real** del CLI, capturada
en esta misma sesión — no inventada. Ver la nota de bloqueo abajo para el porqué era un error y no
una respuesta exitosa.

## Verificado en vivo (desbloqueado)

El bloqueo de credenciales original (`claude` sin login propio, sin `ANTHROPIC_API_KEY`) se resolvió
corriendo `claude auth login` en esta máquina. Confirmado con una llamada real mínima
(`claude -p ... --model haiku`): `is_error:false`, `result` correcto, costo y uso de tokens
reportados — y luego, lo que de verdad importa, **con nuestro propio adaptador**:

`examples/capa0-live.ts` (`npm run example:capa0-live` — **gasta cuota real**, deliberadamente
separado del resto de ejemplos que son gratis) corre una fase `agent` de Capa 1 contra
`claudeCodeSubstrate` apuntando a un modelo real (`haiku`, prompt mínimo para mantener el costo
bajo) y confirma, con datos reales, no simulados:

1. El modelo respondió, el envelope parseó contra nuestro schema Zod, y el gate `envelopeSucceeded`
   pasó.
2. El campo `usage` (tokens, costo) llegó con números reales (`tokensIn: 10, tokensOut: 119,
   costUsd: 0.028251` en la corrida de verificación) y quedó grabado en la traza como evento
   `"usage"` — el campo que añadimos en la segunda ronda de investigación (Laboratorio G) ahora
   funciona con datos reales, no con el placeholder vacío de `echoSubstrate`.
3. Todo el camino Capa 0 → Capa 1 (sustrato real → `ph.call()` → parseo → gate → trazado) corrió sin
   intervención manual más allá del comando inicial.

**Pendiente, no bloqueado**: probar el `--resume` de sesión con una segunda llamada encadenada, y
probar el enrutador (`substrateRouter`) con `claudeCodeSubstrate` real en la cadena en vez de
sustratos de eco — ambos son extensiones directas de lo ya verificado, no nuevos riesgos.
