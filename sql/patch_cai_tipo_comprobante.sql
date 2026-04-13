-- =============================================================
--  PARCHE: Agregar tipo_comprobante a cai_facturas
--
--  Permite que un cajero tenga DOS registros activos:
--    - tipo_comprobante = 'RECIBO'   → correlativo para recibos simples
--    - tipo_comprobante = 'FACTURA'  → correlativo SAR con formato oficial
--
--  EJECUTAR EN: Supabase SQL Editor
-- =============================================================

-- 1. Agregar la columna tipo_comprobante
ALTER TABLE public.cai_facturas
  ADD COLUMN IF NOT EXISTS tipo_comprobante TEXT NOT NULL DEFAULT 'FACTURA';

COMMENT ON COLUMN public.cai_facturas.tipo_comprobante
  IS 'FACTURA = correlativo SAR oficial (siguiente_numero_factura_sar) | '
     'RECIBO = correlativo simple para recibos sin fiscal';

-- 2. Constraint de valores válidos
ALTER TABLE public.cai_facturas
  DROP CONSTRAINT IF EXISTS chk_cai_tipo_comprobante;
ALTER TABLE public.cai_facturas
  ADD CONSTRAINT chk_cai_tipo_comprobante
  CHECK (tipo_comprobante IN ('FACTURA', 'RECIBO'));

-- 3. Eliminar el índice único anterior (solo uno activo por cajero)
DROP INDEX IF EXISTS public.uq_cai_activo_por_cajero;

-- 4. Nuevo índice único: un activo por cajero POR TIPO
--    → un cajero puede tener un CAI FACTURA activo Y un CAI RECIBO activo
CREATE UNIQUE INDEX IF NOT EXISTS uq_cai_activo_por_cajero_tipo
  ON public.cai_facturas (cajero_id, tipo_comprobante)
  WHERE activo = TRUE;

-- 5. Actualizar la función siguiente_numero_factura_sar para filtrar por tipo
--    (solo debe devolver filas con tipo_comprobante = 'FACTURA')
CREATE OR REPLACE FUNCTION public.siguiente_numero_factura_sar(
  p_cajero_id UUID
)
RETURNS TABLE (
  numero_secuencial       INTEGER,
  numero_factura_formado  TEXT,
  cai                     TEXT,
  rango_desde             INTEGER,
  rango_hasta             INTEGER,
  fecha_limite_emision    DATE,
  numero_establecimiento  TEXT,
  punto_emision           TEXT,
  tipo_documento          TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cai_row        RECORD;
  v_factura_actual INTEGER;
  v_siguiente      INTEGER;
  v_numero_formado TEXT;
BEGIN
  SELECT cf.*
  INTO   v_cai_row
  FROM   public.cai_facturas cf
  WHERE  cf.cajero_id          = p_cajero_id
    AND  cf.activo             = TRUE
    AND  cf.tipo_comprobante   = 'FACTURA'          -- <-- solo CAI tipo FACTURA
    AND  (cf.fecha_limite_emision IS NULL OR cf.fecha_limite_emision >= CURRENT_DATE)
  ORDER  BY cf.creado_en DESC
  LIMIT  1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SAR-001: No existe CAI de tipo FACTURA activo y vigente para el cajero %. '
      'Cree un registro CAI con tipo_comprobante = FACTURA en el módulo CAI.',
      p_cajero_id
    USING ERRCODE = 'P0001';
  END IF;

  v_factura_actual := COALESCE(v_cai_row.factura_actual::INTEGER, v_cai_row.rango_desde - 1);
  v_siguiente      := v_factura_actual + 1;

  IF v_siguiente > v_cai_row.rango_hasta THEN
    RAISE EXCEPTION
      'SAR-002: Rango de facturas AGOTADO para CAI %. '
      'Último: %. Límite: %. Solicite nuevo CAI al SAR.',
      v_cai_row.cai, v_factura_actual, v_cai_row.rango_hasta
    USING ERRCODE = 'P0002';
  END IF;

  v_numero_formado := CONCAT(
    v_cai_row.numero_establecimiento, '-',
    v_cai_row.punto_emision,          '-',
    v_cai_row.tipo_documento,         '-',
    LPAD(v_siguiente::TEXT, 8, '0')
  );

  UPDATE public.cai_facturas
  SET    factura_actual = v_siguiente::TEXT
  WHERE  id = v_cai_row.id;

  RETURN QUERY
  SELECT
    v_siguiente,
    v_numero_formado,
    v_cai_row.cai,
    v_cai_row.rango_desde,
    v_cai_row.rango_hasta,
    v_cai_row.fecha_limite_emision,
    v_cai_row.numero_establecimiento,
    v_cai_row.punto_emision,
    v_cai_row.tipo_documento;
END;
$$;

-- 6. Actualizar obtener_siguiente_factura para filtrar por RECIBO
CREATE OR REPLACE FUNCTION public.obtener_siguiente_factura(p_cajero_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_factura_actual TEXT;
    v_rango_desde    INTEGER;
    v_rango_hasta    INTEGER;
    v_num            INTEGER;
    v_existe         BOOLEAN;
BEGIN
    -- Buscar CAI tipo RECIBO activo; si no hay, caer en cualquier CAI activo
    SELECT factura_actual, rango_desde, rango_hasta
    INTO   v_factura_actual, v_rango_desde, v_rango_hasta
    FROM   public.cai_facturas
    WHERE  cajero_id        = p_cajero_id::UUID
      AND  activo           = TRUE
      AND  tipo_comprobante = 'RECIBO'
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Fallback: cualquier CAI activo (comportamiento anterior)
        SELECT factura_actual, rango_desde, rango_hasta
        INTO   v_factura_actual, v_rango_desde, v_rango_hasta
        FROM   public.cai_facturas
        WHERE  cajero_id = p_cajero_id::UUID
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
    END IF;

    IF v_factura_actual IS NULL OR TRIM(v_factura_actual) = '' THEN
        v_num := v_rango_desde;
    ELSE
        BEGIN
            v_num := v_factura_actual::INTEGER;
        EXCEPTION WHEN OTHERS THEN
            v_num := v_rango_desde;
        END;
    END IF;

    -- Buscar siguiente número no usado
    LOOP
        IF v_num > v_rango_hasta THEN
            RETURN 'LIMITE_ALCANZADO';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.ventas
            WHERE  factura   = v_num::TEXT
              AND  cajero_id = p_cajero_id
        ) INTO v_existe;

        EXIT WHEN NOT v_existe;
        v_num := v_num + 1;
    END LOOP;

    UPDATE public.cai_facturas
    SET    factura_actual = (v_num + 1)::TEXT
    WHERE  cajero_id        = p_cajero_id::UUID
      AND  activo           = TRUE
      AND  (tipo_comprobante = 'RECIBO'
            OR NOT EXISTS (
                SELECT 1 FROM public.cai_facturas
                WHERE  cajero_id = p_cajero_id::UUID
                  AND  activo    = TRUE
                  AND  tipo_comprobante = 'RECIBO'
            ));

    RETURN v_num::TEXT;
END;
$$;

-- 7. Verificar el resultado
SELECT id, cajero_id, tipo_comprobante, activo, cai,
       rango_desde, rango_hasta, factura_actual, fecha_limite_emision
FROM   public.cai_facturas
ORDER  BY cajero_id, tipo_comprobante;
