-- ============================================================
-- TABLAS DE RESPALDO PARA CONFIGURACIONES POS (Supabase)
-- Fuente primaria del sistema: IndexedDB (offline-first)
-- Supabase: respaldo y descarga inicial al iniciar/recargar app
-- ============================================================

-- 1) Configuración global del POS (fila única id=1)
CREATE TABLE IF NOT EXISTS configuraciones_pos (
  id                      INTEGER PRIMARY KEY,
  credito_habilitado      BOOLEAN NOT NULL DEFAULT TRUE,
  piezas_habilitado       BOOLEAN NOT NULL DEFAULT TRUE,
  complementos_habilitado BOOLEAN NOT NULL DEFAULT TRUE,
  descuento_habilitado    BOOLEAN NOT NULL DEFAULT TRUE,
  menu_bloqueado          BOOLEAN NOT NULL DEFAULT FALSE,
  tipo_venta              TEXT NOT NULL DEFAULT 'ambos',
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_config_pos_singleton CHECK (id = 1),
  CONSTRAINT chk_config_tipo_venta CHECK (tipo_venta IN ('ambos', 'solo_recibo', 'solo_factura'))
);

INSERT INTO configuraciones_pos (
  id,
  credito_habilitado,
  piezas_habilitado,
  complementos_habilitado,
  descuento_habilitado,
  menu_bloqueado,
  tipo_venta
)
VALUES (1, TRUE, TRUE, TRUE, TRUE, FALSE, 'ambos')
ON CONFLICT (id) DO NOTHING;

-- 2) Catálogo de piezas (respaldo para modal de piezas)
CREATE TABLE IF NOT EXISTS piezas_opciones (
  id         BIGSERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL UNIQUE,
  orden      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO piezas_opciones (nombre, orden) VALUES
  ('PIEZAS VARIAS', 1),
  ('PECHUGA', 2),
  ('ALA', 3),
  ('CADERA', 4),
  ('PIERNA', 5)
ON CONFLICT (nombre) DO NOTHING;

-- ============================================================
-- RLS público (mismo enfoque de tablas existentes del proyecto)
-- ============================================================
ALTER TABLE configuraciones_pos ENABLE ROW LEVEL SECURITY;
ALTER TABLE piezas_opciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acceso_publico_configuraciones_pos"
  ON configuraciones_pos FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "acceso_publico_piezas_opciones"
  ON piezas_opciones FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);
