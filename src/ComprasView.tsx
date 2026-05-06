import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { STORE, getAll, upsertOne, deleteById } from "./utils/localDB";

interface ComprasViewProps {
  onBack?: () => void;
}

interface Compra {
  id: number;
  fecha: string;
  proveedor: string;
  descripcion: string;
  monto: number;
  metodo_pago: string;
  notas: string;
  created_at?: string;
}

const METODOS = ["efectivo", "transferencia", "tarjeta", "cheque"];

const fmtLps = (n: number) =>
  "L. " +
  Number(n).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function ComprasView({ onBack }: ComprasViewProps) {
  const [lista, setLista] = useState<Compra[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [detalleItem, setDetalleItem] = useState<Compra | null>(null);
  const [editItem, setEditItem] = useState<Compra | null>(null);
  const [fechaDesde, setFechaDesde] = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [fechaHasta, setFechaHasta] = useState(() => {
    const hoy = new Date();
    return hoy.toISOString().slice(0, 10);
  });
  const [form, setForm] = useState<Omit<Compra, "id" | "created_at">>({
    fecha: new Date().toISOString().slice(0, 10),
    proveedor: "",
    descripcion: "",
    monto: 0,
    metodo_pago: "efectivo",
    notas: "",
  });

  useEffect(() => {
    cargar();
  }, [fechaDesde, fechaHasta]);

  async function cargar() {
    setLoading(true);
    try {
      const local = await getAll<Compra>(STORE.COMPRAS);
      const localFiltradas = local.filter((c) => {
        return c.fecha >= fechaDesde && c.fecha <= fechaHasta;
      });

      let merged: Compra[] = localFiltradas;

      if (navigator.onLine) {
        const { data, error } = await supabase
          .from("compras")
          .select("*")
          .gte("fecha", fechaDesde)
          .lte("fecha", fechaHasta)
          .order("fecha", { ascending: false });

        if (!error && data) {
          const remotas = data as Compra[];
          await Promise.all(remotas.map((item) => upsertOne(STORE.COMPRAS, item)));

          const byId = new Map<number, Compra>();
          remotas.forEach((item) => byId.set(Number(item.id), item));
          localFiltradas.forEach((item) => {
            if (!byId.has(Number(item.id))) byId.set(Number(item.id), item);
          });
          merged = Array.from(byId.values());
        }
      }

      merged.sort((a, b) => b.fecha.localeCompare(a.fecha));
      setLista(merged);
    } catch {
      setLista([]);
    } finally {
      setLoading(false);
    }
  }

  function abrirNuevo() {
    setEditItem(null);
    setForm({
      fecha: new Date().toISOString().slice(0, 10),
      proveedor: "",
      descripcion: "",
      monto: 0,
      metodo_pago: "efectivo",
      notas: "",
    });
    setShowModal(true);
  }

  function abrirEditar(item: Compra) {
    setEditItem(item);
    setForm({
      fecha: item.fecha,
      proveedor: item.proveedor,
      descripcion: item.descripcion,
      monto: item.monto,
      metodo_pago: item.metodo_pago,
      notas: item.notas,
    });
    setShowModal(true);
  }

  async function guardar() {
    if (!form.fecha || !form.descripcion || Number(form.monto) <= 0) {
      alert("Completa fecha, descripción y monto.");
      return;
    }
    setLoading(true);
    try {
      const isOnline = navigator.onLine;
      if (editItem) {
        const updated: Compra = {
          ...editItem,
          ...form,
          monto: Number(form.monto),
        };
        await upsertOne(STORE.COMPRAS, updated);
        if (isOnline) {
          await supabase
            .from("compras")
            .update({
              fecha: updated.fecha,
              proveedor: updated.proveedor,
              descripcion: updated.descripcion,
              monto: updated.monto,
              metodo_pago: updated.metodo_pago,
              notas: updated.notas,
            })
            .eq("id", updated.id);
        }
      } else {
        const tmpId = -Date.now();
        const nuevo: Compra = { id: tmpId, ...form, monto: Number(form.monto) };
        await upsertOne(STORE.COMPRAS, nuevo);
        if (isOnline) {
          const { data, error } = await supabase
            .from("compras")
            .insert([
              {
                fecha: nuevo.fecha,
                proveedor: nuevo.proveedor,
                descripcion: nuevo.descripcion,
                monto: nuevo.monto,
                metodo_pago: nuevo.metodo_pago,
                notas: nuevo.notas,
              },
            ])
            .select()
            .single();
          if (!error && data) {
            await deleteById(STORE.COMPRAS, tmpId);
            await upsertOne(STORE.COMPRAS, data);
          }
        }
      }
      setShowModal(false);
      await cargar();
    } catch (e) {
      console.error(e);
      alert("Error al guardar.");
    } finally {
      setLoading(false);
    }
  }

  async function eliminar(item: Compra) {
    if (!confirm(`¿Eliminar compra "${item.descripcion}"?`)) return;
    setLoading(true);
    try {
      await deleteById(STORE.COMPRAS, item.id);
      if (navigator.onLine && item.id > 0) {
        await supabase.from("compras").delete().eq("id", item.id);
      }
      await cargar();
    } catch {
      alert("Error al eliminar.");
    } finally {
      setLoading(false);
    }
  }

  const total = lista.reduce((s, c) => s + Number(c.monto), 0);

  return (
    <div
      className="compras-view"
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "16px",
        color: "#0f172a",
      }}
    >
      <style>{`
        .compras-view input,
        .compras-view select,
        .compras-view textarea {
          color: #0f172a !important;
          background: #fff;
        }
      `}</style>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
            }}
          >
            ←
          </button>
        )}
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
          📦 Registro de Compras
        </h2>
      </div>

      {/* Filtros + Nuevo */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 16,
          alignItems: "flex-end",
        }}
      >
        <div>
          <label style={{ fontSize: 12, color: "#64748b" }}>Desde</label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            style={{
              display: "block",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "6px 10px",
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: "#64748b" }}>Hasta</label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            style={{
              display: "block",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "6px 10px",
            }}
          />
        </div>
        <button
          onClick={abrirNuevo}
          style={{
            padding: "8px 20px",
            background: "#2563eb",
            color: "#0f172a",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          + Nueva Compra
        </button>
      </div>

      {/* Total */}
      <div
        style={{
          background: "#f0fdf4",
          border: "1px solid #bbf7d0",
          borderRadius: 10,
          padding: "10px 16px",
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600, color: "#166534" }}>
          Total del período
        </span>
        <span style={{ fontWeight: 800, fontSize: 18, color: "#166534" }}>
          {fmtLps(total)}
        </span>
      </div>

      {/* Lista */}
      {loading ? (
        <p style={{ textAlign: "center", color: "#64748b" }}>Cargando...</p>
      ) : lista.length === 0 ? (
        <p style={{ textAlign: "center", color: "#94a3b8" }}>
          Sin compras en este período.
        </p>
      ) : (
        <div
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 12,
            background: "#fff",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "90px 120px minmax(0,1fr) 90px 100px 210px",
              gap: 0,
              background: "#f8fafc",
              borderBottom: "1px solid #cbd5e1",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "#475569",
            }}
          >
            <div style={{ padding: "10px 12px" }}>Fecha</div>
            <div style={{ padding: "10px 12px" }}>Proveedor</div>
            <div style={{ padding: "10px 12px" }}>Descripción / Notas</div>
            <div style={{ padding: "10px 12px" }}>Método</div>
            <div style={{ padding: "10px 12px", textAlign: "right" }}>Monto</div>
            <div style={{ padding: "10px 12px", textAlign: "center" }}>
              Acciones
            </div>
          </div>
          {lista.map((c) => (
            <div
              key={c.id}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "90px 120px minmax(0,1fr) 90px 100px 210px",
                borderBottom: "1px solid #e2e8f0",
                alignItems: "center",
                fontSize: 13,
                color: "#0f172a",
                background: "#fff",
              }}
            >
              <div
                style={{
                  padding: "10px 8px",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={c.fecha}
              >
                {c.fecha}
              </div>
              <div
                style={{
                  padding: "10px 8px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={c.proveedor || "—"}
              >
                {c.proveedor || "—"}
              </div>
              <div style={{ padding: "10px 8px", minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={c.descripcion}
                >
                  {c.descripcion}
                </div>
                {c.notas ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#64748b",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={c.notas}
                  >
                    {c.notas}
                  </div>
                ) : null}
              </div>
              <div
                style={{
                  padding: "10px 8px",
                  textTransform: "capitalize",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {c.metodo_pago}
              </div>
              <div
                style={{
                  padding: "10px 8px",
                  textAlign: "right",
                  fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmtLps(c.monto)}
              </div>
              <div
                style={{
                  padding: "8px",
                  display: "flex",
                  justifyContent: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => setDetalleItem(c)}
                  style={{
                    padding: "4px 8px",
                    background: "#eef2ff",
                    border: "1px solid #c7d2fe",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#3730a3",
                  }}
                >
                  Ver detalles
                </button>
                <button
                  onClick={() => abrirEditar(c)}
                  style={{
                    padding: "4px 8px",
                    background: "#f1f5f9",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Editar
                </button>
                <button
                  onClick={() => eliminar(c)}
                  style={{
                    padding: "4px 8px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    color: "#dc2626",
                    fontWeight: 700,
                  }}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {detalleItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: 16,
          }}
          onClick={() => setDetalleItem(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#fff",
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                background: "#f8fafc",
                borderBottom: "1px solid #e2e8f0",
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              Detalle de compra
            </div>
            <div style={{ padding: 16, display: "grid", gap: 10, fontSize: 14 }}>
              <div><strong>Fecha:</strong> {detalleItem.fecha}</div>
              <div><strong>Proveedor:</strong> {detalleItem.proveedor || "—"}</div>
              <div><strong>Descripción:</strong> {detalleItem.descripcion}</div>
              <div><strong>Método:</strong> {detalleItem.metodo_pago}</div>
              <div><strong>Monto:</strong> {fmtLps(detalleItem.monto)}</div>
              <div><strong>Notas:</strong> {detalleItem.notas || "—"}</div>
            </div>
            <div
              style={{
                padding: "12px 16px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => setDetalleItem(null)}
                style={{
                  padding: "8px 14px",
                  background: "#e2e8f0",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 24,
              width: "100%",
              maxWidth: 460,
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>
              {editItem ? "Editar Compra" : "Nueva Compra"}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ fontSize: 13 }}>
                Fecha
                <input
                  type="date"
                  value={form.fecha}
                  onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Proveedor
                <input
                  type="text"
                  value={form.proveedor}
                  onChange={(e) =>
                    setForm({ ...form, proveedor: e.target.value })
                  }
                  placeholder="Nombre del proveedor"
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Descripción *
                <input
                  type="text"
                  value={form.descripcion}
                  onChange={(e) =>
                    setForm({ ...form, descripcion: e.target.value })
                  }
                  placeholder="Qué se compró"
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Monto (L.) *
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monto}
                  onChange={(e) =>
                    setForm({ ...form, monto: parseFloat(e.target.value) || 0 })
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                Método de pago
                <select
                  value={form.metodo_pago}
                  onChange={(e) =>
                    setForm({ ...form, metodo_pago: e.target.value })
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                >
                  {METODOS.map((m) => (
                    <option key={m} value={m}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                Notas
                <input
                  type="text"
                  value={form.notas}
                  onChange={(e) => setForm({ ...form, notas: e.target.value })}
                  placeholder="Opcional"
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  flex: 1,
                  padding: "10px",
                  background: "#f1f5f9",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "10px",
                  background: "#2563eb",
                  color: "#0f172a",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {loading ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
