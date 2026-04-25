// ============================================================
// PagoCreditoPOSModal.tsx
// Modal del POS para cobrar créditos a clientes.
// Busca el cliente, muestra saldo y facturas pendientes,
// registra el abono y genera comprobante.
// ============================================================
import { useState, useEffect, useRef } from "react";
import type {
  ClienteCredito,
  CuentaPorCobrar,
  FacturaCredito,
  TipoPagoCredito,
} from "./types/creditos";
import {
  buscarClientesCredito,
  obtenerCuentaCobrar,
  obtenerFacturasCliente,
  registrarPagoCredito,
} from "./services/creditoService";
import { useDatosNegocio } from "./useDatosNegocio";
import { getAll, getByIndex, STORE } from "./utils/localDB";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cajero: string;
  cajeroId: string;
  caja?: string;
  theme?: "lite" | "dark";
}

type TipoPago = TipoPagoCredito;

const TIPOS_PAGO: { value: TipoPago; label: string; icon: string }[] = [
  { value: "efectivo", label: "Efectivo", icon: "💵" },
  { value: "tarjeta", label: "Tarjeta", icon: "💳" },
  { value: "transferencia", label: "Transferencia", icon: "🏦" },
  { value: "dolares", label: "Dólares", icon: "🇺🇸" },
];

