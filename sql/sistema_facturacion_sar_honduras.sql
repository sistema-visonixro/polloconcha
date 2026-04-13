-- =============================================================
--  SISTEMA DE FACTURACIÓN SAR HONDURAS
--  Versión: 1.0  |  Fecha: 2026-04-13
--
--  ENTREGABLES:
--    1. Mejora de tabla cai_facturas
--    2. Columnas fiscales en tabla ventas
--    3. Tabla facturacion_sar
--    4. Función para siguiente número de factura (concurrencia segura)
--    5. Trigger para auto-registrar en facturacion_sar
--    6. Vista reporte_facturas_sar
--
--  NORMATIVA: SAR Honduras - Resolución de facturación correlativa
--  FORMATO FACTURA SAR: NNN-NNN-NN-NNNNNNNN (ej: 001-001-01-00000001)
--    [establecimiento]-[punto_emision]-[tipo_doc]-[secuencial]
--
--  EJECUTAR EN: Supabase SQL Editor (orden estricta, de arriba a abajo)
-- =============================================================


-- =============================================================
-- ══════════════════════════════════════════════════════════════
--  BLOQUE 1: MEJORAR TABLA cai_facturas
--  Agrega campos fiscales requeridos por SAR Honduras
-- ══════════════════════════════════════════════════════════════
-- =============================================================

-- 1.1 Fecha límite de emisión (OBLIGATORIO por SAR)
ALTER TABLE public.cai_facturas
  ADD COLUMN IF NOT EXISTS fecha_limite_emision DATE;

COMMENT ON COLUMN public.cai_facturas.fecha_limite_emision
  IS 'Fecha máxima para emitir facturas con este CAI (SAR Honduras)';

-- 1.2 Número de establecimiento (3 dígitos, ej: "001")
ALTER TABLE public.cai_facturas
  ADD COLUMN IF NOT EXISTS numero_establecimiento TEXT NOT NULL DEFAULT '001';

COMMENT ON COLUMN public.cai_facturas.numero_establecimiento
  IS 'Primeros 3 dígitos del número de factura SAR (sucursal/establecimiento)';

-- 1.3 Punto de emisión (3 dígitos, ej: "001" = Caja 1)
ALTER TABLE public.cai_facturas
  ADD COLUMN IF NOT EXISTS punto_emision TEXT NOT NULL DEFAULT '001';

COMMENT ON COLUMN public.cai_facturas.punto_emision
  IS 'Segundos 3 dígitos del número de factura SAR (caja/punto de venta)';

-- 1.4 Tipo de documento SAR
--   01 = Factura de Consumidor Final
--   02 = Factura de Exportación
--   03 = Factura de Servicios Empresariales
ALTER TABLE public.cai_facturas
  ADD COLUMN IF NOT EXISTS tipo_documento TEXT NOT NULL DEFAULT '01';

COMMENT ON COLUMN public.cai_facturas.tipo_documento
  IS '01=Consumidor Final | 02=Exportación | 03=Servicios Empresariales';

-- 1.5 Estado activo/inactivo (un cajero puede tener históricos de CAI)
ALTER TABLE public.cai_facturas
  ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.cai_facturas.activo
  IS 'Solo el CAI activo genera facturas. Los anteriores quedan como histórico';

-- 1.6 Convertir factura_actual a INTEGER para operaciones aritméticas seguras
--     (era TEXT, lo mantenemos TEXT para compatibilidad pero usamos función)
COMMENT ON COLUMN public.cai_facturas.factura_actual
  IS 'Último número secuencial emitido (se incrementa con cada factura SAR)';

-- 1.7 Constraint: solo un CAI activo por cajero
CREATE UNIQUE INDEX IF NOT EXISTS uq_cai_activo_por_cajero
  ON public.cai_facturas (cajero_id)
  WHERE activo = TRUE;

-- 1.8 Constraints de formato SAR
ALTER TABLE public.cai_facturas
  DROP CONSTRAINT IF EXISTS chk_cai_numero_establecimiento;
ALTER TABLE public.cai_facturas
  ADD CONSTRAINT chk_cai_numero_establecimiento
  CHECK (numero_establecimiento ~ '^\d{3}$');

ALTER TABLE public.cai_facturas
  DROP CONSTRAINT IF EXISTS chk_cai_punto_emision;
ALTER TABLE public.cai_facturas
  ADD CONSTRAINT chk_cai_punto_emision
  CHECK (punto_emision ~ '^\d{3}$');

ALTER TABLE public.cai_facturas
  DROP CONSTRAINT IF EXISTS chk_cai_tipo_documento;
ALTER TABLE public.cai_facturas
  ADD CONSTRAINT chk_cai_tipo_documento
  CHECK (tipo_documento IN ('01', '02', '03'));

ALTER TABLE public.cai_facturas
  DROP CONSTRAINT IF EXISTS chk_cai_rango;
ALTER TABLE public.cai_facturas
  ADD CONSTRAINT chk_cai_rango
  CHECK (rango_hasta >= rango_desde AND rango_desde > 0);

