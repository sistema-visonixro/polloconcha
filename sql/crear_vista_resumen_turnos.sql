-- =============================================================
--  FIX v_resumen_turnos: DEVOLUCION resta platillos/bebidas
--  Ejecutar en Supabase SQL Editor
-- =============================================================

CREATE OR REPLACE VIEW public.v_resumen_turnos AS

-- 1) Base de turnos desde la misma tabla cierres
--    Nuevo esquema: fecha_apertura / fecha_cierre
--    Compatibilidad: fallback a fecha si aún hay datos antiguos
WITH turnos AS (
  SELECT
    c.id                                              AS apertura_id,
    c.cajero_id,
    c.cajero                                          AS nombre_cajero,
    c.caja,
    COALESCE(c.fecha_apertura, c.fecha)              AS fecha_apertura,
    COALESCE(
      c.fecha_cierre,
      CASE
        WHEN c.estado = 'CIERRE' OR c.tipo_registro = 'cierre' THEN c.fecha
        ELSE NULL
      END,
      (
        SELECT MIN(COALESCE(c2.fecha_cierre, c2.fecha))
        FROM public.cierres c2
        WHERE c2.cajero_id = c.cajero_id
          AND c2.caja      = c.caja
          AND (c2.estado = 'CIERRE' OR c2.tipo_registro = 'cierre')
          AND COALESCE(c2.fecha_cierre, c2.fecha) > COALESCE(c.fecha_apertura, c.fecha)
      ),
      NOW()
    )                                                 AS fecha_cierre
  FROM public.cierres c
  WHERE c.cajero_id IS NOT NULL
    AND c.caja IS NOT NULL
    AND COALESCE(c.fecha_apertura, c.fecha) IS NOT NULL
    AND (
      c.estado = 'APERTURA'
      OR c.estado = 'CIERRE'
      OR c.tipo_registro = 'apertura'
      OR c.tipo_registro = 'cierre'
      OR c.fecha_apertura IS NOT NULL
    )
),

-- 3. Sumar pagos de ventas del turno (excluye CREDITO, incluye DEVOLUCION con negativos)
sumas_ventas AS (
  SELECT
    t.apertura_id,
    COALESCE(SUM(v.efectivo), 0)           AS efectivo_bruto,
    COALESCE(SUM(v.cambio),   0)           AS cambio_devuelto,
    COALESCE(SUM(v.tarjeta), 0)            AS tarjeta,
    COALESCE(SUM(v.transferencia), 0)      AS transferencia,
    COALESCE(SUM(v.dolares), 0)            AS dolares_lps,
    COALESCE(SUM(v.dolares_usd), 0)        AS dolares_usd,
    COALESCE(SUM(v.total), 0)              AS total_ventas
  FROM turnos t
  JOIN public.ventas v
    ON  v.cajero_id  = t.cajero_id
    AND v.fecha_hora >= t.fecha_apertura
    AND v.fecha_hora <  t.fecha_cierre
    AND v.tipo       != 'CREDITO'
  GROUP BY t.apertura_id
),

-- 4. Sumar gastos del turno
sumas_gastos AS (
  SELECT
    t.apertura_id,
    COALESCE(SUM(g.monto), 0) AS total_gastos
  FROM turnos t
  LEFT JOIN public.gastos g
    ON  g.cajero_id  = t.cajero_id
    AND g.caja       = t.caja
    AND g.fecha_hora >= t.fecha_apertura
    AND g.fecha_hora <  t.fecha_cierre
  GROUP BY t.apertura_id
),

