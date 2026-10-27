---
name: sforge-permissions-policy
description: >-
  Use when deciding what paths a specific agent is allowed to write inside
  an already-isolated workspace. NOT for isolating the task physically from
  the main repo (that is sforge-worktree-isolation) and NOT for the
  phase/gate mechanics around the agent call itself (that is
  sforge-phase-design).
tags: [sforge, capa-1, capa-2, permisos, seguridad]
recommends: [sforge-worktree-isolation]
origin: sforge
profiles: [core]
---

# Decidir qué puede escribir un agente

## El principio

"tools es una lista de capacidades, writes es la frontera." Que un agente tenga la herramienta
`bash` no dice nada sobre qué rutas puede tocar — `writes`/`allow` es la frontera real, aplicada en
código, después del hecho (`snapshot()` antes, `enforceWrites()` después).

## Política recomendada: el orquestador no escribe

Un agente con rol "orquestador" (delega trabajo, no lo hace él mismo) debería tener `allow: []` —
vacío. No hace falta una API nueva para esto: ya es expresable hoy con `enforceWrites({ allow: [] ,
... })`. Si el orquestador escribe algo, se revierte igual que cualquier otra brecha. Esto no es
paranoia — es la forma barata de imponer en código una disciplina que, dejada solo al prompt, se
rompe con el tiempo (los orquestadores tienden a "meterse a programar" en sesiones largas).

## Qué pasa si la ruta ya estaba sucia antes de que el agente corriera

`enforceWrites` no finge arreglar lo que no puede: si una ruta ya tenía cambios sin commitear
*antes* de la llamada, se reporta como `left-dirty`, no se revierte (revertir borraría trabajo del
humano que nunca tocó el agente). Solo se revierte lo que el propio agente ensució.

## Checklist

1. ¿El `allow` de este agente es tan angosto como puede serlo, no "todo el repo por si acaso"?
2. ¿Es un agente orquestador? Entonces `allow: []`.
3. ¿Tomaste el snapshot `before` *antes* de la llamada al agente, no después?
4. Si hay una brecha, ¿revisaste si quedó `reverted` o `left-dirty` antes de seguir — un
   `left-dirty` significa que había trabajo previo que no se tocó, no que el sistema falló.
