# Diagnóstico técnico — Radar Ofertas Docentes

Fecha análisis: 2026-07-07

## Bug corregido: `isWithin24h` no filtraba fechas relativas en español

### Síntoma
Las tres ofertas que pasaron el filtro en la ejecución manual de prueba tenían
pubDate de 2, 4 y 5 días respectivamente:
- "hace 2 días" → pasaba como si fuera reciente
- "hace 4 días" → pasaba como si fuera reciente
- "hace 5 días" → pasaba como si fuera reciente

### Causa raíz
SerpAPI con `hl=es` devuelve fechas relativas en español ("hace X días").
La función `isWithin24h` solo tenía regex para inglés (`[2-9] day`, `week`, etc.).
Las cadenas en español caían al bloque `try/catch` donde `new Date("hace 2 días")`
produce `NaN`, y `isNaN(diff) ? true` devolvía siempre `true` (pasa el filtro).

### Fix aplicado
Se añadieron dos regex antes del bloque try/catch:
```js
if (/hace\s+[2-9]\s+d[ií]a/.test(t)) return false;
if (/^[2-9]\s+d[ií]a/.test(t)) return false;
```
Y se extendió la condición de "1 día" para incluir español:
```js
if (/^1\s+day|hace\s+1\s+d[ií]a|hace\s+un\s+d[ií]a/.test(t)) return true;
```

### Impacto
Con el fix, esas tres ofertas habrían sido descartadas correctamente.
Solo pasarían ofertas con pubDate de hoy o hace menos de 30h.

---

## Comportamiento confirmado como correcto

### Ejecuciones rápidas (23ms–59ms) enviando "sin novedades"
Las ejecuciones manuales de la noche del 6 de julio que tardaron ~44ms usaban
datos pineados del editor. `seenIds` ya tenía registrados esos IDs de ejecuciones
anteriores, por lo que devolvían correctamente 0 resultados nuevos → "sin novedades".
No es un bug. Es el comportamiento esperado de la deduplicación cross-run.

### Ejecución #47 (10:00 del 6 de julio) — no llegó a Telegram
El nodo `Adzuna Presencial Madrid` devolvió 503 antes de que se activaran
Retry On Fail / Continue On Fail. El workflow se detuvo sin enviar nada a Telegram.
Corrección ya aplicada: Retry On Fail (3 intentos, 2000ms) + Continue On Fail
en los 4 nodos HTTP Request.

---

## Caso límite pendiente (decisión de negocio)

### Grupo Restalia — "Formador/a Restauración MADRID"
Pasa el filtro porque `hostelería` aparece en el texto, pero el contexto es
gestión comercial de franquicias (100 Montaditos, The Good Burger), no
formación en turismo/hospitalidad en el sentido de la especialización de Helena.

**Opciones para afinar si genera ruido:**
- Opción A: exigir que junto a `hostelería`/`hotelería` aparezca algún término
  como `recepcion`, `alojamiento`, `turístico`, `huésped`, `check-in`.
- Opción B: añadir `restauracion` a `KW_EXCLUIR` si este tipo de ofertas
  se repite con frecuencia y no son relevantes.

No se modifica hasta que Helena confirme si este tipo de oferta le interesa o no.

---

## Próxima ejecución programada a vigilar

La próxima ejecución real es el **7 de julio a las 10:00**. Con los fixes aplicados:
1. Los 4 nodos HTTP tienen Retry + Continue On Fail → no debería romperse por un 503
2. `isWithin24h` ya filtra español → solo pasarán ofertas realmente recientes
3. `seenIds` funciona correctamente en ambos modos (manual y programado)
