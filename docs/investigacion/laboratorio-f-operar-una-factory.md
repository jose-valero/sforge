# Laboratorio F — práctica observada: operar una factory real durante dos semanas

Investigación interna sobre un reporte de campo en primera persona: alguien construyó una
herramienta de producción musical completa usando una "software factory" de agentes, durante dos
semanas, documentando qué funcionó y qué no. Es el material más valioso de esta ronda de
investigación — no es teoría, son fallos y decisiones reales con sus costos.

## Diseño inicial de la factory descrita

Un agente "lead"/orquestador explícitamente instruido para **no hacer trabajo él mismo**, siempre
delegar a subagentes. Un sistema de tracking de tareas (tipo backlog/kanban) que el orquestador
alimenta descomponiendo la especificación. Decisiones mayores se escalan a un humano que revisa en
checkpoints programados (revisión nocturna), y cuando dos personas deciden algo juntas, queda
registrado en un "decision log" rodante. La especificación es la fuente de verdad — vive en el
propio repo, sujeta a revisión igual que el código. Todo el trabajo de subagentes pasa por PR contra
`main`, con CI obligatorio y una revisión arquitectónica adversarial automática antes de poder
mergear (un agente separado, corriendo por webhook y además por cron cada hora para no perder nada).

## Hallazgos que SÍ son nuevos respecto a los Laboratorios A–E

### 1. "Los orquestadores regresan a ser ejecutores" (patrón de fallo documentado)

El agente orquestador, pese a instrucciones explícitas de solo delegar, tiende constantemente a
meterse a hacer trabajo de IC (individual contributor) él mismo — a veces resuelve bloqueos así,
pero más seguido termina pisando el trabajo de un subagente, sobrescribiéndolo, o atascándose en
loops. El autor lo compara con cualquier manager recién ascendido que no logra soltar el trabajo
operativo. Observado con **todos** los modelos probados, en distinto grado.

**Por qué importa para sforge:** esto es un argumento de peso para una práctica concreta que
nuestra Capa 1 ya puede imponer sin cambios: a un agente con rol "orquestador" se le debería asignar
un `allow` **vacío o casi vacío** en `permissions.ts` — el mismo mecanismo de detección/revert que
ya construimos, aplicado como política por defecto a cualquier agente cuyo trabajo es delegar, no
escribir. No es una idea nueva de mecanismo, es una recomendación de *uso* del mecanismo que ya
existe.

### 2. Protocolo de "handoff" entre proveedores de modelo distintos, no solo resumption de sesión

Al agotar cuota de un proveedor (~48h de uso constante), el trabajo se transfiere a un orquestador
corriendo sobre un modelo de **otro proveedor por completo** — no es resumption de la misma sesión
(eso ya lo cubre nuestro `sessionId`), es traspasar el estado completo de una tarea en curso a un
sustrato distinto. El mecanismo que terminó funcionando: un documento de traspaso escrito
explícitamente (actualiza el backlog, registra el estado actual, define el procedimiento), generado
por el agente saliente para el entrante. Los primeros traspasos fueron caóticos (trabajo repetido,
decisiones perdidas, ramas abandonadas) hasta iterar el protocolo.

**Por qué importa:** esto es directamente relevante para la Capa 0 que estamos por construir. Nuestro
`Substrate` actual asume resumption dentro del mismo sustrato (`sessionId`). Haría falta un segundo
mecanismo — un "paquete de traspaso" serializable que un sustrato pueda producir y otro consumir —
para manejar caídas/límites de cuota sin perder contexto. No lo construimos hoy, pero lo anotamos
como requisito real de Capa 0, con evidencia de que sin él el costo de los primeros traspasos es
alto (trabajo duplicado, decisiones perdidas).

### 3. Las trazas NO deben vivir encerradas en la conversación de un agente

Al principio, las trazas de los subagentes quedaban atrapadas dentro de la conversación del
orquestador principal — eso rompió los primeros intentos de "handoff" porque el siguiente
orquestador no tenía forma de leerlas. Tuvo que rediseñarse para que las trazas fueran accesibles
fuera de cualquier conversación de agente específica.

