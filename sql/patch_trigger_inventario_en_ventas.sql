-- =============================================================
-- PATCH: Activar salida automática de inventario al registrar ventas
-- Fecha: 2026-04-29
--
-- Objetivo:
--   Conectar la tabla public.ventas al proceso automático de inventario,
--   reutilizando la función existente:
--     public.procesar_salida_inventario_por_venta()
--
-- Requisitos previos:
--   1) Haber ejecutado el sistema de inventario (v2 o patch equivalente)
--      que crea la función public.procesar_salida_inventario_por_venta().
--   2) Tabla public.ventas existente (flujo actual de registro de venta).
--
-- Comportamiento:
--   - Crea trigger AFTER INSERT en public.ventas.
--   - Si la función de inventario no existe, no rompe: solo muestra NOTICE.
--   - Script idempotente: se puede ejecutar múltiples veces.
-- =============================================================

DO $$
BEGIN
  IF to_regprocedure('public.procesar_salida_inventario_por_venta()') IS NULL THEN
    RAISE NOTICE 'No existe public.procesar_salida_inventario_por_venta(). Ejecute primero el script de inventario.';
    RETURN;
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_ventas_salida_inventario ON public.ventas';

  EXECUTE '
    CREATE TRIGGER trg_ventas_salida_inventario
    AFTER INSERT ON public.ventas
    FOR EACH ROW
    EXECUTE FUNCTION public.procesar_salida_inventario_por_venta()
  ';

  RAISE NOTICE 'Trigger trg_ventas_salida_inventario creado correctamente en public.ventas';
END
$$;

-- OPCIONAL (recomendado si ya no usas public.facturas):
-- Evita doble descuento si por alguna razón se insertan ventas y facturas
-- para la misma transacción.
-- DROP TRIGGER IF EXISTS trg_facturas_salida_inventario ON public.facturas;

-- Verificación rápida
SELECT
  tgname AS trigger,
  tgrelid::regclass AS tabla,
  tgenabled AS habilitado
FROM pg_trigger
WHERE tgname IN ('trg_ventas_salida_inventario', 'trg_facturas_salida_inventario')
  AND NOT tgisinternal
ORDER BY tgname;
