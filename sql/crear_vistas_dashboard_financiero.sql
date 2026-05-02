-- ============================================================================
-- VISTAS ANALÍTICAS PARA DASHBOARD FINANCIERO / PDF
-- Cobertura: día, semana, mes, año
-- Incluye soporte de filtro por cajero_id
-- ============================================================================

-- 1) ESTADO DE RESULTADOS -----------------------------------------------------
-- Ventas (sin crédito), compras, gastos, planilla y costos operativos.

DROP VIEW IF EXISTS public.vw_estado_resultados_periodo;

CREATE VIEW public.vw_estado_resultados_periodo AS
WITH granularidades AS (
  SELECT 'dia'::text AS periodo_tipo
  UNION ALL SELECT 'semana'::text
  UNION ALL SELECT 'mes'::text
  UNION ALL SELECT 'anio'::text
),
ventas_agg AS (
  SELECT
    g.periodo_tipo,
    v.cajero_id,
    CASE
      WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', v.fecha_hora)
      WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', v.fecha_hora)
      WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', v.fecha_hora)
      ELSE date_trunc('year', v.fecha_hora)
    END AS periodo_inicio,
    SUM(CASE WHEN upper(coalesce(v.tipo, '')) <> 'CREDITO' THEN coalesce(v.total, 0) ELSE 0 END)::numeric(14,2) AS ventas
  FROM public.ventas v
  CROSS JOIN granularidades g
  GROUP BY 1,2,3
),
gastos_agg AS (
  SELECT
    g.periodo_tipo,
    (to_jsonb(ga) ->> 'cajero_id')::text AS cajero_id,
    CASE
      WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', ga.fecha::timestamp)
      WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', ga.fecha::timestamp)
      WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', ga.fecha::timestamp)
      ELSE date_trunc('year', ga.fecha::timestamp)
    END AS periodo_inicio,
    SUM(coalesce(ga.monto, 0))::numeric(14,2) AS gastos
  FROM public.gastos ga
  CROSS JOIN granularidades g
  GROUP BY 1,2,3
),
compras_agg AS (
  SELECT
    g.periodo_tipo,
    (to_jsonb(c) ->> 'cajero_id')::text AS cajero_id,
    CASE
      WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', c.fecha::timestamp)
      WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', c.fecha::timestamp)
      WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', c.fecha::timestamp)
      ELSE date_trunc('year', c.fecha::timestamp)
    END AS periodo_inicio,
    SUM(coalesce(c.monto, 0))::numeric(14,2) AS compras
  FROM public.compras c
  CROSS JOIN granularidades g
  GROUP BY 1,2,3
),
planilla_agg AS (
  SELECT
    g.periodo_tipo,
    (to_jsonb(p) ->> 'cajero_id')::text AS cajero_id,
    CASE
      WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', p.fecha_pago::timestamp)
      WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', p.fecha_pago::timestamp)
      WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', p.fecha_pago::timestamp)
      ELSE date_trunc('year', p.fecha_pago::timestamp)
    END AS periodo_inicio,
    SUM(coalesce(p.monto, 0))::numeric(14,2) AS planilla
  FROM public.planilla p
  CROSS JOIN granularidades g
  GROUP BY 1,2,3
),
costos_agg AS (
  SELECT
    g.periodo_tipo,
    (to_jsonb(co) ->> 'cajero_id')::text AS cajero_id,
    CASE
      WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', co.fecha::timestamp)
      WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', co.fecha::timestamp)
      WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', co.fecha::timestamp)
      ELSE date_trunc('year', co.fecha::timestamp)
    END AS periodo_inicio,
    SUM(coalesce(co.monto, 0))::numeric(14,2) AS costos_operativos
  FROM public.costos_operativos co
  CROSS JOIN granularidades g
  GROUP BY 1,2,3
),
pagos_proveedores_agg AS (
  SELECT
    g.periodo_tipo,
    (to_jsonb(pp) ->> 'cajero_id')::text AS cajero_id,
    CASE
      WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', pp.fecha_hora)
      WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', pp.fecha_hora)
      WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', pp.fecha_hora)
      ELSE date_trunc('year', pp.fecha_hora)
    END AS periodo_inicio,
    SUM(coalesce(pp.monto, 0))::numeric(14,2) AS pagos_proveedores
  FROM public.pagos_proveedores pp
  CROSS JOIN granularidades g
  GROUP BY 1,2,3
),
keys AS (
  SELECT periodo_tipo, cajero_id, periodo_inicio FROM ventas_agg
  UNION
  SELECT periodo_tipo, cajero_id, periodo_inicio FROM gastos_agg
  UNION
  SELECT periodo_tipo, cajero_id, periodo_inicio FROM compras_agg
  UNION
  SELECT periodo_tipo, cajero_id, periodo_inicio FROM planilla_agg
  UNION
  SELECT periodo_tipo, cajero_id, periodo_inicio FROM costos_agg
  UNION
  SELECT periodo_tipo, cajero_id, periodo_inicio FROM pagos_proveedores_agg
)
SELECT
  k.periodo_tipo,
  k.cajero_id,
  k.periodo_inicio,
  CASE
    WHEN k.periodo_tipo = 'dia' THEN k.periodo_inicio + interval '1 day' - interval '1 second'
    WHEN k.periodo_tipo = 'semana' THEN k.periodo_inicio + interval '1 week' - interval '1 second'
    WHEN k.periodo_tipo = 'mes' THEN k.periodo_inicio + interval '1 month' - interval '1 second'
    ELSE k.periodo_inicio + interval '1 year' - interval '1 second'
  END AS periodo_fin,
  coalesce(v.ventas, 0)::numeric(14,2) AS ventas,
  coalesce(c.compras, 0)::numeric(14,2) AS compras,
  coalesce(g.gastos, 0)::numeric(14,2) AS gastos_operativos,
  coalesce(pp.pagos_proveedores, 0)::numeric(14,2) AS pagos_proveedores,
  coalesce(p.planilla, 0)::numeric(14,2) AS planilla,
  coalesce(coa.costos_operativos, 0)::numeric(14,2) AS costos_operativos_fijos,
  (
    coalesce(c.compras, 0)
    + coalesce(g.gastos, 0)
    + coalesce(pp.pagos_proveedores, 0)
    + coalesce(p.planilla, 0)
    + coalesce(coa.costos_operativos, 0)
  )::numeric(14,2) AS total_egresos,
  (
    coalesce(v.ventas, 0)
    - (
      coalesce(c.compras, 0)
      + coalesce(g.gastos, 0)
      + coalesce(pp.pagos_proveedores, 0)
      + coalesce(p.planilla, 0)
      + coalesce(coa.costos_operativos, 0)
    )
  )::numeric(14,2) AS utilidad_neta
