-- Diagnóstico: movimientos que forman el stock anterior de "Piezas de pollo"
-- Útil para explicar por qué el stock al inicio del día aparece alto.
-- Zona horaria: America/Tegucigalpa

with piezas as (
  select id, nombre
  from public.insumos
  where lower(trim(nombre)) in ('piezas de pollo', 'pieza de pollo')
  limit 1
),
limite as (
  select
    (date_trunc('day', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa') as inicio_dia_utc
),
movimientos as (
  select
    m.id,
    m.created_at,
    coalesce(nullif(to_jsonb(m) ->> 'fecha_hora', '')::timestamptz, m.created_at) as ts_utc,
    m.tipo,
    m.nota,
    m.cantidad,
    m.saldo_resultante,
    regexp_replace(lower(trim(coalesce(m.tipo, ''))), '[\s-]+', '_', 'g') as tipo_norm,
    upper(trim(coalesce(m.nota, ''))) as nota_norm
  from public.movimientos_inventario m
  join piezas p
    on m.insumo_id::text = p.id::text
  where coalesce(m.item_tipo, '') = 'insumo'
),
clasificados as (
  select
    mv.*,
    case when mv.tipo_norm in ('entrada', 'compra', 'ajuste_positivo', 'produccion_entrada') then mv.cantidad else 0 end as qty_entrada,
    case when mv.tipo_norm in ('salida', 'venta', 'ajuste_negativo', 'produccion_salida') then mv.cantidad else 0 end as qty_salida,
    case when mv.nota_norm = 'MERMA' and mv.tipo_norm in ('salida', 'venta', 'ajuste_negativo', 'produccion_salida') then mv.cantidad else 0 end as qty_merma
  from movimientos mv
)
select
  c.id,
  c.ts_utc at time zone 'America/Tegucigalpa' as fecha_honduras,
  c.tipo,
  c.nota,
  c.cantidad,
  c.qty_entrada,
  c.qty_salida,
  c.qty_merma,
  c.saldo_resultante
from clasificados c, limite l
where c.ts_utc < l.inicio_dia_utc
order by c.ts_utc desc;

-- Resumen de acumulados previos al día
with piezas as (
  select id, nombre
  from public.insumos
  where lower(trim(nombre)) in ('piezas de pollo', 'pieza de pollo')
  limit 1
),
limite as (
  select
    (date_trunc('day', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa') as inicio_dia_utc
),
movimientos as (
  select
    coalesce(nullif(to_jsonb(m) ->> 'fecha_hora', '')::timestamptz, m.created_at) as ts_utc,
    regexp_replace(lower(trim(coalesce(m.tipo, ''))), '[\s-]+', '_', 'g') as tipo_norm,
    upper(trim(coalesce(m.nota, ''))) as nota_norm,
    coalesce(m.cantidad, 0)::numeric as cantidad
  from public.movimientos_inventario m
  join piezas p
    on m.insumo_id::text = p.id::text
  where coalesce(m.item_tipo, '') = 'insumo'
)
select
  coalesce(sum(case when tipo_norm in ('entrada', 'compra', 'ajuste_positivo', 'produccion_entrada') then cantidad else 0 end), 0) as entradas_antes,
  coalesce(sum(case when tipo_norm in ('salida', 'venta', 'ajuste_negativo', 'produccion_salida') then cantidad else 0 end), 0) as salidas_antes,
  coalesce(sum(case when tipo_norm in ('salida', 'venta', 'ajuste_negativo', 'produccion_salida') and nota_norm = 'MERMA' then cantidad else 0 end), 0) as merma_antes,
  coalesce(sum(case when tipo_norm in ('entrada', 'compra', 'ajuste_positivo', 'produccion_entrada') then cantidad else 0 end), 0)
    - coalesce(sum(case when tipo_norm in ('salida', 'venta', 'ajuste_negativo', 'produccion_salida') then cantidad else 0 end), 0) as stock_anterior_estimado
from movimientos, limite
where ts_utc < inicio_dia_utc;
