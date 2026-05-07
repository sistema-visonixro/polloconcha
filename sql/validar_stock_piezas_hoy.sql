-- ============================================================
-- Validación de movimientos de 'Piezas de pollo' HOY (UTC-6 Honduras)
-- Reemplaza el insumo_id con el de tu base si difiere
-- ============================================================

-- 1. Totales históricos sin filtro (todos los tiempos)
SELECT 
  tipo, 
  COUNT(*) as cantidad_registros,
  SUM(cantidad) as total_unidades
FROM public.movimientos_inventario
WHERE insumo_id = '84b22d5d-87c6-4570-abd0-67a557c74927'
  AND tipo IN ('venta', 'salida', 'entrada')
GROUP BY tipo
ORDER BY tipo;

-- ==============================================================

-- 2. Solo los movimientos de HOY (2026-05-07 en Honduras = UTC 06:00–30:00)
--    Honduras = UTC-6 → día local comienza a las 06:00 UTC
SELECT 
  tipo,
  COUNT(*) as cantidad_registros,
  SUM(cantidad) as total_unidades,
  MIN(created_at AT TIME ZONE 'America/Tegucigalpa') as primer_movimiento,
  MAX(created_at AT TIME ZONE 'America/Tegucigalpa') as ultimo_movimiento
FROM public.movimientos_inventario
WHERE insumo_id = '84b22d5d-87c6-4570-abd0-67a557c74927'
  AND tipo IN ('venta', 'salida', 'entrada')
  AND (created_at AT TIME ZONE 'America/Tegucigalpa')::date = CURRENT_DATE AT TIME ZONE 'America/Tegucigalpa'
GROUP BY tipo
ORDER BY tipo;

-- ==============================================================

-- 3. Stock ANTES de hoy (debería coincidir con "Stock anterior" del modal)
SELECT 
  SUM(CASE 
        WHEN tipo IN ('entrada', 'ajuste_positivo', 'produccion_entrada') THEN cantidad
        ELSE -cantidad
      END) AS stock_anterior_calculado
FROM public.movimientos_inventario
WHERE insumo_id = '84b22d5d-87c6-4570-abd0-67a557c74927'
  AND (created_at AT TIME ZONE 'America/Tegucigalpa')::date < CURRENT_DATE AT TIME ZONE 'America/Tegucigalpa';

-- ==============================================================

-- 4. Detalle de TODOS los movimientos de hoy ordenados por hora
SELECT 
  created_at AT TIME ZONE 'America/Tegucigalpa' AS hora_local,
  tipo,
  cantidad,
  nota,
  cajero,
  referencia_tipo,
  referencia_id
FROM public.movimientos_inventario
WHERE insumo_id = '84b22d5d-87c6-4570-abd0-67a557c74927'
  AND (created_at AT TIME ZONE 'America/Tegucigalpa')::date = CURRENT_DATE AT TIME ZONE 'America/Tegucigalpa'
ORDER BY created_at;