FROM keys k
LEFT JOIN ventas_agg v
  ON v.periodo_tipo = k.periodo_tipo
 AND v.cajero_id IS NOT DISTINCT FROM k.cajero_id
 AND v.periodo_inicio = k.periodo_inicio
LEFT JOIN gastos_agg g
  ON g.periodo_tipo = k.periodo_tipo
 AND g.cajero_id IS NOT DISTINCT FROM k.cajero_id
 AND g.periodo_inicio = k.periodo_inicio
LEFT JOIN compras_agg c
  ON c.periodo_tipo = k.periodo_tipo
 AND c.cajero_id IS NOT DISTINCT FROM k.cajero_id
 AND c.periodo_inicio = k.periodo_inicio
LEFT JOIN planilla_agg p
  ON p.periodo_tipo = k.periodo_tipo
 AND p.cajero_id IS NOT DISTINCT FROM k.cajero_id
 AND p.periodo_inicio = k.periodo_inicio
LEFT JOIN costos_agg coa
  ON coa.periodo_tipo = k.periodo_tipo
 AND coa.cajero_id IS NOT DISTINCT FROM k.cajero_id
 AND coa.periodo_inicio = k.periodo_inicio
LEFT JOIN pagos_proveedores_agg pp
  ON pp.periodo_tipo = k.periodo_tipo
 AND pp.cajero_id IS NOT DISTINCT FROM k.cajero_id
 AND pp.periodo_inicio = k.periodo_inicio;


-- 1B) PAGOS A PROVEEDORES CxP POR PERÍODO -----------------------------------

DROP VIEW IF EXISTS public.vw_pagos_proveedores_periodo;

CREATE VIEW public.vw_pagos_proveedores_periodo AS
WITH granularidades AS (
  SELECT 'dia'::text AS periodo_tipo
  UNION ALL SELECT 'semana'::text
  UNION ALL SELECT 'mes'::text
  UNION ALL SELECT 'anio'::text
)
SELECT
  g.periodo_tipo,
  (to_jsonb(pp) ->> 'cajero_id')::text AS cajero_id,
  CASE
    WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', pp.fecha_hora)
    WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', pp.fecha_hora)
    WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', pp.fecha_hora)
    ELSE date_trunc('year', pp.fecha_hora)
  END AS periodo_inicio,
  CASE
    WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', pp.fecha_hora) + interval '1 day' - interval '1 second'
    WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', pp.fecha_hora) + interval '1 week' - interval '1 second'
    WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', pp.fecha_hora) + interval '1 month' - interval '1 second'
    ELSE date_trunc('year', pp.fecha_hora) + interval '1 year' - interval '1 second'
  END AS periodo_fin,
  COUNT(*)::integer AS pagos_registrados,
  SUM(coalesce(pp.monto, 0))::numeric(14,2) AS monto_pagado
