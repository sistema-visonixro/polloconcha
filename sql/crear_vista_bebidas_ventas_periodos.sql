-- Vista: Bebidas vendidas por período
-- Cuenta cantidad total de bebidas vendidas (excluye devoluciones)
-- Períodos soportados: día, semana, mes, año
-- Zona horaria de referencia: America/Tegucigalpa

create or replace view public.v_bebidas_ventas_periodos as
with limites as (
  select
    now() as now_utc,
    (date_trunc('day', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa') as start_dia_utc,
    (date_trunc('week', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa') as start_semana_utc,
    (date_trunc('month', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa') as start_mes_utc,
    (date_trunc('year', now() at time zone 'America/Tegucigalpa') at time zone 'America/Tegucigalpa') as start_anio_utc
),
periodos as (
  select 'dia'::text as periodo, start_dia_utc as inicio_utc, now_utc as fin_utc from limites
  union all select 'semana'::text, start_semana_utc, now_utc from limites
  union all select 'mes'::text, start_mes_utc, now_utc from limites
  union all select 'anio'::text, start_anio_utc, now_utc from limites
),
ventas_base as (
  select
    v.id as venta_id,
    upper(trim(coalesce(v.tipo, ''))) as tipo_venta,
    coalesce(v.es_donacion, false) as es_donacion,
    coalesce(
      nullif(to_jsonb(v) ->> 'fecha_hora', '')::timestamptz,
      nullif(to_jsonb(v) ->> 'fecha', '')::timestamptz,
      now()
    ) as ts_utc,
    coalesce(nullif(v.productos::text, ''), '[]')::jsonb as productos_json
  from public.ventas v
  where coalesce(v.es_donacion, false) = false
    and upper(trim(coalesce(v.tipo, ''))) <> 'CREDITO'
    and upper(trim(coalesce(v.tipo, ''))) <> 'DEVOLUCION'
),
ventas_productos as (
  select
    vb.venta_id,
    vb.ts_utc,
    p as producto_json
  from ventas_base vb
  cross join lateral jsonb_array_elements(vb.productos_json) p
),
ventas_detalle as (
  select
    vp.ts_utc,
    coalesce(nullif(vp.producto_json ->> 'nombre', ''), 'Producto') as producto_nombre,
    lower(trim(coalesce(vp.producto_json ->> 'tipo', ''))) as tipo_producto,
    coalesce(nullif(vp.producto_json ->> 'cantidad', ''), nullif(vp.producto_json ->> 'qty', ''), '0')::numeric as cantidad
  from ventas_productos vp
),
bebidas_por_periodo as (
  select
    p.periodo,
    coalesce(sum(case when vd.tipo_producto = 'bebida' then vd.cantidad else 0 end), 0)::numeric as total_bebidas_vendidas,
    coalesce(count(distinct case when vd.tipo_producto = 'bebida' then vd.producto_nombre end), 0) as cantidad_tipos_bebidas
  from periodos p
  left join ventas_detalle vd
    on vd.ts_utc >= p.inicio_utc
    and vd.ts_utc <= p.fin_utc
  group by p.periodo
)
select
  periodo,
  total_bebidas_vendidas,
  cantidad_tipos_bebidas
from bebidas_por_periodo;

-- Ejemplo de uso:
-- select * from public.v_bebidas_ventas_periodos where periodo = 'dia';