export default function PagoCreditoPOSModal({
  isOpen,
  onClose,
  cajero,
  cajeroId,
  caja = "",
  theme = "lite",
}: Props) {
  const { datos: negocio } = useDatosNegocio();

  const [paso, setPaso] = useState<"buscar" | "detalle" | "pago" | "ok">(
    "buscar",
  );
  const [busqueda, setBusqueda] = useState("");
  const [clientes, setClientes] = useState<ClienteCredito[]>([]);
  const [cargandoBusq, setCargandoBusq] = useState(false);

  const [clienteSlc, setClienteSlc] = useState<ClienteCredito | null>(null);
  const [cuenta, setCuenta] = useState<CuentaPorCobrar | null>(null);
  const [facturas, setFacturas] = useState<FacturaCredito[]>([]);
  const [facturaSlc, setFacturaSlc] = useState<string | null>(null); // id o null = abono general
  const [cargandoDet, setCargandoDet] = useState(false);

  const [tipoPago, setTipoPago] = useState<TipoPago>("efectivo");
  const [monto, setMonto] = useState("");
  const [banco, setBanco] = useState("");
  const [referencia, setReferencia] = useState("");
  const [observacion, setObservacion] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resultadoPago, setResultadoPago] = useState<{
    saldoAntes: number;
    saldoDespues: number;
    monto: number;
    cliente: ClienteCredito;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // ──── Reset al abrir ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      resetTodo();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  function resetTodo() {
    setPaso("buscar");
    setBusqueda("");
    setClientes([]);
    setClienteSlc(null);
    setCuenta(null);
    setFacturas([]);
    setFacturaSlc(null);
    setMonto("");
    setBanco("");
    setReferencia("");
    setObservacion("");
    setError(null);
    setProcesando(false);
    setResultadoPago(null);
  }

  // ──── Búsqueda de clientes ────────────────────────────────────
  useEffect(() => {
    if (paso !== "buscar") return;
    const t = setTimeout(() => buscarClientes(busqueda.trim()), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, paso]);

  async function buscarClientes(term: string) {
    setCargandoBusq(true);
    try {
      // ── IDB primero ─────────────────────────────────────────
      const todosIdb = await getAll<ClienteCredito>(STORE.CLIENTES_CREDITO);
      if (todosIdb.length > 0) {
        const t = term.toLowerCase();
        const filtrados = todosIdb.filter(
          (c) =>
            c.activo !== false &&
            (c.nombre?.toLowerCase().includes(t) ||
              c.dni?.toLowerCase().includes(t)),
        );
        filtrados.sort((a, b) => (a.nombre ?? "").localeCompare(b.nombre ?? ""));
        setClientes(filtrados.slice(0, 20));
        setCargandoBusq(false);
        return;
      }

      // ── Fallback Supabase ───────────────────────────────────
      const data = await buscarClientesCredito(term);
      setClientes(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargandoBusq(false);
    }
  }

  async function seleccionarCliente(cli: ClienteCredito) {
    setCargandoDet(true);
    setError(null);
    try {
      // ── IDB primero para cuenta por cobrar ─────────────────
      let cta: CuentaPorCobrar | null = null;
      try {
        const cuentasIdb = await getByIndex<CuentaPorCobrar>(
          STORE.CUENTAS_COBRAR,
          "cliente_id",
          cli.id,
        );
        if (cuentasIdb.length > 0) cta = cuentasIdb[0];
      } catch { /* IDB no disponible */ }

      // ── IDB primero para facturas pendientes ───────────────
      let facs: FacturaCredito[] = [];
      try {
        const facturasIdb = await getAll<any>(STORE.FACTURAS_CREDITO);
        facs = facturasIdb
          .filter(
            (f: any) =>
              f.cliente_id === cli.id &&
              (f.estado === "pendiente" || f.estado === "parcial"),
          )
          .sort(
            (a: any, b: any) =>
              new Date(b.fecha_hora ?? 0).getTime() -
              new Date(a.fecha_hora ?? 0).getTime(),
          )
          .map((row: any) => ({
            ...row,
            productos:
              typeof row.productos === "string"
                ? JSON.parse(row.productos)
                : row.productos,
            total: row.total ?? 0,
            saldo_anterior: row.saldo_anterior ?? 0,
            nuevo_saldo: row.nuevo_saldo ?? 0,
            sub_total: row.sub_total ?? 0,
            isv_15: row.isv_15 ?? 0,
            isv_18: row.isv_18 ?? 0,
          }));
      } catch { /* IDB no disponible */ }

      // ── Fallback Supabase si IDB no tiene datos ─────────────
      if (!cta && navigator.onLine) {
        try {
          cta = await obtenerCuentaCobrar(cli.id);
        } catch { /* sin conexión real */ }
      }
      if (facs.length === 0 && navigator.onLine) {
        try {
          facs = await obtenerFacturasCliente(cli.id, true);
        } catch { /* sin conexión real */ }
      }

      setClienteSlc(cli);
      setCuenta(cta);
      setFacturas(facs);
      setPaso("detalle");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargandoDet(false);
    }
  }

  async function confirmarPago() {
    if (!clienteSlc || !cuenta) return;
    const montoN = parseFloat(monto.replace(",", "."));
    if (!montoN || montoN <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    if (montoN > cuenta.saldo_actual) {
      setError(
        `El monto (L ${montoN.toFixed(2)}) supera el saldo (L ${cuenta.saldo_actual.toFixed(2)}).`,
      );
      return;
    }

    setProcesando(true);
    setError(null);
    try {
      const result = await registrarPagoCredito({
        cliente_id: clienteSlc.id,
        monto: montoN,
        tipo_pago: tipoPago,
        cajero_id: cajeroId,
        cajero,
        caja,
        factura_credito_id: facturaSlc ?? undefined,
        banco: banco || undefined,
        referencia: referencia || undefined,
        observacion: observacion || undefined,
      });

      if (!result.ok)
        throw new Error(result.error ?? "Error al registrar el pago");

      setResultadoPago({
        saldoAntes: result.saldo_antes ?? cuenta.saldo_actual,
        saldoDespues: result.saldo_despues ?? 0,
        monto: montoN,
        cliente: clienteSlc,
      });
      setPaso("ok");
      imprimirComprobante(
        clienteSlc,
        montoN,
        result.saldo_antes ?? 0,
        result.saldo_despues ?? 0,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcesando(false);
    }
  }

  function imprimirComprobante(
    cli: ClienteCredito,
    montoPagado: number,
    saldoAntes: number,
    saldoDespues: number,
  ) {
    const html = `
      <html><head><title>Comprobante de Pago</title>
      <style>
        body { font-family: monospace; width: 80mm; margin: 0 auto; padding: 8px; font-size: 12px; }
        .center { text-align: center; }
        .bold { font-weight: 900; }
        .line { border-bottom: 1px dashed #000; margin: 6px 0; }
        .row { display: flex; justify-content: space-between; margin: 3px 0; }
        h2 { margin: 4px 0; font-size: 15px; }
        h3 { margin: 4px 0; font-size: 13px; }
      </style></head><body>
        <div class="center bold">${negocio?.nombre_negocio ?? "SISTEMA POS"}</div>
        <div class="center">${negocio?.rtn ? "RTN: " + negocio.rtn : ""}</div>
        <div class="center">${negocio?.direccion ?? ""}</div>
        <div class="center">${negocio?.celular ?? ""}</div>
        <div class="line"></div>
        <h2 class="center">COMPROBANTE DE PAGO</h2>
        <h3 class="center">CRÉDITO</h3>
        <div class="line"></div>
        <div class="row"><span>Cliente:</span><span class="bold">${cli.nombre}</span></div>
        <div class="row"><span>DNI:</span><span>${cli.dni}</span></div>
        ${cli.telefono ? `<div class="row"><span>Tel:</span><span>${cli.telefono}</span></div>` : ""}
        <div class="line"></div>
        <div class="row"><span>Saldo anterior:</span><span>L ${saldoAntes.toFixed(2)}</span></div>
        <div class="row bold"><span>PAGO RECIBIDO:</span><span>L ${montoPagado.toFixed(2)}</span></div>
        <div class="row"><span>Saldo actual:</span><span class="bold">L ${saldoDespues.toFixed(2)}</span></div>
        <div class="line"></div>
        <div class="row"><span>Cajero:</span><span>${cajero}</span></div>
        <div class="row"><span>Fecha:</span><span>${new Date().toLocaleString("es-HN")}</span></div>
        <div class="line"></div>
        <div class="center" style="margin-top:10px;">¡Gracias por su pago!</div>
      </body></html>
    `;
    const w = window.open("", "", "height=600,width=300");
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

  if (!isOpen) return null;

  // ──── Colores ────────────────────────────────────────────────
  const bg = theme === "lite" ? "#fff" : "#1e2022";
  const bg2 = theme === "lite" ? "#f8fafc" : "#2a2d2f";
  const border = theme === "lite" ? "#e2e8f0" : "#3a3d3f";
  const text = theme === "lite" ? "#0f172a" : "#f5f5f5";
  const sub = theme === "lite" ? "#64748b" : "#94a3b8";
  const accent = "#16a34a";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 11000,
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: bg,
          borderRadius: 20,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          width: "100%",
          maxWidth: 500,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          color: text,
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            background: `linear-gradient(135deg, ${accent} 0%, #14532d 100%)`,
            padding: "16px 24px",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
            💰 Cobro de Crédito
          </div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.8)",
              marginTop: 2,
            }}
          >
            {paso === "buscar" && "Busque el cliente"}
            {paso === "detalle" && `Cliente: ${clienteSlc?.nombre}`}
            {paso === "pago" && "Registrar abono"}
            {paso === "ok" && "¡Pago registrado!"}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {/* PASO: BUSCAR */}
          {paso === "buscar" && (
            <>
              <input
                ref={inputRef}
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre o DNI del cliente..."
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  border: `1px solid ${border}`,
                  borderRadius: 10,
                  fontSize: 15,
                  background: bg2,
                  color: text,
                  marginBottom: 14,
                  boxSizing: "border-box",
                }}
              />
              {error && (
                <div
                  style={{ color: "#ef4444", fontSize: 13, marginBottom: 10 }}
                >
                  ⚠ {error}
                </div>
              )}
              {cargandoBusq ? (
                <div style={{ textAlign: "center", padding: 24, color: sub }}>
                  Buscando...
                </div>
              ) : clientes.length === 0 ? (
                <div style={{ textAlign: "center", padding: 24, color: sub }}>
                  {busqueda ? "Sin resultados" : "Escriba para buscar"}
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {clientes.map((cli) => (
                    <button
                      key={cli.id}
                      disabled={cargandoDet}
                      onClick={() => seleccionarCliente(cli)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "13px 16px",
                        background: bg2,
                        border: `1px solid ${border}`,
                        borderRadius: 12,
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          background: `linear-gradient(135deg, ${accent}, #14532d)`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                          fontSize: 16,
                          fontWeight: 700,
                        }}
                      >
                        {cli.nombre.charAt(0)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {cli.nombre}
                        </div>
                        <div style={{ fontSize: 12, color: sub }}>
                          {cli.dni}
                        </div>
                      </div>
                      <div
                        style={{
                          marginLeft: "auto",
                          color: accent,
                          fontSize: 18,
                        }}
                      >
                        ›
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* PASO: DETALLE */}
          {paso === "detalle" && clienteSlc && cuenta && (
            <>
              {/* Tarjeta saldo */}
              <div
                style={{
                  background: `linear-gradient(135deg, ${accent}15, ${accent}08)`,
                  border: `1px solid ${accent}40`,
                  borderRadius: 14,
                  padding: "16px 20px",
                  marginBottom: 20,
                }}
              >
                <div style={{ fontSize: 13, color: sub, marginBottom: 4 }}>
                  Saldo pendiente
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, color: accent }}>
                  L {cuenta.saldo_actual.toFixed(2)}
                </div>
                <div style={{ fontSize: 12, color: sub, marginTop: 4 }}>
                  Total facturado: L {cuenta.total_facturado.toFixed(2)} · Total
                  pagado: L {cuenta.total_pagado.toFixed(2)}
                </div>
              </div>

              {/* Facturas pendientes */}
              {facturas.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: sub,
                      marginBottom: 8,
                    }}
                  >
                    Facturas pendientes (opcional - abonar a):
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      marginBottom: 16,
                    }}
                  >
                    <button
                      onClick={() => setFacturaSlc(null)}
                      style={{
                        padding: "10px 14px",
                        border: `2px solid ${facturaSlc === null ? accent : border}`,
                        borderRadius: 10,
                        background: facturaSlc === null ? `${accent}15` : bg2,
                        color: text,
                        cursor: "pointer",
                        textAlign: "left",
                        fontWeight: 600,
                      }}
                    >
                      Abono general al saldo
                    </button>
                    {facturas.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFacturaSlc(f.id)}
                        style={{
                          padding: "10px 14px",
                          border: `2px solid ${facturaSlc === f.id ? accent : border}`,
                          borderRadius: 10,
                          background: facturaSlc === f.id ? `${accent}15` : bg2,
                          color: text,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          Factura #{f.factura_numero}
                        </div>
                        <div style={{ fontSize: 12, color: sub }}>
                          Total: L {f.total.toFixed(2)} · Estado: {f.estado} ·
                          {f.fecha_hora
                            ? new Date(f.fecha_hora).toLocaleDateString("es-HN")
                            : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button
                onClick={() => setPaso("pago")}
                style={{
                  width: "100%",
                  padding: "12px 0",
                  background: `linear-gradient(135deg, ${accent}, #14532d)`,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                Continuar al pago →
              </button>
            </>
          )}

          {/* PASO: PAGO */}
          {paso === "pago" && clienteSlc && cuenta && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Saldo rápido */}
              <div
                style={{
                  background: bg2,
                  borderRadius: 10,
                  padding: "12px 16px",
                  border: `1px solid ${border}`,
                  fontSize: 14,
                }}
              >
                <span style={{ color: sub }}>Saldo actual: </span>
                <strong style={{ color: "#ef4444" }}>
                  L {cuenta.saldo_actual.toFixed(2)}
                </strong>
              </div>

              {/* Tipo de pago */}
              <div>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: sub,
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Tipo de pago
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {TIPOS_PAGO.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setTipoPago(t.value)}
                      style={{
                        padding: "8px 14px",
                        border: `2px solid ${tipoPago === t.value ? accent : border}`,
                        borderRadius: 8,
                        background: tipoPago === t.value ? `${accent}15` : bg2,
                        color: text,
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Monto */}
              <div>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: sub,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Monto a cobrar (L)
                </label>
                <input
                  type="number"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder={`Máx: ${cuenta.saldo_actual.toFixed(2)}`}
                  min={0}
                  max={cuenta.saldo_actual}
                  step={0.01}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    border: `1px solid ${border}`,
                    borderRadius: 10,
                    fontSize: 18,
                    fontWeight: 700,
                    background: bg2,
                    color: text,
                    boxSizing: "border-box",
                  }}
                  autoFocus
                />
                {/* Botones rápidos */}
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginTop: 6,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    onClick={() => setMonto(cuenta.saldo_actual.toFixed(2))}
                    style={{
                      padding: "5px 10px",
                      border: `1px solid ${border}`,
                      borderRadius: 6,
                      background: bg2,
                      color: text,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Total: L {cuenta.saldo_actual.toFixed(2)}
                  </button>
                  {[100, 200, 500, 1000]
                    .filter((v) => v < cuenta.saldo_actual)
                    .map((v) => (
                      <button
                        key={v}
                        onClick={() => setMonto(v.toString())}
                        style={{
                          padding: "5px 10px",
                          border: `1px solid ${border}`,
                          borderRadius: 6,
                          background: bg2,
                          color: text,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        L {v}
                      </button>
                    ))}
                </div>
              </div>

              {/* Banco / Referencia opcional */}
              {(tipoPago === "tarjeta" || tipoPago === "transferencia") && (
                <div style={{ display: "flex", gap: 10 }}>
                  <input
                    type="text"
                    value={banco}
                    onChange={(e) => setBanco(e.target.value)}
                    placeholder="Banco"
                    style={{
                      flex: 1,
                      padding: "9px 12px",
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      fontSize: 13,
                      background: bg2,
                      color: text,
                    }}
                  />
                  <input
                    type="text"
                    value={referencia}
                    onChange={(e) => setReferencia(e.target.value)}
                    placeholder="Referencia"
                    style={{
                      flex: 1,
                      padding: "9px 12px",
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      fontSize: 13,
                      background: bg2,
                      color: text,
                    }}
                  />
                </div>
              )}

              <input
                type="text"
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                placeholder="Observación (opcional)"
                style={{
                  padding: "9px 12px",
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  fontSize: 13,
                  background: bg2,
                  color: text,
                }}
              />

              {error && (
                <div
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fca5a5",
                    borderRadius: 8,
                    padding: "10px 14px",
                    color: "#dc2626",
                    fontSize: 13,
                  }}
                >
                  ⚠ {error}
                </div>
              )}

              <button
                onClick={confirmarPago}
                disabled={procesando || !monto}
                style={{
                  width: "100%",
                  padding: "13px 0",
                  background: procesando
                    ? "#9ca3af"
                    : `linear-gradient(135deg, ${accent}, #14532d)`,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: 16,
                  cursor: procesando ? "not-allowed" : "pointer",
                }}
              >
                {procesando
                  ? "Procesando..."
                  : `✓ Confirmar pago L ${parseFloat(monto || "0").toFixed(2)}`}
              </button>
            </div>
          )}

          {/* PASO: OK */}
          {paso === "ok" && resultadoPago && (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: accent,
                  marginBottom: 4,
                }}
              >
                ¡Pago registrado!
              </div>
              <div style={{ fontSize: 14, color: sub, marginBottom: 20 }}>
                {resultadoPago.cliente.nombre}
              </div>
              <div
                style={{
                  background: bg2,
                  borderRadius: 14,
                  padding: "16px 20px",
                  border: `1px solid ${border}`,
                  marginBottom: 20,
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ color: sub }}>Monto pagado:</span>
                  <strong>L {resultadoPago.monto.toFixed(2)}</strong>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ color: sub }}>Saldo anterior:</span>
                  <span>L {resultadoPago.saldoAntes.toFixed(2)}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: sub }}>Nuevo saldo:</span>
                  <span
                    style={{
                      color:
                        resultadoPago.saldoDespues === 0 ? accent : "#ef4444",
                    }}
                  >
                    L {resultadoPago.saldoDespues.toFixed(2)}
                  </span>
                </div>
              </div>
              <button
                onClick={() =>
                  imprimirComprobante(
                    resultadoPago.cliente,
                    resultadoPago.monto,
                    resultadoPago.saldoAntes,
                    resultadoPago.saldoDespues,
                  )
                }
                style={{
                  width: "100%",
                  padding: "11px 0",
                  background: bg2,
                  border: `1px solid ${border}`,
                  borderRadius: 10,
                  color: text,
                  fontWeight: 600,
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              >
                🖨 Reimprimir comprobante
              </button>
              <button
                onClick={() => {
                  resetTodo();
                }}
                style={{
                  width: "100%",
                  padding: "11px 0",
                  background: accent,
                  border: "none",
                  borderRadius: 10,
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Nuevo cobro
              </button>
            </div>
          )}
        </div>

        {/* Footer botón volver */}
        {paso !== "ok" && (
          <div
            style={{
              padding: "12px 24px",
              borderTop: `1px solid ${border}`,
              flexShrink: 0,
              display: "flex",
              gap: 10,
            }}
          >
            {paso !== "buscar" && (
              <button
                onClick={() => {
                  if (paso === "detalle") setPaso("buscar");
                  if (paso === "pago") setPaso("detalle");
                }}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  background: bg2,
                  border: `1px solid ${border}`,
                  borderRadius: 10,
                  color: text,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ← Volver
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "transparent",
                border: `1px solid ${border}`,
                borderRadius: 10,
                color: sub,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
          </div>
        )}
        {paso === "ok" && (
          <div
            style={{
              padding: "12px 24px",
              borderTop: `1px solid ${border}`,
              flexShrink: 0,
            }}
          >
            <button
              onClick={onClose}
              style={{
                width: "100%",
                padding: "10px 0",
                background: "transparent",
                border: `1px solid ${border}`,
                borderRadius: 10,
                color: sub,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
