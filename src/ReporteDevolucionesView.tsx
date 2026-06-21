import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { getLocalDayRange } from "./utils/fechas";

interface ReporteDevolucionesViewProps {
  onBack?: () => void;
}

export default function ReporteDevolucionesView({
  onBack,
}: ReporteDevolucionesViewProps) {
  const today = getLocalDayRange().day;
  const [desde, setDesde] = useState(() => today + "T00:00");
  const [hasta, setHasta] = useState(() => today + "T23:59");
  const [ventas, setVentas] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [productosCache, setProductosCache] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchDevoluciones();
  }, [desde, hasta]);

  async function fetchDevoluciones() {
    setLoading(true);
    try {
      const desdeInicio = desde ? desde.replace("T", " ") + ":00" : null;
      const hastaFin = hasta ? hasta.replace("T", " ") + ":59" : null;

      let query = supabase.from("ventas").select("*");
      query = query.eq("tipo", "DEVOLUCION");

      if (desdeInicio && hastaFin) {
        query = query
          .gte("fecha_hora", desdeInicio)
          .lte("fecha_hora", hastaFin);
      }

      const { data, error } = await query
        .order("fecha_hora", { ascending: false })
        .range(0, 2000);
      if (error) throw error;
      const rows = data || [];
      setVentas(rows);
      // resolver nombres de productos de las ventas (cargar en caché)
      resolveProductosNombres(rows);
      calcularTotal(data || []);
    } catch (err) {
      console.error("Error fetching devoluciones:", err);
      setVentas([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function resolveProductosNombres(rows: any[]) {
    try {
      const idsToLoad = new Set<string>();
      for (const r of rows) {
        const raw = r.productos;
        let parsed: any = null;
        try {
          parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
          parsed = raw;
        }
        if (Array.isArray(parsed)) {
          for (const p of parsed) {
            if (p && p.id && !productosCache[p.id]) idsToLoad.add(p.id);
          }
        }
      }

      const ids = Array.from(idsToLoad);
      if (ids.length === 0) return;

      const { data: prods } = await supabase
        .from("productos")
        .select("id,nombre")
        .in("id", ids);

      if (prods && prods.length) {
        const next = { ...productosCache } as Record<string, string>;
        for (const p of prods) next[p.id] = p.nombre || "";
        setProductosCache(next);
      }
    } catch (err) {
      console.warn("No se pudieron resolver nombres de productos:", err);
    }
  }

  function renderProductosCell(raw: any) {
    let parsed: any = null;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      parsed = raw;
    }
    if (!parsed) return "";
    if (Array.isArray(parsed)) {
      const parts: string[] = [];
      for (const p of parsed) {
        const qty = p.cantidad ?? p.cant ?? p.quantity ?? "";
        if (p.nombre) {
          parts.push(qty ? `${p.nombre} x${qty}` : p.nombre);
        } else if (p.id) {
          const nombre = productosCache[p.id] || p.id;
          parts.push(qty ? `${nombre} x${qty}` : nombre);
        }
      }
      return parts.join(", ");
    }
    return String(parsed);
  }

  function calcularTotal(data: any[]) {
    const sum = data.reduce(
      (s, v) => s + parseFloat((v.total || "0").toString() || "0"),
      0,
    );
    setTotal(sum);
  }

  return (
    <div style={{ width: "100vw", minHeight: "100vh", padding: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={() => (onBack ? onBack() : null)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "none",
              background: "#1976d2",
              color: "#fff",
            }}
          >
            ← Volver a Reporte de Ventas
          </button>
          <h2 style={{ margin: 0, color: "#0f172a" }}>
            Reporte de Devoluciones
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontWeight: 700, color: "#1976d2" }}>
            Desde:
            <input
              type="datetime-local"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              style={{
                marginLeft: 8,
                padding: 6,
                borderRadius: 6,
                border: "1px solid #b0c4de",
              }}
            />
          </label>
          <label style={{ fontWeight: 700, color: "#1976d2" }}>
            Hasta:
            <input
              type="datetime-local"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              style={{
                marginLeft: 8,
                padding: 6,
                borderRadius: 6,
                border: "1px solid #b0c4de",
              }}
            />
          </label>
        </div>
      </div>

      <div style={{ marginBottom: 12, color: "#374151", fontWeight: 700 }}>
        Total devoluciones: {ventas.length} · Suma total: {total.toFixed(2)}
      </div>

      <div
        style={{
          overflowX: "auto",
          background: "#fff",
          border: "1px solid #e6eef8",
          borderRadius: 10,
        }}
      >
        <table
          style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, color: "#000" }}
        >
          <thead>
            <tr
              style={{ textAlign: "left", borderBottom: "1px solid #e6eef8" }}
            >
              <th style={{ padding: 10 }}>Factura</th>
              <th style={{ padding: 10 }}>Fecha</th>
              <th style={{ padding: 10 }}>Cajero</th>
              <th style={{ padding: 10 }}>Cliente</th>
              <th style={{ padding: 10 }}>Total</th>
              <th style={{ padding: 10 }}>Productos</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 12 }}>
                  Cargando...
                </td>
              </tr>
            ) : ventas.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 12 }}>
                  No se encontraron devoluciones en el rango seleccionado.
                </td>
              </tr>
            ) : (
              ventas.map((v) => (
                <tr key={v.id} style={{ borderBottom: "1px solid #f1f5f9", color: "#000" }}>
                  <td style={{ padding: 8 }}>{v.factura}</td>
                  <td style={{ padding: 8 }}>{v.fecha_hora || v.created_at}</td>
                  <td style={{ padding: 8 }}>{v.cajero}</td>
                  <td style={{ padding: 8 }}>{v.cliente}</td>
                  <td style={{ padding: 8 }}>{v.total}</td>
                  <td
                    style={{
                      padding: 8,
                      maxWidth: 420,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "#000",
                    }}
                  >
                    {renderProductosCell(v.productos)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
