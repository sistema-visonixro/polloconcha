-- Vista para calcular stock por período únicamente desde Supabase
-- Períodos soportados: día, semana, mes, año
-- Zona horaria de referencia: America/Tegucigalpa

create or replace view public.v_inventario_stock_periodos as
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
movs as (
  select
    m.item_tipo,
    m.insumo_id,
    regexp_replace(lower(trim(coalesce(m.tipo, ''))), '[\s-]+', '_', 'g') as tipo_norm,
    coalesce(m.cantidad, 0)::numeric as cantidad,
    upper(trim(coalesce(m.nota, ''))) as nota_norm,
    coalesce(
      nullif(to_jsonb(m) ->> 'fecha_hora', '')::timestamptz,
      m.created_at
    ) as ts_utc
  from public.movimientos_inventario m
  where coalesce(m.item_tipo, '') = 'insumo'
    and m.insumo_id is not null
),
movs_clasificados as (
  select
    mv.*,
    (
      mv.tipo_norm in ('entrada', 'compra', 'ajuste_positivo', 'produccion_entrada')
    ) as es_entrada,
    (
      mv.tipo_norm in ('salida', 'venta', 'ajuste_negativo', 'produccion_salida')
    ) as es_salida,
    (mv.nota_norm = 'MERMA') as es_merma
  from movs mv
),
base as (
  select
    p.periodo,
    i.id as insumo_id,
    i.nombre as insumo_nombre,
    p.inicio_utc,
    p.fin_utc,
    coalesce(sum(case when mc.es_entrada and mc.ts_utc < p.inicio_utc then mc.cantidad else 0 end), 0) as entradas_antes,
    coalesce(sum(case when mc.es_salida and mc.ts_utc < p.inicio_utc then mc.cantidad else 0 end), 0) as salidas_antes,
    coalesce(sum(case when mc.es_entrada and mc.ts_utc >= p.inicio_utc and mc.ts_utc <= p.fin_utc then mc.cantidad else 0 end), 0) as ingreso_periodo,
    coalesce(sum(case when mc.es_salida and not mc.es_merma and mc.ts_utc >= p.inicio_utc and mc.ts_utc <= p.fin_utc then mc.cantidad else 0 end), 0) as venta_periodo,
    coalesce(sum(case when mc.es_salida and mc.es_merma and mc.ts_utc >= p.inicio_utc and mc.ts_utc <= p.fin_utc then mc.cantidad else 0 end), 0) as merma_periodo
  from public.insumos i
  cross join periodos p
  left join movs_clasificados mc
    on mc.insumo_id::text = i.id::text
  group by p.periodo, i.id, i.nombre, p.inicio_utc, p.fin_utc
)
select
  b.periodo,
  b.insumo_id,
  b.insumo_nombre,
  (b.inicio_utc at time zone 'America/Tegucigalpa') as fecha_inicio_periodo,
  (b.fin_utc at time zone 'America/Tegucigalpa') as fecha_fin_periodo,
  (b.entradas_antes - b.salidas_antes) as stock_anterior,
  b.ingreso_periodo,
  b.venta_periodo,
  b.merma_periodo,
  (b.venta_periodo + b.merma_periodo) as salida_periodo,
  ((b.entradas_antes - b.salidas_antes) + b.ingreso_periodo - b.venta_periodo - b.merma_periodo) as stock_actual
from base b;

-- Vista enfocada solo en "Piezas de pollo"
create or replace view public.v_piezas_pollo_stock_periodos as
select *
from public.v_inventario_stock_periodos
where lower(trim(insumo_nombre)) in ('piezas de pollo', 'pieza de pollo');

-- Ejemplo de uso:
-- select * from public.v_piezas_pollo_stock_periodos where periodo = 'dia';
-- select * from public.v_inventario_stock_periodos where periodo in ('semana','mes','anio') order by insumo_nombre;