-- 1.9 Índices útiles
CREATE INDEX IF NOT EXISTS idx_cai_cajero_activo
  ON public.cai_facturas (cajero_id, activo);

CREATE INDEX IF NOT EXISTS idx_cai_fecha_limite
  ON public.cai_facturas (fecha_limite_emision)
  WHERE activo = TRUE;


-- =============================================================
-- ══════════════════════════════════════════════════════════════
--  BLOQUE 2: COLUMNAS FISCALES EN TABLA ventas
--  Se agregan sin romper la estructura existente
-- ══════════════════════════════════════════════════════════════
-- =============================================================

-- 2.1 Tipo de documento fiscal: FACTURA o RECIBO (distinción SAR)
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS tipo_documento_fiscal TEXT NOT NULL DEFAULT 'RECIBO';

COMMENT ON COLUMN public.ventas.tipo_documento_fiscal
  IS 'FACTURA = emite factura SAR con correlativo | RECIBO = sin número fiscal';

ALTER TABLE public.ventas
  DROP CONSTRAINT IF EXISTS chk_ventas_tipo_doc_fiscal;
ALTER TABLE public.ventas
  ADD CONSTRAINT chk_ventas_tipo_doc_fiscal
  CHECK (tipo_documento_fiscal IN ('FACTURA', 'RECIBO'));

-- 2.2 RTN del cliente (Registro Tributario Nacional - 14 dígitos)
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS rtn_cliente TEXT;

COMMENT ON COLUMN public.ventas.rtn_cliente
  IS 'RTN del cliente (14 dígitos). NULL si es consumidor final sin RTN';

-- 2.3 Nombre completo del cliente para la factura SAR
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS nombre_cliente_fiscal TEXT;

COMMENT ON COLUMN public.ventas.nombre_cliente_fiscal
  IS 'Nombre del cliente tal como aparece en la factura SAR';

-- 2.4 Número secuencial puro (para ordenamiento interno)
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS numero_secuencial INTEGER;

COMMENT ON COLUMN public.ventas.numero_secuencial
  IS 'Número entero del correlativo SAR (sin formato). NULL si es RECIBO';

-- 2.5 Fecha límite de emisión del CAI al momento de facturar
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS fecha_limite_emision_cai DATE;

COMMENT ON COLUMN public.ventas.fecha_limite_emision_cai
  IS 'Copia de la fecha límite del CAI al momento de emitir la factura';

-- 2.6 Montos exentos de ISV (alimentos básicos, medicamentos, etc.)
ALTER TABLE public.ventas
  ADD COLUMN IF NOT EXISTS exento NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ventas.exento
  IS 'Monto exento de ISV según SAR Honduras (canasta básica, medicamentos)';

-- 2.7 Índice para reportes fiscales
CREATE INDEX IF NOT EXISTS idx_ventas_tipo_doc_fiscal
  ON public.ventas (tipo_documento_fiscal, fecha_hora)
  WHERE tipo_documento_fiscal = 'FACTURA';

CREATE INDEX IF NOT EXISTS idx_ventas_rtn_cliente
  ON public.ventas (rtn_cliente)
  WHERE rtn_cliente IS NOT NULL;


-- =============================================================
-- ══════════════════════════════════════════════════════════════
--  BLOQUE 3: TABLA facturacion_sar
--  Registro fiscal exclusivo para documentos tipo FACTURA.
--  Es la fuente oficial para declaraciones ante el SAR.
-- ══════════════════════════════════════════════════════════════
-- =============================================================

