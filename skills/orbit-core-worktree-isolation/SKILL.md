---
name: orbit-core-worktree-isolation
description: >-
  Use when a task needs to run in its own isolated copy of a git repo before
  any agent touches it. NOT for deciding what paths an agent may write once
  it's already isolated (that is orbit-core-permissions-policy) and NOT for
  designing the phases that run inside the worktree (that is
  orbit-core-phase-design).
tags: [orbit-core, capa-2, worktree, aislamiento, git]
recommends: [orbit-core-permissions-policy, orbit-core-phase-design]
origin: orbit-core
profiles: [core]
---

# Aislar una tarea con worktree

## Por qué existe esto, aparte de los permisos de Capa 1

El aislamiento físico (`createWorktree`) y los permisos reactivos (`enforceWrites`) resuelven el
mismo riesgo — un agente daña el repo — en momentos distintos. El worktree evita que el repo
principal se entere siquiera de que algo pasó; los permisos detectan y revierten *dentro* del
worktree lo que ya se escribió fuera de lo acordado. Usa las dos, no elijas una.

## El error que solo aparece al correrlo, no al leerlo

El directorio raíz de worktrees **nunca** debe vivir dentro del repo (`<repo>/.worktrees/`) — git lo
ve como una ruta sin trackear y el `git status` del repo principal deja de estar limpio, que es
justo lo que el aislamiento existe para evitar. Por defecto, `createWorktree` ya lo pone en un
directorio **hermano** (`<repo>.worktrees/`). Si cambias `worktreesDir`, no lo metas dentro del
repo.

## Secuencia

1. `checkIsolation(repoPath)` — mira antes de crear: ¿ya hay worktrees activos?, ¿el repo principal
   está sucio? No bloquea nada por sí solo, solo informa.
2. `createWorktree({ repoPath, taskName, baseRef })` — el nombre de tarea se convierte a
   `lowercase-con-guiones` + sufijo único; los acentos se normalizan (no se pierden letras).
3. Dentro del worktree, el `cwd` para fases/gates/permisos es la ruta del worktree, nunca la del
   repo principal.
4. `removeWorktree(handle, { force: true })` después de mergear — borra el directorio y fuerza el
   borrado de la rama (`-D`, porque tras un merge con squash/rebase `-d` se niega aunque la rama ya
   esté integrada).

## Checklist

1. ¿El `baseRef` es el correcto? (`HEAD` funciona en cualquier repo; `origin/main` si de verdad
   quieres partir del remoto).
2. ¿Confirmaste que el repo principal sigue con `git status` limpio después de crear el worktree?
3. ¿La limpieza corre siempre, incluso si la tarea falló? (un worktree huérfano es deuda silenciosa).
