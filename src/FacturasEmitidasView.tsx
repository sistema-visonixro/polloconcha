// Tipos agregados para corregir errores de compilación
export interface Factura {
  id: number;
  fecha_hora: string;
  factura: string;
  cai: string;
  cajero: string;
  caja?: string;
  sub_total: string;
  isv_15: string;
  isv_18: string;
  total: string;
  productos: string;
  cliente: string;
  es_donacion?: boolean;
  tipo_orden?: string;
  tipo?: string;
  efectivo?: number | string;
  tarjeta?: number | string;
  transferencia?: number | string;
  dolares?: number | string;
  dolares_usd?: number | string;
  delivery?: number | string;
  cambio?: number | string;
}

export interface FacturasEmitidasViewProps {
  onBack?: () => void;
}
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import DetalleFacturaModal from "./DetalleFacturaModal";

export default function FacturasEmitidasView({
  onBack,
}: FacturasEmitidasViewProps) {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [loading, setLoading] = useState(false);
  const [modalFactura, setModalFactura] = useState<Factura | null>(null);
  const [soloDonaciones, setSoloDonaciones] = useState(false);
  const [_pagosPorFacturaMap, _setPagosPorFacturaMap] = useState<
    Map<string, string>
  >(new Map());
  const [totalGastos, setTotalGastos] = useState(0);

  useEffect(() => {
    fetchFacturas();
    // eslint-disable-next-line
  }, [soloDonaciones]);

  async function fetchFacturas() {
    setLoading(true);
    let query = supabase.from("ventas").select("*");
    if (desde && hasta) {
      query = query.gte("fecha_hora", desde).lte("fecha_hora", hasta);
    }
    if (soloDonaciones) {
      query = query.eq("es_donacion", true);
    }
    const { data, error } = await query.order("fecha_hora", {
      ascending: false,
    });
    if (!error && data) {
      setFacturas(data as Factura[]);
      // Construir mapa factura -> tipo_pago desde los propios datos de ventas
      const newMap = new Map<string, string>();
      for (const f of data as Factura[]) {
        let tipoPago = "efectivo";
        if (parseFloat(String(f.tarjeta ?? 0)) > 0) tipoPago = "tarjeta";
        else if (parseFloat(String(f.transferencia ?? 0)) > 0)
          tipoPago = "transferencia";
        else if (parseFloat(String(f.dolares ?? 0)) > 0) tipoPago = "dolares";
        newMap.set(f.factura, tipoPago);
      }
      _setPagosPorFacturaMap(newMap);
    }
    // Cargar gastos del período filtrado
    let gastosQuery = supabase.from("gastos").select("monto");
    if (desde && hasta) {
      gastosQuery = gastosQuery
        .gte("fecha_hora", desde)
        .lte("fecha_hora", hasta);
    }
    const { data: gastosData } = await gastosQuery;
    if (gastosData) {
      const sumGastos = gastosData.reduce(
        (s: number, g: any) => s + parseFloat(g.monto || "0"),
        0,
      );
      setTotalGastos(sumGastos);
    }
    setLoading(false);
  }

  function imprimirEnNuevaVentana() {
    const grupos = [
      {
        key: "efectivo",
        label: "Efectivo",
        icon: "💵",
        color: "#16a34a",
        headerBg: "#16a34a",
      },
      {
        key: "tarjeta",
        label: "Tarjeta",
        icon: "💳",
        color: "#1976d2",
        headerBg: "#1976d2",
      },
      {
        key: "transferencia",
        label: "Transferencia",
        icon: "🏦",
        color: "#7c3aed",
        headerBg: "#7c3aed",
      },
      {
        key: "dolares",
        label: "Dólares",
        icon: "💱",
        color: "#d97706",
        headerBg: "#d97706",
      },
      {
        key: "donacion",
        label: "Donaciones",
        icon: "🎁",
        color: "#9333ea",
        headerBg: "#9333ea",
      },
    ];

    const grouped: Record<string, Factura[]> = {
      efectivo: [],
      tarjeta: [],
      transferencia: [],
      dolares: [],
      donacion: [],
    };
    for (const f of facturas) {
      if (f.es_donacion) {
        grouped["donacion"].push(f);
        continue;
      }
      if (parseFloat(String(f.efectivo ?? 0)) !== 0)
        grouped["efectivo"].push(f);
      if (parseFloat(String(f.tarjeta ?? 0)) !== 0) grouped["tarjeta"].push(f);
      if (parseFloat(String(f.transferencia ?? 0)) !== 0)
        grouped["transferencia"].push(f);
      if (parseFloat(String(f.dolares ?? 0)) !== 0) grouped["dolares"].push(f);
    }

    const pf = (v: unknown) => parseFloat(String(v ?? 0));

    const calcNeto = (lista: Factura[], key: string) => {
      const campoMap: Record<string, keyof Factura> = {
        efectivo: "efectivo",
        tarjeta: "tarjeta",
        transferencia: "transferencia",
        dolares: "dolares",
      };
      const campo = campoMap[key];
      const subtotal = campo
        ? lista.reduce((s, f) => s + pf(f[campo]), 0)
        : lista.reduce((s, f) => s + pf(f.total), 0);
      const subtotalUsd =
        key === "dolares"
          ? lista.reduce((s, f) => s + pf(f.dolares_usd), 0)
          : 0;
      const totalCambio =
        key === "efectivo" || key === "dolares"
          ? lista.reduce((s, f) => s + pf(f.cambio), 0)
          : 0;
      const neto =
        subtotal - totalCambio - (key === "efectivo" ? totalGastos : 0);
      return { subtotal, subtotalUsd, totalCambio, neto };
    };

    const renderGrupoHTML = (g: (typeof grupos)[0], lista: Factura[]) => {
      if (!lista || lista.length === 0) return "";
      const { subtotal, subtotalUsd, totalCambio, neto } = calcNeto(
        lista,
        g.key,
      );
      const isDolares = g.key === "dolares";
      const isDonacion = g.key === "donacion";

      const colHeader = isDolares
        ? `<th>Dólares (L)</th><th>Dólares USD</th>`
        : isDonacion
          ? `<th>Total</th>`
          : `<th>${g.label}</th>`;

      const filas = lista
        .map((f) => {
          const colVal = isDolares
            ? `<td class="num">${pf(f.dolares).toFixed(2)}</td><td class="num">${pf(f.dolares_usd).toFixed(2)}</td>`
            : isDonacion
              ? `<td class="num">0.00</td>`
              : `<td class="num">${pf((f as any)[g.key]).toFixed(2)}</td>`;
          return `<tr>
          <td>${(f.fecha_hora ?? "").replace("T", " ").slice(0, 19)}</td>
          <td>${f.factura ?? ""}${f.es_donacion ? " 🎁" : ""}</td>
          <td>${f.cajero ?? ""}</td>
          <td>${f.caja ?? ""}</td>
          ${colVal}
        </tr>`;
        })
        .join("");

      const colsPago = isDolares ? 2 : 1;
      const colsTotal = 4 + colsPago;

      const footerSubtotal = `<tr class="foot-sub"><td colspan="${colsTotal - 1}" class="num">Subtotal (${lista.length} factura${lista.length !== 1 ? "s" : ""}):</td><td class="num">L ${subtotal.toFixed(2)}</td></tr>`;

      const footerCambio =
        totalCambio > 0
          ? `<tr class="foot-neg"><td colspan="${colsTotal - 1}" class="num">(−) Cambio devuelto:</td><td class="num">− L ${totalCambio.toFixed(2)}</td></tr>`
          : "";

      const footerGastos =
        g.key === "efectivo" && totalGastos > 0
          ? `<tr class="foot-neg"><td colspan="${colsTotal - 1}" class="num">(−) Gastos del período:</td><td class="num">− L ${totalGastos.toFixed(2)}</td></tr>`
          : "";

      const footerNeto =
        g.key === "efectivo" || g.key === "dolares"
          ? `<tr class="foot-neto"><td colspan="${colsTotal - 1}" class="num">✅ Neto ${g.key === "efectivo" ? "Efectivo" : "Dólares"}:</td><td class="num">L ${neto.toFixed(2)}${isDolares ? ` &nbsp;<small>$ ${subtotalUsd.toFixed(2)} USD</small>` : ""}</td></tr>`
          : "";

      return `
        <div class="grupo">
          <div class="grupo-header" style="background:${g.headerBg}">
            <span>${g.icon} ${g.label}</span>
            <span>L ${neto.toFixed(2)}${isDolares ? ` &nbsp; $ ${subtotalUsd.toFixed(2)} USD` : ""}</span>
          </div>
          <table>
            <thead><tr><th>Fecha/Hora</th><th>Factura</th><th>Cajero</th><th>Caja</th>${colHeader}</tr></thead>
            <tbody>${filas}</tbody>
            <tfoot>${footerSubtotal}${footerCambio}${footerGastos}${footerNeto}</tfoot>
          </table>
        </div>`;
    };

    const periodoTexto =
      desde && hasta ? `Período: ${desde} al ${hasta}` : "Todos los registros";
    const cuerpo = grupos
      .map((g) => renderGrupoHTML(g, grouped[g.key]))
      .join("");

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Facturas Emitidas</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 16px; }
    h1 { font-size: 20px; color: #1976d2; margin-bottom: 4px; }
    .periodo { color: #555; font-size: 12px; margin-bottom: 20px; }
    .grupo { margin-bottom: 28px; page-break-inside: avoid; }
    .grupo-header { color: #fff; padding: 8px 14px; border-radius: 6px 6px 0 0; display: flex; justify-content: space-between; align-items: center; font-weight: 800; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #ddd; border-top: none; }
    thead tr { background: #f1f5f9; }
    th { padding: 7px 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #ddd; }
    td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 11px; }
    .num { text-align: right; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .foot-sub td { font-weight: 700; background: #f8fafc; border-top: 2px solid #ddd; }
    .foot-neg td { color: #dc2626; font-weight: 600; background: #fff5f5; }
    .foot-neto td { font-weight: 900; font-size: 13px; background: #ecfdf5; border-top: 2px solid #ddd; }
    @media print {
      @page { margin: 10mm; size: A4 landscape; }
      .grupo { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>📄 Facturas Emitidas</h1>
  <p class="periodo">${periodoTexto} &mdash; ${facturas.length} facturas en total</p>
  ${cuerpo}
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const ventana = window.open("", "_blank");
    if (ventana) {
      ventana.document.write(html);
      ventana.document.close();
    }
  }

  function handleFiltrar() {
    fetchFacturas();
  }

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; background: #fff !important; }
          .facturas-no-print { display: none !important; }
          .facturas-print-area {
            display: block !important;
            padding: 12px;
            background: #fff;
          }
          .facturas-print-area table { page-break-inside: auto; }
          .facturas-print-area tr { page-break-inside: avoid; page-break-after: auto; }
          .facturas-print-area thead { display: table-header-group; }
          .facturas-print-area tfoot { display: table-footer-group; }
          @page { margin: 10mm; size: A4 landscape; }
        }
      `}</style>
      <div
        style={{
          padding: 32,
          background: "linear-gradient(135deg, #e3f0ff 0%, #f8faff 100%)",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            background: "#fff",
            borderRadius: 18,
            boxShadow: "0 4px 24px #0002",
            padding: 32,
          }}
        >
          <div
            className="facturas-no-print"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              marginBottom: 8,
            }}
          >
            <h2
              style={{
                color: "#1976d2",
                fontWeight: 800,
                fontSize: 32,
                margin: 0,
                letterSpacing: 1,
              }}
            >
              Facturas Emitidas
            </h2>
            {onBack && (
              <button
                onClick={onBack}
                style={{
                  background: "#1976d2",
                  color: "#fff",
                  borderRadius: 8,
                  border: "none",
                  padding: "8px 18px",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                ← Volver a Reporte de Ventas
              </button>
            )}
          </div>
          <div
            className="facturas-no-print"
            style={{
              display: "flex",
              gap: 24,
              alignItems: "center",
              marginBottom: 32,
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <label style={{ fontWeight: 600, color: "#1976d2" }}>
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
                    fontSize: 15,
                  }}
                />
              </label>
              <label style={{ fontWeight: 600, color: "#1976d2" }}>
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
                    fontSize: 15,
                  }}
                />
              </label>
              <button
                onClick={handleFiltrar}
                style={{
                  background: "#1976d2",
                  color: "#fff",
                  borderRadius: 8,
                  border: "none",
                  padding: "8px 24px",
                  fontWeight: 700,
                  fontSize: 16,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px #1976d233",
                }}
              >
                Filtrar
              </button>
              <button
                onClick={() => setSoloDonaciones((prev) => !prev)}
                style={{
                  background: soloDonaciones ? "#7c3aed" : "transparent",
                  color: soloDonaciones ? "#fff" : "#7c3aed",
                  borderRadius: 8,
                  border: "2px solid #7c3aed",
                  padding: "8px 18px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                🎁 {soloDonaciones ? "Ver Todas" : "Solo Donaciones"}
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ fontWeight: 600, color: "#1976d2", fontSize: 18 }}>
                Total facturas: {facturas.length}
                {soloDonaciones && (
                  <span
                    style={{
                      marginLeft: 10,
                      background: "#7c3aed",
                      color: "#fff",
                      borderRadius: 8,
                      padding: "2px 10px",
                      fontSize: 13,
                    }}
                  >
                    🎁 Solo Donaciones
                  </span>
                )}
              </div>
              <button
                onClick={() => imprimirEnNuevaVentana()}
                style={{
                  background: "#0f172a",
                  color: "#fff",
                  borderRadius: 8,
                  border: "none",
                  padding: "8px 20px",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: "0 2px 8px #0004",
                }}
              >
                🖨️ Imprimir PDF
              </button>
            </div>
          </div>

          <div className="facturas-print-area" style={{ marginTop: 16 }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <div
                  className="loader"
                  style={{
                    margin: "0 auto",
                    width: 48,
                    height: 48,
                    border: "6px solid #1976d2",
                    borderTop: "6px solid #fff",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <p style={{ color: "#1976d2", fontWeight: 600, marginTop: 16 }}>
                  Cargando...
                </p>
              </div>
            ) : (
              (() => {
                // Definir grupos de pago
                const grupos: {
                  key: string;
                  label: string;
                  icon: string;
                  color: string;
                  bg: string;
                  headerBg: string;
                }[] = [
                  {
                    key: "efectivo",
                    label: "Efectivo",
                    icon: "💵",
                    color: "#16a34a",
                    bg: "#f0fdf4",
                    headerBg: "#16a34a",
                  },
                  {
                    key: "tarjeta",
                    label: "Tarjeta",
                    icon: "💳",
                    color: "#1976d2",
                    bg: "#eff6ff",
                    headerBg: "#1976d2",
                  },
                  {
                    key: "transferencia",
                    label: "Transferencia",
                    icon: "🏦",
                    color: "#7c3aed",
                    bg: "#f5f3ff",
                    headerBg: "#7c3aed",
                  },
                  {
                    key: "dolares",
                    label: "Dólares",
                    icon: "💱",
                    color: "#d97706",
                    bg: "#fef9c3",
                    headerBg: "#d97706",
                  },
                  {
                    key: "donacion",
                    label: "Donaciones",
                    icon: "🎁",
                    color: "#9333ea",
                    bg: "#fdf4ff",
                    headerBg: "#9333ea",
                  },
                ];
                // Cada factura puede aparecer en múltiples grupos si tiene varios métodos de pago
                const grouped: Record<string, Factura[]> = {
                  efectivo: [],
                  tarjeta: [],
                  transferencia: [],
                  dolares: [],
                  donacion: [],
                };
                for (const f of facturas) {
                  if (f.es_donacion) {
                    grouped["donacion"].push(f);
                    continue;
                  }
                  if (parseFloat(String(f.efectivo ?? 0)) !== 0)
                    grouped["efectivo"].push(f);
                  if (parseFloat(String(f.tarjeta ?? 0)) !== 0)
                    grouped["tarjeta"].push(f);
                  if (parseFloat(String(f.transferencia ?? 0)) !== 0)
                    grouped["transferencia"].push(f);
                  if (parseFloat(String(f.dolares ?? 0)) !== 0)
                    grouped["dolares"].push(f);
                }
                const totalGeneral = facturas.reduce(
                  (s, f) => s + parseFloat(f.total || "0"),
                  0,
                );

                // Campo de pago por groupKey
                const camposPago: Record<string, (keyof Factura)[]> = {
                  efectivo: ["efectivo"],
                  tarjeta: ["tarjeta"],
                  transferencia: ["transferencia"],
                  dolares: ["dolares", "dolares_usd"],
                  donacion: [],
                };

                // Calcula neto por grupo (usado también en encabezado)
                const calcNeto = (lista: Factura[], groupKey: string) => {
                  const campos = camposPago[groupKey];
                  if (!campos || campos.length === 0)
                    return {
                      subtotal: 0,
                      totalCambio: 0,
                      neto: 0,
                      subtotalUsd: 0,
                    };
                  const campo = campos[0] as keyof Factura;
                  const subtotal = lista.reduce(
                    (s, f) => s + parseFloat(String(f[campo] ?? 0)),
                    0,
                  );
                  const subtotalUsd =
                    groupKey === "dolares"
                      ? lista.reduce(
                          (s, f) => s + parseFloat(String(f.dolares_usd ?? 0)),
                          0,
                        )
                      : 0;
                  const totalCambio =
                    groupKey === "efectivo" || groupKey === "dolares"
                      ? lista.reduce(
                          (s, f) => s + parseFloat(String(f.cambio ?? 0)),
                          0,
                        )
                      : 0;
                  const neto =
                    subtotal -
                    totalCambio -
                    (groupKey === "efectivo" ? totalGastos : 0);
                  return { subtotal, totalCambio, neto, subtotalUsd };
                };

                // Helper para renderizar tabla de un grupo
                const renderTabla = (
                  lista: Factura[],
                  color: string,
                  bg: string,
                  groupKey: string,
                ) => {
                  const { subtotal, totalCambio, neto, subtotalUsd } = calcNeto(
                    lista,
                    groupKey,
                  );
                  const thStyle: React.CSSProperties = {
                    padding: "8px 10px",
                    textAlign: "left",
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  };
                  const tdStyle: React.CSSProperties = {
                    padding: "7px 10px",
                    fontSize: 13,
                    borderBottom: "1px solid #f0f0f0",
                    color: "#1a1a1a",
                  };
                  const isDolares = groupKey === "dolares";
                  // colSpan para el footer label (columnas fijas: Fecha + Factura + Cajero + Caja = 4, luego columnas de pago)
                  const colsFixed = 4;
                  const colsPago = isDolares ? 2 : 1;
                  return (
                    <div style={{ overflowX: "auto" }}>
                      <table
                        className="desktop-table"
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          background: "#fff",
                          borderRadius: 8,
                          overflow: "hidden",
                        }}
                      >
                        <thead>
                          <tr style={{ background: bg }}>
                            <th style={{ ...thStyle, color }}>Fecha/Hora</th>
                            <th style={{ ...thStyle, color }}>Factura</th>
                            <th style={{ ...thStyle, color }}>Cajero</th>
                            <th style={{ ...thStyle, color }}>Caja</th>
                            {groupKey === "efectivo" && (
                              <th
                                style={{
                                  ...thStyle,
                                  color,
                                  textAlign: "right",
                                }}
                              >
                                Efectivo
                              </th>
                            )}
                            {groupKey === "tarjeta" && (
                              <th
                                style={{
                                  ...thStyle,
                                  color,
                                  textAlign: "right",
                                }}
                              >
                                Tarjeta
                              </th>
                            )}
                            {groupKey === "transferencia" && (
                              <th
                                style={{
                                  ...thStyle,
                                  color,
                                  textAlign: "right",
                                }}
                              >
                                Transferencia
                              </th>
                            )}
                            {isDolares && (
                              <>
                                <th
                                  style={{
                                    ...thStyle,
                                    color,
                                    textAlign: "right",
                                  }}
                                >
                                  Dólares (L)
                                </th>
                                <th
                                  style={{
                                    ...thStyle,
                                    color,
                                    textAlign: "right",
                                  }}
                                >
                                  Dólares USD
                                </th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {lista.map((f) => (
                            <tr
                              key={f.id}
                              style={{
                                cursor: "pointer",
                                transition: "background 0.15s",
                              }}
                              onClick={() => setModalFactura(f)}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.background = bg + "88")
                              }
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.background = "")
                              }
                            >
                              <td style={tdStyle}>
                                {f.fecha_hora?.replace("T", " ").slice(0, 19)}
                              </td>
                              <td style={tdStyle}>
                                {f.factura}
                                {f.es_donacion && (
                                  <span
                                    style={{
                                      marginLeft: 5,
                                      background: "#7c3aed",
                                      color: "#fff",
                                      borderRadius: 5,
                                      padding: "1px 6px",
                                      fontSize: 10,
                                      fontWeight: 700,
                                    }}
                                  >
                                    🎁 DON.
                                  </span>
                                )}
                              </td>
                              <td style={tdStyle}>{f.cajero}</td>
                              <td style={tdStyle}>{f.caja || ""}</td>
                              {groupKey === "efectivo" && (
                                <td
                                  style={{
                                    ...tdStyle,
                                    textAlign: "right",
                                    fontWeight: 600,
                                  }}
                                >
                                  {parseFloat(String(f.efectivo ?? 0)).toFixed(
                                    2,
                                  )}
                                </td>
                              )}
                              {groupKey === "tarjeta" && (
                                <td
                                  style={{
                                    ...tdStyle,
                                    textAlign: "right",
                                    fontWeight: 600,
                                  }}
                                >
                                  {parseFloat(String(f.tarjeta ?? 0)).toFixed(
                                    2,
                                  )}
                                </td>
                              )}
                              {groupKey === "transferencia" && (
                                <td
                                  style={{
                                    ...tdStyle,
                                    textAlign: "right",
                                    fontWeight: 600,
                                  }}
                                >
                                  {parseFloat(
                                    String(f.transferencia ?? 0),
                                  ).toFixed(2)}
                                </td>
                              )}
                              {isDolares && (
                                <>
                                  <td
                                    style={{
                                      ...tdStyle,
                                      textAlign: "right",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {parseFloat(String(f.dolares ?? 0)).toFixed(
                                      2,
                                    )}
                                  </td>
                                  <td
                                    style={{
                                      ...tdStyle,
                                      textAlign: "right",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {parseFloat(
                                      String(f.dolares_usd ?? 0),
                                    ).toFixed(2)}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: bg }}>
                            <td
                              colSpan={colsFixed + colsPago - 1}
                              style={{
                                ...tdStyle,
                                fontWeight: 700,
                                color,
                                textAlign: "right",
                              }}
                            >
                              Subtotal ({lista.length} factura
                              {lista.length !== 1 ? "s" : ""}):
                            </td>
                            <td
                              style={{
                                ...tdStyle,
                                fontWeight: 800,
                                fontSize: 14,
                                color,
                                textAlign: "right",
                              }}
                            >
                              L {subtotal.toFixed(2)}
                            </td>
                          </tr>
                          {totalCambio > 0 && (
                            <tr style={{ background: bg }}>
                              <td
                                colSpan={colsFixed + colsPago - 1}
                                style={{
                                  ...tdStyle,
                                  color: "#dc2626",
                                  textAlign: "right",
                                  fontWeight: 600,
                                }}
                              >
                                (−) Cambio devuelto:
                              </td>
                              <td
                                style={{
                                  ...tdStyle,
                                  color: "#dc2626",
                                  textAlign: "right",
                                  fontWeight: 700,
                                }}
                              >
                                − L {totalCambio.toFixed(2)}
                              </td>
                            </tr>
                          )}
                          {groupKey === "efectivo" && totalGastos > 0 && (
                            <tr style={{ background: bg }}>
                              <td
                                colSpan={colsFixed + colsPago - 1}
                                style={{
                                  ...tdStyle,
                                  color: "#dc2626",
                                  textAlign: "right",
                                  fontWeight: 600,
                                }}
                              >
                                (−) Gastos del período:
                              </td>
                              <td
                                style={{
                                  ...tdStyle,
                                  color: "#dc2626",
                                  textAlign: "right",
                                  fontWeight: 700,
                                }}
                              >
                                − L {totalGastos.toFixed(2)}
                              </td>
                            </tr>
                          )}
                          {(groupKey === "efectivo" ||
                            groupKey === "dolares") && (
                            <tr style={{ background: color + "22" }}>
                              <td
                                colSpan={colsFixed + colsPago - 1}
                                style={{
                                  ...tdStyle,
                                  color,
                                  textAlign: "right",
                                  fontWeight: 800,
                                  fontSize: 14,
                                }}
                              >
                                ✅ Neto{" "}
                                {groupKey === "efectivo"
                                  ? "Efectivo"
                                  : "Dólares"}
                                :
                              </td>
                              <td
                                style={{
                                  ...tdStyle,
                                  color,
                                  textAlign: "right",
                                  fontWeight: 900,
                                  fontSize: 15,
                                }}
                              >
                                L {neto.toFixed(2)}
                                {groupKey === "dolares" && (
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: "#d97706",
                                      marginTop: 2,
                                    }}
                                  >
                                    $ {subtotalUsd.toFixed(2)} USD
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </tfoot>
                      </table>
                    </div>
                  );
                };

                return (
                  <div>
                    {grupos.map((g) => {
                      const lista = grouped[g.key];
                      if (!lista || lista.length === 0) return null;
                      return (
                        <div key={g.key} style={{ marginBottom: 28 }}>
                          {/* Encabezado del grupo */}
                          <div
                            style={{
                              background: g.headerBg,
                              color: "#fff",
                              borderRadius: "10px 10px 0 0",
                              padding: "12px 18px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <span style={{ fontSize: 24 }}>{g.icon}</span>
                              <div>
                                <div style={{ fontWeight: 800, fontSize: 18 }}>
                                  {g.label}
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.88 }}>
                                  {lista.length} factura
                                  {lista.length !== 1 ? "s" : ""}
                                </div>
                              </div>
                            </div>
                            <div
                              style={{
                                fontWeight: 900,
                                fontSize: 22,
                                textAlign: "right",
                              }}
                            >
                              {(() => {
                                const { neto, subtotalUsd } = calcNeto(
                                  lista,
                                  g.key,
                                );
                                if (g.key === "donacion") {
                                  const sum = lista.reduce(
                                    (s, f) => s + parseFloat(f.total || "0"),
                                    0,
                                  );
                                  return <>L {sum.toFixed(2)}</>;
                                }
                                return (
                                  <>
                                    L {neto.toFixed(2)}
                                    {g.key === "dolares" && subtotalUsd > 0 && (
                                      <div
                                        style={{
                                          fontSize: 14,
                                          fontWeight: 700,
                                          opacity: 0.88,
                                        }}
                                      >
                                        $ {subtotalUsd.toFixed(2)} USD
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                          <div
                            style={{
                              border: `1px solid ${g.color}33`,
                              borderTop: "none",
                              borderRadius: "0 0 10px 10px",
                              overflow: "hidden",
                            }}
                          >
                            {renderTabla(lista, g.color, g.bg, g.key)}
                          </div>
                        </div>
                      );
                    })}

                    {/* Total General */}
                    {facturas.length > 0 && (
                      <div
                        style={{
                          background: "linear-gradient(135deg,#1976d2,#0d47a1)",
                          color: "#fff",
                          borderRadius: 14,
                          padding: "18px 24px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: 16,
                          boxShadow: "0 4px 18px #1976d233",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 20 }}>
                            💰 TOTAL GENERAL
                          </div>
                          <div
                            style={{
                              fontSize: 13,
                              opacity: 0.85,
                              marginTop: 2,
                            }}
                          >
                            {facturas.length} facturas en total
                          </div>
                        </div>
                        <div style={{ fontWeight: 900, fontSize: 32 }}>
                          L {totalGeneral.toFixed(2)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
          {onBack && (
            <div
              className="facturas-no-print"
              style={{ textAlign: "right", marginTop: 40 }}
            >
              <button
                onClick={onBack}
                style={{
                  background: "#1976d2",
                  color: "#fff",
                  borderRadius: 8,
                  border: "none",
                  padding: "10px 32px",
                  fontWeight: 700,
                  fontSize: 18,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px #1976d233",
                }}
              >
                Volver
              </button>
            </div>
          )}

          {/* Modal profesional de detalles de factura */}
          <DetalleFacturaModal
            factura={modalFactura}
            onClose={() => setModalFactura(null)}
            onRefresh={fetchFacturas}
          />
        </div>
        <style>{`
				@keyframes spin {
					0% { transform: rotate(0deg); }
					100% { transform: rotate(360deg); }
				}
				@media (max-width: 768px) {
					/* esconder la tabla en móvil y mostrar las cards */
					.desktop-table { display: none !important; }
					.cards-grid { display: grid !important; gap: 12px; }
					.factura-card { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 12px; background: #fff; box-shadow: 0 8px 24px rgba(7,23,48,0.06); border: 1px solid rgba(25,118,210,0.06); cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease; }
					.factura-card:hover { transform: translateY(-4px); box-shadow: 0 14px 34px rgba(7,23,48,0.09); }
					.fc-left { width: 56px; height: 56px; border-radius: 10px; background: linear-gradient(180deg, #eaf4ff 0%, #fff 100%); display:flex; align-items:center; justify-content:center; color:#0b4f9a; font-weight:800; }
					.fc-body { flex: 1; min-width: 0; }
					.fc-title { font-weight: 800; color: #0b4f9a; font-size: 15px; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
					.fc-sub { color: #6b7280; font-size: 13px; margin-bottom: 4px; }
					.fc-date { color: #94a3b8; font-size: 12px; }
					.fc-right { text-align: right; display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
					.fc-amount { font-weight: 900; color: #1976d2; font-size: 15px; }
					.fc-chevron { color: #cbd5e1; font-size: 20px; }
				}
			`}</style>
      </div>
    </>
  );
}