CREATE TABLE IF NOT EXISTS public.facturacion_sar (

  -- ── Identidad ────────────────────────────────────────────────
  id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
  venta_id                INTEGER       REFERENCES public.ventas(id) ON DELETE SET NULL,

  -- ── Datos del documento fiscal ───────────────────────────────
  numero_factura          TEXT          NOT NULL,  -- Ej: "001-001-01-00000001"
  numero_secuencial       INTEGER       NOT NULL,  -- Correlativo puro: 1, 2, 3...
  cai                     TEXT          NOT NULL,
  rango_desde             INTEGER       NOT NULL,
  rango_hasta             INTEGER       NOT NULL,
  fecha_limite_emision    DATE          NOT NULL,
  numero_establecimiento  TEXT          NOT NULL DEFAULT '001',
  punto_emision           TEXT          NOT NULL DEFAULT '001',
  tipo_documento          TEXT          NOT NULL DEFAULT '01',  -- 01=Consumidor Final

  -- ── Datos del emisor (snapshot en el momento de emitir) ──────
  rtn_emisor              TEXT          NOT NULL,  -- RTN del negocio
  nombre_emisor           TEXT          NOT NULL,
  direccion_emisor        TEXT,

  -- ── Datos del cliente ────────────────────────────────────────
  rtn_cliente             TEXT,          -- NULL = sin RTN (consumidor final)
  nombre_cliente          TEXT          NOT NULL DEFAULT 'CONSUMIDOR FINAL',

  -- ── Datos del cajero / caja ──────────────────────────────────
  cajero_id               UUID,
  cajero                  TEXT,
  caja                    TEXT,

  -- ── Productos / detalle ──────────────────────────────────────
  productos               JSONB         NOT NULL DEFAULT '[]'::jsonb,
  tipo_orden              TEXT,           -- PARA LLEVAR | COMER AQUÍ | DELIVERY

  -- ── Montos fiscales SAR ──────────────────────────────────────
  --    ISV Honduras: 15% general, 18% alcohol/tabaco/hoteles 1ra clase
  exento                  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Sin ISV
  gravado_15              NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Base imponible 15%
  gravado_18              NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Base imponible 18%
  isv_15                  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- ISV al 15%
  isv_18                  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- ISV al 18%
  descuento               NUMERIC(12,2) NOT NULL DEFAULT 0,
  sub_total               NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Antes de impuestos
  total                   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- Total a pagar

  -- ── Métodos de pago ──────────────────────────────────────────
  efectivo                NUMERIC(12,2) NOT NULL DEFAULT 0,
  tarjeta                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  transferencia           NUMERIC(12,2) NOT NULL DEFAULT 0,
  dolares                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_recibido          NUMERIC(12,2) NOT NULL DEFAULT 0,
  cambio                  NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- ── Anulación (SAR exige conservar anuladas) ─────────────────
  anulada                 BOOLEAN       NOT NULL DEFAULT FALSE,
  fecha_anulacion         TIMESTAMP WITH TIME ZONE,
  motivo_anulacion        TEXT,
  anulada_por             TEXT,          -- nombre del usuario que anuló

  -- ── Auditoría ────────────────────────────────────────────────
  fecha_emision           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  creado_en               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  actualizado_en          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- ── Constraints ──────────────────────────────────────────────
  CONSTRAINT facturacion_sar_pkey
    PRIMARY KEY (id),

  -- Número de factura único globalmente (SAR no permite duplicados)
  CONSTRAINT uq_facturacion_sar_numero
    UNIQUE (numero_factura),

  -- Correlativo único por CAI (cada CAI tiene su propia secuencia)
  CONSTRAINT uq_facturacion_sar_secuencial_cai
    UNIQUE (cai, numero_secuencial),

  -- Validaciones de formato
  CONSTRAINT chk_sar_tipo_documento
    CHECK (tipo_documento IN ('01', '02', '03')),

  CONSTRAINT chk_sar_rango_valido
    CHECK (numero_secuencial BETWEEN rango_desde AND rango_hasta),

  CONSTRAINT chk_sar_fecha_limite
    CHECK (fecha_emision::DATE <= fecha_limite_emision),

  CONSTRAINT chk_sar_totales_positivos
    CHECK (sub_total >= 0 AND total >= 0 AND isv_15 >= 0 AND isv_18 >= 0),

  CONSTRAINT chk_sar_numero_establecimiento
    CHECK (numero_establecimiento ~ '^\d{3}$'),

  CONSTRAINT chk_sar_punto_emision
    CHECK (punto_emision ~ '^\d{3}$')
);

COMMENT ON TABLE public.facturacion_sar
  IS 'Registro oficial de facturas SAR Honduras. Solo documentos tipo FACTURA. Base para declaraciones fiscales.';

-- ── Índices ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sar_fecha_emision
  ON public.facturacion_sar (fecha_emision DESC);

CREATE INDEX IF NOT EXISTS idx_sar_cajero_fecha
  ON public.facturacion_sar (cajero_id, fecha_emision DESC);

CREATE INDEX IF NOT EXISTS idx_sar_cai
  ON public.facturacion_sar (cai);

CREATE INDEX IF NOT EXISTS idx_sar_rtn_cliente
  ON public.facturacion_sar (rtn_cliente)
  WHERE rtn_cliente IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sar_anulada
  ON public.facturacion_sar (anulada, fecha_emision)
  WHERE anulada = TRUE;

CREATE INDEX IF NOT EXISTS idx_sar_venta_id
  ON public.facturacion_sar (venta_id)
  WHERE venta_id IS NOT NULL;

-- ── Trigger: actualizar campo actualizado_en ──────────────────────────────
CREATE OR REPLACE FUNCTION public.sar_set_actualizado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sar_actualizado_en ON public.facturacion_sar;
CREATE TRIGGER trg_sar_actualizado_en
  BEFORE UPDATE ON public.facturacion_sar
  FOR EACH ROW EXECUTE FUNCTION public.sar_set_actualizado_en();

-- ── RLS (Row Level Security) ───────────────────────────────────────────────
ALTER TABLE public.facturacion_sar ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- ══════════════════════════════════════════════════════════════
--  BLOQUE 4: FUNCIONES PRINCIPALES
-- ══════════════════════════════════════════════════════════════
-- =============================================================

