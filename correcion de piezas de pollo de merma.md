bien en el punto de ventas , en menu,en  📦 Insumos y bebidas del día, en  piezas de pollo , se ve una tabla  quero saber de donde  extrae esa informacion.



revisa a que tabla es que se registra  la cantidad ingresada de merma


que esta ubicado en punto de ventas en el boton menu en  el boton merma que habre el modal 🗑️ Merma de piezas de pollo



quiero saber a que tabla envia  la info a que tabla de supabase




para que: para esto:  quero que hagas una tabla para las salidas por merma , que la tabla en supabase se llame merma 

y asi corrijas el probema de ingresar merma y esta en vez de hacer  una resta osea una salida haga unna suma, 

la tabla se ve asi en este momento:🍗 Piezas de pollo · 2026-06-14
🖨 Imprimir ticket
Nombre	Stock al inicio del día	Ingreso del día	Venta del día	Stock actual
Piezas de pollo	-4107.50	0.00	175.50	-5283.00
Detalle de salidas por ventas de piezas
Producto	Cant. vendida	Piezas / prod.	Piezas totales
Pollo frito de 2 piezas	22.00	2.00	44.00
Pollo frito de 3 Piezas	14.00	3.00	42.00
Orden tacos de 2	30.00	1.00	30.00
Pollo frito de 1 Pieza	28.00	1.00	28.00
Pollo frito de 4 Piezas	5.00	4.00	20.00
Orden Tacos de 3	4.00	1.50	6.00
Pollo frito de 5 Piezas	1.00	5.00	5.00
Orden Tacos de 1	1.00	0.50	0.50
Total cantidad vendida
105.00
Total piezas de pollo
175.50
Salidas por merma
1000.00




en Nombre	Stock al inicio del día,	Ingreso del día	,Venta del día,	Stock actual
cambialo por; Nombre	merma ,  Ingreso del día	, Venta del día	 ,Stock actual













aun hay error: asi esta la tabla; 📦 Insumos y bebidas del día
Salidas y stock calculado por rango (Entradas - Salidas)

✕
Hoy
Semana
Mes
Año

🧂
Insumos
Ver salidas y stock

🥤
Bebidas
Ver salidas y stock

🍗
Piezas de pollo
Piezas vendidas y stock
🍗 Piezas de pollo · 2026-06-14
🖨 Imprimir ticket
Nombre	Merma	Ingreso del día	Venta del día	Stock actual
Piezas de pollo	-725.50	0.00	225.00	-950.50
Detalle de salidas por ventas de piezas
Producto	Cant. vendida	Piezas / prod.	Piezas totales
Pollo frito de 2 piezas	28.00	2.00	56.00
Pollo frito de 3 Piezas	17.00	3.00	51.00
Orden tacos de 2	39.00	1.00	39.00
Pollo frito de 1 Pieza	28.00	1.00	28.00
Pollo frito de 4 Piezas	5.00	4.00	20.00
Pollo frito de 5 Piezas	4.00	5.00	20.00
Orden Tacos de 3	7.00	1.50	10.50
Orden Tacos de 1	1.00	0.50	0.50
Total cantidad vendida
129.00
Total piezas de pollo
225.00
Salidas por merma
1000.00









primero quiero saber de donde extralle la info esto;Salidas por merma
1000.00



segundo , en  Merma 	-725.5  debe ser el mismo valor de :Salidas por merma
1000.00


averigua donde registra el ingreso de piezas de pollo, donde se registra la piezas de pollo vendidas



