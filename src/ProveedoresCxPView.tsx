// ============================================================
// ProveedoresCxPView.tsx
// Módulo financiero: Proveedores y Cuentas por Pagar.
// ============================================================
import { useState, useEffect, useCallback } from "react";
import type {
  Proveedor,
  ProveedorInput,
  CuentaPorPagar,
  CuentaPorPagarInput,
  TipoPagoProveedor,
} from "./types/creditos";
import {
  obtenerProveedores,
  crearProveedor,
  actualizarProveedor,
  obtenerCuentasPorPagar,
  crearCuentaPorPagar,
  registrarPagoProveedor,
  obtenerPagosProveedores,
} from "./services/proveedorService";
import { useDatosNegocio } from "./useDatosNegocio";

type SubVista =
  | "listaProveedores"
  | "formProveedor"
  | "listaCxP"
  | "formCxP"
  | "listaPagosProv";

const TIPO_PAGO_PROV: { value: TipoPagoProveedor; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "transferencia", label: "Transferencia" },
  { value: "cheque", label: "Cheque" },
];

function estadoBadge(estado: string) {
  const cfg: Record<string, { bg: string; color: string }> = {
    pendiente: { bg: "#fef3c7", color: "#92400e" },
    parcial: { bg: "#dbeafe", color: "#1e40af" },
    pagado: { bg: "#dcfce7", color: "#14532d" },
    vencido: { bg: "#fee2e2", color: "#b91c1c" },
  };
  const c = cfg[estado] ?? cfg.pendiente;
  return (
    <span
      style={{
        background: c.bg,
        color: c.color,
        padding: "4px 10px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {estado.toUpperCase()}
    </span>
  );
}

interface Props {
  onBack?: () => void;
}

export default function ProveedoresCxPView({ onBack: _onBack }: Props) {
  useDatosNegocio();
  const usuario = (() => {
    try {
      return JSON.parse(localStorage.getItem("usuario") ?? "{}");
    } catch {
      return {};
    }
  })();

  const [subVista, setSubVista] = useState<SubVista>("listaProveedores");
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [cuentasPagar, setCuentasPagar] = useState<CuentaPorPagar[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const [editProv, setEditProv] = useState<Proveedor | null>(null);
  const [fNombre, setFNombre] = useState("");
  const [fRtn, setFRtn] = useState("");
  const [fTel, setFTel] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fDir, setFDir] = useState("");
  const [fContacto, setFContacto] = useState("");
  const [fObs, setFObs] = useState("");
  const [guardandoProv, setGuardandoProv] = useState(false);
  const [errProv, setErrProv] = useState<string | null>(null);

  const [provSlc, setProvSlc] = useState<Proveedor | null>(null);
  const [fConcepto, setFConcepto] = useState("");
  const [fNumDoc, setFNumDoc] = useState("");
  const [fMonto, setFMonto] = useState("");
  const [fFechaEmision, setFFechaEmision] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [fFechaVcto, setFFechaVcto] = useState("");
  const [fObsCxP, setFObsCxP] = useState("");
  const [guardandoCxP, setGuardandoCxP] = useState(false);
  const [errCxP, setErrCxP] = useState<string | null>(null);

  // Pago Modal State
  const [showPagoModal, setShowPagoModal] = useState(false);
  const [cxpSlc, setCxpSlc] = useState<CuentaPorPagar | null>(null);
  const [montoPago, setMontoPago] = useState("");
  const [tipoPago, setTipoPago] = useState<TipoPagoProveedor>("efectivo");
  const [refPago, setRefPago] = useState("");
  const [bancoPago, setBancoPago] = useState("");
  const [obsPago, setObsPago] = useState("");
  const [procesandoPago, setProcesandoPago] = useState(false);
  const [exitoPago, setExitoPago] = useState<string | null>(null);
  const [errPago, setErrPago] = useState<string | null>(null);

  const hoyStr = new Date().toISOString().slice(0, 10);
  const inicioMesStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();
  const [pagosProv, setPagosProv] = useState<any[]>([]);
  const [fechaDesdePago, setFechaDesdePago] = useState(inicioMesStr);
  const [fechaHastaPago, setFechaHastaPago] = useState(hoyStr);

  const cargarProveedores = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setProveedores(await obtenerProveedores());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  const cargarCuentasPagar = useCallback(async (provId?: string) => {
    setCargando(true);
    setError(null);
    try {
      setCuentasPagar(await obtenerCuentasPorPagar(provId));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  const cargarPagosProveedor = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await obtenerPagosProveedores({
        proveedorId: provSlc?.id,
        fechaDesde: fechaDesdePago,
        fechaHasta: fechaHastaPago,
      });
      setPagosProv(data);
    } catch (e: any) {
      setError(e.message);
      setPagosProv([]);
    } finally {
      setCargando(false);
    }
  }, [provSlc?.id, fechaDesdePago, fechaHastaPago]);

  useEffect(() => {
    if (subVista === "listaProveedores") {
      cargarProveedores();
      cargarCuentasPagar(); // Cargar todas para el dashboard
    }
    if (subVista === "listaCxP") cargarCuentasPagar(provSlc?.id);
    if (subVista === "listaPagosProv") cargarPagosProveedor();
  }, [
    subVista,
    cargarProveedores,
    cargarCuentasPagar,
    cargarPagosProveedor,
    provSlc,
  ]);

  function abrirNuevoProveedor() {
    setEditProv(null);
    setFNombre("");
    setFRtn("");
    setFTel("");
    setFEmail("");
    setFDir("");
    setFContacto("");
    setFObs("");
    setErrProv(null);
    setSubVista("formProveedor");
  }

  function abrirEditarProveedor(p: Proveedor) {
    setEditProv(p);
    setFNombre(p.nombre_comercial);
    setFRtn(p.rtn_dni ?? "");
    setFTel(p.telefono ?? "");
    setFEmail(p.email ?? "");
    setFDir(p.direccion ?? "");
    setFContacto(p.contacto ?? "");
    setFObs(p.observaciones ?? "");
    setErrProv(null);
    setSubVista("formProveedor");
  }

  async function guardarProveedor() {
    if (!fNombre.trim()) {
      setErrProv("El nombre es requerido.");
      return;
    }
    setGuardandoProv(true);
    setErrProv(null);
    try {
      const input: ProveedorInput = {
        nombre_comercial: fNombre.trim(),
        rtn_dni: fRtn || undefined,
        telefono: fTel || undefined,
        email: fEmail || undefined,
        direccion: fDir || undefined,
        contacto: fContacto || undefined,
        observaciones: fObs || undefined,
        activo: true,
        creado_por: usuario.nombre ?? "",
      };
      if (editProv) await actualizarProveedor(editProv.id, input);
      else await crearProveedor(input);
      await cargarProveedores();
      setSubVista("listaProveedores");
    } catch (e: any) {
      setErrProv(e.message);
    } finally {
      setGuardandoProv(false);
    }
  }

  function abrirNuevaCxP(prov: Proveedor) {
    setProvSlc(prov);
    setFConcepto("");
    setFNumDoc("");
    setFMonto("");
    setFFechaEmision(new Date().toISOString().split("T")[0]);
    setFFechaVcto("");
    setFObsCxP("");
    setErrCxP(null);
    setSubVista("formCxP");
  }

  async function guardarCxP() {
    if (!provSlc) return;
    if (!fConcepto.trim()) {
      setErrCxP("El concepto es requerido.");
      return;
    }
    const montoN = parseFloat(fMonto.replace(",", "."));
    if (!montoN || montoN <= 0) {
      setErrCxP("Monto inválido.");
      return;
    }
    setGuardandoCxP(true);
    setErrCxP(null);
    try {
      const input: CuentaPorPagarInput = {
        proveedor_id: provSlc.id,
        concepto: fConcepto.trim(),
        numero_documento: fNumDoc || undefined,
        monto_total: montoN,
        saldo_pendiente: montoN,
        fecha_emision: fFechaEmision
          ? new Date(fFechaEmision).toISOString()
          : undefined,
        fecha_vencimiento: fFechaVcto
          ? new Date(fFechaVcto).toISOString()
          : undefined,
        estado: "pendiente",
        cajero_id: usuario.id ?? "",
        cajero: usuario.nombre ?? "",
        observaciones: fObsCxP || undefined,
      };
      await crearCuentaPorPagar(input);
      setSubVista("listaProveedores");
    } catch (e: any) {
      setErrCxP(e.message);
    } finally {
      setGuardandoCxP(false);
    }
  }

  function abrirPago(cxp: CuentaPorPagar, prov: Proveedor) {
    setCxpSlc(cxp);
    setProvSlc(prov);
    setMontoPago("");
    setTipoPago("efectivo");
    setRefPago("");
    setBancoPago("");
    setObsPago("");
    setExitoPago(null);
    setErrPago(null);
    setShowPagoModal(true);
  }

  async function confirmarPago() {
    if (!cxpSlc || !provSlc) return;
    const montoN = parseFloat(montoPago.replace(",", "."));
    if (!montoN || montoN <= 0) {
      setErrPago("Monto inválido.");
      return;
    }
    setProcesandoPago(true);
    setErrPago(null);
    try {
      const result = await registrarPagoProveedor({
        proveedor_id: provSlc.id,
        cuenta_pagar_id: cxpSlc.id,
        monto: montoN,
        tipo_pago: tipoPago,
        cajero_id: usuario.id ?? "",
        cajero: usuario.nombre ?? "",
        referencia: refPago || undefined,
        banco: bancoPago || undefined,
        observacion: obsPago || undefined,
      });
      if (!result.ok) throw new Error(result.error);

      setExitoPago(`Pago de L ${montoN.toFixed(2)} procesado exitosamente.`);

      // Update local state smoothly
      if (cxpSlc && result.saldo_despues !== undefined) {
        setCuentasPagar((prev) =>
          prev.map((c) =>
            c.id === cxpSlc.id
              ? {
                  ...c,
                  saldo_pendiente: result.saldo_despues as number,
                  total_pagado: Number(c.total_pagado) + montoN,
                  estado:
                    (result.saldo_despues ?? 0) <= 0 ? "pagado" : c.estado,
                }
              : c,
          ),
        );
      }

      setTimeout(() => setShowPagoModal(false), 2000);
    } catch (e: any) {
      setErrPago(e.message);
    } finally {
      setProcesandoPago(false);
    }
  }

  function imprimirEstadoProveedor(prov: Proveedor, cxps: CuentaPorPagar[]) {
    const totalPend = cxps.reduce((s, c) => s + Number(c.saldo_pendiente), 0);
    // ... same html printing logic mostly
    const html = `<html><head><title>Estado de Cuenta</title></head><body>
      <h1>${prov.nombre_comercial} - Pendiente: L ${totalPend.toFixed(2)}</h1>
    </body></html>`;
    const w = window.open("", "", "height=700,width=1000");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.onload = () => {
        setTimeout(() => {
          w.focus();
          w.print();
          w.close();
        }, 400);
      };
    }
  }

  const provsFiltrados = proveedores.filter(
    (p) =>
      p.nombre_comercial.toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.rtn_dni ?? "").includes(busqueda),
  );

  // Cálculos globales
  const cuentasPendientesGlobal = cuentasPagar.filter(
    (c) => c.estado !== "pagado" && Number(c.saldo_pendiente) > 0,
  );
  const totalDeudaGeneral = cuentasPendientesGlobal.reduce(
    (s, c) => s + Number(c.saldo_pendiente),
    0,
  );
  const totalProveedoresDeuda = new Set(
    cuentasPendientesGlobal.map((c) => c.proveedor_id),
  ).size;

  const deudaPorProveedor = (provId: string) => {
    return cuentasPendientesGlobal
      .filter((c) => c.proveedor_id === provId)
      .reduce((s, c) => s + Number(c.saldo_pendiente), 0);
  };

  const totalDeudaProv = cuentasPagar
    .filter((c) => c.estado !== "pagado")
    .reduce((s, c) => s + Number(c.saldo_pendiente), 0);
  const totalPagadoFiltro = pagosProv.reduce(
    (s, p) => s + Number(p.monto || 0),
    0,
  );

  return (
    <div
      style={{
        fontFamily: "Inter, sans-serif",
        color: "#0f172a",
        paddingBottom: 24,
        position: "relative",
      }}
    >
      <style>{`
        .desktop-only { display: block; }
        .desktop-table { display: table; width: 100%; border-collapse: collapse; font-size: 13px; }
        .mobile-only { display: none; }
        .dashboard-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 4px; }
        .stat-card-title { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
        .stat-card-value { font-size: 24px; font-weight: 900; color: #0f172a; }
        
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .form-full { grid-column: 1 / -1; }
        .btn-action { padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; text-align: center; border: none; }
        .flex-wrap-gap { display: flex; gap: 8px; flex-wrap: wrap; }
        
        .card-grid { display: none; grid-template-columns: 1fr; gap: 16px; margin-top: 16px; }
        .mobile-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.04); display: flex; flex-direction: column; gap: 12px; }
        .mobile-card-title { font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 2px; }
        .mobile-card-subtitle { font-size: 13px; color: #64748b; }
        .mobile-card-row { display: flex; justify-content: space-between; font-size: 13px; color: #475569; padding: 4px 0; border-bottom: 1px dashed #f1f5f9; }
        
        @media (max-width: 768px) {
          .desktop-only { display: none !important; }
          .mobile-only { display: block !important; }
          .card-grid { display: grid !important; }
          .form-grid { grid-template-columns: 1fr; }
          .form-full { grid-column: 1; }
        }
      `}</style>

      <div
        style={{
          background: "linear-gradient(135deg, #0f766e 0%, #0d9488 100%)",
          padding: "20px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
            🏭 Proveedores y CxP
          </div>
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.8)",
              marginTop: 2,
            }}
          >
            Cuentas por pagar
          </div>
        </div>
        {!["listaProveedores"].includes(subVista) && (
          <button
            onClick={() => {
              setSubVista("listaProveedores");
              setExitoPago(null);
            }}
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 8,
              padding: "8px 16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ← Volver
          </button>
        )}
      </div>

      <div style={{ padding: "20px 24px" }}>
        {/* LISTA PROVEEDORES */}
        {subVista === "listaProveedores" && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar proveedor o RTN..."
                style={{
                  flex: 1,
                  minWidth: 200,
                  padding: "12px 16px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  fontSize: 14,
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.02)",
                }}
              />
              <button
                onClick={abrirNuevoProveedor}
                style={{
                  padding: "12px 24px",
                  background: "#0f766e",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 800,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(15, 118, 110, 0.2)",
                }}
              >
                + Nuevo Proveedor
              </button>
              <button
                onClick={() => {
                  setProvSlc(null);
                  setFechaDesdePago(inicioMesStr);
                  setFechaHastaPago(hoyStr);
                  setSubVista("listaPagosProv");
                }}
                style={{
                  padding: "12px 24px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 800,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(37, 99, 235, 0.2)",
                }}
              >
                👁 Ver Pagos General
              </button>
            </div>

            {/* DASHBOARD */}
            <div className="dashboard-stats">
              <div className="stat-card">
                <div className="stat-card-title">Total Deuda Pendiente</div>
                <div className="stat-card-value" style={{ color: "#ef4444" }}>
                  L {totalDeudaGeneral.toFixed(2)}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card-title">Proveedores por Pagar</div>
                <div className="stat-card-value">
                  {totalProveedoresDeuda} personas/empresas
                </div>
              </div>
            </div>

            {error && (
              <div style={{ color: "#ef4444", marginBottom: 12 }}>
                ⚠ {error}
              </div>
            )}

            {cargando ? (
              <div
                style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}
              >
                Cargando...
              </div>
            ) : provsFiltrados.length === 0 ? (
              <div
                style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}
              >
                Sin proveedores.
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div
                  className="desktop-only"
                  style={{
                    overflowX: "auto",
                    background: "white",
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <table className="desktop-table">
                    <thead>
                      <tr
                        style={{
                          background: "#f8fafc",
                          borderBottom: "2px solid #e2e8f0",
                        }}
                      >
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Comercial
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          RTN/DNI
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Contacto
                        </th>
                        <th style={{ padding: "12px", textAlign: "right" }}>
                          Deuda Pendiente
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {provsFiltrados.map((p, i) => {
                        const deudaProv = deudaPorProveedor(p.id);
                        return (
                          <tr
                            key={p.id}
                            style={{
                              background: i % 2 === 0 ? "#fff" : "#fafafa",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            <td style={{ padding: "12px", fontWeight: 700 }}>
                              {p.nombre_comercial}
                            </td>
                            <td
                              style={{
                                padding: "12px",
                                fontFamily: "monospace",
                                color: "#64748b",
                              }}
                            >
                              {p.rtn_dni ?? "—"}
                            </td>
                            <td style={{ padding: "12px" }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>
                                {p.contacto ?? "—"}
                              </div>
                              <div style={{ fontSize: 12, color: "#64748b" }}>
                                ☎ {p.telefono ?? "—"}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: "12px",
                                textAlign: "right",
                                fontWeight: 800,
                                color: deudaProv > 0 ? "#ef4444" : "#16a34a",
                              }}
                            >
                              L {deudaProv.toFixed(2)}
                            </td>
                            <td style={{ padding: "12px" }}>
                              <div className="flex-wrap-gap">
                                <button
                                  onClick={() => abrirEditarProveedor(p)}
                                  className="btn-action"
                                  style={{
                                    background: "#0f766e15",
                                    color: "#0f766e",
                                    border: "1px solid #0f766e30",
                                  }}
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => abrirNuevaCxP(p)}
                                  className="btn-action"
                                  style={{
                                    background: "#f59e0b15",
                                    color: "#92400e",
                                    border: "1px solid #f59e0b30",
                                  }}
                                >
                                  + CxP
                                </button>
                                <button
                                  onClick={() => {
                                    setProvSlc(p);
                                    cargarCuentasPagar(p.id);
                                    setSubVista("listaCxP");
                                  }}
                                  className="btn-action"
                                  style={{
                                    background: "#3b82f615",
                                    color: "#1e40af",
                                    border: "1px solid #3b82f630",
                                  }}
                                >
                                  Ver Deudas
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="card-grid">
                  {provsFiltrados.map((p) => {
                    const deudaProv = deudaPorProveedor(p.id);
                    return (
                      <div
                        key={p.id}
                        className="mobile-card"
                        style={{
                          borderLeft: `6px solid ${deudaProv > 0 ? "#ef4444" : "#10b981"}`,
                        }}
                      >
                        <div>
                          <div className="mobile-card-title">
                            {p.nombre_comercial}
                          </div>
                          <div className="mobile-card-subtitle">
                            {p.rtn_dni ? `RTN: ${p.rtn_dni}` : "Sin RTN"}
                          </div>
                        </div>
                        <div
                          style={{
                            background: "#f8fafc",
                            padding: 12,
                            borderRadius: 8,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              Pendiente
                            </div>
                            <div
                              style={{
                                fontWeight: 800,
                                fontSize: 18,
                                color: deudaProv > 0 ? "#ef4444" : "#16a34a",
                              }}
                            >
                              L {deudaProv.toFixed(2)}
                            </div>
                          </div>
                          <div
                            style={{
                              textAlign: "right",
                              fontSize: 12,
                              color: "#64748b",
                            }}
                          >
                            <div>{p.contacto || "—"}</div>
                            <div>☎ {p.telefono || "—"}</div>
                          </div>
                        </div>
                        <div className="flex-wrap-gap" style={{ marginTop: 4 }}>
                          <button
                            onClick={() => {
                              setProvSlc(p);
                              cargarCuentasPagar(p.id);
                              setSubVista("listaCxP");
                            }}
                            className="btn-action"
                            style={{
                              flex: 1,
                              background: "#3b82f6",
                              color: "white",
                            }}
                          >
                            Saldos y CxP
                          </button>
                          <button
                            onClick={() => abrirNuevaCxP(p)}
                            className="btn-action"
                            style={{
                              flex: 1,
                              background: "#f59e0b",
                              color: "white",
                            }}
                          >
                            + CxP
                          </button>
                          <button
                            onClick={() => abrirEditarProveedor(p)}
                            className="btn-action"
                            style={{
                              flex: 1,
                              background: "#f1f5f9",
                              color: "#475569",
                              border: "1px solid #e2e8f0",
                            }}
                          >
                            Editar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* LISTA CxP */}
        {subVista === "listaCxP" && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  {provSlc
                    ? `Deudas: ${provSlc.nombre_comercial}`
                    : "Cuentas por Pagar"}
                </div>
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  Pendiente:{" "}
                  <strong style={{ color: "#ef4444" }}>
                    L {totalDeudaProv.toFixed(2)}
                  </strong>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {provSlc && (
                  <button
                    onClick={() =>
                      imprimirEstadoProveedor(provSlc, cuentasPagar)
                    }
                    className="btn-action"
                    style={{ background: "#7c3aed", color: "#fff" }}
                  >
                    🖨 Imprimir
                  </button>
                )}
                {provSlc && (
                  <button
                    onClick={() => abrirNuevaCxP(provSlc)}
                    className="btn-action"
                    style={{ background: "#0f766e", color: "#fff" }}
                  >
                    + Nueva CxP
                  </button>
                )}
                <button
                  onClick={() => {
                    setFechaDesdePago(inicioMesStr);
                    setFechaHastaPago(hoyStr);
                    setSubVista("listaPagosProv");
                  }}
                  className="btn-action"
                  style={{ background: "#2563eb", color: "#fff" }}
                >
                  👁 Ver Pagos
                </button>
              </div>
            </div>

            {error && (
              <div style={{ color: "#ef4444", marginBottom: 12 }}>
                ⚠ {error}
              </div>
            )}

            {cargando ? (
              <div
                style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}
              >
                Cargando...
              </div>
            ) : cuentasPagar.length === 0 ? (
              <div
                style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}
              >
                Sin deudas registradas.
              </div>
            ) : (
              <>
                <div
                  className="desktop-only"
                  style={{
                    overflowX: "auto",
                    background: "white",
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <table className="desktop-table">
                    <thead>
                      <tr
                        style={{
                          background: "#f8fafc",
                          borderBottom: "2px solid #e2e8f0",
                        }}
                      >
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Concepto / Doc
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Fechas
                        </th>
                        <th style={{ padding: "12px", textAlign: "right" }}>
                          Saldos
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Estado
                        </th>
                        <th style={{ padding: "12px", textAlign: "center" }}>
                          Acción
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cuentasPagar.map((c, i) => {
                        const prov = proveedores.find(
                          (p) => p.id === c.proveedor_id,
                        );
                        return (
                          <tr
                            key={c.id}
                            style={{
                              background: i % 2 === 0 ? "#fff" : "#fafafa",
                              borderBottom: "1px solid #f1f5f9",
                            }}
                          >
                            <td style={{ padding: "12px" }}>
                              <div style={{ fontWeight: 700 }}>
                                {c.concepto}
                              </div>
                              <div style={{ fontSize: 12, color: "#64748b" }}>
                                Doc: {c.numero_documento ?? "—"}
                              </div>
                            </td>
                            <td style={{ padding: "12px", fontSize: 12 }}>
                              <div>
                                Emi:{" "}
                                {c.fecha_emision
                                  ? new Date(
                                      c.fecha_emision,
                                    ).toLocaleDateString("es-HN")
                                  : "—"}
                              </div>
                              <div
                                style={{
                                  color:
                                    c.estado === "vencido"
                                      ? "#dc2626"
                                      : "inherit",
                                }}
                              >
                                Ven:{" "}
                                {c.fecha_vencimiento
                                  ? new Date(
                                      c.fecha_vencimiento,
                                    ).toLocaleDateString("es-HN")
                                  : "—"}
                              </div>
                            </td>
                            <td style={{ padding: "12px", textAlign: "right" }}>
                              <div style={{ fontWeight: 700 }}>
                                L {Number(c.monto_total).toFixed(2)}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color:
                                    Number(c.saldo_pendiente) > 0
                                      ? "#ef4444"
                                      : "#16a34a",
                                  fontWeight: 700,
                                }}
                              >
                                Pen: L {Number(c.saldo_pendiente).toFixed(2)}
                              </div>
                            </td>
                            <td style={{ padding: "12px" }}>
                              {estadoBadge(c.estado)}
                            </td>
                            <td
                              style={{ padding: "12px", textAlign: "center" }}
                            >
                              {c.estado !== "pagado" && prov && (
                                <button
                                  onClick={() => abrirPago(c, prov)}
                                  className="btn-action"
                                  style={{
                                    background: "#16a34a",
                                    color: "white",
                                  }}
                                >
                                  Pagar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards for CxP */}
                <div className="card-grid">
                  {cuentasPagar.map((c) => {
                    const prov = proveedores.find(
                      (p) => p.id === c.proveedor_id,
                    );
                    return (
                      <div
                        key={c.id}
                        className="mobile-card"
                        style={{
                          borderLeft: `6px solid ${Number(c.saldo_pendiente) > 0 ? "#f59e0b" : "#10b981"}`,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                          }}
                        >
                          <div>
                            <div className="mobile-card-title">
                              {c.concepto}
                            </div>
                            <div className="mobile-card-subtitle">
                              {prov?.nombre_comercial ?? "Proveedor"} · Doc:{" "}
                              {c.numero_documento ?? "N/A"}
                            </div>
                          </div>
                          <div>{estadoBadge(c.estado)}</div>
                        </div>

                        <div
                          style={{
                            background: "#f8fafc",
                            borderRadius: 8,
                            padding: 12,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 8,
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 11, color: "#64748b" }}>
                                Total Deuda
                              </div>
                              <div style={{ fontWeight: 700 }}>
                                L {Number(c.monto_total).toFixed(2)}
                              </div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 11, color: "#64748b" }}>
                                Saldo Pendiente
                              </div>
                              <div
                                style={{
                                  fontWeight: 800,
                                  color:
                                    Number(c.saldo_pendiente) > 0
                                      ? "#ef4444"
                                      : "#16a34a",
                                  fontSize: 15,
                                }}
                              >
                                L {Number(c.saldo_pendiente).toFixed(2)}
                              </div>
                            </div>
                          </div>
                          <div
                            className="mobile-card-row"
                            style={{ borderBottom: "none", fontSize: 12 }}
                          >
                            <span>
                              Vence:{" "}
                              <strong
                                style={{
                                  color:
                                    c.estado === "vencido"
                                      ? "#dc2626"
                                      : "inherit",
                                }}
                              >
                                {c.fecha_vencimiento
                                  ? new Date(
                                      c.fecha_vencimiento,
                                    ).toLocaleDateString("es-HN")
                                  : "—"}
                              </strong>
                            </span>
                            <span style={{ color: "#16a34a" }}>
                              Pagado: L {Number(c.total_pagado).toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {c.estado !== "pagado" && prov && (
                          <button
                            onClick={() => abrirPago(c, prov)}
                            style={{
                              width: "100%",
                              padding: "12px",
                              background: "#16a34a",
                              color: "white",
                              borderRadius: 8,
                              fontWeight: 700,
                              border: "none",
                              fontSize: 15,
                            }}
                          >
                            💳 Registrar Pago
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* LISTA PAGOS PROVEEDORES */}
        {subVista === "listaPagosProv" && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  {provSlc
                    ? `Pagos realizados: ${provSlc.nombre_comercial}`
                    : "Pagos a proveedores"}
                </div>
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  Total pagado en rango:{" "}
                  <strong style={{ color: "#16a34a" }}>
                    L {totalPagadoFiltro.toFixed(2)}
                  </strong>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  value={fechaDesdePago}
                  onChange={(e) => setFechaDesdePago(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                  }}
                />
                <input
                  type="date"
                  value={fechaHastaPago}
                  onChange={(e) => setFechaHastaPago(e.target.value)}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                  }}
                />
                <button
                  onClick={cargarPagosProveedor}
                  className="btn-action"
                  style={{ background: "#0f766e", color: "#fff" }}
                >
                  Filtrar
                </button>
              </div>
            </div>

            {error && (
              <div style={{ color: "#ef4444", marginBottom: 12 }}>
                ⚠ {error}
              </div>
            )}

            {cargando ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
                Cargando pagos...
              </div>
            ) : pagosProv.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
                No hay pagos registrados en el rango seleccionado.
              </div>
            ) : (
              <>
                <div
                  className="desktop-only"
                  style={{
                    overflowX: "auto",
                    background: "white",
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <table className="desktop-table">
                    <thead>
                      <tr
                        style={{
                          background: "#f8fafc",
                          borderBottom: "2px solid #e2e8f0",
                        }}
                      >
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Fecha/Hora
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Proveedor
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          CxP / Documento
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Tipo
                        </th>
                        <th style={{ padding: "12px", textAlign: "right" }}>
                          Monto
                        </th>
                        <th style={{ padding: "12px", textAlign: "left" }}>
                          Cajero
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagosProv.map((p, i) => (
                        <tr
                          key={p.id}
                          style={{
                            background: i % 2 === 0 ? "#fff" : "#fafafa",
                            borderBottom: "1px solid #f1f5f9",
                          }}
                        >
                          <td style={{ padding: "12px", fontSize: 12 }}>
                            {p.fecha_hora
                              ? new Date(p.fecha_hora).toLocaleString("es-HN")
                              : "—"}
                          </td>
                          <td style={{ padding: "12px", fontWeight: 700 }}>
                            {p.proveedor_nombre || "Proveedor"}
                          </td>
                          <td style={{ padding: "12px", fontSize: 12 }}>
                            <div>{p.concepto_cxp || "—"}</div>
                            <div style={{ color: "#64748b" }}>
                              Doc: {p.numero_documento || "—"}
                            </div>
                          </td>
                          <td style={{ padding: "12px" }}>
                            <span
                              style={{
                                padding: "4px 10px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: "#dbeafe",
                                color: "#1e40af",
                              }}
                            >
                              {String(p.tipo_pago || "").toUpperCase()}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "12px",
                              textAlign: "right",
                              fontWeight: 800,
                              color: "#16a34a",
                            }}
                          >
                            L {Number(p.monto || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: "12px" }}>{p.cajero || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#ecfdf5" }}>
                        <td colSpan={4} style={{ padding: "12px", fontWeight: 800 }}>
                          TOTAL PAGADO
                        </td>
                        <td
                          style={{
                            padding: "12px",
                            textAlign: "right",
                            fontWeight: 900,
                            color: "#15803d",
                          }}
                        >
                          L {totalPagadoFiltro.toFixed(2)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="card-grid">
                  {pagosProv.map((p) => (
                    <div key={p.id} className="mobile-card">
                      <div className="mobile-card-title">
                        {p.proveedor_nombre || "Proveedor"}
                      </div>
                      <div className="mobile-card-subtitle">
                        {p.fecha_hora
                          ? new Date(p.fecha_hora).toLocaleString("es-HN")
                          : "—"}
                      </div>
                      <div className="mobile-card-row">
                        <span>Concepto</span>
                        <strong>{p.concepto_cxp || "—"}</strong>
                      </div>
                      <div className="mobile-card-row">
                        <span>Documento</span>
                        <strong>{p.numero_documento || "—"}</strong>
                      </div>
                      <div className="mobile-card-row">
                        <span>Tipo</span>
                        <strong>{String(p.tipo_pago || "").toUpperCase()}</strong>
                      </div>
                      <div className="mobile-card-row">
                        <span>Monto</span>
                        <strong style={{ color: "#16a34a" }}>
                          L {Number(p.monto || 0).toFixed(2)}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* FORMS */}
        {subVista === "formProveedor" && (
          <div
            style={{
              maxWidth: 640,
              margin: "0 auto",
              background: "white",
              padding: 24,
              borderRadius: 16,
              border: "1px solid #e2e8f0",
              boxShadow: "0 10px 25px -5px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 20 }}>
              {editProv ? "Editar Proveedor" : "Nuevo Proveedor"}
            </div>
            {errProv && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderRadius: 8,
                  padding: 12,
                  color: "#dc2626",
                  marginBottom: 16,
                }}
              >
                ⚠ {errProv}
              </div>
            )}

            <div className="form-grid">
              <div className="form-full">
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Nombre Comercial *
                </label>
                <input
                  type="text"
                  value={fNombre}
                  onChange={(e) => setFNombre(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  RTN / DNI
                </label>
                <input
                  type="text"
                  value={fRtn}
                  onChange={(e) => setFRtn(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Teléfono
                </label>
                <input
                  type="text"
                  value={fTel}
                  onChange={(e) => setFTel(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Email
                </label>
                <input
                  type="text"
                  value={fEmail}
                  onChange={(e) => setFEmail(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Contacto
                </label>
                <input
                  type="text"
                  value={fContacto}
                  onChange={(e) => setFContacto(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div className="form-full">
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Dirección
                </label>
                <input
                  type="text"
                  value={fDir}
                  onChange={(e) => setFDir(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button
                onClick={() => setSubVista("listaProveedores")}
                style={{
                  flex: 1,
                  padding: 14,
                  background: "#f1f5f9",
                  borderRadius: 10,
                  fontWeight: 700,
                  border: "1px solid #e2e8f0",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarProveedor}
                disabled={guardandoProv}
                style={{
                  flex: 2,
                  padding: 14,
                  background: guardandoProv ? "#9ca3af" : "#0f766e",
                  color: "white",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 700,
                }}
              >
                {guardandoProv ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        )}

        {subVista === "formCxP" && provSlc && (
          <div
            style={{
              maxWidth: 640,
              margin: "0 auto",
              background: "white",
              padding: 24,
              borderRadius: 16,
              border: "1px solid #e2e8f0",
              boxShadow: "0 10px 25px -5px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
              Nueva Deuda (CxP)
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
              Proveedor: {provSlc.nombre_comercial}
            </div>

            {errCxP && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderRadius: 8,
                  padding: 12,
                  color: "#dc2626",
                  marginBottom: 16,
                }}
              >
                ⚠ {errCxP}
              </div>
            )}

            <div className="form-grid">
              <div className="form-full">
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Concepto de la Deuda *
                </label>
                <input
                  type="text"
                  value={fConcepto}
                  onChange={(e) => setFConcepto(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Doc. Factura
                </label>
                <input
                  type="text"
                  value={fNumDoc}
                  onChange={(e) => setFNumDoc(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Monto Total (L) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={fMonto}
                  onChange={(e) => setFMonto(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Fecha Emisión
                </label>
                <input
                  type="date"
                  value={fFechaEmision}
                  onChange={(e) => setFFechaEmision(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}
                >
                  Fecha Venc.
                </label>
                <input
                  type="date"
                  value={fFechaVcto}
                  onChange={(e) => setFFechaVcto(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              <button
                onClick={() => setSubVista("listaCxP")}
                style={{
                  flex: 1,
                  padding: 14,
                  background: "#f1f5f9",
                  borderRadius: 10,
                  fontWeight: 700,
                  border: "1px solid #e2e8f0",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarCxP}
                disabled={guardandoCxP}
                style={{
                  flex: 2,
                  padding: 14,
                  background: guardandoCxP ? "#9ca3af" : "#0f766e",
                  color: "white",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 700,
                }}
              >
                {guardandoCxP ? "Registrando..." : "Registrar Deuda"}
              </button>
            </div>
          </div>
        )}
      </div>

      {showPagoModal && cxpSlc && provSlc && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "rgba(15,23,42,0.65)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              width: "100%",
              maxWidth: 500,
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              maxHeight: "90vh",
            }}
          >
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                💳 Registrar Pago a Proveedor
              </div>
              <button
                onClick={() => setShowPagoModal(false)}
                style={{
                  background: "#e2e8f0",
                  border: "none",
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  cursor: "pointer",
                  color: "#475569",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 24, overflowY: "auto" }}>
              <div
                style={{
                  background: "#f1f5f9",
                  padding: 16,
                  borderRadius: 12,
                  marginBottom: 20,
                }}
              >
                <div
                  style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}
                >
                  {provSlc.nombre_comercial}
                </div>
                <div
                  style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}
                >
                  {cxpSlc.concepto}
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 12,
                    borderTop: "1px dashed #cbd5e1",
                    paddingTop: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      Deuda original
                    </div>
                    <div style={{ fontWeight: 600 }}>
                      L {Number(cxpSlc.monto_total).toFixed(2)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      Saldo Pendiente a la fecha
                    </div>
                    <div
                      style={{
                        fontWeight: 800,
                        color: "#ef4444",
                        fontSize: 18,
                      }}
                    >
                      L {Number(cxpSlc.saldo_pendiente).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {exitoPago && (
                <div
                  style={{
                    background: "#dcfce7",
                    border: "1px solid #86efac",
                    borderRadius: 10,
                    padding: 14,
                    color: "#14532d",
                    fontWeight: 600,
                    marginBottom: 16,
                  }}
                >
                  ✅ {exitoPago}
                </div>
              )}
              {errPago && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fca5a5",
                    borderRadius: 10,
                    padding: 14,
                    color: "#dc2626",
                    marginBottom: 16,
                  }}
                >
                  ⚠ {errPago}
                </div>
              )}

              <div
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#475569",
                      display: "block",
                      marginBottom: 8,
                    }}
                  >
                    Método de Pago
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {TIPO_PAGO_PROV.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => setTipoPago(t.value)}
                        style={{
                          flex: "1 1 auto",
                          padding: "10px",
                          border: `2px solid ${tipoPago === t.value ? "#16a34a" : "#e2e8f0"}`,
                          borderRadius: 8,
                          background:
                            tipoPago === t.value ? "#16a34a15" : "#fff",
                          color: tipoPago === t.value ? "#15803d" : "#475569",
                          cursor: "pointer",
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#475569",
                      display: "block",
                      marginBottom: 8,
                    }}
                  >
                    Monto a Pagar (L) *
                  </label>
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <div style={{ position: "relative", flex: 1 }}>
                      <span
                        style={{
                          position: "absolute",
                          left: 16,
                          top: 14,
                          fontSize: 16,
                          color: "#cbd5e1",
                          fontWeight: 700,
                        }}
                      >
                        L
                      </span>
                      <input
                        type="number"
                        value={montoPago}
                        onChange={(e) => setMontoPago(e.target.value)}
                        placeholder="0.00"
                        step={0.01}
                        max={cxpSlc.saldo_pendiente}
                        style={{
                          width: "100%",
                          padding: "14px 16px 14px 32px",
                          border: "2px solid #e2e8f0",
                          borderRadius: 10,
                          fontSize: 18,
                          fontWeight: 800,
                          boxSizing: "border-box",
                          color: "#16a34a",
                        }}
                      />
                    </div>
                    <button
                      onClick={() =>
                        setMontoPago(Number(cxpSlc.saldo_pendiente).toFixed(2))
                      }
                      style={{
                        padding: "14px",
                        background: "#f1f5f9",
                        border: "1px solid #cbd5e1",
                        borderRadius: 10,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#0f172a",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Pagar Total
                    </button>
                  </div>
                </div>

                {(tipoPago === "tarjeta" ||
                  tipoPago === "transferencia" ||
                  tipoPago === "cheque") && (
                  <div style={{ display: "flex", gap: 12 }}>
                    <input
                      type="text"
                      value={bancoPago}
                      onChange={(e) => setBancoPago(e.target.value)}
                      placeholder="Banco (opcional)"
                      style={{
                        flex: 1,
                        padding: "12px",
                        border: "1px solid #cbd5e1",
                        borderRadius: 8,
                        fontSize: 13,
                      }}
                    />
                    <input
                      type="text"
                      value={refPago}
                      onChange={(e) => setRefPago(e.target.value)}
                      placeholder="Referencia / Nº"
                      style={{
                        flex: 1,
                        padding: "12px",
                        border: "1px solid #cbd5e1",
                        borderRadius: 8,
                        fontSize: 13,
                      }}
                    />
                  </div>
                )}

                <input
                  type="text"
                  value={obsPago}
                  onChange={(e) => setObsPago(e.target.value)}
                  placeholder="Observaciones extras del pago..."
                  style={{
                    padding: "12px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    fontSize: 13,
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e2e8f0",
                background: "#f8fafc",
              }}
            >
              <button
                onClick={confirmarPago}
                disabled={procesandoPago || !montoPago}
                style={{
                  width: "100%",
                  padding: 16,
                  background: procesandoPago ? "#9ca3af" : "#16a34a",
                  color: "white",
                  border: "none",
                  borderRadius: 12,
                  fontWeight: 800,
                  fontSize: 16,
                  cursor: procesandoPago ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 12px rgba(22, 163, 74, 0.2)",
                }}
              >
                {procesandoPago
                  ? "Procesando el pago..."
                  : `Confirmar Pago L ${parseFloat(montoPago || "0").toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