-- ─────────────────────────────────────────────────────────────
--  4.1 FUNCIÓN: siguiente_numero_factura_sar
--      Obtiene y reserva el siguiente número correlativo del CAI
--      activo para un cajero dado.
--
--      USO DESDE APP: SELECT * FROM siguiente_numero_factura_sar('uuid-cajero');
--
--      SEGURIDAD CONCURRENTE: usa FOR UPDATE para bloquear la fila
--      mientras se lee y actualiza el contador -> evita duplicados
--      incluso con múltiples cajeros facturando simultáneamente.
-- ─────────────────────────────────────────────────────────────
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
SECURITY DEFINER   -- Ejecuta con permisos del dueño de la función
AS $$
DECLARE
  v_cai_row         RECORD;
  v_factura_actual  INTEGER;
  v_siguiente       INTEGER;
  v_numero_formado  TEXT;
BEGIN

  -- ── Paso 1: Obtener y BLOQUEAR el CAI activo del cajero ────────────────
  --    FOR UPDATE garantiza exclusión mutua entre transacciones concurrentes
  SELECT cf.*
  INTO   v_cai_row
  FROM   public.cai_facturas cf
  WHERE  cf.cajero_id          = p_cajero_id
    AND  cf.activo             = TRUE
    AND  (cf.fecha_limite_emision IS NULL OR cf.fecha_limite_emision >= CURRENT_DATE)
  ORDER  BY cf.creado_en DESC
  LIMIT  1
  FOR UPDATE;  -- <-- Bloqueo a nivel de fila (concurrencia segura)

  -- ── Paso 2: Validar que existe un CAI vigente ──────────────────────────
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SAR-001: No existe CAI activo y vigente para el cajero %. '
      'Verifique que el CAI no haya expirado y esté marcado como activo.',
      p_cajero_id
    USING ERRCODE = 'P0001';
  END IF;

  -- ── Paso 3: Calcular siguiente correlativo ─────────────────────────────
  v_factura_actual := COALESCE(v_cai_row.factura_actual::INTEGER, v_cai_row.rango_desde - 1);
  v_siguiente      := v_factura_actual + 1;

  -- ── Paso 4: Validar que no excede el rango autorizado por SAR ──────────
  IF v_siguiente > v_cai_row.rango_hasta THEN
    RAISE EXCEPTION
      'SAR-002: Rango de facturas AGOTADO para CAI %. '
      'Último número usado: %. Límite autorizado: %. '
      'Solicite un nuevo CAI al SAR Honduras.',
      v_cai_row.cai, v_factura_actual, v_cai_row.rango_hasta
    USING ERRCODE = 'P0002';
  END IF;

  -- ── Paso 5: Formatear número de factura al estándar SAR Honduras ───────
  --    Formato: NNN-NNN-NN-NNNNNNNN
  v_numero_formado := CONCAT(
    v_cai_row.numero_establecimiento, '-',   -- 001
    v_cai_row.punto_emision,          '-',   -- 001
    v_cai_row.tipo_documento,         '-',   -- 01
    LPAD(v_siguiente::TEXT, 8, '0')          -- 00000001
  );

  -- ── Paso 6: Actualizar el contador en cai_facturas (dentro del lock) ───
  UPDATE public.cai_facturas
  SET    factura_actual = v_siguiente::TEXT
  WHERE  id = v_cai_row.id;

  -- ── Paso 7: Retornar los datos completos para usarlos en la venta ──────
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

COMMENT ON FUNCTION public.siguiente_numero_factura_sar(UUID)
  IS 'Reserva atómicamente el siguiente número de factura SAR para un cajero. '
     'Usa FOR UPDATE para prevenir duplicados con múltiples cajeros concurrentes. '
     'Lanza excepción si no hay CAI activo o el rango está agotado.';


