-- ============================================================
-- CONFIGURACIÓN DE RLS PARA TABLA CIERRES
-- Permitir operaciones públicas (INSERT, UPDATE, SELECT) para sincronización offline-first
-- ============================================================

-- Habilitar RLS en tabla cierres
ALTER TABLE public.cierres ENABLE ROW LEVEL SECURITY;

-- POLÍTICA 1: Permitir SELECT a usuarios públicos (lectura de aperturas/cierres)
CREATE POLICY "cierres_select_public" ON public.cierres
  FOR SELECT
  TO public
  USING (true);

-- POLÍTICA 2: Permitir INSERT a usuarios públicos (crear aperturas desde app)
CREATE POLICY "cierres_insert_public" ON public.cierres
  FOR INSERT
  TO public
  WITH CHECK (true);

-- POLÍTICA 3: Permitir UPDATE a usuarios públicos (cambiar tipo_registro o actualizar valores)
CREATE POLICY "cierres_update_public" ON public.cierres
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

-- POLÍTICA 4: Permitir DELETE a usuarios públicos (si es necesario, Ej: limpieza de datos)
CREATE POLICY "cierres_delete_public" ON public.cierres
  FOR DELETE
  TO public
  USING (true);