**Validación de una decisión ya tomada:** nuestro `Trace` (Capa 1) ya está diseñado exactamente para
evitar este problema — es SQLite externo, no vive dentro de la sesión de ningún agente. Esta
investigación confirma que esa decisión de diseño evita un fallo real y documentado, no solo
teórico.

### 4. El costo de cómputo es el cuello de botella práctico, no la calidad del modelo

Con dos planes de pago "pro" corriendo en paralelo, la factory solo podía correr ~48h antes de
quedarse sin cuota. Un detalle concreto y evitable: todo el contenido de audio de muestra se había
commiteado al repo, inflando cada build/test de CI — un "self-own" que, corregido (excluir el
contenido pesado, modularizar qué se testea completo vs. parcial), redujo el gasto de CI
significativamente. Lección explícita del propio reporte: *"eres tan bueno como tu cuello de botella
más apretado"* — paralelismo/rendimiento importa más que usar siempre el modelo más caro en cada
paso.

### 5. "Los errores se acumulan": la aritmética de por qué los gates no son ceremonia

Articulación cuantificada y citable: si una tasa de éxito del 95% baja a 90% al quitar supervisión
directa, la diferencia compuesta tras 7 iteraciones es 70% vs. 48%. La clave es corregir
constantemente de vuelta al 100% en checkpoints — si no, el sistema completo se puede ir a pique.
Es el mismo principio que ya tenemos en los gates de la Capa 1/2, pero con una cifra concreta que
vale la pena citar como justificación de por qué los gates no son opcionales.

### 6. Legibilidad como EL problema central, no un detalle de UX

El hallazgo más repetido y mejor argumentado del reporte: a medida que una factory corre sola por
más tiempo, los agentes desarrollan su propio vocabulario interno críptico (el reporte cita un
ejemplo real de un agente resumiendo el backlog con jerga totalmente ilegible para un humano).
Revisar cambios a nivel de código deja de ser viable a cierta escala — ni un humano experto puede
auditar cada PR. La conclusión del autor: hace falta una capa de reporting *visual* (tableros,
diagramas, resúmenes) para que un humano pueda dirigir la factory "un nivel arriba", igual que un
líder de equipo no lee cada mensaje de Slack de cada canal.

**Por qué importa:** valida que un layer de UI/reporting (no solo un log de eventos crudo) no es un
lujo ni scope creep — es una necesidad real que aparece con el tiempo de uso. Relevante para una
futura Capa 3 (o una "Capa 2.5" de reporting), no urgente para Capa 0/1 hoy.

## Qué NO es nuevo (ya cubierto por A–E, solo reconfirmado)

- Aislamiento por rama/worktree por tarea — ya cubierto por el Laboratorio C.
- Especificación como fuente de verdad, versionada en el propio repo — ya cubierto por el
  Laboratorio D (lanes FTD/SDD).
- Revisión adversarial automática antes de mergear — ya cubierto por el Laboratorio C (gate de
  revisión externo).
- Deriva hacia jerga/tono de IA en el texto producido — ya cubierto por la práctica de higiene de
  comunicación del Laboratorio C ("unslop"), ahora con evidencia de campo de que es un problema real
  y creciente, no cosmético.

## Qué rescatar para sforge

1. **Política de `allow` vacío para agentes con rol "orquestador"** — documentar como práctica
   recomendada de Capa 2, reusando el mecanismo de permisos ya construido en Capa 1, sin cambios de
   código.
2. **Protocolo de traspaso entre sustratos distintos** (no solo resumption dentro del mismo) como
   requisito explícito de diseño para la Capa 0 que construiremos a continuación.
3. **Métricas de costo (tokens, tiempo, $ por tarea/iteración) como dimensión de primera clase del
   trazado**, no un añadido posterior — consistente con el Laboratorio G.
4. **Un layer de reporting/visualización no es opcional a cierta escala** — anotado como necesidad
   futura real (Capa 3), con evidencia de campo, no solo intuición de diseño.
