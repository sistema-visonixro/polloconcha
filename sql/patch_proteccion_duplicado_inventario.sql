-- =============================================================
-- PATCH: Protección anti-duplicado en movimientos de inventario
-- Fecha: 2026-05-07
--
-- Problema potencial:
--   1. trg_facturas_salida_inventario en public.facturas sigue existiendo
--      aunque la app ya no usa esa tabla. Si se activa accidentalmente
--      generaría doble movimiento de inventario por venta.
--   2. registrar_movimiento_inventario no tiene guard contra duplicados
--      por referencia (misma factura + mismo insumo + mismo tipo).
--
-- Solución:
--   1. Eliminar definitivamente el trigger huérfano en facturas.
--   2. Agregar índice + guard UNIQUE en movimientos_inventario
--      para (referencia_tipo, referencia_id, insumo_id, tipo) cuando
--      referencia_tipo = 'factura' — previene doble salida por misma venta.
-- =============================================================

-- ── 1. Eliminar trigger huérfano en facturas ──────────────────────────────
DROP TRIGGER IF EXISTS trg_facturas_salida_inventario ON public.facturas;

DO $$
BEGIN
  RAISE NOTICE '✓ Trigger trg_facturas_salida_inventario eliminado de public.facturas (si existía).';
END $$;

-- ── 2. Eliminar trigger viejo en ventas (por si quedó de versión anterior) ─
DROP TRIGGER IF EXISTS trg_ventas_salida_inventario ON public.ventas;

-- ── 3. Recrear trigger limpio en ventas ──────────────────────────────────
CREATE TRIGGER trg_ventas_salida_inventario
  AFTER INSERT ON public.ventas
  FOR EACH ROW
  EXECUTE FUNCTION public.procesar_salida_inventario_por_venta();

DO $$
BEGIN
  RAISE NOTICE '✓ Trigger trg_ventas_salida_inventario recreado en public.ventas.';
END $$;

-- ── 4. Limpiar duplicados existentes antes de crear el índice ─────────────
-- Conserva el movimiento con el id más grande (más reciente) por grupo.
-- El stock_actual ya está "dañado" por los duplicados; después de esto
-- se puede corregir manualmente si es necesario.
DO $$
DECLARE
  v_count integer;
BEGIN
  WITH duplicados AS (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY referencia_id, insumo_id, tipo
             ORDER BY id DESC   -- conservar el más reciente
           ) AS rn
      FROM public.movimientos_inventario
     WHERE referencia_tipo = 'factura'
       AND insumo_id IS NOT NULL
       AND referencia_id IS NOT NULL
  )
  DELETE FROM public.movimientos_inventario
   WHERE id IN (SELECT id FROM duplicados WHERE rn > 1);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '✓ Duplicados eliminados de movimientos_inventario: % filas', v_count;
END $$;

-- ── 4b. Índice único parcial anti-duplicado ───────────────────────────────
-- Aplica SOLO cuando referencia_tipo = 'factura' para insumos.
-- Previene que el mismo insumo se descuente dos veces por la misma factura
-- con el mismo tipo de movimiento.

CREATE UNIQUE INDEX IF NOT EXISTS uq_mov_inv_factura_insumo_tipo
  ON public.movimientos_inventario (referencia_id, insumo_id, tipo)
  WHERE referencia_tipo = 'factura'
    AND insumo_id IS NOT NULL
    AND referencia_id IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE '✓ Índice único uq_mov_inv_factura_insumo_tipo creado (o ya existía).';
END $$;

