import { useEffect, useState, useRef } from "react";
import { supabase } from "./supabaseClient";

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface FacturaSAR {
  id: number;
  fecha_hora: string;
  factura: string;
  cajero: string;
  caja?: string;
  sub_total: string | number;
  isv_15: string | number;
  isv_18: string | number;
  total: string | number;
  cliente?: string;
  tipo_documento_fiscal?: string;
  rtn_cliente?: string;
  nombre_cliente_fiscal?: string;
  numero_secuencial?: number;
  exento?: string | number;
  cai?: string;
}

interface ResumenMensual {
  mes: string;
  total_facturas: number;
  gravado_15: number;
  isv_15: number;
  gravado_18: number;
  isv_18: number;
  exento: number;
  total_general: number;
}

interface FacturacionSARViewProps {
  onBack?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: string | number | undefined): number =>
  parseFloat(String(v ?? 0)) || 0;

const moneda = (n: number) =>
  "L " +
  n.toLocaleString("es-HN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function primerDiaDelMes() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
.sar-root {
  min-height: 100vh; width: 100%;
  background: linear-gradient(135deg,#f0f4ff 0%,#e8f5e9 100%);
  font-family: 'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
}
.sar-header {
  background: linear-gradient(135deg,#1a237e 0%,#283593 60%,#1565c0 100%);
  padding: 0; border-bottom: none;
  box-shadow: 0 4px 24px rgba(26,35,126,0.35);
}
.sar-header-inner {
  padding: 1.1rem 1.8rem;
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;
}
.sar-header-left { display: flex; align-items: center; gap: 14px; }
.sar-back-btn {
  background: rgba(255,255,255,0.12); color: #fff;
  border: 1px solid rgba(255,255,255,0.25); border-radius: 8px;
  padding: 7px 14px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all .15s;
}
.sar-back-btn:hover { background: rgba(255,255,255,0.22); }
.sar-header-title { color: #fff; font-size: 1.3rem; font-weight: 900; margin: 0; letter-spacing: -0.3px; }
.sar-header-sub { color: rgba(255,255,255,0.65); font-size: 12px; margin: 2px 0 0; }
.sar-badge-honduras {
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
  border-radius: 99px; padding: 4px 12px; color: rgba(255,255,255,0.85); font-size: 12px; font-weight: 600;
}
/* Filtros */
.sar-filter-bar {
  background: rgba(255,255,255,0.97); border-bottom: 1px solid #e2e8f0;
  padding: 0.9rem 1.8rem; display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap;
  box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.sar-f-group { display: flex; flex-direction: column; gap: 4px; }
.sar-f-label { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .4px; }
.sar-f-input, .sar-f-select {
  padding: 8px 12px; border: 1.5px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; color: #0f172a; background: #f8fafc; outline: none;
  transition: border .15s, box-shadow .15s;
}
.sar-f-input:focus, .sar-f-select:focus {
  border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(59,130,246,.12);
}
.sar-btn-buscar {
  padding: 9px 22px; background: linear-gradient(135deg,#1a237e,#3b82f6);
  color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 13px;
  cursor: pointer; display: flex; align-items: center; gap: 7px; white-space: nowrap;
  box-shadow: 0 3px 10px rgba(26,35,126,0.3); transition: all .15s;
}
.sar-btn-buscar:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(26,35,126,0.4); }
.sar-btn-report {
  padding: 9px 18px; background: linear-gradient(135deg,#16a34a,#22c55e);
  color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 13px;
  cursor: pointer; display: flex; align-items: center; gap: 7px; white-space: nowrap;
  box-shadow: 0 3px 10px rgba(22,163,74,0.3); transition: all .15s;
}
.sar-btn-report:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(22,163,74,0.45); }
.sar-btn-excel {
  padding: 9px 16px; background: linear-gradient(135deg,#0f766e,#14b8a6);
  color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 13px;
  cursor: pointer; display: flex; align-items: center; gap: 7px; white-space: nowrap; transition: all .15s;
}
.sar-btn-excel:hover { transform: translateY(-1px); }
/* Main */
.sar-main { padding: 1.4rem 1.8rem; }
/* Stats */
.sar-stats { display: grid; grid-template-columns: repeat(auto-fit,minmax(175px,1fr)); gap: 1rem; margin-bottom: 1.4rem; }
.sar-stat {
  background: #fff; border-radius: 14px; padding: 1.1rem 1.1rem; text-align: center;
  border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.05); transition: all .25s;
}
.sar-stat:hover { transform: translateY(-3px); box-shadow: 0 10px 28px rgba(0,0,0,0.1); }
.sar-stat-val { font-size: 1.65rem; font-weight: 900; }
.sar-stat-lbl { color: #64748b; font-size: 11px; margin-top: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
/* Tabs */
.sar-tabs { display: flex; gap: 4px; margin-bottom: 1.1rem; background: #fff; border-radius: 12px; padding: 4px; border: 1px solid #e2e8f0; width: fit-content; }
.sar-tab {
  padding: 7px 18px; border-radius: 8px; border: none; font-weight: 700; font-size: 13px;
  cursor: pointer; transition: all .15s; background: transparent; color: #64748b;
}
.sar-tab.active { background: linear-gradient(135deg,#1a237e,#3b82f6); color: #fff; box-shadow: 0 3px 10px rgba(26,35,126,.25); }
/* Tabla */
.sar-table-wrap {
  background: #fff; border-radius: 14px; overflow: hidden;
  border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.05);
}
.sar-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.sar-table th {
  background: linear-gradient(135deg,#1a237e 0%,#1565c0 100%);
  color: rgba(255,255,255,0.92); padding: 0.8rem 0.9rem;
  text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .4px;
  position: sticky; top: 0; z-index: 2;
}
.sar-table td { padding: 0.75rem 0.9rem; border-bottom: 1px solid #f1f5f9; color: #374151; vertical-align: middle; }
.sar-table tr:last-child td { border-bottom: none; }
.sar-table tr:hover td { background: #f8fafc; }
.sar-no-data { text-align: center; padding: 3rem; color: #94a3b8; }
/* Badges */
.badge-anulada { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 99px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
.badge-ok { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; border-radius: 99px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
.badge-cf { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; border-radius: 99px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
/* Loading */
.sar-loading { text-align: center; padding: 3rem; color: #64748b; }
/* Resumen mensual */
.sar-resumen-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(320px,1fr)); gap: 1rem; }
.sar-resumen-card {
  background: #fff; border-radius: 14px; overflow: hidden;
  border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(0,0,0,0.05);
}
.sar-resumen-head {
  padding: 12px 16px;
  background: linear-gradient(135deg,#1a237e,#1565c0);
  color: #fff; display: flex; justify-content: space-between; align-items: center;
}
.sar-resumen-rows { padding: 10px 14px; }
.sar-resumen-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 7px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px;
}
.sar-resumen-row:last-child { border-bottom: none; }
.sar-resumen-total {
  margin-top: 6px; padding: 10px 14px;
  background: linear-gradient(135deg,#f0f4ff,#e8f5e9);
  display: flex; justify-content: space-between; align-items: center;
  border-top: 2px solid #c7d2fe;
}
/* Paginación */
.sar-pagination { display: flex; align-items: center; gap: 8px; margin-top: 1rem; justify-content: center; flex-wrap: wrap; }
.sar-page-btn {
  padding: 6px 14px; border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #fff; color: #475569; font-weight: 600; font-size: 13px; cursor: pointer;
}
.sar-page-btn.active { background: #1a237e; color: #fff; border-color: #1a237e; }
.sar-page-btn:disabled { opacity: .4; cursor: not-allowed; }
/* Mobile */
@media (max-width:768px) {
  .sar-header-inner { padding: 1rem; }
  .sar-filter-bar { padding: 0.8rem 1rem; }
  .sar-main { padding: 1rem; }
  .sar-table-wrap { overflow-x: auto; }
  .sar-table { min-width: 760px; }
}
/* Print */
@media print {
  .sar-no-print { display: none !important; }
  .sar-header { background: #1a237e !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sar-root { background: #fff !important; }
  .sar-table th { background: #1a237e !important; color: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sar-stat { box-shadow: none !important; }
}
`;

// ─── Componente ───────────────────────────────────────────────────────────────
const PER_PAGE = 50;

export default function FacturacionSARView({
  onBack,
}: FacturacionSARViewProps) {
  const [facturas, setFacturas] = useState<FacturaSAR[]>([]);
  const [loading, setLoading] = useState(false);
  const [desde, setDesde] = useState(primerDiaDelMes());
  const [hasta, setHasta] = useState(hoy());
  const [filtroCajero, setFiltroCajero] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [tab, setTab] = useState<"detalle" | "mensual">("detalle");
  const [page, setPage] = useState(1);
  const [cajeros, setCajeros] = useState<{ id: string; nombre: string }[]>([]);
  const [datosNegocio, setDatosNegocio] = useState<{
    nombre_negocio: string;
    rtn: string;
    direccion: string;
    propietario: string;
    celular: string;
  } | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // ── Cargar cajeros y datos del negocio ────────────────────────────────────
  useEffect(() => {
    supabase
      .from("usuarios")
      .select("id,nombre")
      .eq("rol", "cajero")
      .then(({ data }) => {
        if (data) setCajeros(data);
      });

    supabase
      .from("datos_negocio")
      .select("nombre_negocio,rtn,direccion,propietario,celular")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setDatosNegocio(data as any);
      });
  }, []);

  // ── Cargar facturas SAR ───────────────────────────────────────────────────
  const fetchFacturas = async () => {
    setLoading(true);
    setPage(1);
    let query = supabase
      .from("ventas")
      .select("*")
      .eq("tipo_documento_fiscal", "FACTURA")
      .gte("fecha_hora", desde + " 00:00:00")
      .lte("fecha_hora", hasta + " 23:59:59")
      .order("fecha_hora", { ascending: false });

    if (filtroCajero) query = query.eq("cajero", filtroCajero);

    const { data, error } = await query;
    if (!error && data) {
      let resultado = data as FacturaSAR[];
      if (filtroCliente) {
        const q = filtroCliente.toLowerCase();
        resultado = resultado.filter(
          (f) =>
            (f.nombre_cliente_fiscal ?? "").toLowerCase().includes(q) ||
            (f.rtn_cliente ?? "").toLowerCase().includes(q) ||
            (f.cliente ?? "").toLowerCase().includes(q),
        );
      }
      setFacturas(resultado);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchFacturas();
    // eslint-disable-next-line
  }, []);

  // ── Stats de resumen ──────────────────────────────────────────────────────
  const totalFacturas = facturas.length;
  const totalGravado15 = facturas.reduce((s, f) => s + fmt(f.sub_total), 0);
  const totalISV15 = facturas.reduce((s, f) => s + fmt(f.isv_15), 0);
  const totalISV18 = facturas.reduce((s, f) => s + fmt(f.isv_18), 0);
  const totalExento = facturas.reduce((s, f) => s + fmt(f.exento), 0);
  const totalGeneral = facturas.reduce((s, f) => s + fmt(f.total), 0);
  const totalISV = totalISV15 + totalISV18;

  // ── Resumen mensual (agrupado) ────────────────────────────────────────────
  const resumenMensual: ResumenMensual[] = (() => {
    const map = new Map<string, ResumenMensual>();
    for (const f of facturas) {
      const mes = f.fecha_hora.slice(0, 7); // "YYYY-MM"
      const [anio, m] = mes.split("-");
      const nombreMes = new Date(
        Number(anio),
        Number(m) - 1,
        1,
      ).toLocaleDateString("es-HN", {
        month: "long",
        year: "numeric",
      });
      if (!map.has(mes)) {
        map.set(mes, {
          mes: nombreMes,
          total_facturas: 0,
          gravado_15: 0,
          isv_15: 0,
          gravado_18: 0,
          isv_18: 0,
          exento: 0,
          total_general: 0,
        });
      }
      const r = map.get(mes)!;
      r.total_facturas += 1;
      r.gravado_15 += fmt(f.sub_total);
      r.isv_15 += fmt(f.isv_15);
      r.isv_18 += fmt(f.isv_18);
      r.exento += fmt(f.exento);
      r.total_general += fmt(f.total);
    }
    return Array.from(map.values()).reverse();
  })();

  // ── Paginación ────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(facturas.length / PER_PAGE);
  const facturasPagina = facturas.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ── Imprimir reporte ──────────────────────────────────────────────────────
  const handleImprimir = () => {
    const negocio = datosNegocio?.nombre_negocio ?? "";
    const rtn = datosNegocio?.rtn ?? "";
    const direccion = datosNegocio?.direccion ?? "";
    const fechaGenerado = new Date().toLocaleDateString("es-HN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const filasTabla = facturas
      .map((f, idx) => {
        const cliente =
          f.nombre_cliente_fiscal || f.cliente || "CONSUMIDOR FINAL";
        const rtnCli = f.rtn_cliente
          ? `<div style="font-size:9px;color:#6366f1;margin-top:2px;">RTN: ${f.rtn_cliente}</div>`
          : "";
        const caiCell = f.cai
          ? `<span style="font-family:monospace;font-size:9px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:3px;padding:1px 5px;color:#374151;display:inline-block;word-break:break-all;">${f.cai}</span>`
          : "<span style='color:#cbd5e1;'>—</span>";
        const b15 = fmt(f.sub_total) > 0 ? moneda(fmt(f.sub_total)) : "—";
        const i15 = fmt(f.isv_15) > 0 ? moneda(fmt(f.isv_15)) : "—";
        const i18 = fmt(f.isv_18) > 0 ? moneda(fmt(f.isv_18)) : "—";
        const ex = fmt(f.exento) > 0 ? moneda(fmt(f.exento)) : "—";
        const bg = idx % 2 === 0 ? "#ffffff" : "#f8fafc";
        return `
        <tr style="background:${bg};">
          <td style="text-align:center;color:#94a3b8;font-weight:700;font-size:10px;">${idx + 1}</td>
          <td style="white-space:nowrap;">
            <div style="font-weight:700;font-size:11px;color:#0f172a;">${f.fecha_hora.slice(0, 10)}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${f.fecha_hora.slice(11, 16)}</div>
          </td>
          <td style="font-family:monospace;font-weight:800;color:#1a237e;font-size:11px;white-space:nowrap;">${f.factura}</td>
          <td>${caiCell}</td>
          <td style="color:#b45309;font-weight:700;font-size:11px;white-space:nowrap;">${f.cajero}</td>
          <td>
            <div style="font-weight:600;font-size:11px;color:#0f172a;">${cliente}</div>
            ${rtnCli}
          </td>
          <td style="text-align:right;font-weight:600;font-size:11px;">${b15}</td>
          <td style="text-align:right;color:#16a34a;font-weight:600;font-size:11px;">${i15}</td>
          <td style="text-align:right;color:#a855f7;font-weight:600;font-size:11px;">${i18}</td>
          <td style="text-align:right;color:#64748b;font-size:11px;">${ex}</td>
          <td style="text-align:right;font-weight:800;font-size:11px;">${moneda(fmt(f.total))}</td>
        </tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Reporte de Ventas SAR — ${negocio}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #0f172a; background: #fff; }
    /* ── Portada ── */
    .portada { text-align: center; padding: 28px 24px 18px; border-bottom: 3px solid #1a237e; margin-bottom: 18px; }
    .portada-negocio { font-size: 22px; font-weight: 900; color: #1a237e; letter-spacing: -0.5px; text-transform: uppercase; }
    .portada-sub { font-size: 15px; font-weight: 700; color: #374151; margin: 4px 0 8px; letter-spacing: 1px; text-transform: uppercase; }
    .portada-meta { font-size: 11px; color: #64748b; }
    .portada-meta span { margin: 0 8px; }
    /* ── Resumen impuestos ── */
    .resumen-box { background: #f8fafc; border: 2px solid #e0e7ff; border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; page-break-inside: avoid; }
    .resumen-title { font-size: 12px; font-weight: 900; color: #1a237e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #c7d2fe; }
    .resumen-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .resumen-item { background: #fff; border: 1px solid #e0e7ff; border-radius: 8px; padding: 10px 12px; }
    .resumen-item .label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 4px; }
    .resumen-item .valor { font-size: 14px; font-weight: 900; }
    .resumen-item.total-isv { border-color: #dc2626; background: #fff1f2; }
    .resumen-item.total-isv .label { color: #dc2626; }
    .resumen-item.total-isv .valor { color: #dc2626; }
    .resumen-item.total-gen { border-color: #0f766e; background: #f0fdfa; }
    .resumen-item.total-gen .label { color: #0f766e; }
    .resumen-item.total-gen .valor { color: #0f766e; }
    /* ── Tabla ── */
    .tabla-titulo { font-size: 11px; font-weight: 900; color: #1a237e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; border-left: 4px solid #1a237e; padding-left: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    thead tr { background: #1a237e !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { color: #fff !important; font-weight: 700; padding: 7px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; white-space: nowrap; }
    thead th.num { text-align: right; }
    tbody td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; font-size: 10px; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tfoot tr.total-row { background: #1a237e !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tfoot tr.isv-row { background: #0f172a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tfoot td { color: #fff !important; font-weight: 800; padding: 8px 8px; font-size: 10px; }
    tfoot td.num { text-align: right; }
    tfoot td.amarillo { color: #fde68a !important; font-size: 12px; }
    tfoot td.verde { color: #86efac !important; }
    tfoot td.lila { color: #d8b4fe !important; }
    tfoot td.rojo { color: #fca5a5 !important; font-size: 12px; font-weight: 900; }
    tfoot td.dim { color: rgba(255,255,255,0.5) !important; font-size: 9px; font-weight: 600; }
    @page { size: A4 landscape; margin: 10mm 8mm; }
    @media print {
      body { font-size: 9px; }
      .resumen-grid { grid-template-columns: repeat(4, 1fr); }
      table { font-size: 9px; }
    }
  </style>
</head>
<body>
  <!-- Portada -->
  <div class="portada">
    <div class="portada-negocio">${negocio}</div>
    <div class="portada-sub">Reporte de Ventas</div>
    <div class="portada-meta">
      <span>RTN: ${rtn}</span>
      <span>·</span>
      <span>${direccion}</span>
      <span>·</span>
      <span>Período: ${desde} al ${hasta}</span>
      <span>·</span>
      <span>Generado: ${fechaGenerado}</span>
    </div>
  </div>

  <!-- Resumen de impuestos ARRIBA -->
  <div class="resumen-box">
    <div class="resumen-title">📊 Resumen de Impuestos del Período — ${totalFacturas} factura${totalFacturas !== 1 ? "s" : ""}</div>
    <div class="resumen-grid">
      <div class="resumen-item">
        <div class="label">Base Gravable 15%</div>
        <div class="valor" style="color:#1a237e;">${moneda(totalGravado15)}</div>
      </div>
      <div class="resumen-item">
        <div class="label">ISV 15% (Comidas)</div>
        <div class="valor" style="color:#16a34a;">${moneda(totalISV15)}</div>
      </div>
      <div class="resumen-item">
        <div class="label">ISV 18% (Bebidas)</div>
        <div class="valor" style="color:#a855f7;">${moneda(totalISV18)}</div>
      </div>
      <div class="resumen-item total-isv">
        <div class="label">⚠ Total ISV a Declarar</div>
        <div class="valor">${moneda(totalISV)}</div>
      </div>
      <div class="resumen-item">
        <div class="label">Ventas Exentas</div>
        <div class="valor" style="color:#64748b;">${moneda(totalExento)}</div>
      </div>
      <div class="resumen-item">
        <div class="label">No. de Facturas</div>
        <div class="valor" style="color:#1a237e;">${totalFacturas}</div>
      </div>
      <div class="resumen-item"></div>
      <div class="resumen-item total-gen">
        <div class="label">💰 Total General</div>
        <div class="valor">${moneda(totalGeneral)}</div>
      </div>
    </div>
  </div>

  <!-- Tabla de facturas -->
  <div class="tabla-titulo">Detalle de Facturas SAR</div>
  <table>
    <thead>
      <tr>
        <th style="width:26px;text-align:center;">#</th>
        <th style="width:76px;">Fecha / Hora</th>
        <th style="width:120px;">No. Factura SAR</th>
        <th>CAI</th>
        <th style="width:80px;">Cajero</th>
        <th>Cliente / RTN</th>
        <th class="num" style="width:70px;">Base 15%</th>
        <th class="num" style="width:60px;">ISV 15%</th>
        <th class="num" style="width:60px;">ISV 18%</th>
        <th class="num" style="width:60px;">Exento</th>
        <th class="num" style="width:72px;">Total</th>
      </tr>
    </thead>
    <tbody>${filasTabla}</tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="6" style="text-align:left;">TOTALES DEL PERÍODO &mdash; ${totalFacturas} factura${totalFacturas !== 1 ? "s" : ""}</td>
        <td class="num">${moneda(totalGravado15)}</td>
        <td class="num verde">${moneda(totalISV15)}</td>
        <td class="num lila">${moneda(totalISV18)}</td>
        <td class="num" style="color:rgba(255,255,255,.75)">${moneda(totalExento)}</td>
        <td class="num amarillo">${moneda(totalGeneral)}</td>
      </tr>
      <tr class="isv-row">
        <td colspan="7" class="dim">ISV Total a Declarar ante el SAR:</td>
        <td colspan="2" class="num rojo">${moneda(totalISV)}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const w = window.open("", "_blank", "width=1100,height=750");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  // ── Exportar CSV ──────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    const headers = [
      "No.",
      "Fecha",
      "Correlativo SAR",
      "Cajero",
      "Cliente / RTN",
      "Base 15%",
      "ISV 15%",
      "ISV 18%",
      "Exento",
      "Total",
    ];
    const rows = facturas.map((f, i) => [
      i + 1,
      f.fecha_hora.slice(0, 16).replace("T", " "),
      f.factura,
      f.cajero,
      `${f.nombre_cliente_fiscal ?? f.cliente ?? "CONSUMIDOR FINAL"} ${f.rtn_cliente ? "/ RTN: " + f.rtn_cliente : ""}`,
      fmt(f.sub_total).toFixed(2),
      fmt(f.isv_15).toFixed(2),
      fmt(f.isv_18).toFixed(2),
      fmt(f.exento).toFixed(2),
      fmt(f.total).toFixed(2),
    ]);

    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob(["\ufeff" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Facturacion_SAR_${desde}_${hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="sar-root" ref={printRef}>
      <style>{CSS}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="sar-header">
        <div className="sar-header-inner">
          <div className="sar-header-left">
            {onBack && (
              <button className="sar-back-btn sar-no-print" onClick={onBack}>
                ← Volver
              </button>
            )}
            <div>
              <h1 className="sar-header-title">🏛️ Facturación SAR</h1>
              <p className="sar-header-sub">
                Control de facturas fiscales — Declaración mensual SAR Honduras
              </p>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span className="sar-badge-honduras sar-no-print">
              🇭🇳 SAR Honduras
            </span>
            <button
              className="sar-btn-report sar-no-print"
              onClick={handleImprimir}
            >
              🖨️ Imprimir Reporte
            </button>
            <button
              className="sar-btn-excel sar-no-print"
              onClick={handleExportCSV}
            >
              📊 Exportar CSV
            </button>
          </div>
        </div>

        {/* ── Barra de filtros ──────────────────────────────────────────── */}
        <div className="sar-filter-bar sar-no-print">
          <div className="sar-f-group">
            <span className="sar-f-label">📅 Desde</span>
            <input
              type="date"
              className="sar-f-input"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <div className="sar-f-group">
            <span className="sar-f-label">📅 Hasta</span>
            <input
              type="date"
              className="sar-f-input"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
          <div className="sar-f-group">
            <span className="sar-f-label">👤 Cajero</span>
            <select
              className="sar-f-select"
              value={filtroCajero}
              onChange={(e) => setFiltroCajero(e.target.value)}
            >
              <option value="">Todos</option>
              {cajeros.map((c) => (
                <option key={c.id} value={c.nombre}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="sar-f-group">
            <span className="sar-f-label">🔍 Cliente / RTN</span>
            <input
              type="text"
              className="sar-f-input"
              placeholder="Buscar cliente o RTN..."
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value)}
              style={{ minWidth: 180 }}
            />
          </div>
          <button
            className="sar-btn-buscar"
            onClick={fetchFacturas}
            disabled={loading}
          >
            {loading ? "⏳ Buscando..." : "🔍 Filtrar"}
          </button>
        </div>
      </div>

      <main className="sar-main">
        {/* ── Estadísticas ──────────────────────────────────────────────── */}
        <div className="sar-stats">
          <div className="sar-stat" style={{ borderTop: "3px solid #1a237e" }}>
            <div className="sar-stat-val" style={{ color: "#1a237e" }}>
              {totalFacturas}
            </div>
            <div className="sar-stat-lbl">Facturas Emitidas</div>
          </div>
          <div className="sar-stat" style={{ borderTop: "3px solid #16a34a" }}>
            <div
              className="sar-stat-val"
              style={{ color: "#16a34a", fontSize: "1.2rem" }}
            >
              {moneda(totalGravado15)}
            </div>
            <div className="sar-stat-lbl">Base Gravable 15%</div>
          </div>
          <div className="sar-stat" style={{ borderTop: "3px solid #f59e0b" }}>
            <div
              className="sar-stat-val"
              style={{ color: "#f59e0b", fontSize: "1.2rem" }}
            >
              {moneda(totalISV15)}
            </div>
            <div className="sar-stat-lbl">ISV 15% a Declarar</div>
          </div>
          <div className="sar-stat" style={{ borderTop: "3px solid #a855f7" }}>
            <div
              className="sar-stat-val"
              style={{ color: "#a855f7", fontSize: "1.2rem" }}
            >
              {moneda(totalISV18)}
            </div>
            <div className="sar-stat-lbl">ISV 18% (Bebidas)</div>
          </div>
          <div className="sar-stat" style={{ borderTop: "3px solid #64748b" }}>
            <div
              className="sar-stat-val"
              style={{ color: "#64748b", fontSize: "1.2rem" }}
            >
              {moneda(totalExento)}
            </div>
            <div className="sar-stat-lbl">Ventas Exentas</div>
          </div>
          <div className="sar-stat" style={{ borderTop: "3px solid #dc2626" }}>
            <div
              className="sar-stat-val"
              style={{ color: "#dc2626", fontSize: "1.15rem" }}
            >
              {moneda(totalISV)}
            </div>
            <div className="sar-stat-lbl">Total ISV a Pagar</div>
          </div>
          <div
            className="sar-stat"
            style={{ borderTop: "3px solid #0f766e", gridColumn: "span 1" }}
          >
            <div
              className="sar-stat-val"
              style={{ color: "#0f766e", fontSize: "1.1rem" }}
            >
              {moneda(totalGeneral)}
            </div>
            <div className="sar-stat-lbl">Total General</div>
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div className="sar-tabs sar-no-print">
          <button
            className={`sar-tab ${tab === "detalle" ? "active" : ""}`}
            onClick={() => setTab("detalle")}
          >
            📋 Detalle de Facturas
          </button>
          <button
            className={`sar-tab ${tab === "mensual" ? "active" : ""}`}
            onClick={() => setTab("mensual")}
          >
            📅 Resumen Mensual
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
             TAB DETALLE
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "detalle" && (
          <>
            {/* Header de impresión */}
            <div style={{ display: "none" }} className="sar-print-header">
              <h2 style={{ margin: "0 0 4px", color: "#1a237e" }}>
                REPORTE DE FACTURACIÓN SAR
              </h2>
              <p style={{ margin: 0, color: "#64748b", fontSize: 12 }}>
                Período: {desde} al {hasta} — Generado:{" "}
                {new Date().toLocaleDateString("es-HN")}
              </p>
              <hr style={{ margin: "8px 0", borderColor: "#e2e8f0" }} />
            </div>
            <style>{`@media print { .sar-print-header { display: block !important; margin-bottom: 12px; } }`}</style>

            {loading ? (
              <div className="sar-loading">⏳ Cargando facturas SAR...</div>
            ) : facturas.length === 0 ? (
              <div className="sar-table-wrap">
                <div className="sar-no-data">
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                  <p
                    style={{ fontWeight: 700, color: "#374151", fontSize: 15 }}
                  >
                    No se encontraron facturas SAR
                  </p>
                  <p style={{ fontSize: 13, color: "#64748b" }}>
                    Ajusta el rango de fechas o los filtros y vuelve a buscar.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="sar-table-wrap">
                  <table className="sar-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36, textAlign: "center" }}>#</th>
                        <th style={{ width: 90 }}>Fecha / Hora</th>
                        <th>No. Factura SAR</th>
                        <th>CAI</th>
                        <th>Cajero</th>
                        <th>Cliente / RTN</th>
                        <th style={{ textAlign: "right" }}>Base 15%</th>
                        <th style={{ textAlign: "right" }}>ISV 15%</th>
                        <th style={{ textAlign: "right" }}>ISV 18%</th>
                        <th style={{ textAlign: "right" }}>Exento</th>
                        <th style={{ textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facturasPagina.map((f, idx) => {
                        const numeroFila = (page - 1) * PER_PAGE + idx + 1;
                        const clienteDisplay =
                          f.nombre_cliente_fiscal ||
                          f.cliente ||
                          "CONSUMIDOR FINAL";
                        const rtn = f.rtn_cliente;
                        return (
                          <tr key={f.id}>
                            <td style={{ color: "#94a3b8", fontWeight: 600 }}>
                              {numeroFila}
                            </td>
                            <td>
                              <div
                                style={{
                                  fontWeight: 700,
                                  color: "#0f172a",
                                  fontSize: 12,
                                }}
                              >
                                {f.fecha_hora.slice(0, 10)}
                              </div>
                              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                                {f.fecha_hora.slice(11, 16)}
                              </div>
                            </td>
                            <td>
                              <span
                                style={{
                                  fontFamily: "monospace",
                                  fontWeight: 800,
                                  color: "#1a237e",
                                  fontSize: 12,
                                  letterSpacing: 0.5,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {f.factura}
                              </span>
                            </td>
                            <td style={{ maxWidth: 160 }}>
                              {f.cai ? (
                                <span
                                  style={{
                                    fontFamily: "monospace",
                                    fontSize: 10,
                                    color: "#374151",
                                    background: "#f1f5f9",
                                    border: "1px solid #e2e8f0",
                                    borderRadius: 4,
                                    padding: "2px 6px",
                                    display: "inline-block",
                                    wordBreak: "break-all",
                                    lineHeight: 1.4,
                                  }}
                                >
                                  {f.cai}
                                </span>
                              ) : (
                                <span
                                  style={{ color: "#cbd5e1", fontSize: 11 }}
                                >
                                  —
                                </span>
                              )}
                            </td>
                            <td
                              style={{
                                color: "#b45309",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                                fontSize: 12,
                              }}
                            >
                              {f.cajero}
                            </td>
                            <td>
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: "#0f172a",
                                  fontSize: 12,
                                }}
                              >
                                {clienteDisplay}
                              </div>
                              {rtn && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#6366f1",
                                    fontWeight: 600,
                                  }}
                                >
                                  RTN: {rtn}
                                </div>
                              )}
                              {!rtn && (
                                <span className="badge-cf">
                                  Consumidor Final
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>
                              {fmt(f.sub_total) > 0
                                ? moneda(fmt(f.sub_total))
                                : "—"}
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                color: "#16a34a",
                                fontWeight: 600,
                              }}
                            >
                              {fmt(f.isv_15) > 0 ? moneda(fmt(f.isv_15)) : "—"}
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                color: "#a855f7",
                                fontWeight: 600,
                              }}
                            >
                              {fmt(f.isv_18) > 0 ? moneda(fmt(f.isv_18)) : "—"}
                            </td>
                            <td
                              style={{ textAlign: "right", color: "#64748b" }}
                            >
                              {fmt(f.exento) > 0 ? moneda(fmt(f.exento)) : "—"}
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                fontWeight: 800,
                                color: "#0f172a",
                              }}
                            >
                              {moneda(fmt(f.total))}
                            </td>
                            <td>
                              <span className="badge-ok">✓ Válida</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Fila de totales */}
                    <tfoot>
                      <tr
                        style={{
                          background: "linear-gradient(135deg,#1a237e,#1565c0)",
                        }}
                      >
                        <td
                          colSpan={5}
                          style={{
                            color: "#fff",
                            fontWeight: 800,
                            padding: "10px 14px",
                            fontSize: 13,
                          }}
                        >
                          TOTALES DEL PERÍODO &mdash; {totalFacturas} factura
                          {totalFacturas !== 1 ? "s" : ""}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#fff",
                            fontWeight: 800,
                            padding: "10px 14px",
                          }}
                        >
                          {moneda(totalGravado15)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#86efac",
                            fontWeight: 800,
                            padding: "10px 14px",
                          }}
                        >
                          {moneda(totalISV15)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#d8b4fe",
                            fontWeight: 800,
                            padding: "10px 14px",
                          }}
                        >
                          {moneda(totalISV18)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "rgba(255,255,255,0.7)",
                            fontWeight: 800,
                            padding: "10px 14px",
                          }}
                        >
                          {moneda(totalExento)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#fde68a",
                            fontWeight: 900,
                            padding: "10px 14px",
                            fontSize: 14,
                          }}
                        >
                          {moneda(totalGeneral)}
                        </td>
                      </tr>
                      <tr style={{ background: "#0f172a" }}>
                        <td
                          colSpan={6}
                          style={{
                            padding: "7px 14px",
                            color: "rgba(255,255,255,0.5)",
                            fontSize: 11,
                          }}
                        >
                          ISV Total a Declarar
                        </td>
                        <td
                          colSpan={2}
                          style={{
                            textAlign: "right",
                            color: "#fca5a5",
                            fontWeight: 900,
                            padding: "7px 14px",
                            fontSize: 13,
                          }}
                        >
                          {moneda(totalISV)}
                        </td>
                        <td colSpan={3} style={{ padding: "7px 14px" }}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Paginación */}
                {totalPages > 1 && (
                  <div className="sar-pagination sar-no-print">
                    <button
                      className="sar-page-btn"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      ← Ant
                    </button>
                    {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                      let p = i + 1;
                      if (totalPages > 7) {
                        if (page <= 4) p = i + 1;
                        else if (page >= totalPages - 3) p = totalPages - 6 + i;
                        else p = page - 3 + i;
                      }
                      return (
                        <button
                          key={p}
                          className={`sar-page-btn ${page === p ? "active" : ""}`}
                          onClick={() => setPage(p)}
                        >
                          {p}
                        </button>
                      );
                    })}
                    <button
                      className="sar-page-btn"
                      disabled={page === totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      Sig →
                    </button>
                    <span style={{ color: "#64748b", fontSize: 12 }}>
                      Página {page} de {totalPages} · {facturas.length}{" "}
                      registros
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
             TAB RESUMEN MENSUAL (Declaración)
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "mensual" && (
          <div>
            {/* Encabezado declaración */}
            <div
              style={{
                background: "linear-gradient(135deg,#1a237e,#1565c0)",
                borderRadius: 14,
                padding: "1.2rem 1.6rem",
                marginBottom: "1.2rem",
                color: "#fff",
              }}
            >
              <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 900 }}>
                📊 Resumen para Declaración Mensual SAR
              </h2>
              <p
                style={{
                  margin: 0,
                  color: "rgba(255,255,255,0.75)",
                  fontSize: 13,
                }}
              >
                Período consultado: <strong>{desde}</strong> →{" "}
                <strong>{hasta}</strong> · Art. 22 Ley del ISV Honduras
              </p>
            </div>

            {loading ? (
              <div className="sar-loading">⏳ Calculando resumen...</div>
            ) : resumenMensual.length === 0 ? (
              <div className="sar-table-wrap">
                <div className="sar-no-data">
                  📭 Sin datos para el período seleccionado.
                  <br />
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>
                    Amplía el rango de fechas y vuelve a filtrar.
                  </span>
                </div>
              </div>
            ) : (
              <div className="sar-resumen-grid">
                {resumenMensual.map((r) => (
                  <div key={r.mes} className="sar-resumen-card">
                    <div className="sar-resumen-head">
                      <span
                        style={{
                          fontWeight: 900,
                          fontSize: 15,
                          textTransform: "capitalize",
                        }}
                      >
                        📅 {r.mes}
                      </span>
                      <span
                        style={{
                          background: "rgba(255,255,255,0.15)",
                          borderRadius: 99,
                          padding: "3px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {r.total_facturas} facturas
                      </span>
                    </div>
                    <div className="sar-resumen-rows">
                      <div className="sar-resumen-row">
                        <span style={{ color: "#475569", fontWeight: 600 }}>
                          Base Gravable (15%)
                        </span>
                        <span style={{ fontWeight: 700, color: "#0f172a" }}>
                          {moneda(r.gravado_15)}
                        </span>
                      </div>
                      <div className="sar-resumen-row">
                        <span style={{ color: "#475569", fontWeight: 600 }}>
                          ISV 15% (Comidas)
                        </span>
                        <span style={{ fontWeight: 700, color: "#16a34a" }}>
                          {moneda(r.isv_15)}
                        </span>
                      </div>
                      <div className="sar-resumen-row">
                        <span style={{ color: "#475569", fontWeight: 600 }}>
                          ISV 18% (Bebidas/Alcohol)
                        </span>
                        <span style={{ fontWeight: 700, color: "#a855f7" }}>
                          {moneda(r.isv_18)}
                        </span>
                      </div>
                      <div className="sar-resumen-row">
                        <span style={{ color: "#475569", fontWeight: 600 }}>
                          Ventas Exentas
                        </span>
                        <span style={{ fontWeight: 700, color: "#64748b" }}>
                          {moneda(r.exento)}
                        </span>
                      </div>
                      <div className="sar-resumen-row">
                        <span style={{ color: "#dc2626", fontWeight: 800 }}>
                          Total ISV a Declarar
                        </span>
                        <span
                          style={{
                            fontWeight: 900,
                            color: "#dc2626",
                            fontSize: 14,
                          }}
                        >
                          {moneda(r.isv_15 + r.isv_18)}
                        </span>
                      </div>
                    </div>
                    <div className="sar-resumen-total">
                      <span
                        style={{
                          fontWeight: 800,
                          color: "#0f172a",
                          fontSize: 14,
                        }}
                      >
                        💰 Total Facturado
                      </span>
                      <span
                        style={{
                          fontWeight: 900,
                          color: "#0f766e",
                          fontSize: 16,
                        }}
                      >
                        {moneda(r.total_general)}
                      </span>
                    </div>
                    {/* Instrucción declaración */}
                    <div
                      style={{
                        padding: "10px 14px",
                        fontSize: 11,
                        color: "#64748b",
                        borderTop: "1px solid #f1f5f9",
                        lineHeight: 1.5,
                      }}
                    >
                      <strong>Para declarar en SAR:</strong> Ingresar en SIARH-E
                      en el rubro "Ventas Gravadas 15%" = {moneda(r.gravado_15)}{" "}
                      e "ISV Generado" = {moneda(r.isv_15 + r.isv_18)}.
                    </div>
                  </div>
                ))}

                {/* Totales del período completo */}
                {resumenMensual.length > 1 && (
                  <div
                    style={{
                      background: "linear-gradient(135deg,#f0f4ff,#e8f5e9)",
                      border: "2px solid #c7d2fe",
                      borderRadius: 14,
                      padding: "1.2rem 1.4rem",
                      gridColumn: "1 / -1",
                    }}
                  >
                    <h3
                      style={{
                        margin: "0 0 12px",
                        color: "#1a237e",
                        fontSize: 15,
                        fontWeight: 900,
                      }}
                    >
                      📈 TOTAL DEL PERÍODO COMPLETO
                    </h3>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit,minmax(200px,1fr))",
                        gap: 10,
                      }}
                    >
                      {[
                        {
                          label: "Total Facturas",
                          val: String(totalFacturas),
                          color: "#1a237e",
                        },
                        {
                          label: "Base Gravable 15%",
                          val: moneda(totalGravado15),
                          color: "#0f172a",
                        },
                        {
                          label: "ISV 15%",
                          val: moneda(totalISV15),
                          color: "#16a34a",
                        },
                        {
                          label: "ISV 18%",
                          val: moneda(totalISV18),
                          color: "#a855f7",
                        },
                        {
                          label: "Exento",
                          val: moneda(totalExento),
                          color: "#64748b",
                        },
                        {
                          label: "Total ISV a Pagar",
                          val: moneda(totalISV),
                          color: "#dc2626",
                        },
                        {
                          label: "Total General",
                          val: moneda(totalGeneral),
                          color: "#0f766e",
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          style={{
                            background: "#fff",
                            borderRadius: 10,
                            padding: "10px 14px",
                            border: "1px solid #e0e7ff",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              color: "#64748b",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              marginBottom: 4,
                            }}
                          >
                            {item.label}
                          </div>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 900,
                              color: item.color,
                            }}
                          >
                            {item.val}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
