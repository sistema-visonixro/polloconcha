import { useState } from "react";
import { STORE, getAll } from "./utils/localDB";
import { supabase } from "./supabaseClient";

interface EstadoResultadosViewProps {
  onBack?: () => void;
}

const fmtLps = (n: number) =>
  "L. " +
  Number(n).toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const HOY = new Date().toISOString().slice(0, 10);
const PRIMER_DIA_MES = (() => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`;
})();

function inicioSemana(): string {
  const hoy = new Date();
  const diasAtras = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - diasAtras);
  return lunes.toISOString().slice(0, 10);
}

function mesPasado(): { desde: string; hasta: string } {
  const hoy = new Date();
  const y = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
  const m = hoy.getMonth() === 0 ? 12 : hoy.getMonth();
  const ultimo = new Date(y, m, 0).getDate();
  return {
    desde: `${y}-${String(m).padStart(2, "0")}-01`,
    hasta: `${y}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`,
  };
}

export default function EstadoResultadosView({
  onBack,
}: EstadoResultadosViewProps) {
  const [fechaDesde, setFechaDesde] = useState(PRIMER_DIA_MES);
  const [fechaHasta, setFechaHasta] = useState(HOY);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<null | {
    ventas: number;
    totalIngresos: number;
    compras: number;
    gastos: number;
    pagosProveedores: number;
    planilla: number;
    costosOperativos: number;
    totalEgresos: number;
    utilidad: number;
  }>(null);

  async function calcular() {
    if (!fechaDesde || !fechaHasta) return;
    setLoading(true);
    setResultado(null);
    try {
      try {
        const { data: estadoRows, error: estadoError } = await supabase
          .from("vw_estado_resultados_periodo")
          .select(
            "ventas, compras, gastos_operativos, pagos_proveedores, planilla, costos_operativos_fijos, total_egresos, utilidad_neta",
          )
          .eq("periodo_tipo", "dia")
          .gte("periodo_inicio", `${fechaDesde} 00:00:00`)
          .lte("periodo_inicio", `${fechaHasta} 23:59:59`);

        if (estadoError) throw estadoError;
        if (estadoRows && estadoRows.length > 0) {
          const ventas = estadoRows.reduce(
            (s: number, r: any) => s + Number(r.ventas || 0),
            0,
          );
          const compras = estadoRows.reduce(
            (s: number, r: any) => s + Number(r.compras || 0),
            0,
          );
          const gastos = estadoRows.reduce(
            (s: number, r: any) => s + Number(r.gastos_operativos || 0),
            0,
          );
          const pagosProveedores = estadoRows.reduce(
            (s: number, r: any) => s + Number(r.pagos_proveedores || 0),
            0,
          );
          const planilla = estadoRows.reduce(
            (s: number, r: any) => s + Number(r.planilla || 0),
            0,
          );
          const costosOperativos = estadoRows.reduce(
            (s: number, r: any) => s + Number(r.costos_operativos_fijos || 0),
            0,
          );
          const totalEgresos = estadoRows.reduce(
            (s: number, r: any) => s + Number(r.total_egresos || 0),
            0,
          );
          const utilidad = estadoRows.reduce(
            (s: number, r: any) => s + Number(r.utilidad_neta || 0),
            0,
          );

          setResultado({
            ventas,
            totalIngresos: ventas,
            compras,
            gastos,
            pagosProveedores,
            planilla,
            costosOperativos,
            totalEgresos,
            utilidad,
          });
          return;
        }
      } catch {
        // Si la vista aún no existe o falla, continuar con fallback actual.
      }

      const desdeTs = `${fechaDesde} 00:00:00`;
      const hastaTs = `${fechaHasta} 23:59:59`;

      // ── Ventas ── (Supabase con paginación, fallback a IndexedDB)
      let ventas = 0;
      try {
        let page = 0;
        const PAGE_SIZE = 1000;
        let hasMore = true;
        while (hasMore) {
          const { data, error } = await supabase
            .from("ventas")
            .select("total, tipo")
            .gte("fecha_hora", desdeTs)
            .lte("fecha_hora", hastaTs)
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
          if (error) throw error;
          const rows = data || [];
          ventas += rows
            .filter(
              (v: any) => String(v.tipo || "").toUpperCase() !== "CREDITO",
            )
            .reduce((s: number, v: any) => s + Number(v.total || 0), 0);
          hasMore = rows.length === PAGE_SIZE;
          page++;
        }
      } catch {
        const todasVentas = await getAll<any>(STORE.VENTAS);
        ventas = todasVentas
          .filter((v: any) => {
            const fecha = (v.fecha_hora || "").slice(0, 10);
            return fecha >= fechaDesde && fecha <= fechaHasta;
          })
          .filter((v: any) => String(v.tipo || "").toUpperCase() !== "CREDITO")
          .reduce((s: number, v: any) => s + Number(v.total || 0), 0);
      }

      // ── Gastos ── (Supabase, fallback a IndexedDB)
      let gastos = 0;
      try {
        const { data, error } = await supabase
          .from("gastos")
          .select("monto")
          .gte("fecha", fechaDesde)
          .lte("fecha", fechaHasta);
        if (error) throw error;
        gastos = (data || []).reduce(
          (s: number, g: any) => s + Number(g.monto || 0),
          0,
        );
      } catch {
        const todosGastos = await getAll<any>(STORE.GASTOS);
        gastos = todosGastos
          .filter((g: any) => {
            const fecha = (g.fecha || "").slice(0, 10);
            return fecha >= fechaDesde && fecha <= fechaHasta;
          })
          .reduce((s: number, g: any) => s + Number(g.monto || 0), 0);
      }

      // ── Compras ── (Supabase, fallback a IndexedDB)
      let compras = 0;
      try {
        const { data, error } = await supabase
          .from("compras")
          .select("monto")
          .gte("fecha", fechaDesde)
          .lte("fecha", fechaHasta);
        if (error) throw error;
        compras = (data || []).reduce(
          (s: number, c: any) => s + Number(c.monto || 0),
          0,
        );
      } catch {
        const todasCompras = await getAll<any>(STORE.COMPRAS);
        compras = todasCompras
          .filter((c: any) => c.fecha >= fechaDesde && c.fecha <= fechaHasta)
          .reduce((s: number, c: any) => s + Number(c.monto || 0), 0);
      }

      // ── Planilla ── (Supabase, fallback a IndexedDB)
      let planilla = 0;
      try {
        const { data, error } = await supabase
          .from("planilla")
          .select("monto")
          .gte("fecha_pago", fechaDesde)
          .lte("fecha_pago", fechaHasta);
        if (error) throw error;
        planilla = (data || []).reduce(
          (s: number, p: any) => s + Number(p.monto || 0),
          0,
        );
      } catch {
        const todaPlanilla = await getAll<any>(STORE.PLANILLA);
        planilla = todaPlanilla
          .filter(
            (p: any) =>
              p.fecha_pago >= fechaDesde && p.fecha_pago <= fechaHasta,
          )
          .reduce((s: number, p: any) => s + Number(p.monto || 0), 0);
      }

      // ── Costos operativos ── (Supabase, fallback a IndexedDB)
      let costosOperativos = 0;
      try {
        const { data, error } = await supabase
          .from("costos_operativos")
          .select("monto")
          .gte("fecha", fechaDesde)
          .lte("fecha", fechaHasta);
        if (error) throw error;
        costosOperativos = (data || []).reduce(
          (s: number, c: any) => s + Number(c.monto || 0),
          0,
        );
      } catch {
        const todosCostos = await getAll<any>(STORE.COSTOS_OPERATIVOS);
        costosOperativos = todosCostos
          .filter((c: any) => c.fecha >= fechaDesde && c.fecha <= fechaHasta)
          .reduce((s: number, c: any) => s + Number(c.monto || 0), 0);
      }

      // ── Pagos a proveedores (CxP) ── (Supabase, fallback a IndexedDB)
      let pagosProveedores = 0;
      try {
        const { data, error } = await supabase
          .from("vw_pagos_proveedores_periodo")
          .select("monto_pagado")
          .eq("periodo_tipo", "dia")
          .gte("periodo_inicio", `${fechaDesde} 00:00:00`)
          .lte("periodo_inicio", `${fechaHasta} 23:59:59`);
        if (error) throw error;
        pagosProveedores = (data || []).reduce(
          (s: number, r: any) => s + Number(r.monto_pagado || 0),
          0,
        );
      } catch {
        const todosPagosProv = await getAll<any>(STORE.PAGOS_PROVEEDORES);
        pagosProveedores = todosPagosProv
          .filter((p: any) => {
            const fecha = String(p.fecha_hora || "").slice(0, 10);
            return fecha >= fechaDesde && fecha <= fechaHasta;
          })
          .reduce((s: number, p: any) => s + Number(p.monto || 0), 0);
      }

      const totalIngresos = ventas;
      const totalEgresos =
        compras + gastos + pagosProveedores + planilla + costosOperativos;
      const utilidad = totalIngresos - totalEgresos;

      setResultado({
        ventas,
        totalIngresos,
        compras,
        gastos,
        pagosProveedores,
        planilla,
        costosOperativos,
        totalEgresos,
        utilidad,
      });
    } catch (e) {
      console.error(e);
      alert("Error al calcular.");
    } finally {
      setLoading(false);
    }
  }

  function atajoPeriodo(tipo: "hoy" | "semana" | "mes" | "mes_anterior") {
    if (tipo === "hoy") {
      setFechaDesde(HOY);
      setFechaHasta(HOY);
    }
    if (tipo === "semana") {
      setFechaDesde(inicioSemana());
      setFechaHasta(HOY);
    }
    if (tipo === "mes") {
      setFechaDesde(PRIMER_DIA_MES);
      setFechaHasta(HOY);
    }
    if (tipo === "mes_anterior") {
      const { desde, hasta } = mesPasado();
      setFechaDesde(desde);
      setFechaHasta(hasta);
    }
  }

  function imprimirPDF() {
    if (!resultado) {
      alert("Primero calcula el Estado de Resultados.");
      return;
    }

    const utilidadAbs = Math.abs(resultado.utilidad);
    const estadoUtilidad =
      resultado.utilidad > 0
        ? "GANANCIA"
        : resultado.utilidad < 0
          ? "PÉRDIDA"
          : "PUNTO DE EQUILIBRIO";

    const html = `
      <html>
        <head>
          <title>Estado de Resultados ${fechaDesde} al ${fechaHasta}</title>
          <style>
            @page { size: A4; margin: 14mm; }
            body { font-family: Arial, sans-serif; color: #0f172a; }
            h1 { margin: 0 0 6px; font-size: 20px; }
            .periodo { color: #64748b; margin-bottom: 14px; }
            .box { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
            .section-title { font-size: 12px; letter-spacing: 1px; font-weight: 800; padding: 8px 12px; }
            .ingresos { background: #f0fdf4; color: #166534; }
            .egresos { background: #fef2f2; color: #991b1b; }
            .row { display: flex; justify-content: space-between; padding: 8px 12px; border-top: 1px solid #f1f5f9; }
            .row.total-ing { background: #dcfce7; font-weight: 800; color: #166534; }
            .row.total-egr { background: #fee2e2; font-weight: 800; color: #991b1b; }
            .row.utilidad { padding: 12px; font-weight: 800; font-size: 20px; }
            .meta { margin-top: 2px; color: #64748b; font-size: 12px; }
            .mono { font-family: 'Courier New', monospace; }
          </style>
        </head>
        <body>
          <h1>📊 Estado de Resultados</h1>
          <div class="periodo">Período: ${fechaDesde} al ${fechaHasta}</div>

          <div class="box">
            <div class="section-title ingresos">INGRESOS</div>
            <div class="row"><span>Ventas</span><span class="mono">${fmtLps(resultado.ventas)}</span></div>
            <div class="row total-ing"><span>TOTAL INGRESOS</span><span class="mono">${fmtLps(resultado.totalIngresos)}</span></div>

            <div class="section-title egresos">EGRESOS</div>
            <div class="row"><span>Compras de insumos / mercancía</span><span class="mono">${fmtLps(resultado.compras)}</span></div>
            <div class="row"><span>Gastos operativos (varios)</span><span class="mono">${fmtLps(resultado.gastos)}</span></div>
            <div class="row"><span>Pagos a proveedores (CxP)</span><span class="mono">${fmtLps(resultado.pagosProveedores)}</span></div>
            <div class="row"><span>Planilla (pagos de nómina)</span><span class="mono">${fmtLps(resultado.planilla)}</span></div>
            <div class="row"><span>Costos operativos fijos</span><span class="mono">${fmtLps(resultado.costosOperativos)}</span></div>
            <div class="row total-egr"><span>TOTAL EGRESOS</span><span class="mono">${fmtLps(resultado.totalEgresos)}</span></div>

            <div class="row utilidad" style="background:${resultado.utilidad >= 0 ? "#f0fdf4" : "#fef2f2"};color:${resultado.utilidad >= 0 ? "#166534" : "#991b1b"};">
              <span>UTILIDAD NETA</span>
              <span class="mono">${fmtLps(utilidadAbs)}</span>
            </div>
          </div>
          <div class="meta">Estado: ${estadoUtilidad}</div>
        </body>
      </html>
    `;

    const win = window.open("", "", "height=900,width=900");
    if (!win) {
      alert("Habilita ventanas emergentes para imprimir PDF.");
      return;
    }
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 250);
  }

  function imprimirTicket() {
    if (!resultado) {
      alert("Primero calcula el Estado de Resultados.");
      return;
    }

    const estadoUtilidad =
      resultado.utilidad > 0
        ? "GANANCIA"
        : resultado.utilidad < 0
          ? "PERDIDA"
          : "EQUILIBRIO";

    const html = `
      <html>
        <head>
          <title>Estado de Resultados Ticket</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: 'Courier New', monospace; margin: 0; color: #000; font-size: 11px; }
            .c { text-align: center; }
            .t { font-weight: 700; }
            .sep { border-top: 1px dashed #000; margin: 6px 0; }
            .row { display: flex; justify-content: space-between; gap: 8px; }
            .label { max-width: 58%; }
            .v { text-align: right; white-space: nowrap; }
          </style>
        </head>
        <body>
          <div class="c t">ESTADO DE RESULTADOS</div>
          <div class="c">${fechaDesde} al ${fechaHasta}</div>

          <div class="sep"></div>
          <div class="t">INGRESOS</div>
          <div class="row"><span class="label">Ventas</span><span class="v">${fmtLps(resultado.ventas)}</span></div>
          <div class="row t"><span class="label">TOTAL INGRESOS</span><span class="v">${fmtLps(resultado.totalIngresos)}</span></div>

          <div class="sep"></div>
          <div class="t">EGRESOS</div>
          <div class="row"><span class="label">Compras</span><span class="v">${fmtLps(resultado.compras)}</span></div>
          <div class="row"><span class="label">Gastos</span><span class="v">${fmtLps(resultado.gastos)}</span></div>
          <div class="row"><span class="label">Pagos Proveedores CxP</span><span class="v">${fmtLps(resultado.pagosProveedores)}</span></div>
          <div class="row"><span class="label">Planilla</span><span class="v">${fmtLps(resultado.planilla)}</span></div>
          <div class="row"><span class="label">Costos operativos</span><span class="v">${fmtLps(resultado.costosOperativos)}</span></div>
          <div class="row t"><span class="label">TOTAL EGRESOS</span><span class="v">${fmtLps(resultado.totalEgresos)}</span></div>

          <div class="sep"></div>
          <div class="row t"><span class="label">UTILIDAD NETA</span><span class="v">${fmtLps(Math.abs(resultado.utilidad))}</span></div>
          <div class="c">ESTADO: ${estadoUtilidad}</div>
        </body>
      </html>
    `;

    const win = window.open("", "", "height=800,width=420");
    if (!win) {
      alert("Habilita ventanas emergentes para imprimir ticket.");
      return;
    }
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 250);
  }

  const utilColor =
    resultado === null
      ? "#1e293b"
      : resultado.utilidad > 0
        ? "#16a34a"
        : resultado.utilidad < 0
          ? "#dc2626"
          : "#1e293b";

  const renderFila = (
    label: string,
    valor: number,
    indent?: boolean,
    negativo?: boolean,
  ) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: indent ? "6px 24px" : "8px 16px",
        borderBottom: "1px solid #f1f5f9",
        fontSize: indent ? 14 : 15,
        color: negativo ? "#dc2626" : "#1e293b",
      }}
    >
      <span style={{ color: indent ? "#475569" : "#1e293b" }}>{label}</span>
      <span style={{ fontWeight: indent ? 500 : 700, fontFamily: "monospace" }}>
        {negativo ? `(${fmtLps(valor)})` : fmtLps(valor)}
      </span>
    </div>
  );

  return (
    <div
      className="estado-resultados-view"
      style={{
        maxWidth: 700,
        margin: "0 auto",
        padding: "16px",
        color: "#0f172a",
      }}
    >
      <style>{`
        .estado-resultados-view input,
        .estado-resultados-view select,
        .estado-resultados-view textarea {
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
          📊 Estado de Resultados
        </h2>
      </div>

      {/* Filtros rápidos */}
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}
      >
        {(["hoy", "semana", "mes", "mes_anterior"] as const).map((t) => (
          <button
            key={t}
            onClick={() => atajoPeriodo(t)}
            style={{
              padding: "5px 14px",
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "#0f172a",
            }}
          >
            {t === "hoy"
              ? "Hoy"
              : t === "semana"
                ? "Esta semana"
                : t === "mes"
                  ? "Este mes"
                  : "Mes anterior"}
          </button>
        ))}
      </div>

      {/* Selector fechas + botón */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 20,
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
          onClick={calcular}
          disabled={loading}
          style={{
            padding: "8px 24px",
            background: "#cbd5e1",
            color: "#0f172a",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {loading ? "Calculando..." : "Calcular"}
        </button>
        <button
          onClick={imprimirPDF}
          disabled={!resultado || loading}
          style={{
            padding: "8px 20px",
            background: !resultado || loading ? "#e2e8f0" : "#0f172a",
            color: !resultado || loading ? "#64748b" : "#fff",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            cursor: !resultado || loading ? "not-allowed" : "pointer",
          }}
        >
          🖨 Imprimir PDF
        </button>
        <button
          onClick={imprimirTicket}
          disabled={!resultado || loading}
          style={{
            padding: "8px 20px",
            background: !resultado || loading ? "#e2e8f0" : "#334155",
            color: !resultado || loading ? "#64748b" : "#fff",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            cursor: !resultado || loading ? "not-allowed" : "pointer",
          }}
        >
          🧾 Imprimir Ticket
        </button>
      </div>

      {/* Resultado */}
      {resultado && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
          }}
        >
          {/* Encabezado */}
          <div
            style={{
              background: "#1e293b",
              color: "#e2e8f0",
              padding: "14px 16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              ESTADO DE RESULTADOS
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              {fechaDesde} al {fechaHasta}
            </div>
          </div>

          {/* INGRESOS */}
          <div
            style={{
              background: "#f0fdf4",
              padding: "8px 16px",
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <span
              style={{
                fontWeight: 800,
                fontSize: 13,
                color: "#166534",
                letterSpacing: 1,
              }}
            >
              INGRESOS
            </span>
          </div>
          {renderFila("Ventas", resultado.ventas, true)}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "10px 16px",
              background: "#dcfce7",
              fontWeight: 800,
              fontSize: 15,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            <span style={{ color: "#166534" }}>TOTAL INGRESOS</span>
            <span style={{ color: "#166534", fontFamily: "monospace" }}>
              {fmtLps(resultado.totalIngresos)}
            </span>
          </div>

          {/* EGRESOS */}
          <div
            style={{
              background: "#fef2f2",
              padding: "8px 16px",
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <span
              style={{
                fontWeight: 800,
                fontSize: 13,
                color: "#991b1b",
                letterSpacing: 1,
              }}
            >
              EGRESOS
            </span>
          </div>
          {renderFila(
            "Compras de insumos / mercancía",
            resultado.compras,
            true,
          )}
          {renderFila("Gastos operativos (varios)", resultado.gastos, true)}
          {renderFila(
            "Pagos a proveedores (CxP)",
            resultado.pagosProveedores,
            true,
          )}
          {renderFila("Planilla (pagos de nómina)", resultado.planilla, true)}
          {renderFila(
            "Costos operativos fijos",
            resultado.costosOperativos,
            true,
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "10px 16px",
              background: "#fee2e2",
              fontWeight: 800,
              fontSize: 15,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            <span style={{ color: "#991b1b" }}>TOTAL EGRESOS</span>
            <span style={{ color: "#991b1b", fontFamily: "monospace" }}>
              {fmtLps(resultado.totalEgresos)}
            </span>
          </div>

          {/* UTILIDAD */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "16px 16px",
              background: resultado.utilidad >= 0 ? "#f0fdf4" : "#fef2f2",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, color: utilColor }}>
                UTILIDAD NETA
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                {resultado.utilidad > 0
                  ? "✅ GANANCIA"
                  : resultado.utilidad < 0
                    ? "❌ PÉRDIDA"
                    : "⚖️ PUNTO DE EQUILIBRIO"}
              </div>
            </div>
            <div
              style={{
                fontWeight: 900,
                fontSize: 24,
                color: utilColor,
                fontFamily: "monospace",
              }}
            >
              {fmtLps(Math.abs(resultado.utilidad))}
            </div>
          </div>
        </div>
      )}

      {!resultado && !loading && (
        <div
          style={{
            textAlign: "center",
            color: "#94a3b8",
            marginTop: 48,
            fontSize: 15,
          }}
        >
          Selecciona el período y presiona <strong>Calcular</strong>
        </div>
      )}
    </div>
  );
}