FROM public.pagos_proveedores pp
CROSS JOIN granularidades g
GROUP BY 1,2,3,4;


-- 2) REPORTE DE VENTAS --------------------------------------------------------
-- Incluye ventas, recibos emitidos y facturas emitidas.

DROP VIEW IF EXISTS public.vw_reporte_ventas_periodo;

CREATE VIEW public.vw_reporte_ventas_periodo AS
WITH granularidades AS (
  SELECT 'dia'::text AS periodo_tipo
  UNION ALL SELECT 'semana'::text
  UNION ALL SELECT 'mes'::text
  UNION ALL SELECT 'anio'::text
)
SELECT
  g.periodo_tipo,
  v.cajero_id,
  CASE
    WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', v.fecha_hora)
    WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', v.fecha_hora)
    WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', v.fecha_hora)
    ELSE date_trunc('year', v.fecha_hora)
  END AS periodo_inicio,
  CASE
    WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', v.fecha_hora) + interval '1 day' - interval '1 second'
    WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', v.fecha_hora) + interval '1 week' - interval '1 second'
    WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', v.fecha_hora) + interval '1 month' - interval '1 second'
    ELSE date_trunc('year', v.fecha_hora) + interval '1 year' - interval '1 second'
  END AS periodo_fin,
  SUM(CASE WHEN upper(coalesce(v.tipo, '')) <> 'CREDITO' THEN coalesce(v.total, 0) ELSE 0 END)::numeric(14,2) AS ventas_total,
  COUNT(*) FILTER (
    WHERE upper(coalesce(v.tipo_documento_fiscal, 'RECIBO')) = 'RECIBO'
      AND upper(coalesce(v.tipo, '')) <> 'CREDITO'
  )::integer AS recibos_emitidos,
  COUNT(*) FILTER (
    WHERE upper(coalesce(v.tipo_documento_fiscal, '')) = 'FACTURA'
      AND upper(coalesce(v.tipo, '')) <> 'CREDITO'
  )::integer AS facturas_emitidas,
  COUNT(*) FILTER (
    WHERE upper(coalesce(v.tipo, '')) <> 'CREDITO'
  )::integer AS documentos_emitidos
FROM public.ventas v
CROSS JOIN granularidades g
GROUP BY 1,2,3,4;


-- 3) VENTAS POR TIPO DE PRODUCTO ---------------------------------------------
-- Usa productos de la tabla public.productos + detalle de ventas.productos (JSON).
-- Métricas: cantidad vendida, costo, precio de venta, ganancia.

DROP VIEW IF EXISTS public.vw_ventas_producto_periodo;

CREATE VIEW public.vw_ventas_producto_periodo AS
WITH granularidades AS (
  SELECT 'dia'::text AS periodo_tipo
  UNION ALL SELECT 'semana'::text
  UNION ALL SELECT 'mes'::text
  UNION ALL SELECT 'anio'::text
),
lineas AS (
  SELECT
    v.fecha_hora,
    v.cajero_id,
    p.id AS producto_id,
    p.nombre AS nombre_producto,
    p.tipo AS tipo_producto,
    coalesce((it.value->>'cantidad')::numeric, 0) AS cantidad,
    coalesce((it.value->>'precio')::numeric, coalesce(p.precio, 0), 0) AS precio_venta_unitario,
    coalesce(p.costo, 0) AS costo_unitario
  FROM public.ventas v
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN trim(coalesce(v.productos, '')) = '' THEN '[]'::jsonb
      ELSE v.productos::jsonb
    END
  ) it(value)
  LEFT JOIN public.productos p
    ON p.id::text = coalesce(it.value->>'id', '')
  WHERE upper(coalesce(v.tipo, '')) <> 'CREDITO'
    AND p.id IS NOT NULL
)
SELECT
  g.periodo_tipo,
  l.cajero_id,
  CASE
    WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', l.fecha_hora)
    WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', l.fecha_hora)
    WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', l.fecha_hora)
    ELSE date_trunc('year', l.fecha_hora)
  END AS periodo_inicio,
  CASE
    WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', l.fecha_hora) + interval '1 day' - interval '1 second'
    WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', l.fecha_hora) + interval '1 week' - interval '1 second'
    WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', l.fecha_hora) + interval '1 month' - interval '1 second'
    ELSE date_trunc('year', l.fecha_hora) + interval '1 year' - interval '1 second'
  END AS periodo_fin,
  l.producto_id,
  l.nombre_producto,
  l.tipo_producto,
  SUM(l.cantidad)::numeric(14,2) AS cantidad_vendida,
  AVG(l.costo_unitario)::numeric(14,2) AS costo_unitario,
  AVG(l.precio_venta_unitario)::numeric(14,2) AS precio_venta_unitario,
  SUM(l.cantidad * l.costo_unitario)::numeric(14,2) AS costo_total,
  SUM(l.cantidad * l.precio_venta_unitario)::numeric(14,2) AS venta_total,
  SUM(l.cantidad * (l.precio_venta_unitario - l.costo_unitario))::numeric(14,2) AS ganancia
