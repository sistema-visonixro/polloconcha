-- =============================================================
--  Parche: migrar confirmar_venta_credito a tabla ventas
--
--  Problema: la función inserta en `facturas`, y el trigger
--  trg_facturas_sync_pagosf intenta SET facturas_id en pagosf,
--  columna que ya fue eliminada → error "column does not exist".
--
--  Solución:
--    1. Eliminar los triggers viejos de sincronización facturas↔pagosf
--    2. Actualizar confirmar_venta_credito para insertar en `ventas`
--       (tipo = 'CREDITO') en lugar de `facturas`
-- =============================================================

-- ── 1. Eliminar triggers de sincronización facturas↔pagosf ───
DROP TRIGGER IF EXISTS trg_facturas_sync_pagosf     ON public.facturas;
DROP TRIGGER IF EXISTS trg_pagosf_set_facturas_id   ON public.pagosf;

-- Eliminar también las funciones de trigger si ya no son necesarias
DROP FUNCTION IF EXISTS facturas_sync_pagosf_id()     CASCADE;
DROP FUNCTION IF EXISTS pagosf_auto_set_facturas_id() CASCADE;

-- ── 2. Actualizar confirmar_venta_credito → usa ventas ────────
CREATE OR REPLACE FUNCTION public.confirmar_venta_credito(
    p_factura_numero      TEXT,
    p_cliente_id          UUID,
    p_cajero_id           TEXT,
    p_cajero              TEXT,
    p_caja                TEXT,
    p_cai                 TEXT,
    p_productos           JSONB,
    p_sub_total           NUMERIC,
    p_isv_15              NUMERIC,
    p_isv_18              NUMERIC,
    p_total               NUMERIC,
    p_fecha_hora          TEXT,
    p_tipo_orden          TEXT DEFAULT 'PARA LLEVAR',
    p_dias_vencimiento    INT  DEFAULT 30,
    p_observaciones       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cuenta_id       UUID;
    v_saldo_anterior  NUMERIC := 0;
    v_nuevo_saldo     NUMERIC;
    v_factura_id      UUID;
    v_fecha_vcto      TIMESTAMPTZ;
    v_nombre_cliente  TEXT;
BEGIN
    -- 0. Obtener nombre del cliente
    SELECT nombre INTO v_nombre_cliente
        FROM public.clientes_credito
        WHERE id = p_cliente_id;

    -- 1. Obtener o crear cuenta por cobrar del cliente
    SELECT id, saldo_actual INTO v_cuenta_id, v_saldo_anterior
        FROM public.cuentas_por_cobrar
        WHERE cliente_id = p_cliente_id;

    IF v_cuenta_id IS NULL THEN
        INSERT INTO public.cuentas_por_cobrar
            (cliente_id, saldo_actual, total_facturado, total_pagado, estado, ultima_compra)
        VALUES
            (p_cliente_id, 0, 0, 0, 'activo', NOW())
        RETURNING id INTO v_cuenta_id;

        v_saldo_anterior := 0;
    END IF;

    -- 2. Calcular nuevo saldo y fecha de vencimiento
    v_nuevo_saldo := v_saldo_anterior + p_total;
    v_fecha_vcto  := NOW() + (p_dias_vencimiento || ' days')::INTERVAL;

    -- 3. Insertar en ventas (tabla principal, tipo = 'CREDITO')
    --    Los campos de pago van en cero porque el pago es diferido.
    --    tipo_documento_fiscal = 'RECIBO' porque las ventas a crédito
    --    usan correlativo de recibo, no número SAR fiscal.
    INSERT INTO public.ventas
        (fecha_hora, cajero, cajero_id, caja, cai, factura, cliente,
         tipo, tipo_orden, operation_id, tipo_documento_fiscal,
         productos, sub_total, isv_15, isv_18, total,
         efectivo, tarjeta, transferencia, dolares, dolares_usd,
         delivery, total_recibido, cambio)
    VALUES
        (p_fecha_hora::TIMESTAMPTZ,
         p_cajero, p_cajero_id, p_caja, p_cai,
         p_factura_numero, v_nombre_cliente,
         'CREDITO', p_tipo_orden, gen_random_uuid(), 'RECIBO',
         p_productos::TEXT, p_sub_total, p_isv_15, p_isv_18, p_total,
         0, 0, 0, 0, 0,
         0, 0, 0);

    -- 4. Insertar en facturas_credito (gestión de cartera)
    INSERT INTO public.facturas_credito
        (factura_numero, cliente_id, cuenta_cobrar_id, cajero_id, cajero,
         caja, cai, productos, sub_total, isv_15, isv_18, total,
         saldo_anterior, nuevo_saldo, estado, fecha_vencimiento,
         fecha_hora, observaciones, tipo_orden)
    VALUES
        (p_factura_numero, p_cliente_id, v_cuenta_id, p_cajero_id, p_cajero,
         p_caja, p_cai, p_productos, p_sub_total, p_isv_15, p_isv_18, p_total,
         v_saldo_anterior, v_nuevo_saldo, 'pendiente', v_fecha_vcto,
         p_fecha_hora::TIMESTAMPTZ, p_observaciones, p_tipo_orden)
    RETURNING id INTO v_factura_id;

    -- 5. Actualizar cuenta por cobrar
    UPDATE public.cuentas_por_cobrar
        SET saldo_actual    = v_nuevo_saldo,
            total_facturado = total_facturado + p_total,
            ultima_compra   = NOW(),
            actualizado_en  = NOW()
        WHERE id = v_cuenta_id;

    RETURN jsonb_build_object(
        'ok',             true,
        'factura_id',     v_factura_id,
        'cuenta_id',      v_cuenta_id,
        'saldo_anterior', v_saldo_anterior,
        'nuevo_saldo',    v_nuevo_saldo
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'ok',    false,
        'error', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.confirmar_venta_credito IS
    'Crea venta a crédito: inserta en ventas (tipo=CREDITO) + facturas_credito + actualiza CxC. No usa tabla facturas (legacy).';
