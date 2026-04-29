import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

interface DonacionRow {
  fecha_hora: string;
  factura: string;
  cajero: string;
  caja: string;
  cliente?: string;
  productos: string;
  platillos: number;
  bebidas: number;
}

interface MesOption {
  value: string; // "YYYY-MM"
  label: string;
}

export default function DonacionesMensualesView({
  onBack,
}: {
  onBack?: () => void;
}) {
  const [donaciones, setDonaciones] = useState<DonacionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [mesSeleccionado, setMesSeleccionado] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [mesesDisponibles, setMesesDisponibles] = useState<MesOption[]>([]);

  // Generar últimos 12 meses disponibles
  useEffect(() => {
    const opciones: MesOption[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("es-HN", {
        year: "numeric",
        month: "long",
      });
      opciones.push({ value, label });
    }
    setMesesDisponibles(opciones);
  }, []);

  useEffect(() => {
    fetchDonaciones();
    // eslint-disable-next-line
  }, [mesSeleccionado]);

  async function fetchDonaciones() {
    setLoading(true);
    try {
      const [year, month] = mesSeleccionado.split("-").map(Number);
      const desde = new Date(year, month - 1, 1).toISOString();
      const hasta = new Date(year, month, 0, 23, 59, 59).toISOString();

      const { data, error } = await supabase
        .from("ventas")
        .select("fecha_hora, factura, cajero, caja, cliente, productos")
        .eq("es_donacion", true)
        .gte("fecha_hora", desde)
        .lte("fecha_hora", hasta)
        .order("fecha_hora", { ascending: false });

      if (error) throw error;

      const rows: DonacionRow[] = (data || []).map((f: any) => {
        let platillos = 0;
        let bebidas = 0;
        try {
          const prods =
            typeof f.productos === "string"
              ? JSON.parse(f.productos)
              : f.productos;
          if (Array.isArray(prods)) {
            for (const p of prods) {
              const qty = parseFloat(p.cantidad || 1);
              if (p.tipo === "comida") platillos += qty;
              else if (p.tipo === "bebida") bebidas += qty;
            }
          }
        } catch (_) {}
        return { ...f, platillos, bebidas };
      });

      setDonaciones(rows);
    } catch (err) {
      console.error("Error cargando donaciones:", err);
    } finally {
      setLoading(false);
    }
  }

  const totalPlatillos = donaciones.reduce((s, d) => s + d.platillos, 0);
  const totalBebidas = donaciones.reduce((s, d) => s + d.bebidas, 0);
  const totalFacturas = donaciones.length;

  const mesLabel =
    mesesDisponibles.find((m) => m.value === mesSeleccionado)?.label ||
    mesSeleccionado;

  return (
    <div
      style={{
        padding: "20px",
        maxWidth: 1360,
        margin: "0 auto",
        background: "#f0f4f8",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          marginBottom: "20px",
          borderRadius: "14px",
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #0b4f9a 0%, #1976d2 100%)",
            color: "#fff",
            padding: "24px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2
              style={{
                margin: "0 0 8px 0",
                fontSize: 28,
                fontWeight: 900,
                letterSpacing: 0.8,
              }}
            >
              🎁 Donaciones Mensuales
            </h2>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.92 }}>
              Platillos y bebidas regalados (autorizados por Admin)
            </p>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                background: "rgba(255,255,255,0.18)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.35)",
                borderRadius: 8,
                padding: "10px 16px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ← Volver
            </button>
          )}
        </div>

        <div
          style={{
            background: "#fff",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            borderTop: "1px solid #dbe2ea",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderRight: "1px solid #e2e8f0",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
              }}
            >
              Mes Activo
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
              {mesLabel}
            </div>
          </div>
          <div
            style={{
              padding: "14px 16px",
              borderRight: "1px solid #e2e8f0",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
              }}
            >
              Total Donaciones
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#7c3aed" }}>
              {totalFacturas}
            </div>
          </div>
          <div
            style={{
              padding: "14px 16px",
              borderRight: "1px solid #e2e8f0",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
              }}
            >
              Platillos Donados
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#dc2626" }}>
              {Math.round(totalPlatillos)}
            </div>
          </div>
          <div style={{ padding: "14px 16px", textAlign: "center" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                textTransform: "uppercase",
              }}
            >
              Bebidas Donadas
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#0284c7" }}>
              {Math.round(totalBebidas)}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          marginBottom: "18px",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "10px",
          padding: "16px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
            alignItems: "end",
          }}
        >
          <div>
            <label
              htmlFor="select-mes"
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              📅 Mes
            </label>
            <select
              id="select-mes"
              value={mesSeleccionado}
              onChange={(e) => setMesSeleccionado(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                color: "#0f172a",
                background: "#fff",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {mesesDisponibles.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 13,
              color: "#334155",
              fontWeight: 600,
            }}
          >
            Mostrando período:{" "}
            <span style={{ color: "#0b4f9a" }}>{mesLabel}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div
          style={{
            textAlign: "center",
            padding: 42,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            color: "#0b4f9a",
            fontWeight: 700,
          }}
        >
          Cargando donaciones...
        </div>
      ) : donaciones.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 48,
            color: "#94a3b8",
            fontSize: 16,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎁</div>
          No hay donaciones registradas en {mesLabel}
        </div>
      ) : (
        <div
          style={{
            overflowX: "auto",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  background:
                    "linear-gradient(135deg, #0b4f9a 0%, #1976d2 100%)",
                  color: "#0f172a",
                  textAlign: "left",
                }}
              >
                {[
                  "Fecha/Hora",
                  "Factura",
                  "Cajero",
                  "Caja",
                  "Cliente",
                  "Platillos",
                  "Bebidas",
                  "Productos",
                ].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", fontWeight: 700 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {donaciones.map((d, i) => {
                const productosStr = (() => {
                  try {
                    const arr =
                      typeof d.productos === "string"
                        ? JSON.parse(d.productos)
                        : d.productos;
                    if (Array.isArray(arr))
                      return arr
                        .map((p: any) => `${p.nombre} ×${p.cantidad}`)
                        .join(", ");
                  } catch (_) {}
                  return "—";
                })();

                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom: "1px solid #e2e8f0",
                      background: i % 2 === 0 ? "#fff" : "#f8fafc",
                      color: "#0f172a",
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 12px",
                        fontSize: 13,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {new Date(d.fecha_hora).toLocaleString("es-HN", {
                        timeZone: "America/Tegucigalpa",
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 700 }}>
                      {d.factura}
                    </td>
                    <td style={{ padding: "10px 12px" }}>{d.cajero || "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{d.caja || "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{d.cliente || "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <span
                        style={{
                          background: "#fff1f2",
                          color: "#0f172a",
                          padding: "3px 10px",
                          borderRadius: 20,
                          fontWeight: 700,
                          fontSize: 14,
                          border: "1px solid #fecdd3",
                        }}
                      >
                        {Math.round(d.platillos)}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <span
                        style={{
                          background: "#eff6ff",
                          color: "#0f172a",
                          padding: "3px 10px",
                          borderRadius: 20,
                          fontWeight: 700,
                          fontSize: 14,
                          border: "1px solid #bfdbfe",
                        }}
                      >
                        {Math.round(d.bebidas)}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "10px 12px",
                        fontSize: 12,
                        color: "#0f172a",
                        maxWidth: 240,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {productosStr}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totales */}
            <tfoot>
              <tr
                style={{
                  background:
                    "linear-gradient(135deg, #0b4f9a 0%, #1976d2 100%)",
                  color: "#0f172a",
                  fontWeight: 800,
                }}
              >
                <td colSpan={5} style={{ padding: "10px 12px" }}>
                  TOTAL DEL MES
                </td>
                <td style={{ padding: "10px 12px", textAlign: "center" }}>
                  {Math.round(totalPlatillos)}
                </td>
                <td style={{ padding: "10px 12px", textAlign: "center" }}>
                  {Math.round(totalBebidas)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
