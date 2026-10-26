# Capa 2 — aislamiento (v0 mínimo)

Ver [`DESIGN.md`](./DESIGN.md) (Capa 1) y [`CAPA0.md`](./CAPA0.md) (Capa 0). Esta es la primera
pieza de Capa 2 — por diseño, solo el aislamiento físico por worktree; el resto de la "Capa 2 —
Pipeline de calidad" completa (revisores en paralelo, gate de riesgo de despliegue) queda para
después, según el orden de ataque de [`./docs/sintesis-orbit-core.md`](./docs/sintesis-orbit-core.md)
sección 5.

## Qué hay en `src/isolation/worktree.ts`

- **`checkIsolation(repoPath)`** — scope check (Laboratorio C): lista worktrees existentes y rutas
  sucias del repo principal, *antes* de crear nada. No bloquea nada por sí solo — devuelve
  información para que quien llama decida.
- **`createWorktree(opts)`** — `git worktree add <ruta> -b <prefix>/<slug> <baseRef>`. Nombre de
  tarea convertido a `lowercase-with-hyphens` + sufijo único (acentos normalizados — "Añadir
  Facturación" → `anadir-facturacion-<sufijo>`, no un slug roto con letras perdidas).
- **`removeWorktree(handle, opts)`** — `git worktree remove` + `git branch -D` forzado (tras un
  merge con squash/rebase, `-d` sin forzar se niega aunque la rama ya esté integrada — documentado
  en el Laboratorio C, reproducido aquí tal cual).
- **`createWorktree({ linkNodeModules: true })`** — enlaza (symlink) `node_modules` del repo
  principal dentro del worktree. Sin esto, cualquier import a un paquete npm real (no solo librerías
  propias del repo) falla con `ERR_MODULE_NOT_FOUND` dentro del worktree — un worktree es un
  checkout git nuevo, y git no versiona `node_modules`. Encontrado corriendo el pipeline real contra
  `envelope.ts` (que importa `zod`): el agente escribió un test correcto, pero la infraestructura del
  worktree no lo dejó correr. Opt-in (default `false`) porque no todo proyecto usa npm.

## Decisión de diseño que cambió al correr el ejemplo (no solo al escribirlo)

La primera versión ponía los worktrees en `<repo>/.worktrees/<tarea>` — **dentro** del repo. Al
correr `examples/capa2-worktree.ts` de verdad, eso rompió la garantía central de Capa 2: `git
status` del repo principal mostraba `.worktrees/` como ruta sin trackear, es decir, el aislamiento
no aislaba nada. Corregido: el directorio raíz de worktrees ahora es **hermano** del repo
(`<repo>.worktrees/`, fuera de su árbol), no un subdirectorio — así el repo principal nunca tiene
nada que mostrar en su propio `git status`, sin depender de un `.gitignore` que alguien podría no
tener o no respetar. Es exactamente el tipo de cosa que solo se descubre corriendo el código, no
leyéndolo — por eso el ejemplo no es opcional.

## Cómo se combina con Capa 1 (y por qué las dos capas, no una sola)

`examples/capa2-worktree.ts` prueba las dos capas de seguridad juntas, no por separado:

1. Aislamiento físico (este módulo) garantiza que el repo principal nunca se toca.
2. Dentro del worktree, los permisos reactivos de Capa 1 (`gitWorkspaceAdapter` +
   `enforceWrites()`, ya construidos) siguen aplicando igual que en `hello-pipeline.ts` — una
   escritura fuera de lo permitido (`debug-scratch.log`) se detecta y revierte *dentro* del
   worktree, mientras que la permitida (`allowed/invoice.ts`) se conserva.

Confirmado con el ejemplo: ninguna de las dos capas sustituye a la otra. El aislamiento protege el
repo principal de lo que pase en el worktree; los permisos protegen el worktree mismo de escrituras
fuera de lo acordado por ese agente en particular.

## Qué NO se construyó todavía (a propósito)

- **Política "orquestador con `allow` vacío"** (Laboratorio F) — queda como práctica recomendada,
  no como código nuevo: ya es expresable con `enforceWrites({ allow: [] })` tal cual existe hoy, sin
  necesitar una API dedicada.
- **Revisores en paralelo con modelo distinto al builder, gate de riesgo de despliegue** (Laboratorio
  E) — eso es la segunda mitad de "Capa 2 — Pipeline de calidad" en la síntesis, y depende de tener
  un sustrato real funcionando (Capa 0, bloqueada por credenciales — ver `CAPA0.md`).
- **Juez externo de revisión, grabación de evidencia** (Laboratorio C) — explícitamente pospuesto,
  "fase 2 de Capa 2" según el orden de ataque ya acordado.

## Qué se probó de verdad

`examples/capa2-worktree.ts` corre contra un repo git desechable en `/tmp` (nunca toca este repo) y
confirma, con aserciones reales:

1. El worktree se crea en disco, con la rama correcta activa dentro.
2. El repo principal permanece con `git status` limpio durante y después del trabajo en el worktree.
3. Dentro del worktree, una escritura fuera de lo permitido se revierte; la permitida se conserva.
4. La limpieza (`removeWorktree`) borra el directorio y la rama; nada queda huérfano.

Correrlo: `npm run example:capa2`.