FROM lineas l
CROSS JOIN granularidades g
GROUP BY 1,2,3,4,5,6,7;


-- 4) COMIDAS VENDIDAS (VISTA ESPECIAL) --------------------------------------
-- Toma productos tipo 'comida' desde tabla productos y cruza con detalle JSON de ventas.

DROP VIEW IF EXISTS public.vw_comidas_vendidas_periodo;

CREATE VIEW public.vw_comidas_vendidas_periodo AS
WITH granularidades AS (
  SELECT 'dia'::text AS periodo_tipo
  UNION ALL SELECT 'semana'::text
  UNION ALL SELECT 'mes'::text
  UNION ALL SELECT 'anio'::text
),
lineas_comida AS (
  SELECT
    v.fecha_hora,
    v.cajero_id,
    p_match.id AS producto_id,
    p_match.nombre AS nombre_producto,
    p_match.tipo AS tipo_producto,
    coalesce((it.value->>'cantidad')::numeric, 0) AS cantidad,
    coalesce((it.value->>'precio')::numeric, coalesce(p_match.precio, 0), 0) AS precio_venta_unitario,
    coalesce(p_match.costo, 0) AS costo_unitario
  FROM public.ventas v
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN trim(coalesce(v.productos, '')) = '' THEN '[]'::jsonb
      ELSE v.productos::jsonb
    END
  ) it(value)
  LEFT JOIN LATERAL (
    SELECT p.id, p.nombre, p.tipo, p.precio, p.costo
    FROM public.productos p
    WHERE lower(coalesce(p.tipo, '')) = 'comida'
      AND (
        p.id::text = coalesce(it.value->>'id', '')
        OR lower(trim(coalesce(p.nombre, ''))) = lower(trim(coalesce(it.value->>'nombre', '')))
      )
    ORDER BY CASE WHEN p.id::text = coalesce(it.value->>'id', '') THEN 0 ELSE 1 END
    LIMIT 1
  ) p_match ON true
  WHERE upper(coalesce(v.tipo, '')) <> 'CREDITO'
    AND p_match.id IS NOT NULL
)
SELECT
  g.periodo_tipo,
  l.cajero_id,
  CASE
    WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', l.fecha_hora)
    WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', l.fecha_hora)
    WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', l.fecha_hora)
    ELSE date_trunc('year', l.fecha_hora)
  END AS periodo_inicio,
  CASE
    WHEN g.periodo_tipo = 'dia' THEN date_trunc('day', l.fecha_hora) + interval '1 day' - interval '1 second'
    WHEN g.periodo_tipo = 'semana' THEN date_trunc('week', l.fecha_hora) + interval '1 week' - interval '1 second'
    WHEN g.periodo_tipo = 'mes' THEN date_trunc('month', l.fecha_hora) + interval '1 month' - interval '1 second'
    ELSE date_trunc('year', l.fecha_hora) + interval '1 year' - interval '1 second'
  END AS periodo_fin,
  l.producto_id,
  l.nombre_producto,
  SUM(l.cantidad)::numeric(14,2) AS cantidad_vendida,
  AVG(l.costo_unitario)::numeric(14,2) AS costo_unitario,
  AVG(l.precio_venta_unitario)::numeric(14,2) AS precio_venta_unitario,
  SUM(l.cantidad * l.costo_unitario)::numeric(14,2) AS costo_total,
  SUM(l.cantidad * l.precio_venta_unitario)::numeric(14,2) AS venta_total,
  SUM(l.cantidad * (l.precio_venta_unitario - l.costo_unitario))::numeric(14,2) AS ganancia
FROM lineas_comida l
CROSS JOIN granularidades g
GROUP BY 1,2,3,4,5,6;


-- Permisos de lectura para los mismos perfiles que usan las tablas operativas
GRANT SELECT ON public.vw_estado_resultados_periodo TO authenticated, anon;
GRANT SELECT ON public.vw_pagos_proveedores_periodo TO authenticated, anon;
GRANT SELECT ON public.vw_reporte_ventas_periodo TO authenticated, anon;
GRANT SELECT ON public.vw_ventas_producto_periodo TO authenticated, anon;
GRANT SELECT ON public.vw_comidas_vendidas_periodo TO authenticated, anon;
