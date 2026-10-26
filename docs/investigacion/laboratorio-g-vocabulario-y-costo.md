# Laboratorio G — señales de mercado: vocabulario y métricas de costo

Investigación interna sobre dos piezas de contenido conceptual que circulan en la industria sobre
"software factories" con agentes. Evaluadas con criterio: una aportó vocabulario y métricas
genuinamente útiles; la otra fue revisada y descartada por bajo valor (ver nota al final).

## Lo que sí aporta valor

### Evolución de terminología: de "prompt engineering" a "loop engineering"

La disciplina ha ido renombrando su propio frente: prompt engineering → context engineering →
"harness engineering" (tratar el andamiaje alrededor del modelo como lo que de verdad se diseña y
evoluciona — coincide exactamente con el vocabulario del Laboratorio B) → y ahora "loop engineering"
(reemplazar prompts sueltos por loops que re-promptean al agente automáticamente). Este último
término es nuevo para nuestra investigación y describe bien lo que ya construimos en Capa 1: el
loop de reintento con feedback verbatim de `ph.call()` es, en este vocabulario, "loop engineering"
aplicado.

### El problema de contexto "vivo" vs. documentación estática

Argumento bien armado: documentos de diseño, wikis, `AGENTS.md`/`SKILL.md` son todos artefactos
**estáticos** — describen cómo se veía el mundo la última vez que alguien escribió algo. En un
entorno donde el estado cambia constantemente (despliegues, cambios de esquema, incidentes), el
intervalo entre "alguien guardó un documento" y "ahora mismo" es donde un agente puede tomar
decisiones con información obsoleta.

**Por qué importa:** nuestro concepto de "el cerebro" (Laboratorio D/E) es, tal como está descrito
hoy, más memoria de decisiones acumuladas que estado operativo en vivo. Vale la pena anotar esta
distinción explícitamente para cuando diseñemos la capa de memoria real: "el cerebro" debería poder
distinguir entre hechos estables (decisiones de arquitectura) y estado que cambia constantemente
(qué está desplegado ahora mismo, qué cambió en la última hora) — no tratarlos igual.

### Taxonomía de roles de agente, más amplia que "revisor de código"

Propone pensar la factory no solo en roles de desarrollo (arquitecto, builder, revisor) sino
extenderla a roles operativos: agentes de confiabilidad/operaciones, de seguridad, y de plataforma —
cada uno con su contraparte humana tradicional. Generaliza el patrón de "varios revisores
especializados en paralelo" del Laboratorio E más allá de seguridad/UX/UI/código.

### Costo como métrica de primera clase, con una lista concreta y accionable

La pieza más directamente aplicable de toda esta ronda: una lista explícita de métricas de costo que
deberían vivir junto a las métricas de calidad/velocidad habituales — gasto de tokens por tarea
completada, costo por iteración de un gate/revisor, ratio de intentos aceptados vs. descartados,
iteraciones promedio hasta aceptación por tipo de agente, tiempo total ahorrado por flujo. Ninguno de
los Laboratorios A–F había propuesto esto como una dimensión explícita del trazado.

**Por qué importa:** nuestro `Trace` (Capa 1) ya registra eventos, pero no tiene ningún campo
pensado para costo/tokens/duración. Es una extensión barata y bien justificada — ver el cambio
aplicado en `orbit-core/src/trace.ts` esta misma sesión.

## Nota: la segunda pieza revisada, descartada

Una guía general tipo "qué es una AI software factory" se leyó completa y se descartó como fuente de
valor real: es contenido de marketing/SEO que repite el pipeline obvio (requisitos → arquitectura →
implementación → pruebas → revisión → despliegue → iteración) ya cubierto con mucho más rigor
mecánico por los Laboratorios A y E, sin ningún mecanismo, métrica o patrón que no estuviera ya en
nuestra investigación. Se documenta aquí solo para dejar constancia de que se revisó y se decidió
conscientemente no construir un laboratorio aparte para ella — no por descuido.

## Qué rescatar para orbit-core

1. Adoptar el vocabulario "loop engineering" internamente para describir el mecanismo de
   reintento-con-feedback de `ph.call()` — ya construido, solo le faltaba nombre.
2. Anotar la distinción hechos-estables vs. estado-vivo como requisito futuro de la capa de memoria
   (todavía no construida).
3. Generalizar el patrón de revisores en paralelo (Laboratorio E) a roles operativos además de
   roles de desarrollo, como opción de Capa 2 — no como cambio de la Capa 1 agnóstica.
4. Campos de costo en el trazado — implementado ya en Capa 1 (ver `DESIGN.md`).