-- ─────────────────────────────────────────────────────────────
--  4.2 FUNCIÓN: validar_cai_vigente
--      Verifica si el CAI del cajero está activo y dentro de rango
--      Útil para mostrar advertencias en el frontend antes de facturar
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validar_cai_vigente(
  p_cajero_id UUID
)
RETURNS TABLE (
  valido                  BOOLEAN,
  mensaje                 TEXT,
  facturas_disponibles    INTEGER,
  dias_para_vencer        INTEGER,
  porcentaje_usado        NUMERIC(5,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cai_row RECORD;
  v_actual  INTEGER;
BEGIN
  SELECT cf.*
  INTO   v_cai_row
  FROM   public.cai_facturas cf
  WHERE  cf.cajero_id = p_cajero_id
    AND  cf.activo    = TRUE
  ORDER  BY cf.creado_en DESC
  LIMIT  1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      FALSE,
      'No existe CAI configurado para este cajero.',
      0, 0, 0::NUMERIC(5,2);
    RETURN;
  END IF;

  v_actual := COALESCE(v_cai_row.factura_actual::INTEGER, v_cai_row.rango_desde - 1);

  IF v_cai_row.fecha_limite_emision < CURRENT_DATE THEN
    RETURN QUERY SELECT
      FALSE,
      FORMAT('CAI vencido el %s. Solicite renovación al SAR.', v_cai_row.fecha_limite_emision),
      0,
      (v_cai_row.fecha_limite_emision - CURRENT_DATE),
      ROUND(((v_actual - v_cai_row.rango_desde + 1)::NUMERIC /
             (v_cai_row.rango_hasta - v_cai_row.rango_desde + 1)) * 100, 2);
    RETURN;
  END IF;

  IF v_actual >= v_cai_row.rango_hasta THEN
    RETURN QUERY SELECT
      FALSE,
      FORMAT('Rango de facturas agotado (último: %s, límite: %s).', v_actual, v_cai_row.rango_hasta),
      0,
      (v_cai_row.fecha_limite_emision - CURRENT_DATE),
      100::NUMERIC(5,2);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    FORMAT('CAI vigente. Próxima factura: %s. Vence: %s.',
           v_actual + 1, v_cai_row.fecha_limite_emision),
    (v_cai_row.rango_hasta - v_actual),
    (v_cai_row.fecha_limite_emision - CURRENT_DATE),
    ROUND(((v_actual - v_cai_row.rango_desde + 1)::NUMERIC /
           (v_cai_row.rango_hasta - v_cai_row.rango_desde + 1)) * 100, 2);
END;
$$;

COMMENT ON FUNCTION public.validar_cai_vigente(UUID)
  IS 'Verifica el estado del CAI activo de un cajero sin consumir número. '
     'Usar en el frontend para mostrar alertas antes de facturar.';


-- ─────────────────────────────────────────────────────────────
--  4.3 FUNCIÓN: registrar_factura_sar
--      Inserta el registro completo en facturacion_sar
--      Se llama desde el trigger de ventas o directamente desde app
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_factura_sar(
  p_venta_id              INTEGER,      -- ID de la venta en tabla ventas
  p_numero_factura        TEXT,         -- Número formateado: 001-001-01-00000001
  p_numero_secuencial     INTEGER,
  p_cai                   TEXT,
  p_rango_desde           INTEGER,
  p_rango_hasta           INTEGER,
  p_fecha_limite_emision  DATE,
  p_numero_establecimiento TEXT,
  p_punto_emision         TEXT,
  p_tipo_documento        TEXT,
  p_cajero_id             UUID,
  p_cajero                TEXT,
  p_caja                  TEXT,
  p_rtn_cliente           TEXT,
  p_nombre_cliente        TEXT,
  p_productos             JSONB,
  p_tipo_orden            TEXT,
  p_exento                NUMERIC,
  p_sub_total             NUMERIC,
  p_isv_15                NUMERIC,
  p_isv_18                NUMERIC,
  p_descuento             NUMERIC,
  p_total                 NUMERIC,
  p_efectivo              NUMERIC,
  p_tarjeta               NUMERIC,
  p_transferencia         NUMERIC,
  p_dolares               NUMERIC,
  p_total_recibido        NUMERIC,
  p_cambio                NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rtn_emisor    TEXT;
  v_nombre_emisor TEXT;
  v_direccion     TEXT;
  v_id_nuevo      UUID;
  v_gravado_15    NUMERIC;
  v_gravado_18    NUMERIC;
BEGIN
  -- Obtener datos del negocio (emisor) desde tabla datos_negocio
  SELECT rtn, nombre_negocio, direccion
  INTO   v_rtn_emisor, v_nombre_emisor, v_direccion
  FROM   public.datos_negocio
  ORDER  BY id DESC
  LIMIT  1;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SAR-003: No se encontraron datos del negocio. '
      'Configure la tabla datos_negocio antes de emitir facturas.'
    USING ERRCODE = 'P0003';
  END IF;

  -- Calcular bases imponibles (ISV = base * tasa)
  -- El sub_total ya excluye ISV; los campos isv_15 e isv_18 son los impuestos
  v_gravado_15 := ROUND(p_isv_15 / 0.15, 2);  -- base al 15%
  v_gravado_18 := ROUND(p_isv_18 / 0.18, 2);  -- base al 18%

  INSERT INTO public.facturacion_sar (
    venta_id, numero_factura, numero_secuencial,
    cai, rango_desde, rango_hasta, fecha_limite_emision,
    numero_establecimiento, punto_emision, tipo_documento,
    rtn_emisor, nombre_emisor, direccion_emisor,
    rtn_cliente, nombre_cliente,
    cajero_id, cajero, caja,
    productos, tipo_orden,
    exento, gravado_15, gravado_18,
    isv_15, isv_18, descuento, sub_total, total,
    efectivo, tarjeta, transferencia, dolares,
    total_recibido, cambio,
    fecha_emision
  )
  VALUES (
    p_venta_id, p_numero_factura, p_numero_secuencial,
    p_cai, p_rango_desde, p_rango_hasta, p_fecha_limite_emision,
    p_numero_establecimiento, p_punto_emision, p_tipo_documento,
    v_rtn_emisor, v_nombre_emisor, v_direccion,
    NULLIF(TRIM(COALESCE(p_rtn_cliente, '')), ''),
    COALESCE(NULLIF(TRIM(p_nombre_cliente), ''), 'CONSUMIDOR FINAL'),
    p_cajero_id, p_cajero, p_caja,
    p_productos, p_tipo_orden,
    COALESCE(p_exento, 0), v_gravado_15, v_gravado_18,
    COALESCE(p_isv_15, 0), COALESCE(p_isv_18, 0),
    COALESCE(p_descuento, 0), COALESCE(p_sub_total, 0), COALESCE(p_total, 0),
    COALESCE(p_efectivo, 0), COALESCE(p_tarjeta, 0),
    COALESCE(p_transferencia, 0), COALESCE(p_dolares, 0),
    COALESCE(p_total_recibido, 0), COALESCE(p_cambio, 0),
    NOW()
  )
  RETURNING id INTO v_id_nuevo;

  RETURN v_id_nuevo;
END;
$$;

COMMENT ON FUNCTION public.registrar_factura_sar
  IS 'Inserta un documento fiscal completo en facturacion_sar. '
     'Obtiene automáticamente los datos del emisor desde datos_negocio. '
     'Calcula bases imponibles gravado_15 y gravado_18 automáticamente.';


-- ─────────────────────────────────────────────────────────────
--  4.4 FUNCIÓN: anular_factura_sar
--      Marca una factura como anulada (SAR exige no eliminar, solo anular)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.anular_factura_sar(
  p_numero_factura  TEXT,
  p_motivo          TEXT,
  p_anulada_por     TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existe BOOLEAN;
BEGIN
  UPDATE public.facturacion_sar
  SET    anulada          = TRUE,
         fecha_anulacion  = NOW(),
         motivo_anulacion = p_motivo,
         anulada_por      = p_anulada_por
  WHERE  numero_factura   = p_numero_factura
    AND  anulada          = FALSE
  RETURNING TRUE INTO v_existe;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SAR-004: Factura % no encontrada o ya fue anulada.', p_numero_factura
    USING ERRCODE = 'P0004';
  END IF;

  -- Sincronizar estado en ventas si aplica
  UPDATE public.ventas
  SET    tipo = 'ANULADO'
  WHERE  factura             = p_numero_factura
    AND  tipo_documento_fiscal = 'FACTURA';

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.anular_factura_sar(TEXT, TEXT, TEXT)
  IS 'Anula una factura SAR. SAR Honduras exige conservar el registro, '
     'nunca eliminar. Se marca anulada y se registra motivo y responsable.';


-- =============================================================
-- ══════════════════════════════════════════════════════════════
--  BLOQUE 5: TRIGGER AUTOMÁTICO EN ventas
--  Cuando se inserta una venta con tipo_documento_fiscal = 'FACTURA',
--  se replica automáticamente en facturacion_sar
-- ══════════════════════════════════════════════════════════════
-- =============================================================

CREATE OR REPLACE FUNCTION public.trg_sync_facturacion_sar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cai_info  RECORD;
  v_cajero_uuid UUID;
BEGIN
  -- Solo actuar cuando es FACTURA (no RECIBO, no DEVOLUCION, etc.)
  IF NEW.tipo_documento_fiscal <> 'FACTURA' THEN
    RETURN NEW;
  END IF;

  -- No duplicar si ya existe en facturacion_sar (idempotente)
  IF EXISTS (
    SELECT 1 FROM public.facturacion_sar WHERE numero_factura = NEW.factura
  ) THEN
    RETURN NEW;
  END IF;

  -- Convertir cajero_id a UUID de forma segura
  BEGIN
    v_cajero_uuid := NEW.cajero_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_cajero_uuid := NULL;
  END;

  -- Obtener datos complementarios del CAI activo
  SELECT cf.cai, cf.rango_desde, cf.rango_hasta,
         cf.fecha_limite_emision, cf.numero_establecimiento,
         cf.punto_emision, cf.tipo_documento
  INTO   v_cai_info
  FROM   public.cai_facturas cf
  WHERE  cf.cajero_id = v_cajero_uuid
    AND  cf.activo    = TRUE
  ORDER  BY cf.creado_en DESC
  LIMIT  1;

  -- Insertar en facturacion_sar usando la función registrar_factura_sar
  PERFORM public.registrar_factura_sar(
    p_venta_id              => NEW.id,
    p_numero_factura        => NEW.factura,
    p_numero_secuencial     => COALESCE(NEW.numero_secuencial, 0),
    p_cai                   => COALESCE(v_cai_info.cai, NEW.cai, ''),
    p_rango_desde           => COALESCE(v_cai_info.rango_desde, 0),
    p_rango_hasta           => COALESCE(v_cai_info.rango_hasta, 0),
    p_fecha_limite_emision  => COALESCE(NEW.fecha_limite_emision_cai, v_cai_info.fecha_limite_emision, CURRENT_DATE),
    p_numero_establecimiento => COALESCE(v_cai_info.numero_establecimiento, '001'),
    p_punto_emision         => COALESCE(v_cai_info.punto_emision, '001'),
    p_tipo_documento        => COALESCE(v_cai_info.tipo_documento, '01'),
    p_cajero_id             => v_cajero_uuid,
    p_cajero                => NEW.cajero,
    p_caja                  => NEW.caja,
    p_rtn_cliente           => NEW.rtn_cliente,
    p_nombre_cliente        => COALESCE(NEW.nombre_cliente_fiscal, NEW.cliente, 'CONSUMIDOR FINAL'),
    p_productos             => COALESCE(NEW.productos::JSONB, '[]'::JSONB),
    p_tipo_orden            => NEW.tipo_orden,
    p_exento                => COALESCE(NEW.exento, 0),
    p_sub_total             => NEW.sub_total,
    p_isv_15                => NEW.isv_15,
    p_isv_18                => NEW.isv_18,
    p_descuento             => COALESCE(NEW.descuento, 0),
    p_total                 => NEW.total,
    p_efectivo              => NEW.efectivo,
    p_tarjeta               => NEW.tarjeta,
    p_transferencia         => NEW.transferencia,
    p_dolares               => NEW.dolares,
    p_total_recibido        => NEW.total_recibido,
    p_cambio                => NEW.cambio
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Loguear error sin bloquear la venta (para no perder la transacción)
  RAISE WARNING 'trg_sync_facturacion_sar: Error al sincronizar factura %. Detalle: %',
    NEW.factura, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_insert_ventas_sar ON public.ventas;
CREATE TRIGGER trg_after_insert_ventas_sar
  AFTER INSERT ON public.ventas
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_facturacion_sar();

COMMENT ON TRIGGER trg_after_insert_ventas_sar ON public.ventas
  IS 'Replica automáticamente en facturacion_sar toda venta con tipo_documento_fiscal = FACTURA. '
     'Si falla, solo lanza WARNING para no bloquear la venta.';


-- =============================================================
-- ══════════════════════════════════════════════════════════════
--  BLOQUE 6: VISTA reporte_facturas_sar
--  Fuente oficial para declaraciones al SAR Honduras
--  Filtrar por fecha: WHERE fecha_emision BETWEEN '...' AND '...'
-- ══════════════════════════════════════════════════════════════
-- =============================================================

CREATE OR REPLACE VIEW public.reporte_facturas_sar AS
SELECT
  -- ── Identificación del documento ─────────────────────────────────────────
  f.id                                                AS id_registro,
  f.fecha_emision                                     AS fecha_emision,
  f.fecha_emision::DATE                               AS fecha,
  TO_CHAR(f.fecha_emision, 'YYYY-MM')                 AS periodo,
  f.numero_factura                                    AS numero_factura,
  f.numero_secuencial                                 AS correlativo,
  f.cai                                               AS cai,
  f.fecha_limite_emision                              AS fecha_limite_cai,
  f.tipo_documento                                    AS tipo_documento_sar,
  CASE f.tipo_documento
    WHEN '01' THEN 'Factura Consumidor Final'
    WHEN '02' THEN 'Factura de Exportación'
    WHEN '03' THEN 'Factura Servicios Empresariales'
    ELSE 'Desconocido'
  END                                                 AS descripcion_tipo_doc,

  -- ── Datos del emisor ─────────────────────────────────────────────────────
  f.rtn_emisor                                        AS rtn_emisor,
  f.nombre_emisor                                     AS nombre_emisor,
  f.direccion_emisor                                  AS direccion_emisor,

  -- ── Datos del cliente ────────────────────────────────────────────────────
  COALESCE(f.rtn_cliente, '0000-0000-000000')         AS rtn_cliente,
  f.nombre_cliente                                    AS nombre_cliente,

  -- ── Cajero / Caja ────────────────────────────────────────────────────────
  f.cajero                                            AS cajero,
  f.caja                                              AS caja,
  f.numero_establecimiento                            AS establecimiento,
  f.punto_emision                                     AS punto_emision,

  -- ── Montos fiscales (estructura requerida por SAR) ────────────────────────
  f.exento                                            AS monto_exento,
  f.gravado_15                                        AS base_gravable_15,
  f.gravado_18                                        AS base_gravable_18,
  f.isv_15                                            AS isv_15,
  f.isv_18                                            AS isv_18,
  (f.isv_15 + f.isv_18)                              AS total_isv,
  f.descuento                                         AS descuento,
  f.sub_total                                         AS sub_total,
  f.total                                             AS total_factura,

  -- ── Métodos de pago ──────────────────────────────────────────────────────
  f.efectivo                                          AS pago_efectivo,
  f.tarjeta                                           AS pago_tarjeta,
  f.transferencia                                     AS pago_transferencia,
  f.dolares                                           AS pago_dolares_lps,
  f.total_recibido                                    AS total_recibido,
  f.cambio                                            AS cambio_entregado,

  -- ── Estado de la factura ─────────────────────────────────────────────────
  CASE WHEN f.anulada THEN 'ANULADA' ELSE 'VIGENTE' END AS estado,
  f.anulada                                           AS es_anulada,
  f.fecha_anulacion                                   AS fecha_anulacion,
  f.motivo_anulacion                                  AS motivo_anulacion,
  f.anulada_por                                       AS anulada_por,

  -- ── Totales para declaración (cero si anulada) ───────────────────────────
  CASE WHEN f.anulada THEN 0 ELSE f.exento     END   AS declarar_exento,
  CASE WHEN f.anulada THEN 0 ELSE f.gravado_15 END   AS declarar_base_15,
  CASE WHEN f.anulada THEN 0 ELSE f.gravado_18 END   AS declarar_base_18,
  CASE WHEN f.anulada THEN 0 ELSE f.isv_15     END   AS declarar_isv_15,
  CASE WHEN f.anulada THEN 0 ELSE f.isv_18     END   AS declarar_isv_18,
  CASE WHEN f.anulada THEN 0 ELSE f.total      END   AS declarar_total,

  -- ── Enlace a ventas ──────────────────────────────────────────────────────
  f.venta_id                                          AS venta_id,
  f.tipo_orden                                        AS tipo_orden,
  f.creado_en                                         AS creado_en

FROM public.facturacion_sar f
ORDER BY f.fecha_emision DESC;

COMMENT ON VIEW public.reporte_facturas_sar
  IS 'Vista oficial SAR Honduras. '
     'Incluye bases imponibles, ISV al 15% y 18%, montos exentos y estado. '
     'Las columnas declarar_* devuelven 0 en facturas anuladas (correcto para declaración). '
     'Filtrar por fecha: WHERE fecha_emision BETWEEN ''2026-01-01'' AND ''2026-03-31''';


-- ─────────────────────────────────────────────────────────────
--  VISTA AUXILIAR: resumen_mensual_sar
--  Totales agrupados por mes para declaración mensual al SAR
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.resumen_mensual_sar AS
SELECT
  periodo,
  nombre_emisor,
  rtn_emisor,

  COUNT(*) FILTER (WHERE NOT es_anulada)          AS total_facturas_vigentes,
  COUNT(*) FILTER (WHERE es_anulada)              AS total_facturas_anuladas,
  COUNT(*)                                        AS total_facturas_emitidas,

  -- Montos a declarar (solo vigentes)
  SUM(declarar_exento)                            AS total_exento,
  SUM(declarar_base_15)                           AS total_base_gravable_15,
  SUM(declarar_base_18)                           AS total_base_gravable_18,
  SUM(declarar_isv_15)                            AS total_isv_15,
  SUM(declarar_isv_18)                            AS total_isv_18,
  SUM(declarar_isv_15 + declarar_isv_18)          AS total_isv,
  SUM(declarar_total)                             AS total_facturado,

  -- Desglose por método de pago
  SUM(CASE WHEN NOT es_anulada THEN pago_efectivo      ELSE 0 END) AS cobrado_efectivo,
  SUM(CASE WHEN NOT es_anulada THEN pago_tarjeta       ELSE 0 END) AS cobrado_tarjeta,
  SUM(CASE WHEN NOT es_anulada THEN pago_transferencia ELSE 0 END) AS cobrado_transferencia,
  SUM(CASE WHEN NOT es_anulada THEN pago_dolares_lps   ELSE 0 END) AS cobrado_dolares_lps

FROM public.reporte_facturas_sar
GROUP BY periodo, nombre_emisor, rtn_emisor
ORDER BY periodo DESC;

COMMENT ON VIEW public.resumen_mensual_sar
  IS 'Resumen mensual para declaración de ISV ante SAR Honduras. '
     'Los montos exentos, bases gravables e ISV ya excluyen facturas anuladas.';


-- =============================================================
-- ══════════════════════════════════════════════════════════════
--  BLOQUE 7: VERIFICACIÓN FINAL
-- ══════════════════════════════════════════════════════════════
-- =============================================================

-- Verificar columnas nuevas en cai_facturas
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'cai_facturas'
ORDER  BY ordinal_position;

-- Verificar tabla facturacion_sar
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'facturacion_sar'
ORDER  BY ordinal_position;

-- Verificar funciones creadas
SELECT routine_name, routine_type
FROM   information_schema.routines
WHERE  routine_schema = 'public'
  AND  routine_name   IN (
    'siguiente_numero_factura_sar',
    'validar_cai_vigente',
    'registrar_factura_sar',
    'anular_factura_sar',
    'trg_sync_facturacion_sar',
    'sar_set_actualizado_en'
  )
ORDER  BY routine_name;

-- Verificar vistas
SELECT table_name AS vista
FROM   information_schema.views
WHERE  table_schema = 'public'
  AND  table_name   IN ('reporte_facturas_sar', 'resumen_mensual_sar');

-- Verificar índices creados
SELECT indexname, tablename, indexdef
FROM   pg_indexes
WHERE  schemaname = 'public'
  AND  tablename  IN ('cai_facturas', 'ventas', 'facturacion_sar')
ORDER  BY tablename, indexname;
