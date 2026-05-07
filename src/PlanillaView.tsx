import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { STORE, getAll, upsertOne, deleteById } from "./utils/localDB";

interface PlanillaViewProps {
  onBack?: () => void;
}

interface PagoPlanilla {
  id: number;
  fecha_pago: string;
  empleado: string;
  cargo: string;
  periodo: string; // QUINCENAL | MENSUAL
  monto: number;
  notas: string;
  created_at?: string;
}

const PERIODOS = ["QUINCENAL", "MENSUAL", "SEMANAL", "OTRO"];

const fmtLps = (n: number) =>
  "L. " +
  Number(n).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function PlanillaView({ onBack }: PlanillaViewProps) {
  const [lista, setLista] = useState<PagoPlanilla[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [detalleItem, setDetalleItem] = useState<PagoPlanilla | null>(null);
  const [editItem, setEditItem] = useState<PagoPlanilla | null>(null);
  const [fechaDesde, setFechaDesde] = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [fechaHasta, setFechaHasta] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [form, setForm] = useState<Omit<PagoPlanilla, "id" | "created_at">>({
    fecha_pago: new Date().toISOString().slice(0, 10),
    empleado: "",
    cargo: "",
    periodo: "QUINCENAL",
    monto: 0,
    notas: "",
  });

  useEffect(() => {
    cargar();
  }, [fechaDesde, fechaHasta]);

  async function cargar() {
    setLoading(true);
    try {
      const local = await getAll<PagoPlanilla>(STORE.PLANILLA);
      const localFiltrados = local.filter(
        (p) => p.fecha_pago >= fechaDesde && p.fecha_pago <= fechaHasta,
      );

      let merged: PagoPlanilla[] = localFiltrados;

      if (navigator.onLine) {
        const { data, error } = await supabase
          .from("planilla")
          .select("*")
          .gte("fecha_pago", fechaDesde)
          .lte("fecha_pago", fechaHasta)
          .order("fecha_pago", { ascending: false });

        if (!error && data) {
          const remotos = data as PagoPlanilla[];
          await Promise.all(
            remotos.map((item) => upsertOne(STORE.PLANILLA, item)),
          );

          const byId = new Map<number, PagoPlanilla>();
          remotos.forEach((item) => byId.set(Number(item.id), item));
          localFiltrados.forEach((item) => {
            if (!byId.has(Number(item.id))) byId.set(Number(item.id), item);
          });
          merged = Array.from(byId.values());
        }
      }

      merged.sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago));
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
      fecha_pago: new Date().toISOString().slice(0, 10),
      empleado: "",
      cargo: "",
      periodo: "QUINCENAL",
      monto: 0,
      notas: "",
    });
    setShowModal(true);
  }

  function abrirEditar(item: PagoPlanilla) {
    setEditItem(item);
    setForm({
      fecha_pago: item.fecha_pago,
      empleado: item.empleado,
      cargo: item.cargo,
      periodo: item.periodo,
      monto: item.monto,
      notas: item.notas,
    });
    setShowModal(true);
  }

  async function guardar() {
    if (!form.fecha_pago || !form.empleado || Number(form.monto) <= 0) {
      alert("Completa fecha, empleado y monto.");
      return;
    }
    setLoading(true);
    try {
      const isOnline = navigator.onLine;
      if (editItem) {
        const updated: PagoPlanilla = {
          ...editItem,
          ...form,
          monto: Number(form.monto),
        };
        await upsertOne(STORE.PLANILLA, updated);
        if (isOnline) {
          await supabase
            .from("planilla")
            .update({
              fecha_pago: updated.fecha_pago,
              empleado: updated.empleado,
              cargo: updated.cargo,
              periodo: updated.periodo,
              monto: updated.monto,
              notas: updated.notas,
            })
            .eq("id", updated.id);
        }
      } else {
        const tmpId = -Date.now();
        const nuevo: PagoPlanilla = {
          id: tmpId,
          ...form,
          monto: Number(form.monto),
        };
        await upsertOne(STORE.PLANILLA, nuevo);
        if (isOnline) {
          const { data, error } = await supabase
            .from("planilla")
            .insert([
              {
                fecha_pago: nuevo.fecha_pago,
                empleado: nuevo.empleado,
                cargo: nuevo.cargo,
                periodo: nuevo.periodo,
                monto: nuevo.monto,
                notas: nuevo.notas,
              },
            ])
            .select()
            .single();
          if (!error && data) {
            await deleteById(STORE.PLANILLA, tmpId);
            await upsertOne(STORE.PLANILLA, data);
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

  async function eliminar(item: PagoPlanilla) {
    if (!confirm(`¿Eliminar pago de planilla para "${item.empleado}"?`)) return;
    setLoading(true);
    try {
      await deleteById(STORE.PLANILLA, item.id);
      if (navigator.onLine && item.id > 0)
        await supabase.from("planilla").delete().eq("id", item.id);
      await cargar();
    } catch {
      alert("Error al eliminar.");
    } finally {
      setLoading(false);
    }
  }

  const total = lista.reduce((s, p) => s + Number(p.monto), 0);

  // Agrupar por empleado para resumen
  const porEmpleado: Record<string, number> = {};
  lista.forEach((p) => {
    porEmpleado[p.empleado] = (porEmpleado[p.empleado] || 0) + Number(p.monto);
  });

  return (
    <div
      className="planilla-view"
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "16px",
        color: "#0f172a",
      }}
    >
      <style>{`
        .planilla-view input,
        .planilla-view select,
        .planilla-view textarea {
          color: #0f172a !important;
          background: #fff;
        }
      `}</style>
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
          👥 Planilla
        </h2>
      </div>

      {/* Filtros */}
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
            background: "#7c3aed",
            color: "#0f172a",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          + Nuevo Pago
        </button>
      </div>

      {/* Total */}
      <div
        style={{
          background: "#faf5ff",
          border: "1px solid #e9d5ff",
          borderRadius: 10,
          padding: "10px 16px",
          marginBottom: 12,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600, color: "#6b21a8" }}>
          Total pagado en el período
        </span>
        <span style={{ fontWeight: 800, fontSize: 18, color: "#6b21a8" }}>
          {fmtLps(total)}
        </span>
      </div>

      {/* Resumen por empleado */}
      {Object.keys(porEmpleado).length > 1 && (
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "10px 16px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontWeight: 600,
              fontSize: 13,
              marginBottom: 6,
              color: "#475569",
            }}
          >
            Resumen por empleado
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(porEmpleado).map(([emp, mto]) => (
              <div
                key={emp}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "4px 12px",
                  fontSize: 13,
                }}
              >
                <strong>{emp}</strong>: {fmtLps(mto)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <p style={{ textAlign: "center", color: "#64748b" }}>Cargando...</p>
      ) : lista.length === 0 ? (
        <p style={{ textAlign: "center", color: "#94a3b8" }}>
          Sin pagos de planilla en este período.
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
              gridTemplateColumns: "90px 150px minmax(0,1fr) 90px 100px 210px",
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
            <div style={{ padding: "10px 12px" }}>Empleado</div>
            <div style={{ padding: "10px 12px" }}>Cargo / Notas</div>
            <div style={{ padding: "10px 12px" }}>Período</div>
            <div style={{ padding: "10px 12px", textAlign: "right" }}>
              Monto
            </div>
            <div style={{ padding: "10px 12px", textAlign: "center" }}>
              Acciones
            </div>
          </div>
          {lista.map((p) => (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns:
                  "90px 150px minmax(0,1fr) 90px 100px 210px",
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
                title={p.fecha_pago}
              >
                {p.fecha_pago}
              </div>
              <div
                style={{
                  padding: "10px 8px",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={p.empleado}
              >
                {p.empleado}
              </div>
              <div style={{ padding: "10px 8px", minWidth: 0 }}>
                <div
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={p.cargo || "—"}
                >
                  {p.cargo || "—"}
                </div>
                {p.notas ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#64748b",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={p.notas}
                  >
                    {p.notas}
                  </div>
                ) : null}
              </div>
              <div
                style={{
                  padding: "10px 8px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.periodo}
              </div>
              <div
                style={{
                  padding: "10px 8px",
                  textAlign: "right",
                  fontWeight: 800,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmtLps(p.monto)}
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
                  onClick={() => setDetalleItem(p)}
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
                  onClick={() => abrirEditar(p)}
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
                  onClick={() => eliminar(p)}
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
              Detalle de pago de planilla
            </div>
            <div
              style={{ padding: 16, display: "grid", gap: 10, fontSize: 14 }}
            >
              <div>
                <strong>Fecha de pago:</strong> {detalleItem.fecha_pago}
              </div>
              <div>
                <strong>Empleado:</strong> {detalleItem.empleado}
              </div>
              <div>
                <strong>Cargo:</strong> {detalleItem.cargo || "—"}
              </div>
              <div>
                <strong>Período:</strong> {detalleItem.periodo}
              </div>
              <div>
                <strong>Monto:</strong> {fmtLps(detalleItem.monto)}
              </div>
              <div>
                <strong>Notas:</strong> {detalleItem.notas || "—"}
              </div>
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
              {editItem ? "Editar Pago" : "Nuevo Pago de Planilla"}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ fontSize: 13 }}>
                Fecha de pago *
                <input
                  type="date"
                  value={form.fecha_pago}
                  onChange={(e) =>
                    setForm({ ...form, fecha_pago: e.target.value })
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
                Empleado *
                <input
                  type="text"
                  value={form.empleado}
                  onChange={(e) =>
                    setForm({ ...form, empleado: e.target.value })
                  }
                  placeholder="Nombre del empleado"
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
                Cargo
                <input
                  type="text"
                  value={form.cargo}
                  onChange={(e) => setForm({ ...form, cargo: e.target.value })}
                  placeholder="Cocinero, cajero, etc."
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
                Período
                <select
                  value={form.periodo}
                  onChange={(e) =>
                    setForm({ ...form, periodo: e.target.value })
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
                  {PERIODOS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
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
                  background: "#7c3aed",
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
