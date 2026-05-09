-- Vista: Detalle de salidas por ventas de piezas de pollo por período
-- Incluye: producto, cantidad vendida, piezas por producto, piezas totales y merma del período
-- Períodos soportados: día, semana, mes, año
-- Zona horaria de referencia: America/Tegucigalpa

create or replace view public.v_piezas_pollo_detalle_ventas_periodos as
with limites as (
  select
    now() as now_utc,
    (
      date_trunc('day', now() at time zone 'America/Tegucigalpa')
      at time zone 'America/Tegucigalpa'
    ) as start_dia_utc,
    (
      date_trunc('week', now() at time zone 'America/Tegucigalpa')
      at time zone 'America/Tegucigalpa'
    ) as start_semana_utc,
    (
      date_trunc('month', now() at time zone 'America/Tegucigalpa')
      at time zone 'America/Tegucigalpa'
    ) as start_mes_utc,
    (
      date_trunc('year', now() at time zone 'America/Tegucigalpa')
      at time zone 'America/Tegucigalpa'
    ) as start_anio_utc
),
periodos as (
  select 'dia'::text as periodo, start_dia_utc as inicio_utc, now_utc as fin_utc from limites
  union all
  select 'semana'::text, start_semana_utc, now_utc from limites
  union all
  select 'mes'::text, start_mes_utc, now_utc from limites
  union all
  select 'anio'::text, start_anio_utc, now_utc from limites
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
    coalesce(nullif(vp.producto_json ->> 'nombre', ''), 'Producto') as producto_nombre,
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
    vd.venta_id,
    vd.ts_utc,
    vd.producto_id,
    vd.producto_nombre,
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
agg_ventas as (
  select
    p.periodo,
    vp.producto_id,
    vp.producto_nombre,
    sum(vp.cantidad_vendida) as cantidad_vendida,
    max(vp.piezas_por_producto) as piezas_por_producto,
    sum(vp.cantidad_vendida * vp.piezas_por_producto) as piezas_totales_producto
  from periodos p
  join ventas_pollo vp
    on vp.ts_utc >= p.inicio_utc
   and vp.ts_utc <= p.fin_utc
  group by p.periodo, vp.producto_id, vp.producto_nombre
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
    ) as ts_utc
  from public.movimientos_inventario m
  join insumo_piezas ip
    on m.insumo_id::text = ip.insumo_id::text
  where coalesce(m.item_tipo, '') = 'insumo'
),
agg_merma as (
  select
    p.periodo,
    coalesce(sum(case
      when mp.tipo_norm in ('salida', 'venta', 'ajuste_negativo', 'produccion_salida')
       and mp.nota_norm = 'MERMA'
       and mp.ts_utc >= p.inicio_utc
       and mp.ts_utc <= p.fin_utc
      then mp.cantidad else 0 end), 0) as merma_periodo
  from periodos p
  left join movs_piezas mp on true
  group by p.periodo
)
select
  av.periodo,
  av.producto_id,
  av.producto_nombre,
  (now() at time zone 'America/Tegucigalpa')::date as fecha_honduras,
  av.cantidad_vendida,
  av.piezas_por_producto,
  av.piezas_totales_producto,
  am.merma_periodo,
  sum(av.cantidad_vendida) over (partition by av.periodo) as total_cantidad_vendida_periodo,
  sum(av.piezas_totales_producto) over (partition by av.periodo) as total_piezas_vendidas_periodo
from agg_ventas av
left join agg_merma am
  on am.periodo = av.periodo
order by
  av.periodo,
  av.piezas_totales_producto desc,
  av.producto_nombre asc;

-- Vista adicional: consumo de piezas de pollo por producto según recetas
create or replace view public.v_recetas_consumo_piezas_pollo_producto as
select
  r.producto_id,
  p.nombre as producto_nombre,
  coalesce(sum(rd.cantidad), 0)::numeric
    / nullif(coalesce(r.rendimiento, 1)::numeric, 0) as piezas_por_producto,
  coalesce(r.rendimiento, 1)::numeric as rendimiento_receta,
  max(r.updated_at) as receta_actualizada_en,
  count(*) as lineas_receta_piezas
from public.recetas r
join public.productos p
  on p.id = r.producto_id
join public.recetas_detalle rd
  on rd.receta_id = r.id
join public.insumos i
  on i.id = rd.insumo_id
where lower(trim(i.nombre)) in ('piezas de pollo', 'pieza de pollo')
group by r.producto_id, p.nombre, r.rendimiento
order by p.nombre;

-- Ejemplo de uso:
-- select * from public.v_piezas_pollo_detalle_ventas_periodos where periodo = 'dia';
-- select * from public.v_piezas_pollo_detalle_ventas_periodos where periodo = 'semana';
-- select * from public.v_recetas_consumo_piezas_pollo_producto;
