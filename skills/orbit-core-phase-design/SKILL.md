---
name: orbit-core-phase-design
description: >-
  Use when designing a new Phase (engineer/agent/code), Envelope, or Gate for
  an orbit-core pipeline. NOT for physical isolation of a task (that is
  orbit-core-worktree-isolation) and NOT for deciding what an agent may write
  (that is orbit-core-permissions-policy).
tags: [orbit-core, capa-1, phase, envelope, gate]
recommends: [orbit-core-worktree-isolation, orbit-core-permissions-policy]
origin: orbit-core
profiles: [core]
---

# Diseñar una fase de orbit-core

## El primitivo

Toda unidad de trabajo es un `Phase(kind, owner, description)`. Arranca en `fail`; solo una salida
limpia la sube a `success`. `kind` es siempre uno de tres:

- `human` — un humano aprueba o decide, no hay agente.
- `agent` — un agente razona; su única salida válida es un envelope tipado.
- `code` — determinista. Si ya sabes el comando exacto, es código, nunca un agente.

## La tríada sincronizada (la regla que más rompe pipelines si se ignora)

Para una fase `agent`, el schema de Zod (`defineEnvelope({...})`), el ejemplo que ve el modelo en el
prompt, y el `schema` que se le pasa a `ph.call()` tienen que ser la misma forma. Si cambias uno,
cambias los tres en el mismo commit — grep el nombre del tipo para encontrar los tres sitios.

## Gates: verifican afirmaciones, nunca predicen

Un gate corre **después** de que el envelope ya existe, contra lo que el envelope afirma. No
distingas "gate de calidad" de "gate de riesgo" a nivel de tipo — son el mismo primitivo
`(envelope) => GateReport`, aplicado en fases distintas. Esa distinción es decisión de *pipeline*
(qué gates registras y dónde), no del motor.

## Checklist antes de dar una fase por diseñada

1. ¿La `description` dice algo real, o es un eco del nombre de la fase? (`assertRealDescription` la
   rechaza si es trivial — mejor que lo pienses tú primero).
2. ¿El envelope tiene un schema único, reusado en los tres sitios de la tríada?
3. ¿Los gates verifican el envelope, o están intentando adivinar el futuro?
4. ¿`retries` en la fase es para reintentar el cuerpo completo, o confundiste eso con
   `maxJsonFixAttempts` (que es solo para corregir JSON roto en la misma sesión)?
