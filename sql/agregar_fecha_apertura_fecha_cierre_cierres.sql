-- ================================================================
--  MIGRACIÓN: Agregar fecha_apertura y fecha_cierre a tabla cierres
--  
--  Problema anterior:
--    La columna "fecha" se usaba tanto para la apertura como para el
--    cierre. Al registrar el cierre se sobreescribía "fecha", perdiendo
--    la fecha y hora original de la apertura.
--
--  Solución:
--    - fecha_apertura: se rellena al crear la apertura, NUNCA se modifica.
--    - fecha_cierre  : se rellena al registrar el cierre.
--    - fecha         : se mantiene por compatibilidad con código anterior.
--
--  EJECUTAR EN: Supabase SQL Editor
-- ================================================================

-- 1. Agregar columnas nuevas (si no existen)
ALTER TABLE public.cierres
  ADD COLUMN IF NOT EXISTS fecha_apertura TIMESTAMP WITHOUT TIME ZONE NULL,
  ADD COLUMN IF NOT EXISTS fecha_cierre   TIMESTAMP WITHOUT TIME ZONE NULL;

-- 2. Rellenar fecha_apertura en registros existentes tipo apertura
--    (se usa "fecha" como valor histórico, mejor que nada)
UPDATE public.cierres
SET fecha_apertura = fecha
WHERE fecha_apertura IS NULL
  AND (tipo_registro = 'apertura' OR estado = 'APERTURA' OR estado = 'CIERRE')
  AND fecha IS NOT NULL;

-- 3. Rellenar fecha_cierre en registros ya cerrados
UPDATE public.cierres
SET fecha_cierre = fecha
WHERE fecha_cierre IS NULL
  AND (tipo_registro = 'cierre' OR estado = 'CIERRE')
  AND fecha IS NOT NULL;

-- 4. Índice para consultas por rango de apertura
CREATE INDEX IF NOT EXISTS idx_cierres_fecha_apertura
  ON public.cierres (cajero_id, fecha_apertura DESC);

-- 5. Verificar resultado
SELECT
  id,
  cajero,
  caja,
  estado,
  tipo_registro,
  fecha           AS fecha_original,
  fecha_apertura,
  fecha_cierre
FROM public.cierres
ORDER BY id DESC
LIMIT 30;
