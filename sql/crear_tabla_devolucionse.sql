-- Crear tabla de devoluciones
CREATE TABLE IF NOT EXISTS devolucionse (
  id BIGSERIAL PRIMARY KEY,
  factura_id BIGINT NOT NULL,
  numero_factura TEXT NOT NULL,
  monto DECIMAL(12, 2) NOT NULL,
  motivo TEXT DEFAULT '',
  tipo VARCHAR(20) DEFAULT 'PARCIAL', -- TOTAL o PARCIAL
  fecha_hora TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  usuario TEXT DEFAULT '',
  estado VARCHAR(20) DEFAULT 'PENDIENTE', -- PENDIENTE, APROBADO, RECHAZADO
  notas TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT devolucionse_factura_fkey FOREIGN KEY (factura_id) REFERENCES ventas(id) ON DELETE CASCADE
);

-- Crear índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_devolucionse_factura_id ON devolucionse(factura_id);
CREATE INDEX IF NOT EXISTS idx_devolucionse_fecha_hora ON devolucionse(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_devolucionse_usuario ON devolucionse(usuario);

-- Habilitar RLS
ALTER TABLE devolucionse ENABLE ROW LEVEL SECURITY;

-- Crear políticas RLS para acceso público
CREATE POLICY devolucionse_select_public ON devolucionse
  FOR SELECT
  USING (true);

CREATE POLICY devolucionse_insert_public ON devolucionse
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY devolucionse_update_public ON devolucionse
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY devolucionse_delete_public ON devolucionse
  FOR DELETE
  USING (true);

-- Crear tabla para auditoría de cambios en facturas (ediciones/eliminaciones)
CREATE TABLE IF NOT EXISTS auditoria_facturas (
  id BIGSERIAL PRIMARY KEY,
  factura_id BIGINT NOT NULL,
  numero_factura TEXT NOT NULL,
  tipo_cambio VARCHAR(50) NOT NULL, -- EDICION, ELIMINACION, DEVOLUCIO
  cambios_anteriores JSONB,
  cambios_nuevos JSONB,
  usuario TEXT DEFAULT '',
  fecha_hora TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT auditoria_facturas_factura_fkey FOREIGN KEY (factura_id) REFERENCES ventas(id) ON DELETE CASCADE
);

-- Crear índices para auditoría
CREATE INDEX IF NOT EXISTS idx_auditoria_facturas_factura_id ON auditoria_facturas(factura_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_facturas_fecha_hora ON auditoria_facturas(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_auditoria_facturas_tipo_cambio ON auditoria_facturas(tipo_cambio);

-- Habilitar RLS en auditoría
ALTER TABLE auditoria_facturas ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para auditoría
CREATE POLICY auditoria_facturas_select_public ON auditoria_facturas
  FOR SELECT
  USING (true);

CREATE POLICY auditoria_facturas_insert_public ON auditoria_facturas
  FOR INSERT
  WITH CHECK (true);