create view public.v_piezas_pollo_stock_periodos as
with
  limites as (
    select
      now() as now_utc,
      (
        date_trunc(
          'day'::text,
          (now() AT TIME ZONE 'America/Tegucigalpa'::text)
        ) AT TIME ZONE 'America/Tegucigalpa'::text
      ) as start_dia_utc,
      (
        date_trunc(
          'week'::text,
          (now() AT TIME ZONE 'America/Tegucigalpa'::text)
        ) AT TIME ZONE 'America/Tegucigalpa'::text
      ) as start_semana_utc,
      (
        date_trunc(
          'month'::text,
          (now() AT TIME ZONE 'America/Tegucigalpa'::text)
        ) AT TIME ZONE 'America/Tegucigalpa'::text
      ) as start_mes_utc,
      (
        date_trunc(
          'year'::text,
          (now() AT TIME ZONE 'America/Tegucigalpa'::text)
        ) AT TIME ZONE 'America/Tegucigalpa'::text
      ) as start_anio_utc
  ),
  periodos as (
    select
      'dia'::text as periodo,
      limites.start_dia_utc as inicio_utc,
      limites.now_utc as fin_utc
    from
      limites
    union all
    select
      'semana'::text as text,
      limites.start_semana_utc,
      limites.now_utc
    from
      limites
    union all
    select
      'mes'::text as text,
      limites.start_mes_utc,
      limites.now_utc
    from
      limites
    union all
    select
      'anio'::text as text,
      limites.start_anio_utc,
      limites.now_utc
    from
      limites
  ),
  pieza_insumo as (
    select
      i.id,
      i.nombre
    from
      insumos i
    where
      lower(
        TRIM(
          both
          from
            i.nombre
        )
      ) = any (
        array['piezas de pollo'::text, 'pieza de pollo'::text]
      )
    limit
      1
  ),
  movs as (
    select
      m.item_tipo,
      m.insumo_id,
      regexp_replace(
        lower(
          TRIM(
            both
            from
              COALESCE(m.tipo, ''::text)
          )
        ),
        '[\s-]+'::text,
        '_'::text,
        'g'::text
      ) as tipo_norm,
      COALESCE(m.cantidad, 0::numeric) as cantidad,
      upper(
        TRIM(
          both
          from
            COALESCE(m.nota, ''::text)
        )
      ) as nota_norm,
      COALESCE(
        NULLIF(to_jsonb(m.*) ->> 'fecha_hora'::text, ''::text)::timestamp with time zone,
        m.created_at
      ) as ts_utc
    from
      movimientos_inventario m
      join pieza_insumo pi on m.insumo_id::text = pi.id::text
    where
      COALESCE(m.item_tipo, ''::text) = 'insumo'::text
  ),
  movs_clasificados as (
    select
      mv.item_tipo,
      mv.insumo_id,
      mv.tipo_norm,
      mv.cantidad,
      mv.nota_norm,
      mv.ts_utc,
      mv.tipo_norm = any (
        array[
          'entrada'::text,
          'compra'::text,
          'ajuste_positivo'::text,
          'produccion_entrada'::text
        ]
      ) as es_entrada,
      mv.tipo_norm = any (
        array[
          'salida'::text,
          'venta'::text,
          'ajuste_negativo'::text,
          'produccion_salida'::text
        ]
      ) as es_salida,
      mv.nota_norm = 'MERMA'::text as es_merma
    from
      movs mv
  ),
  base as (
    select
      p.periodo,
      pi.id as insumo_id,
      pi.nombre as insumo_nombre,
      p.inicio_utc,
      p.fin_utc,
      COALESCE(
        sum(
          case
            when mc.es_entrada
            and mc.ts_utc < p.inicio_utc then mc.cantidad
            else 0::numeric
          end
        ),
        0::numeric
      ) as entradas_antes,
      COALESCE(
        sum(
          case
            when mc.es_salida
            and mc.ts_utc < p.inicio_utc
            and not mc.es_merma then mc.cantidad
            else 0::numeric
          end
        ),
        0::numeric
      ) as salidas_antes,
      COALESCE(
        sum(
          case
            when mc.es_salida
            and mc.ts_utc < p.inicio_utc
            and mc.es_merma then mc.cantidad
            else 0::numeric
          end
        ),
        0::numeric
      ) as merma_antes,
      COALESCE(
        sum(
          case
            when mc.es_entrada
            and mc.ts_utc >= p.inicio_utc
            and mc.ts_utc <= p.fin_utc then mc.cantidad
            else 0::numeric
          end
        ),
        0::numeric
      ) as ingreso_periodo,
      COALESCE(
        sum(
          case
            when mc.es_salida
            and mc.ts_utc >= p.inicio_utc
            and mc.ts_utc <= p.fin_utc
            and not mc.es_merma then mc.cantidad
            else 0::numeric
          end
        ),
        0::numeric
      ) as salida_movimiento_periodo,
      COALESCE(
        sum(
          case
            when mc.es_salida
            and mc.es_merma
            and mc.ts_utc >= p.inicio_utc
            and mc.ts_utc <= p.fin_utc then mc.cantidad
            else 0::numeric
          end
        ),
        0::numeric
      ) as merma_periodo
    from
      pieza_insumo pi
      cross join periodos p
      left join movs_clasificados mc on mc.insumo_id::text = pi.id::text
    group by
      p.periodo,
      pi.id,
      pi.nombre,
      p.inicio_utc,
      p.fin_utc
  ),
  ventas_periodo as (
    select
      v_piezas_pollo_detalle_ventas_periodos.periodo,
      COALESCE(
        max(
          v_piezas_pollo_detalle_ventas_periodos.total_piezas_vendidas_periodo
        ),
        0::numeric
      ) as venta_periodo,
      COALESCE(
        max(
          v_piezas_pollo_detalle_ventas_periodos.total_cantidad_vendida_periodo
        ),
        0::numeric
      ) as cantidad_productos_vendidos
    from
      v_piezas_pollo_detalle_ventas_periodos
    group by
      v_piezas_pollo_detalle_ventas_periodos.periodo
  ),
  stock_actual_hoy_calc as (
    select
      COALESCE(
        (
          select
            b_dia.entradas_antes - b_dia.salidas_antes - b_dia.merma_antes + b_dia.ingreso_periodo - COALESCE(vp_dia.venta_periodo, 0::numeric) - b_dia.merma_periodo
          from
            base b_dia
            left join (
              select
                COALESCE(
                  max(
                    v_piezas_pollo_detalle_ventas_periodos.total_piezas_vendidas_periodo
                  ),
                  0::numeric
                ) as venta_periodo
              from
                v_piezas_pollo_detalle_ventas_periodos
              where
                v_piezas_pollo_detalle_ventas_periodos.periodo = 'dia'::text
            ) vp_dia on true
          where
            b_dia.periodo = 'dia'::text
          limit
            1
        ),
        0::numeric
      ) as stock_actual_hoy
  )
select
  b.periodo,
  b.insumo_id,
  b.insumo_nombre,
  (
    b.inicio_utc AT TIME ZONE 'America/Tegucigalpa'::text
  ) as fecha_inicio_periodo,
  (
    b.fin_utc AT TIME ZONE 'America/Tegucigalpa'::text
  ) as fecha_fin_periodo,
  b.entradas_antes - b.salidas_antes - b.merma_antes as stock_anterior,
  b.ingreso_periodo,
  COALESCE(vp.venta_periodo, 0::numeric) as venta_periodo,
  b.merma_periodo,
  COALESCE(vp.venta_periodo, 0::numeric) + b.merma_periodo as salida_periodo,
  s.stock_actual_hoy as stock_actual,
  COALESCE(vp.cantidad_productos_vendidos, 0::numeric) as cantidad_productos_vendidos
from
  base b
  left join ventas_periodo vp on vp.periodo = b.periodo
  cross join stock_actual_hoy_calc s;