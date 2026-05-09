-- Vista: Series de tiempo para piezas de pollo (ventas y merma)
-- Alcance:
--   - Diario  : últimos 7 días
--   - Semanal : últimas 4 semanas
--   - Mensual : últimos 6 meses
-- Zona horaria de referencia: America/Tegucigalpa

create or replace view public.v_piezas_pollo_series_tiempo as
with limites as (
  select
    now() as now_utc,
    (now() at time zone 'America/Tegucigalpa')::date as hoy_local,
    date_trunc('week', now() at time zone 'America/Tegucigalpa')::date as inicio_semana_local,
    date_trunc('month', now() at time zone 'America/Tegucigalpa')::date as inicio_mes_local,
    (date_trunc('month', now() at time zone 'America/Tegucigalpa')::date - interval '5 month')::date as inicio_min_local
),
series_dia as (
  select
    'dia'::text as dimension,
    to_char((l.hoy_local - gs.n)::date, 'YYYY-MM-DD') as bucket_key,
    to_char((l.hoy_local - gs.n)::date, 'DD/MM') as etiqueta,
    (l.hoy_local - gs.n)::date as inicio_local,
    ((l.hoy_local - gs.n) + 1)::date as fin_local,
    extract(epoch from ((l.hoy_local - gs.n)::timestamp))::bigint as orden
  from limites l
  cross join generate_series(6, 0, -1) as gs(n)
),
series_semana as (
  select
    'semana'::text as dimension,
    to_char((l.inicio_semana_local - (gs.n * interval '1 week'))::date, 'IYYY-"W"IW') as bucket_key,
    (
      to_char((l.inicio_semana_local - (gs.n * interval '1 week'))::date, 'DD/MM')
      || ' - ' ||
      to_char(((l.inicio_semana_local - (gs.n * interval '1 week'))::date + 6), 'DD/MM')
    ) as etiqueta,
    (l.inicio_semana_local - (gs.n * interval '1 week'))::date as inicio_local,
    ((l.inicio_semana_local - (gs.n * interval '1 week'))::date + 7) as fin_local,
    extract(epoch from (((l.inicio_semana_local - (gs.n * interval '1 week'))::date)::timestamp))::bigint as orden
  from limites l
  cross join generate_series(3, 0, -1) as gs(n)
),
series_mes as (
  select
    'mes'::text as dimension,
    to_char((l.inicio_mes_local - (gs.n * interval '1 month'))::date, 'YYYY-MM') as bucket_key,
    to_char((l.inicio_mes_local - (gs.n * interval '1 month'))::date, 'YYYY-MM') as etiqueta,
    (l.inicio_mes_local - (gs.n * interval '1 month'))::date as inicio_local,
    ((l.inicio_mes_local - (gs.n * interval '1 month'))::date + interval '1 month')::date as fin_local,
    extract(epoch from (((l.inicio_mes_local - (gs.n * interval '1 month'))::date)::timestamp))::bigint as orden
  from limites l
  cross join generate_series(5, 0, -1) as gs(n)
),
series as (
  select * from series_dia
  union all
  select * from series_semana
  union all
  select * from series_mes
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
    case
      when nullif(trim(v.productos::text), '') is null then '[]'::jsonb
      when left(trim(v.productos::text), 1) = '[' then (v.productos::text)::jsonb
      else '[]'::jsonb
    end as productos_json
  from public.ventas v
  cross join limites l
  where coalesce(
          nullif(to_jsonb(v) ->> 'fecha_hora', '')::timestamptz,
          nullif(to_jsonb(v) ->> 'fecha', '')::timestamptz,
          now()
        ) >= (l.inicio_min_local::timestamp at time zone 'America/Tegucigalpa')
),
ventas_productos as (
  select
    vb.venta_id,
    vb.tipo_venta,
    vb.ts_utc,
    p as producto_json
  from ventas_base vb
  cross join lateral jsonb_array_elements(vb.productos_json) p
  where vb.es_donacion = false
    and vb.tipo_venta <> 'CREDITO'
),
ventas_detalle as (
  select
    vp.venta_id,
    vp.ts_utc,
    coalesce(nullif(vp.producto_json ->> 'id', ''), nullif(vp.producto_json ->> 'producto_id', ''), md5(coalesce(vp.producto_json ->> 'nombre', 'producto'))) as producto_id,
    case when upper(vp.tipo_venta) = 'DEVOLUCION' then -1 else 1 end as factor,
    coalesce(nullif(vp.producto_json ->> 'cantidad', ''), nullif(vp.producto_json ->> 'qty', ''), '0')::numeric as cantidad,
    coalesce(vp.producto_json ->> 'piezas', '') as piezas_raw,
    lower(trim(coalesce(vp.producto_json ->> 'tipo', ''))) as tipo_producto
  from ventas_productos vp
),
consumo_piezas_por_producto as (
  select
    r.producto_id::text as producto_id,
    coalesce(sum(rd.cantidad), 0)::numeric
      / nullif(coalesce(r.rendimiento, 1)::numeric, 0) as piezas_por_producto_receta
  from public.recetas r
  join public.recetas_detalle rd
    on rd.receta_id = r.id
  join public.insumos i
    on i.id = rd.insumo_id
  where lower(trim(i.nombre)) in ('piezas de pollo', 'pieza de pollo')
  group by r.producto_id, r.rendimiento
),
ventas_pollo as (
  select
    vd.ts_utc,
    (vd.ts_utc at time zone 'America/Tegucigalpa')::date as fecha_local,
    date_trunc('week', vd.ts_utc at time zone 'America/Tegucigalpa')::date as semana_local,
    date_trunc('month', vd.ts_utc at time zone 'America/Tegucigalpa')::date as mes_local,
    (vd.factor * vd.cantidad) as cantidad_vendida,
    coalesce(
      cpp.piezas_por_producto_receta,
      case
        when trim(vd.piezas_raw) = '' then 1::numeric
        when upper(trim(vd.piezas_raw)) = 'PIEZAS VARIAS' then 1::numeric
        else greatest(
          cardinality(regexp_split_to_array(trim(vd.piezas_raw), '\\s*,\\s*')),
          1
        )::numeric
      end
    ) as piezas_por_producto
  from ventas_detalle vd
  left join consumo_piezas_por_producto cpp
    on cpp.producto_id = vd.producto_id
  where vd.tipo_producto = 'comida'
),
ventas_dia as (
  select
    vp.fecha_local as inicio_local,
    coalesce(sum(vp.cantidad_vendida * vp.piezas_por_producto), 0)::numeric as ventas_piezas
  from ventas_pollo vp
  cross join limites l
  where vp.fecha_local >= (l.hoy_local - 6)
    and vp.fecha_local <= l.hoy_local
  group by vp.fecha_local
),
ventas_semana as (
  select
    vp.semana_local as inicio_local,
    coalesce(sum(vp.cantidad_vendida * vp.piezas_por_producto), 0)::numeric as ventas_piezas
  from ventas_pollo vp
  cross join limites l
  where vp.semana_local >= (l.inicio_semana_local - interval '3 week')::date
    and vp.semana_local <= l.inicio_semana_local
  group by vp.semana_local
),
ventas_mes as (
  select
    vp.mes_local as inicio_local,
    coalesce(sum(vp.cantidad_vendida * vp.piezas_por_producto), 0)::numeric as ventas_piezas
  from ventas_pollo vp
  cross join limites l
  where vp.mes_local >= (l.inicio_mes_local - interval '5 month')::date
    and vp.mes_local <= l.inicio_mes_local
  group by vp.mes_local
),
insumo_piezas as (
  select i.id as insumo_id
  from public.insumos i
  where lower(trim(i.nombre)) in ('piezas de pollo', 'pieza de pollo')
  limit 1
),
movs_piezas as (
  select
    regexp_replace(lower(trim(coalesce(m.tipo, ''))), '[\s-]+', '_', 'g') as tipo_norm,
    upper(trim(coalesce(m.nota, ''))) as nota_norm,
    coalesce(m.cantidad, 0)::numeric as cantidad,
    coalesce(
      nullif(to_jsonb(m) ->> 'fecha_hora', '')::timestamptz,
      m.created_at
    ) as ts_utc,
    (coalesce(
      nullif(to_jsonb(m) ->> 'fecha_hora', '')::timestamptz,
      m.created_at
    ) at time zone 'America/Tegucigalpa')::date as fecha_local,
    date_trunc('week', coalesce(
      nullif(to_jsonb(m) ->> 'fecha_hora', '')::timestamptz,
      m.created_at
    ) at time zone 'America/Tegucigalpa')::date as semana_local,
    date_trunc('month', coalesce(
      nullif(to_jsonb(m) ->> 'fecha_hora', '')::timestamptz,
      m.created_at
    ) at time zone 'America/Tegucigalpa')::date as mes_local
  from public.movimientos_inventario m
  join insumo_piezas ip
    on m.insumo_id::text = ip.insumo_id::text
  cross join limites l
  where coalesce(m.item_tipo, '') = 'insumo'
    and coalesce(
      nullif(to_jsonb(m) ->> 'fecha_hora', '')::timestamptz,
      m.created_at
    ) >= (l.inicio_min_local::timestamp at time zone 'America/Tegucigalpa')
),
merma_base as (
  select *
  from movs_piezas
  where tipo_norm in ('salida', 'venta', 'ajuste_negativo', 'produccion_salida')
    and nota_norm = 'MERMA'
),
merma_dia as (
  select
    mb.fecha_local as inicio_local,
    coalesce(sum(mb.cantidad), 0)::numeric as merma_piezas
  from merma_base mb
  cross join limites l
  where mb.fecha_local >= (l.hoy_local - 6)
    and mb.fecha_local <= l.hoy_local
  group by mb.fecha_local
),
merma_semana as (
  select
    mb.semana_local as inicio_local,
    coalesce(sum(mb.cantidad), 0)::numeric as merma_piezas
  from merma_base mb
  cross join limites l
  where mb.semana_local >= (l.inicio_semana_local - interval '3 week')::date
    and mb.semana_local <= l.inicio_semana_local
  group by mb.semana_local
),
merma_mes as (
  select
    mb.mes_local as inicio_local,
    coalesce(sum(mb.cantidad), 0)::numeric as merma_piezas
  from merma_base mb
  cross join limites l
  where mb.mes_local >= (l.inicio_mes_local - interval '5 month')::date
    and mb.mes_local <= l.inicio_mes_local
  group by mb.mes_local
)
select
  s.dimension,
  s.bucket_key,
  s.etiqueta,
  s.orden,
  coalesce(
    case
      when s.dimension = 'dia' then vd.ventas_piezas
      when s.dimension = 'semana' then vs.ventas_piezas
      when s.dimension = 'mes' then vm.ventas_piezas
      else 0
    end,
    0
  )::numeric as ventas_piezas,
  coalesce(
    case
      when s.dimension = 'dia' then md.merma_piezas
      when s.dimension = 'semana' then ms.merma_piezas
      when s.dimension = 'mes' then mm.merma_piezas
      else 0
    end,
    0
  )::numeric as merma_piezas
from series s
left join ventas_dia vd
  on s.dimension = 'dia'
 and vd.inicio_local = s.inicio_local
left join ventas_semana vs
  on s.dimension = 'semana'
 and vs.inicio_local = s.inicio_local
left join ventas_mes vm
  on s.dimension = 'mes'
 and vm.inicio_local = s.inicio_local
left join merma_dia md
  on s.dimension = 'dia'
 and md.inicio_local = s.inicio_local
left join merma_semana ms
  on s.dimension = 'semana'
 and ms.inicio_local = s.inicio_local
left join merma_mes mm
  on s.dimension = 'mes'
 and mm.inicio_local = s.inicio_local
order by
  case s.dimension when 'dia' then 1 when 'semana' then 2 when 'mes' then 3 else 4 end,
  s.orden asc;

-- Ejemplo:
-- select * from public.v_piezas_pollo_series_tiempo where dimension = 'dia';
-- select * from public.v_piezas_pollo_series_tiempo where dimension = 'semana';
-- select * from public.v_piezas_pollo_series_tiempo where dimension = 'mes';
