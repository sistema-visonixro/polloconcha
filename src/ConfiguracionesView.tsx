import { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "./supabaseClient";
import { STORE, deleteById, getAll, upsertOne } from "./utils/localDB";
import {
  DEFAULT_POS_CONFIG,
  obtenerPosConfig,
  obtenerPiezasOpciones,
  type OpcionSimple,
  type PosConfig,
  type TipoVentaConfig,
} from "./services/posConfigService";

export default function ConfiguracionesView({
  onBack,
}: {
  onBack: () => void;
}) {
  const [config, setConfig] = useState<PosConfig>(DEFAULT_POS_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showPiezasModal, setShowPiezasModal] = useState(false);
  const [showComplementosModal, setShowComplementosModal] = useState(false);
  const [showDescuentoModal, setShowDescuentoModal] = useState(false);

  const [piezas, setPiezas] = useState<OpcionSimple[]>([]);
  const [nuevaPieza, setNuevaPieza] = useState("");

  const [complementos, setComplementos] = useState<
    { id: number; nombre: string; orden: number }[]
  >([]);
  const [nuevoComplemento, setNuevoComplemento] = useState("");

  const [descuentoId, setDescuentoId] = useState<any>(null);
  const [descuentoMonto, setDescuentoMonto] = useState<number>(20);

  useEffect(() => {
    (async () => {
      const cfg = await obtenerPosConfig();
      setConfig(cfg);
      setLoading(false);
    })();
  }, []);

  const guardarConfig = async (next: PosConfig) => {
    setConfig(next);
    setSaving(true);
    await upsertOne(STORE.POS_CONFIG, next);
    try {
      const { data } = await supabase
        .from("configuraciones_pos")
        .upsert(next, { onConflict: "id" })
        .select("*")
        .maybeSingle();
      if (data) {
        setConfig(data as PosConfig);
        await upsertOne(STORE.POS_CONFIG, data);
      }
    } catch {
      // backup best-effort
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof PosConfig) => {
    if (key === "tipo_venta" || key === "id") return;
    const next = { ...config, [key]: !(config as any)[key] } as PosConfig;
    guardarConfig(next);
  };

  const setTipoVenta = (tipo: TipoVentaConfig) => {
    guardarConfig({ ...config, tipo_venta: tipo });
  };

  const cargarPiezas = async () => {
    const data = await obtenerPiezasOpciones();
    setPiezas(data);
  };

  const cargarComplementos = async () => {
    const local = await getAll<any>(STORE.COMPLEMENTOS);
    if (local.length > 0) {
      setComplementos(local.sort((a, b) => (a.orden || 0) - (b.orden || 0)));
      return;
    }

    try {
      const { data } = await supabase
        .from("complementos_opciones")
        .select("id, nombre, orden")
        .order("orden", { ascending: true });
      setComplementos(data || []);
      for (const row of data || []) {
        await upsertOne(STORE.COMPLEMENTOS, row);
      }
    } catch {
      setComplementos([]);
    }
  };

  const cargarDescuento = async () => {
    const local = await getAll<any>(STORE.DESCUENTOS_CONFIG);
    if (local.length > 0) {
      const row =
        local.find((r: any) => r.tipo_producto === "comida") || local[0];
      setDescuentoId(row?.id ?? null);
      setDescuentoMonto(Number(row?.monto_descuento || 20));
      return;
    }

    try {
      const { data } = await supabase
        .from("descuentos_config")
        .select("*")
        .eq("tipo_producto", "comida")
        .limit(1)
        .maybeSingle();
      if (data) {
        setDescuentoId(data.id);
        setDescuentoMonto(Number(data.monto_descuento || 20));
        await upsertOne(STORE.DESCUENTOS_CONFIG, data);
      }
    } catch {
      // ignore
    }
  };

  const agregarPieza = async () => {
    const nombre = nuevaPieza.trim().toUpperCase();
    if (!nombre) return;

    const orden =
      piezas.length > 0 ? Math.max(...piezas.map((p) => p.orden)) + 1 : 1;
    try {
      const { data } = await supabase
        .from("piezas_opciones")
        .insert({ nombre, orden })
        .select("id, nombre, orden")
        .maybeSingle();

      if (data) {
        await upsertOne(STORE.PIEZAS_OPCIONES, data);
      } else {
        await upsertOne(STORE.PIEZAS_OPCIONES, {
          id: -Date.now(),
          nombre,
          orden,
        });
      }
    } catch {
      await upsertOne(STORE.PIEZAS_OPCIONES, {
        id: -Date.now(),
        nombre,
        orden,
      });
    }

    setNuevaPieza("");
    await cargarPiezas();
  };

  const eliminarPieza = async (id: number) => {
    if (!window.confirm("¿Eliminar esta pieza?")) return;
    await deleteById(STORE.PIEZAS_OPCIONES, id);
    if (id > 0) {
      try {
        await supabase.from("piezas_opciones").delete().eq("id", id);
      } catch {
        // ignore
      }
    }
    await cargarPiezas();
  };

  const agregarComplemento = async () => {
    const nombre = nuevoComplemento.trim().toUpperCase();
    if (!nombre) return;
    const orden =
      complementos.length > 0
        ? Math.max(...complementos.map((c) => c.orden || 0)) + 1
        : 1;

    try {
      const { data } = await supabase
        .from("complementos_opciones")
        .insert({ nombre, orden })
        .select("id, nombre, orden")
        .maybeSingle();
      if (data) {
        await upsertOne(STORE.COMPLEMENTOS, data);
      } else {
        await upsertOne(STORE.COMPLEMENTOS, { id: -Date.now(), nombre, orden });
      }
    } catch {
      await upsertOne(STORE.COMPLEMENTOS, { id: -Date.now(), nombre, orden });
    }

    setNuevoComplemento("");
    await cargarComplementos();
  };

  const eliminarComplemento = async (id: number) => {
    if (!window.confirm("¿Eliminar este complemento?")) return;
    await deleteById(STORE.COMPLEMENTOS, id);
    if (id > 0) {
      try {
        await supabase.from("complementos_opciones").delete().eq("id", id);
      } catch {
        // ignore
      }
    }
    await cargarComplementos();
  };

  const guardarDescuento = async () => {
    const monto = Number(descuentoMonto);
    if (!Number.isFinite(monto) || monto < 0) return;

    const payload = {
      id: descuentoId,
      tipo_producto: "comida",
      monto_descuento: monto,
      activo: true,
      descripcion: "Descuento configurable desde panel de configuraciones",
    } as any;

    try {
      const { data } = await supabase
        .from("descuentos_config")
        .upsert(payload)
        .select("*")
        .maybeSingle();

      if (data) {
        setDescuentoId(data.id);
        await upsertOne(STORE.DESCUENTOS_CONFIG, data);
      }
    } catch {
      if (!payload.id) payload.id = `local-${Date.now()}`;
      await upsertOne(STORE.DESCUENTOS_CONFIG, payload);
    }

    setShowDescuentoModal(false);
  };

  const openModalPiezas = async () => {
    await cargarPiezas();
    setShowPiezasModal(true);
  };

  const openModalComplementos = async () => {
    await cargarComplementos();
    setShowComplementosModal(true);
  };

  const openModalDescuento = async () => {
    await cargarDescuento();
    setShowDescuentoModal(true);
  };

  const cardStyle: CSSProperties = {
    background: "#fff",
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
    boxShadow: "0 2px 10px rgba(15,23,42,0.04)",
  };

  const overlayStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5000,
    padding: 12,
  };

  const modalStyle: CSSProperties = {
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: 16,
    width: "100%",
    maxWidth: 520,
    maxHeight: "88vh",
    border: "1px solid #e2e8f0",
    boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const modalHeaderStyle: CSSProperties = {
    padding: "14px 16px",
    borderBottom: "1px solid #e2e8f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: "#f8fafc",
    color: "#0f172a",
  };

  const modalBodyStyle: CSSProperties = {
    padding: 16,
    overflowY: "auto",
    maxHeight: "calc(88vh - 68px)",
    color: "#0f172a",
  };

  const scrollListStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: "45vh",
    overflowY: "auto",
    paddingRight: 4,
    marginBottom: 12,
  };

  const switchButtonStyle = (enabled: boolean): CSSProperties => ({
    width: 52,
    height: 30,
    borderRadius: 999,
    border: "none",
    background: enabled ? "#0ea5e9" : "#cbd5e1",
    position: "relative",
    cursor: "pointer",
    transition: "background 0.18s ease",
    flexShrink: 0,
  });

  const switchThumbStyle = (enabled: boolean): CSSProperties => ({
    position: "absolute",
    top: 3,
    left: enabled ? 25 : 3,
    width: 24,
    height: 24,
    borderRadius: "50%",
    background: "#fff",
    boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
    transition: "left 0.18s ease",
  });

  const Switch = ({
    checked,
    onChange,
    label,
  }: {
    checked: boolean;
    onChange: () => void;
    label: string;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      style={switchButtonStyle(checked)}
    >
      <span style={switchThumbStyle(checked)} />
    </button>
  );

  if (loading) {
    return <div style={{ padding: 24 }}>Cargando configuraciones...</div>;
  }

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <h2 style={{ margin: 0 }}>⚙️ Configuraciones</h2>
        <button
          onClick={onBack}
          style={{
            border: "none",
            background: "#e2e8f0",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          ← Volver
        </button>
      </div>

      <div style={cardStyle}>
        <div>
          <strong>Crédito</strong>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Muestra/oculta "Facturar a Crédito" y "Facturas Crédito" en menú POS
          </div>
        </div>
        <Switch
          checked={config.credito_habilitado}
          onChange={() => toggle("credito_habilitado")}
          label="Crédito"
        />
      </div>

      <div style={cardStyle}>
        <div>
          <strong>Piezas</strong>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Muestra/oculta botón de piezas en filas de Pedido Actual
          </div>
        </div>
        <Switch
          checked={config.piezas_habilitado}
          onChange={() => toggle("piezas_habilitado")}
          label="Piezas"
        />
      </div>

      <div style={cardStyle}>
        <div>
          <strong>Complementos incluidos</strong>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Muestra/oculta botón de complementos en filas de Pedido Actual
          </div>
        </div>
        <Switch
          checked={config.complementos_habilitado}
          onChange={() => toggle("complementos_habilitado")}
          label="Complementos incluidos"
        />
      </div>

      <div style={cardStyle}>
        <div>
          <strong>Descuento</strong>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Muestra/oculta botón de descuento en filas de Pedido Actual
          </div>
        </div>
        <Switch
          checked={config.descuento_habilitado}
          onChange={() => toggle("descuento_habilitado")}
          label="Descuento"
        />
      </div>

      <div style={cardStyle}>
        <div>
          <strong>Menú bloqueado</strong>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Exige clave de admin para abrir menú en POS
          </div>
        </div>
        <Switch
          checked={config.menu_bloqueado}
          onChange={() => toggle("menu_bloqueado")}
          label="Menú bloqueado"
        />
      </div>

      <div style={cardStyle}>
        <div>
          <strong>Tipo de venta</strong>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Ambos, solo recibo o solo factura
          </div>
        </div>
        <select
          value={config.tipo_venta}
          onChange={(e) => setTipoVenta(e.target.value as TipoVentaConfig)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#0f172a",
            fontWeight: 600,
          }}
        >
          <option value="ambos">Ambos</option>
          <option value="solo_recibo">Solo recibo</option>
          <option value="solo_factura">Solo factura</option>
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button
          onClick={openModalPiezas}
          style={{
            border: "none",
            background: "#f59e0b",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          🍖 Piezas
        </button>
        <button
          onClick={openModalComplementos}
          style={{
            border: "none",
            background: "#16a34a",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          🍗 Complementos incluidos
        </button>
        <button
          onClick={openModalDescuento}
          style={{
            border: "none",
            background: "#0ea5e9",
            color: "#fff",
            borderRadius: 8,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          % Descuento
        </button>
      </div>

      {saving && (
        <div style={{ marginTop: 10, color: "#0f766e", fontSize: 13 }}>
          Guardando configuración...
        </div>
      )}

      {showPiezasModal && (
        <div style={overlayStyle} onClick={() => setShowPiezasModal(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>
                🍖 Lista de Piezas
              </h3>
              <button
                onClick={() => setShowPiezasModal(false)}
                style={{
                  border: "none",
                  background: "#e2e8f0",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  color: "#0f172a",
                }}
              >
                Cerrar
              </button>
            </div>

            <div style={modalBodyStyle}>
              <div style={scrollListStyle}>
                {piezas.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "10px 12px",
                      gap: 10,
                      background: "#fff",
                    }}
                  >
                    <span
                      style={{
                        color: "#0f172a",
                        fontWeight: 600,
                        wordBreak: "break-word",
                      }}
                    >
                      {p.nombre}
                    </span>
                    <button
                      onClick={() => eliminarPieza(p.id)}
                      style={{
                        border: "none",
                        background: "#ef4444",
                        color: "#fff",
                        borderRadius: 8,
                        padding: "7px 10px",
                        cursor: "pointer",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={nuevaPieza}
                  onChange={(e) => setNuevaPieza(e.target.value)}
                  placeholder="Nueva pieza"
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    color: "#0f172a",
                    background: "#fff",
                  }}
                />
                <button
                  onClick={agregarPieza}
                  style={{
                    border: "none",
                    background: "#f59e0b",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  Agregar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showComplementosModal && (
        <div
          style={overlayStyle}
          onClick={() => setShowComplementosModal(false)}
        >
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>
                🍗 Complementos incluidos
              </h3>
              <button
                onClick={() => setShowComplementosModal(false)}
                style={{
                  border: "none",
                  background: "#e2e8f0",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  color: "#0f172a",
                }}
              >
                Cerrar
              </button>
            </div>

            <div style={modalBodyStyle}>
              <div style={scrollListStyle}>
                {complementos.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      border: "1px solid #e2e8f0",
                      borderRadius: 10,
                      padding: "10px 12px",
                      gap: 10,
                      background: "#fff",
                    }}
                  >
                    <span
                      style={{
                        color: "#0f172a",
                        fontWeight: 600,
                        wordBreak: "break-word",
                      }}
                    >
                      {c.nombre}
                    </span>
                    <button
                      onClick={() => eliminarComplemento(c.id)}
                      style={{
                        border: "none",
                        background: "#ef4444",
                        color: "#fff",
                        borderRadius: 8,
                        padding: "7px 10px",
                        cursor: "pointer",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={nuevoComplemento}
                  onChange={(e) => setNuevoComplemento(e.target.value)}
                  placeholder="Nuevo complemento"
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    color: "#0f172a",
                    background: "#fff",
                  }}
                />
                <button
                  onClick={agregarComplemento}
                  style={{
                    border: "none",
                    background: "#16a34a",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  Agregar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDescuentoModal && (
        <div style={overlayStyle} onClick={() => setShowDescuentoModal(false)}>
          <div
            style={{ ...modalStyle, maxWidth: 460 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={modalHeaderStyle}>
              <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>
                % Configurar Descuento
              </h3>
              <button
                onClick={() => setShowDescuentoModal(false)}
                style={{
                  border: "none",
                  background: "#e2e8f0",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  color: "#0f172a",
                }}
              >
                Cerrar
              </button>
            </div>

            <div style={modalBodyStyle}>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  color: "#475569",
                  marginBottom: 8,
                }}
              >
                Monto descuento comida (L)
              </label>
              <input
                type="number"
                value={descuentoMonto}
                onChange={(e) => setDescuentoMonto(Number(e.target.value || 0))}
                step="0.01"
                min="0"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #cbd5e1",
                  color: "#0f172a",
                  background: "#fff",
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 14,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => setShowDescuentoModal(false)}
                  style={{
                    border: "none",
                    background: "#e2e8f0",
                    borderRadius: 10,
                    padding: "9px 13px",
                    cursor: "pointer",
                    color: "#0f172a",
                    fontWeight: 700,
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={guardarDescuento}
                  style={{
                    border: "none",
                    background: "#0ea5e9",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "9px 13px",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