-- ── 5. Actualizar registrar_movimiento_inventario con ON CONFLICT DO NOTHING
--       para el path de insumo cuando hay referencia_tipo = 'factura' ───────
CREATE OR REPLACE FUNCTION public.registrar_movimiento_inventario(
  p_item_tipo        text,
  p_item_id          uuid,
  p_tipo_movimiento  text,
  p_cantidad         numeric,
  p_costo_unitario   numeric  DEFAULT 0,
  p_referencia_tipo  text     DEFAULT NULL,
  p_referencia_id    text     DEFAULT NULL,
  p_nota             text     DEFAULT NULL,
  p_cajero           text     DEFAULT NULL,
  p_cajero_id        text     DEFAULT NULL,
  p_modo_estricto    boolean  DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_delta          numeric(14,4);
  v_saldo          numeric(14,4);
  v_movimiento_id  uuid := gen_random_uuid();
  v_perm_stock_neg boolean := false;
  v_ya_existe      boolean := false;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
  END IF;

  IF p_item_tipo NOT IN ('insumo', 'producto') THEN
    RAISE EXCEPTION 'item_tipo inválido: %', p_item_tipo;
  END IF;

  IF p_tipo_movimiento NOT IN (
    'entrada', 'salida', 'ajuste_positivo', 'ajuste_negativo',
    'venta', 'produccion_entrada', 'produccion_salida'
  ) THEN
    RAISE EXCEPTION 'tipo_movimiento inválido: %', p_tipo_movimiento;
  END IF;

  -- ── Guard anti-duplicado: si ya existe movimiento con misma referencia/insumo/tipo ──
  IF p_referencia_tipo = 'factura'
     AND p_referencia_id IS NOT NULL
     AND p_item_tipo = 'insumo'
  THEN
    SELECT EXISTS (
      SELECT 1 FROM public.movimientos_inventario
       WHERE referencia_tipo = p_referencia_tipo
         AND referencia_id   = p_referencia_id
         AND insumo_id       = p_item_id
         AND tipo            = p_tipo_movimiento
    ) INTO v_ya_existe;

    IF v_ya_existe THEN
      RAISE NOTICE 'registrar_movimiento_inventario: movimiento duplicado ignorado — factura=%, insumo=%, tipo=%',
                    p_referencia_id, p_item_id, p_tipo_movimiento;
      RETURN NULL;  -- retorna NULL en lugar de crear duplicado
    END IF;
  END IF;

  v_delta := CASE
    WHEN p_tipo_movimiento IN ('entrada', 'ajuste_positivo', 'produccion_entrada') THEN p_cantidad
    ELSE p_cantidad * -1
  END;

  IF p_item_tipo = 'insumo' THEN
    UPDATE public.insumos
       SET stock_actual    = stock_actual + v_delta,
           costo_unitario  = CASE WHEN p_costo_unitario > 0 THEN p_costo_unitario ELSE costo_unitario END,
           updated_at      = now()
     WHERE id = p_item_id
     RETURNING stock_actual INTO v_saldo;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El insumo % no existe', p_item_id;
    END IF;

    IF p_modo_estricto AND v_saldo < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente del insumo %. Saldo: %', p_item_id, v_saldo;
    END IF;

    INSERT INTO public.movimientos_inventario (
      id, item_tipo, tipo, referencia_tipo, referencia_id, insumo_id,
      cantidad, saldo_resultante, costo_unitario, nota, cajero, cajero_id
    ) VALUES (
      v_movimiento_id, 'insumo', p_tipo_movimiento, p_referencia_tipo, p_referencia_id, p_item_id,
      p_cantidad, v_saldo, COALESCE(p_costo_unitario, 0), p_nota, p_cajero, p_cajero_id
    )
    ON CONFLICT DO NOTHING;  -- índice único previene duplicado

  ELSE
    SELECT COALESCE(permite_stock_negativo, false)
      INTO v_perm_stock_neg
      FROM public.inventario_config_productos
     WHERE producto_id = p_item_id;

    IF EXISTS (SELECT 1 FROM public.stock_productos WHERE producto_id = p_item_id) THEN
      UPDATE public.stock_productos
         SET stock_actual   = stock_actual + v_delta,
             costo_promedio = CASE
               WHEN p_costo_unitario > 0 THEN p_costo_unitario
               ELSE costo_promedio
             END,
             updated_at = now()
       WHERE producto_id = p_item_id
       RETURNING stock_actual INTO v_saldo;
    ELSE
      IF v_delta < 0 AND NOT v_perm_stock_neg AND p_modo_estricto THEN
        RAISE EXCEPTION 'Stock insuficiente del producto % (sin fila en stock_productos)', p_item_id;
      END IF;
      INSERT INTO public.stock_productos (producto_id, stock_actual, costo_promedio)
      VALUES (p_item_id, GREATEST(v_delta, 0), COALESCE(p_costo_unitario, 0))
      RETURNING stock_actual INTO v_saldo;
    END IF;

    IF p_modo_estricto AND NOT v_perm_stock_neg AND v_saldo < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente del producto %. Saldo: %', p_item_id, v_saldo;
    END IF;

    INSERT INTO public.movimientos_inventario (
      id, item_tipo, tipo, referencia_tipo, referencia_id, producto_id,
      cantidad, saldo_resultante, costo_unitario, nota, cajero, cajero_id
    ) VALUES (
      v_movimiento_id, 'producto', p_tipo_movimiento, p_referencia_tipo, p_referencia_id, p_item_id,
      p_cantidad, v_saldo, COALESCE(p_costo_unitario, 0), p_nota, p_cajero, p_cajero_id
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN v_movimiento_id;
END;
$$;

DO $$
BEGIN
  RAISE NOTICE '✓ Función registrar_movimiento_inventario actualizada con guard anti-duplicado.';
END $$;

-- ── Verificación final ────────────────────────────────────────────────────
SELECT
  tgname        AS trigger,
  tgrelid::regclass AS tabla,
  tgenabled     AS habilitado
FROM pg_trigger
WHERE tgname IN ('trg_ventas_salida_inventario', 'trg_facturas_salida_inventario')
  AND NOT tgisinternal
ORDER BY tgname;