-- 5. Expandir JSON de productos — incluye tipo de venta para firmar la cantidad
items_expandidos AS (
  SELECT
    t.apertura_id,
    v.es_donacion,
    v.tipo                                              AS venta_tipo,
    item ->> 'tipo'                                     AS item_tipo,
    COALESCE((item ->> 'cantidad')::numeric, 1)         AS cantidad
  FROM turnos t
  JOIN public.ventas v
    ON  v.cajero_id  = t.cajero_id
    AND v.fecha_hora >= t.fecha_apertura
    AND v.fecha_hora <  t.fecha_cierre
    AND v.tipo       != 'CREDITO'
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN v.productos IS NOT NULL
       AND v.productos::text != ''
       AND v.productos::text != 'null'
      THEN v.productos::jsonb
      ELSE '[]'::jsonb
    END
  ) AS item
),

-- 6. Agregar conteos — DEVOLUCION resta (factor -1)
conteos AS (
  SELECT
    apertura_id,
    SUM(
      CASE WHEN item_tipo = 'comida' AND (es_donacion IS NOT TRUE)
        THEN CASE WHEN venta_tipo = 'DEVOLUCION' THEN -cantidad ELSE cantidad END
        ELSE 0
      END
    ) AS platillos_vendidos,
    SUM(
      CASE WHEN item_tipo = 'bebida' AND (es_donacion IS NOT TRUE)
        THEN CASE WHEN venta_tipo = 'DEVOLUCION' THEN -cantidad ELSE cantidad END
        ELSE 0
      END
    ) AS bebidas_vendidas,
    SUM(CASE WHEN item_tipo = 'comida' AND es_donacion = TRUE THEN cantidad ELSE 0 END) AS platillos_donados,
    SUM(CASE WHEN item_tipo = 'bebida' AND es_donacion = TRUE THEN cantidad ELSE 0 END) AS bebidas_donadas
  FROM items_expandidos
  GROUP BY apertura_id
)

-- 7. Resultado final
SELECT
  t.apertura_id,
  t.cajero_id,
  t.nombre_cajero,
  t.caja,
  t.fecha_apertura,
  t.fecha_cierre,
  ROUND(COALESCE(sv.efectivo_bruto,  0) - COALESCE(sv.cambio_devuelto, 0)
        - COALESCE(sg.total_gastos, 0), 2)                AS efectivo_neto,
  ROUND(COALESCE(sv.efectivo_bruto,  0), 2)               AS efectivo_bruto,
  ROUND(COALESCE(sv.cambio_devuelto, 0), 2)               AS cambio_devuelto,
  ROUND(COALESCE(sg.total_gastos,    0), 2)               AS gastos,
  ROUND(COALESCE(sv.tarjeta,         0), 2)               AS tarjeta,
  ROUND(COALESCE(sv.transferencia,   0), 2)               AS transferencia,
  ROUND(COALESCE(sv.dolares_usd,     0), 2)               AS dolares_usd,
  ROUND(COALESCE(sv.dolares_lps,     0), 2)               AS dolares_lps,
  ROUND(COALESCE(sv.total_ventas,    0), 2)               AS total_ventas,
  COALESCE(c.platillos_vendidos, 0)                        AS platillos_vendidos,
  COALESCE(c.bebidas_vendidas,   0)                        AS bebidas_vendidas,
  COALESCE(c.platillos_donados,  0)                        AS platillos_donados,
  COALESCE(c.bebidas_donadas,    0)                        AS bebidas_donadas,
  COALESCE(c.platillos_vendidos, 0) + COALESCE(c.platillos_donados, 0) AS total_platillos,
  COALESCE(c.bebidas_vendidas,   0) + COALESCE(c.bebidas_donadas,   0) AS total_bebidas

FROM turnos t
LEFT JOIN sumas_ventas sv ON sv.apertura_id = t.apertura_id
LEFT JOIN sumas_gastos  sg ON sg.apertura_id = t.apertura_id
LEFT JOIN conteos        c ON  c.apertura_id = t.apertura_id

ORDER BY t.fecha_apertura DESC;

GRANT SELECT ON public.v_resumen_turnos TO authenticated;
GRANT SELECT ON public.v_resumen_turnos TO anon;
GRANT SELECT ON public.v_resumen_turnos TO service_role;
