import { useEffect, useRef, useState } from "react";
import { NOMBRE_NEGOCIO } from "./empresa";
import PagoModal from "./PagoModal";
import RegistroCierreView from "./RegistroCierreView";
import { supabase } from "./supabaseClient";
import {
  getLocalDayRange,
  formatToHondurasLocal,
  compareTurnoRecordsByRecency,
} from "./utils/fechas";
import { useDatosNegocio } from "./useDatosNegocio";
import {
  inicializarSistemaOffline,
  guardarGastoLocal,
  guardarEnvioLocal,

  // obtenerContadorPendientes,
  sincronizarTodo,
  eliminarEnvioLocal,
  obtenerEnviosPendientes,
  actualizarCacheProductos,
  obtenerProductosCache,
  guardarProductosCache,
  precargarImagenesProductos,
  estaConectado,
  guardarAperturaCache,
  obtenerAperturaCache,
  limpiarAperturaCache,
  obtenerAperturaLocalStorage,
  guardarAperturaLocalStorage,
  limpiarAperturaLocalStorage,
  sincronizarAperturaPendiente,
  guardarCaiCache,
  obtenerCaiCache,
  guardarVentaLocal,
  eliminarVentaLocal,
  obtenerVentasPendientes as _obtenerVentasPendientes,
} from "./utils/offlineSync";
import { migrarPagosDesdeLocalStorage } from "./utils/migrarLocalStorage";
import {
  STORE,
  getAll,
  getByIndex,
  upsertOne,
  deleteById,
  calcularResumenTurno,
  getPrecioDolarLocal,
  getUsuariosLocal,
} from "./utils/localDB";
import { useConexion } from "./utils/useConexion";
import CreditoClienteModal from "./CreditoClienteModal";
import PagoCreditoPOSModal from "./PagoCreditoPOSModal";
import { confirmarVentaCredito } from "./services/creditoService";
import {
  obtenerProveedores,
  crearCuentaPorPagar,
} from "./services/proveedorService";
import type {
  ClienteCredito,
  CuentaPorPagarInput,
  Proveedor,
} from "./types/creditos";
import { cargarPrinterConfig } from "./utils/printerConfig";
import { imprimirReciboUSB, imprimirComandaUSB } from "./utils/webUsbPrinter";
import type { DatosRecibo, DatosComanda } from "./utils/webUsbPrinter";
import {
  DEFAULT_POS_CONFIG,
  obtenerPiezasOpciones,
  obtenerPosConfig,
} from "./services/posConfigService";

interface Producto {
  id: string;
  nombre: string;
  precio: number;
  tipo: "comida" | "bebida" | "complemento";
  tipo_impuesto?: string | number;
  tasa_impuesto?: number;
  imagen?: string;
  subcategoria?: string;
}

interface Seleccion {
  id: string;
  nombre: string;
  precio: number;
  cantidad: number;
  tipo: "comida" | "bebida" | "complemento";
  tipo_impuesto?: string | number;
  tasa_impuesto?: number;
  complementos?: string[]; // Array de selecciones: "CON TODO", "SIN SALSAS", etc.
  piezas?: string; // "PIEZAS VARIAS", "PECHUGA", "ALA, CADERA", etc.
}

type InventarioDiaTipo = "insumos" | "bebidas" | "piezas_pollo";
type InventarioDiaPeriodo = "hoy" | "semana" | "mes";

interface InventarioDiaRow {
  id: string;
  nombre: string;
  vendido: number;
  stock: number;
}

function obtenerTasaImpuesto(
  tipoImpuesto?: string | number | null,
  tipoProducto?: string,
): number {
  if (typeof tipoImpuesto === "number" && Number.isFinite(tipoImpuesto)) {
    if (tipoImpuesto >= 1) return tipoImpuesto / 100;
    return tipoImpuesto;
  }

  const raw = String(tipoImpuesto ?? "")
    .trim()
    .toLowerCase();

  if (
    raw === "isv" ||
    raw === "venta" ||
    raw === "15" ||
    raw === "15%" ||
    raw === "0.15"
  ) {
    return 0.15;
  }
  if (raw === "alcohol" || raw === "18" || raw === "18%" || raw === "0.18") {
    return 0.18;
  }

  const asNum = Number(raw.replace("%", ""));
  if (Number.isFinite(asNum)) {
    if (asNum >= 1) return asNum / 100;
    return asNum;
  }

  if (tipoProducto === "comida") return 0.15;
  if (tipoProducto === "bebida") return 0.18;
  return 0;
}

// use centralized supabase client from src/supabaseClient.ts
// use centralized supabase client from src/supabaseClient.ts
// Obtener usuario actual de localStorage
const usuarioActual = (() => {
  try {
    const stored = localStorage.getItem("usuario");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
})();

export default function PuntoDeVentaView({
  setView,
}: {
  setView?: (
    view:
      | "home"
      | "puntoDeVenta"
      | "admin"
      | "usuarios"
      | "inventario"
      | "cai"
      | "resultados"
      | "gastos"
      | "facturasEmitidas"
      | "apertura"
      | "resultadosCaja"
      | "cajaOperada",
  ) => void;
}) {
  const [showCierre, setShowCierre] = useState(false);
  const [showResumen, setShowResumen] = useState(false);
  const [resumenLoading, setResumenLoading] = useState(false);
  const [sincronizandoCaja, setSincronizandoCaja] = useState(false);
  const [sincronizandoCajaDestino, setSincronizandoCajaDestino] = useState<
    "resumen" | "cierre" | null
  >(null);
  const [resumenData, setResumenData] = useState<{
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    dolares: number;
    dolares_usd?: number;
    dolares_convertidos?: number;
    tasa_dolar?: number;
    gastos: number;
    cambio?: number;
    delivery?: number;
    platillos?: number;
    bebidas?: number;
    platillos_donados?: number;
    bebidas_donadas?: number;
  } | null>(null);

  // Estados para historial de ventas del turno
  const [showHistorialVentas, setShowHistorialVentas] = useState(false);
  const [historialVentas, setHistorialVentas] = useState<any[]>([]);
  const [historialLoading, setHistorialLoading] = useState(false);
  const [historialPagos, setHistorialPagos] = useState<any[]>([]);
  const [historialFiltroTipo, setHistorialFiltroTipo] = useState<string | null>(
    null,
  );
  // Estados para historial de facturas de crédito del turno
  const [showHistorialCreditos, setShowHistorialCreditos] = useState(false);
  const [historialCreditos, setHistorialCreditos] = useState<any[]>([]);
  const [historialCreditosLoading, setHistorialCreditosLoading] =
    useState(false);
  // Menu y modal relacionados
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [showMenuUnlockModal, setShowMenuUnlockModal] = useState(false);
  const [menuUnlockPass, setMenuUnlockPass] = useState("");
  const [menuUnlockError, setMenuUnlockError] = useState("");
  const [showInsumosBebidasDiaModal, setShowInsumosBebidasDiaModal] =
    useState(false);
  const [inventarioDiaTipo, setInventarioDiaTipo] =
    useState<InventarioDiaTipo>("insumos");
  const [inventarioDiaPeriodo, setInventarioDiaPeriodo] =
    useState<InventarioDiaPeriodo>("hoy");
  const [inventarioDiaRows, setInventarioDiaRows] = useState<
    InventarioDiaRow[]
  >([]);
  const [inventarioDiaFecha, setInventarioDiaFecha] = useState("");
  const [inventarioDiaLoading, setInventarioDiaLoading] = useState(false);
  const [showIngresoPiezasModal, setShowIngresoPiezasModal] = useState(false);
  const [ingresoPiezasCantidad, setIngresoPiezasCantidad] = useState("");
  const [ingresoPiezasGuardando, setIngresoPiezasGuardando] = useState(false);
  // Modal DATOS DE FACTURACIÓN
  const [showDatosFactModal, setShowDatosFactModal] = useState(false);
  const [caiFactData, setCaiFactData] = useState<any>(null);
  const [caiFactLoading, setCaiFactLoading] = useState(false);
  // ── Créditos POS ────────────────────────────────────────────────────────────
  const [showCreditoClienteModal, setShowCreditoClienteModal] = useState(false);
  const [showPagoCreditoModal, setShowPagoCreditoModal] = useState(false);

  const [showTipoOrdenModal, setShowTipoOrdenModal] = useState(false);
  const [selectedVentaForComanda, setSelectedVentaForComanda] = useState<
    any | null
  >(null);

  // Control de animación de menú
  const closeMenuAnimated = () => {
    setMenuClosing(true);
    setTimeout(() => {
      setMenuClosing(false);
      setShowOptionsMenu(false);
    }, 340);
  };

  // ── Handler venta a crédito ────────────────────────────────────────────────
  async function handleVentaCredito(
    cliente: ClienteCredito,
    saldoAnterior: number,
  ) {
    if (seleccionados.length === 0) return;

    // Abrir UNA SOLA ventana de impresión para comanda + recibo.
    // El navegador bloquea el segundo window.open() aunque sea síncronoi
    // porque los popups están limitados a uno por gesto de usuario.
    const printWin = window.open("", "_blank", "height=900,width=420");

    const sub_total = seleccionados.reduce(
      (s, p) => s + p.precio * p.cantidad,
      0,
    );
    const total = sub_total;

    const productos = seleccionados.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: p.precio,
      cantidad: p.cantidad,
      tipo: p.tipo,
      tipo_impuesto: String(obtenerTasaImpuesto(p.tipo_impuesto, p.tipo)),
      tasa_impuesto: obtenerTasaImpuesto(p.tipo_impuesto, p.tipo),
    }));

    try {
      // ── Helper: obtener siguiente número libre para este cajero ───────────
      // Las ventas a CRÉDITO siempre usan el correlativo de RECIBO (nunca el
      // correlativo SAR de FACTURA fiscal).  Orden de prioridad:
      //   1. Consultar directamente el CAI de tipo RECIBO (más explícito)
      //   2. RPC obtener_siguiente_factura (prefiere RECIBO si el patch está aplicado)
      //   3. MAX de ventas + 1 (fallback sin RPC)
      const obtenerNumeroLibreCredito = async (): Promise<string | null> => {
        // 1. Primero: buscar CAI tipo RECIBO activo directo en cai_facturas
        try {
          const { data: caiRecibo } = await supabase
            .from("cai_facturas")
            .select("id, factura_actual, rango_desde, rango_hasta")
            .eq("cajero_id", usuarioActual?.id ?? "")
            .eq("activo", true)
            .eq("tipo_comprobante", "RECIBO")
            .maybeSingle();

          if (caiRecibo) {
            const actual = parseInt(caiRecibo.factura_actual || "0");
            const siguiente =
              actual >= caiRecibo.rango_desde
                ? actual + 1
                : caiRecibo.rango_desde;
            if (siguiente <= caiRecibo.rango_hasta) {
              // Verificar que no esté en uso
              const { data: existe } = await supabase
                .from("ventas")
                .select("id")
                .eq("factura", String(siguiente))
                .eq("cajero_id", usuarioActual?.id ?? "")
                .maybeSingle();
              if (!existe) {
                // Actualizar contador en cai_facturas
                await supabase
                  .from("cai_facturas")
                  .update({ factura_actual: String(siguiente + 1) })
                  .eq("id", caiRecibo.id);
                return String(siguiente);
              }
            }
          }
        } catch (_) {
          /* si falla, continuar a fallback */
        }

        // 2. RPC general (prefiere RECIBO cuando el patch está aplicado)
        const { data: rpcNum, error: rpcErr } = await supabase.rpc(
          "obtener_siguiente_factura",
          { p_cajero_id: usuarioActual?.id ?? "" },
        );
        if (!rpcErr && rpcNum && rpcNum !== "LIMITE_ALCANZADO") {
          return rpcNum as string;
        }
        // 3. Fallback: MAX de ventas de este cajero (funciona aunque el RPC no esté desplegado)
        const { data: rows } = await supabase
          .from("ventas")
          .select("factura")
          .eq("cajero_id", usuarioActual?.id ?? "")
          .not("factura", "like", "DEV-%")
          .not("factura", "like", "OFFLINE-%");
        if (rows && rows.length > 0) {
          const maxNum = rows.reduce((max, r) => {
            const n = parseInt(r.factura);
            return Number.isFinite(n) ? Math.max(max, n) : max;
          }, 0);
          if (maxNum > 0) {
            const siguiente = (maxNum + 1).toString();
            // Sincronizar contador en cai_facturas para la próxima vez
            await supabase
              .from("cai_facturas")
              .update({ factura_actual: (maxNum + 2).toString() })
              .eq("cajero_id", usuarioActual?.id ?? "")
              .eq("tipo_comprobante", "RECIBO");
            return siguiente;
          }
        }
        // Si no hay ventas aún, usar rango_desde del CAI tipo RECIBO primero
        const { data: caiRow } = await supabase
          .from("cai_facturas")
          .select("rango_desde")
          .eq("cajero_id", usuarioActual?.id ?? "")
          .eq("activo", true)
          .eq("tipo_comprobante", TIPO_RECIBO)
          .limit(1)
          .maybeSingle();
        if (caiRow?.rango_desde) return String(caiRow.rango_desde);
        // Último recurso: valor del estado local
        return facturaActual && facturaActual !== "Límite alcanzado"
          ? facturaActual
          : null;
      };

      // ── Obtener número de factura fresco ──────────────────────────────────
      let factura_numero = await obtenerNumeroLibreCredito();
      if (!factura_numero) {
        printWin?.close();
        alert("No hay número de factura disponible. Verifica el CAI activo.");
        return;
      }

      // Helper reutilizable para confirmar con un número dado
      const intentarConfirmar = (num: string) =>
        confirmarVentaCredito({
          factura_numero: num,
          cliente_id: cliente.id,
          cajero_id: usuarioActual?.id ?? "",
          cajero: usuarioActual?.nombre ?? "",
          caja: caiInfo?.caja_asignada ?? "",
          cai: caiInfo?.cai ?? "",
          productos,
          sub_total,
          isv_15: 0,
          isv_18: 0,
          total,
          fecha_hora: formatToHondurasLocal(),
          tipo_orden: "PARA LLEVAR",
          dias_vencimiento: 30,
        });

      // ── Intentar confirmar la venta (con retry si factura duplicada) ──────
      let result = await intentarConfirmar(factura_numero);

      // Si hay conflicto de factura duplicada, reintentar hasta 4 veces con fallback MAX.
      if (!result.ok && result.error?.includes("uq_ventas_factura")) {
        for (let intento = 0; intento < 4 && !result.ok; intento++) {
          console.warn(
            `⚠ Factura ${factura_numero} duplicada en crédito. Reintentando (${intento + 1}/4)...`,
          );
          const nuevoNum = await obtenerNumeroLibreCredito();
          if (!nuevoNum) break;
          factura_numero = nuevoNum;
          result = await intentarConfirmar(factura_numero);
        }
      }

      if (!result.ok) {
        alert("Error al registrar venta a crédito: " + result.error);
        return;
      }

      // ── 1. Consultar configuración de etiquetas (igual que venta normal) ──
      const { data: etiquetaConfig } = await supabase
        .from("etiquetas_config")
        .select("*")
        .eq("nombre", "default")
        .single();

      // ── 2. Imprimir COMANDA (cocina) ──────────────────────────────────────
      const comandaHtml = `
        <div style='font-family:monospace; width:${etiquetaConfig?.etiqueta_ancho || 80}mm; margin:0; padding:${etiquetaConfig?.etiqueta_padding || 8}px;'>
          <div style='font-size:${etiquetaConfig?.etiqueta_fontsize || 24}px; font-weight:800; color:#000; text-align:center; margin-bottom:6px;'>${etiquetaConfig?.etiqueta_comanda || "COMANDA COCINA"}</div>
          <div style='font-size:28px; font-weight:900; color:#000; text-align:center; margin:16px 0;'>PARA LLEVAR</div>
          <div style='font-size:20px; font-weight:800; color:#000; text-align:center; margin-bottom:12px;'>Cliente: <b>${cliente.nombre}</b></div>
          <div style='font-size:14px; font-weight:600; color:#222; text-align:center; margin-bottom:6px;'>Factura: ${factura_numero}</div>
          <div style='font-size:13px; font-weight:700; color:#7c3aed; text-align:center; margin-bottom:10px;'>★ VENTA A CRÉDITO ★</div>

          ${
            seleccionados.filter((p) => p.tipo === "comida").length > 0
              ? `
            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>COMIDAS</div>
            <ul style='list-style:none; padding:0; margin-bottom:12px;'>
              ${seleccionados
                .filter((p) => p.tipo === "comida")
                .map(
                  (p) => `
                <li style='font-size:${etiquetaConfig?.etiqueta_fontsize || 20}px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                  <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${p.cantidad}x</div>
                  <div style='font-weight:700;'>${p.nombre}</div>
                  ${p.complementos && p.complementos.length > 0 ? `<div style='font-size:12px; margin-top:6px; font-weight:600; color:#555;'>🍗 Complementos:</div>${p.complementos.map((c) => `<div style='font-size:14px; margin-top:2px; padding-left:8px;'><span style='font-weight:700;'>• ${c}</span></div>`).join("")}` : ""}
                  ${p.piezas && p.piezas !== "PIEZAS VARIAS" ? `<div style='font-size:12px; margin-top:6px; font-weight:600; color:#555;'>🍖 Piezas:</div><div style='font-size:14px; margin-top:2px; padding-left:8px;'><span style='font-weight:700;'>• ${p.piezas}</span></div>` : ""}
                </li>`,
                )
                .join("")}
            </ul>
          `
              : ""
          }

          ${
            seleccionados.filter((p) => p.tipo === "complemento").length > 0
              ? `
            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>COMPLEMENTOS</div>
            <ul style='list-style:none; padding:0; margin-bottom:12px;'>
              ${seleccionados
                .filter((p) => p.tipo === "complemento")
                .map(
                  (p) => `
                <li style='font-size:${etiquetaConfig?.etiqueta_fontsize || 20}px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                  <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${p.cantidad}x</div>
                  <div style='font-weight:700;'>${p.nombre}</div>
                </li>`,
                )
                .join("")}
            </ul>
          `
              : ""
          }

          ${
            seleccionados.filter((p) => p.tipo === "bebida").length > 0
              ? `
            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>BEBIDAS</div>
            <ul style='list-style:none; padding:0; margin-bottom:0;'>
              ${seleccionados
                .filter((p) => p.tipo === "bebida")
                .map(
                  (p) => `
                <li style='font-size:${etiquetaConfig?.etiqueta_fontsize || 20}px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                  <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${p.cantidad}x</div>
                  <div style='font-weight:700;'>${p.nombre}</div>
                </li>`,
                )
                .join("")}
            </ul>
          `
              : ""
          }
        </div>`;

      // ── 3. Recibo de crédito (para el cliente) ───────────────────────────
      const filasProductos = seleccionados
        .map(
          (p) => `<tr>
          <td>${p.nombre}</td>
          <td style='text-align:center'>${p.cantidad}</td>
          <td style='text-align:right'>L ${(p.precio * p.cantidad).toFixed(2)}</td>
        </tr>`,
        )
        .join("");

      const reciboHtml = `<div style='font-family:monospace;font-size:12px;max-width:320px;margin:0 auto;padding:12px;'>
        <div style='text-align:center;font-weight:700;font-size:15px'>VENTA A CRÉDITO</div>
        <div style='border-top:1px dashed #333;margin:6px 0'></div>
        <div>Cliente: <strong>${cliente.nombre}</strong></div>
        <div>DNI: ${cliente.dni ?? "—"}</div>
        <div>Factura: ${factura_numero}</div>
        <div>Cajero: ${usuarioActual?.nombre ?? ""}</div>
        <div>Caja: ${caiInfo?.caja_asignada ?? ""}</div>
        <div>Fecha: ${new Date().toLocaleString("es-HN")}</div>
        <div style='border-top:1px dashed #333;margin:6px 0'></div>
        <table style='width:100%;border-collapse:collapse;'>
          <thead><tr>
            <th style='text-align:left'>Producto</th>
            <th style='text-align:center'>Cant</th>
            <th style='text-align:right'>Total</th>
          </tr></thead>
          <tbody>${filasProductos}</tbody>
        </table>
        <div style='border-top:1px dashed #333;margin:6px 0'></div>
        <div>Saldo anterior: L ${saldoAnterior.toFixed(2)}</div>
        <div>Esta venta: <strong>L ${total.toFixed(2)}</strong></div>
        <div style='font-size:15px;font-weight:900'>Nuevo saldo: L ${(saldoAnterior + total).toFixed(2)}</div>
        <div style='border-top:1px dashed #333;margin:6px 0'></div>
        <div style='text-align:center;font-size:10px;margin-top:8px'>— Pendiente de cobro —</div>
      </div>`;

      // ── 4. Imprimir comanda + recibo en una sola ventana (popup único) ────
      if (printWin) {
        printWin.document.write(
          `<html><head><title>Crédito ${factura_numero}</title><style>
            @page{margin:0;size:auto;}
            body{margin:0;padding:0;}
            .pagina{page-break-after:always;}
            .ultima{page-break-after:avoid;}
          </style></head><body>
            <div class='pagina'>${comandaHtml}</div>
            <div class='ultima'>${reciboHtml}</div>
          </body></html>`,
        );
        printWin.document.close();
        setTimeout(() => {
          printWin.focus();
          printWin.print();
          printWin.close();
        }, 500);
      }

      // ── Incrementar contador de factura (igual que venta normal) ─────────
      const numUsado = parseInt(factura_numero);
      if (Number.isFinite(numUsado)) {
        const nuevaFactura = (numUsado + 1).toString();
        try {
          await persistirReciboActual(nuevaFactura, {
            actualizarSupabase: Boolean(usuarioActual?.id),
          });
        } catch (err) {
          console.error(
            "Error actualizando factura_actual tras venta a crédito:",
            err,
          );
        }
      }

      setSeleccionados([]);
      setDescuentosProductos(new Set());
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  }

  // Función para obtener resumen de caja del día (EFECTIVO/TARJETA/TRANSFERENCIA)
  async function fetchResumenCaja() {
    setShowResumen(true);
    setResumenLoading(true);
    try {
      if (!navigator.onLine) {
        alert(
          "Se necesita conexión para abrir Resumen de Caja porque ahora usa únicamente datos de Supabase.",
        );
        setShowResumen(false);
        return;
      }

      if (!usuarioActual?.id) {
        alert("No se pudo identificar el usuario actual.");
        setShowResumen(false);
        return;
      }

      const { data: aperturaSupabase, error: aperturaError } = await supabase
        .from("cierres")
        .select("id,cajero_id,caja,fecha,fecha_apertura,fecha_cierre,estado")
        .eq("cajero_id", usuarioActual.id)
        .eq("estado", "APERTURA")
        .order("fecha_apertura", { ascending: false })
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (aperturaError) throw aperturaError;

      if (!aperturaSupabase) {
        alert("No hay apertura activa en Supabase para este cajero.");
        setShowResumen(false);
        return;
      }

      const fechaInicio =
        aperturaSupabase.fecha_apertura ?? aperturaSupabase.fecha ?? "";
      const fechaFin =
        aperturaSupabase.fecha_cierre ?? new Date().toISOString();
      const tsInicio = new Date(fechaInicio).getTime();
      const tsFin = new Date(fechaFin).getTime();

      let ventasQuery = supabase
        .from("ventas")
        .select(
          "fecha_hora,tipo,es_donacion,productos,efectivo,tarjeta,transferencia,dolares,dolares_usd,cambio,delivery,total,caja",
        )
        .eq("cajero_id", usuarioActual.id)
        .gte("fecha_hora", fechaInicio)
        .lte("fecha_hora", fechaFin)
        .neq("tipo", "CREDITO");

      if (aperturaSupabase.caja) {
        ventasQuery = ventasQuery.eq("caja", aperturaSupabase.caja);
      }

      const { data: ventasData, error: ventasError } = await ventasQuery;
      if (ventasError) throw ventasError;

      let gastosQuery = supabase
        .from("gastos")
        .select("monto,fecha,fecha_hora,caja")
        .eq("cajero_id", usuarioActual.id);

      if (aperturaSupabase.caja) {
        gastosQuery = gastosQuery.eq("caja", aperturaSupabase.caja);
      }

      const { data: gastosData, error: gastosError } = await gastosQuery;
      if (gastosError) throw gastosError;

      const parseTs = (fechaHora?: string | null, fecha?: string | null) => {
        const raw =
          (fechaHora && fechaHora.trim()) ||
          (fecha && `${fecha}T00:00:00`) ||
          "";
        const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
        const ts = Date.parse(normalized);
        return Number.isFinite(ts) ? ts : 0;
      };

      const ventasTurno = (ventasData || []).filter((v: any) => {
        const ts = parseTs(v.fecha_hora, null);
        return ts >= tsInicio && ts <= tsFin;
      });

      const ventasNormales = ventasTurno.filter(
        (v: any) => v.es_donacion !== true,
      );
      const donaciones = ventasTurno.filter((v: any) => v.es_donacion === true);

      const gastosTurno = (gastosData || []).filter((g: any) => {
        const ts = parseTs(g.fecha_hora, g.fecha);
        return ts >= tsInicio && ts <= tsFin;
      });

      const sumar = (arr: any[], campo: string) =>
        arr.reduce((acc, row) => acc + parseFloat(row?.[campo] ?? 0), 0);

      const contarTipo = (arr: any[], tipo: string) => {
        let count = 0;
        arr.forEach((venta) => {
          const factor = venta.tipo === "DEVOLUCION" ? -1 : 1;
          try {
            const productos =
              typeof venta.productos === "string"
                ? JSON.parse(venta.productos)
                : (venta.productos ?? []);
            productos.forEach((producto: any) => {
              if ((producto.tipo ?? "").toLowerCase() === tipo.toLowerCase()) {
                count +=
                  factor * parseInt(producto.cantidad ?? producto.qty ?? 1);
              }
            });
          } catch {
            // Ignorar ventas con JSON inválido
          }
        });
        return count;
      };

      const efectivoBruto = sumar(ventasNormales as any[], "efectivo");
      const cambioTotal = sumar(ventasNormales as any[], "cambio");
      const gastosTotal = gastosTurno.reduce(
        (acc: number, gasto: any) => acc + parseFloat(gasto.monto ?? 0),
        0,
      );
      const dolaresUsd = sumar(ventasNormales as any[], "dolares_usd");

      const { data: precioData, error: precioError } = await supabase
        .from("precio_dolar")
        .select("valor")
        .eq("id", "singleton")
        .limit(1)
        .maybeSingle();

      if (precioError) throw precioError;

      const tasaDolar = Number(precioData?.valor) || 0;
      const dolaresConvertidos = Number((dolaresUsd * tasaDolar).toFixed(2));

      setResumenData({
        efectivo: Number((efectivoBruto - cambioTotal).toFixed(2)),
        tarjeta: Number(sumar(ventasNormales as any[], "tarjeta").toFixed(2)),
        transferencia: Number(
          sumar(ventasNormales as any[], "transferencia").toFixed(2),
        ),
        dolares: Number(sumar(ventasNormales as any[], "dolares").toFixed(2)),
        dolares_usd: Number(dolaresUsd.toFixed(2)),
        dolares_convertidos: dolaresConvertidos,
        tasa_dolar: tasaDolar,
        gastos: Number(gastosTotal.toFixed(2)),
        cambio: Number(cambioTotal.toFixed(2)),
        delivery: Number(sumar(ventasTurno as any[], "delivery").toFixed(2)),
        platillos: contarTipo(ventasNormales as any[], "comida"),
        bebidas: contarTipo(ventasNormales as any[], "bebida"),
        platillos_donados: contarTipo(donaciones as any[], "comida"),
        bebidas_donadas: contarTipo(donaciones as any[], "bebida"),
      });
    } catch (err) {
      console.error("Error al obtener resumen de caja:", err);
      setResumenData({
        efectivo: 0,
        tarjeta: 0,
        transferencia: 0,
        dolares: 0,
        gastos: 0,
      });
    } finally {
      setResumenLoading(false);
    }
  }

  const esperar = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function prepararDatosCaja(
    destino: "resumen" | "cierre",
  ): Promise<boolean> {
    if (!navigator.onLine) {
      setShowNoConnectionModal(true);
      return false;
    }

    if (!usuarioActual?.id) {
      alert("No se pudo identificar el usuario actual.");
      return false;
    }

    setSincronizandoCajaDestino(destino);
    setSincronizandoCaja(true);

    try {
      await Promise.all([
        (async () => {
          await sincronizarAperturaPendiente();
          await sincronizarTodo();
        })(),
        esperar(5000),
      ]);
      return true;
    } catch (error) {
      console.error("Error sincronizando datos antes de abrir caja:", error);
      alert(
        "No se pudo completar la sincronización con el servidor. Intenta nuevamente.",
      );
      return false;
    } finally {
      setSincronizandoCaja(false);
      setSincronizandoCajaDestino(null);
    }
  }

  async function abrirResumenCaja() {
    const listo = await prepararDatosCaja("resumen");
    if (!listo) return;
    await fetchResumenCaja();
  }

  async function abrirCierreCaja() {
    const listo = await prepararDatosCaja("cierre");
    if (!listo) return;
    setShowCierre(true);
  }

  // Función para obtener historial de ventas del turno actual
  async function fetchHistorialVentas() {
    setShowHistorialVentas(true);
    setHistorialLoading(true);
    try {
      const toTs = (value: any): number => {
        if (!value) return 0;
        if (typeof value === "number") return value;
        const raw = String(value).trim();
        const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
        const ts = Date.parse(normalized);
        return Number.isFinite(ts) ? ts : 0;
      };

      // ── IDB primero (siempre, sin depender de navigator.onLine) ──────────
      {
        const cierresIDB = await getByIndex<any>(
          STORE.CIERRES,
          "cajero_id",
          usuarioActual?.id,
        );
        let aperturaIDB: any =
          cierresIDB
            .filter((c) => c.estado === "APERTURA")
            .sort(
              (a, b) =>
                new Date(b.fecha ?? 0).getTime() -
                new Date(a.fecha ?? 0).getTime(),
            )[0] ?? null;
        if (!aperturaIDB) {
          const lsAp = obtenerAperturaLocalStorage();
          // Aceptar apertura de localStorage aunque usuarioActual sea null (race condition tras F5)
          const lsMatch =
            lsAp && (!usuarioActual?.id || lsAp.cajero_id === usuarioActual.id)
              ? lsAp
              : null;
          const cachedAp =
            lsMatch ??
            (await obtenerAperturaCache()
              .then((c) =>
                c && (!usuarioActual?.id || c.cajero_id === usuarioActual.id)
                  ? c
                  : null,
              )
              .catch(() => null));
          if (cachedAp) {
            const numId =
              parseInt(cachedAp.id as string) > 0
                ? parseInt(cachedAp.id as string)
                : -Date.now();
            aperturaIDB = {
              id: numId,
              cajero_id: cachedAp.cajero_id,
              cajero: (cachedAp as any).cajero || "",
              caja: cachedAp.caja,
              fecha: cachedAp.fecha,
              estado: "APERTURA",
            };
            await upsertOne(STORE.CIERRES, aperturaIDB);
          }
        }
        if (aperturaIDB) {
          const cajeroIdFinal = aperturaIDB.cajero_id ?? usuarioActual?.id;
          const tsAp = toTs(aperturaIDB.fecha);
          const todasVentas = cajeroIdFinal
            ? await getByIndex<any>(STORE.VENTAS, "cajero_id", cajeroIdFinal)
            : await getAll<any>(STORE.VENTAS);
          const ventasTurno = todasVentas
            .filter((v) => {
              const ts = toTs(v.fecha_hora);
              return ts >= tsAp && v.tipo !== "CREDITO";
            })
            .sort((a, b) => toTs(b.fecha_hora) - toTs(a.fecha_hora));
          setHistorialVentas(ventasTurno);
          // Normalizar pagos desde IDB
          const pagosNorm: any[] = [];
          for (const v of ventasTurno) {
            if (parseFloat(v.efectivo || 0) > 0)
              pagosNorm.push({
                tipo: "efectivo",
                monto: v.efectivo,
                usd_monto: 0,
                factura: v.factura,
                factura_venta: v.factura,
              });
            if (parseFloat(v.tarjeta || 0) > 0)
              pagosNorm.push({
                tipo: "tarjeta",
                monto: v.tarjeta,
                usd_monto: 0,
                factura: v.factura,
                factura_venta: v.factura,
              });
            if (parseFloat(v.transferencia || 0) > 0)
              pagosNorm.push({
                tipo: "transferencia",
                monto: v.transferencia,
                usd_monto: 0,
                factura: v.factura,
                factura_venta: v.factura,
              });
            if (parseFloat(v.dolares || 0) > 0)
              pagosNorm.push({
                tipo: "dolares",
                monto: v.dolares,
                usd_monto: v.dolares_usd,
                factura: v.factura,
                factura_venta: v.factura,
              });
          }
          setHistorialPagos(pagosNorm);
          setHistorialFiltroTipo(null);
          setHistorialLoading(false);
          return;
        } // end if(aperturaIDB)
      }

      // ── ONLINE: Supabase ─────────────────────────────────────────
      const { end: dayEnd } = getLocalDayRange();
      let cajaAsignada = caiInfo?.caja_asignada;
      if (!cajaAsignada) {
        const { data: caiData } = await supabase
          .from("cai_facturas")
          .select("caja_asignada")
          .eq("cajero_id", usuarioActual?.id)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        cajaAsignada = caiData?.caja_asignada || "";
      }
      const { data: aperturaActual, error: errorApertura } = await supabase
        .from("cierres")
        .select("fecha, estado")
        .eq("cajero_id", usuarioActual?.id)
        .eq("caja", cajaAsignada)
        .eq("estado", "APERTURA")
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!aperturaActual) {
        // Si hubo error de red (offline), intentar localStorage como último recurso
        if (errorApertura || !navigator.onLine) {
          const lsAp = obtenerAperturaLocalStorage();
          if (
            lsAp &&
            (!usuarioActual?.id || lsAp.cajero_id === usuarioActual.id)
          ) {
            const tsAp = toTs(lsAp.fecha);
            const cajeroIdFinal = lsAp.cajero_id ?? usuarioActual?.id;
            const todasVentas = cajeroIdFinal
              ? await getByIndex<any>(STORE.VENTAS, "cajero_id", cajeroIdFinal)
              : await getAll<any>(STORE.VENTAS);
            const ventasTurno = todasVentas
              .filter((v) => {
                const ts = toTs(v.fecha_hora);
                return ts >= tsAp && v.tipo !== "CREDITO";
              })
              .sort((a, b) => toTs(b.fecha_hora) - toTs(a.fecha_hora));
            setHistorialVentas(ventasTurno);
            setHistorialPagos([]);
            setHistorialFiltroTipo(null);
            setHistorialLoading(false);
            return;
          }
        }
        setHistorialLoading(false);
        alert("No hay apertura de caja registrada.");
        setShowHistorialVentas(false);
        return;
      }
      const { data: ventas, error } = await supabase
        .from("ventas")
        .select("*")
        .eq("cajero_id", usuarioActual?.id)
        .neq("tipo", "CREDITO")
        .gte("fecha_hora", aperturaActual.fecha)
        .lte("fecha_hora", dayEnd)
        .order("fecha_hora", { ascending: false });

      if (error) throw error;
      setHistorialVentas(ventas || []);
      // Normalizar datos de pago desde ventas (una fila ya incluye todo)
      const pagosNorm: any[] = [];
      for (const v of ventas || []) {
        if (parseFloat(v.efectivo || 0) > 0)
          pagosNorm.push({
            tipo: "efectivo",
            monto: v.efectivo,
            usd_monto: 0,
            factura: v.factura,
            factura_venta: v.factura,
          });
        if (parseFloat(v.tarjeta || 0) > 0)
          pagosNorm.push({
            tipo: "tarjeta",
            monto: v.tarjeta,
            usd_monto: 0,
            factura: v.factura,
            factura_venta: v.factura,
          });
        if (parseFloat(v.transferencia || 0) > 0)
          pagosNorm.push({
            tipo: "transferencia",
            monto: v.transferencia,
            usd_monto: 0,
            factura: v.factura,
            factura_venta: v.factura,
          });
        if (parseFloat(v.dolares || 0) > 0)
          pagosNorm.push({
            tipo: "dolares",
            monto: v.dolares,
            usd_monto: v.dolares_usd,
            factura: v.factura,
            factura_venta: v.factura,
          });
      }
      setHistorialPagos(pagosNorm);
      setHistorialFiltroTipo(null);
    } catch (err) {
      console.error("Error cargando historial:", err);
      alert("Error al cargar historial de ventas");
    } finally {
      setHistorialLoading(false);
    }
  }

  async function cargarInsumosBebidasDelDia(
    tipo: InventarioDiaTipo,
    periodo: InventarioDiaPeriodo = "hoy",
  ) {
    setInventarioDiaTipo(tipo);
    setInventarioDiaPeriodo(periodo);
    setInventarioDiaLoading(true);
    try {
      const toTs = (value: any): number => {
        if (!value) return 0;
        if (typeof value === "number") return value;
        const raw = String(value).trim();
        const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
        const ts = Date.parse(normalized);
        return Number.isFinite(ts) ? ts : 0;
      };
      const num = (v: any): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const normalizeMovType = (value: any): string =>
        String(value || "")
          .toLowerCase()
          .trim()
          .replace(/[\s-]+/g, "_");
      const normalizeText = (value: string): string =>
        String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const isEntrada = (movType: any): boolean => {
        const t = normalizeMovType(movType);
        return [
          "entrada",
          "compra",
          "ajuste_positivo",
          "produccion_entrada",
        ].includes(t);
      };
      const isSalida = (movType: any): boolean => {
        const t = normalizeMovType(movType);
        return [
          "salida",
          "venta",
          "ajuste_negativo",
          "produccion_salida",
        ].includes(t);
      };

      const formatDay = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      };

      const getRange = (selected: InventarioDiaPeriodo) => {
        if (selected === "hoy") {
          const { start, end, day } = getLocalDayRange();
          return { start, end, etiqueta: day };
        }

        const now = new Date();
        if (selected === "semana") {
          const monday = new Date(now);
          monday.setHours(0, 0, 0, 0);
          const day = monday.getDay();
          const diff = day === 0 ? -6 : 1 - day;
          monday.setDate(monday.getDate() + diff);
          const start = `${formatDay(monday)} 00:00:00`;
          const end = `${formatDay(now)} 23:59:59`;
          return {
            start,
            end,
            etiqueta: `${formatDay(monday)} a ${formatDay(now)}`,
          };
        }

        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const start = `${formatDay(firstDay)} 00:00:00`;
        const end = `${formatDay(now)} 23:59:59`;
        return {
          start,
          end,
          etiqueta: `${formatDay(firstDay)} a ${formatDay(now)}`,
        };
      };

      const { start, end, etiqueta } = getRange(periodo);
      const tsStart = Date.parse(start);
      const tsEnd = Date.parse(end);
      setInventarioDiaFecha(etiqueta);

      let movimientosIdb: any[] = [];
      let productosIdb: any[] = [];
      let insumosIdb: any[] = [];

      try {
        movimientosIdb = await getAll<any>(STORE.MOVIMIENTOS_INVENTARIO);
        if (tipo === "bebidas") {
          productosIdb = await getAll<any>(STORE.PRODUCTOS);
        } else {
          insumosIdb = await getAll<any>(STORE.INSUMOS);
        }
      } catch {
        movimientosIdb = [];
      }

      const necesitaFallbackMovs = movimientosIdb.length === 0;
      const necesitaFallbackCatalogo =
        tipo === "bebidas"
          ? productosIdb.length === 0
          : insumosIdb.length === 0;

      let movimientos = movimientosIdb;
      let productos = productosIdb;
      let insumos = insumosIdb;

      if (necesitaFallbackMovs || necesitaFallbackCatalogo) {
        try {
          if (necesitaFallbackMovs) {
            const { data: movsData } = await supabase
              .from("movimientos_inventario")
              .select(
                "id, item_tipo, insumo_id, producto_id, tipo, cantidad, fecha_hora, created_at",
              )
              .order("id", { ascending: false })
              .limit(3500);
            if (movsData?.length) movimientos = movsData;
          }

          if (tipo === "bebidas" && productos.length === 0) {
            const { data: prodsData } = await supabase
              .from("productos")
              .select("id, nombre, tipo")
              .eq("tipo", "bebida");
            if (prodsData?.length) productos = prodsData;
          }

          if (tipo !== "bebidas" && insumos.length === 0) {
            const { data: insData } = await supabase
              .from("insumos")
              .select("id, nombre, stock_actual");
            if (insData?.length) insumos = insData;
          }
        } catch {
          // Si Supabase falla, conservar datos locales disponibles
        }
      }

      const movimientosRango = (movimientos || []).filter((m: any) => {
        const ts = toTs(m.fecha_hora || m.created_at);
        return ts >= tsStart && ts <= tsEnd;
      });

      if (tipo === "bebidas") {
        const bebidas = (productos || []).filter(
          (p: any) => p.tipo === "bebida",
        );
        const nombrePorId = new Map<string, string>(
          bebidas.map((p: any) => [String(p.id), String(p.nombre || "Bebida")]),
        );

        const salidasPorId = new Map<string, number>();
        const entradasPorId = new Map<string, number>();
        for (const m of movimientosRango) {
          if (String(m.item_tipo) !== "producto") continue;
          const productoId = String(m.producto_id || "");
          if (!productoId) continue;
          if (!nombrePorId.has(productoId)) continue;
          if (isSalida(m.tipo)) {
            salidasPorId.set(
              productoId,
              num(salidasPorId.get(productoId)) + num(m.cantidad),
            );
            continue;
          }
          if (isEntrada(m.tipo)) {
            entradasPorId.set(
              productoId,
              num(entradasPorId.get(productoId)) + num(m.cantidad),
            );
          }
        }

        const rows: InventarioDiaRow[] = Array.from(salidasPorId.entries())
          .map(([id, vendido]) => ({
            id,
            nombre: nombrePorId.get(id) || "Bebida",
            vendido,
            stock: num(entradasPorId.get(id)) - vendido,
          }))
          .sort(
            (a, b) => b.vendido - a.vendido || a.nombre.localeCompare(b.nombre),
          );

        setInventarioDiaRows(rows);
        return;
      }

      const nombrePorId = new Map<string, string>(
        (insumos || []).map((ins: any) => [
          String(ins.id),
          String(ins.nombre || "Insumo"),
        ]),
      );

      const salidasPorId = new Map<string, number>();
      const entradasPorId = new Map<string, number>();
      for (const m of movimientosRango) {
        if (String(m.item_tipo) !== "insumo") continue;
        const insumoId = String(m.insumo_id || "");
        if (!insumoId) continue;
        if (isSalida(m.tipo)) {
          salidasPorId.set(
            insumoId,
            num(salidasPorId.get(insumoId)) + num(m.cantidad),
          );
          continue;
        }
        if (isEntrada(m.tipo)) {
          entradasPorId.set(
            insumoId,
            num(entradasPorId.get(insumoId)) + num(m.cantidad),
          );
        }
      }

      if (tipo === "piezas_pollo") {
        const piezas = (insumos || []).find(
          (ins: any) => normalizeText(ins.nombre) === "piezas de pollo",
        );

        if (!piezas) {
          setInventarioDiaRows([]);
          return;
        }

        const id = String(piezas.id);
        setInventarioDiaRows([
          {
            id,
            nombre: String(piezas.nombre || "Piezas de pollo"),
            vendido: num(salidasPorId.get(id)),
            stock: num(entradasPorId.get(id)) - num(salidasPorId.get(id)),
          },
        ]);
        return;
      }

      const rows: InventarioDiaRow[] = Array.from(salidasPorId.entries())
        .map(([id, vendido]) => ({
          id,
          nombre: nombrePorId.get(id) || "Insumo",
          vendido,
          stock: num(entradasPorId.get(id)) - vendido,
        }))
        .sort(
          (a, b) => b.vendido - a.vendido || a.nombre.localeCompare(b.nombre),
        );

      setInventarioDiaRows(rows);
    } catch (err) {
      console.error("[InventarioDia] Error cargando lista:", err);
      setInventarioDiaRows([]);
      alert("No se pudo cargar la lista.");
    } finally {
      setInventarioDiaLoading(false);
    }
  }

  function imprimirListaInsumosBebidasDia() {
    if (inventarioDiaRows.length === 0) {
      alert("No hay datos para imprimir.");
      return;
    }

    const baseTitulo =
      inventarioDiaTipo === "insumos"
        ? "INSUMOS"
        : inventarioDiaTipo === "bebidas"
          ? "BEBIDAS"
          : "PIEZAS DE POLLO";
    const etiquetaPeriodo =
      inventarioDiaPeriodo === "hoy"
        ? "HOY"
        : inventarioDiaPeriodo === "semana"
          ? "SEMANA"
          : "MES";
    const titulo = `${baseTitulo} - ${etiquetaPeriodo}`;
    const negocio = datosNegocio?.nombre_negocio || NOMBRE_NEGOCIO;

    const filas = inventarioDiaRows
      .map(
        (r) => `
          <tr>
            <td style="padding:6px 4px;border-bottom:1px dashed #ddd;">${r.nombre}</td>
            <td style="padding:6px 4px;border-bottom:1px dashed #ddd;text-align:right;">${r.vendido.toFixed(2)}</td>
            <td style="padding:6px 4px;border-bottom:1px dashed #ddd;text-align:right;">${r.stock.toFixed(2)}</td>
          </tr>
        `,
      )
      .join("");

    const html = `
      <html>
        <head>
          <title>${titulo}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: 'Courier New', monospace; margin: 0; color: #000; }
            .t { text-align: center; font-weight: 700; font-size: 14px; }
            .s { text-align: center; font-size: 11px; margin-bottom: 8px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th { text-align: left; border-bottom: 1px solid #000; padding: 4px; }
            th.r { text-align: right; }
            .f { margin-top: 8px; font-size: 10px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="t">${negocio}</div>
          <div class="s">${titulo}<br/>Fecha: ${inventarioDiaFecha || new Date().toISOString().slice(0, 10)}</div>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th class="r">Vendido</th>
                <th class="r">Stock (E-S)</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
          <div class="f">Registros: ${inventarioDiaRows.length}</div>
        </body>
      </html>
    `;

    const pw = window.open("", "", "height=800,width=420");
    if (!pw) {
      alert("Activa las ventanas emergentes para imprimir.");
      return;
    }
    pw.document.write(html);
    pw.document.close();
    setTimeout(() => {
      try {
        pw.focus();
        pw.print();
      } catch {
        // no-op
      }
    }, 250);
  }

  // Función para obtener historial de facturas de crédito del turno actual
  async function fetchHistorialCreditos() {
    setShowHistorialCreditos(true);
    setHistorialCreditosLoading(true);
    try {
      // ── IDB primero (siempre, sin depender de navigator.onLine) ──────────
      {
        const cierresIDB = await getByIndex<any>(
          STORE.CIERRES,
          "cajero_id",
          usuarioActual?.id,
        );
        let aperturaIDB: any =
          cierresIDB
            .filter((c) => c.estado === "APERTURA")
            .sort(
              (a, b) =>
                new Date(b.fecha ?? 0).getTime() -
                new Date(a.fecha ?? 0).getTime(),
            )[0] ?? null;

        // Fallback: rescatar desde localStorage / apertura_cache
        if (!aperturaIDB) {
          const lsAp = obtenerAperturaLocalStorage();
          const cachedAp =
            lsAp?.cajero_id === usuarioActual?.id
              ? lsAp
              : await obtenerAperturaCache()
                  .then((c) => (c?.cajero_id === usuarioActual?.id ? c : null))
                  .catch(() => null);
          if (cachedAp) {
            const numId =
              parseInt(cachedAp.id as string) > 0
                ? parseInt(cachedAp.id as string)
                : -Date.now();
            aperturaIDB = {
              id: numId,
              cajero_id: cachedAp.cajero_id,
              cajero: (cachedAp as any).cajero || "",
              caja: cachedAp.caja,
              fecha: cachedAp.fecha,
              estado: "APERTURA",
            };
            await upsertOne(STORE.CIERRES, aperturaIDB);
          }
        }

        if (aperturaIDB) {
          const tsAp = new Date(aperturaIDB.fecha ?? 0).getTime();
          const todasFacturasCredito = await getAll<any>(
            STORE.FACTURAS_CREDITO,
          );
          const clientesIDB = await getAll<any>(STORE.CLIENTES_CREDITO);

          const creditosIDB = todasFacturasCredito
            .filter((fc) => {
              if (fc.cajero_id !== usuarioActual?.id) return false;
              const ts = new Date(fc.fecha_hora ?? 0).getTime();
              return ts >= tsAp;
            })
            .sort(
              (a, b) =>
                new Date(b.fecha_hora ?? 0).getTime() -
                new Date(a.fecha_hora ?? 0).getTime(),
            )
            .map((fc) => {
              const cliente = clientesIDB.find((c) => c.id === fc.cliente_id);
              return {
                ...fc,
                clientes_credito: cliente
                  ? {
                      nombre: cliente.nombre,
                      dni: cliente.dni,
                      telefono: cliente.telefono,
                    }
                  : null,
              };
            });

          setHistorialCreditos(creditosIDB);
          return;
        }
        // aperturaIDB no encontrada → caer al bloque Supabase abajo
      }

      // ── MODO ONLINE: Supabase ─────────────────────────────────────────────
      // Extender hasta el fin del día siguiente para capturar registros
      // que pudieron haberse guardado con hora UTC (desfase +1 día)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const { end: dayEnd } = getLocalDayRange(tomorrow);
      let cajaAsignada = caiInfo?.caja_asignada;
      if (!cajaAsignada) {
        const { data: caiData } = await supabase
          .from("cai_facturas")
          .select("caja_asignada")
          .eq("cajero_id", usuarioActual?.id)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        cajaAsignada = caiData?.caja_asignada || "";
      }
      const { data: aperturaActual } = await supabase
        .from("cierres")
        .select("fecha, estado")
        .eq("cajero_id", usuarioActual?.id)
        .eq("caja", cajaAsignada)
        .eq("estado", "APERTURA")
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!aperturaActual) {
        setHistorialCreditosLoading(false);
        alert("No hay apertura de caja registrada.");
        setShowHistorialCreditos(false);
        return;
      }
      const { data: creditosData, error } = await supabase
        .from("facturas_credito")
        .select("*, clientes_credito(nombre, dni, telefono)")
        .eq("cajero_id", usuarioActual?.id)
        .gte("fecha_hora", aperturaActual.fecha)
        .lte("fecha_hora", dayEnd)
        .order("fecha_hora", { ascending: false });
      if (error) throw error;
      setHistorialCreditos(creditosData || []);
    } catch (err) {
      console.error("Error cargando historial de créditos:", err);
      alert("Error al cargar historial de créditos");
    } finally {
      setHistorialCreditosLoading(false);
    }
  }

  // Reimprimir factura de crédito del historial
  async function imprimirFacturaCreditoHistorial(fc: any) {
    try {
      const { data: reciboConfig } = await supabase
        .from("recibo_config")
        .select("*")
        .eq("nombre", "default")
        .single();

      const prods: Array<{ nombre: string; precio: number; cantidad: number }> =
        (() => {
          try {
            const parsed =
              typeof fc.productos === "string"
                ? JSON.parse(fc.productos)
                : fc.productos;
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })();

      const total = parseFloat(fc.total || "0");
      const saldoAnterior = parseFloat(fc.saldo_anterior || "0");
      const nuevoSaldo = parseFloat(fc.nuevo_saldo || "0");
      const cliente = fc.clientes_credito || {};
      const nombreCliente = cliente.nombre || fc.cajero || "Cliente";
      const dniCliente = cliente.dni || "—";

      const filasProductos = prods
        .map(
          (p) => `<tr>
          <td style='padding:3px 4px'>${p.nombre}</td>
          <td style='text-align:center;padding:3px 4px'>${p.cantidad}</td>
          <td style='text-align:right;padding:3px 4px'>L ${(parseFloat(String(p.precio)) * p.cantidad).toFixed(2)}</td>
        </tr>`,
        )
        .join("");

      const receiptHtml = `<html><head><title>Crédito ${fc.factura_numero}</title>
        <style>
          body{font-family:monospace;font-size:12px;max-width:${reciboConfig?.recibo_ancho || 80}mm;margin:0 auto;padding:${reciboConfig?.recibo_padding || 8}px;background:#fff;}
          table{width:100%;border-collapse:collapse;}
          td,th{padding:3px 4px;}
          .center{text-align:center;}.bold{font-weight:700;}
          .divider{border-top:1px dashed #333;margin:6px 0;}
          .total{font-size:15px;font-weight:900;}
        </style></head><body>
        <div style='text-align:center;margin-bottom:8px;'>
          <img src='${datosNegocio.logo_url || "/favicon.ico"}' alt='logo' style='width:80px;height:80px;' />
        </div>
        <div class='center bold' style='font-size:15px'>${datosNegocio.nombre_negocio.toUpperCase()}</div>
        <div class='center' style='font-size:12px;'>${datosNegocio.direccion}</div>
        <div class='center' style='font-size:12px;'>RTN: ${datosNegocio.rtn}</div>
        <div class='center' style='font-size:12px;'>TEL: ${datosNegocio.celular}</div>
        <div class='divider'></div>
        <div class='center bold' style='font-size:15px'>VENTA A CRÉDITO (COPIA)</div>
        <div class='divider'></div>
        <div>Cliente: <strong>${nombreCliente}</strong></div>
        <div>DNI: ${dniCliente}</div>
        <div>Factura: ${fc.factura_numero}</div>
        <div>Cajero: ${fc.cajero || ""}</div>
        <div>Caja: ${fc.caja || ""}</div>
        <div>Fecha: ${new Date(fc.fecha_hora).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}</div>
        <div class='divider'></div>
        <table>
          <thead><tr>
            <th style='text-align:left'>Producto</th>
            <th style='text-align:center'>Cant</th>
            <th style='text-align:right'>Total</th>
          </tr></thead>
          <tbody>${filasProductos}</tbody>
        </table>
        <div class='divider'></div>
        <div>Saldo anterior: L ${saldoAnterior.toFixed(2)}</div>
        <div class='bold'>Esta venta: L ${total.toFixed(2)}</div>
        <div class='total'>Nuevo saldo: L ${nuevoSaldo.toFixed(2)}</div>
        <div class='divider'></div>
        <div class='center' style='font-size:11px;margin-top:8px'>— Pendiente de cobro —</div>
        <div class='center bold' style='margin-top:10px;font-size:13px;'>¡GRACIAS POR SU COMPRA!</div>
      </body></html>`;

      const pw = window.open("", "", "height=800,width=400");
      if (pw) {
        pw.document.write(receiptHtml);
        pw.document.close();
        pw.onload = () => {
          setTimeout(() => {
            pw.focus();
            pw.print();
            pw.close();
          }, 500);
        };
      }
      setShowHistorialCreditos(false);
    } catch (err) {
      console.error("Error reimprimiendo factura de crédito:", err);
      alert("Error al reimprimir la factura de crédito");
    }
  }

  // Reimprimir solo la factura (comprobante) de una venta del historial
  async function imprimirFacturaHistorial(venta: any) {
    try {
      const [{ data: reciboConfig }, { data: pagosVenta }] = await Promise.all([
        supabase
          .from("recibo_config")
          .select("*")
          .eq("nombre", "default")
          .single(),
        supabase.from("ventas").select("*").eq("factura", venta.factura),
      ]);
      const prods: Array<{
        nombre: string;
        precio: number;
        cantidad: number;
        tipo: string;
      }> = (() => {
        try {
          return JSON.parse(venta.productos || "[]");
        } catch {
          return [];
        }
      })();
      const totalVenta = parseFloat(venta.total || "0");
      const pf = pagosVenta?.[0] || null;
      const efectivoTotal = pf ? parseFloat(String(pf.efectivo || 0)) : 0;
      const tarjetaTotal = pf ? parseFloat(String(pf.tarjeta || 0)) : 0;
      const dolaresTotal = pf ? parseFloat(String(pf.dolares || 0)) : 0;
      const dolaresUSD = pf ? parseFloat(String(pf.dolares_usd || 0)) : 0;
      const transferenciaTotal = pf
        ? parseFloat(String(pf.transferencia || 0))
        : 0;
      const cambioTotal = pf ? parseFloat(String(pf.cambio || 0)) : 0;
      let pagosHtml = "";
      if (
        efectivoTotal > 0 ||
        tarjetaTotal > 0 ||
        dolaresTotal > 0 ||
        transferenciaTotal > 0
      ) {
        pagosHtml +=
          "<div style='border-top:1px dashed #000; margin-top:10px; padding-top:10px;'>";
        pagosHtml +=
          "<div style='font-size:15px; font-weight:700; margin-bottom:6px;'>PAGOS RECIBIDOS:</div>";
        if (efectivoTotal > 0)
          pagosHtml += `<div style='font-size:14px; margin-bottom:3px;'><span style='float:left;'>Efectivo:</span><span style='float:right;'>L ${efectivoTotal.toFixed(2)}</span><div style='clear:both;'></div></div>`;
        if (tarjetaTotal > 0)
          pagosHtml += `<div style='font-size:14px; margin-bottom:3px;'><span style='float:left;'>Tarjeta:</span><span style='float:right;'>L ${tarjetaTotal.toFixed(2)}</span><div style='clear:both;'></div></div>`;
        if (dolaresTotal > 0)
          pagosHtml += `<div style='font-size:14px; margin-bottom:3px;'><span style='float:left;'>Dólares: $${dolaresUSD.toFixed(2)} USD</span><span style='float:right;'>L ${dolaresTotal.toFixed(2)}</span><div style='clear:both;'></div></div>`;
        if (transferenciaTotal > 0)
          pagosHtml += `<div style='font-size:14px; margin-bottom:3px;'><span style='float:left;'>Transferencia:</span><span style='float:right;'>L ${transferenciaTotal.toFixed(2)}</span><div style='clear:both;'></div></div>`;
        if (cambioTotal > 0)
          pagosHtml += `<div style='font-size:15px; margin-top:6px; padding-top:6px; border-top:1px solid #000; font-weight:700;'><span style='float:left;'>CAMBIO:</span><span style='float:right;'>L ${cambioTotal.toFixed(2)}</span><div style='clear:both;'></div></div>`;
        pagosHtml += "</div>";
      }
      const comprobanteHtml = `
        <div style='font-family:monospace; width:${reciboConfig?.recibo_ancho || 80}mm; margin:0; padding:${reciboConfig?.recibo_padding || 8}px; background:#fff;'>
          <div style='text-align:center; margin-bottom:12px;'>
            <img src='${datosNegocio.logo_url || "/favicon.ico"}' alt='logo' style='width:320px; height:320px;' />
          </div>
          <div style='text-align:center; font-size:18px; font-weight:700; margin-bottom:6px;'>${datosNegocio.nombre_negocio.toUpperCase()}</div>
          <div style='text-align:center; font-size:14px; margin-bottom:3px;'>${datosNegocio.direccion}</div>
          <div style='text-align:center; font-size:14px; margin-bottom:3px;'>RTN: ${datosNegocio.rtn}</div>
          <div style='text-align:center; font-size:14px; margin-bottom:3px;'>PROPIETARIO: ${datosNegocio.propietario.toUpperCase()}</div>
          <div style='text-align:center; font-size:14px; margin-bottom:10px;'>TEL: ${datosNegocio.celular}</div>
          <div style='border-top:2px solid #000; border-bottom:2px solid #000; padding:6px 0; margin-bottom:10px;'>
            <div style='text-align:center; font-size:16px; font-weight:700;'>RECIBO DE VENTA (COPIA)</div>
          </div>
          <div style='font-size:14px; margin-bottom:3px;'>Cliente: ${venta.cliente}</div>
          <div style='font-size:14px; margin-bottom:3px;'>Factura: ${venta.factura}</div>
          <div style='font-size:14px; margin-bottom:10px;'>Fecha: ${new Date(venta.fecha_hora).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}</div>
          <div style='border-top:1px dashed #000; border-bottom:1px dashed #000; padding:6px 0; margin-bottom:10px;'>
            <table style='width:100%; font-size:14px; border-collapse:collapse;'>
              <thead>
                <tr style='border-bottom:1px solid #000;'>
                  <th style='text-align:left; padding:3px 0;'>CANT</th>
                  <th style='text-align:left; padding:3px 0;'>DESCRIPCIÓN</th>
                  <th style='text-align:right; padding:3px 0;'>P.UNIT</th>
                  <th style='text-align:right; padding:3px 0;'>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                ${prods.map((p) => `<tr><td style='padding:4px 0;'>${p.cantidad}</td><td style='padding:4px 0;'>${p.nombre}</td><td style='text-align:right; padding:4px 0;'>L${parseFloat(String(p.precio)).toFixed(2)}</td><td style='text-align:right; padding:4px 0;'>L${(parseFloat(String(p.precio)) * p.cantidad).toFixed(2)}</td></tr>`).join("")}
              </tbody>
            </table>
          </div>
          <div style='border-top:1px solid #000; margin-top:6px; padding-top:6px; font-size:17px; font-weight:700;'><span style='float:left;'>TOTAL:</span><span style='float:right;'>L ${totalVenta.toFixed(2)}</span><div style='clear:both;'></div></div>
          ${pagosHtml}
          <div style='text-align:center; margin-top:18px; font-size:15px; font-weight:700; border-top:1px dashed #000; padding-top:10px;'>¡GRACIAS POR SU COMPRA!</div>
          <div style='text-align:center; font-size:14px; margin-top:5px;'>Esperamos verle pronto</div>
        </div>
      `;
      const printHtml = `<html><head><title>Factura ${venta.factura}</title><style>@page{margin:0;size:auto;}body{margin:0;padding:0;}*{-webkit-print-color-adjust:exact;}</style></head><body>${comprobanteHtml}</body></html>`;
      const pw = window.open("", "", "height=800,width=400");
      if (pw) {
        pw.document.write(printHtml);
        pw.document.close();
        pw.onload = () => {
          setTimeout(() => {
            pw.focus();
            pw.print();
            pw.close();
          }, 500);
        };
      }
      // Cerrar modal de historial después de imprimir
      try {
        setShowHistorialVentas(false);
      } catch {}
    } catch (err) {
      console.error("Error reimprimiendo factura:", err);
      alert("Error al reimprimir la factura");
    }
  }

  // Reimprimir la comanda de una venta del historial
  async function imprimirComandaHistorial(
    venta: any,
    tipoOrdenSel: "PARA LLEVAR" | "COMER AQUÍ",
  ) {
    try {
      const { data: etiquetaConfig } = await supabase
        .from("etiquetas_config")
        .select("*")
        .eq("nombre", "default")
        .single();
      const prods: Array<{
        nombre: string;
        precio: number;
        cantidad: number;
        tipo: string;
        complementos?: string[];
        piezas?: string;
      }> = (() => {
        try {
          return JSON.parse(venta.productos || "[]");
        } catch {
          return [];
        }
      })();
      const comandaHtml = `
        <div style='font-family:monospace; width:${etiquetaConfig?.etiqueta_ancho || 80}mm; margin:0; padding:${etiquetaConfig?.etiqueta_padding || 8}px;'>
          <div style='font-size:${etiquetaConfig?.etiqueta_fontsize || 24}px; font-weight:800; color:#000; text-align:center; margin-bottom:6px;'>${etiquetaConfig?.etiqueta_comanda || "COMANDA COCINA"}</div>
          <div style='font-size:28px; font-weight:900; color:#000; text-align:center; margin:16px 0;'>${tipoOrdenSel}</div>
          <div style='font-size:20px; font-weight:800; color:#000; text-align:center; margin-bottom:12px;'>Cliente: <b>${venta.cliente}</b></div>
          <div style='font-size:14px; font-weight:600; color:#222; text-align:center; margin-bottom:6px;'>Factura: ${venta.factura}</div>
          ${
            prods.filter((p) => p.tipo === "comida").length > 0
              ? `
            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>COMIDAS</div>
            <ul style='list-style:none; padding:0; margin-bottom:12px;'>
              ${prods
                .filter((p) => p.tipo === "comida")
                .map(
                  (p) => `
                <li style='font-size:${etiquetaConfig?.etiqueta_fontsize || 20}px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                  <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${p.cantidad}x</div>
                  <div style='font-weight:700;'>${p.nombre}</div>
                  ${p.complementos && p.complementos.length > 0 ? `<div style='font-size:12px; margin-top:6px; font-weight:600; color:#555;'>🍗 Complementos:</div>${p.complementos.map((c) => `<div style='font-size:14px; margin-top:2px; padding-left:8px;'><span style='font-weight:700;'>• ${c}</span></div>`).join("")}` : ""}
                  ${p.piezas && p.piezas !== "PIEZAS VARIAS" ? `<div style='font-size:12px; margin-top:6px; font-weight:600; color:#555;'>🍖 Piezas:</div><div style='font-size:14px; margin-top:2px; padding-left:8px;'><span style='font-weight:700;'>• ${p.piezas}</span></div>` : ""}
                </li>
              `,
                )
                .join("")}
            </ul>
          `
              : ""
          }
          ${
            prods.filter((p) => p.tipo === "complemento").length > 0
              ? `
            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>COMPLEMENTOS</div>
            <ul style='list-style:none; padding:0; margin-bottom:12px;'>
              ${prods
                .filter((p) => p.tipo === "complemento")
                .map(
                  (p) => `
                <li style='font-size:${etiquetaConfig?.etiqueta_fontsize || 20}px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                  <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${p.cantidad}x</div>
                  <div style='font-weight:700;'>${p.nombre}</div>
                </li>
              `,
                )
                .join("")}
            </ul>
          `
              : ""
          }
          ${
            prods.filter((p) => p.tipo === "bebida").length > 0
              ? `
            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>BEBIDAS</div>
            <ul style='list-style:none; padding:0; margin-bottom:0;'>
              ${prods
                .filter((p) => p.tipo === "bebida")
                .map(
                  (p) => `
                <li style='font-size:${etiquetaConfig?.etiqueta_fontsize || 20}px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                  <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${p.cantidad}x</div>
                  <div style='font-weight:700;'>${p.nombre}</div>
                </li>
              `,
                )
                .join("")}
            </ul>
          `
              : ""
          }
        </div>
      `;
      const printHtml = `<html><head><title>Comanda ${venta.factura}</title><style>@page{margin:0;size:auto;}body{margin:0;padding:0;}</style></head><body>${comandaHtml}</body></html>`;
      const pw = window.open("", "", "height=800,width=400");
      if (pw) {
        pw.document.write(printHtml);
        pw.document.close();
        pw.onload = () => {
          setTimeout(() => {
            pw.focus();
            pw.print();
            pw.close();
          }, 500);
        };
      }
      // Cerrar modal de historial después de imprimir comanda
      try {
        setShowHistorialVentas(false);
      } catch {}
    } catch (err) {
      console.error("Error reimprimiendo comanda:", err);
      alert("Error al reimprimir la comanda");
    }
  }

  const [theme, setTheme] = useState<"lite" | "dark">(() => {
    try {
      const stored = localStorage.getItem("theme");
      return stored === "dark" ? "dark" : "lite";
    } catch {
      return "lite";
    }
  });

  const [showCerrarSesionModal, setShowCerrarSesionModal] = useState(false);

  // Estado para sincronización offline
  const { conectado: isOnline } = useConexion();
  // const [pendientesCount, setPendientesCount] = useState({
  //   facturas: 0,
  //   pagos: 0,
  //   gastos: 0,
  //   envios: 0,
  // });
  // const [sincronizando, setSincronizando] = useState(false);

  // Cargar datos del negocio
  const { datos: datosNegocio } = useDatosNegocio();

  const [facturaActual, setFacturaActual] = useState<string>("");
  const [showPagoModal, setShowPagoModal] = useState(false);
  // Pedido en proceso de entrega (flujo: Entregado → SAR modal → Pago modal)
  const [pedidoPendienteEntrega, setPedidoPendienteEntrega] =
    useState<any>(null);

  // ── Sistema SAR Honduras ─────────────────────────────────────────────────
  const [showSarModal, setShowSarModal] = useState(false);
  const [tipoDocumentoFiscal, setTipoDocumentoFiscal] = useState<
    "FACTURA" | "RECIBO"
  >("RECIBO");
  const [rtnCliente, setRtnCliente] = useState("");
  const [nombreClienteFiscal, setNombreClienteFiscal] = useState("");
  const TIPO_RECIBO = "RECIBO" as const;
  const TIPO_FACTURA = "FACTURA" as const;

  const parseSecuencialDocumento = (documento: string): number | null => {
    const m = String(documento || "").match(/(\d+)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  };

  const formatearNumeroSar = (caiRow: any, secuencial: number): string => {
    const est = String(caiRow?.numero_establecimiento || "001").padStart(
      3,
      "0",
    );
    const pto = String(caiRow?.punto_emision || "001").padStart(3, "0");
    const tdoc = String(caiRow?.tipo_documento || "01").padStart(2, "0");
    const corr = String(secuencial).padStart(8, "0");
    return `${est}-${pto}-${tdoc}-${corr}`;
  };

  const persistirFacturaActualOffline = async (
    secuencialSiguiente: number,
    caiFactura?: any,
  ) => {
    if (!usuarioActual?.id || !Number.isFinite(secuencialSiguiente)) return;

    const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
    const caiFact =
      caiFactura ||
      caiRows.find(
        (row) =>
          row.cajero_id === usuarioActual.id &&
          row.tipo_comprobante === TIPO_FACTURA &&
          row.activo !== false,
      );

    if (!caiFact) return;

    const secStr = String(secuencialSiguiente);
    await upsertOne(STORE.CAI_FACTURAS, {
      ...caiFact,
      factura_actual: secStr,
    });

    try {
      await guardarCaiCache({
        id: String(caiFact.id),
        cajero_id: caiFact.cajero_id,
        tipo_comprobante: TIPO_FACTURA,
        caja_asignada: caiFact.caja_asignada,
        cai: caiFact.cai,
        factura_desde: caiFact.rango_desde,
        factura_hasta: caiFact.rango_hasta,
        factura_actual: secStr,
        nombre_cajero: usuarioActual?.nombre || "",
      });
    } catch {
      /* non-critical */
    }
  };

  const guardarReciboActualEnCache = async (nuevaFactura: string) => {
    const caiCache = await obtenerCaiCache(usuarioActual?.id, TIPO_RECIBO);
    if (!caiCache) return;

    await guardarCaiCache({
      ...caiCache,
      tipo_comprobante: TIPO_RECIBO,
      factura_actual: nuevaFactura,
    });
  };

  const guardarReciboActualEnIdb = async (nuevaFactura: string) => {
    const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
    const caiRec = caiRows.find(
      (row) =>
        row.cajero_id === usuarioActual?.id &&
        row.tipo_comprobante === TIPO_RECIBO,
    );
    if (!caiRec) return;

    await upsertOne(STORE.CAI_FACTURAS, {
      ...caiRec,
      factura_actual: nuevaFactura,
    });
  };

  const persistirReciboActual = async (
    nuevaFactura: string,
    opciones?: { actualizarSupabase?: boolean },
  ) => {
    setFacturaActual(nuevaFactura);

    if (opciones?.actualizarSupabase && usuarioActual?.id) {
      await supabase
        .from("cai_facturas")
        .update({ factura_actual: nuevaFactura })
        .eq("cajero_id", usuarioActual.id)
        .eq("tipo_comprobante", TIPO_RECIBO);
    }

    await guardarReciboActualEnCache(nuevaFactura);
    await guardarReciboActualEnIdb(nuevaFactura);
  };

  /**
   * Guard síncrono contra doble-submit en el flujo de facturación.
   * Se usa useRef (no useState) para que el cambio sea inmediato,
   * sin esperar un ciclo de render de React.
   */
  const isSubmittingRef = useRef(false);
  const [tasaCambio, setTasaCambio] = useState<number>(25.0); // Tasa de cambio HNL/USD
  const [showClienteModal, setShowClienteModal] = useState(false);
  // Modal para envíos de pedido
  const [showEnvioModal, setShowEnvioModal] = useState(false);
  const [envioCliente, setEnvioCliente] = useState("");
  const [envioCelular, setEnvioCelular] = useState("");
  const [envioTipoPago, setEnvioTipoPago] = useState<
    "Efectivo" | "Tarjeta" | "Transferencia" | "Dolares"
  >("Efectivo");
  const [envioCosto, setEnvioCosto] = useState<string>("0");
  const [savingEnvio, setSavingEnvio] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [lastEnvioSaved, setLastEnvioSaved] = useState<any>(null);
  const [showNoConnectionModal, setShowNoConnectionModal] = useState(false);

  useEffect(() => {
    if (!showPagoModal) return;
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("precio_dolar")
          .select("valor")
          .eq("id", "singleton")
          .limit(1)
          .single();
        if (!mounted) return;
        if (data && typeof data.valor !== "undefined") {
          setTasaCambio(Number(data.valor));
        }
      } catch (e) {
        console.warn("No se pudo cargar tasa de cambio:", e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [showPagoModal]);
  // Modal para registrar gasto
  const [showRegistrarGasto, setShowRegistrarGasto] = useState(false);
  // Modal para listar pedidos del cajero
  const [showPedidosModal, setShowPedidosModal] = useState(false);
  const [pedidosList, setPedidosList] = useState<any[]>([]);
  const [pedidosLoading] = useState(false);
  const [pedidosPendientesCount, setPedidosPendientesCount] = useState(0);
  const [showCierrePedidosWarning, setShowCierrePedidosWarning] =
    useState(false);
  const [pedidosProcessingId, setPedidosProcessingId] = useState<string | null>(
    null,
  );
  const [gastoMonto, setGastoMonto] = useState<string>("");
  const [gastoMotivo, setGastoMotivo] = useState<string>("");
  const [gastoFactura, setGastoFactura] = useState<string>("");
  const [guardandoGasto, setGuardandoGasto] = useState(false);
  // Helper para cerrar y resetear el formulario de gasto
  const cerrarRegistrarGasto = () => {
    setShowRegistrarGasto(false);
    setGastoMonto("");
    setGastoMotivo("");
    setGastoFactura("");
  };
  const [showGastoSuccess, setShowGastoSuccess] = useState(false);

  // Inicializar sistema de sincronización offline
  useEffect(() => {
    // Inicializar IndexedDB
    inicializarSistemaOffline();

    // Migrar datos antiguos de localStorage si existen
    migrarPagosDesdeLocalStorage().catch((error) => {
      console.error("Error en migración de localStorage:", error);
    });

    // Sincronización automática en segundo plano cada 60 segundos (solo cuando hay conexión)
    const syncInterval = setInterval(async () => {
      if (estaConectado()) {
        try {
          const resultado = await sincronizarTodo();
          const total =
            resultado.facturas.exitosas +
            resultado.pagos.exitosos +
            resultado.gastos.exitosos +
            resultado.envios.exitosos;

          if (total > 0) {
            console.log(
              `🔄 Sincronización automática: ${resultado.facturas.exitosas} facturas, ${resultado.pagos.exitosos} pagos, ${resultado.gastos.exitosos} gastos, ${resultado.envios.exitosos} envíos`,
            );
          }
        } catch (error) {
          console.error("Error en sincronización automática:", error);
        }
      }
    }, 60000); // Cada 60 segundos

    // Actualizar contador de pendientes cada 10 segundos
    // const interval = setInterval(async () => {
    //   const count = await obtenerContadorPendientes();
    //   setPendientesCount(count);
    // }, 10000);

    // Obtener contador inicial
    // obtenerContadorPendientes().then(setPendientesCount);

    // Listener para Ctrl+0 para actualizar cache de productos y Ctrl+Shift+R para bloquear cuando offline
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Bloquear Ctrl+Shift+R cuando no hay internet (cierre de caja requiere conexión)
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") {
        if (!isOnline || !estaConectado()) {
          e.preventDefault();
          alert(
            "⚠️ No se puede acceder a esta función sin conexión a internet.\n\nEl cierre de caja requiere conexión para sincronizar datos.",
          );
          return;
        }
      }

      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        console.log("Actualizando cache de productos...");

        if (!estaConectado()) {
          alert(
            "⚠ No hay conexión a internet. No se puede actualizar el cache de productos.",
          );
          return;
        }

        try {
          const resultado = await actualizarCacheProductos();
          if (resultado.exitoso) {
            alert(`✓ Cache actualizado: ${resultado.cantidad} productos`);
            // Recargar productos en la interfaz
            await cargarProductos();
          } else {
            alert(`❌ Error al actualizar cache: ${resultado.mensaje}`);
          }
        } catch (error) {
          console.error("Error actualizando cache:", error);
          alert("❌ Error al actualizar cache de productos");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearInterval(syncInterval);
      // clearInterval(interval);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Disparo inmediato de sincronización al recuperar internet real
  useEffect(() => {
    if (!isOnline || !estaConectado()) return;

    (async () => {
      try {
        const resultado = await sincronizarTodo();
        const total =
          resultado.facturas.exitosas +
          resultado.pagos.exitosos +
          resultado.gastos.exitosos +
          resultado.envios.exitosos;

        if (total > 0) {
          console.log(
            `🔄 Sincronización por reconexión: ${resultado.facturas.exitosas} facturas, ${resultado.pagos.exitosos} pagos, ${resultado.gastos.exitosos} gastos, ${resultado.envios.exitosos} envíos`,
          );
        }
      } catch (error) {
        console.error("Error sincronizando al reconectar:", error);
      }
    })();
  }, [isOnline]);

  // Función para sincronizar manualmente
  // const sincronizarManualmente = async () => {
  //   if (!isOnline) {
  //     alert("No hay conexión a internet");
  //     return;
  //   }

  //   setSincronizando(true);
  //   try {
  //     const resultado = await sincronizarTodo();
  //     const total =
  //       resultado.facturas.exitosas +
  //       resultado.pagos.exitosos +
  //       resultado.gastos.exitosos +
  //       resultado.envios.exitosos;

  //     if (total > 0) {
  //       alert(
  //         `✓ Sincronización exitosa:\n` +
  //           `${resultado.facturas.exitosas} facturas\n` +
  //           `${resultado.pagos.exitosos} pagos\n` +
  //           `${resultado.gastos.exitosos} gastos\n` +
  //           `${resultado.envios.exitosos} envíos`,
  //       );
  //     } else {
  //       alert("No hay registros pendientes por sincronizar");
  //     }

  //     // Actualizar contador
  //     const count = await obtenerContadorPendientes();
  //     setPendientesCount(count);
  //   } catch (error) {
  //     console.error("Error en sincronización manual:", error);
  //     alert("Error al sincronizar. Inténtalo de nuevo.");
  //   } finally {
  //     setSincronizando(false);
  //   }
  // };
  const [gastoSuccessMessage, setGastoSuccessMessage] = useState<string>("");

  // ── Modal Cuentas por Pagar ─────────────────────────────────
  const [showCxPModal, setShowCxPModal] = useState(false);
  const [cxpProveedores, setCxpProveedores] = useState<Proveedor[]>([]);
  const [cxpProveedorId, setCxpProveedorId] = useState<string>("");
  const [cxpMonto, setCxpMonto] = useState<string>("");
  const [cxpMotivo, setCxpMotivo] = useState<string>("");
  const [guardandoCxP, setGuardandoCxP] = useState(false);
  const [showCxPSuccess, setShowCxPSuccess] = useState(false);
  const cerrarCxP = () => {
    setShowCxPModal(false);
    setCxpProveedorId("");
    setCxpMonto("");
    setCxpMotivo("");
  };

  // ── Reset formulario Pedido por Teléfono ────────────────────
  const resetEnvioForm = () => {
    setEnvioCliente("");
    setEnvioCelular("");
    setEnvioTipoPago("Efectivo");
    setEnvioCosto("0");
  };

  const normalizarTipoPagoPedido = (tipo: any): string => {
    const value = String(tipo || "efectivo")
      .trim()
      .toLowerCase();
    if (value === "tarjeta") return "tarjeta";
    if (value === "transferencia" || value === "transferencias")
      return "transferencia";
    if (value === "dolares" || value === "dólares" || value === "usd")
      return "dolares";
    return "efectivo";
  };

  const calcularTotalCobroPedido = (pedido: any): number => {
    const totalProductos = Number(pedido?.total || 0);
    const costoEnvio = Number.parseFloat(String(pedido?.costo_envio ?? "0"));
    const includeDelivery = posConfig.cobrar_delivery_en_pedidos !== false;
    return (
      totalProductos +
      (includeDelivery ? (Number.isFinite(costoEnvio) ? costoEnvio : 0) : 0)
    );
  };

  const registrarPedidoEntregadoAutomatico = async (pedido: any) => {
    const pedidoKey = String(pedido.id || pedido.local_id || "");
    setPedidosProcessingId(pedidoKey);

    try {
      const fechaVenta = formatToHondurasLocal();
      const includeDelivery = posConfig.cobrar_delivery_en_pedidos !== false;
      const totalProductos = Number(pedido.total || 0);
      const costoEnvioReal = Number.parseFloat(
        String(pedido.costo_envio ?? "0"),
      );
      const costoEnvioCobrado = includeDelivery
        ? Number.isFinite(costoEnvioReal)
          ? costoEnvioReal
          : 0
        : 0;
      const totalCobro = totalProductos + costoEnvioCobrado;

      const tipoPago = normalizarTipoPagoPedido(pedido.tipo_pago);
      const tasa = (await getPrecioDolarLocal()) || tasaCambio || 1;

      let montoEfectivo = 0;
      let montoTarjeta = 0;
      let montoTransferencia = 0;
      let montoDolaresLps = 0;
      let montoDolaresUsd = 0;

      if (tipoPago === "tarjeta") {
        montoTarjeta = totalCobro;
      } else if (tipoPago === "transferencia") {
        montoTransferencia = totalCobro;
      } else if (tipoPago === "dolares") {
        montoDolaresLps = totalCobro;
        montoDolaresUsd = Number((totalCobro / (tasa || 1)).toFixed(2));
      } else {
        montoEfectivo = totalCobro;
      }

      let facturaParaEstaVenta =
        facturaActual && Number.isFinite(parseInt(facturaActual))
          ? facturaActual
          : `OFFLINE-${Date.now()}`;

      if (isOnline && usuarioActual?.id) {
        try {
          const { data: facturaRpc, error: rpcError } = await supabase.rpc(
            "obtener_siguiente_factura",
            { p_cajero_id: usuarioActual.id },
          );
          if (
            !rpcError &&
            facturaRpc &&
            facturaRpc !== "LIMITE_ALCANZADO" &&
            facturaRpc !== null
          ) {
            facturaParaEstaVenta = String(facturaRpc);
          }
        } catch {
          // fallback local
        }
      }

      const productosPedido = Array.isArray(pedido.productos)
        ? pedido.productos
        : (() => {
            try {
              return JSON.parse(String(pedido.productos || "[]"));
            } catch {
              return [];
            }
          })();

      const productosVenta = [
        ...productosPedido.map((pp: any) => ({
          id: pp.id,
          nombre: pp.nombre,
          precio: pp.precio,
          cantidad: pp.cantidad,
          tipo: pp.tipo || "comida",
          tipo_impuesto: String(obtenerTasaImpuesto(pp.tipo_impuesto, pp.tipo)),
          tasa_impuesto: obtenerTasaImpuesto(pp.tipo_impuesto, pp.tipo),
          complementos: pp.complementos ?? [],
          piezas: pp.piezas ?? null,
        })),
        ...(costoEnvioCobrado > 0
          ? [
              {
                id: "delivery",
                nombre: "Delivery",
                precio: costoEnvioCobrado,
                cantidad: 1,
                tipo: "delivery",
                complementos: [],
                piezas: null,
              },
            ]
          : []),
      ];

      const venta = {
        fecha_hora: fechaVenta,
        cajero: usuarioActual?.nombre || "",
        cajero_id: usuarioActual?.id || null,
        caja: pedido.caja || caiInfo?.caja_asignada || "",
        cai: caiInfo?.cai || "",
        factura: facturaParaEstaVenta,
        cliente: pedido.cliente || null,
        tipo_orden: "DELIVERY",
        tipo: "CONTADO",
        operation_id: crypto.randomUUID(),
        productos: JSON.stringify(productosVenta),
        sub_total: Number(totalProductos || 0).toFixed(2),
        isv_15: "0.00",
        isv_18: "0.00",
        total: Number(totalCobro || 0).toFixed(2),
        tipo_documento_fiscal: "RECIBO",
        rtn_cliente: null,
        nombre_cliente_fiscal: null,
        numero_secuencial: null,
        fecha_limite_emision_cai: null,
        efectivo: montoEfectivo,
        tarjeta: montoTarjeta,
        transferencia: montoTransferencia,
        dolares: montoDolaresLps,
        dolares_usd: montoDolaresUsd,
        delivery: 0,
        total_recibido: totalCobro,
        cambio: 0,
      };

      const ventaIdLocal = await guardarVentaLocal(venta);

      if (isOnline && estaConectado()) {
        try {
          const { error } = await supabase.from("ventas").insert([venta]);
          if (!error) await eliminarVentaLocal(ventaIdLocal);
        } catch {
          // queda en cola local
        }
      }

      if (costoEnvioCobrado > 0 && isOnline && estaConectado()) {
        try {
          await supabase.from("costo_delivery").insert([
            {
              pedido_id:
                pedido.id && !String(pedido.id).startsWith("local-")
                  ? Number(pedido.id)
                  : null,
              monto: costoEnvioCobrado,
              fecha: pedido.fecha || fechaVenta,
              cliente: pedido.cliente || null,
              cajero_id: usuarioActual?.id || null,
              caja: pedido.caja || caiInfo?.caja_asignada || null,
              tipo_pago: tipoPago,
            },
          ]);
        } catch {
          // no crítico
        }
      }

      try {
        if (pedido.__localPending && pedido.local_id) {
          await eliminarEnvioLocal(pedido.local_id);
        } else if (
          pedido.id &&
          !String(pedido.id).startsWith("local-") &&
          isOnline &&
          estaConectado()
        ) {
          await supabase.from("pedidos_envio").delete().eq("id", pedido.id);
        }
      } catch {
        // no crítico
      }

      if (Number.isFinite(parseInt(facturaParaEstaVenta))) {
        const siguiente = (parseInt(facturaParaEstaVenta) + 1).toString();
        try {
          await persistirReciboActual(siguiente, {
            actualizarSupabase: isOnline && Boolean(usuarioActual?.id),
          });
        } catch {
          setFacturaActual(siguiente);
        }
      }

      setPedidosList((prev) =>
        prev.filter(
          (x) =>
            String(x.id || x.local_id || "") !==
            String(pedido.id || pedido.local_id || ""),
        ),
      );
      setShowPedidosModal(false);
      alert("✅ Pedido entregado y facturado automáticamente");
    } catch (err) {
      console.error("Error en entrega automática del pedido:", err);
      alert("Error al registrar el pedido entregado automáticamente");
    } finally {
      setPedidosProcessingId(null);
    }
  };

  // Estados para modal de devolución
  const [showDevolucionModal, setShowDevolucionModal] = useState(false);
  const [devolucionFactura, setDevolucionFactura] = useState<string>("");
  const [devolucionData, setDevolucionData] = useState<any>(null);
  const [devolucionBuscando, setDevolucionBuscando] = useState(false);
  const [devolucionPassword, setDevolucionPassword] = useState<string>("");
  const [devolucionProcesando, setDevolucionProcesando] = useState(false);
  const [showDevolucionPasswordModal, setShowDevolucionPasswordModal] =
    useState(false);
  const [showDevolucionError, setShowDevolucionError] = useState(false);
  const [showDevolucionSuccess, setShowDevolucionSuccess] = useState(false);
  // Eliminado showFacturaModal
  const [nombreCliente, setNombreCliente] = useState("");
  const [showOrdenModal, setShowOrdenModal] = useState(false);
  const [tipoOrden, setTipoOrden] = useState<"PARA LLEVAR" | "COMER AQUÍ">(
    "PARA LLEVAR",
  );
  const [showComplementosModal, setShowComplementosModal] = useState(false);
  const [selectedProductIndex, setSelectedProductIndex] = useState<
    number | null
  >(null);
  const [showPiezasModal, setShowPiezasModal] = useState(false);
  const [posConfig, setPosConfig] = useState(DEFAULT_POS_CONFIG);
  const [piezasOpciones, setPiezasOpciones] = useState<string[]>([
    "PIEZAS VARIAS",
    "PECHUGA",
    "ALA",
    "CADERA",
    "PIERNA",
  ]);

  useEffect(() => {
    (async () => {
      const cfg = await obtenerPosConfig();
      setPosConfig(cfg);
      const piezas = await obtenerPiezasOpciones();
      if (piezas.length > 0) {
        setPiezasOpciones(piezas.map((p) => p.nombre));
      }
    })();
  }, []);

  useEffect(() => {
    if (!posConfig.descuento_habilitado) {
      setDescuentosProductos(new Set());
    }
    if (!posConfig.credito_habilitado) {
      setShowCreditoClienteModal(false);
      setShowHistorialCreditos(false);
    }
  }, [posConfig.descuento_habilitado, posConfig.credito_habilitado]);

  const continuarFlujoDocumento = () => {
    if (posConfig.tipo_venta === "solo_recibo") {
      setTipoDocumentoFiscal("RECIBO");
      setRtnCliente("");
      setNombreClienteFiscal("");
      setShowSarModal(false);
      setShowPagoModal(true);
      return;
    }

    if (posConfig.tipo_venta === "solo_factura") {
      setTipoDocumentoFiscal("FACTURA");
      setShowSarModal(false);
      setShowPagoModal(true);
      return;
    }

    setShowSarModal(true);
  };
  const [complementosOpciones, setComplementosOpciones] = useState<string[]>(
    [],
  );

  // Cargar conteo de pedidos pendientes (domicilios/teléfono) al montar
  useEffect(() => {
    // Cargar conteo inicial de pedidos pendientes (domicilios/teléfono)
    const cargarContPedidos = async () => {
      try {
        let total = 0;
        try {
          const locales = await obtenerEnviosPendientes();
          total += locales.length;
        } catch (_) {}
        if (estaConectado()) {
          const { count } = await supabase
            .from("pedidos_envio")
            .select("id", { count: "exact", head: true })
            .eq("cajero_id", usuarioActual?.id);
          total += count || 0;
        }
        setPedidosPendientesCount(total);
      } catch (_) {}
    };
    cargarContPedidos();
    const interval = setInterval(cargarContPedidos, 30000);
    return () => clearInterval(interval);
  }, []);

  // Sincronizar conteo cuando la lista del modal de pedidos cambia
  useEffect(() => {
    setPedidosPendientesCount(pedidosList.length);
  }, [pedidosList]);

  // Cargar complementos desde la tabla complementos_opciones
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("complementos_opciones")
          .select("nombre, orden")
          .order("orden", { ascending: true });
        if (data && data.length > 0) {
          setComplementosOpciones(data.map((c: any) => c.nombre));
        } else {
          // Fallback si la tabla aún no existe o está vacía
          setComplementosOpciones([
            "CON TODO",
            "SIN NADA",
            "SIN SALSAS",
            "SIN REPOLLO",
            "SIN ADEREZO",
            "SIN CEBOLLA",
            "SALSAS APARTE",
          ]);
        }
      } catch {
        setComplementosOpciones([
          "CON TODO",
          "SIN NADA",
          "SIN SALSAS",
          "SIN REPOLLO",
          "SIN ADEREZO",
          "SIN CEBOLLA",
          "SALSAS APARTE",
        ]);
      }
    })();
  }, []);

  const [caiInfo, setCaiInfo] = useState<{
    caja_asignada: string;
    nombre_cajero: string;
    cai: string;
  } | null>(null);
  // QZ Tray removed: no states for qz/printer connection

  const [productos, setProductos] = useState<Producto[]>([]);
  const [seleccionados, setSeleccionados] = useState<Seleccion[]>([]);
  // Cargar seleccionados desde localStorage al iniciar
  useEffect(() => {
    const stored = localStorage.getItem("seleccionados");
    if (stored) {
      try {
        setSeleccionados(JSON.parse(stored));
      } catch {}
    }
  }, []);

  // ── Descuentos por producto tipo 'comida' ──────────────────────────────────
  // Set de IDs de productos en la orden que tienen descuento aplicado
  const [descuentosProductos, setDescuentosProductos] = useState<Set<string>>(
    new Set(),
  );
  // Monto del descuento (cargado desde tabla descuentos_config)
  const [montoDescuentoComida, setMontoDescuentoComida] = useState<number>(20);
  useEffect(() => {
    supabase
      .from("descuentos_config")
      .select("monto_descuento")
      .eq("tipo_producto", "comida")
      .eq("activo", true)
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setMontoDescuentoComida(Number(data[0].monto_descuento) || 20);
        }
      });
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<
    "comida" | "bebida" | "complemento"
  >("comida");
  const [subcategoriaFiltro, setSubcategoriaFiltro] = useState<string | null>(
    null,
  );

  // Estados conteo del turno (chips del header)
  const [platillosTurno, setPlatillosTurno] = useState(0);
  const [bebidasTurno, setBebidasTurno] = useState(0);
  const [piezasPolloDia, setPiezasPolloDia] = useState(0);

  // Estados para control de apertura
  const [aperturaRegistrada, setAperturaRegistrada] = useState<boolean | null>(
    null,
  );
  const [verificandoApertura, setVerificandoApertura] = useState(false);
  const [registrandoApertura, setRegistrandoApertura] = useState(false);

  // Estado para contador de cierres sin aclarar
  const [_cierresSinAclarar, setCierresSinAclarar] = useState<number>(0);

  // Cargar conteo de platillos/bebidas del turno actual
  const fetchConteoTurno = async () => {
    try {
      if (!usuarioActual?.id) return;

      // ── IDB SIEMPRE PRIMERO (fuente de verdad) ─────────────────────────────
      const cierresIDB = await getByIndex<any>(
        STORE.CIERRES,
        "cajero_id",
        usuarioActual.id,
      );
      let aperturaIDB: any =
        cierresIDB
          .filter((c) => c.estado === "APERTURA")
          .sort(
            (a, b) =>
              new Date(b.fecha ?? 0).getTime() -
              new Date(a.fecha ?? 0).getTime(),
          )[0] ?? null;

      // Fallback: rescatar desde localStorage / apertura_cache si IDB está vacío
      if (!aperturaIDB) {
        const lsAp = obtenerAperturaLocalStorage();
        const cachedAp =
          lsAp?.cajero_id === usuarioActual.id
            ? lsAp
            : await obtenerAperturaCache()
                .then((c) => (c?.cajero_id === usuarioActual.id ? c : null))
                .catch(() => null);
        if (cachedAp) {
          const numId =
            parseInt(cachedAp.id as string) > 0
              ? parseInt(cachedAp.id as string)
              : -Date.now();
          aperturaIDB = {
            id: numId,
            cajero_id: cachedAp.cajero_id,
            cajero: (cachedAp as any).cajero || "",
            caja: cachedAp.caja,
            fecha: cachedAp.fecha,
            estado: "APERTURA",
          };
          await upsertOne(STORE.CIERRES, aperturaIDB);
        }
      }

      if (aperturaIDB) {
        const resumenIDB = await calcularResumenTurno(
          Number(aperturaIDB.id),
          usuarioActual.id,
        );

        if (resumenIDB) {
          setPlatillosTurno(Math.max(0, resumenIDB.total_platillos || 0));
          setBebidasTurno(Math.max(0, resumenIDB.total_bebidas || 0));
          await fetchPiezasPolloDia();
          return;
        }
      }

      setPlatillosTurno(0);
      setBebidasTurno(0);
      await fetchPiezasPolloDia();
    } catch (_) {
      setPiezasPolloDia(0);
    }
  };

  const fetchPiezasPolloDia = async () => {
    try {
      const normalizeText = (value: string): string =>
        String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      const num = (value: any): number => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const toTs = (value: any): number => {
        if (!value) return 0;
        if (typeof value === "number") return value;
        const raw = String(value).trim();
        const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
        const ts = Date.parse(normalized);
        return Number.isFinite(ts) ? ts : 0;
      };
      const isSalida = (movType: any): boolean => {
        const t = String(movType || "")
          .toLowerCase()
          .trim();
        return !(
          t === "entrada" ||
          t === "compra" ||
          t === "ajuste_positivo" ||
          t === "produccion_entrada"
        );
      };

      let insumos: any[] = [];
      let movimientos: any[] = [];

      try {
        insumos = await getAll<any>(STORE.INSUMOS);
        movimientos = await getAll<any>(STORE.MOVIMIENTOS_INVENTARIO);
      } catch {
        insumos = [];
        movimientos = [];
      }

      if (insumos.length === 0) {
        const { data } = await supabase.from("insumos").select("id, nombre");
        if (data?.length) insumos = data;
      }

      const piezas = insumos.find(
        (ins: any) => normalizeText(ins.nombre) === "piezas de pollo",
      );

      if (!piezas) {
        setPiezasPolloDia(0);
        return;
      }

      const piezasId = String(piezas.id);
      const { start, end } = getLocalDayRange();
      const tsStart = Date.parse(start);
      const tsEnd = Date.parse(end);

      if (movimientos.length === 0) {
        const { data } = await supabase
          .from("movimientos_inventario")
          .select(
            "insumo_id, item_tipo, tipo, cantidad, fecha_hora, created_at",
          )
          .eq("item_tipo", "insumo")
          .eq("insumo_id", piezasId)
          .gte("created_at", start)
          .lte("created_at", end);
        if (data?.length) movimientos = data;
      }

      const vendidoDia = (movimientos || []).reduce((acc: number, m: any) => {
        if (String(m.item_tipo) !== "insumo") return acc;
        if (String(m.insumo_id || "") !== piezasId) return acc;
        if (!isSalida(m.tipo)) return acc;
        const ts = toTs(m.fecha_hora || m.created_at);
        if (ts < tsStart || ts > tsEnd) return acc;
        return acc + num(m.cantidad);
      }, 0);

      setPiezasPolloDia(Math.max(0, vendidoDia));
    } catch {
      setPiezasPolloDia(0);
    }
  };

  const validarClaveMenu = async (pass: string): Promise<boolean> => {
    const trimmed = pass.trim();
    if (!trimmed) return false;

    let autorizado = trimmed.toLowerCase() === "admin";
    if (autorizado) return true;

    try {
      const usuarios = await getUsuariosLocal();
      autorizado = usuarios.some(
        (u: any) =>
          String(u?.rol || "").toLowerCase() === "admin" &&
          String(u?.clave || "") === trimmed,
      );
    } catch {
      autorizado = false;
    }

    return autorizado;
  };

  const guardarIngresoPiezasPollo = async () => {
    const cantidad = Number.parseInt(ingresoPiezasCantidad.trim(), 10);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      alert("Ingresa una cantidad entera mayor a 0.");
      return;
    }

    setIngresoPiezasGuardando(true);
    try {
      const normalizeText = (value: string): string =>
        String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();

      let insumos: any[] = [];
      try {
        insumos = await getAll<any>(STORE.INSUMOS);
      } catch {
        insumos = [];
      }

      let piezas = insumos.find(
        (ins: any) => normalizeText(ins.nombre) === "piezas de pollo",
      );

      if (!piezas) {
        const { data: insData } = await supabase
          .from("insumos")
          .select("id, nombre, stock_actual")
          .ilike("nombre", "piezas de pollo")
          .limit(1)
          .maybeSingle();
        if (insData) piezas = insData;
      }

      if (!piezas?.id) {
        throw new Error("No existe el insumo 'Piezas de pollo'.");
      }

      const piezasId = String(piezas.id);
      const { error: movError } = await supabase.rpc(
        "registrar_movimiento_inventario",
        {
          p_item_tipo: "insumo",
          p_item_id: piezasId,
          p_tipo_movimiento: "entrada",
          p_cantidad: cantidad,
          p_costo_unitario: 0,
          p_referencia_tipo: "manual_pos_piezas_pollo",
          p_referencia_id: null,
          p_nota: "Ingreso manual de piezas de pollo desde POS",
          p_cajero: usuarioActual?.nombre || "Cajero",
          p_cajero_id: String(usuarioActual?.id || ""),
          p_modo_estricto: false,
        },
      );

      if (movError) throw movError;

      try {
        const stockActual = Number(piezas.stock_actual || 0);
        await upsertOne(STORE.INSUMOS, {
          ...piezas,
          id: piezasId,
          stock_actual: stockActual + cantidad,
          updated_at: new Date().toISOString(),
        });
      } catch {
        // no-op
      }

      try {
        await upsertOne(STORE.MOVIMIENTOS_INVENTARIO, {
          id: -Date.now(),
          item_tipo: "insumo",
          insumo_id: piezasId,
          tipo: "entrada",
          cantidad,
          costo_unitario: 0,
          nota: "Ingreso manual de piezas de pollo desde POS",
          referencia_tipo: "manual_pos_piezas_pollo",
          referencia_id: null,
          cajero: usuarioActual?.nombre || "Cajero",
          cajero_id: String(usuarioActual?.id || ""),
          fecha_hora: formatToHondurasLocal(new Date()),
          created_at: new Date().toISOString(),
          pending_sync: false,
        });
      } catch {
        // no-op
      }

      setShowIngresoPiezasModal(false);
      setIngresoPiezasCantidad("");
      await fetchPiezasPolloDia();
      if (showInsumosBebidasDiaModal) {
        await cargarInsumosBebidasDelDia(
          inventarioDiaTipo,
          inventarioDiaPeriodo,
        );
      }
    } catch (e: any) {
      alert(e?.message || "No se pudo registrar el ingreso.");
    } finally {
      setIngresoPiezasGuardando(false);
    }
  };

  const openMenu = async () => {
    if (posConfig.menu_bloqueado) {
      setMenuUnlockPass("");
      setMenuUnlockError("");
      setShowMenuUnlockModal(true);
      return;
    }

    setMenuClosing(false);
    setShowOptionsMenu(true);
  };

  useEffect(() => {
    if (aperturaRegistrada) fetchConteoTurno();
  }, [aperturaRegistrada]);

  useEffect(() => {
    fetchPiezasPolloDia();
  }, []);

  // Obtener datos de CAI y el número de factura correcto
  // ─ Online  : lee cai_facturas para los meta-datos y llama al RPC ver_factura_actual
  //             que hace el LOOP saltando números ya usados en ventas (SAR-safe).
  // ─ Offline : usa el cache de IndexedDB y ajusta con las ventas pendientes locales.
  useEffect(() => {
    async function fetchCaiYFactura() {
      if (!usuarioActual) return;

      // ── Helpers ────────────────────────────────────────────────────────────
      const aplicarFactura = (num: string, rangoHasta: string) => {
        const n = parseInt(num);
        const fin = parseInt(rangoHasta);
        if (!Number.isFinite(n)) return;
        setFacturaActual(n > fin ? "Límite alcanzado" : n.toString());
      };

      // ── ONLINE ─────────────────────────────────────────────────────────────
      if (isOnline) {
        try {
          // 1. Cargar meta-datos del CAI desde cai_facturas
          const { data: caiData, error: caiError } = await supabase
            .from("cai_facturas")
            .select("*")
            .eq("cajero_id", usuarioActual.id)
            .eq("tipo_comprobante", "RECIBO")
            .eq("activo", true)
            .order("creado_en", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (caiError) {
            throw new Error(caiError?.message ?? "Sin datos de CAI");
          }

          if (caiData) {
            setCaiInfo({
              caja_asignada: caiData.caja_asignada,
              nombre_cajero: usuarioActual.nombre,
              cai: caiData.cai,
            });
          }

          // 2. Obtener el SIGUIENTE número libre real via RPC (hace el LOOP
          //    saltando los que ya existen en ventas para este cajero).
          let facturaParaMostrar: string = caiData?.rango_desde ?? "1";

          const { data: rpcFactura, error: rpcError } = await supabase.rpc(
            "ver_factura_actual",
            { p_cajero_id: usuarioActual.id },
          );

          if (!rpcError && rpcFactura && rpcFactura !== "LIMITE_ALCANZADO") {
            facturaParaMostrar = rpcFactura as string;
            console.log("☁️ Factura próxima (RPC):", facturaParaMostrar);
          } else if (rpcFactura === "LIMITE_ALCANZADO") {
            setFacturaActual("Límite alcanzado");
            facturaParaMostrar = "LIMITE_ALCANZADO";
          } else {
            // Fallback al campo directo si RPC falla
            facturaParaMostrar =
              caiData?.factura_actual?.trim() || caiData?.rango_desde || "1";
            console.warn(
              "⚠ RPC ver_factura_actual falló, usando campo directo:",
              facturaParaMostrar,
            );
          }

          // 3. Ajustar con ventas pendientes locales (offline no sincronizadas).
          //    Si volví a conectarme pero aún no se sincronizaron las facturas
          //    offline, Supabase devuelve un número menor al real.
          if (facturaParaMostrar !== "LIMITE_ALCANZADO") {
            try {
              const pendientes = await _obtenerVentasPendientes();
              const pendientesCajero = pendientes.filter(
                (v) => v.cajero_id === usuarioActual?.id,
              );
              let maxPendiente = parseInt(facturaParaMostrar);
              for (const v of pendientesCajero) {
                const n = parseInt(v.factura);
                if (Number.isFinite(n) && n >= maxPendiente) {
                  maxPendiente = n + 1;
                }
              }
              if (maxPendiente > parseInt(facturaParaMostrar)) {
                console.log(
                  `📦 Ajustando por pendientes offline: ${facturaParaMostrar} → ${maxPendiente}`,
                );
                facturaParaMostrar = maxPendiente.toString();
              }
            } catch {
              /* no crítico */
            }
          }

          // 4. Guardar en cache con el valor correcto
          if (caiData) {
            await guardarCaiCache({
              id: caiData.id.toString(),
              cajero_id: caiData.cajero_id,
              tipo_comprobante: TIPO_RECIBO,
              caja_asignada: caiData.caja_asignada,
              cai: caiData.cai,
              factura_desde: caiData.rango_desde,
              factura_hasta: caiData.rango_hasta,
              factura_actual:
                facturaParaMostrar !== "LIMITE_ALCANZADO"
                  ? facturaParaMostrar
                  : caiData.rango_hasta,
              nombre_cajero: usuarioActual.nombre,
            });
          }

          // 5. Mostrar en UI
          if (facturaParaMostrar !== "LIMITE_ALCANZADO") {
            aplicarFactura(
              facturaParaMostrar,
              caiData?.rango_hasta ?? "9999999",
            );
          }
        } catch (err: any) {
          console.error("Error cargando CAI online:", err);
          // Fallback al cache local
          await cargarDesdeCache();
        }
      } else {
        // ── OFFLINE ──────────────────────────────────────────────────────────
        await cargarDesdeCache();
      }

      // ── Función offline/fallback ──────────────────────────────────────────
      async function cargarDesdeCache() {
        let caiCache = await obtenerCaiCache(usuarioActual?.id, TIPO_RECIBO);
        if (!caiCache) {
          try {
            const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
            const caiRecibo = caiRows.find(
              (row) =>
                row.cajero_id === usuarioActual?.id &&
                row.tipo_comprobante === TIPO_RECIBO &&
                row.activo !== false,
            );

            if (caiRecibo) {
              await guardarCaiCache({
                id: caiRecibo.id.toString(),
                cajero_id: caiRecibo.cajero_id,
                tipo_comprobante: TIPO_RECIBO,
                caja_asignada: caiRecibo.caja_asignada,
                cai: caiRecibo.cai,
                factura_desde: caiRecibo.rango_desde,
                factura_hasta: caiRecibo.rango_hasta,
                factura_actual:
                  caiRecibo.factura_actual ?? caiRecibo.rango_desde ?? "1",
                nombre_cajero: usuarioActual?.nombre ?? "",
              });
              caiCache = await obtenerCaiCache(usuarioActual?.id, TIPO_RECIBO);
            }
          } catch {
            /* non-critical */
          }
        }

        if (!caiCache) {
          console.warn("⚠ No hay CAI RECIBO en cache ni en IndexedDB");
          return;
        }

        setCaiInfo({
          caja_asignada: caiCache.caja_asignada,
          nombre_cajero: caiCache.nombre_cajero,
          cai: caiCache.cai,
        });

        // Partir del factura_actual guardado en cache
        let maxNum = parseInt(
          caiCache.factura_actual || caiCache.factura_desde,
        );
        if (!Number.isFinite(maxNum)) maxNum = parseInt(caiCache.factura_desde);

        // Ajustar con ventas pendientes en IndexedDB para este cajero
        try {
          const pendientes = await _obtenerVentasPendientes();
          const pendientesCajero = pendientes.filter(
            (v) => v.cajero_id === usuarioActual?.id,
          );
          for (const v of pendientesCajero) {
            const n = parseInt(v.factura);
            if (Number.isFinite(n) && n >= maxNum) maxNum = n + 1;
          }
        } catch {
          /* no crítico */
        }

        console.log("📦 Factura próxima (offline/cache):", maxNum.toString());
        aplicarFactura(maxNum.toString(), caiCache.factura_hasta);
      }
    }

    fetchCaiYFactura();
  }, [usuarioActual, isOnline]);

  // Verificar si existe apertura registrada del día
  useEffect(() => {
    async function verificarApertura() {
      if (!usuarioActual) {
        setAperturaRegistrada(false);
        return;
      }
      setVerificandoApertura(true);
      try {
        // ── IDB ES SIEMPRE LA FUENTE DE VERDAD ────────────────────────────────
        // Verificar IDB ANTES de consultar Supabase o localStorage.
        // Usamos el registro MÁS RECIENTE por fecha para determinar el estado.
        // Así funciona correctamente en turnos de medianoche y cualquier escenario.
        try {
          const idbCierres = await getByIndex<any>(
            STORE.CIERRES,
            "cajero_id",
            usuarioActual.id,
          );

          if (idbCierres.length > 0) {
            // Ordenar por fecha descendente → el más reciente manda
            const masReciente = [...idbCierres].sort(
              compareTurnoRecordsByRecency,
            )[0];

            if (masReciente.estado === "APERTURA") {
              console.log(
                "[verificarApertura] IDB → APERTURA activa (más reciente)",
              );
              setAperturaRegistrada(true);
              setVerificandoApertura(false);
              return;
            } else {
              // CIERRE u otro estado → turno cerrado
              console.log(
                "[verificarApertura] IDB → Turno cerrado (estado:",
                masReciente.estado,
                ")",
              );
              setAperturaRegistrada(false);
              limpiarAperturaLocalStorage();
              setVerificandoApertura(false);
              return;
            }
          }
          // IDB vacío → caer al bloque Supabase/localStorage
        } catch (idbCheckErr) {
          console.warn("[verificarApertura] Error leyendo IDB:", idbCheckErr);
          // Continúa con Supabase/localStorage
        }

        // Si hay conexión, verificar en Supabase
        if (isOnline) {
          // ── PRIORIDAD: si hay apertura offline pendiente de sync, subirla ANTES
          //    de consultar Supabase, para evitar que se limpie el cache erróneamente
          const aperturaLS = obtenerAperturaLocalStorage();
          if (
            aperturaLS?.pending_sync &&
            aperturaLS.cajero_id === usuarioActual.id
          ) {
            console.log(
              "🔄 Apertura offline detectada al reconectar → sincronizando con Supabase primero...",
            );
            const syncOk = await sincronizarAperturaPendiente();
            if (syncOk) {
              console.log(
                "✓ Apertura offline sincronizada. Continuando verificación...",
              );
            } else {
              // Si falla la sync pero la apertura existe localmente, dejarla activa
              console.warn(
                "⚠ Sync fallida. Manteniendo apertura local activa.",
              );
              setAperturaRegistrada(true);
              setVerificandoApertura(false);
              return;
            }
          }

          // Obtener caja asignada
          let cajaAsignada = caiInfo?.caja_asignada;
          if (!cajaAsignada) {
            const { data: caiData, error: caiError } = await supabase
              .from("cai_facturas")
              .select("caja_asignada")
              .eq("cajero_id", usuarioActual.id)
              .order("id", { ascending: false })
              .limit(1)
              .maybeSingle();

            // Si hay error de conexión, ir directo a cache
            if (caiError) {
              console.log("⚠ Error obteniendo caja asignada:", caiError);
              throw new Error(caiError.message || "Error de conexión");
            }

            cajaAsignada = caiData?.caja_asignada || "";
          }
          if (!cajaAsignada) {
            setAperturaRegistrada(false);
            setVerificandoApertura(false);
            return;
          }

          // Determinar estado real del turno por el ÚLTIMO movimiento en cierres
          const { data: ultimoMovimiento, error: aperturasError } =
            await supabase
              .from("cierres")
              .select("id, estado, cajero_id, caja, fecha")
              .eq("cajero_id", usuarioActual.id)
              .eq("caja", cajaAsignada)
              .order("id", { ascending: false })
              .limit(1)
              .maybeSingle();

          // Si hay error de conexión, ir directo a cache
          if (aperturasError) {
            console.log("⚠ Error obteniendo aperturas:", aperturasError);
            throw new Error(aperturasError.message || "Error de conexión");
          }

          if (ultimoMovimiento?.estado === "APERTURA") {
            console.log(
              "✓ Apertura activa encontrada en Supabase:",
              ultimoMovimiento,
            );
            setAperturaRegistrada(true);

            // Guardar en cache para uso offline
            await guardarAperturaCache({
              id: ultimoMovimiento.id.toString(),
              cajero_id: ultimoMovimiento.cajero_id,
              caja: ultimoMovimiento.caja,
              fecha: ultimoMovimiento.fecha,
              estado: ultimoMovimiento.estado,
            });
            console.log("✓ Apertura guardada en cache");
          } else {
            console.log("⚠ No hay apertura en Supabase");
            // Guardia: no limpiar si aún hay una apertura offline pendiente de sync
            const lsActual = obtenerAperturaLocalStorage();
            if (
              lsActual?.pending_sync &&
              lsActual.cajero_id === usuarioActual.id
            ) {
              console.warn(
                "⚠ Apertura no encontrada en Supabase pero hay pending_sync local → manteniendo activa",
              );
              setAperturaRegistrada(true);
            } else {
              setAperturaRegistrada(false);
              // Limpiar cache solo si no hay apertura pendiente
              await limpiarAperturaCache();
            }
          }
        } else {
          // Si no hay conexión, verificar por capas (localStorage → IndexedDB)
          console.log("⚠ Sin conexión. Verificando apertura desde cache...");

          // Capa rápida: localStorage (síncrono, sin await)
          const aperturaLS = obtenerAperturaLocalStorage();
          if (aperturaLS && aperturaLS.cajero_id === usuarioActual.id) {
            console.log(
              "✓ Apertura activa encontrada en localStorage:",
              aperturaLS,
            );
            setAperturaRegistrada(true);
            // Asegurar que está en STORE.CIERRES para que funcionen los cálculos IDB
            try {
              const existentes = await getByIndex<any>(
                STORE.CIERRES,
                "cajero_id",
                usuarioActual.id,
              );
              if (!existentes.find((c) => c.estado === "APERTURA")) {
                const numId =
                  parseInt(aperturaLS.id as string) > 0
                    ? parseInt(aperturaLS.id as string)
                    : -Date.now();
                await upsertOne(STORE.CIERRES, {
                  id: numId,
                  cajero_id: aperturaLS.cajero_id,
                  cajero: (aperturaLS as any).cajero || "",
                  caja: aperturaLS.caja,
                  fecha: aperturaLS.fecha,
                  estado: "APERTURA",
                });
                console.log(
                  "✓ Apertura sincronizada en STORE.CIERRES desde localStorage",
                );
              }
            } catch (_) {}
          } else {
            // Capa IndexedDB (apertura_cache)
            const aperturaCache = await obtenerAperturaCache();
            if (aperturaCache) {
              let cacheValido = true;
              try {
                const cierresIDB = await getByIndex<any>(
                  STORE.CIERRES,
                  "cajero_id",
                  aperturaCache.cajero_id,
                );
                const masReciente = [...cierresIDB].sort(
                  compareTurnoRecordsByRecency,
                )[0];
                const cacheEsViejoCerrado =
                  masReciente &&
                  masReciente.estado === "CIERRE" &&
                  compareTurnoRecordsByRecency(
                    masReciente,
                    aperturaCache as any,
                  ) <= 0;

                if (cacheEsViejoCerrado) {
                  cacheValido = false;
                  console.warn(
                    "⚠ apertura_cache quedó desfasada por cierre más reciente → limpiando",
                  );
                  await limpiarAperturaCache();
                }
              } catch {
                /* ignore */
              }

              if (!cacheValido) {
                setAperturaRegistrada(false);
                return;
              }

              console.log(
                "✓ Apertura activa encontrada en IndexedDB:",
                aperturaCache,
              );
              // Sincronizar localStorage con apertura_cache
              guardarAperturaLocalStorage({
                id: aperturaCache.id,
                cajero_id: aperturaCache.cajero_id,
                caja: aperturaCache.caja,
                fecha: aperturaCache.fecha,
                estado: aperturaCache.estado,
              });
              setAperturaRegistrada(true);
              // Asegurar que está en STORE.CIERRES
              try {
                const existentes = await getByIndex<any>(
                  STORE.CIERRES,
                  "cajero_id",
                  aperturaCache.cajero_id,
                );
                if (!existentes.find((c) => c.estado === "APERTURA")) {
                  const numId =
                    parseInt(aperturaCache.id as string) > 0
                      ? parseInt(aperturaCache.id as string)
                      : -Date.now();
                  await upsertOne(STORE.CIERRES, {
                    id: numId,
                    cajero_id: aperturaCache.cajero_id,
                    cajero: (aperturaCache as any).cajero || "",
                    caja: aperturaCache.caja,
                    fecha: aperturaCache.fecha,
                    estado: "APERTURA",
                  });
                  console.log(
                    "✓ Apertura sincronizada en STORE.CIERRES desde apertura_cache",
                  );
                }
              } catch (_) {}
            } else {
              console.warn("⚠ No hay apertura en ningún cache");
              setAperturaRegistrada(false);
            }
          }
        }
      } catch (err: any) {
        console.error("Error verificando apertura:", err);
        console.log("🔍 DEBUG - Tipo de error:", typeof err);
        console.log("🔍 DEBUG - err.message:", err?.message);
        console.log("🔍 DEBUG - err.details:", err?.details);
        console.log("🔍 DEBUG - isOnline:", isOnline);

        // SIEMPRE intentar desde cache cuando hay error
        console.log(
          "🔄 Intentando recuperar apertura desde cache (fallback)...",
        );
        try {
          const aperturaCache = await obtenerAperturaCache();

          if (aperturaCache) {
            console.log(
              "✓ Apertura activa encontrada en cache (fallback):",
              aperturaCache,
            );
            // Si hay apertura sin cierre, se considera vigente sin importar el día
            setAperturaRegistrada(true);
          } else {
            console.warn("⚠ No hay apertura en cache");
            setAperturaRegistrada(false);
          }
        } catch (cacheErr) {
          console.error("Error verificando cache:", cacheErr);
          setAperturaRegistrada(false);
        }
      } finally {
        setVerificandoApertura(false);
      }
    }
    verificarApertura();
  }, [usuarioActual, caiInfo, isOnline]);

  // Contar cierres sin aclarar del mes actual
  useEffect(() => {
    async function contarCierresSinAclarar() {
      if (!usuarioActual) {
        setCierresSinAclarar(0);
        return;
      }
      try {
        // Obtener primer y último día del mes actual
        const ahora = new Date();
        const primerDiaMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        const ultimoDiaMes = new Date(
          ahora.getFullYear(),
          ahora.getMonth() + 1,
          0,
          23,
          59,
          59,
        );

        const fechaInicio = primerDiaMes.toISOString();
        const fechaFin = ultimoDiaMes.toISOString();

        // Contar cierres del cajero actual en el mes que NO tengan observación "aclarado"
        const { data, error } = await supabase
          .from("cierres")
          .select("id, observacion, estado")
          .eq("cajero_id", usuarioActual.id)
          .eq("tipo_registro", "cierre")
          .eq("estado", "CIERRE")
          .gte("fecha", fechaInicio)
          .lte("fecha", fechaFin);

        if (!error && data) {
          console.log("🔍 DEBUG - Todos los cierres del mes:", data);

          // Filtrar manualmente los que NO tienen observación "aclarado"
          const sinAclarar = data.filter((cierre) => {
            const obs = (cierre.observacion || "")
              .toString()
              .toLowerCase()
              .trim();
            const noAclarado = obs !== "aclarado";
            return noAclarado;
          });

          console.log("📝 DEBUG - Cierres sin aclarar:", sinAclarar);
          setCierresSinAclarar(sinAclarar.length);
        } else {
          console.error("❌ Error obteniendo cierres:", error);
          setCierresSinAclarar(0);
        }
      } catch (err) {
        console.error("Error contando cierres sin aclarar:", err);
        setCierresSinAclarar(0);
      }
    }
    contarCierresSinAclarar();
  }, [usuarioActual]);

  // Redirección automática desactivada - el usuario puede navegar libremente
  // La lógica de verificación de cierres solo se ejecuta desde el callback onCierreGuardado

  // Los modales se deben renderizar dentro del return principal

  // Función para cargar productos (desde Supabase o cache)
  const cargarProductos = async () => {
    setLoading(true);
    try {
      // Si está offline, cargar directamente desde cache
      if (!isOnline) {
        console.log("⚠ Sin conexión. Cargando productos desde cache...");
        const productosCache = await obtenerProductosCache();
        if (productosCache.length > 0) {
          console.log(
            `✓ ${productosCache.length} productos cargados desde cache`,
          );
          setProductos(productosCache as any);
          setError("");
        } else {
          console.warn("⚠ No hay productos en cache");
          setError("No hay productos en cache. Conecta a internet.");
        }
        setLoading(false);
        return;
      }

      // Si está online, cargar desde Supabase
      const { data, error } = await supabase.from("productos").select("*");
      if (error) throw error;
      setProductos(data);

      // Guardar automáticamente en cache para uso offline
      await guardarProductosCache(data);
      console.log(`✓ ${data.length} productos guardados en cache`);

      // Pre-cargar imágenes en segundo plano (fire-and-forget)
      precargarImagenesProductos(data).catch((err) =>
        console.warn("Error pre-cargando imágenes:", err),
      );

      setError("");
      setLoading(false);
    } catch (err) {
      console.error("Error al cargar productos desde Supabase:", err);
      // Intentar cargar desde cache si falla
      try {
        const productosCache = await obtenerProductosCache();
        if (productosCache.length > 0) {
          console.log(
            `✓ ${productosCache.length} productos cargados desde cache (fallback)`,
          );
          setProductos(productosCache as any);
          setError("");
        } else {
          setError("Error al cargar productos");
        }
      } catch (cacheErr) {
        console.error("Error al cargar productos desde cache:", cacheErr);
        setError("Error al cargar productos");
      }
      setLoading(false);
    }
  };

  // Fetch products from Supabase
  useEffect(() => {
    cargarProductos();
  }, [isOnline]);

  // Bloquear scroll global al montar
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // No-op: QZ Tray integration removed.

  // Add product to selection
  const agregarProducto = (producto: Producto) => {
    setSeleccionados((prev) => {
      const existe = prev.find((p) => p.id === producto.id);
      const tasa = obtenerTasaImpuesto(producto.tipo_impuesto, producto.tipo);
      let nuevos;
      if (existe) {
        nuevos = prev.map((p) =>
          p.id === producto.id ? { ...p, cantidad: p.cantidad + 1 } : p,
        );
      } else {
        nuevos = [
          ...prev,
          {
            ...producto,
            cantidad: 1,
            tipo: producto.tipo,
            tipo_impuesto: String(tasa),
            tasa_impuesto: tasa,
            complementos: [],
            piezas: "PIEZAS VARIAS",
          },
        ];
      }
      localStorage.setItem("seleccionados", JSON.stringify(nuevos));
      return nuevos;
    });
  };

  // función de prueba temporal eliminada

  // Remove product from selection
  const eliminarProducto = (id: string) => {
    setSeleccionados((prev) => {
      const existe = prev.find((p) => p.id === id);
      if (existe && existe.cantidad > 1) {
        const nuevos = prev.map((p) =>
          p.id === id ? { ...p, cantidad: p.cantidad - 1 } : p,
        );
        localStorage.setItem("seleccionados", JSON.stringify(nuevos));
        return nuevos;
      }
      const nuevos = prev.filter((p) => p.id !== id);
      localStorage.setItem("seleccionados", JSON.stringify(nuevos));
      return nuevos;
    });
    // Si la fila del producto se elimina, quitar su descuento
    const existente = seleccionados.find((p) => p.id === id);
    if (!existente || existente.cantidad <= 1) {
      setDescuentosProductos((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  // Clear all selected products
  const limpiarSeleccion = () => {
    setSeleccionados([]);
    setDescuentosProductos(new Set());
    localStorage.removeItem("seleccionados");
  };

  // Guardar gasto en la tabla 'gastos'
  const guardarGasto = async () => {
    // Prevenir múltiples ejecuciones simultáneas
    if (guardandoGasto) {
      console.log("⚠ Ya se está guardando un gasto, ignorando clic adicional");
      return;
    }

    // Validaciones básicas
    const montoNum = parseFloat(gastoMonto);
    if (isNaN(montoNum) || montoNum <= 0) {
      alert("Ingrese un monto válido mayor que 0");
      return;
    }
    if (!gastoMotivo.trim()) {
      alert("Ingrese el motivo del gasto");
      return;
    }
    setGuardandoGasto(true);
    try {
      // Usar la fecha local (YYYY-MM-DD) para evitar conversión a UTC
      const { day: fecha } = getLocalDayRange(); // devuelve 'YYYY-MM-DD' en hora local
      // Concatenar motivo y número de factura en la columna 'motivo'
      const motivoCompleto =
        gastoMotivo.trim() +
        (gastoFactura ? ` | Factura: ${gastoFactura.trim()}` : "");
      // Determinar caja asignada (usar caiInfo o consultar si es necesario)
      let cajaAsignada = caiInfo?.caja_asignada;
      if (!cajaAsignada) {
        // Intentar desde IDB (STORE.CAI_FACTURAS)
        try {
          const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
          const caiLocal = caiRows.find(
            (r) => r.cajero_id === usuarioActual?.id && r.activo !== false,
          );
          cajaAsignada = caiLocal?.caja_asignada || "";
        } catch {
          /* sin IDB */
        }
      }
      if (!cajaAsignada) {
        try {
          const { data: caiData } = await supabase
            .from("cai_facturas")
            .select("caja_asignada")
            .eq("cajero_id", usuarioActual?.id)
            .single();
          cajaAsignada = caiData?.caja_asignada || "";
        } catch {
          /* offline */
        }
      }
      const fechaHora = formatToHondurasLocal(new Date());

      const gastoData = {
        id: -Date.now(), // id temporal negativo para IDB (será reemplazado por id real de Supabase en sincronización)
        tipo: motivoCompleto, // Guardar en 'tipo' para compatibilidad
        monto: montoNum,
        descripcion: motivoCompleto, // También en descripción
        cajero: usuarioActual?.nombre || "",
        cajero_id: usuarioActual?.id || null,
        caja: cajaAsignada || "",
        fecha_hora: fechaHora,
      };

      // PASO 1: Guardar primero en IndexedDB
      const gastoIdLocal = await guardarGastoLocal(gastoData);
      console.log(`✓ Gasto guardado en IndexedDB (ID: ${gastoIdLocal})`);

      // PASO 2: Intentar guardar en Supabase
      try {
        const { error } = await supabase.from("gastos").insert([
          {
            fecha,
            fecha_hora: fechaHora,
            monto: montoNum,
            motivo: motivoCompleto,
            cajero_id: usuarioActual?.id,
            caja: cajaAsignada,
          },
        ]);

        if (error) {
          console.error("Error guardando gasto en Supabase:", error);
          console.log("⚠ Gasto guardado localmente, se sincronizará después");
        } else {
          console.log(
            "✓ Gasto guardado en Supabase (permanece en IDB como fuente primaria)",
          );
        }
      } catch (supabaseErr) {
        console.error("Error de conexión con Supabase:", supabaseErr);
        console.log(
          "⚠ Gasto guardado localmente, se sincronizará cuando haya conexión",
        );
      }

      // Actualizar contador de pendientes
      // const count = await obtenerContadorPendientes();
      // setPendientesCount(count);

      // éxito: cerrar y resetear modal de formulario y mostrar modal de éxito
      cerrarRegistrarGasto();
      setGastoSuccessMessage("Gasto registrado correctamente");
      setShowGastoSuccess(true);
    } catch (err) {
      console.error("Error guardando gasto:", err);
      alert("Error al guardar gasto. Revisa la consola.");
    } finally {
      setGuardandoGasto(false);
    }
  };

  // ── Guardar Cuenta por Pagar ────────────────────────────────
  const guardarCxP = async () => {
    const montoNum = parseFloat(cxpMonto);
    if (!cxpProveedorId) {
      alert("Selecciona un proveedor");
      return;
    }
    if (isNaN(montoNum) || montoNum <= 0) {
      alert("Ingresa un monto válido mayor que 0");
      return;
    }
    if (!cxpMotivo.trim()) {
      alert("Ingresa el motivo o concepto de la deuda");
      return;
    }
    setGuardandoCxP(true);
    try {
      const input: CuentaPorPagarInput = {
        proveedor_id: cxpProveedorId,
        concepto: cxpMotivo.trim(),
        monto_total: montoNum,
        saldo_pendiente: montoNum,
        estado: "pendiente",
        cajero_id: usuarioActual?.id,
        cajero: usuarioActual?.nombre || "",
        fecha_emision: formatToHondurasLocal(),
      };
      await crearCuentaPorPagar(input);
      cerrarCxP();
      setShowCxPSuccess(true);
      setTimeout(() => setShowCxPSuccess(false), 3500);
    } catch (e: any) {
      alert("Error al registrar cuenta por pagar: " + (e?.message ?? e));
    } finally {
      setGuardandoCxP(false);
    }
  };

  // Función para buscar factura para devolución
  const buscarFacturaDevolucion = async () => {
    if (!devolucionFactura.trim()) {
      alert("Ingrese el número de factura");
      return;
    }
    setDevolucionBuscando(true);
    try {
      const numFac = devolucionFactura.trim();

      // ── Buscar primero en IDB ─────────────────────────────────────────────
      let venta: any = null;
      const todasVentasIDB = await getByIndex<any>(
        STORE.VENTAS,
        "cajero_id",
        usuarioActual?.id,
      );
      venta =
        todasVentasIDB.find(
          (v) => v.factura === numFac && v.tipo !== "DEVOLUCION",
        ) ?? null;

      // Fallback Supabase si no está en IDB y hay conexión
      if (!venta && navigator.onLine) {
        const { data, error } = await supabase
          .from("ventas")
          .select("*")
          .eq("factura", numFac)
          .eq("cajero_id", usuarioActual?.id)
          .neq("tipo", "DEVOLUCION")
          .maybeSingle();
        if (!error && data) venta = data;
      }

      if (!venta) {
        setShowDevolucionError(true);
        setDevolucionData(null);
        return;
      }

      // Verificar si ya existe una devolución — IDB primero
      const devExistenteIDB = todasVentasIDB.find(
        (v) => v.factura === "DEV-" + numFac,
      );
      if (devExistenteIDB) {
        alert("Esta factura ya tiene una devolución registrada");
        setDevolucionData(null);
        setDevolucionBuscando(false);
        return;
      }
      if (navigator.onLine) {
        const { data: devolucionExistente } = await supabase
          .from("ventas")
          .select("id")
          .eq("factura", "DEV-" + numFac)
          .eq("cajero_id", usuarioActual?.id)
          .limit(1);
        if (devolucionExistente && devolucionExistente.length > 0) {
          alert("Esta factura ya tiene una devolución registrada");
          setDevolucionData(null);
          setDevolucionBuscando(false);
          return;
        }
      }

      // Normalizar datos de pago (ahora están directamente en ventas)
      const pagosNorm: any[] = [];
      if (parseFloat(venta.efectivo || 0) > 0)
        pagosNorm.push({ tipo: "efectivo", monto: venta.efectivo });
      if (parseFloat(venta.tarjeta || 0) > 0)
        pagosNorm.push({ tipo: "tarjeta", monto: venta.tarjeta });
      if (parseFloat(venta.transferencia || 0) > 0)
        pagosNorm.push({ tipo: "transferencia", monto: venta.transferencia });
      if (parseFloat(venta.dolares || 0) > 0)
        pagosNorm.push({
          tipo: "dolares",
          monto: venta.dolares,
          usd_monto: venta.dolares_usd,
        });

      setDevolucionData({
        factura: venta,
        pagos: pagosNorm,
      });
    } catch (err) {
      console.error("Error buscando factura:", err);
      alert("Error al buscar factura");
      setDevolucionData(null);
    } finally {
      setDevolucionBuscando(false);
    }
  };

  // Función para procesar la devolución
  const procesarDevolucion = async () => {
    if (!devolucionData) return;

    setDevolucionProcesando(true);
    try {
      const { factura } = devolucionData;
      const fechaHoraActual = formatToHondurasLocal();
      const totalNeg = -Math.abs(parseFloat(factura.total || 0));

      const ventaDevolucion: any = {
        fecha_hora: fechaHoraActual,
        cajero: usuarioActual?.nombre || "",
        cajero_id: usuarioActual?.id || null,
        caja: caiInfo?.caja_asignada || factura.caja || "",
        cai: factura.cai || "",
        factura: "DEV-" + factura.factura,
        cliente: factura.cliente + " (DEVOLUCIÓN)",
        tipo: "DEVOLUCION",
        tipo_orden: factura.tipo_orden || "",
        operation_id: crypto.randomUUID(),
        productos: factura.productos,
        sub_total: (-parseFloat(factura.sub_total || 0)).toFixed(2),
        isv_15: (-parseFloat(factura.isv_15 || 0)).toFixed(2),
        isv_18: (-parseFloat(factura.isv_18 || 0)).toFixed(2),
        descuento: factura.descuento ? -parseFloat(factura.descuento) : null,
        total: totalNeg.toFixed(2),
        es_donacion: null,
        // Negar exactamente los campos de pago originales para que el resumen quede en 0
        efectivo: -parseFloat(factura.efectivo || 0),
        cambio: -parseFloat(factura.cambio || 0),
        total_recibido: totalNeg,
        tarjeta: -parseFloat(factura.tarjeta || 0),
        transferencia: -parseFloat(factura.transferencia || 0),
        dolares: -parseFloat(factura.dolares || 0),
        dolares_usd: -parseFloat(factura.dolares_usd || 0),
        delivery: -parseFloat(factura.delivery || 0),
        banco: factura.banco || null,
        tarjeta_num: factura.tarjeta_num || null,
        autorizacion: factura.autorizacion || null,
        ref_transferencia: factura.ref_transferencia || null,
      };

      // ── Guardar en IDB primero (id negativo = pendiente de subir) ─────────
      const tempId = -Date.now();
      await upsertOne(STORE.VENTAS, { ...ventaDevolucion, id: tempId });
      console.log("✓ Devolución guardada en IDB (id temporal:", tempId, ")");

      // ── Intentar Supabase si hay conexión ─────────────────────────────────
      if (navigator.onLine) {
        try {
          const { data: inserted, error: ventaError } = await supabase
            .from("ventas")
            .insert([ventaDevolucion])
            .select("id")
            .single();
          if (ventaError) {
            console.error("Error devolución en Supabase:", ventaError);
          } else if (inserted?.id) {
            // Reemplazar registro temporal con el id real
            await upsertOne(STORE.VENTAS, {
              ...ventaDevolucion,
              id: inserted.id,
            });
            try {
              await deleteById(STORE.VENTAS, tempId);
            } catch (_) {}
          }
        } catch (supaErr) {
          console.warn(
            "Sin conexión al guardar devolución, queda en IDB:",
            supaErr,
          );
        }
      }

      // Actualizar conteo de turno
      fetchConteoTurno();

      // Éxito
      setShowDevolucionPasswordModal(false);
      setShowDevolucionModal(false);
      setShowDevolucionSuccess(true);
      setDevolucionFactura("");
      setDevolucionData(null);
      setDevolucionPassword("");
    } catch (err) {
      console.error("Error procesando devolución:", err);
      alert("Error al procesar la devolución");
    } finally {
      setDevolucionProcesando(false);
    }
  };

  // Función para validar contraseña del cajero — IDB primero, Supabase fallback
  const validarPasswordCajero = async (password: string): Promise<boolean> => {
    try {
      // IDB primero
      const usuarios = await getUsuariosLocal();
      const usuarioIDB = usuarios.find((u) => u.id === usuarioActual?.id);
      if (usuarioIDB) {
        return (
          usuarioIDB.clave === password || usuarioIDB.password === password
        );
      }
      // Supabase fallback
      if (!navigator.onLine) return false;
      const { data, error } = await supabase
        .from("usuarios")
        .select("clave")
        .eq("id", usuarioActual?.id)
        .single();
      if (error || !data) return false;
      return data.clave === password;
    } catch (err) {
      console.error("Error en validarPasswordCajero:", err);
      return false;
    }
  };

  // Función para registrar apertura con fondo inicial en 0
  const registrarAperturaRapida = async () => {
    if (!usuarioActual) return;
    setRegistrandoApertura(true);
    try {
      // ── Capa 1: verificar localStorage (más rápido, funciona sin red) ──
      const aperturaLS = obtenerAperturaLocalStorage();
      if (aperturaLS && aperturaLS.cajero_id === usuarioActual.id) {
        console.log(
          "✓ Apertura activa detectada en localStorage → no se crea duplicado",
        );
        setAperturaRegistrada(true);
        setRegistrandoApertura(false);
        return;
      }

      // ── Capa 2: verificar IndexedDB (offline) ──
      const aperturaCache = await obtenerAperturaCache();
      if (aperturaCache && aperturaCache.cajero_id === usuarioActual.id) {
        try {
          const cierresIDB = await getByIndex<any>(
            STORE.CIERRES,
            "cajero_id",
            usuarioActual.id,
          );
          const masReciente = [...cierresIDB].sort(
            compareTurnoRecordsByRecency,
          )[0];
          const cacheEsViejoCerrado =
            masReciente &&
            (masReciente.tipo_registro === "cierre" ||
              masReciente.estado === "CIERRE") &&
            compareTurnoRecordsByRecency(masReciente, aperturaCache as any) <=
              0;

          if (cacheEsViejoCerrado) {
            console.log(
              "⚠ Apertura cache antigua detectada tras cierre → limpiando cache y continuando apertura nueva",
            );
            await limpiarAperturaCache();
          } else {
            console.log(
              "✓ Apertura activa detectada en IndexedDB → no se crea duplicado",
            );
            setAperturaRegistrada(true);
            setRegistrandoApertura(false);
            return;
          }
        } catch {
          console.log(
            "✓ Apertura activa detectada en IndexedDB → no se crea duplicado",
          );
          setAperturaRegistrada(true);
          setRegistrandoApertura(false);
          return;
        }
      }

      // ── Capa 3: verificar en Supabase (con red) ──
      // Obtener caja asignada
      let cajaAsignada = caiInfo?.caja_asignada;
      if (!cajaAsignada) {
        if (isOnline) {
          const { data: caiData } = await supabase
            .from("cai_facturas")
            .select("caja_asignada")
            .eq("cajero_id", usuarioActual.id)
            .single();
          cajaAsignada = caiData?.caja_asignada || "";
        } else {
          // Offline: intentar desde IndexedDB
          const caiCacheData = await obtenerCaiCache(usuarioActual.id);
          cajaAsignada = caiCacheData?.caja_asignada || "";
        }
      }
      if (!cajaAsignada) {
        alert("No tienes caja asignada. Contacta al administrador.");
        setRegistrandoApertura(false);
        return;
      }

      // ── Modo OFFLINE: crear apertura local y sincronizar después ──
      if (!isOnline) {
        const fechaLocal = formatToHondurasLocal();
        const tempId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await guardarAperturaCache({
          id: tempId,
          cajero_id: usuarioActual.id,
          cajero: usuarioActual.nombre,
          caja: cajaAsignada,
          fecha: fechaLocal,
          estado: "APERTURA",
          pending_sync: true,
        });
        guardarAperturaLocalStorage({
          id: tempId,
          cajero_id: usuarioActual.id,
          cajero: usuarioActual.nombre,
          caja: cajaAsignada,
          fecha: fechaLocal,
          estado: "APERTURA",
          pending_sync: true,
        });
        // STORE.CIERRES ya fue actualizado dentro de guardarAperturaCache con pending_sync: true
        console.log(
          "✓ Apertura offline creada localmente (se sincronizará al reconectar)",
        );
        setAperturaRegistrada(true);
        setRegistrandoApertura(false);
        return;
      }

      // ── Capa 4 (extra): verificar en Supabase el último movimiento real ──
      const { data: ultimoMovimiento } = await supabase
        .from("cierres")
        .select("id, cajero_id, caja, fecha, tipo_registro, estado")
        .eq("cajero_id", usuarioActual.id)
        .eq("caja", cajaAsignada)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (
        ultimoMovimiento?.tipo_registro === "apertura" ||
        ultimoMovimiento?.estado === "APERTURA"
      ) {
        console.log(
          "✓ Apertura activa encontrada en Supabase → no se crea duplicado",
        );
        // Sincronizar cache con la apertura que ya existe
        await guardarAperturaCache({
          id: ultimoMovimiento.id.toString(),
          cajero_id: ultimoMovimiento.cajero_id,
          caja: ultimoMovimiento.caja,
          fecha: ultimoMovimiento.fecha,
          estado: ultimoMovimiento.estado,
        });
        setAperturaRegistrada(true);
        setRegistrandoApertura(false);
        return;
      }

      // Registrar apertura con estado='APERTURA' y fondo inicial en 0
      const fechaApertura = formatToHondurasLocal();
      const { data: aperturaInsertada, error } = await supabase
        .from("cierres")
        .insert([
          {
            tipo_registro: "apertura",
            cajero: usuarioActual?.nombre,
            cajero_id: usuarioActual?.id,
            caja: cajaAsignada,
            fecha: fechaApertura,
            fondo_fijo_registrado: 0,
            fondo_fijo: 0,
            efectivo_registrado: 0,
            efectivo_dia: 0,
            monto_tarjeta_registrado: 0,
            monto_tarjeta_dia: 0,
            transferencias_registradas: 0,
            transferencias_dia: 0,
            dolares_registrado: 0,
            dolares_dia: 0,
            diferencia: 0,
            estado: "APERTURA",
          },
        ])
        .select();

      if (error) {
        console.error("Error registrando apertura:", error);
        alert("Error al registrar apertura: " + error.message);
      } else {
        setAperturaRegistrada(true);

        // Guardar en cache para uso offline
        if (aperturaInsertada && aperturaInsertada.length > 0) {
          const apertura = aperturaInsertada[0];
          await guardarAperturaCache({
            id: apertura.id.toString(),
            cajero_id: apertura.cajero_id,
            caja: apertura.caja,
            fecha: apertura.fecha,
            estado: apertura.estado,
          });
          console.log("✓ Apertura guardada en cache");
        }
      }
    } catch (err: any) {
      console.error("Error registrando apertura:", err);
      alert("Error al registrar apertura: " + (err?.message || String(err)));
    } finally {
      setRegistrandoApertura(false);
    }
  };

  // Calculate total
  const total = seleccionados.reduce(
    (sum, p) => sum + p.precio * p.cantidad,
    0,
  );

  // Descuento acumulado: 1 descuento de montoDescuentoComida por cada producto marcado
  const totalDescuento = posConfig.descuento_habilitado
    ? descuentosProductos.size * montoDescuentoComida
    : 0;
  const totalConDescuento = Math.max(0, total - totalDescuento);
  const mostrarReciboEnHeader = posConfig.tipo_venta !== "solo_factura";
  const textoCajeroHeader = caiInfo
    ? `${caiInfo.nombre_cajero} | Caja: ${caiInfo.caja_asignada}`
    : "";
  const textoReciboHeader =
    mostrarReciboEnHeader && facturaActual ? `Recibo: ${facturaActual}` : "";
  const tituloHeaderCajero = caiInfo
    ? `${textoCajeroHeader}${textoReciboHeader ? ` | ${textoReciboHeader}` : ""}`
    : textoReciboHeader;

  // Filter products by type and subcategory
  const productosFiltrados = productos.filter((p) => {
    if (p.tipo !== activeTab) return false;
    if (activeTab === "comida" && subcategoriaFiltro) {
      return p.subcategoria === subcategoriaFiltro;
    }
    return true;
  });

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background:
          theme === "lite"
            ? "rgba(255,255,255,0.95)"
            : "linear-gradient(135deg, #232526 0%, #414345 100%)",
        color: theme === "lite" ? "#222" : "#f5f5f5",
        fontFamily: "Arial, sans-serif",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        alignItems: "center",
        zIndex: 999,
        transition: "background 0.3s, color 0.3s",
      }}
    >
      <style>{`
        .form-input, .form-select {
          width: 100%;
          padding: 10px 14px;
          border-radius: 10px;
          border: 1px solid rgba(0,0,0,0.08);
          background: rgba(255,255,255,0.92);
          box-shadow: 0 2px 6px rgba(16,24,40,0.04);
          font-size: 14px;
          transition: all 0.18s ease;
          color: #0b1220;
          appearance: none;
        }
        :where(.dark) .form-input, :where(.dark) .form-select {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          color: #e6eef8;
          box-shadow: none;
        }
        .form-input::placeholder { color: #94a3b8; }
        .form-input:focus, .form-select:focus {
          outline: none;
          border-color: #60a5fa;
          box-shadow: 0 6px 20px rgba(37,99,235,0.12);
          transform: translateY(-1px);
        }
        /* tamaños compactos para formularios dentro de modales */
        .form-input.small { padding: 8px 10px; font-size: 13px; border-radius: 8px; }
        
        /* Animación para indicador de conexión */
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes menuIn {
          from { transform: scale(0.82) translateY(32px); opacity: 0; filter: blur(4px); }
          to   { transform: scale(1)    translateY(0);    opacity: 1; filter: blur(0); }
        }
        @keyframes menuOut {
          from { transform: scale(1)    translateY(0);    opacity: 1; filter: blur(0); }
          to   { transform: scale(0.88) translateY(20px); opacity: 0; filter: blur(2px); }
        }
        @keyframes backdropIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes backdropOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @keyframes btnSlideIn {
          from { transform: translateX(-14px); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
        .menu-btn {
          position: relative;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 18px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.07);
          font-weight: 700;
          font-size: 15px;
          cursor: pointer;
          text-align: left;
          transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
          overflow: hidden;
          animation: btnSlideIn 320ms cubic-bezier(0.34,1.56,0.64,1) both;
        }
        .menu-btn::after {
          content: '';
          position: absolute;
          inset: 0;
          background: rgba(255,255,255,0);
          transition: background 160ms ease;
          border-radius: inherit;
        }
        .menu-btn:hover { transform: translateY(-3px) scale(1.02); box-shadow: 0 10px 28px rgba(0,0,0,0.12); }
        .menu-btn:hover::after { background: rgba(0,0,0,0.04); }
        .menu-btn:active { transform: scale(0.97); }
        .menu-btn .btn-icon { font-size: 22px; min-width: 28px; text-align: center; }
        .menu-btn .btn-label { font-size: 14px; font-weight: 800; letter-spacing: 0.3px; }
        .menu-btn .btn-desc { font-size: 11px; font-weight: 500; opacity: 0.55; margin-top: 1px; }
      `}</style>
      {/* Indicador de conexión e información del cajero */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 32,
          zIndex: 10001,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 4,
        }}
      >
        {/* Primera fila: cajero + botones */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              color: isOnline ? "#43a047" : "#d32f2f",
              fontWeight: 700,
              fontSize: 15,
              marginLeft: 12,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "48vw",
              display: "inline-block",
            }}
            title={tituloHeaderCajero}
          >
            {caiInfo ? textoCajeroHeader : ""}
            {textoReciboHeader
              ? caiInfo
                ? ` | ${textoReciboHeader}`
                : textoReciboHeader
              : ""}
          </span>
          {/* Botones de tema y funciones principales en la misma fila */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginLeft: 16,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {/* Los controles de tema ahora están en el Menú central */}

            {/* Botones que requieren apertura registrada */}
            {aperturaRegistrada && (
              <>
                {/* Separador visual */}
                <div
                  style={{
                    width: 1,
                    height: 24,
                    background:
                      theme === "lite"
                        ? "rgba(0,0,0,0.1)"
                        : "rgba(255,255,255,0.1)",
                  }}
                />
              </>
            )}

            {/* Botones principales: el botón de Cierre ahora está dentro del menú central */}
          </div>
        </div>
        {/* fin primera fila */}
        {/* QZ Tray indicators removed */}
      </div>
      {/* Modal de resumen de caja (fuera del header) */}
      {showResumen && (
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
            zIndex: 110000,
            padding: "8px",
            boxSizing: "border-box",
          }}
          onClick={() => setShowResumen(false)}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#1e2130",
              color: theme === "lite" ? "#1e293b" : "#f1f5f9",
              borderRadius: "clamp(10px, 2vw, 18px)",
              padding: 0,
              width: "min(500px, 100%)",
              maxHeight: "95dvh",
              overflowY: "auto",
              boxShadow: "0 20px 60px #0007",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Encabezado */}
            <div
              style={{
                background: "linear-gradient(135deg,#1976d2,#0d47a1)",
                color: "#fff",
                padding: "clamp(12px,3vw,20px) clamp(14px,4vw,24px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                position: "sticky",
                top: 0,
                zIndex: 1,
                flexShrink: 0,
                borderRadius: "clamp(10px,2vw,18px) clamp(10px,2vw,18px) 0 0",
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: "clamp(16px,4.5vw,22px)",
                  }}
                >
                  🏦 Resumen de Caja
                </div>
                <div
                  style={{
                    fontSize: "clamp(10px,2.5vw,13px)",
                    opacity: 0.85,
                    marginTop: 2,
                  }}
                >
                  Resumen del turno actual
                </div>
              </div>
              <button
                onClick={() => setShowResumen(false)}
                style={{
                  background: "rgba(255,255,255,0.18)",
                  border: "none",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "6px 13px",
                  fontWeight: 700,
                  fontSize: 16,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {resumenLoading ? (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  color: "#1976d2",
                  fontSize: 16,
                }}
              >
                Cargando...
              </div>
            ) : resumenData ? (
              <div style={{ padding: "clamp(12px,3.5vw,20px)" }}>
                {/* ── INGRESOS POR MÉTODO DE PAGO ── */}
                <div
                  style={{
                    fontSize: "clamp(9px,2.2vw,11px)",
                    fontWeight: 700,
                    letterSpacing: 1,
                    color: "#64748b",
                    marginBottom: 8,
                    textTransform: "uppercase",
                  }}
                >
                  Ingresos por método de pago
                </div>

                {[
                  {
                    label: "Efectivo",
                    raw: resumenData.efectivo - resumenData.gastos,
                    display: `L ${(resumenData.efectivo - resumenData.gastos).toFixed(2)}`,
                    sub: (() => {
                      const partes: string[] = [];
                      // Mostrar −Cambio solo si el efectivo neto es positivo.
                      // Si efectivo=0 (devolucion cancela venta), el cambio ya
                      // está incorporado en el neto y mostrarlo sería confuso.
                      if (
                        (resumenData.cambio ?? 0) > 0 &&
                        (resumenData.efectivo ?? 0) > 0
                      )
                        partes.push(
                          `−Cambio: L ${(resumenData.cambio ?? 0).toFixed(2)}`,
                        );
                      if (resumenData.gastos > 0)
                        partes.push(
                          `−Gastos: L ${resumenData.gastos.toFixed(2)}`,
                        );
                      return partes.length > 0 ? partes.join("  ·  ") : null;
                    })(),
                    icon: "💵",
                    color: "#16a34a",
                  },
                  {
                    label: "Tarjeta",
                    raw: resumenData.tarjeta,
                    display: `L ${resumenData.tarjeta.toFixed(2)}`,
                    sub: null,
                    icon: "💳",
                    color: "#1976d2",
                  },
                  {
                    label: "Transferencia",
                    raw: resumenData.transferencia,
                    display: `L ${resumenData.transferencia.toFixed(2)}`,
                    sub: null,
                    icon: "🏦",
                    color: "#7c3aed",
                  },
                  {
                    label: "Dólares",
                    raw: resumenData.dolares_convertidos ?? resumenData.dolares,
                    display: `L ${(resumenData.dolares_convertidos ?? resumenData.dolares).toFixed(2)}`,
                    sub:
                      resumenData.dolares_usd != null &&
                      resumenData.dolares_usd > 0
                        ? `$${resumenData.dolares_usd.toFixed(2)} USD × ${resumenData.tasa_dolar?.toFixed(2)}`
                        : null,
                    icon: "💱",
                    color: "#d97706",
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "clamp(7px,2vw,11px) clamp(9px,2.5vw,14px)",
                      borderRadius: 10,
                      marginBottom: 6,
                      background: theme === "lite" ? "#f8fafc" : "#252a3d",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "clamp(15px,4vw,20px)",
                          flexShrink: 0,
                        }}
                      >
                        {row.icon}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "clamp(12px,3.2vw,15px)",
                          }}
                        >
                          {row.label}
                        </div>
                        {row.sub && (
                          <div
                            style={{
                              fontSize: "clamp(9px,2.2vw,11px)",
                              color: "#94a3b8",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {row.sub}
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: "clamp(13px,3.5vw,16px)",
                        color: row.color,
                        flexShrink: 0,
                      }}
                    >
                      {row.display}
                    </div>
                  </div>
                ))}

                {/* ── TOTAL GENERAL ── */}
                {(() => {
                  const efectivoNeto =
                    resumenData.efectivo - resumenData.gastos;
                  const totalGeneral =
                    efectivoNeto +
                    resumenData.tarjeta +
                    resumenData.transferencia +
                    (resumenData.dolares_convertidos ?? resumenData.dolares);
                  return (
                    <div
                      style={{
                        background: "linear-gradient(135deg,#1976d2,#0d47a1)",
                        borderRadius: 12,
                        padding: "clamp(11px,3vw,15px) clamp(13px,3.5vw,18px)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 10,
                        marginBottom: 8,
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: "clamp(13px,3.5vw,16px)",
                        }}
                      >
                        💰 TOTAL GENERAL
                      </div>
                      <div
                        style={{
                          color: "#fff",
                          fontWeight: 900,
                          fontSize: "clamp(17px,5vw,24px)",
                        }}
                      >
                        L {totalGeneral.toFixed(2)}
                      </div>
                    </div>
                  );
                })()}

                {/* ── GASTOS ── */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "clamp(7px,2vw,11px) clamp(9px,2.5vw,14px)",
                    borderRadius: 10,
                    background: "#fff5f5",
                    marginBottom: 16,
                    border: "1px solid #fecdd3",
                    gap: 8,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: "clamp(15px,4vw,20px)" }}>🧾</span>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "clamp(12px,3.2vw,15px)",
                        color: "#dc2626",
                      }}
                    >
                      Gastos del turno
                    </span>
                  </div>
                  <span
                    style={{
                      fontWeight: 800,
                      color: "#dc2626",
                      fontSize: "clamp(13px,3.5vw,16px)",
                      flexShrink: 0,
                    }}
                  >
                    − L {resumenData.gastos.toFixed(2)}
                  </span>
                </div>

                {/* ── PRODUCTOS VENDIDOS ── */}
                <div
                  style={{
                    borderTop: `1px solid ${theme === "lite" ? "#e2e8f0" : "#2d3555"}`,
                    paddingTop: 14,
                    fontSize: "clamp(9px,2.2vw,11px)",
                    fontWeight: 700,
                    letterSpacing: 1,
                    color: "#64748b",
                    marginBottom: 8,
                    textTransform: "uppercase",
                  }}
                >
                  Productos vendidos
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "clamp(6px,2vw,12px)",
                    marginBottom: 16,
                  }}
                >
                  {[
                    {
                      label: "Platillos",
                      value: Math.round(resumenData.platillos ?? 0),
                      icon: "🍖",
                      color: "#dc2626",
                      bg: "#fef2f2",
                    },
                    {
                      label: "Bebidas",
                      value: Math.round(resumenData.bebidas ?? 0),
                      icon: "🥤",
                      color: "#0284c7",
                      bg: "#f0f9ff",
                    },
                  ].map((c) => (
                    <div
                      key={c.label}
                      style={{
                        background: theme === "lite" ? c.bg : "#2a2f45",
                        borderRadius: 10,
                        padding: "clamp(9px,2.5vw,14px)",
                        display: "flex",
                        alignItems: "center",
                        gap: "clamp(6px,2vw,12px)",
                        border: `1px solid ${c.color}22`,
                      }}
                    >
                      <span style={{ fontSize: "clamp(18px,5vw,24px)" }}>
                        {c.icon}
                      </span>
                      <div>
                        <div
                          style={{
                            fontWeight: 900,
                            fontSize: "clamp(18px,5vw,24px)",
                            color: c.color,
                            lineHeight: 1,
                          }}
                        >
                          {c.value}
                        </div>
                        <div
                          style={{
                            fontSize: "clamp(10px,2.5vw,12px)",
                            color: "#64748b",
                            fontWeight: 600,
                          }}
                        >
                          {c.label}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── DONACIONES ── */}
                {((resumenData.platillos_donados ?? 0) > 0 ||
                  (resumenData.bebidas_donadas ?? 0) > 0) && (
                  <>
                    <div
                      style={{
                        borderTop: `1px solid ${theme === "lite" ? "#e2e8f0" : "#2d3555"}`,
                        paddingTop: 14,
                        fontSize: "clamp(9px,2.2vw,11px)",
                        fontWeight: 700,
                        letterSpacing: 1,
                        color: "#7c3aed",
                        marginBottom: 8,
                        textTransform: "uppercase",
                      }}
                    >
                      🎁 Platillos Regalados (Donaciones)
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "clamp(6px,2vw,12px)",
                      }}
                    >
                      {[
                        {
                          label: "Platillos Donados",
                          value: Math.round(resumenData.platillos_donados ?? 0),
                          icon: "🍖",
                          color: "#7c3aed",
                          bg: "#f5f3ff",
                        },
                        {
                          label: "Bebidas Donadas",
                          value: Math.round(resumenData.bebidas_donadas ?? 0),
                          icon: "🥤",
                          color: "#7c3aed",
                          bg: "#f5f3ff",
                        },
                      ].map((c) => (
                        <div
                          key={c.label}
                          style={{
                            background: theme === "lite" ? c.bg : "#2a2f45",
                            borderRadius: 10,
                            padding: "clamp(9px,2.5vw,14px)",
                            display: "flex",
                            alignItems: "center",
                            gap: "clamp(6px,2vw,12px)",
                            border: `1px solid ${c.color}33`,
                          }}
                        >
                          <span style={{ fontSize: "clamp(18px,5vw,24px)" }}>
                            {c.icon}
                          </span>
                          <div>
                            <div
                              style={{
                                fontWeight: 900,
                                fontSize: "clamp(18px,5vw,24px)",
                                color: c.color,
                                lineHeight: 1,
                              }}
                            >
                              {c.value}
                            </div>
                            <div
                              style={{
                                fontSize: "clamp(10px,2.5vw,12px)",
                                color: "#64748b",
                                fontWeight: 600,
                              }}
                            >
                              {c.label}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
                No hay datos
              </div>
            )}
          </div>
        </div>
      )}
      {/* Botón de tema: muestra la acción disponible y cambia el texto al alternar */}
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 32,
          display: "flex",
          gap: 12,
          alignItems: "center",
          zIndex: 10000,
        }}
      >
        {usuarioActual?.rol === "admin" && (
          <button
            onClick={() => (window.location.href = "/")}
            style={{
              background: "#1976d2",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 22px",
              fontWeight: 700,
              fontSize: 16,
              cursor: "pointer",
              boxShadow: "0 2px 8px #1976d222",
            }}
          >
            Volver
          </button>
        )}
        {/* Botón de cerrar sesión oculto */}
        <button style={{ display: "none" }}>Cerrar sesión</button>

        {showCierre && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              background: "rgba(0,0,0,0.18)",
              zIndex: 99999,
            }}
          >
            <RegistroCierreView
              usuarioActual={usuarioActual}
              caja={caiInfo?.caja_asignada || ""}
              onBack={() => setShowCierre(false)}
              onCierreGuardado={async () => {
                if (!setView) return;
                // Siempre navegar a resultados de caja al finalizar el cierre,
                // independientemente de si hay diferencia o no.
                // (El filtro por fecha/diferencia anterior causaba que no
                //  aparecieran las aclaraciones en cierres cuadrados o cruzando medianoche)
                setAperturaRegistrada(false);
                setView("resultadosCaja");
              }}
            />
            <button
              style={{
                position: "absolute",
                top: 24,
                right: 32,
                background: "#d32f2f",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 18px",
                fontWeight: 700,
                fontSize: 16,
                cursor: "pointer",
                zIndex: 100000,
              }}
              onClick={() => setShowCierre(false)}
            >
              Cerrar
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          top: 18,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10000,
        }}
      >
        <button
          onClick={() => openMenu()}
          title="Abrir menú"
          style={{
            background: "#263241",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            fontWeight: 700,
            fontSize: 16,
            cursor: "pointer",
            boxShadow: "0 2px 8px #0004",
          }}
        >
          ☰ Menú
        </button>
        {/* Chips de conteo del turno */}
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 6,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          {pedidosPendientesCount > 0 && (
            <span
              style={{
                background: "#1239e7",
                color: "#fff",
                borderRadius: 12,
                padding: "2px 10px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              📦 {pedidosPendientesCount}
            </span>
          )}
          <span
            style={{
              background: "#388e3c",
              color: "#fff",
              borderRadius: 12,
              padding: "2px 10px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            🍽 {platillosTurno}
          </span>
          <span
            style={{
              background: "#1976d2",
              color: "#fff",
              borderRadius: 12,
              padding: "2px 10px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            🥤 {bebidasTurno}
          </span>
          <span
            style={{
              background: "#b45309",
              color: "#fff",
              borderRadius: 12,
              padding: "2px 10px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            🍗 {piezasPolloDia}
          </span>
        </div>
      </div>

      {/* Modal de pago (fuera del bloque del botón) */}
      <PagoModal
        isOpen={showPagoModal}
        onClose={() => {
          setShowPagoModal(false);
          setPedidoPendienteEntrega(null);
        }}
        totalPedido={
          pedidoPendienteEntrega
            ? calcularTotalCobroPedido(pedidoPendienteEntrega)
            : totalConDescuento
        }
        exchangeRate={tasaCambio}
        theme={theme}
        onPagoConfirmado={async (paymentData) => {
          // ── Guard contra doble submit ──────────────────────────────
          if (isSubmittingRef.current) {
            console.warn("[facturar] Operación ya en curso, click ignorado.");
            return;
          }
          isSubmittingRef.current = true;

          // ── Obtener número de documento ATÓMICAMENTE mediante RPC ─────────────
          // FACTURA: llama siguiente_numero_factura_sar (correlativo SAR formateado)
          // RECIBO : llama obtener_siguiente_factura    (correlativo numérico simple)
          let facturaParaEstaVenta: string;
          let usandoRpc = false;
          // Datos SAR adicionales para facturacion_sar (solo FACTURA)
          let sarNumeroSecuencial: number | null = null;
          let sarFechaLimiteEmision: string | null = null;
          let sarCaiFactura: string = "";
          let sarRangoDesde: number | null = null;
          let sarRangoHasta: number | null = null;

          if (isOnline && usuarioActual?.id) {
            try {
              if (tipoDocumentoFiscal === "FACTURA") {
                // ── Ruta FACTURA: RPC nuevo con correlativo SAR formateado ────────
                const { data: sarRpc, error: sarError } = await supabase.rpc(
                  "siguiente_numero_factura_sar",
                  { p_cajero_id: usuarioActual.id },
                );
                if (!sarError && sarRpc && sarRpc.length > 0) {
                  const sarRow = sarRpc[0];
                  facturaParaEstaVenta =
                    sarRow.numero_factura_formado as string;
                  sarNumeroSecuencial = sarRow.numero_secuencial as number;
                  sarFechaLimiteEmision = sarRow.fecha_limite_emision as string;
                  sarCaiFactura = (sarRow.cai as string) || "";
                  sarRangoDesde = (sarRow.rango_desde as number) ?? null;
                  sarRangoHasta = (sarRow.rango_hasta as number) ?? null;
                  usandoRpc = true;
                  // NOTA: NO se actualiza facturaActual ni el cache aquí.
                  // facturaActual/cache solo persisten el correlativo de RECIBO.
                  // El correlativo SAR es atómico: cada RPC devuelve el siguiente correcto.
                } else if (
                  sarError?.message?.includes("SAR-001") ||
                  sarError?.message?.includes("SAR-002")
                ) {
                  // Errores fiscales críticos: CAI vencido o rango agotado
                  const msg = sarError.message.includes("SAR-002")
                    ? "¡El rango de facturas SAR está AGOTADO para este cajero!\nSolicite un nuevo CAI al SAR Honduras."
                    : "¡No existe CAI activo o vigente para este cajero!\nVerifique la configuración en el módulo CAI.";
                  alert(msg);
                  setFacturaActual("Límite alcanzado");
                  isSubmittingRef.current = false;
                  return;
                } else {
                  console.warn(
                    "[facturar] SAR RPC devolvió error, usando valor local:",
                    sarError,
                  );
                  let facturaOfflineSar: string | null = null;
                  try {
                    const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
                    const caiFact = caiRows.find(
                      (r) =>
                        r.cajero_id === usuarioActual?.id &&
                        r.tipo_comprobante === TIPO_FACTURA &&
                        r.activo !== false,
                    );
                    if (caiFact) {
                      const actual = parseInt(
                        caiFact.factura_actual || caiFact.rango_desde || "0",
                        10,
                      );
                      if (Number.isFinite(actual) && actual > 0) {
                        facturaOfflineSar = formatearNumeroSar(caiFact, actual);
                        sarNumeroSecuencial = actual;
                        sarCaiFactura = caiFact.cai || "";
                        sarFechaLimiteEmision = caiFact.fecha_limite_emision;
                        sarRangoDesde =
                          Number(caiFact.rango_desde || 0) || null;
                        sarRangoHasta =
                          Number(caiFact.rango_hasta || 0) || null;
                      }
                    }
                  } catch {
                    /* non-critical */
                  }

                  facturaParaEstaVenta =
                    facturaOfflineSar ?? `OFFLINE-${Date.now()}`;
                }
              } else {
                // ── Ruta RECIBO: RPC antiguo, correlativo numérico ────────────────
                const { data: facturaRpc, error: rpcError } =
                  await supabase.rpc("obtener_siguiente_factura", {
                    p_cajero_id: usuarioActual.id,
                  });
                if (
                  !rpcError &&
                  facturaRpc &&
                  facturaRpc !== "LIMITE_ALCANZADO" &&
                  facturaRpc !== null
                ) {
                  facturaParaEstaVenta = facturaRpc as string;
                  usandoRpc = true;
                  const siguienteDisplay = (
                    parseInt(facturaParaEstaVenta) + 1
                  ).toString();
                  try {
                    await persistirReciboActual(siguienteDisplay);
                  } catch (err) {
                    console.error(
                      "Error actualizando cache de RECIBO tras RPC:",
                      err,
                    );
                  }
                } else if (facturaRpc === "LIMITE_ALCANZADO") {
                  setFacturaActual("Límite alcanzado");
                  isSubmittingRef.current = false;
                  alert(
                    "¡Se ha alcanzado el límite de facturas para este CAI!",
                  );
                  return;
                } else {
                  console.warn(
                    "[facturar] RPC devolvió error, usando valor local:",
                    rpcError,
                  );
                  facturaParaEstaVenta =
                    facturaActual &&
                    Number.isFinite(parseInt(facturaActual)) &&
                    facturaActual !== "Límite alcanzado"
                      ? facturaActual
                      : `OFFLINE-${Date.now()}`;
                }
              }
            } catch (rpcErr) {
              console.error("[facturar] Error al llamar RPC:", rpcErr);
              if (tipoDocumentoFiscal === TIPO_FACTURA && usuarioActual?.id) {
                let facturaOfflineSar: string | null = null;
                try {
                  const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
                  const caiFact = caiRows.find(
                    (r) =>
                      r.cajero_id === usuarioActual?.id &&
                      r.tipo_comprobante === TIPO_FACTURA &&
                      r.activo !== false,
                  );
                  if (caiFact) {
                    const actual = parseInt(
                      caiFact.factura_actual || caiFact.rango_desde || "0",
                      10,
                    );
                    if (Number.isFinite(actual) && actual > 0) {
                      facturaOfflineSar = formatearNumeroSar(caiFact, actual);
                      sarNumeroSecuencial = actual;
                      sarCaiFactura = caiFact.cai || "";
                      sarFechaLimiteEmision = caiFact.fecha_limite_emision;
                      sarRangoDesde = Number(caiFact.rango_desde || 0) || null;
                      sarRangoHasta = Number(caiFact.rango_hasta || 0) || null;
                    }
                  }
                } catch {
                  /* non-critical */
                }
                facturaParaEstaVenta =
                  facturaOfflineSar ?? `OFFLINE-${Date.now()}`;
              } else {
                facturaParaEstaVenta =
                  facturaActual &&
                  Number.isFinite(parseInt(facturaActual)) &&
                  facturaActual !== "Límite alcanzado"
                    ? facturaActual
                    : `OFFLINE-${Date.now()}`;
              }
            }
          } else {
            // Sin conexión: usar contador local
            if (tipoDocumentoFiscal === TIPO_FACTURA && usuarioActual?.id) {
              let facturaOfflineSar: string | null = null;
              try {
                const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
                const caiFact = caiRows.find(
                  (r) =>
                    r.cajero_id === usuarioActual.id &&
                    r.tipo_comprobante === TIPO_FACTURA &&
                    r.activo !== false,
                );
                if (caiFact) {
                  const actual = parseInt(
                    caiFact.factura_actual || caiFact.rango_desde || "0",
                    10,
                  );
                  if (Number.isFinite(actual) && actual > 0) {
                    facturaOfflineSar = formatearNumeroSar(caiFact, actual);
                    sarNumeroSecuencial = actual;
                    sarCaiFactura = caiFact.cai || "";
                    sarFechaLimiteEmision = caiFact.fecha_limite_emision;
                    sarRangoDesde = Number(caiFact.rango_desde || 0) || null;
                    sarRangoHasta = Number(caiFact.rango_hasta || 0) || null;
                  }
                }
              } catch {
                /* non-critical */
              }
              facturaParaEstaVenta =
                facturaOfflineSar ?? `OFFLINE-${Date.now()}`;
            } else {
              let facturaOffline: string | null =
                facturaActual &&
                Number.isFinite(parseInt(facturaActual)) &&
                facturaActual !== "Límite alcanzado"
                  ? facturaActual
                  : null;

              if (!facturaOffline && usuarioActual?.id) {
                try {
                  const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
                  const caiRecibo = caiRows.find(
                    (r) =>
                      r.cajero_id === usuarioActual.id &&
                      r.tipo_comprobante === TIPO_RECIBO &&
                      r.activo !== false,
                  );
                  if (caiRecibo) {
                    const base = parseInt(
                      caiRecibo.factura_actual || caiRecibo.rango_desde || "0",
                    );
                    if (Number.isFinite(base) && base > 0) {
                      facturaOffline = String(base);
                    }
                  }
                } catch {
                  /* non-critical */
                }
              }

              facturaParaEstaVenta = facturaOffline ?? `OFFLINE-${Date.now()}`;
            }
          }

          // ── BIFURCACIÓN DELIVERY: si hay pedido pendiente de entrega, procesarlo y retornar ──
          if (pedidoPendienteEntrega) {
            const pd = pedidoPendienteEntrega;
            try {
              const pdProductos = (pd.productos || []).map((pp: any) => ({
                id: pp.id,
                nombre: pp.nombre,
                precio: pp.precio,
                cantidad: pp.cantidad,
                tipo: pp.tipo || "comida",
                tipo_impuesto: pp.tipo_impuesto ?? pp.tasa_impuesto,
              }));
              const pdResumenImpuesto = pdProductos.reduce(
                (acc: any, item: any) => {
                  const tasa = obtenerTasaImpuesto(
                    item.tipo_impuesto,
                    item.tipo,
                  );
                  const totalLinea =
                    Number(item.precio || 0) * Number(item.cantidad || 0);
                  if (tasa > 0) {
                    const base = totalLinea / (1 + tasa);
                    const imp = totalLinea - base;
                    acc.subTotal += base;
                    if (Math.abs(tasa - 0.18) < 0.0001) acc.isv18 += imp;
                    else acc.isv15 += imp;
                  } else {
                    acc.subTotal += totalLinea;
                  }
                  return acc;
                },
                { subTotal: 0, isv15: 0, isv18: 0 },
              );
              const pdSubTotal = pdResumenImpuesto.subTotal;
              const pdIsv15 = pdResumenImpuesto.isv15;
              const pdIsv18 = pdResumenImpuesto.isv18;
              const pdCostoEnvio =
                posConfig.cobrar_delivery_en_pedidos !== false
                  ? parseFloat(pd.costo_envio || "0")
                  : 0;
              const pdMontoProductos = Number(pd.total || 0);
              const pdTotalCobro = pdMontoProductos + pdCostoEnvio;

              // Pagos desde PagoModal
              let pdEfectivo = 0,
                pdTarjeta = 0,
                pdTransferencia = 0,
                pdDolares = 0,
                pdDolaresUsd = 0,
                pdBanco: string | null = null,
                pdTarjetaNum: string | null = null,
                pdAutorizacion: string | null = null,
                pdRefTransferencia: string | null = null;
              if (paymentData.pagos && paymentData.pagos.length > 0) {
                paymentData.pagos.forEach((pg: any) => {
                  if (pg.tipo === "efectivo") pdEfectivo += pg.monto;
                  if (pg.tipo === "tarjeta") {
                    pdTarjeta += pg.monto;
                    pdBanco = pg.banco || pdBanco;
                    pdTarjetaNum = pg.tarjeta || pdTarjetaNum;
                    pdAutorizacion = pg.autorizador || pdAutorizacion;
                  }
                  if (pg.tipo === "transferencia") {
                    pdTransferencia += pg.monto;
                    pdRefTransferencia = pg.referencia || pdRefTransferencia;
                  }
                  if (pg.tipo === "dolares") {
                    pdDolares += pg.monto;
                    pdDolaresUsd += pg.usd_monto || 0;
                  }
                });
              } else {
                pdEfectivo = paymentData.efectivo || 0;
                pdTarjeta = paymentData.tarjeta || 0;
                pdTransferencia = paymentData.transferencia || 0;
              }

              // El delivery ya está incluido como producto en el JSON de productos.
              // Los métodos de pago se guardan tal cual los registró el cajero.
              // La columna `delivery` de ventas siempre queda en 0.

              const pdCaiStr =
                tipoDocumentoFiscal === "FACTURA"
                  ? sarCaiFactura
                  : caiInfo?.cai || "";

              const pdVenta = {
                fecha_hora: formatToHondurasLocal(),
                cajero: usuarioActual?.nombre || "",
                cajero_id: usuarioActual?.id || null,
                caja: pd.caja || caiInfo?.caja_asignada || "",
                cai: pdCaiStr,
                factura: facturaParaEstaVenta,
                cliente: pd.cliente || null,
                tipo_orden: "DELIVERY",
                tipo: "CONTADO",
                operation_id: crypto.randomUUID(),
                productos: JSON.stringify([
                  ...pdProductos.map((pp: any) => ({
                    id: pp.id,
                    nombre: pp.nombre,
                    precio: pp.precio,
                    cantidad: pp.cantidad,
                    tipo: pp.tipo || "comida",
                    tipo_impuesto: String(
                      obtenerTasaImpuesto(pp.tipo_impuesto, pp.tipo),
                    ),
                    tasa_impuesto: obtenerTasaImpuesto(
                      pp.tipo_impuesto,
                      pp.tipo,
                    ),
                    complementos: pp.complementos ?? [],
                    piezas: pp.piezas ?? null,
                  })),
                  ...(pdCostoEnvio > 0
                    ? [
                        {
                          id: "delivery",
                          nombre: "Delivery",
                          precio: pdCostoEnvio,
                          cantidad: 1,
                          tipo: "delivery",
                          complementos: [],
                          piezas: null,
                        },
                      ]
                    : []),
                ]),
                sub_total: pdSubTotal.toFixed(2),
                isv_15: pdIsv15.toFixed(2),
                isv_18: pdIsv18.toFixed(2),
                total: (pdMontoProductos + pdCostoEnvio).toFixed(2),
                // ── Campos fiscales SAR Honduras ──────────────────────────
                tipo_documento_fiscal: tipoDocumentoFiscal,
                rtn_cliente:
                  tipoDocumentoFiscal === "FACTURA" && rtnCliente.trim()
                    ? rtnCliente.trim()
                    : null,
                nombre_cliente_fiscal:
                  tipoDocumentoFiscal === "FACTURA"
                    ? nombreClienteFiscal.trim() ||
                      pd.cliente ||
                      "CONSUMIDOR FINAL"
                    : null,
                numero_secuencial:
                  tipoDocumentoFiscal === "FACTURA"
                    ? sarNumeroSecuencial
                    : null,
                fecha_limite_emision_cai:
                  tipoDocumentoFiscal === "FACTURA"
                    ? sarFechaLimiteEmision
                    : null,
                // ── Pago ─────────────────────────────────────────────────
                efectivo: pdEfectivo,
                tarjeta: pdTarjeta,
                transferencia: pdTransferencia,
                dolares: pdDolares,
                dolares_usd: pdDolaresUsd,
                delivery: 0,
                total_recibido: paymentData.totalPaid,
                cambio: Math.max(0, paymentData.totalPaid - pdTotalCobro),
                banco: pdBanco,
                tarjeta_num: pdTarjetaNum,
                autorizacion: pdAutorizacion,
                ref_transferencia: pdRefTransferencia,
              };

              // PASO 1: Guardar en IndexedDB
              const pdVentaIdLocal = await guardarVentaLocal(pdVenta);

              // PASO 2: Guardar en Supabase (si hay conexión)
              let pdGuardadoEnSupabase = false;
              if (isOnline && estaConectado()) {
                try {
                  const { error: pdErrVenta } = await supabase
                    .from("ventas")
                    .insert([pdVenta]);
                  if (pdErrVenta) throw pdErrVenta;
                  pdGuardadoEnSupabase = true;
                  await eliminarVentaLocal(pdVentaIdLocal);
                } catch (pdSupabaseErr) {
                  console.error(
                    "Error al guardar venta delivery en Supabase:",
                    pdSupabaseErr,
                  );
                }
              }

              // PASO 3: Registrar costo_delivery
              try {
                if (pdCostoEnvio > 0 && isOnline && estaConectado()) {
                  await supabase.from("costo_delivery").insert([
                    {
                      pedido_id:
                        pd.id && !String(pd.id).startsWith("local-")
                          ? Number(pd.id)
                          : null,
                      monto: pdCostoEnvio,
                      fecha: pd.fecha || formatToHondurasLocal(),
                      cliente: pd.cliente || null,
                      cajero_id: usuarioActual?.id || null,
                      caja: pd.caja || caiInfo?.caja_asignada || null,
                      tipo_pago: paymentData.tipoPagoString || null,
                    },
                  ]);
                }
              } catch (_) {}

              // PASO 4: Eliminar pedido
              try {
                if (pd.__localPending && pd.local_id) {
                  await eliminarEnvioLocal(pd.local_id);
                } else if (
                  pd.id &&
                  !String(pd.id).startsWith("local-") &&
                  isOnline &&
                  estaConectado()
                ) {
                  await supabase.from("pedidos_envio").delete().eq("id", pd.id);
                }
              } catch (_) {}

              // PASO 5: Incrementar factura (solo para RECIBO; FACTURA usa RPC atómico)
              if (tipoDocumentoFiscal !== "FACTURA") {
                const numUsado = parseInt(facturaParaEstaVenta);
                if (Number.isFinite(numUsado)) {
                  const siguienteDisplay = (numUsado + 1).toString();
                  try {
                    await persistirReciboActual(siguienteDisplay, {
                      actualizarSupabase:
                        isOnline && Boolean(usuarioActual?.id),
                    });
                  } catch (err) {
                    console.error(
                      "Error actualizando correlativo RECIBO tras delivery:",
                      err,
                    );
                    setFacturaActual(siguienteDisplay);
                  }
                } else {
                  setFacturaActual((prev) => {
                    if (!prev || prev === "Límite alcanzado") return prev;
                    const n = parseInt(prev);
                    return Number.isFinite(n) ? (n + 1).toString() : prev;
                  });
                }
              }

              // PASO 6: Actualizar lista de pedidos
              setPedidosList((prev) =>
                prev.filter((x) => {
                  const currentId = String(x.id || x.local_id || "");
                  const targetId = String(pd.id || pd.local_id || "");
                  return currentId !== targetId;
                }),
              );

              // PASO 7: Imprimir comprobante
              try {
                const pdTotalMostrar = pdMontoProductos + pdCostoEnvio;
                const pdIsv15Monto = pdIsv15;
                const pdIsv18Monto = pdIsv18;

                const pdComprobanteHtml = `
                  <div style='font-family:monospace; width:80mm; margin:0; padding:8px; background:#fff;'>
                    <div style='text-align:center; font-size:18px; font-weight:700; margin-bottom:6px;'>${datosNegocio?.nombre_negocio?.toUpperCase() || ""}</div>
                    <div style='text-align:center; font-size:13px; margin-bottom:3px;'>${datosNegocio?.direccion || ""}</div>
                    <div style='text-align:center; font-size:13px; margin-bottom:3px;'>RTN: ${datosNegocio?.rtn || ""}</div>
                    <div style='text-align:center; font-size:13px; margin-bottom:10px;'>TEL: ${datosNegocio?.celular || ""}</div>
                    ${
                      tipoDocumentoFiscal === "FACTURA"
                        ? `
                    <div style='border-top:3px solid #000; border-bottom:3px solid #000; padding:8px 0; margin-bottom:10px; text-align:center;'>
                      <div style='font-size:18px; font-weight:900; letter-spacing:2px;'>FACTURA</div>
                    </div>
                    <div style='font-size:11px; margin-bottom:3px; word-break:break-all;'><b>CAI:</b> ${sarCaiFactura || caiInfo?.cai || ""}</div>
                    ${sarRangoDesde !== null && sarRangoHasta !== null ? `<div style='font-size:11px; margin-bottom:3px;'><b>Rango autorizado:</b> ${String(sarRangoDesde).padStart(8, "0")} al ${String(sarRangoHasta).padStart(8, "0")}</div>` : ""}
                    <div style='font-size:12px; margin-bottom:3px;'><b>No. Factura:</b> ${facturaParaEstaVenta}</div>
                    <div style='font-size:12px; margin-bottom:10px;'><b>Fecha límite de emisión:</b> ${sarFechaLimiteEmision ? new Date(sarFechaLimiteEmision + "T00:00:00").toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa" }) : ""}</div>
                    <div style='border-top:1px dashed #000; margin-bottom:6px;'></div>
                    <div style='font-size:12px; font-weight:700; margin-bottom:3px;'>CLIENTE:</div>
                    <div style='font-size:12px; margin-bottom:2px;'>Nombre: ${(nombreClienteFiscal.trim() || pd.cliente || "CONSUMIDOR FINAL").toUpperCase()}</div>
                    <div style='font-size:12px; margin-bottom:8px;'>RTN: ${rtnCliente || "—"}</div>
                    <div style='border-top:1px dashed #000; margin-bottom:8px;'></div>
                    <div style='font-size:12px; margin-bottom:3px;'>Fecha: ${new Date().toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}</div>
                    <div style='font-size:12px; margin-bottom:10px;'>Cajero: ${usuarioActual?.nombre || ""}</div>
                    `
                        : `
                    <div style='border-top:2px solid #000; border-bottom:2px solid #000; padding:6px 0; margin-bottom:10px; text-align:center; font-size:16px; font-weight:700;'>RECIBO DE VENTA</div>
                    <div style='font-size:13px; margin-bottom:3px;'>Cliente: ${pd.cliente || "S/N"}</div>
                    <div style='font-size:13px; margin-bottom:3px;'>Factura #: ${facturaParaEstaVenta}</div>
                    <div style='font-size:13px; margin-bottom:10px;'>Fecha: ${new Date().toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}</div>
                    `
                    }
                    <div style='border-top:1px dashed #000; border-bottom:1px dashed #000; padding:6px 0; margin-bottom:10px;'>
                      <table style='width:100%; font-size:13px; border-collapse:collapse;'>
                        <thead><tr style='border-bottom:1px solid #000;'>
                          <th style='text-align:left;'>Cant</th>
                          <th style='text-align:left;'>Descripción</th>
                          <th style='text-align:right;'>P.Unit</th>
                          <th style='text-align:right;'>Total</th>
                        </tr></thead>
                        <tbody>
                          ${pdProductos
                            .map((it: any) => {
                              const esGrav =
                                it.tipo === "comida" || it.tipo === "bebida";
                              const div =
                                it.tipo === "bebida"
                                  ? 1.18
                                  : it.tipo === "comida"
                                    ? 1.15
                                    : 1;
                              const pUnit =
                                tipoDocumentoFiscal === "FACTURA" && esGrav
                                  ? it.precio / div
                                  : it.precio;
                              const tot = pUnit * it.cantidad;
                              const etiq =
                                tipoDocumentoFiscal === "FACTURA" && esGrav
                                  ? " (Gravado)"
                                  : "";
                              return `<tr><td style='padding:3px 0; vertical-align:top;'>${it.cantidad}</td><td style='padding:3px 0; vertical-align:top;'>${it.nombre}${etiq}</td><td style='text-align:right;padding:3px 0; vertical-align:top;'>L${pUnit.toFixed(2)}</td><td style='text-align:right;padding:3px 0; vertical-align:top;'>L${tot.toFixed(2)}</td></tr>`;
                            })
                            .join("")}
                          ${pdCostoEnvio > 0 ? `<tr><td>1</td><td>Delivery</td><td style='text-align:right;'>L${pdCostoEnvio.toFixed(2)}</td><td style='text-align:right;'>L${pdCostoEnvio.toFixed(2)}</td></tr>` : ""}
                        </tbody>
                      </table>
                    </div>
                    ${
                      tipoDocumentoFiscal === "FACTURA"
                        ? `
                    <div style='font-size:13px; margin-top:6px; padding-top:4px; border-top:1px solid #000;'>
                      <div style='display:flex; justify-content:space-between; margin-bottom:3px;'><span>Subtotal:</span><span>L ${pdMontoProductos.toFixed(2)}</span></div>
                      ${pdIsv15Monto > 0 ? `<div style='display:flex; justify-content:space-between; margin-bottom:3px;'><span>ISV 15%:</span><span>L ${pdIsv15Monto.toFixed(2)}</span></div>` : ""}
                      ${pdIsv18Monto > 0 ? `<div style='display:flex; justify-content:space-between; margin-bottom:3px;'><span>ISV 18%:</span><span>L ${pdIsv18Monto.toFixed(2)}</span></div>` : ""}
                      ${pdCostoEnvio > 0 ? `<div style='display:flex; justify-content:space-between; margin-bottom:3px;'><span>Delivery:</span><span>L ${pdCostoEnvio.toFixed(2)}</span></div>` : ""}
                      <div style='display:flex; justify-content:space-between; font-size:16px; font-weight:700; border-top:1px solid #000; padding-top:5px; margin-top:3px;'><span>TOTAL:</span><span>L ${pdTotalMostrar.toFixed(2)}</span></div>
                    </div>
                    `
                        : `
                    <div style='font-size:16px; font-weight:700; border-top:1px solid #000; padding-top:6px;'>
                      <span style='float:left;'>TOTAL:</span>
                      <span style='float:right;'>L ${pdTotalMostrar.toFixed(2)}</span>
                      <div style='clear:both;'></div>
                    </div>
                    `
                    }
                    <div style='text-align:center; margin-top:18px; font-size:14px; font-weight:700; border-top:1px dashed #000; padding-top:10px;'>¡GRACIAS POR SU COMPRA!</div>
                    ${(() => {
                      let ph =
                        "<div style='border-top:1px dashed #000; margin-top:10px; padding-top:10px;'>";
                      ph +=
                        "<div style='font-size:14px; font-weight:700; margin-bottom:4px;'>PAGO:</div>";
                      if (pdEfectivo > 0)
                        ph += `<div style='font-size:13px; display:flex; justify-content:space-between;'><span>Efectivo:</span><span>L ${pdEfectivo.toFixed(2)}</span></div>`;
                      if (pdTarjeta > 0)
                        ph += `<div style='font-size:13px; display:flex; justify-content:space-between;'><span>Tarjeta:</span><span>L ${pdTarjeta.toFixed(2)}</span></div>`;
                      if (pdTransferencia > 0)
                        ph += `<div style='font-size:13px; display:flex; justify-content:space-between;'><span>Transferencia:</span><span>L ${pdTransferencia.toFixed(2)}</span></div>`;
                      if (pdDolares > 0)
                        ph += `<div style='font-size:13px; display:flex; justify-content:space-between;'><span>D\u00f3lares:</span><span>L ${pdDolares.toFixed(2)}</span></div>`;
                      const pdCambio = Math.max(
                        0,
                        paymentData.totalPaid -
                          (pdMontoProductos + pdCostoEnvio),
                      );
                      if (pdCambio > 0)
                        ph += `<div style='font-size:13px; font-weight:700; display:flex; justify-content:space-between; border-top:1px solid #000; margin-top:4px; padding-top:4px;'><span>CAMBIO:</span><span>L ${pdCambio.toFixed(2)}</span></div>`;
                      ph += "</div>";
                      return ph;
                    })()}
                  </div>
                `;
                const pdPrintWindow = window.open(
                  "",
                  "",
                  "height=800,width=400",
                );
                if (pdPrintWindow) {
                  pdPrintWindow.document.write(
                    `<html><head><title>Comprobante</title><style>@page{margin:0;size:auto;}body{margin:0;padding:0;}*{-webkit-print-color-adjust:exact;}</style></head><body>${pdComprobanteHtml}</body></html>`,
                  );
                  pdPrintWindow.document.close();
                  pdPrintWindow.onload = () => {
                    setTimeout(() => {
                      pdPrintWindow.focus();
                      pdPrintWindow.print();
                      pdPrintWindow.close();
                    }, 400);
                  };
                }
              } catch (printErr) {
                console.error(
                  "Error imprimiendo comprobante delivery:",
                  printErr,
                );
              }

              const pdMensaje = pdGuardadoEnSupabase
                ? "✓ Pedido procesado y guardado exitosamente"
                : "✓ Pedido procesado. Se sincronizará cuando haya conexión";
              alert(pdMensaje);
            } catch (pdErr) {
              console.error("Error procesando entrega de pedido:", pdErr);
              alert("Error procesando entrega. Verifique los datos guardados.");
            } finally {
              setPedidoPendienteEntrega(null);
              setShowPagoModal(false);
              isSubmittingRef.current = false;
            }
            return;
          }

          // ── Snapshot inmutable: capturar TODOS los datos del formulario ────────
          const esDonacion = paymentData.esDonacion === true;
          const snap = {
            seleccionados: structuredClone(seleccionados),
            nombreCliente: nombreCliente,
            facturaActual: facturaParaEstaVenta,
            tipoOrden: tipoOrden,
            total: esDonacion ? 0 : total,
            totalConDescuento: esDonacion ? 0 : totalConDescuento,
            totalDescuento: totalDescuento,
          };

          // ID único por operación de facturación
          const operationId = crypto.randomUUID();
          console.log(
            `[facturar] Inicio op=${operationId} | factura=${facturaParaEstaVenta} | cliente=${snap.nombreCliente} | usandoRpc=${usandoRpc} | ts=${new Date().toISOString()}`,
          );

          // ── Capturar datos de pago (se guardarán junto con la factura en ventas) ─
          let pagoDataCapturado = {
            efectivo: 0,
            tarjeta: 0,
            transferencia: 0,
            dolares: 0,
            dolares_usd: 0,
            delivery: 0,
            total_recibido: 0,
            cambio: 0,
            banco: null as string | null,
            tarjeta_num: null as string | null,
            autorizacion: null as string | null,
            ref_transferencia: null as string | null,
          };

          if (paymentData.pagos && paymentData.pagos.length > 0) {
            const cambioCapturado = Math.max(
              0,
              paymentData.totalPaid - totalConDescuento,
            );
            const pagoTarjeta = paymentData.pagos.find(
              (p) => p.tipo === "tarjeta",
            );
            const pagoTransf = paymentData.pagos.find(
              (p) => p.tipo === "transferencia",
            );
            pagoDataCapturado = {
              efectivo: paymentData.pagos
                .filter((p) => p.tipo === "efectivo")
                .reduce((s, p) => s + p.monto, 0),
              tarjeta: paymentData.pagos
                .filter((p) => p.tipo === "tarjeta")
                .reduce((s, p) => s + p.monto, 0),
              transferencia: paymentData.pagos
                .filter((p) => p.tipo === "transferencia")
                .reduce((s, p) => s + p.monto, 0),
              dolares: paymentData.pagos
                .filter((p) => p.tipo === "dolares")
                .reduce((s, p) => s + p.monto, 0),
              dolares_usd: paymentData.pagos
                .filter((p) => p.tipo === "dolares")
                .reduce((s, p) => s + (p.usd_monto || 0), 0),
              delivery: 0,
              total_recibido: paymentData.totalPaid,
              cambio: cambioCapturado,
              banco: pagoTarjeta?.banco || null,
              tarjeta_num: pagoTarjeta?.tarjeta || null,
              autorizacion: pagoTarjeta?.autorizador || null,
              ref_transferencia: pagoTransf?.referencia || null,
            };
          }

          setShowPagoModal(false);
          setTimeout(async () => {
            // Consultar configuración de comanda y recibo desde Supabase
            const { data: etiquetaConfig } = await supabase
              .from("etiquetas_config")
              .select("*")
              .eq("nombre", "default")
              .single();
            const { data: reciboConfig } = await supabase
              .from("recibo_config")
              .select("*")
              .eq("nombre", "default")
              .single();
            // Comanda
            const comandaHtml = `
              <div style='font-family:monospace; width:${
                etiquetaConfig?.etiqueta_ancho || 80
              }mm; margin:0; padding:${
                etiquetaConfig?.etiqueta_padding || 8
              }px;'>
                <div style='font-size:${
                  etiquetaConfig?.etiqueta_fontsize || 24
                }px; font-weight:800; color:#000; text-align:center; margin-bottom:6px;'>${
                  etiquetaConfig?.etiqueta_comanda || "COMANDA COCINA"
                }</div>
                <div style='font-size:28px; font-weight:900; color:#000; text-align:center; margin:16px 0;'>${snap.tipoOrden}</div>
                <div style='font-size:20px; font-weight:800; color:#000; text-align:center; margin-bottom:12px;'>Cliente: <b>${snap.nombreCliente}</b></div>
                <div style='font-size:14px; font-weight:600; color:#222; text-align:center; margin-bottom:6px;'>Factura: ${
                  snap.facturaActual || ""
                }</div>
                
                ${
                  snap.seleccionados.filter((p) => p.tipo === "comida").length >
                  0
                    ? `
                  <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>COMIDAS</div>
                  <ul style='list-style:none; padding:0; margin-bottom:12px;'>
                    ${snap.seleccionados
                      .filter((p) => p.tipo === "comida")
                      .map(
                        (p) =>
                          `<li style='font-size:${
                            etiquetaConfig?.etiqueta_fontsize || 20
                          }px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                            <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${
                              p.cantidad
                            }x</div>
                            <div style='font-weight:700;'>${p.nombre}</div>
                            ${
                              p.complementos && p.complementos.length > 0
                                ? `<div style='font-size:12px; margin-top:6px; font-weight:600; color:#555;'>🍗 Complementos:</div>` +
                                  p.complementos
                                    .map(
                                      (comp) =>
                                        `<div style='font-size:14px; margin-top:2px; padding-left:8px;'><span style='font-weight:700;'>• ${comp}</span></div>`,
                                    )
                                    .join("")
                                : ""
                            }
                            ${
                              p.piezas && p.piezas !== "PIEZAS VARIAS"
                                ? `<div style='font-size:12px; margin-top:6px; font-weight:600; color:#555;'>🍖 Piezas:</div><div style='font-size:14px; margin-top:2px; padding-left:8px;'><span style='font-weight:700;'>• ${p.piezas}</span></div>`
                                : ""
                            }
                          </li>`,
                      )
                      .join("")}
                  </ul>
                `
                    : ""
                }
                
                ${
                  snap.seleccionados.filter((p) => p.tipo === "complemento")
                    .length > 0
                    ? `
                  <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>COMPLEMENTOS</div>
                  <ul style='list-style:none; padding:0; margin-bottom:12px;'>
                    ${snap.seleccionados
                      .filter((p) => p.tipo === "complemento")
                      .map(
                        (p) =>
                          `<li style='font-size:${
                            etiquetaConfig?.etiqueta_fontsize || 20
                          }px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                            <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${
                              p.cantidad
                            }x</div>
                            <div style='font-weight:700;'>${p.nombre}</div>
                          </li>`,
                      )
                      .join("")}
                  </ul>
                `
                    : ""
                }

                ${
                  snap.seleccionados.filter((p) => p.tipo === "bebida").length >
                  0
                    ? `
                  <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>BEBIDAS</div>
                  <ul style='list-style:none; padding:0; margin-bottom:0;'>
                    ${snap.seleccionados
                      .filter((p) => p.tipo === "bebida")
                      .map(
                        (p) =>
                          `<li style='font-size:${
                            etiquetaConfig?.etiqueta_fontsize || 20
                          }px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                            <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${
                              p.cantidad
                            }x</div>
                            <div style='font-weight:700;'>${p.nombre}</div>
                          </li>`,
                      )
                      .join("")}
                  </ul>
                `
                    : ""
                }
              </div>
            `;
            // Recibo - Formato SAR

            // Calcular pagos para el recibo
            const efectivoTotal =
              paymentData.pagos
                ?.filter((p) => p.tipo === "efectivo")
                .reduce((sum, p) => sum + p.monto, 0) || 0;
            const tarjetaTotal =
              paymentData.pagos
                ?.filter((p) => p.tipo === "tarjeta")
                .reduce((sum, p) => sum + p.monto, 0) || 0;
            const dolaresTotal =
              paymentData.pagos
                ?.filter((p) => p.tipo === "dolares")
                .reduce((sum, p) => sum + p.monto, 0) || 0;
            const dolaresUSD =
              paymentData.pagos
                ?.filter((p) => p.tipo === "dolares")
                .reduce((sum, p) => sum + (p.usd_monto || 0), 0) || 0;
            const transferenciaTotal =
              paymentData.pagos
                ?.filter((p) => p.tipo === "transferencia")
                .reduce((sum, p) => sum + p.monto, 0) || 0;
            const cambioValue = paymentData.totalPaid - snap.totalConDescuento;

            let pagosHtml = "";
            if (
              efectivoTotal > 0 ||
              tarjetaTotal > 0 ||
              dolaresTotal > 0 ||
              transferenciaTotal > 0
            ) {
              pagosHtml +=
                "<div style='border-top:1px dashed #000; margin-top:10px; padding-top:10px;'>";
              pagosHtml +=
                "<div style='font-size:15px; font-weight:700; margin-bottom:6px;'>PAGO:</div>";

              if (efectivoTotal > 0) {
                pagosHtml += "<div style='font-size:14px; margin-bottom:3px;'>";
                pagosHtml += "<span style='float:left;'>Efectivo:</span>";
                pagosHtml +=
                  "<span style='float:right;'>L " +
                  efectivoTotal.toFixed(2) +
                  "</span>";
                pagosHtml += "<div style='clear:both;'></div>";
                pagosHtml += "</div>";
              }

              if (tarjetaTotal > 0) {
                pagosHtml += "<div style='font-size:14px; margin-bottom:3px;'>";
                pagosHtml += "<span style='float:left;'>Tarjeta:</span>";
                pagosHtml +=
                  "<span style='float:right;'>L " +
                  tarjetaTotal.toFixed(2) +
                  "</span>";
                pagosHtml += "<div style='clear:both;'></div>";
                pagosHtml += "</div>";
              }

              if (dolaresTotal > 0) {
                pagosHtml += "<div style='font-size:14px; margin-bottom:3px;'>";
                pagosHtml +=
                  "<span style='float:left;'>Dólares: $" +
                  dolaresUSD.toFixed(2) +
                  " USD</span>";
                pagosHtml +=
                  "<span style='float:right;'>L " +
                  dolaresTotal.toFixed(2) +
                  "</span>";
                pagosHtml += "<div style='clear:both;'></div>";
                pagosHtml += "</div>";
              }

              if (transferenciaTotal > 0) {
                pagosHtml += "<div style='font-size:14px; margin-bottom:3px;'>";
                pagosHtml += "<span style='float:left;'>Transferencia:</span>";
                pagosHtml +=
                  "<span style='float:right;'>L " +
                  transferenciaTotal.toFixed(2) +
                  "</span>";
                pagosHtml += "<div style='clear:both;'></div>";
                pagosHtml += "</div>";
              }

              if (cambioValue > 0) {
                pagosHtml +=
                  "<div style='font-size:15px; margin-top:6px; padding-top:6px; border-top:1px solid #000; font-weight:700;'>";
                pagosHtml += "<span style='float:left;'>CAMBIO:</span>";
                pagosHtml +=
                  "<span style='float:right;'>L " +
                  cambioValue.toFixed(2) +
                  "</span>";
                pagosHtml += "<div style='clear:both;'></div>";
                pagosHtml += "</div>";
              }

              pagosHtml += "</div>";
            }

            // ── Pre-cálculo ISV para recibo fiscal SAR ────────────────────────
            const _resumenImpuestoFact = snap.seleccionados.reduce(
              (acc, p) => {
                const tasa = obtenerTasaImpuesto(p.tipo_impuesto, p.tipo);
                const totalLinea = p.precio * p.cantidad;
                if (tasa > 0) {
                  const base = totalLinea / (1 + tasa);
                  const imp = totalLinea - base;
                  if (Math.abs(tasa - 0.18) < 0.0001) {
                    acc.base18 += base;
                    acc.isv18 += imp;
                  } else {
                    acc.base15 += base;
                    acc.isv15 += imp;
                  }
                } else {
                  acc.baseExenta += totalLinea;
                }
                return acc;
              },
              { base15: 0, isv15: 0, base18: 0, isv18: 0, baseExenta: 0 },
            );
            const _base15Fact = _resumenImpuestoFact.base15;
            const _isv15Fact = _resumenImpuestoFact.isv15;
            const _base18Fact = _resumenImpuestoFact.base18;
            const _isv18Fact = _resumenImpuestoFact.isv18;
            const _baseExentaFact = _resumenImpuestoFact.baseExenta;
            void _baseExentaFact; // reservado para uso futuro

            const comprobanteHtml = `
              <div style='font-family:monospace; width:${
                reciboConfig?.recibo_ancho || 80
              }mm; margin:0; padding:${
                reciboConfig?.recibo_padding || 8
              }px; background:#fff;'>
                <!-- Logo -->
                <div style='text-align:center; margin-bottom:12px;'>
                  <img src='${datosNegocio.logo_url || "/favicon.ico"}' alt='${
                    datosNegocio.nombre_negocio
                  }' style='width:320px; height:320px;' onload='window.imageLoaded = true;' />
                </div>
                
                <!-- Información del Negocio -->
                <div style='text-align:center; font-size:18px; font-weight:700; margin-bottom:6px;'>${datosNegocio.nombre_negocio.toUpperCase()}</div>
                <div style='text-align:center; font-size:14px; margin-bottom:3px;'>${
                  datosNegocio.direccion
                }</div>
                <div style='text-align:center; font-size:14px; margin-bottom:3px;'>RTN: ${
                  datosNegocio.rtn
                }</div>
                <div style='text-align:center; font-size:14px; margin-bottom:3px;'>PROPIETARIO: ${datosNegocio.propietario.toUpperCase()}</div>
                <div style='text-align:center; font-size:14px; margin-bottom:10px;'>TEL: ${
                  datosNegocio.celular
                }</div>
                
                ${
                  tipoDocumentoFiscal === "FACTURA"
                    ? `
                <div style='border-top:3px solid #000; border-bottom:3px solid #000; padding:8px 0; margin-bottom:10px; text-align:center;'>
                  <div style='font-size:18px; font-weight:900; letter-spacing:2px;'>FACTURA</div>
                </div>
                <div style='font-size:11px; margin-bottom:3px; word-break:break-all;'><b>CAI:</b> ${sarCaiFactura || caiInfo?.cai || ""}</div>
                ${sarRangoDesde !== null && sarRangoHasta !== null ? `<div style='font-size:11px; margin-bottom:3px;'><b>Rango autorizado:</b> ${String(sarRangoDesde).padStart(8, "0")} al ${String(sarRangoHasta).padStart(8, "0")}</div>` : ""}
                <div style='font-size:12px; margin-bottom:3px;'><b>No. Factura:</b> ${facturaParaEstaVenta || snap.facturaActual || ""}</div>
                <div style='font-size:12px; margin-bottom:10px;'><b>Fecha límite de emisión:</b> ${sarFechaLimiteEmision ? new Date(sarFechaLimiteEmision + "T00:00:00").toLocaleDateString("es-HN", { timeZone: "America/Tegucigalpa" }) : ""}</div>
                <div style='border-top:1px dashed #000; margin-bottom:8px;'></div>
                <div style='font-size:12px; font-weight:700; margin-bottom:3px;'>CLIENTE:</div>
                <div style='font-size:12px; margin-bottom:2px;'>Nombre: ${((nombreClienteFiscal || "").trim() || snap.nombreCliente || "CONSUMIDOR FINAL").toUpperCase()}</div>
                <div style='font-size:12px; margin-bottom:8px;'>RTN: ${rtnCliente || "—"}</div>
                <div style='border-top:1px dashed #000; margin-bottom:8px;'></div>
                <div style='font-size:12px; margin-bottom:3px;'>Fecha: ${new Date().toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}</div>
                <div style='font-size:12px; margin-bottom:10px;'>Cajero: ${usuarioActual?.nombre || caiInfo?.nombre_cajero || ""}</div>
                `
                    : `
                <div style='border-top:2px solid #000; border-bottom:2px solid #000; padding:6px 0; margin-bottom:10px;'>
                  <div style='text-align:center; font-size:16px; font-weight:700;'>RECIBO DE VENTA</div>
                </div>
                <div style='font-size:14px; margin-bottom:3px;'>Cliente: ${snap.nombreCliente}</div>
                <div style='font-size:14px; margin-bottom:3px;'>Factura: ${snap.facturaActual || ""}</div>
                <div style='font-size:14px; margin-bottom:10px;'>Fecha: ${new Date().toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })}</div>
                `
                }
                
                <!-- Tabla de Productos -->
                <div style='border-top:1px dashed #000; border-bottom:1px dashed #000; padding:6px 0; margin-bottom:10px;'>
                  <table style='width:100%; font-size:13px; border-collapse:collapse;'>
                    <thead>
                      <tr style='border-bottom:1px solid #000;'>
                        <th style='text-align:left; padding:3px 0;'>Cant</th>
                        <th style='text-align:left; padding:3px 0;'>Descripción</th>
                        <th style='text-align:right; padding:3px 0;'>P.Unit</th>
                        <th style='text-align:right; padding:3px 0;'>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${snap.seleccionados
                        .map((p) => {
                          const esGravado =
                            p.tipo === "comida" || p.tipo === "bebida";
                          const divisor =
                            p.tipo === "bebida"
                              ? 1.18
                              : p.tipo === "comida"
                                ? 1.15
                                : 1;
                          const precioSinIsv =
                            tipoDocumentoFiscal === "FACTURA" && esGravado
                              ? p.precio / divisor
                              : p.precio;
                          const totalSinIsv = precioSinIsv * p.cantidad;
                          const etiqueta =
                            tipoDocumentoFiscal === "FACTURA" && esGravado
                              ? ` (Gravado)`
                              : "";
                          return `<tr>
                            <td style='padding:4px 0; vertical-align:top;'>${p.cantidad}</td>
                            <td style='padding:4px 0; vertical-align:top;'>${p.nombre}${etiqueta}</td>
                            <td style='text-align:right; padding:4px 0; vertical-align:top;'>L${precioSinIsv.toFixed(2)}</td>
                            <td style='text-align:right; padding:4px 0; vertical-align:top;'>L${totalSinIsv.toFixed(2)}</td>
                          </tr>`;
                        })
                        .join("")}
                    </tbody>
                  </table>
                </div>
                
                <!-- Totales -->
                ${
                  tipoDocumentoFiscal === "FACTURA"
                    ? `
                <div style='font-size:13px; margin-top:6px; padding-top:4px; border-top:1px solid #000;'>
                  <div style='display:flex; justify-content:space-between; margin-bottom:3px;'><span>Subtotal:</span><span>L ${_base15Fact > 0 || _base18Fact > 0 ? (_base15Fact + _base18Fact).toFixed(2) : snap.total.toFixed(2)}</span></div>
                  ${_isv15Fact > 0 ? `<div style='display:flex; justify-content:space-between; margin-bottom:3px;'><span>ISV 15%:</span><span>L ${_isv15Fact.toFixed(2)}</span></div>` : ""}
                  ${_isv18Fact > 0 ? `<div style='display:flex; justify-content:space-between; margin-bottom:3px;'><span>ISV 18%:</span><span>L ${_isv18Fact.toFixed(2)}</span></div>` : ""}
                  ${snap.totalDescuento > 0 ? `<div style='display:flex; justify-content:space-between; margin-bottom:3px; color:#c00;'><span>Descuento:</span><span>-L ${snap.totalDescuento.toFixed(2)}</span></div>` : ""}
                  <div style='display:flex; justify-content:space-between; font-size:16px; font-weight:700; border-top:1px solid #000; padding-top:5px; margin-top:3px;'><span>TOTAL:</span><span>L ${snap.totalConDescuento.toFixed(2)}</span></div>
                </div>
                `
                    : `
                ${
                  snap.totalDescuento > 0
                    ? `<div style='font-size:14px; margin-top:6px; padding-top:4px;'><span style='float:left;'>Subtotal:</span><span style='float:right;'>L ${snap.total.toFixed(2)}</span><div style='clear:both;'></div></div><div style='font-size:14px; margin-bottom:4px; color:#c00;'><span style='float:left;'>Descuento:</span><span style='float:right;'>-L ${snap.totalDescuento.toFixed(2)}</span><div style='clear:both;'></div></div>`
                    : ""
                }
                <div style='border-top:1px solid #000; margin-top:6px; padding-top:6px; font-size:17px; font-weight:700;'><span style='float:left;'>TOTAL:</span><span style='float:right;'>L ${snap.totalConDescuento.toFixed(2)}</span><div style='clear:both;'></div></div>
                `
                }
                
                ${pagosHtml}
                
                <!-- Mensaje de Agradecimiento -->
                <div style='text-align:center; margin-top:18px; font-size:15px; font-weight:700; border-top:1px dashed #000; padding-top:10px;'>
                  ¡GRACIAS POR SU COMPRA!
                </div>
                <div style='text-align:center; font-size:14px; margin-top:5px;'>
                  Esperamos verle pronto
                </div>
              </div>
            `;
            // Imprimir recibo y comanda (USB silenciosa o navegador)
            const printHtml = `
              <html>
                <head>
                  <title>Recibo y Comanda</title>
                  <style>
                    @page { margin: 0; size: auto; }
                    body { margin: 0; padding: 0; overflow: visible; }
                    * { page-break-inside: avoid; -webkit-print-color-adjust: exact; }
                    @media print {
                      html, body { height: auto; overflow: visible; }
                      .comanda-break { page-break-before: always; }
                    }
                  </style>
                </head>
                <body>
                  <div>${comprobanteHtml}</div>
                  <div class="comanda-break">${comandaHtml}</div>
                </body>
              </html>
            `;

            const preloadImage = () =>
              new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve(true);
                img.onerror = () => resolve(false);
                img.src = datosNegocio.logo_url || "/favicon.ico";
                setTimeout(() => resolve(false), 2000);
              });

            // ── Verificar configuración USB ────────────────────────────────
            try {
              const [cfgComandaP, cfgReciboP] = await Promise.all([
                cargarPrinterConfig("comanda"),
                cargarPrinterConfig("recibo"),
              ]);
              const usarUSBComanda =
                cfgComandaP?.modoImpresion === "silenciosa" &&
                cfgComandaP.vendorId &&
                cfgComandaP.productId;
              const usarUSBRecibo =
                cfgReciboP?.modoImpresion === "silenciosa" &&
                cfgReciboP.vendorId &&
                cfgReciboP.productId;

              if (usarUSBComanda || usarUSBRecibo) {
                const itemsUSB = snap.seleccionados.map((p) => ({
                  nombre: p.nombre,
                  cantidad: p.cantidad,
                  precio: p.precio,
                  tipo: p.tipo,
                  complementos: p.complementos,
                  piezas: p.piezas ?? undefined,
                }));
                // Comanda
                if (usarUSBComanda) {
                  const datosComandaUSB: DatosComanda = {
                    factura: snap.facturaActual || "",
                    cliente: snap.nombreCliente,
                    tipoOrden: snap.tipoOrden,
                    items: itemsUSB,
                    fecha: new Date().toLocaleString("es-HN", {
                      timeZone: "America/Tegucigalpa",
                    }),
                  };
                  imprimirComandaUSB(
                    cfgComandaP!.vendorId,
                    cfgComandaP!.productId,
                    datosComandaUSB,
                  ).catch((e) => console.error("Error USB comanda:", e));
                } else {
                  const pwC = window.open("", "", "height=800,width=400");
                  if (pwC) {
                    pwC.document.write(
                      `<html><head><title>Comanda</title><style>@page{margin:0;size:auto;}body{margin:0;padding:0;}</style></head><body>${comandaHtml}</body></html>`,
                    );
                    pwC.document.close();
                    pwC.onload = () => {
                      setTimeout(() => {
                        pwC.focus();
                        pwC.print();
                        pwC.close();
                      }, 500);
                    };
                  }
                }
                // Recibo
                if (usarUSBRecibo) {
                  const datosReciboUSB: DatosRecibo = {
                    nombreNegocio: datosNegocio.nombre_negocio,
                    factura: snap.facturaActual || "",
                    cajero: usuarioActual?.nombre || "",
                    caja: caiInfo?.caja_asignada || "",
                    cliente: snap.nombreCliente,
                    fecha: new Date().toLocaleString("es-HN", {
                      timeZone: "America/Tegucigalpa",
                    }),
                    items: itemsUSB,
                    total: snap.totalConDescuento,
                    descuento:
                      snap.totalDescuento > 0 ? snap.totalDescuento : undefined,
                    cambio: cambioValue > 0 ? cambioValue : undefined,
                  };
                  imprimirReciboUSB(
                    cfgReciboP!.vendorId,
                    cfgReciboP!.productId,
                    datosReciboUSB,
                  ).catch((e) => console.error("Error USB recibo:", e));
                } else {
                  const pwR = window.open("", "", "height=600,width=400");
                  if (pwR) {
                    pwR.document.write(
                      `<html><head><title>Recibo</title><style>@page{margin:0;size:auto;}body{margin:0;padding:0;}*{-webkit-print-color-adjust:exact;}</style></head><body>${comprobanteHtml}</body></html>`,
                    );
                    pwR.document.close();
                    pwR.onload = () => {
                      setTimeout(() => {
                        pwR.focus();
                        pwR.print();
                        pwR.close();
                      }, 500);
                    };
                  }
                }
              } else {
                // Modo navegador: recibo + comanda juntos en una ventana
                await preloadImage();
                const printWindow = window.open("", "", "height=800,width=400");
                if (printWindow) {
                  printWindow.document.write(printHtml);
                  printWindow.document.close();
                  printWindow.onload = () => {
                    setTimeout(() => {
                      printWindow.focus();
                      printWindow.print();
                      printWindow.close();
                    }, 500);
                  };
                }
              }
            } catch (err) {
              console.error("Error al intentar imprimir:", err);
              const printWindow = window.open("", "", "height=800,width=400");
              if (printWindow) {
                printWindow.document.write(printHtml);
                printWindow.document.close();
                printWindow.onload = () => {
                  setTimeout(() => {
                    printWindow.focus();
                    printWindow.print();
                    printWindow.close();
                  }, 500);
                };
              }
            }
            // Guardar venta en la tabla 'ventas' (factura + pago fusionados)
            // Primero en Supabase; si falla → IndexedDB para sincronización posterior
            try {
              const resumenImpuesto = snap.seleccionados.reduce(
                (acc, p) => {
                  const tasa = obtenerTasaImpuesto(p.tipo_impuesto, p.tipo);
                  const totalLinea = p.precio * p.cantidad;
                  if (tasa > 0) {
                    const base = totalLinea / (1 + tasa);
                    const imp = totalLinea - base;
                    acc.subTotal += base;
                    if (Math.abs(tasa - 0.18) < 0.0001) acc.isv18 += imp;
                    else acc.isv15 += imp;
                  } else {
                    acc.subTotal += totalLinea;
                  }
                  return acc;
                },
                { subTotal: 0, isv15: 0, isv18: 0 },
              );
              const subTotal = resumenImpuesto.subTotal;
              const isv15 = resumenImpuesto.isv15;
              const isv18 = resumenImpuesto.isv18;
              if (snap.facturaActual === "Límite alcanzado") {
                alert(
                  "¡Se ha alcanzado el límite de facturas para este cajero!",
                );
                return;
              }
              const factura = facturaParaEstaVenta;
              // Tipo SAR: CONTADO por defecto (créditos van por handleVentaCredito)
              const tipoVenta: string = "CONTADO";
              const ventaCompleta = {
                fecha_hora: formatToHondurasLocal(),
                cajero: usuarioActual?.nombre || "",
                cajero_id: usuarioActual?.id || null,
                caja: caiInfo?.caja_asignada || "",
                cai:
                  sarCaiFactura || (caiInfo && caiInfo.cai ? caiInfo.cai : ""),
                factura,
                cliente: snap.nombreCliente,
                tipo_orden: snap.tipoOrden,
                tipo: tipoVenta,
                operation_id: operationId,
                productos: JSON.stringify(
                  snap.seleccionados.map((p) => ({
                    id: p.id,
                    nombre: p.nombre,
                    precio: p.precio,
                    cantidad: p.cantidad,
                    tipo: p.tipo,
                    tipo_impuesto: String(
                      obtenerTasaImpuesto(p.tipo_impuesto, p.tipo),
                    ),
                    tasa_impuesto: obtenerTasaImpuesto(p.tipo_impuesto, p.tipo),
                    complementos: p.complementos ?? [],
                    piezas: p.piezas ?? null,
                  })),
                ),
                sub_total: esDonacion ? "0.00" : subTotal.toFixed(2),
                isv_15: esDonacion ? "0.00" : isv15.toFixed(2),
                isv_18: esDonacion ? "0.00" : isv18.toFixed(2),
                descuento:
                  snap.totalDescuento > 0
                    ? Number(snap.totalDescuento.toFixed(2))
                    : null,
                total: snap.totalConDescuento.toFixed(2),
                es_donacion: esDonacion ? true : null,
                // ── Campos fiscales SAR Honduras ──────────────────────────────
                tipo_documento_fiscal: tipoDocumentoFiscal,
                rtn_cliente:
                  tipoDocumentoFiscal === "FACTURA" && rtnCliente.trim()
                    ? rtnCliente.trim()
                    : null,
                nombre_cliente_fiscal:
                  tipoDocumentoFiscal === "FACTURA"
                    ? nombreClienteFiscal.trim() ||
                      snap.nombreCliente ||
                      "CONSUMIDOR FINAL"
                    : null,
                numero_secuencial:
                  tipoDocumentoFiscal === "FACTURA"
                    ? sarNumeroSecuencial
                    : null,
                fecha_limite_emision_cai:
                  tipoDocumentoFiscal === "FACTURA"
                    ? sarFechaLimiteEmision
                    : null,
                // Campos de pago (fusión con pagosf)
                ...pagoDataCapturado,
              };

              if (isOnline) {
                let guardadoEnSupabase = false;

                // Helper: obtener el siguiente número disponible consultando directamente
                // el MAX de ventas (funciona incluso si el RPC tiene el contador desincronizado)
                const obtenerSiguienteDisponible = async (): Promise<
                  string | null
                > => {
                  // 1. Intentar primero con el RPC (correcto cuando el SQL está actualizado)
                  const { data: rpcNum, error: rpcErr } = await supabase.rpc(
                    "obtener_siguiente_factura",
                    { p_cajero_id: usuarioActual?.id ?? "" },
                  );
                  if (!rpcErr && rpcNum && rpcNum !== "LIMITE_ALCANZADO") {
                    // Verificar que el número sea realmente libre para ESTE cajero.
                    // La constraint uq_ventas_factura_cajero es UNIQUE(factura, cajero_id).
                    const { data: existe } = await supabase
                      .from("ventas")
                      .select("id")
                      .eq("factura", rpcNum)
                      .eq("cajero_id", usuarioActual?.id ?? "")
                      .maybeSingle();
                    if (!existe) return rpcNum as string;
                  }
                  // 2. Fallback: MAX del cajero actual — ordenar por id DESC para capturar
                  // las facturas más recientes (evita truncado de 1000 filas por defecto)
                  try {
                    const { data: rows } = await supabase
                      .from("ventas")
                      .select("factura")
                      .eq("cajero_id", usuarioActual?.id ?? "")
                      .not("factura", "like", "DEV-%")
                      .not("factura", "like", "OFFLINE-%")
                      .order("id", { ascending: false })
                      .limit(500);
                    if (rows && rows.length > 0) {
                      const maxNum = rows.reduce((max, r) => {
                        const n = parseInt(r.factura);
                        return Number.isFinite(n) ? Math.max(max, n) : max;
                      }, 0);
                      const siguiente = (maxNum + 1).toString();
                      // Sincronizar el contador en cai_facturas
                      await supabase
                        .from("cai_facturas")
                        .update({ factura_actual: (maxNum + 2).toString() })
                        .eq("cajero_id", usuarioActual?.id ?? "")
                        .eq("tipo_comprobante", "RECIBO");
                      return siguiente;
                    }
                  } catch {
                    /* ignore */
                  }
                  return null;
                };

                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 5000);

                  const { error: supabaseError } = await supabase
                    .from("ventas")
                    .insert([ventaCompleta])
                    .abortSignal(controller.signal);

                  clearTimeout(timeoutId);

                  if (supabaseError) {
                    console.error(
                      "Error guardando venta en Supabase:",
                      supabaseError,
                    );
                    if (
                      supabaseError.code === "23505" ||
                      (supabaseError as any).status === 409
                    ) {
                      // Detectar conflicto de factura con cualquier nombre de constraint
                      const msg = supabaseError.message ?? "";
                      const esConflictoFactura =
                        msg.includes("ventas_factura_key") ||
                        msg.includes("uq_ventas_factura") ||
                        msg.includes("factura");

                      if (esConflictoFactura) {
                        let intentos = 0;
                        while (!guardadoEnSupabase && intentos < 10) {
                          intentos++;
                          let ventaCorregida = { ...ventaCompleta } as any;
                          let nuevoNum = "";

                          if (tipoDocumentoFiscal === "FACTURA") {
                            const { data: sarRetry, error: sarRetryErr } =
                              await supabase.rpc(
                                "siguiente_numero_factura_sar",
                                {
                                  p_cajero_id: usuarioActual?.id ?? "",
                                },
                              );

                            if (
                              sarRetryErr ||
                              !sarRetry ||
                              sarRetry.length === 0
                            ) {
                              console.error(
                                "No se pudo obtener nuevo correlativo SAR en reintento:",
                                sarRetryErr,
                              );
                              break;
                            }

                            const sarRowRetry = sarRetry[0];
                            nuevoNum =
                              sarRowRetry.numero_factura_formado as string;
                            ventaCorregida = {
                              ...ventaCompleta,
                              factura: nuevoNum,
                              numero_secuencial:
                                (sarRowRetry.numero_secuencial as number) ??
                                ventaCompleta.numero_secuencial,
                              fecha_limite_emision_cai:
                                (sarRowRetry.fecha_limite_emision as string) ??
                                ventaCompleta.fecha_limite_emision_cai,
                              cai:
                                (sarRowRetry.cai as string) ||
                                ventaCompleta.cai,
                            };
                          } else {
                            // RECIBO: buscar siguiente número libre en su secuencia
                            const numBase = await obtenerSiguienteDisponible();
                            const numActual = numBase
                              ? parseInt(numBase)
                              : null;
                            if (numActual === null) {
                              console.error(
                                "No se pudo obtener número libre para RECIBO",
                              );
                              break;
                            }
                            nuevoNum = numActual.toString();
                            ventaCorregida = {
                              ...ventaCompleta,
                              factura: nuevoNum,
                            };
                          }

                          console.warn(
                            `⚠ Factura ${factura} ya existe. Buscando número libre (intento ${intentos})... → ${nuevoNum}`,
                          );
                          const { error: retryErr } = await supabase
                            .from("ventas")
                            .insert([ventaCorregida]);
                          if (!retryErr) {
                            console.log(
                              `✓ Venta guardada con factura corregida: ${nuevoNum}`,
                            );
                            guardadoEnSupabase = true;
                            // Actualizar facturaParaEstaVenta para que el bloque posterior
                            // incremente el contador desde el número correcto
                            facturaParaEstaVenta = nuevoNum;
                            // Solo actualizar estado RECIBO; FACTURA SAR usa RPC atómico
                            if (tipoDocumentoFiscal !== "FACTURA") {
                              const siguienteDisplay = (
                                parseInt(nuevoNum) + 1
                              ).toString();
                              try {
                                await persistirReciboActual(siguienteDisplay, {
                                  actualizarSupabase: Boolean(
                                    usuarioActual?.id,
                                  ),
                                });
                              } catch (err) {
                                console.error(
                                  "Error corrigiendo factura_actual de RECIBO:",
                                  err,
                                );
                              }
                            }
                          } else if (
                            retryErr.code === "23505" ||
                            (retryErr as any).status === 409
                          ) {
                            // Número tomado → volver a solicitar en siguiente iteración
                          } else {
                            // Error no recuperable
                            console.error(
                              "Error no recuperable al guardar venta:",
                              retryErr,
                            );
                            break;
                          }
                        }
                      } else {
                        // Verificar si es doble submit (mismo operation_id)
                        const { data: yaGuardada } = await supabase
                          .from("ventas")
                          .select("id")
                          .eq("operation_id", operationId)
                          .maybeSingle();
                        if (yaGuardada) {
                          console.log(
                            `✓ Venta ya estaba en Supabase (mismo operation_id). Ignorando.`,
                          );
                          guardadoEnSupabase = true;
                        } else {
                          console.error(
                            `⚠ Conflicto inesperado al guardar venta (factura ${factura}).`,
                          );
                        }
                      }
                    }
                  } else {
                    console.log(
                      `✓ Venta ${ventaCompleta.factura} guardada en Supabase exitosamente`,
                    );
                    guardadoEnSupabase = true;
                  }
                } catch (supabaseErr) {
                  console.error(
                    "Error de conexión/timeout al guardar venta:",
                    supabaseErr,
                  );
                }

                // Siempre guardar en IDB (fuente primaria offline)
                await guardarVentaLocal(ventaCompleta);
                if (!guardadoEnSupabase) {
                  console.log(
                    "⚠ Fallo en Supabase. Venta guardada en IndexedDB para sincronización",
                  );
                } else {
                  console.log(
                    `✓ Venta ${ventaCompleta.factura} guardada en IDB + Supabase`,
                  );
                }
              } else {
                // SIN INTERNET: guardar en IndexedDB para sincronización posterior
                await guardarVentaLocal(ventaCompleta);
                console.log(
                  `✓ Venta ${ventaCompleta.factura} guardada en IndexedDB (sin conexión)`,
                );
              }

              // ── Actualizar estado local de factura ─────────────────────────
              // Si se usó el RPC, el contador YA fue incrementado atómicamente
              // en Supabase. Solo actualizamos la UI y el cache offline.
              // Si no se usó el RPC (modo offline/fallback), incrementamos también en Supabase.
              if (
                // FACTURA SAR: el RPC siguiente_numero_factura_sar ya actualizó
                // factura_actual atómicamente en Supabase. No tocar facturaActual
                // (estado de RECIBO) ni el cache de RECIBO.
                facturaParaEstaVenta &&
                !facturaParaEstaVenta.startsWith("OFFLINE-") &&
                tipoDocumentoFiscal !== "FACTURA"
              ) {
                const numUsado = parseInt(facturaParaEstaVenta);
                if (!Number.isFinite(numUsado)) {
                  console.error(
                    "[facturar] facturaParaEstaVenta no es un número válido, omitiendo incremento:",
                    facturaParaEstaVenta,
                  );
                } else {
                  const nuevaFactura = (numUsado + 1).toString();
                  try {
                    await persistirReciboActual(nuevaFactura, {
                      actualizarSupabase:
                        !usandoRpc && Boolean(usuarioActual?.id),
                    });
                    console.log(
                      `[facturar] op=${operationId} → factura_actual RECIBO actualizada a ${nuevaFactura}`,
                    );
                  } catch (err) {
                    console.error(
                      "Error actualizando factura_actual de RECIBO:",
                      err,
                    );
                  }
                }
              }

              if (
                tipoDocumentoFiscal === TIPO_FACTURA &&
                facturaParaEstaVenta
              ) {
                const secuencialUsado =
                  sarNumeroSecuencial ??
                  parseSecuencialDocumento(facturaParaEstaVenta);
                if (secuencialUsado && Number.isFinite(secuencialUsado)) {
                  const siguiente = secuencialUsado + 1;
                  try {
                    await persistirFacturaActualOffline(siguiente);
                  } catch (err) {
                    console.error(
                      "Error actualizando factura_actual de FACTURA en IDB:",
                      err,
                    );
                  }
                }
              }
            } catch (err) {
              console.error("Error al guardar la venta:", err);
              alert(
                "Error al guardar la factura. Por favor, contacte al administrador.",
              );
            } finally {
              // Siempre limpiar el formulario y liberar el guard,
              // independientemente de si la operación fue exitosa o no.
              limpiarSeleccion();
              setNombreCliente("");
              // Resetear estado SAR para la próxima venta
              setTipoDocumentoFiscal("RECIBO");
              setRtnCliente("");
              setNombreClienteFiscal("");
              isSubmittingRef.current = false;
              // Actualizar contadores 🍽/🥤 en tiempo real desde IDB
              fetchConteoTurno();
              console.log(`[facturar] op=${operationId} → finalizado.`);
            }
          }, 300);
        }}
      />
      <h1
        style={{
          color: "#1976d2",
          marginBottom: 24,
          textAlign: "center",
          width: "100%",
          fontSize: "2.8rem",
          fontWeight: 800,
          letterSpacing: 2,
          background: "linear-gradient(90deg, #1976d2 60%, #388e3c 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          paddingTop: 32,
          paddingBottom: 8,
        }}
      ></h1>
      {error && <p style={{ color: "red", textAlign: "center" }}>{error}</p>}

      <div
        style={{
          display: "flex",
          gap: 24,
          width: "100%",
          height: "calc(100vh - 2px)",
          justifyContent: "center",
          alignItems: "stretch",
          marginBottom: "2px",
        }}
      >
        {/* Menu Section */}
        <div
          style={{
            flex: 2,
            minWidth: 0,
            order: 2,
            background: theme === "lite" ? "#fff" : "#232526",
            borderRadius: 18,
            boxShadow:
              theme === "lite"
                ? "0 4px 16px rgba(0,0,0,0.12)"
                : "0 4px 16px #0008",
            padding: 8,
            transition: "background 0.3s",
          }}
        >
          {/* Tabs for Comida/Bebida/Complemento */}
          <div
            style={{
              display: "flex",
              gap: 16,
              marginBottom: 24,
              borderBottom: "2px solid #e0e0e0",
            }}
          >
            <button
              onClick={() => {
                setActiveTab("comida");
                setSubcategoriaFiltro(null);
              }}
              style={{
                flex: 1,
                padding: "12px 0",
                fontSize: 18,
                fontWeight: activeTab === "comida" ? 700 : 400,
                color: activeTab === "comida" ? "#388e3c" : "#666",
                background: "none",
                border: "none",
                borderBottom:
                  activeTab === "comida" ? "3px solid #388e3c" : "none",
                cursor: "pointer",
                transition: "all 0.3s",
              }}
            >
              Comidas
            </button>
            <button
              onClick={() => {
                setActiveTab("complemento");
                setSubcategoriaFiltro(null);
              }}
              style={{
                flex: 1,
                padding: "12px 0",
                fontSize: 18,
                fontWeight: activeTab === "complemento" ? 700 : 400,
                color: activeTab === "complemento" ? "#9c27b0" : "#666",
                background: "none",
                border: "none",
                borderBottom:
                  activeTab === "complemento" ? "3px solid #9c27b0" : "none",
                cursor: "pointer",
                transition: "all 0.3s",
              }}
            >
              Complementos
            </button>
            <button
              onClick={() => {
                setActiveTab("bebida");
                setSubcategoriaFiltro(null);
              }}
              style={{
                flex: 1,
                padding: "12px 0",
                fontSize: 18,
                fontWeight: activeTab === "bebida" ? 700 : 400,
                color: activeTab === "bebida" ? "#1976d2" : "#666",
                background: "none",
                border: "none",
                borderBottom:
                  activeTab === "bebida" ? "3px solid #1976d2" : "none",
                cursor: "pointer",
                transition: "all 0.3s",
              }}
            >
              Bebidas
            </button>
          </div>

          {/* Botones de filtro por subcategor\u00eda (solo para comida) */}
          {activeTab === "comida" &&
            (() => {
              const subcategorias = Array.from(
                new Set(
                  productos
                    .filter((p) => p.tipo === "comida" && p.subcategoria)
                    .map((p) => p.subcategoria),
                ),
              ).filter(Boolean) as string[];

              if (subcategorias.length === 0) return null;

              const colores = [
                { bg: "#ff6b6b", hover: "#ee5a5a" },
                { bg: "#4ecdc4", hover: "#45b8b0" },
                { bg: "#ffe66d", hover: "#f4d747" },
                { bg: "#95e1d3", hover: "#7dd4c3" },
                { bg: "#ffa502", hover: "#e89400" },
                { bg: "#ff6348", hover: "#e84c3a" },
              ];

              return (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 16,
                    flexWrap: "wrap",
                    padding: "8px 0",
                  }}
                >
                  {subcategorias.map((sub, idx) => {
                    const color = colores[idx % colores.length];
                    const isActive = subcategoriaFiltro === sub;
                    return (
                      <button
                        key={sub}
                        onClick={() => {
                          setSubcategoriaFiltro(isActive ? null : sub);
                        }}
                        style={{
                          padding: "10px 20px",
                          fontSize: 15,
                          fontWeight: 600,
                          color: "#fff",
                          background: isActive ? color.bg : "#bdbdbd",
                          border: "none",
                          borderRadius: 20,
                          cursor: "pointer",
                          transition: "all 0.3s",
                          boxShadow: isActive
                            ? `0 4px 8px ${color.bg}50`
                            : "none",
                          transform: isActive ? "scale(1.05)" : "scale(1)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = color.hover;
                          e.currentTarget.style.transform = "scale(1.05)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isActive
                            ? color.bg
                            : "#bdbdbd";
                          e.currentTarget.style.transform = isActive
                            ? "scale(1.05)"
                            : "scale(1)";
                        }}
                      >
                        {sub}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

          {/* Botón para registrar apertura si no existe */}
          {verificandoApertura && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                padding: "40px 20px",
                background: theme === "lite" ? "#e3f2fd" : "#1a2332",
                borderRadius: 16,
                marginBottom: 20,
                border: `2px solid ${theme === "lite" ? "#2196f3" : "#42a5f5"}`,
              }}
            >
              <div style={{ textAlign: "center" }}>
                <p
                  style={{
                    margin: "0",
                    fontSize: 16,
                    fontWeight: 600,
                    color: theme === "lite" ? "#1565c0" : "#90caf9",
                  }}
                >
                  Verificando apertura de caja...
                </p>
              </div>
            </div>
          )}

          {/* Modal obligatorio: sin apertura de caja */}
          {aperturaRegistrada === false && !verificandoApertura && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                background: "rgba(0,0,0,0.55)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  background: theme === "lite" ? "#fffbe6" : "#1e1a0e",
                  border: `2px solid ${theme === "lite" ? "#ffc107" : "#ff9800"}`,
                  borderRadius: 20,
                  padding: "48px 40px",
                  maxWidth: 420,
                  width: "90%",
                  textAlign: "center",
                  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                }}
              >
                {datosNegocio?.logo_url ? (
                  <img
                    src={datosNegocio.logo_url}
                    alt="Logo"
                    style={{
                      width: 100,
                      height: 100,
                      objectFit: "contain",
                      borderRadius: 16,
                      marginBottom: 16,
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
                )}
                <h2
                  style={{
                    margin: "0 0 12px 0",
                    fontSize: 22,
                    fontWeight: 800,
                    color: theme === "lite" ? "#7c5200" : "#ffb74d",
                  }}
                >
                  Caja sin apertura
                </h2>
                <p
                  style={{
                    margin: "0 0 28px 0",
                    fontSize: 15,
                    color: theme === "lite" ? "#856404" : "#ffe082",
                    lineHeight: 1.5,
                  }}
                >
                  No hay apertura de caja activa.
                  <br />
                  Registra una apertura para continuar.
                </p>
                <button
                  onClick={registrarAperturaRapida}
                  disabled={registrandoApertura}
                  style={{
                    padding: "14px 40px",
                    fontSize: 17,
                    fontWeight: 700,
                    background: !isOnline ? "#f57c00" : "#1976d2",
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    cursor: registrandoApertura ? "not-allowed" : "pointer",
                    opacity: registrandoApertura ? 0.6 : 1,
                    boxShadow: "0 6px 20px rgba(25,118,210,0.4)",
                    width: "100%",
                  }}
                >
                  {registrandoApertura
                    ? "⏳ Registrando..."
                    : !isOnline
                      ? "REGISTRAR APERTURA (OFFLINE)"
                      : "REGISTRAR APERTURA"}
                </button>
              </div>
            </div>
          )}

          {/* Product Grid */}
          {loading ? (
            <p style={{ textAlign: "center" }}>Cargando...</p>
          ) : aperturaRegistrada === false ? (
            <p style={{ textAlign: "center", color: "#999" }}>
              Registra la apertura para ver los productos
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 20,
                maxHeight: "60vh",
                overflowY: "auto",
                paddingRight: 8,
              }}
            >
              {productosFiltrados.map((p) => (
                <div
                  key={p.id}
                  onClick={() => agregarProducto(p)}
                  style={{
                    background: theme === "lite" ? "#fff" : "#333",
                    borderRadius: 18,
                    padding: 16,
                    boxShadow:
                      theme === "lite"
                        ? "0 4px 16px rgba(0,0,0,0.12)"
                        : "0 4px 16px #0008",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    transition:
                      "transform 0.2s, background 0.3s', color 0.3s', box-shadow 0.3s', border 0.3s',",
                    minHeight: 180,
                    color: theme === "lite" ? "#222" : "#f5f5f5",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.transform = "scale(1.07)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.transform = "scale(1)")
                  }
                >
                  <div
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "center",
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        background: theme === "lite" ? "#fff7cc" : "#2b2b2b",
                        color: theme === "lite" ? "#3b2f00" : "#f5f5f5",
                        padding: "6px 12px",
                        borderRadius: 999,
                        fontWeight: 800,
                        boxShadow:
                          theme === "lite"
                            ? "0 6px 18px rgba(251,192,45,0.12)"
                            : "0 6px 18px rgba(0,0,0,0.6)",
                        fontSize: 18,
                      }}
                    >
                      L {p.precio.toFixed(2)}
                    </div>
                  </div>

                  {p.imagen && (
                    <img
                      src={p.imagen}
                      alt={p.nombre}
                      style={{
                        width: "100%",
                        height: 140,
                        objectFit: "cover",
                        borderRadius: 12,
                        marginBottom: 12,
                        boxShadow:
                          theme === "lite"
                            ? "0 8px 24px rgba(16,24,40,0.08)"
                            : "0 8px 24px rgba(0,0,0,0.6)",
                      }}
                    />
                  )}

                  <div style={{ textAlign: "center", width: "100%" }}>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 18,
                        color: theme === "lite" ? "#111827" : "#f5f5f5",
                        marginBottom: 6,
                        lineHeight: 1.1,
                      }}
                    >
                      {p.nombre}
                    </div>
                  </div>
                  {/* precio mostrado arriba en badge; eliminado aquí para evitar duplicado */}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Order Summary Section */}
        <div
          style={{
            flex: 1,
            order: 1,
            minWidth: 300,
            background: theme === "lite" ? "#e6eef6" : "#263238",
            borderRadius: 16,
            boxShadow:
              theme === "lite"
                ? "0 6px 20px rgba(16,24,40,0.06)"
                : "0 6px 20px rgba(0,0,0,0.6)",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            color: theme === "lite" ? "#0f1724" : "#f5f5f5",
            transition: "background 0.3s, color 0.3s",
          }}
        >
          <h2
            style={{
              color: theme === "lite" ? "#1976d2" : "#64b5f6",
              marginBottom: 12,
              textAlign: "center",
            }}
          >
            Pedido Actual
          </h2>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: theme === "lite" ? "#1565c0" : "#90caf9",
              }}
            >
              L {totalConDescuento.toFixed(2)}
            </div>
            {totalDescuento > 0 && (
              <div
                style={{
                  fontSize: 13,
                  color: "#ff9800",
                  fontWeight: 700,
                  marginTop: 2,
                }}
              >
                🏷️ Descuento: -L {totalDescuento.toFixed(2)}
              </div>
            )}
          </div>
          {seleccionados.length === 0 ? (
            <p style={{ color: "#666", textAlign: "center" }}>
              No hay productos seleccionados
            </p>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {/* Botones principales arriba de la tabla */}
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <button
                  onClick={limpiarSeleccion}
                  style={{
                    background:
                      theme === "lite"
                        ? "linear-gradient(90deg,#ef5350,#e53935)"
                        : "#b71c1c",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 20px",
                    fontWeight: 700,
                    fontSize: 15,
                    cursor:
                      seleccionados.length === 0 ? "not-allowed" : "pointer",
                    opacity: seleccionados.length === 0 ? 0.5 : 1,
                    boxShadow: "0 6px 18px rgba(16,24,40,0.06)",
                    transition:
                      "transform 0.18s, box-shadow 0.18s, opacity 0.18s",
                  }}
                  onMouseEnter={(e) => {
                    if (seleccionados.length === 0) return;
                    e.currentTarget.style.transform = "translateY(-3px)";
                    e.currentTarget.style.boxShadow =
                      "0 10px 30px rgba(16,24,40,0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 6px 18px rgba(16,24,40,0.06)";
                  }}
                  disabled={seleccionados.length === 0}
                >
                  Limpiar
                </button>

                <button
                  style={{
                    background:
                      theme === "lite"
                        ? "linear-gradient(90deg,#42a5f5,#1e88e5)"
                        : "linear-gradient(90deg,#1976d2,#1565c0)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 22px",
                    fontWeight: 800,
                    fontSize: 15,
                    cursor:
                      seleccionados.length === 0 ? "not-allowed" : "pointer",
                    opacity: seleccionados.length === 0 ? 0.5 : 1,
                    boxShadow: "0 8px 26px rgba(25,118,210,0.12)",
                    transition:
                      "transform 0.18s, box-shadow 0.18s, opacity 0.18s",
                  }}
                  disabled={seleccionados.length === 0}
                  onMouseEnter={(e) => {
                    if (seleccionados.length === 0) return;
                    e.currentTarget.style.transform = "translateY(-3px)";
                    e.currentTarget.style.boxShadow =
                      "0 12px 36px rgba(25,118,210,0.18)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 8px 26px rgba(25,118,210,0.12)";
                  }}
                  onClick={() => {
                    if (facturaActual === "Límite alcanzado") {
                      alert("¡Límite de facturas alcanzado!");
                      return;
                    }
                    setShowOrdenModal(true);
                  }}
                >
                  Confirmar Pedido
                </button>

                <button
                  style={{
                    background:
                      theme === "lite"
                        ? "linear-gradient(90deg,#66bb6a,#43a047)"
                        : "#2e7d32",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 20px",
                    fontWeight: 700,
                    fontSize: 15,
                    cursor:
                      seleccionados.length === 0 ? "not-allowed" : "pointer",
                    opacity: seleccionados.length === 0 ? 0.5 : 1,
                    boxShadow: "0 6px 18px rgba(16,24,40,0.06)",
                    transition:
                      "transform 0.18s, box-shadow 0.18s, opacity 0.18s",
                  }}
                  disabled={seleccionados.length === 0}
                  onMouseEnter={(e) => {
                    if (seleccionados.length === 0) return;
                    e.currentTarget.style.transform = "translateY(-3px)";
                    e.currentTarget.style.boxShadow =
                      "0 10px 30px rgba(16,24,40,0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow =
                      "0 6px 18px rgba(16,24,40,0.06)";
                  }}
                  onClick={() => {
                    resetEnvioForm();
                    setShowEnvioModal(true);
                  }}
                >
                  Pedido por Teléfono
                </button>

                {posConfig.credito_habilitado && (
                  <button
                    style={{
                      background: "linear-gradient(90deg,#7c3aed,#6d28d9)",
                      color: "#fff",
                      border: "none",
                      borderRadius: 10,
                      padding: "10px 20px",
                      fontWeight: 700,
                      fontSize: 15,
                      cursor:
                        seleccionados.length === 0 ? "not-allowed" : "pointer",
                      opacity: seleccionados.length === 0 ? 0.5 : 1,
                      boxShadow: "0 6px 18px rgba(124,58,237,0.25)",
                      transition:
                        "transform 0.18s, box-shadow 0.18s, opacity 0.18s",
                    }}
                    disabled={seleccionados.length === 0}
                    onClick={() => {
                      if (facturaActual === "Límite alcanzado") {
                        alert("¡Límite de facturas alcanzado!");
                        return;
                      }
                      setShowCreditoClienteModal(true);
                    }}
                  >
                    💳 Facturar a Crédito
                  </button>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  padding: "10px 12px",
                  background: theme === "lite" ? "#eef6fb" : "#394a52",
                  borderRadius: "8px 8px 0 0",
                  fontWeight: 700,
                  fontSize: 13,
                  color: theme === "lite" ? "#475569" : "#cfd8dc",
                  marginBottom: 0,
                }}
              >
                <div style={{ flex: 2 }}>Producto</div>
                <div style={{ flex: 1, textAlign: "center" }}>Precio</div>
                <div style={{ flex: 1, textAlign: "center" }}>Cant.</div>
                <div style={{ flex: 1, textAlign: "right", paddingRight: 8 }}>
                  Total
                </div>
                <div style={{ width: 70, textAlign: "center" }}></div>
              </div>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  maxHeight: 380,
                  overflowY: "auto",
                  background: theme === "lite" ? "#fff" : "#2b2b2b",
                  borderRadius: "0 0 8px 8px",
                  border:
                    theme === "lite"
                      ? "1px solid #e1eef9"
                      : "1px solid #2f3f43",
                  borderTop: "none",
                }}
              >
                {seleccionados.map((p, index) => (
                  <li
                    key={p.id}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      padding: "8px 12px",
                      gap: 8,
                      borderBottom:
                        theme === "lite"
                          ? "1px solid #f3f9ff"
                          : "1px solid #253034",
                      background:
                        index % 2 === 0
                          ? theme === "lite"
                            ? "#ffffff"
                            : "#262626"
                          : theme === "lite"
                            ? "#fbfeff"
                            : "#232323",
                      color: theme === "lite" ? "#0f1724" : "#f5f5f5",
                    }}
                  >
                    <div
                      style={{
                        order: 0,
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        flex: "0 0 auto",
                      }}
                    >
                      {p.tipo === "comida" && (
                        <>
                          {posConfig.complementos_habilitado && (
                            <button
                              onClick={() => {
                                setSelectedProductIndex(index);
                                setShowComplementosModal(true);
                              }}
                              style={{
                                background: "#4caf50",
                                color: "#fff",
                                border: "none",
                                borderRadius: 4,
                                width: 32,
                                height: 32,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                fontSize: 16,
                                lineHeight: 1,
                              }}
                              title="Complementos Incluidos"
                              aria-label={`Complementos de ${p.nombre}`}
                            >
                              🍗
                            </button>
                          )}
                          {posConfig.piezas_habilitado && (
                            <button
                              onClick={() => {
                                setSelectedProductIndex(index);
                                setShowPiezasModal(true);
                              }}
                              style={{
                                background: "#f59e0b",
                                color: "#fff",
                                border: "none",
                                borderRadius: 4,
                                width: 32,
                                height: 32,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                fontSize: 16,
                                lineHeight: 1,
                              }}
                              title="Piezas"
                              aria-label={`Piezas de ${p.nombre}`}
                            >
                              🍖
                            </button>
                          )}
                          {posConfig.descuento_habilitado && (
                            <button
                              onClick={() => {
                                setDescuentosProductos((prev) => {
                                  const newSet = new Set(prev);
                                  if (newSet.has(p.id)) {
                                    newSet.delete(p.id);
                                  } else {
                                    newSet.add(p.id);
                                  }
                                  return newSet;
                                });
                              }}
                              style={{
                                background: descuentosProductos.has(p.id)
                                  ? "#ff9800"
                                  : "#607d8b",
                                color: "#fff",
                                border: descuentosProductos.has(p.id)
                                  ? "2px solid #e65100"
                                  : "2px solid transparent",
                                borderRadius: 4,
                                width: 32,
                                height: 32,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                fontSize: 13,
                                fontWeight: 800,
                                lineHeight: 1,
                              }}
                              title={
                                descuentosProductos.has(p.id)
                                  ? `Quitar descuento (-L ${montoDescuentoComida})`
                                  : `Aplicar descuento (-L ${montoDescuentoComida})`
                              }
                              aria-label={`Descuento ${p.nombre}`}
                            >
                              %
                            </button>
                          )}
                        </>
                      )}
                      <button
                        onClick={() => eliminarProducto(p.id)}
                        style={{
                          background: "#d32f2f",
                          color: "#fff",
                          border: "none",
                          borderRadius: 4,
                          width: 32,
                          height: 32,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          fontSize: 16,
                          lineHeight: 1,
                        }}
                        title="Eliminar"
                        aria-label={`Eliminar ${p.nombre}`}
                      >
                        −
                      </button>
                    </div>
                    <div
                      style={{
                        order: 1,
                        flex: "2 1 140px",
                        minWidth: 120,
                        fontSize: 14,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 600,
                          color: theme === "lite" ? "#1976d2" : "#64b5f6",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.nombre}
                      </div>
                      {p.complementos && p.complementos.length > 0 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: theme === "lite" ? "#666" : "#999",
                            marginTop: 2,
                          }}
                        >
                          {p.complementos.join(", ")}
                        </div>
                      )}
                      {p.piezas && p.piezas !== "PIEZAS VARIAS" && (
                        <div
                          style={{
                            fontSize: 11,
                            color: theme === "lite" ? "#ff9800" : "#ffb74d",
                            marginTop: 2,
                          }}
                        >
                          {p.piezas}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        order: 2,
                        flex: "1 0 80px",
                        minWidth: 80,
                        textAlign: "center",
                        fontSize: 13,
                      }}
                    >
                      L {p.precio.toFixed(2)}
                    </div>
                    <div
                      style={{
                        order: 3,
                        flex: "1 0 64px",
                        minWidth: 64,
                        textAlign: "center",
                        fontSize: 13,
                        color: theme === "lite" ? "#388e3c" : "#81c784",
                        fontWeight: 600,
                      }}
                    >
                      x{p.cantidad}
                    </div>
                    <div
                      style={{
                        order: 4,
                        flex: "1 0 90px",
                        minWidth: 90,
                        textAlign: "right",
                        fontWeight: 700,
                        fontSize: 14,
                        paddingRight: 8,
                      }}
                    >
                      L {(p.precio * p.cantidad).toFixed(2)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Modal para seleccionar tipo de ORDEN */}
      {showOrdenModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 20,
              boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
              padding: 40,
              minWidth: 400,
              maxWidth: 500,
              width: "100%",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              gap: 24,
              color: theme === "lite" ? "#222" : "#f5f5f5",
            }}
          >
            <h2
              style={{
                color: "#1976d2",
                marginBottom: 8,
                textAlign: "center",
                fontSize: 32,
                fontWeight: 800,
              }}
            >
              ORDEN
            </h2>
            <p
              style={{
                textAlign: "center",
                color: "#666",
                fontSize: 16,
                margin: 0,
              }}
            >
              Seleccione el tipo de orden
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <button
                onClick={() => {
                  setTipoOrden("PARA LLEVAR");
                  setShowOrdenModal(false);
                  setShowClienteModal(true);
                }}
                style={{
                  background:
                    "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  color: "#fff",
                  borderRadius: 12,
                  border: "none",
                  padding: "20px 32px",
                  fontWeight: 700,
                  fontSize: 24,
                  cursor: "pointer",
                  transition: "transform 0.2s, box-shadow 0.2s",
                  boxShadow: "0 4px 15px rgba(102,126,234,0.4)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow =
                    "0 6px 20px rgba(102,126,234,0.6)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow =
                    "0 4px 15px rgba(102,126,234,0.4)";
                }}
              >
                PARA LLEVAR
              </button>
              <button
                onClick={() => {
                  setTipoOrden("COMER AQUÍ");
                  setShowOrdenModal(false);
                  setShowClienteModal(true);
                }}
                style={{
                  background:
                    "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                  color: "#fff",
                  borderRadius: 12,
                  border: "none",
                  padding: "20px 32px",
                  fontWeight: 700,
                  fontSize: 24,
                  cursor: "pointer",
                  transition: "transform 0.2s, box-shadow 0.2s",
                  boxShadow: "0 4px 15px rgba(245,87,108,0.4)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow =
                    "0 6px 20px rgba(245,87,108,0.6)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow =
                    "0 4px 15px rgba(245,87,108,0.4)";
                }}
              >
                COMER AQUÍ
              </button>
            </div>
            <button
              onClick={() => setShowOrdenModal(false)}
              style={{
                background: "transparent",
                color: "#999",
                border: "2px solid #ddd",
                borderRadius: 8,
                padding: "12px 24px",
                fontWeight: 600,
                fontSize: 16,
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Modal de Complementos Incluidos */}
      {showComplementosModal && selectedProductIndex !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "16px",
            boxSizing: "border-box",
          }}
          onClick={() => {
            setShowComplementosModal(false);
            setSelectedProductIndex(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme === "lite" ? "#fff" : "#1e2022",
              borderRadius: 18,
              boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
              width: "100%",
              maxWidth: 420,
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              color: theme === "lite" ? "#222" : "#f5f5f5",
            }}
          >
            {/* Header fijo */}
            <div
              style={{
                background: "linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)",
                padding: "18px 20px 14px",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#fff",
                  textAlign: "center",
                  letterSpacing: 0.5,
                }}
              >
                🍗 COMPLEMENTOS INCLUIDOS
              </div>
              <div
                style={{
                  textAlign: "center",
                  color: "rgba(255,255,255,0.85)",
                  fontSize: 13,
                  marginTop: 4,
                }}
              >
                {seleccionados[selectedProductIndex]?.nombre}
              </div>
            </div>

            {/* Lista con scroll */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "12px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {complementosOpciones.map((opcion) => {
                const currentComplementos =
                  seleccionados[selectedProductIndex]?.complementos || [];
                const isSelected = currentComplementos.includes(opcion);
                return (
                  <button
                    key={opcion}
                    onClick={() => {
                      const newSeleccionados = [...seleccionados];
                      const cur =
                        newSeleccionados[selectedProductIndex]?.complementos ||
                        [];
                      newSeleccionados[selectedProductIndex] = {
                        ...newSeleccionados[selectedProductIndex],
                        complementos: isSelected
                          ? cur.filter((c) => c !== opcion)
                          : [...cur, opcion],
                      };
                      setSeleccionados(newSeleccionados);
                    }}
                    style={{
                      background: isSelected
                        ? "linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)"
                        : theme === "lite"
                          ? "#f5f5f5"
                          : "#2d2f31",
                      color: isSelected
                        ? "#fff"
                        : theme === "lite"
                          ? "#222"
                          : "#f0f0f0",
                      borderRadius: 10,
                      border: isSelected
                        ? "2px solid #2e7d32"
                        : `2px solid ${theme === "lite" ? "#ddd" : "#444"}`,
                      padding: "13px 16px",
                      fontWeight: isSelected ? 700 : 600,
                      fontSize: 15,
                      cursor: "pointer",
                      transition: "all 0.15s",
                      boxShadow: isSelected
                        ? "0 3px 10px rgba(76,175,80,0.35)"
                        : "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        border: isSelected
                          ? "2px solid #fff"
                          : "2px solid #aaa",
                        background: isSelected
                          ? "rgba(255,255,255,0.3)"
                          : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        flexShrink: 0,
                        fontWeight: 900,
                      }}
                    >
                      {isSelected && "✓"}
                    </span>
                    {opcion}
                  </button>
                );
              })}
            </div>

            {/* Footer fijo */}
            <div
              style={{
                padding: "12px 16px",
                borderTop: `1px solid ${theme === "lite" ? "#e0e0e0" : "#333"}`,
                flexShrink: 0,
                display: "flex",
                gap: 10,
              }}
            >
              <button
                onClick={() => {
                  const newSeleccionados = [...seleccionados];
                  newSeleccionados[selectedProductIndex] = {
                    ...newSeleccionados[selectedProductIndex],
                    complementos: [],
                  };
                  setSeleccionados(newSeleccionados);
                }}
                style={{
                  flex: 1,
                  background: theme === "lite" ? "#f5f5f5" : "#2d2f31",
                  color: theme === "lite" ? "#555" : "#ccc",
                  border: `1px solid ${theme === "lite" ? "#ddd" : "#444"}`,
                  borderRadius: 10,
                  padding: "13px 0",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Limpiar
              </button>
              <button
                onClick={() => {
                  setShowComplementosModal(false);
                  setSelectedProductIndex(null);
                }}
                style={{
                  flex: 2,
                  background: "#1976d2",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "13px 0",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                ✓ Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Piezas */}
      {showPiezasModal && selectedProductIndex !== null && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 20,
              boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
              padding: 40,
              minWidth: 400,
              maxWidth: 500,
              width: "100%",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              gap: 24,
              color: theme === "lite" ? "#222" : "#f5f5f5",
            }}
          >
            <h2
              style={{
                color: "#ff9800",
                marginBottom: 8,
                textAlign: "center",
                fontSize: 28,
                fontWeight: 800,
              }}
            >
              🍖 PIEZAS
            </h2>
            <p
              style={{
                textAlign: "center",
                color: "#666",
                fontSize: 14,
                margin: 0,
              }}
            >
              Seleccione las piezas para{" "}
              {seleccionados[selectedProductIndex]?.nombre}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {piezasOpciones.map((pieza) => {
                const currentPiezas =
                  seleccionados[selectedProductIndex]?.piezas ||
                  "PIEZAS VARIAS";
                const piezasArray = currentPiezas.split(", ");
                const isSelected = piezasArray.includes(pieza);

                return (
                  <button
                    key={pieza}
                    onClick={() => {
                      const newSeleccionados = [...seleccionados];
                      let newPiezas: string[];

                      if (pieza === "PIEZAS VARIAS") {
                        // Si selecciona PIEZAS VARIAS, deseleccionar todo lo demás
                        newPiezas = ["PIEZAS VARIAS"];
                      } else {
                        // Si selecciona otra pieza, quitar PIEZAS VARIAS
                        newPiezas = piezasArray.filter(
                          (p) => p !== "PIEZAS VARIAS",
                        );

                        if (isSelected) {
                          // Deseleccionar
                          newPiezas = newPiezas.filter((p) => p !== pieza);
                          // Si no queda nada, volver a PIEZAS VARIAS
                          if (newPiezas.length === 0) {
                            newPiezas = ["PIEZAS VARIAS"];
                          }
                        } else {
                          // Seleccionar
                          newPiezas.push(pieza);
                        }
                      }

                      newSeleccionados[selectedProductIndex] = {
                        ...newSeleccionados[selectedProductIndex],
                        piezas: newPiezas.join(", "),
                      };
                      setSeleccionados(newSeleccionados);
                    }}
                    style={{
                      background: isSelected
                        ? "linear-gradient(135deg, #ff9800 0%, #f57c00 100%)"
                        : theme === "lite"
                          ? "#f5f5f5"
                          : "#424242",
                      color: isSelected
                        ? "#fff"
                        : theme === "lite"
                          ? "#222"
                          : "#f5f5f5",
                      borderRadius: 10,
                      border: isSelected
                        ? "3px solid #f57c00"
                        : "2px solid #ddd",
                      padding: "16px 24px",
                      fontWeight: isSelected ? 700 : 600,
                      fontSize: 16,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      boxShadow: isSelected
                        ? "0 4px 15px rgba(255,152,0,0.4)"
                        : "none",
                    }}
                  >
                    {pieza}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => {
                setShowPiezasModal(false);
                setSelectedProductIndex(null);
              }}
              style={{
                background: "#1976d2",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px 24px",
                fontWeight: 600,
                fontSize: 16,
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              Aceptar
            </button>
          </div>
        </div>
      )}

      {/* Modal para nombre del cliente */}
      {showClienteModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background:
              theme === "lite" ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 16,
              boxShadow:
                theme === "lite"
                  ? "0 8px 32px rgba(25, 118, 210, 0.18)"
                  : "0 8px 32px #0008",
              padding: 32,
              minWidth: 350,
              maxWidth: 420,
              width: "100%",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              gap: 18,
              color: theme === "lite" ? "#222" : "#f5f5f5",
              transition: "background 0.3s, color 0.3s",
            }}
          >
            <h3 style={{ color: "#1976d2", marginBottom: 12 }}>
              Nombre del Cliente
            </h3>
            <input
              ref={(el) => el?.focus()}
              type="text"
              placeholder="Ingrese el nombre del cliente"
              value={nombreCliente}
              onChange={(e) => setNombreCliente(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nombreCliente.trim()) {
                  // preventDefault evita que el evento llegue al botón
                  // "Continuar" si tiene el foco, disparando dos veces
                  e.preventDefault();
                  setShowClienteModal(false);
                  continuarFlujoDocumento();
                }
              }}
              style={{
                padding: "10px",
                borderRadius: 8,
                border: "1px solid #ccc",
                fontSize: 16,
                marginBottom: 18,
              }}
            />
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <button
                onClick={() => setShowClienteModal(false)}
                style={{
                  background: "#9e9e9e",
                  color: "#fff",
                  borderRadius: 8,
                  border: "none",
                  padding: "10px 20px",
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (nombreCliente.trim()) {
                    setShowClienteModal(false);
                    continuarFlujoDocumento();
                  }
                }}
                style={{
                  background: "#1976d2",
                  color: "#fff",
                  borderRadius: 8,
                  border: "none",
                  padding: "10px 24px",
                  fontWeight: 600,
                  fontSize: 16,
                }}
                disabled={!nombreCliente.trim()}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal SAR Honduras: selección de tipo de documento fiscal ───────── */}
      {showSarModal && posConfig.tipo_venta === "ambos" && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background:
              theme === "lite" ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#1e293b",
              borderRadius: 20,
              padding: "32px 36px",
              minWidth: 360,
              maxWidth: 480,
              width: "92%",
              boxShadow:
                theme === "lite"
                  ? "0 20px 60px rgba(0,0,0,0.18)"
                  : "0 20px 60px rgba(0,0,0,0.6)",
              border:
                theme === "lite" ? "1px solid #e2e8f0" : "1px solid #334155",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* Encabezado */}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 4 }}>🧾</div>
              <h3
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 800,
                  color: theme === "lite" ? "#0f172a" : "#f1f5f9",
                }}
              >
                Tipo de Documento
              </h3>
              <p
                style={{
                  margin: "6px 0 0 0",
                  fontSize: 13,
                  color: theme === "lite" ? "#64748b" : "#94a3b8",
                }}
              >
                SAR Honduras — seleccione cómo se emitirá el comprobante
              </p>
            </div>

            {/* Botones principales */}
            <div style={{ display: "flex", gap: 14 }}>
              {/* RECIBO */}
              <button
                onClick={() => {
                  setTipoDocumentoFiscal("RECIBO");
                  setRtnCliente("");
                  setNombreClienteFiscal("");
                  setShowSarModal(false);
                  setShowPagoModal(true);
                }}
                style={{
                  flex: 1,
                  padding: "18px 10px",
                  borderRadius: 14,
                  border:
                    tipoDocumentoFiscal === "RECIBO"
                      ? "2.5px solid #1976d2"
                      : "2px solid #cbd5e1",
                  background:
                    theme === "lite"
                      ? tipoDocumentoFiscal === "RECIBO"
                        ? "#eff6ff"
                        : "#f8fafc"
                      : tipoDocumentoFiscal === "RECIBO"
                        ? "#1e3a5f"
                        : "#0f172a",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: 30 }}>🧾</span>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 17,
                    color: theme === "lite" ? "#1976d2" : "#60a5fa",
                  }}
                >
                  RECIBO
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: theme === "lite" ? "#64748b" : "#94a3b8",
                    textAlign: "center",
                    lineHeight: 1.4,
                  }}
                >
                  Sin correlativo SAR
                </span>
              </button>

              {/* FACTURA */}
              <button
                onClick={() => setTipoDocumentoFiscal("FACTURA")}
                style={{
                  flex: 1,
                  padding: "18px 10px",
                  borderRadius: 14,
                  border:
                    tipoDocumentoFiscal === "FACTURA"
                      ? "2.5px solid #16a34a"
                      : "2px solid #cbd5e1",
                  background:
                    theme === "lite"
                      ? tipoDocumentoFiscal === "FACTURA"
                        ? "#f0fdf4"
                        : "#f8fafc"
                      : tipoDocumentoFiscal === "FACTURA"
                        ? "#14532d"
                        : "#0f172a",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  transition: "all 0.15s",
                }}
              >
                <span style={{ fontSize: 30 }}>🏛️</span>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 17,
                    color: theme === "lite" ? "#16a34a" : "#4ade80",
                  }}
                >
                  FACTURA
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: theme === "lite" ? "#64748b" : "#94a3b8",
                    textAlign: "center",
                    lineHeight: 1.4,
                  }}
                >
                  Con correlativo SAR
                </span>
              </button>
            </div>

            {/* Campos fiscales — solo si eligió FACTURA */}
            {tipoDocumentoFiscal === "FACTURA" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  padding: "16px",
                  borderRadius: 12,
                  background:
                    theme === "lite" ? "#f0fdf4" : "rgba(20,83,45,0.25)",
                  border:
                    theme === "lite"
                      ? "1px solid #bbf7d0"
                      : "1px solid #166534",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: theme === "lite" ? "#166534" : "#4ade80",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Datos fiscales del cliente (opcionales)
                </p>

                {/* RTN */}
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: theme === "lite" ? "#374151" : "#94a3b8",
                      fontWeight: 600,
                    }}
                  >
                    RTN del cliente (14 dígitos)
                  </label>
                  <input
                    type="text"
                    placeholder="0000-0000-000000 — dejar vacío si no aplica"
                    value={rtnCliente}
                    maxLength={20}
                    onChange={(e) =>
                      setRtnCliente(
                        e.target.value.replace(/[^0-9\-]/g, "").toUpperCase(),
                      )
                    }
                    style={{
                      display: "block",
                      marginTop: 4,
                      width: "100%",
                      padding: "9px 12px",
                      borderRadius: 8,
                      border:
                        theme === "lite"
                          ? "1px solid #d1d5db"
                          : "1px solid #334155",
                      background: theme === "lite" ? "#fff" : "#0f172a",
                      color: theme === "lite" ? "#111" : "#f1f5f9",
                      fontSize: 14,
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* Nombre fiscal */}
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      color: theme === "lite" ? "#374151" : "#94a3b8",
                      fontWeight: 600,
                    }}
                  >
                    Nombre en la factura
                  </label>
                  <input
                    type="text"
                    placeholder={nombreCliente || "CONSUMIDOR FINAL"}
                    value={nombreClienteFiscal}
                    onChange={(e) =>
                      setNombreClienteFiscal(e.target.value.toUpperCase())
                    }
                    style={{
                      display: "block",
                      marginTop: 4,
                      width: "100%",
                      padding: "9px 12px",
                      borderRadius: 8,
                      border:
                        theme === "lite"
                          ? "1px solid #d1d5db"
                          : "1px solid #334155",
                      background: theme === "lite" ? "#fff" : "#0f172a",
                      color: theme === "lite" ? "#111" : "#f1f5f9",
                      fontSize: 14,
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Botones de acción */}
            <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
              <button
                onClick={() => {
                  setShowSarModal(false);
                  setTipoDocumentoFiscal("RECIBO");
                  setRtnCliente("");
                  setNombreClienteFiscal("");
                }}
                style={{
                  flex: 1,
                  padding: "11px 0",
                  borderRadius: 10,
                  border: "none",
                  background: theme === "lite" ? "#e2e8f0" : "#334155",
                  color: theme === "lite" ? "#374151" : "#cbd5e1",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                ← Atrás
              </button>
              <button
                onClick={() => {
                  setShowSarModal(false);
                  setShowPagoModal(true);
                }}
                style={{
                  flex: 2,
                  padding: "11px 0",
                  borderRadius: 10,
                  border: "none",
                  background:
                    tipoDocumentoFiscal === "FACTURA" ? "#16a34a" : "#1976d2",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 16,
                  cursor: "pointer",
                  boxShadow:
                    tipoDocumentoFiscal === "FACTURA"
                      ? "0 4px 14px rgba(22,163,74,0.4)"
                      : "0 4px 14px rgba(25,118,210,0.4)",
                }}
              >
                {tipoDocumentoFiscal === "FACTURA"
                  ? "🏛️ Continuar con Factura SAR"
                  : "🧾 Continuar con Recibo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para envío de pedido */}
      {showEnvioModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              background: theme === "lite" ? "#ffffff" : "#1e293b",
              borderRadius: 24,
              padding: 32,
              minWidth: 400,
              maxWidth: 900,
              width: "90%",
              boxShadow:
                theme === "lite"
                  ? "0 20px 60px rgba(0,0,0,0.15), 0 0 1px rgba(0,0,0,0.1)"
                  : "0 20px 60px rgba(0,0,0,0.5)",
              border:
                theme === "lite" ? "1px solid #e2e8f0" : "1px solid #334155",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 24,
                paddingBottom: 16,
                borderBottom:
                  theme === "lite" ? "2px solid #e2e8f0" : "2px solid #334155",
              }}
            >
              <div>
                <h3
                  style={{
                    margin: 0,
                    color: theme === "lite" ? "#0f172a" : "#f1f5f9",
                    fontSize: 28,
                    fontWeight: 800,
                    letterSpacing: "-0.5px",
                  }}
                >
                  📦 Pedido por Teléfono
                </h3>
                <p
                  style={{
                    margin: "4px 0 0 0",
                    color: theme === "lite" ? "#64748b" : "#94a3b8",
                    fontSize: 14,
                  }}
                >
                  Ingresa los datos del cliente
                </p>
              </div>
              <button
                onClick={() => setShowEnvioModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: theme === "lite" ? "#64748b" : "#94a3b8",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 24,
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    theme === "lite" ? "#f1f5f9" : "#334155";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 340px",
                gap: 24,
                alignItems: "start",
              }}
            >
              {/* Form Section */}
              <div>
                <div style={{ marginBottom: 20 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 14,
                      fontWeight: 600,
                      color: theme === "lite" ? "#334155" : "#e2e8f0",
                      marginBottom: 8,
                    }}
                  >
                    Nombre del cliente
                  </label>
                  <input
                    placeholder="Ingrese el nombre completo"
                    value={envioCliente}
                    onChange={(e) => setEnvioCliente(e.target.value)}
                    className="form-input"
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      fontSize: 15,
                      borderRadius: 10,
                      border:
                        theme === "lite"
                          ? "2px solid #e2e8f0"
                          : "2px solid #334155",
                      background: theme === "lite" ? "#ffffff" : "#0f172a",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 14,
                      fontWeight: 600,
                      color: theme === "lite" ? "#334155" : "#e2e8f0",
                      marginBottom: 8,
                    }}
                  >
                    Teléfono
                  </label>
                  <input
                    placeholder="Número de teléfono"
                    value={envioCelular}
                    onChange={(e) => setEnvioCelular(e.target.value)}
                    className="form-input"
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      fontSize: 15,
                      borderRadius: 10,
                      border:
                        theme === "lite"
                          ? "2px solid #e2e8f0"
                          : "2px solid #334155",
                      background: theme === "lite" ? "#ffffff" : "#0f172a",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 14,
                      fontWeight: 600,
                      color: theme === "lite" ? "#334155" : "#e2e8f0",
                      marginBottom: 8,
                    }}
                  >
                    Costo de envío (L)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={envioCosto}
                    onChange={(e) => setEnvioCosto(e.target.value)}
                    className="form-input"
                    placeholder="0.00"
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      fontSize: 15,
                      borderRadius: 10,
                      border:
                        theme === "lite"
                          ? "2px solid #e2e8f0"
                          : "2px solid #334155",
                      background: theme === "lite" ? "#ffffff" : "#0f172a",
                    }}
                  />
                </div>

                {posConfig.pedidos_telefono_cobro_automatico && (
                  <div style={{ marginBottom: 16 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: 14,
                        fontWeight: 600,
                        color: theme === "lite" ? "#334155" : "#e2e8f0",
                        marginBottom: 8,
                      }}
                    >
                      Tipo de pago
                    </label>
                    <select
                      value={envioTipoPago}
                      onChange={(e) =>
                        setEnvioTipoPago(
                          e.target.value as
                            | "Efectivo"
                            | "Tarjeta"
                            | "Transferencia"
                            | "Dolares",
                        )
                      }
                      className="form-input"
                      style={{
                        width: "100%",
                        padding: "12px 16px",
                        fontSize: 15,
                        borderRadius: 10,
                        border:
                          theme === "lite"
                            ? "2px solid #e2e8f0"
                            : "2px solid #334155",
                        background: theme === "lite" ? "#ffffff" : "#0f172a",
                      }}
                    >
                      <option value="Efectivo">Efectivo</option>
                      <option value="Tarjeta">Tarjeta</option>
                      <option value="Transferencia">Transferencia</option>
                      <option value="Dolares">Dólares</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Summary Section */}
              <div
                style={{
                  background:
                    theme === "lite"
                      ? "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)"
                      : "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
                  borderRadius: 16,
                  padding: 24,
                  boxShadow:
                    theme === "lite"
                      ? "0 4px 12px rgba(0,0,0,0.05)"
                      : "0 4px 12px rgba(0,0,0,0.3)",
                  border:
                    theme === "lite"
                      ? "1px solid #e2e8f0"
                      : "1px solid #334155",
                }}
              >
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: theme === "lite" ? "#0f172a" : "#f1f5f9",
                    marginBottom: 16,
                    letterSpacing: "-0.3px",
                  }}
                >
                  📋 Resumen del Pedido
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    fontSize: 15,
                    color: theme === "lite" ? "#475569" : "#cbd5e1",
                  }}
                >
                  <div>Subtotal</div>
                  <div style={{ fontWeight: 600 }}>
                    L {totalConDescuento.toFixed(2)}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    fontSize: 15,
                    color: theme === "lite" ? "#475569" : "#cbd5e1",
                  }}
                >
                  <div>Costo de envío</div>
                  <div style={{ fontWeight: 600 }}>
                    L {Number(envioCosto || 0).toFixed(2)}
                  </div>
                </div>
                {totalDescuento > 0 && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "10px 0",
                      fontSize: 15,
                      color: "#16a34a",
                    }}
                  >
                    <div>Descuento</div>
                    <div style={{ fontWeight: 600 }}>
                      − L {totalDescuento.toFixed(2)}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    height: 2,
                    background: theme === "lite" ? "#e2e8f0" : "#334155",
                    margin: "12px 0",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontWeight: 800,
                    fontSize: 20,
                    color: theme === "lite" ? "#0f172a" : "#f1f5f9",
                  }}
                >
                  <div>Total</div>
                  <div>
                    L{" "}
                    {(
                      totalConDescuento +
                      (posConfig.cobrar_delivery_en_pedidos
                        ? Number(envioCosto || 0)
                        : 0)
                    ).toFixed(2)}
                  </div>
                </div>
                {!posConfig.cobrar_delivery_en_pedidos && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: theme === "lite" ? "#64748b" : "#94a3b8",
                    }}
                  >
                    El delivery no se cobrará en factura (configuración activa)
                  </div>
                )}
                <div
                  style={{
                    marginTop: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <button
                    onClick={() => setShowEnvioModal(false)}
                    style={{
                      padding: "12px 20px",
                      borderRadius: 10,
                      border:
                        theme === "lite"
                          ? "2px solid #e2e8f0"
                          : "2px solid #334155",
                      background: "transparent",
                      color: theme === "lite" ? "#64748b" : "#94a3b8",
                      fontWeight: 600,
                      fontSize: 15,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={async () => {
                      // Prevenir múltiples ejecuciones simultáneas
                      if (savingEnvio) {
                        console.log(
                          "⚠ Ya se está guardando un pedido, ignorando clic adicional",
                        );
                        return;
                      }

                      // Guardar pedido de envío
                      setSavingEnvio(true);
                      try {
                        // determinar caja asignada
                        let cajaAsignada = caiInfo?.caja_asignada;
                        if (!cajaAsignada) {
                          try {
                            const { data: caiData } = await supabase
                              .from("cai_facturas")
                              .select("caja_asignada")
                              .eq("cajero_id", usuarioActual?.id)
                              .single();
                            cajaAsignada = caiData?.caja_asignada || "";
                          } catch (e) {
                            cajaAsignada = "";
                          }
                        }
                        const productos = seleccionados.map((s) => ({
                          id: s.id,
                          nombre: s.nombre,
                          precio: s.precio,
                          cantidad: s.cantidad,
                        }));

                        // Normalizar tipo de pago a minúsculas para consistencia con tabla pagos
                        const tipoPagoNormalizado = envioTipoPago.toLowerCase();

                        const registro = {
                          productos,
                          cajero_id: usuarioActual?.id,
                          cajero: usuarioActual?.nombre || "",
                          caja: cajaAsignada || "",
                          fecha_hora: formatToHondurasLocal(),
                          cliente: envioCliente,
                          telefono: envioCelular,
                          direccion: "", // No se captura dirección en este formulario
                          total: Number(totalConDescuento.toFixed(2)),
                          costo_envio: parseFloat(envioCosto || "0"),
                          tipo_pago: tipoPagoNormalizado,
                          factura_venta: facturaActual || null,
                        };

                        const registroSupabase = {
                          productos,
                          cajero_id: usuarioActual?.id,
                          caja: cajaAsignada || "",
                          fecha: registro.fecha_hora,
                          cliente: envioCliente,
                          celular: envioCelular,
                          total: Number(totalConDescuento.toFixed(2)),
                          costo_envio: parseFloat(envioCosto || "0"),
                          tipo_pago: tipoPagoNormalizado,
                        };

                        // PASO 1: Intentar guardar en IndexedDB (no crítico)
                        let envioIdLocal: number | null = null;
                        try {
                          envioIdLocal = await guardarEnvioLocal(registro);
                          console.log(
                            `✓ Envío guardado en IndexedDB (ID: ${envioIdLocal})`,
                          );
                        } catch (idbErr) {
                          console.warn(
                            "⚠ No se pudo guardar en IndexedDB (continuando con Supabase):",
                            idbErr,
                          );
                        }

                        // PASO 2: Intentar guardar en Supabase
                        try {
                          const { error } = await supabase
                            .from("pedidos_envio")
                            .insert([registroSupabase]);

                          if (error) {
                            console.error(
                              "Error insertando pedido de envío en Supabase:",
                              error,
                            );
                            console.log(
                              "⚠ Envío guardado localmente, se sincronizará después",
                            );
                          } else {
                            // Si se guardó exitosamente en Supabase, eliminar de IndexedDB
                            if (envioIdLocal !== null) {
                              await eliminarEnvioLocal(envioIdLocal).catch(
                                () => {},
                              );
                            }
                            console.log("✓ Envío sincronizado con Supabase");
                          }
                        } catch (supabaseErr) {
                          console.error(
                            "Error de conexión con Supabase:",
                            supabaseErr,
                          );
                          console.log(
                            "⚠ Envío guardado localmente, se sincronizará cuando haya conexión",
                          );
                        }

                        // Actualizar contador de pendientes
                        // const count = await obtenerContadorPendientes();
                        // setPendientesCount(count);

                        setLastEnvioSaved(registro);
                        setShowEnvioModal(false);

                        // Imprimir usando la misma plantilla que recibo/comanda (intentar QZ Tray primero)
                        try {
                          const { data: etiquetaConfig } = await supabase
                            .from("etiquetas_config")
                            .select("*")
                            .eq("nombre", "default")
                            .maybeSingle();
                          const { data: reciboConfig } = await supabase
                            .from("recibo_config")
                            .select("*")
                            .eq("nombre", "default")
                            .maybeSingle();

                          const comandaHtml = `
                        <div style='font-family:monospace; width:${
                          etiquetaConfig?.etiqueta_ancho || 80
                        }mm; margin:0; padding:${
                          etiquetaConfig?.etiqueta_padding || 8
                        }px;'>
                          <div style='font-size:${
                            etiquetaConfig?.etiqueta_fontsize || 24
                          }px; font-weight:800; color:#000; text-align:center; margin-bottom:10px;'>${
                            etiquetaConfig?.etiqueta_comanda || "COMANDA COCINA"
                          }</div>
                          <div style='font-size:28px; font-weight:900; color:#000; text-align:center; margin:16px 0;'>${tipoOrden}</div>
                          <div style='font-size:20px; font-weight:800; color:#d32f2f; text-align:center; margin:8px 0;'>PEDIDO POR TELÉFONO</div>
                          <div style='font-size:20px; font-weight:800; color:#000; text-align:center; margin-bottom:12px;'>Cliente: <b>${
                            registro.cliente
                          }</b></div>
                          <div style='font-size:14px; font-weight:600; color:#222; text-align:center; margin-bottom:6px;'>Factura: ${
                            facturaActual || ""
                          }</div>
                          
                          ${
                            seleccionados.filter((p) => p.tipo === "comida")
                              .length > 0
                              ? `
                            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>COMIDAS</div>
                            <ul style='list-style:none; padding:0; margin-bottom:12px;'>
                              ${seleccionados
                                .filter((p) => p.tipo === "comida")
                                .map(
                                  (p) =>
                                    `<li style='font-size:${
                                      etiquetaConfig?.etiqueta_fontsize || 20
                                    }px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                                      <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${
                                        p.cantidad
                                      }x</div>
                                      <div style='font-weight:700;'>${
                                        p.nombre
                                      }</div>
                                      ${
                                        p.complementos &&
                                        p.complementos.length > 0
                                          ? `<div style='font-size:12px; margin-top:6px; font-weight:600; color:#555;'>🍗 Complementos:</div>` +
                                            p.complementos
                                              .map(
                                                (comp) =>
                                                  `<div style='font-size:14px; margin-top:2px; padding-left:8px;'><span style='font-weight:700;'>• ${comp}</span></div>`,
                                              )
                                              .join("")
                                          : ""
                                      }
                                      ${
                                        p.piezas && p.piezas !== "PIEZAS VARIAS"
                                          ? `<div style='font-size:12px; margin-top:6px; font-weight:600; color:#555;'>🍖 Piezas:</div><div style='font-size:14px; margin-top:2px; padding-left:8px;'><span style='font-weight:700;'>• ${p.piezas}</span></div>`
                                          : ""
                                      }
                                    </li>`,
                                )
                                .join("")}
                            </ul>
                          `
                              : ""
                          }
                          
                          ${
                            seleccionados.filter(
                              (p) => p.tipo === "complemento",
                            ).length > 0
                              ? `
                            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>COMPLEMENTOS</div>
                            <ul style='list-style:none; padding:0; margin-bottom:12px;'>
                              ${seleccionados
                                .filter((p) => p.tipo === "complemento")
                                .map(
                                  (p) =>
                                    `<li style='font-size:${
                                      etiquetaConfig?.etiqueta_fontsize || 20
                                    }px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                                      <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${
                                        p.cantidad
                                      }x</div>
                                      <div style='font-weight:700;'>${
                                        p.nombre
                                      }</div>
                                    </li>`,
                                )
                                .join("")}
                            </ul>
                          `
                              : ""
                          }

                          ${
                            seleccionados.filter((p) => p.tipo === "bebida")
                              .length > 0
                              ? `
                            <div style='font-size:18px; font-weight:800; color:#000; margin-top:12px; margin-bottom:8px; padding:6px; background:#f0f0f0; border-radius:4px;'>BEBIDAS</div>
                            <ul style='list-style:none; padding:0; margin-bottom:0;'>
                              ${seleccionados
                                .filter((p) => p.tipo === "bebida")
                                .map(
                                  (p) =>
                                    `<li style='font-size:${
                                      etiquetaConfig?.etiqueta_fontsize || 20
                                    }px; margin-bottom:6px; padding-bottom:8px; text-align:left; border-bottom:1px solid #000;'>
                                      <div style='font-weight:900; font-size:24px; color:#d32f2f;'>${
                                        p.cantidad
                                      }x</div>
                                      <div style='font-weight:700;'>${
                                        p.nombre
                                      }</div>
                                    </li>`,
                                )
                                .join("")}
                            </ul>
                          `
                              : ""
                          }
                        </div>
                      `;

                          // Calcular subtotal e ISV 15% para pedido de envío

                          const comprobanteHtml = `
                        <div style='font-family:monospace; width:${
                          reciboConfig?.recibo_ancho || 80
                        }mm; margin:0; padding:${
                          reciboConfig?.recibo_padding || 8
                        }px; background:#fff;'>
                          <!-- Logo -->
                          <div style='text-align:center; margin-bottom:12px;'>
                            <img src='${
                              datosNegocio.logo_url || "/favicon.ico"
                            }' alt='${
                              datosNegocio.nombre_negocio
                            }' style='width:320px; height:320px;' onload='window.imageLoaded = true;' />
                          </div>
                          
                          <!-- Información del Negocio -->
                          <div style='text-align:center; font-size:18px; font-weight:700; margin-bottom:6px;'>${datosNegocio.nombre_negocio.toUpperCase()}</div>
                          <div style='text-align:center; font-size:14px; margin-bottom:3px;'>${
                            datosNegocio.direccion
                          }</div>
                          <div style='text-align:center; font-size:14px; margin-bottom:3px;'>RTN: ${
                            datosNegocio.rtn
                          }</div>
                          <div style='text-align:center; font-size:14px; margin-bottom:3px;'>PROPIETARIO: ${datosNegocio.propietario.toUpperCase()}</div>
                          <div style='text-align:center; font-size:14px; margin-bottom:10px;'>TEL: ${
                            datosNegocio.celular
                          }</div>
                          
                          <div style='border-top:2px solid #000; border-bottom:2px solid #000; padding:6px 0; margin-bottom:10px;'>
                            <div style='text-align:center; font-size:16px; font-weight:700;'>RECIBO DE VENTA</div>
                          </div>
                          
                          <!-- Información del Cliente, Factura y Fecha -->
                          <div style='font-size:14px; margin-bottom:3px;'>Cliente: ${
                            registro.cliente
                          }</div>
                          <div style='font-size:14px; margin-bottom:3px;'>Factura: ${
                            facturaActual || ""
                          }</div>
                          <div style='font-size:14px; margin-bottom:3px;'>Celular: ${
                            registro.telefono || "N/A"
                          }</div>
                          <div style='font-size:14px; margin-bottom:10px;'>Fecha: ${new Date().toLocaleString(
                            "es-HN",
                            { timeZone: "America/Tegucigalpa" },
                          )}</div>
                          
                          <!-- Tabla de Productos -->
                          <div style='border-top:1px dashed #000; border-bottom:1px dashed #000; padding:6px 0; margin-bottom:10px;'>
                            <table style='width:100%; font-size:14px; border-collapse:collapse;'>
                              <thead>
                                <tr style='border-bottom:1px solid #000;'>
                                  <th style='text-align:left; padding:3px 0;'>CANT</th>
                                  <th style='text-align:left; padding:3px 0;'>DESCRIPCIÓN</th>
                                  <th style='text-align:right; padding:3px 0;'>P.UNIT</th>
                                  <th style='text-align:right; padding:3px 0;'>TOTAL</th>
                                </tr>
                              </thead>
                              <tbody>
                                ${registro.productos
                                  .map(
                                    (p: any) => `<tr>
                                  <td style='padding:4px 0;'>${p.cantidad}</td>
                                  <td style='padding:4px 0;'>${p.nombre}</td>
                                  <td style='text-align:right; padding:4px 0;'>L${p.precio.toFixed(
                                    2,
                                  )}</td>
                                  <td style='text-align:right; padding:4px 0;'>L${(
                                    p.precio * p.cantidad
                                  ).toFixed(2)}</td>
                                </tr>`,
                                  )
                                  .join("")}
                              </tbody>
                            </table>
                          </div>
                          
                          <!-- Totales -->
                          <div style='font-size:15px; margin-bottom:3px;'>
                            <span style='float:left;'>COSTO ENVÍO:</span>
                            <span style='float:right; font-weight:700;'>L ${registro.costo_envio.toFixed(
                              2,
                            )}</span>
                            <div style='clear:both;'></div>
                          </div>
                          <div style='border-top:1px solid #000; margin-top:6px; padding-top:6px; font-size:17px; font-weight:700;'>
                            <span style='float:left;'>TOTAL:</span>
                            <span style='float:right;'>L ${(
                              registro.total + registro.costo_envio
                            ).toFixed(2)}</span>
                            <div style='clear:both;'></div>
                          </div>
                          
                          <!-- Mensaje de Agradecimiento -->
                          <div style='text-align:center; margin-top:18px; font-size:15px; font-weight:700; border-top:1px dashed #000; padding-top:10px;'>
                            ¡GRACIAS POR SU COMPRA!
                          </div>
                          <div style='text-align:center; font-size:14px; margin-top:5px;'>
                            Esperamos verle pronto
                          </div>
                        </div>
                      `;

                          const printHtml = `
                        <html>
                          <head>
                            <title>Recibo y Comanda</title>
                            <style>
                              @page { margin: 0; size: auto; }
                              body { margin:0; padding:0; overflow: visible; }
                              * { page-break-inside: avoid; -webkit-print-color-adjust: exact; }
                              @media print { 
                                html, body { height: auto; overflow: visible; }
                                .comanda-break { page-break-before: always; } 
                              }
                            </style>
                          </head>
                          <body>
                            <div>${comprobanteHtml}</div>
                            <div class='comanda-break'>${comandaHtml}</div>
                          </body>
                        </html>
                      `;

                          // Precargar la imagen antes de imprimir
                          const preloadImage = () => {
                            return new Promise((resolve) => {
                              const img = new Image();
                              img.onload = () => resolve(true);
                              img.onerror = () => resolve(false);
                              img.src = datosNegocio.logo_url || "/favicon.ico";
                              setTimeout(() => resolve(false), 2000);
                            });
                          };

                          // ── Imprimir (USB silenciosa o navegador) ─────────────
                          try {
                            const [cfgComandaE, cfgReciboE] = await Promise.all(
                              [
                                cargarPrinterConfig("comanda"),
                                cargarPrinterConfig("recibo"),
                              ],
                            );
                            const usarUSBComandaE =
                              cfgComandaE?.modoImpresion === "silenciosa" &&
                              cfgComandaE.vendorId &&
                              cfgComandaE.productId;
                            const usarUSBReciboE =
                              cfgReciboE?.modoImpresion === "silenciosa" &&
                              cfgReciboE.vendorId &&
                              cfgReciboE.productId;

                            if (usarUSBComandaE || usarUSBReciboE) {
                              const itemsE = registro.productos.map(
                                (p: any) => ({
                                  nombre: p.nombre,
                                  cantidad: p.cantidad,
                                  precio: p.precio,
                                  tipo: p.tipo,
                                  complementos: p.complementos,
                                  piezas: p.piezas ?? undefined,
                                }),
                              );
                              if (usarUSBComandaE) {
                                const datosComandaE: DatosComanda = {
                                  factura: facturaActual || "",
                                  cliente: registro.cliente,
                                  tipoOrden: tipoOrden,
                                  items: itemsE,
                                  fecha: new Date().toLocaleString("es-HN", {
                                    timeZone: "America/Tegucigalpa",
                                  }),
                                  esTelefono: true,
                                };
                                imprimirComandaUSB(
                                  cfgComandaE!.vendorId,
                                  cfgComandaE!.productId,
                                  datosComandaE,
                                ).catch((e) =>
                                  console.error("Error USB comanda envío:", e),
                                );
                              } else {
                                const pwCE = window.open(
                                  "",
                                  "",
                                  "height=800,width=400",
                                );
                                if (pwCE) {
                                  pwCE.document.write(
                                    `<html><head><title>Comanda</title><style>@page{margin:0;size:auto;}body{margin:0;padding:0;}</style></head><body>${comandaHtml}</body></html>`,
                                  );
                                  pwCE.document.close();
                                  pwCE.onload = () => {
                                    setTimeout(() => {
                                      pwCE.focus();
                                      pwCE.print();
                                      pwCE.close();
                                    }, 500);
                                  };
                                }
                              }
                              if (usarUSBReciboE) {
                                const datosReciboE: DatosRecibo = {
                                  nombreNegocio: datosNegocio.nombre_negocio,
                                  factura: facturaActual || "",
                                  cajero: usuarioActual?.nombre || "",
                                  caja: caiInfo?.caja_asignada || "",
                                  cliente: registro.cliente,
                                  fecha: new Date().toLocaleString("es-HN", {
                                    timeZone: "America/Tegucigalpa",
                                  }),
                                  items: itemsE,
                                  total: registro.total + registro.costo_envio,
                                  costoEnvio:
                                    registro.costo_envio > 0
                                      ? registro.costo_envio
                                      : undefined,
                                };
                                imprimirReciboUSB(
                                  cfgReciboE!.vendorId,
                                  cfgReciboE!.productId,
                                  datosReciboE,
                                ).catch((e) =>
                                  console.error("Error USB recibo envío:", e),
                                );
                              } else {
                                const pwRE = window.open(
                                  "",
                                  "",
                                  "height=600,width=400",
                                );
                                if (pwRE) {
                                  pwRE.document.write(
                                    `<html><head><title>Recibo</title><style>@page{margin:0;size:auto;}body{margin:0;padding:0;}*{-webkit-print-color-adjust:exact;}</style></head><body>${comprobanteHtml}</body></html>`,
                                  );
                                  pwRE.document.close();
                                  pwRE.onload = () => {
                                    setTimeout(() => {
                                      pwRE.focus();
                                      pwRE.print();
                                      pwRE.close();
                                    }, 500);
                                  };
                                }
                              }
                            } else {
                              // Modo navegador: recibo + comanda juntos
                              await preloadImage();
                              const printWindow = window.open(
                                "",
                                "",
                                "height=800,width=400",
                              );
                              if (printWindow) {
                                printWindow.document.write(printHtml);
                                printWindow.document.close();
                                printWindow.onload = () => {
                                  setTimeout(() => {
                                    printWindow.focus();
                                    printWindow.print();
                                    printWindow.close();
                                  }, 500);
                                };
                              }
                            }
                          } catch (err) {
                            console.error(
                              "Error imprimiendo pedido de envío:",
                              err,
                            );
                            const printWindow = window.open(
                              "",
                              "",
                              "height=800,width=400",
                            );
                            if (printWindow) {
                              printWindow.document.write(printHtml);
                              printWindow.document.close();
                              printWindow.onload = () => {
                                setTimeout(() => {
                                  printWindow.focus();
                                  printWindow.print();
                                  printWindow.close();
                                }, 500);
                              };
                            }
                          }
                        } catch (err) {
                          console.error(
                            "Error durante impresión de envío:",
                            err,
                          );
                        }
                        // limpiar seleccionados
                        limpiarSeleccion();
                      } catch (e) {
                        console.error(e);
                        alert("Error al guardar pedido de envío");
                      } finally {
                        setSavingEnvio(false);
                      }
                    }}
                    disabled={savingEnvio || !envioCliente || !envioCelular}
                    style={{
                      padding: "14px 24px",
                      borderRadius: 10,
                      border: "none",
                      background:
                        savingEnvio || !envioCliente || !envioCelular
                          ? theme === "lite"
                            ? "#e2e8f0"
                            : "#334155"
                          : "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                      color:
                        savingEnvio || !envioCliente || !envioCelular
                          ? theme === "lite"
                            ? "#94a3b8"
                            : "#64748b"
                          : "#ffffff",
                      fontWeight: 700,
                      fontSize: 16,
                      cursor:
                        savingEnvio || !envioCliente || !envioCelular
                          ? "not-allowed"
                          : "pointer",
                      transition: "all 0.2s",
                      boxShadow:
                        savingEnvio || !envioCliente || !envioCelular
                          ? "none"
                          : "0 4px 12px rgba(16, 185, 129, 0.3)",
                    }}
                  >
                    {savingEnvio ? "⏳ Guardando..." : "✓ Guardar Pedido"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de recibo para impresión */}
      {showReceiptModal && lastEnvioSaved && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "#fff",
            zIndex: 100000,
            padding: 24,
            overflow: "auto",
          }}
        >
          <div
            style={{ maxWidth: 480, margin: "0 auto", fontFamily: "monospace" }}
          >
            <h2 style={{ textAlign: "center", margin: 0 }}>{NOMBRE_NEGOCIO}</h2>
            <p style={{ textAlign: "center", marginTop: 4 }}>
              {lastEnvioSaved.fecha}
            </p>
            <hr />
            <div>
              <div>
                <strong>Cajero:</strong> {usuarioActual?.nombre}
              </div>
              <div>
                <strong>Caja:</strong> {lastEnvioSaved.caja}
              </div>
              <div>
                <strong>Cliente:</strong> {lastEnvioSaved.cliente} -{" "}
                {lastEnvioSaved.celular}
              </div>
              <div>
                <strong>Pago:</strong> {lastEnvioSaved.tipo_pago}
              </div>
            </div>
            <hr />
            <div>
              {lastEnvioSaved.productos.map((p: any, idx: number) => (
                <div
                  key={idx}
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <div>
                    {p.nombre} x{p.cantidad}
                  </div>
                  <div>L {(p.precio * p.cantidad).toFixed(2)}</div>
                </div>
              ))}
            </div>
            <hr />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>Subtotal:</div>
              <div>L {lastEnvioSaved.total.toFixed(2)}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>Costo envío:</div>
              <div>L {lastEnvioSaved.costo_envio.toFixed(2)}</div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 800,
                marginTop: 8,
              }}
            >
              <div>Total a pagar:</div>
              <div>
                L{" "}
                {(lastEnvioSaved.total + lastEnvioSaved.costo_envio).toFixed(2)}
              </div>
            </div>
            <hr />
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button
                onClick={() => {
                  setShowReceiptModal(false);
                  window.print();
                }}
                className="btn-primary"
              >
                Imprimir
              </button>
              <button
                onClick={() => setShowReceiptModal(false)}
                style={{ marginLeft: 12 }}
                className="btn-primary"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
      {showNoConnectionModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
          }}
          onClick={() => setShowNoConnectionModal(false)}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              color: theme === "lite" ? "#333" : "#fff",
              borderRadius: 12,
              padding: 32,
              minWidth: 400,
              maxWidth: 500,
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
              <h3
                style={{
                  marginTop: 0,
                  marginBottom: 12,
                  color: "#f57c00",
                  fontSize: 22,
                  fontWeight: 700,
                }}
              >
                Sin Conexión a Internet
              </h3>
            </div>
            <p
              style={{
                fontSize: 16,
                lineHeight: 1.6,
                marginBottom: 16,
                textAlign: "center",
              }}
            >
              <strong>El Resumen de Caja</strong> y el{" "}
              <strong>Cierre de Caja</strong> requieren conexión a internet para
              acceder a los datos del servidor.
            </p>
            <div
              style={{
                background: theme === "lite" ? "#f5f5f5" : "#1a1a1a",
                padding: 16,
                borderRadius: 8,
                marginBottom: 20,
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              <strong>Operaciones disponibles sin conexión:</strong>
              <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                <li>Facturación de productos ✓</li>
                <li>Registro de gastos ✓</li>
                <li>Pedidos por teléfono ✓</li>
                <li>Impresión de recibos y comandas ✓</li>
              </ul>
            </div>
            <p
              style={{
                fontSize: 14,
                textAlign: "center",
                color: theme === "lite" ? "#666" : "#aaa",
                marginBottom: 20,
              }}
            >
              Verifica tu conexión a internet e intenta nuevamente.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 12,
              }}
            >
              <button
                onClick={() => setShowNoConnectionModal(false)}
                style={{
                  padding: "12px 32px",
                  borderRadius: 8,
                  border: "none",
                  background: "#1976d2",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(25,118,210,0.3)",
                }}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {sincronizandoCaja && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 150000,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(460px, 100%)",
              borderRadius: 16,
              background: theme === "lite" ? "#ffffff" : "#1f2937",
              color: theme === "lite" ? "#0f172a" : "#f8fafc",
              boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
              padding: "28px 24px",
              textAlign: "center",
            }}
          >
            <style>{`
              @keyframes nubeFloat {
                0% { transform: translateY(0px); }
                50% { transform: translateY(-4px); }
                100% { transform: translateY(0px); }
              }
              @keyframes puntoParpadeo {
                0%, 20% { opacity: 0.25; }
                50% { opacity: 1; }
                100% { opacity: 0.25; }
              }
            `}</style>
            <div
              style={{
                fontSize: 56,
                marginBottom: 10,
                animation: "nubeFloat 1.4s ease-in-out infinite",
              }}
            >
              ☁️
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
              Descargando datos de la nube
            </div>
            <div
              style={{
                fontSize: 14,
                opacity: 0.85,
                lineHeight: 1.5,
                marginBottom: 14,
              }}
            >
              Sincronizando ventas, pedidos, gastos, devoluciones y movimientos
              pendientes antes de abrir{" "}
              {sincronizandoCajaDestino === "cierre"
                ? "Cierre de Caja"
                : "Resumen de Caja"}
              .
            </div>
            <div
              style={{
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
                fontWeight: 700,
                color: "#2563eb",
                fontSize: 15,
              }}
            >
              <span>Procesando</span>
              <span style={{ animation: "puntoParpadeo 1s infinite" }}>•</span>
              <span
                style={{
                  animation: "puntoParpadeo 1s infinite",
                  animationDelay: "0.2s",
                }}
              >
                •
              </span>
              <span
                style={{
                  animation: "puntoParpadeo 1s infinite",
                  animationDelay: "0.4s",
                }}
              >
                •
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Modal aviso: pedidos pendientes al intentar cerrar caja */}
      {showCierrePedidosWarning && (
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
            zIndex: 130000,
          }}
          onClick={() => setShowCierrePedidosWarning(false)}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              color: theme === "lite" ? "#333" : "#fff",
              borderRadius: 16,
              padding: 36,
              minWidth: 360,
              maxWidth: 480,
              boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 52, marginBottom: 10 }}>📦</div>
              <h3
                style={{
                  margin: "0 0 8px",
                  color: "#e65100",
                  fontSize: 22,
                  fontWeight: 800,
                }}
              >
                ¡Hay Pedidos Pendientes!
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: theme === "lite" ? "#555" : "#ccc",
                }}
              >
                Tienes{" "}
                <strong style={{ color: "#e53935" }}>
                  {pedidosPendientesCount} pedido(s) a domicilio
                </strong>{" "}
                sin facturar o eliminar.
              </p>
            </div>
            <div
              style={{
                background: theme === "lite" ? "#fff8e1" : "#2a2200",
                border: "1px solid #ffd54f",
                borderRadius: 10,
                padding: 16,
                marginBottom: 24,
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              <strong>Antes de cerrar caja debes:</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                <li>
                  Facturar los pedidos entregados, <strong>ó</strong>
                </li>
                <li>Eliminar los pedidos cancelados</li>
              </ul>
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 13,
                  color: theme === "lite" ? "#888" : "#aaa",
                }}
              ></p>
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() => {
                  setShowCierrePedidosWarning(false);
                  // Abrir el modal de pedidos para que los gestione
                  setShowOptionsMenu(false);
                  setShowPedidosModal(true);
                }}
                style={{
                  padding: "11px 22px",
                  borderRadius: 8,
                  border: "none",
                  background: "#1976d2",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                🏠 Ver Pedidos
              </button>

              <button
                onClick={() => setShowCierrePedidosWarning(false)}
                style={{
                  padding: "11px 22px",
                  borderRadius: 8,
                  border: "none",
                  background: theme === "lite" ? "#f5f5f5" : "#444",
                  color: theme === "lite" ? "#555" : "#ccc",
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pedidos del cajero */}
      {showPedidosModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 120000,
          }}
          onClick={() => setShowPedidosModal(false)}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 12,
              padding: 16,
              minWidth: 320,
              maxWidth: 820,
              maxHeight: "80vh",
              overflow: "auto",
              color: theme === "lite" ? "#222" : "#f5f5f5",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0 }}>Pedidos (últimos)</h3>
              <button
                onClick={() => setShowPedidosModal(false)}
                className="btn-primary"
              >
                Cerrar
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              {pedidosLoading ? (
                <div style={{ textAlign: "center", padding: 24 }}>
                  Cargando...
                </div>
              ) : pedidosList.length === 0 ? (
                <div style={{ textAlign: "center", padding: 24 }}>
                  No hay pedidos.
                </div>
              ) : (
                <div
                  style={{
                    overflowX: "auto",
                    borderRadius: 8,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                    border: "1px solid #e0e0e0",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 14,
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#1976d2", color: "#fff" }}>
                        <th
                          style={{
                            padding: "12px 16px",
                            textAlign: "left",
                            fontWeight: 600,
                          }}
                        >
                          Fecha
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            textAlign: "left",
                            fontWeight: 600,
                          }}
                        >
                          Cliente
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            textAlign: "left",
                            fontWeight: 600,
                          }}
                        >
                          Teléfono
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            textAlign: "right",
                            fontWeight: 600,
                          }}
                        >
                          Total
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            textAlign: "right",
                            fontWeight: 600,
                          }}
                        >
                          Envío
                        </th>
                        <th
                          style={{
                            padding: "12px 16px",
                            textAlign: "center",
                            fontWeight: 600,
                          }}
                        >
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidosList.map((p: any, index: number) => (
                        <tr
                          key={p.id || `local-fallback-${index}`}
                          style={{
                            borderBottom: "1px solid #eee",
                            background: index % 2 === 0 ? "#fff" : "#f9f9f9",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "#e3f2fd")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background =
                              index % 2 === 0 ? "#fff" : "#f9f9f9")
                          }
                        >
                          <td style={{ padding: "12px 16px", color: "#444" }}>
                            {p.fecha_hora || p.fecha || ""}
                          </td>
                          <td style={{ padding: "12px 16px", fontWeight: 500 }}>
                            {p.cliente}
                          </td>
                          <td style={{ padding: "12px 16px", color: "#666" }}>
                            {p.telefono || p.celular || ""}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              textAlign: "right",
                              fontWeight: 600,
                              color: "#2e7d32",
                            }}
                          >
                            L {Number(p.total || 0).toFixed(2)}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              textAlign: "right",
                              color: "#666",
                            }}
                          >
                            L {Number(p.costo_envio || 0).toFixed(2)}
                          </td>
                          <td
                            style={{
                              padding: "12px 16px",
                              textAlign: "center",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                justifyContent: "center",
                              }}
                            >
                              <button
                                onClick={async () => {
                                  if (!confirm("¿Eliminar pedido?")) return;
                                  const pedidoKey = String(
                                    p.id || p.local_id || `row-${index}`,
                                  );
                                  setPedidosProcessingId(pedidoKey);
                                  try {
                                    if (p.__localPending) {
                                      if (typeof p.local_id === "number") {
                                        await eliminarEnvioLocal(p.local_id);
                                      }
                                    } else {
                                      const { error } = await supabase
                                        .from("pedidos_envio")
                                        .delete()
                                        .eq("id", p.id);
                                      if (error) throw error;
                                    }
                                    setPedidosList((prev) =>
                                      prev.filter((x) => x.id !== p.id),
                                    );
                                  } catch (err) {
                                    console.error(
                                      "Error eliminando pedido:",
                                      err,
                                    );
                                    alert("Error eliminando pedido");
                                  } finally {
                                    setPedidosProcessingId(null);
                                  }
                                }}
                                disabled={
                                  pedidosProcessingId ===
                                  String(p.id || p.local_id || `row-${index}`)
                                }
                                style={{
                                  background: "#ffebee",
                                  color: "#d32f2f",
                                  border: "1px solid #ffcdd2",
                                  padding: "6px 12px",
                                  borderRadius: 6,
                                  cursor: "pointer",
                                  fontSize: 13,
                                  fontWeight: 500,
                                  transition: "all 0.2s",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = "#d32f2f";
                                  e.currentTarget.style.color = "#fff";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = "#ffebee";
                                  e.currentTarget.style.color = "#d32f2f";
                                }}
                              >
                                {pedidosProcessingId ===
                                String(p.id || p.local_id || `row-${index}`)
                                  ? "..."
                                  : "Eliminar"}
                              </button>
                              <button
                                onClick={async () => {
                                  if (
                                    posConfig.pedidos_telefono_cobro_automatico
                                  ) {
                                    await registrarPedidoEntregadoAutomatico(p);
                                    return;
                                  }

                                  setPedidoPendienteEntrega(p);
                                  setTipoDocumentoFiscal("RECIBO");
                                  setNombreClienteFiscal(p.cliente || "");
                                  setRtnCliente("");
                                  setShowPagoModal(false);
                                  setShowPedidosModal(false);
                                  continuarFlujoDocumento();
                                }}
                                disabled={
                                  pedidosProcessingId ===
                                  String(p.id || p.local_id || `row-${index}`)
                                }
                                style={{
                                  background: "#e8f5e9",
                                  color: "#2e7d32",
                                  border: "1px solid #a5d6a7",
                                  padding: "6px 12px",
                                  borderRadius: 6,
                                  cursor: "pointer",
                                  fontSize: 13,
                                  fontWeight: 500,
                                  transition: "all 0.2s",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = "#2e7d32";
                                  e.currentTarget.style.color = "#fff";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = "#e8f5e9";
                                  e.currentTarget.style.color = "#2e7d32";
                                }}
                              >
                                {pedidosProcessingId ===
                                String(p.id || p.local_id || `row-${index}`)
                                  ? "..."
                                  : "Entregado"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar Gasto */}
      {showRegistrarGasto && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 120000,
          }}
          onClick={() => cerrarRegistrarGasto()}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 12,
              padding: 20,
              minWidth: 320,
              boxShadow: "0 8px 32px #0003",
              color: theme === "lite" ? "#222" : "#f5f5f5",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#d32f2f" }}>Registrar gasto</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                type="number"
                step="0.01"
                placeholder="Monto"
                value={gastoMonto}
                onChange={(e) => setGastoMonto(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #ccc",
                }}
              />
              <input
                type="text"
                placeholder="Motivo"
                value={gastoMotivo}
                onChange={(e) => setGastoMotivo(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #ccc",
                }}
              />
              <input
                type="text"
                placeholder="Número de factura (opcional)"
                value={gastoFactura}
                onChange={(e) => setGastoFactura(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #ccc",
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                marginTop: 16,
              }}
            >
              <button
                onClick={() => cerrarRegistrarGasto()}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "#9e9e9e",
                  color: "#fff",
                  cursor: "pointer",
                }}
                disabled={guardandoGasto}
              >
                Cancelar
              </button>
              <button
                onClick={() => guardarGasto()}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "#d32f2f",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
                disabled={guardandoGasto}
              >
                {guardandoGasto ? "Guardando..." : "Guardar gasto"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de éxito tras registrar gasto */}
      {showGastoSuccess && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 130000,
          }}
          onClick={() => setShowGastoSuccess(false)}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 12,
              padding: 20,
              minWidth: 300,
              boxShadow: "0 8px 32px #0003",
              color: theme === "lite" ? "#222" : "#f5f5f5",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#388e3c" }}>Éxito</h3>
            <p style={{ marginTop: 8 }}>{gastoSuccessMessage}</p>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 16,
              }}
            >
              <button
                onClick={() => setShowGastoSuccess(false)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "#1976d2",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cuentas por Pagar */}
      {showCxPModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 125000,
          }}
          onClick={() => cerrarCxP()}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 14,
              padding: 24,
              minWidth: 340,
              maxWidth: 420,
              boxShadow: "0 8px 32px #0004",
              color: theme === "lite" ? "#222" : "#f5f5f5",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                marginTop: 0,
                color: "#991b1b",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              🧾 Registrar Cuenta por Pagar
            </h3>
            <p
              style={{
                fontSize: 13,
                color: theme === "lite" ? "#555" : "#aaa",
                marginTop: -6,
              }}
            >
              Esta deuda quedará registrada para administración. No afecta el
              cierre de caja del cajero.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                marginTop: 16,
              }}
            >
              <div>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Proveedor *
                </label>
                <select
                  value={cxpProveedorId}
                  onChange={(e) => setCxpProveedorId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #ccc",
                    fontSize: 14,
                    background: theme === "lite" ? "#fff" : "#1a1a1a",
                    color: theme === "lite" ? "#222" : "#f5f5f5",
                  }}
                >
                  <option value="">-- Selecciona un proveedor --</option>
                  {cxpProveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre_comercial}
                    </option>
                  ))}
                </select>
                {cxpProveedores.length === 0 && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "#e53e3e",
                      margin: "4px 0 0",
                    }}
                  >
                    No hay proveedores registrados. Crea uno en el panel de
                    administración.
                  </p>
                )}
              </div>
              <div>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Monto *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={cxpMonto}
                  onChange={(e) => setCxpMonto(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #ccc",
                    fontSize: 14,
                    boxSizing: "border-box",
                    background: theme === "lite" ? "#fff" : "#1a1a1a",
                    color: theme === "lite" ? "#222" : "#f5f5f5",
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Motivo / Concepto *
                </label>
                <input
                  type="text"
                  placeholder="Ej: Compra de insumos, servicio..."
                  value={cxpMotivo}
                  onChange={(e) => setCxpMotivo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #ccc",
                    fontSize: 14,
                    boxSizing: "border-box",
                    background: theme === "lite" ? "#fff" : "#1a1a1a",
                    color: theme === "lite" ? "#222" : "#f5f5f5",
                  }}
                />
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "flex-end",
                marginTop: 20,
              }}
            >
              <button
                onClick={() => cerrarCxP()}
                disabled={guardandoCxP}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "none",
                  background: "#9e9e9e",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => guardarCxP()}
                disabled={guardandoCxP}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "none",
                  background: guardandoCxP ? "#fca5a5" : "#991b1b",
                  color: "#fff",
                  cursor: guardandoCxP ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {guardandoCxP ? "Registrando..." : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast éxito Cuenta por Pagar */}
      {showCxPSuccess && (
        <div
          style={{
            position: "fixed",
            bottom: 32,
            right: 32,
            background: "#166534",
            color: "#fff",
            borderRadius: 10,
            padding: "14px 24px",
            boxShadow: "0 4px 16px #0003",
            zIndex: 130000,
            fontWeight: 600,
            fontSize: 15,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          ✅ Cuenta por pagar registrada correctamente
        </div>
      )}

      {/* Modal de Devolución */}
      {showDevolucionModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 120000,
          }}
          onClick={() => {
            setShowDevolucionModal(false);
            setDevolucionFactura("");
            setDevolucionData(null);
          }}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 12,
              padding: 24,
              minWidth: 400,
              maxWidth: 600,
              boxShadow: "0 8px 32px #0003",
              color: theme === "lite" ? "#222" : "#f5f5f5",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#ff9800" }}>
              Devolución de Factura
            </h3>

            {/* Paso 1: Buscar factura */}
            {!devolucionData && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <input
                  type="text"
                  placeholder="Número de factura"
                  value={devolucionFactura}
                  onChange={(e) => setDevolucionFactura(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") buscarFacturaDevolucion();
                  }}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid #ccc",
                    fontSize: 16,
                  }}
                  autoFocus
                />
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    justifyContent: "center",
                    marginTop: 8,
                  }}
                >
                  <button
                    onClick={() => {
                      setShowDevolucionModal(false);
                      setDevolucionFactura("");
                      setDevolucionData(null);
                    }}
                    style={{
                      padding: "10px 20px",
                      borderRadius: 8,
                      border: "none",
                      background: "#9e9e9e",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: 15,
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={buscarFacturaDevolucion}
                    style={{
                      padding: "10px 20px",
                      borderRadius: 8,
                      border: "none",
                      background: "#1976d2",
                      color: "#fff",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 15,
                    }}
                    disabled={devolucionBuscando}
                  >
                    {devolucionBuscando ? "Buscando..." : "Buscar"}
                  </button>
                </div>
              </div>
            )}

            {/* Paso 2: Mostrar datos y confirmar */}
            {devolucionData && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <div
                  style={{
                    background: theme === "lite" ? "#f5f5f5" : "#1a1a1a",
                    padding: 16,
                    borderRadius: 8,
                    border: "1px solid #ddd",
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <strong>Factura:</strong> {devolucionData.factura.factura}
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Cliente:</strong> {devolucionData.factura.cliente}
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Monto:</strong> L{" "}
                    {parseFloat(devolucionData.factura.total || 0).toFixed(2)}
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Fecha:</strong>{" "}
                    {devolucionData.factura.fecha_hora
                      ? new Date(
                          devolucionData.factura.fecha_hora,
                        ).toLocaleString("es-HN")
                      : "N/A"}
                  </div>
                  <div style={{ marginTop: 12, fontSize: 13, color: "#666" }}>
                    <strong>Pagos registrados:</strong>{" "}
                    {devolucionData.pagos.length}
                  </div>
                </div>

                <div
                  style={{
                    background: "#fff3cd",
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid #ffc107",
                    color: "#856404",
                    fontSize: 13,
                  }}
                >
                  ⚠️ Esta acción registrará una devolución con valores negativos
                  en las tablas de facturas y pagos.
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    justifyContent: "center",
                    marginTop: 8,
                  }}
                >
                  <button
                    onClick={() => {
                      setDevolucionData(null);
                      setDevolucionFactura("");
                    }}
                    style={{
                      padding: "10px 20px",
                      borderRadius: 8,
                      border: "none",
                      background: "#9e9e9e",
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: 15,
                    }}
                  >
                    Volver
                  </button>
                  <button
                    onClick={() => setShowDevolucionPasswordModal(true)}
                    style={{
                      padding: "10px 20px",
                      borderRadius: 8,
                      border: "none",
                      background: "#ff9800",
                      color: "#fff",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 15,
                    }}
                  >
                    Realizar Devolución
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de contraseña para devolución */}
      {showDevolucionPasswordModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 130000,
          }}
          onClick={() => {
            setShowDevolucionPasswordModal(false);
            setDevolucionPassword("");
          }}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 12,
              padding: 24,
              minWidth: 350,
              boxShadow: "0 8px 32px #0003",
              color: theme === "lite" ? "#222" : "#f5f5f5",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#d32f2f" }}>
              Confirmar con contraseña
            </h3>
            <p style={{ fontSize: 14, marginBottom: 16 }}>
              Ingrese su contraseña para autorizar la devolución
            </p>
            <input
              type="password"
              placeholder="Contraseña"
              value={devolucionPassword}
              onChange={(e) => setDevolucionPassword(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && devolucionPassword.trim()) {
                  // Validar contraseña y procesar
                  const esValida =
                    await validarPasswordCajero(devolucionPassword);
                  if (esValida) {
                    procesarDevolucion();
                  } else {
                    alert("Contraseña incorrecta");
                    setDevolucionPassword("");
                  }
                }
              }}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 8,
                border: "1px solid #ccc",
                fontSize: 16,
                marginBottom: 16,
              }}
              autoFocus
            />
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
              }}
            >
              <button
                onClick={() => {
                  setShowDevolucionPasswordModal(false);
                  setDevolucionPassword("");
                }}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "none",
                  background: "#9e9e9e",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 15,
                }}
                disabled={devolucionProcesando}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const esValida =
                    await validarPasswordCajero(devolucionPassword);
                  if (esValida) {
                    procesarDevolucion();
                  } else {
                    alert("Contraseña incorrecta");
                    setDevolucionPassword("");
                  }
                }}
                style={{
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: "none",
                  background: "#d32f2f",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 15,
                }}
                disabled={devolucionProcesando || !devolucionPassword.trim()}
              >
                {devolucionProcesando ? "Procesando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de error de devolución */}
      {showDevolucionError && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 140000,
          }}
          onClick={() => setShowDevolucionError(false)}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 12,
              padding: 24,
              minWidth: 320,
              maxWidth: 400,
              boxShadow: "0 8px 32px #0003",
              color: theme === "lite" ? "#222" : "#f5f5f5",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: 48,
                marginBottom: 12,
              }}
            >
              ⚠️
            </div>
            <h3 style={{ marginTop: 0, marginBottom: 12, color: "#d32f2f" }}>
              Factura no encontrada
            </h3>
            <p style={{ marginBottom: 20, fontSize: 14 }}>
              La factura no existe o no pertenece a este cajero
            </p>
            <button
              onClick={() => setShowDevolucionError(false)}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "#1976d2",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* Modal de éxito de devolución */}
      {showDevolucionSuccess && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 140000,
          }}
          onClick={() => setShowDevolucionSuccess(false)}
        >
          <div
            style={{
              background: theme === "lite" ? "#fff" : "#232526",
              borderRadius: 12,
              padding: 24,
              minWidth: 320,
              maxWidth: 400,
              boxShadow: "0 8px 32px #0003",
              color: theme === "lite" ? "#222" : "#f5f5f5",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: 48,
                marginBottom: 12,
              }}
            >
              ✅
            </div>
            <h3 style={{ marginTop: 0, marginBottom: 12, color: "#388e3c" }}>
              Devolución exitosa
            </h3>
            <p style={{ marginBottom: 20, fontSize: 14 }}>
              La devolución ha sido procesada correctamente
            </p>
            <button
              onClick={() => setShowDevolucionSuccess(false)}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "#388e3c",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              Aceptar
            </button>
          </div>
        </div>
      )}

      {/* Modal para requerir factura */}
      {/* Eliminado el modal de confirmación de factura */}

      {/* Indicador de estado de conexión y sincronización - fijo arriba a la derecha */}
      <div
        style={{
          position: "fixed",
          top: 10,
          right: 18,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 12000,
          alignItems: "flex-end",
        }}
      >
        {/* Indicador de conexión */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: isOnline
              ? "rgba(76, 175, 80, 0.9)"
              : "rgba(244, 67, 54, 0.9)",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#fff",
              animation: isOnline ? "none" : "pulse 2s infinite",
            }}
          />
          {isOnline ? "Conectado" : "Sin conexión"}
        </div>

        {/* Indicador de registros pendientes - DESHABILITADO */}
        {/* {(pendientesCount.facturas > 0 ||
          pendientesCount.pagos > 0 ||
          pendientesCount.gastos > 0 ||
          pendientesCount.envios > 0) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "8px 12px",
              background: "rgba(255, 152, 0, 0.9)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
              cursor: "pointer",
              maxWidth: 200,
            }}
            onClick={sincronizarManualmente}
            title="Click para sincronizar manualmente"
          >
            <div>⚠ Pendientes de sync:</div>
            {pendientesCount.facturas > 0 && (
              <div>📋 {pendientesCount.facturas} factura(s)</div>
            )}
            {pendientesCount.pagos > 0 && (
              <div>💳 {pendientesCount.pagos} pago(s)</div>
            )}
            {pendientesCount.gastos > 0 && (
              <div>💰 {pendientesCount.gastos} gasto(s)</div>
            )}
            {pendientesCount.envios > 0 && (
              <div>📦 {pendientesCount.envios} envío(s)</div>
            )}
            {sincronizando && <div>🔄 Sincronizando...</div>}
          </div>
        )} */}
      </div>

      {/* Menú central de opciones (botón abre este modal) */}
      {showOptionsMenu && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: menuClosing ? "rgba(0,0,0,0)" : "rgba(30,40,60,0.45)",
            backdropFilter: menuClosing ? "blur(0px)" : "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 130000,
            animation: menuClosing
              ? "backdropOut 340ms ease forwards"
              : "backdropIn 280ms ease forwards",
          }}
          onClick={() => closeMenuAnimated()}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background:
                "linear-gradient(160deg, #ffffff 0%, #f4f7ff 60%, #eef2ff 100%)",
              color: "#111827",
              borderRadius: 24,
              padding: "28px 24px 24px",
              minWidth: 340,
              maxWidth: 700,
              width: "92%",
              boxShadow:
                "0 32px 80px rgba(30,40,100,0.18), 0 0 0 1px rgba(100,120,200,0.12), inset 0 1px 0 rgba(255,255,255,0.9)",
              animation: menuClosing
                ? "menuOut 340ms cubic-bezier(0.4,0,1,1) forwards"
                : "menuIn 360ms cubic-bezier(0.34,1.56,0.64,1) forwards",
            }}
          >
            {/* Header del menú */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 22,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 3,
                    color: "#6b7fd4",
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Panel de Control
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 900,
                    letterSpacing: 0.5,
                    color: "#111827",
                  }}
                >
                  Opciones
                </div>
              </div>
              <button
                onClick={() => closeMenuAnimated()}
                style={{
                  background: "rgba(100,120,200,0.08)",
                  border: "1px solid rgba(100,120,200,0.18)",
                  color: "#6b7280",
                  borderRadius: 10,
                  width: 36,
                  height: 36,
                  cursor: "pointer",
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 160ms",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(100,120,200,0.16)";
                  e.currentTarget.style.color = "#374151";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(100,120,200,0.08)";
                  e.currentTarget.style.color = "#6b7280";
                }}
              >
                ✕
              </button>
            </div>

            {/* Separador */}
            <div
              style={{
                height: 1,
                background:
                  "linear-gradient(90deg, transparent, rgba(100,120,200,0.2), transparent)",
                marginBottom: 20,
              }}
            />

            {/* Grid de botones */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              {aperturaRegistrada === false ? (
                <>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      setTheme(theme === "lite" ? "dark" : "lite");
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #f0f4ff, #e8eeff)",
                      color: "#3730a3",
                      border: "1px solid #c7d2fe",
                      animationDelay: "40ms",
                    }}
                  >
                    <span className="btn-icon">
                      {theme === "lite" ? "🌙" : "☀️"}
                    </span>
                    <span>
                      <div className="btn-label">
                        {theme === "lite" ? "Modo Oscuro" : "Modo Claro"}
                      </div>
                      <div className="btn-desc">Cambiar tema visual</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      if (setView) setView("resultadosCaja");
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #fffbeb, #fef3c7)",
                      color: "#92400e",
                      border: "1px solid #fcd34d",
                      animationDelay: "80ms",
                    }}
                  >
                    <span className="btn-icon">📝</span>
                    <span>
                      <div className="btn-label">Aclaraciones</div>
                      <div className="btn-desc">Cierres del mes</div>
                    </span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      setTheme(theme === "lite" ? "dark" : "lite");
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #f0f4ff, #e8eeff)",
                      color: "#3730a3",
                      border: "1px solid #c7d2fe",
                      animationDelay: "40ms",
                    }}
                  >
                    <span className="btn-icon">
                      {theme === "lite" ? "🌙" : "☀️"}
                    </span>
                    <span>
                      <div className="btn-label">
                        {theme === "lite" ? "Modo Oscuro" : "Modo Claro"}
                      </div>
                      <div className="btn-desc">Cambiar tema visual</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      abrirResumenCaja();
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #eff6ff, #dbeafe)",
                      color: "#1e40af",
                      border: "1px solid #93c5fd",
                      animationDelay: "80ms",
                    }}
                  >
                    <span className="btn-icon">📊</span>
                    <span>
                      <div className="btn-label">Resumen</div>
                      <div className="btn-desc">Ventas del día</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      closeMenuAnimated();
                      // Si hay pedidos a domicilio pendientes, advertir antes de cerrar
                      if (pedidosPendientesCount > 0) {
                        setShowCierrePedidosWarning(true);
                        return;
                      }
                      abrirCierreCaja();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #fffbeb, #fef3c7)",
                      color: "#78350f",
                      border: "1px solid #fcd34d",
                      animationDelay: "120ms",
                      position: "relative",
                    }}
                  >
                    <span className="btn-icon">🚪</span>
                    <span>
                      <div className="btn-label">Cierre de Caja</div>
                      <div className="btn-desc">
                        {pedidosPendientesCount > 0
                          ? `⚠ ${pedidosPendientesCount} pedido(s) pendiente(s)`
                          : "Finalizar turno"}
                      </div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      setShowRegistrarGasto(true);
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #f0fdf4, #dcfce7)",
                      color: "#166534",
                      border: "1px solid #86efac",
                      animationDelay: "160ms",
                    }}
                  >
                    <span className="btn-icon">💸</span>
                    <span>
                      <div className="btn-label">Registrar Gasto</div>
                      <div className="btn-desc">Egresos del día</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={async () => {
                      closeMenuAnimated();
                      setCxpProveedorId("");
                      setCxpMonto("");
                      setCxpMotivo("");
                      try {
                        const provs = await obtenerProveedores(true);
                        setCxpProveedores(provs);
                      } catch {
                        setCxpProveedores([]);
                      }
                      setShowCxPModal(true);
                    }}
                    style={{
                      background: "linear-gradient(135deg, #fef2f2, #fee2e2)",
                      color: "#991b1b",
                      border: "1px solid #fca5a5",
                      animationDelay: "180ms",
                    }}
                  >
                    <span className="btn-icon">🧾</span>
                    <span>
                      <div className="btn-label">Cuentas por Pagar</div>
                      <div className="btn-desc">
                        Registrar deuda a proveedor
                      </div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      setShowDevolucionModal(true);
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #faf5ff, #f3e8ff)",
                      color: "#6b21a8",
                      border: "1px solid #d8b4fe",
                      animationDelay: "200ms",
                    }}
                  >
                    <span className="btn-icon">🔄</span>
                    <span>
                      <div className="btn-label">Devolución</div>
                      <div className="btn-desc">Anular o revertir</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={async () => {
                      closeMenuAnimated();
                      setShowPedidosModal(true);
                      let localesFormateados: any[] = [];
                      try {
                        const locales = await obtenerEnviosPendientes();
                        localesFormateados = locales.map((e: any) => ({
                          ...e,
                          id: `local-${e.id}`,
                          local_id: e.id,
                          __localPending: true,
                        }));
                      } catch (_localErr) {}
                      setPedidosList(localesFormateados);
                      try {
                        const { data, error } = await supabase
                          .from("pedidos_envio")
                          .select("*")
                          .eq("cajero_id", usuarioActual?.id)
                          .order("id", { ascending: false })
                          .limit(100);
                        if (!error && data) {
                          setPedidosList([...localesFormateados, ...data]);
                        }
                      } catch (_err) {}
                    }}
                    style={{
                      background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
                      color: "#065f46",
                      border: "1px solid #6ee7b7",
                      animationDelay: "240ms",
                    }}
                  >
                    <span className="btn-icon">🏠</span>
                    <span>
                      <div className="btn-label">Domicilios</div>
                      <div className="btn-desc">Pedidos por teléfono</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      if (setView) setView("resultadosCaja");
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #fffbeb, #fef3c7)",
                      color: "#92400e",
                      border: "1px solid #fcd34d",
                      animationDelay: "280ms",
                    }}
                  >
                    <span className="btn-icon">📝</span>
                    <span>
                      <div className="btn-label">Aclaraciones</div>
                      <div className="btn-desc">Cierres del mes</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      fetchHistorialVentas();
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #fdf4ff, #fae8ff)",
                      color: "#7e22ce",
                      border: "1px solid #e879f9",
                      animationDelay: "320ms",
                    }}
                  >
                    <span className="btn-icon">🧾</span>
                    <span>
                      <div className="btn-label">Historial</div>
                      <div className="btn-desc">Ventas registradas</div>
                    </span>
                  </button>
                  {posConfig.credito_habilitado && (
                    <button
                      className="menu-btn"
                      onClick={() => {
                        fetchHistorialCreditos();
                        closeMenuAnimated();
                      }}
                      style={{
                        background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
                        color: "#9a3412",
                        border: "1px solid #fb923c",
                        animationDelay: "360ms",
                      }}
                    >
                      <span className="btn-icon">📄</span>
                      <span>
                        <div className="btn-label">Facturas Crédito</div>
                        <div className="btn-desc">
                          Ventas a crédito del turno
                        </div>
                      </span>
                    </button>
                  )}
                  <button
                    className="menu-btn"
                    onClick={() => {
                      setShowPagoCreditoModal(true);
                      closeMenuAnimated();
                    }}
                    style={{
                      background: "linear-gradient(135deg, #f5f3ff, #ede9fe)",
                      color: "#4c1d95",
                      border: "1px solid #c4b5fd",
                      animationDelay: "400ms",
                    }}
                  >
                    <span className="btn-icon">💳</span>
                    <span>
                      <div className="btn-label">Cobrar Crédito</div>
                      <div className="btn-desc">Recibir pago de cliente</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={async () => {
                      closeMenuAnimated();
                      setShowInsumosBebidasDiaModal(true);
                      await cargarInsumosBebidasDelDia("insumos", "hoy");
                    }}
                    style={{
                      background: "linear-gradient(135deg, #ecfeff, #cffafe)",
                      color: "#155e75",
                      border: "1px solid #67e8f9",
                      animationDelay: "410ms",
                    }}
                  >
                    <span className="btn-icon">📦</span>
                    <span>
                      <div className="btn-label">Insumos y bebidas del día</div>
                      <div className="btn-desc">Salida inventario + stock</div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={() => {
                      closeMenuAnimated();
                      setIngresoPiezasCantidad("");
                      setShowIngresoPiezasModal(true);
                    }}
                    style={{
                      background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
                      color: "#9a3412",
                      border: "1px solid #fdba74",
                      animationDelay: "415ms",
                    }}
                  >
                    <span className="btn-icon">🍗</span>
                    <span>
                      <div className="btn-label">
                        Ingreso de piezas de pollo
                      </div>
                      <div className="btn-desc">
                        Registrar entrada a inventario
                      </div>
                    </span>
                  </button>
                  <button
                    className="menu-btn"
                    onClick={async () => {
                      closeMenuAnimated();
                      setCaiFactLoading(true);
                      setCaiFactData(null);
                      setShowDatosFactModal(true);
                      try {
                        // IDB primero (funciona offline)
                        const caiRows = await getAll<any>(STORE.CAI_FACTURAS);
                        const caiLocal = caiRows.find(
                          (r) =>
                            r.cajero_id === usuarioActual?.id &&
                            r.tipo_comprobante === "FACTURA" &&
                            r.activo !== false,
                        );
                        if (caiLocal) {
                          setCaiFactData(caiLocal);
                        } else {
                          // Fallback a Supabase si no hay en IDB
                          const { data, error } = await supabase
                            .from("cai_facturas")
                            .select("*")
                            .eq("cajero_id", usuarioActual?.id)
                            .eq("tipo_comprobante", "FACTURA")
                            .eq("activo", true)
                            .order("id", { ascending: false })
                            .limit(1)
                            .maybeSingle();
                          if (!error && data) {
                            setCaiFactData(data);
                            // Guardar en IDB para próximas consultas offline
                            await upsertOne(STORE.CAI_FACTURAS, data);
                          }
                        }
                      } catch {
                        /* non-critical */
                      }
                      setCaiFactLoading(false);
                    }}
                    style={{
                      background: "linear-gradient(135deg, #f0fdf4, #dcfce7)",
                      color: "#14532d",
                      border: "1px solid #4ade80",
                      animationDelay: "420ms",
                    }}
                  >
                    <span className="btn-icon">🏛️</span>
                    <span>
                      <div className="btn-label">Datos Facturación</div>
                      <div className="btn-desc">CAI activo del turno</div>
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Desbloqueo de menú */}
      {showMenuUnlockModal && (
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
            zIndex: 146000,
          }}
          onClick={() => setShowMenuUnlockModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              color: "#0f172a",
              borderRadius: 14,
              width: "92%",
              maxWidth: 420,
              padding: 16,
            }}
          >
            <h3 style={{ margin: "0 0 8px" }}>🔐 Menú bloqueado</h3>
            <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: 13 }}>
              Ingrese clave de administrador para abrir el menú.
            </p>
            <input
              type="password"
              value={menuUnlockPass}
              onChange={(e) => {
                setMenuUnlockPass(e.target.value);
                if (menuUnlockError) setMenuUnlockError("");
              }}
              placeholder="Clave de admin"
              autoFocus
              onKeyDown={async (e) => {
                if (e.key !== "Enter") return;
                const ok = await validarClaveMenu(menuUnlockPass);
                if (!ok) {
                  setMenuUnlockError("Clave incorrecta.");
                  return;
                }
                setShowMenuUnlockModal(false);
                setMenuUnlockPass("");
                setMenuUnlockError("");
                setMenuClosing(false);
                setShowOptionsMenu(true);
              }}
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 14,
                marginBottom: 8,
              }}
            />
            {!!menuUnlockError && (
              <p style={{ margin: "4px 0 0", color: "#dc2626", fontSize: 12 }}>
                {menuUnlockError}
              </p>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                className="inventory-btn secondary"
                onClick={() => setShowMenuUnlockModal(false)}
              >
                Cancelar
              </button>
              <button
                className="inventory-btn primary"
                onClick={async () => {
                  const ok = await validarClaveMenu(menuUnlockPass);
                  if (!ok) {
                    setMenuUnlockError("Clave incorrecta.");
                    return;
                  }
                  setShowMenuUnlockModal(false);
                  setMenuUnlockPass("");
                  setMenuUnlockError("");
                  setMenuClosing(false);
                  setShowOptionsMenu(true);
                }}
              >
                Abrir menú
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Ingreso de piezas de pollo */}
      {showIngresoPiezasModal && (
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
            zIndex: 146000,
          }}
          onClick={() => {
            if (!ingresoPiezasGuardando) setShowIngresoPiezasModal(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              color: "#0f172a",
              borderRadius: 14,
              width: "92%",
              maxWidth: 420,
              padding: 16,
            }}
          >
            <h3 style={{ margin: "0 0 8px" }}>🍗 Ingreso de piezas de pollo</h3>
            <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: 13 }}>
              Ingresa la cantidad entera a registrar como entrada de inventario.
            </p>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={ingresoPiezasCantidad}
              onChange={(e) => {
                const onlyDigits = e.target.value.replace(/[^0-9]/g, "");
                setIngresoPiezasCantidad(onlyDigits);
              }}
              placeholder="Cantidad"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !ingresoPiezasGuardando) {
                  void guardarIngresoPiezasPollo();
                }
              }}
              style={{
                width: "100%",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "10px 12px",
                fontSize: 16,
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                className="inventory-btn secondary"
                disabled={ingresoPiezasGuardando}
                onClick={() => setShowIngresoPiezasModal(false)}
              >
                Cancelar
              </button>
              <button
                className="inventory-btn primary"
                disabled={ingresoPiezasGuardando}
                onClick={() => {
                  void guardarIngresoPiezasPollo();
                }}
              >
                {ingresoPiezasGuardando ? "Guardando..." : "Guardar ingreso"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Insumos y bebidas del día */}
      {showInsumosBebidasDiaModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 145000,
          }}
          onClick={() => setShowInsumosBebidasDiaModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              color: "#0f172a",
              borderRadius: 14,
              width: "92%",
              maxWidth: 760,
              maxHeight: "88vh",
              overflow: "auto",
              padding: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>📦 Insumos y bebidas del día</h3>
                <p
                  style={{ margin: "4px 0 0", color: "#64748b", fontSize: 12 }}
                >
                  Salidas y stock calculado por rango (Entradas - Salidas)
                </p>
              </div>
              <button
                className="inventory-btn secondary"
                onClick={() => setShowInsumosBebidasDiaModal(false)}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              {(
                [
                  ["hoy", "Hoy"],
                  ["semana", "Semana"],
                  ["mes", "Mes"],
                ] as const
              ).map(([periodo, label]) => (
                <button
                  key={periodo}
                  className="inventory-btn secondary"
                  onClick={() =>
                    cargarInsumosBebidasDelDia(inventarioDiaTipo, periodo)
                  }
                  style={{
                    background:
                      inventarioDiaPeriodo === periodo ? "#0f172a" : "#f8fafc",
                    color:
                      inventarioDiaPeriodo === periodo ? "#fff" : "#334155",
                    border: "1px solid #cbd5e1",
                    minWidth: 94,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <button
                className="menu-btn"
                onClick={() =>
                  cargarInsumosBebidasDelDia("insumos", inventarioDiaPeriodo)
                }
                style={{
                  background:
                    inventarioDiaTipo === "insumos"
                      ? "linear-gradient(135deg, #dcfce7, #bbf7d0)"
                      : "linear-gradient(135deg, #f8fafc, #f1f5f9)",
                  color:
                    inventarioDiaTipo === "insumos" ? "#166534" : "#475569",
                  border: "1px solid #cbd5e1",
                  padding: "10px 14px",
                  flex: 1,
                  minWidth: 180,
                }}
              >
                <span className="btn-icon">🧂</span>
                <span>
                  <div className="btn-label">Insumos</div>
                  <div className="btn-desc">Ver salidas y stock</div>
                </span>
              </button>
              <button
                className="menu-btn"
                onClick={() =>
                  cargarInsumosBebidasDelDia("bebidas", inventarioDiaPeriodo)
                }
                style={{
                  background:
                    inventarioDiaTipo === "bebidas"
                      ? "linear-gradient(135deg, #dbeafe, #bfdbfe)"
                      : "linear-gradient(135deg, #f8fafc, #f1f5f9)",
                  color:
                    inventarioDiaTipo === "bebidas" ? "#1d4ed8" : "#475569",
                  border: "1px solid #cbd5e1",
                  padding: "10px 14px",
                  flex: 1,
                  minWidth: 180,
                }}
              >
                <span className="btn-icon">🥤</span>
                <span>
                  <div className="btn-label">Bebidas</div>
                  <div className="btn-desc">Ver salidas y stock</div>
                </span>
              </button>
              <button
                className="menu-btn"
                onClick={() =>
                  cargarInsumosBebidasDelDia(
                    "piezas_pollo",
                    inventarioDiaPeriodo,
                  )
                }
                style={{
                  background:
                    inventarioDiaTipo === "piezas_pollo"
                      ? "linear-gradient(135deg, #ffedd5, #fed7aa)"
                      : "linear-gradient(135deg, #f8fafc, #f1f5f9)",
                  color:
                    inventarioDiaTipo === "piezas_pollo"
                      ? "#9a3412"
                      : "#475569",
                  border: "1px solid #cbd5e1",
                  padding: "10px 14px",
                  flex: 1,
                  minWidth: 180,
                }}
              >
                <span className="btn-icon">🍗</span>
                <span>
                  <div className="btn-label">Piezas de pollo</div>
                  <div className="btn-desc">Piezas vendidas y stock</div>
                </span>
              </button>
            </div>

            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 12px",
                  background: "#f8fafc",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <strong>
                  {inventarioDiaTipo === "insumos"
                    ? "🧂 Insumos"
                    : inventarioDiaTipo === "bebidas"
                      ? "🥤 Bebidas"
                      : "🍗 Piezas de pollo"}{" "}
                  · {inventarioDiaFecha || "Hoy"}
                </strong>
                <button
                  className="inventory-btn primary"
                  onClick={imprimirListaInsumosBebidasDia}
                  disabled={inventarioDiaRows.length === 0}
                >
                  🖨 Imprimir ticket
                </button>
              </div>

              {inventarioDiaLoading ? (
                <div
                  style={{ padding: 22, color: "#64748b", textAlign: "center" }}
                >
                  Cargando lista…
                </div>
              ) : inventarioDiaRows.length === 0 ? (
                <div
                  style={{ padding: 22, color: "#64748b", textAlign: "center" }}
                >
                  No hay salidas de inventario para esta lista en este rango.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="inventory-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th style={{ textAlign: "right" }}>Vendido</th>
                        <th style={{ textAlign: "right" }}>Stock (E-S)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventarioDiaRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.nombre}</td>
                          <td
                            style={{
                              textAlign: "right",
                              color: "#dc2626",
                              fontWeight: 700,
                            }}
                          >
                            {row.vendido.toFixed(2)}
                          </td>
                          <td style={{ textAlign: "right", color: "#0f172a" }}>
                            {row.stock.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Historial de Ventas */}
      {showHistorialVentas &&
        (() => {
          // ── Mapa factura → set de tipos de pago ──────────────────────────────
          const hPagosPorFacturaMap = new Map<string, Set<string>>();
          historialPagos.forEach((p: any) => {
            const k = p.factura_venta
              ? String(p.factura_venta)
              : p.factura
                ? String(p.factura)
                : null;
            if (!k) return;
            if (!hPagosPorFacturaMap.has(k))
              hPagosPorFacturaMap.set(k, new Set());
            const t = (p.tipo || "").toLowerCase().trim();
            if (t) hPagosPorFacturaMap.get(k)!.add(t);
          });

          // ── Totales por tipo ─────────────────────────────────────────────────
          const hTotales = {
            efectivo: 0,
            tarjeta: 0,
            transferencia: 0,
            dolares_lps: 0,
            dolares_usd: 0,
            delivery: 0,
            donaciones: 0,
          };
          historialPagos.forEach((p: any) => {
            const t = (p.tipo || "").toLowerCase().trim();
            const m = parseFloat(String(p.monto || 0).replace(/,/g, "")) || 0;
            if (t === "efectivo") hTotales.efectivo += m;
            else if (t === "tarjeta") hTotales.tarjeta += m;
            else if (t === "transferencia" || t === "transferencias")
              hTotales.transferencia += m;
            else if (t === "dolares" || t === "dólares") {
              hTotales.dolares_lps += m;
              hTotales.dolares_usd +=
                parseFloat(String(p.usd_monto || 0).replace(/,/g, "")) || 0;
            }
          });
          historialVentas.forEach((v: any) => {
            if ((v.tipo_orden || "").toUpperCase() === "DELIVERY")
              hTotales.delivery += parseFloat(String(v.total || 0)) || 0;
            if (v.es_donacion) hTotales.donaciones += 1;
          });

          // ── Filtrado ─────────────────────────────────────────────────────────
          const hFiltradas =
            historialFiltroTipo === null
              ? historialVentas
              : historialFiltroTipo === "delivery"
                ? historialVentas.filter(
                    (v: any) =>
                      (v.tipo_orden || "").toUpperCase() === "DELIVERY",
                  )
                : historialFiltroTipo === "donaciones"
                  ? historialVentas.filter((v: any) => v.es_donacion === true)
                  : historialVentas.filter((v: any) => {
                      const tipos = hPagosPorFacturaMap.get(
                        String(v.factura || ""),
                      );
                      if (!tipos) return false;
                      if (historialFiltroTipo === "transferencia")
                        return (
                          tipos.has("transferencia") ||
                          tipos.has("transferencias")
                        );
                      if (historialFiltroTipo === "dolares")
                        return tipos.has("dolares") || tipos.has("dólares");
                      return tipos.has(historialFiltroTipo);
                    });

          const tipoIconos: Record<string, { icon: string; color: string }> = {
            efectivo: { icon: "💵", color: "#10b981" },
            tarjeta: { icon: "💳", color: "#3b82f6" },
            transferencia: { icon: "🏦", color: "#8b5cf6" },
            transferencias: { icon: "🏦", color: "#8b5cf6" },
            dolares: { icon: "💱", color: "#f59e0b" },
            dólares: { icon: "💱", color: "#f59e0b" },
          };

          const fmt = (n: number) =>
            n.toLocaleString("de-DE", { minimumFractionDigits: 2 });

          return (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100vw",
                height: "100vh",
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 140000,
              }}
              onClick={() => setShowHistorialVentas(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "#fff",
                  color: "#111",
                  borderRadius: 12,
                  padding: 20,
                  width: "90%",
                  maxWidth: 1050,
                  maxHeight: "90vh",
                  overflow: "auto",
                }}
              >
                {/* Encabezado */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <h3 style={{ margin: 0 }}>
                    📋 Historial de ventas (turno)
                    {historialFiltroTipo && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: "0.8rem",
                          fontWeight: 500,
                          color: "#64748b",
                        }}
                      >
                        — {hFiltradas.length} resultado
                        {hFiltradas.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => setShowHistorialVentas(false)}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: 18,
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Botones filtro por tipo de pago */}
                {!historialLoading && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      paddingBottom: 10,
                      borderBottom: "1px solid #e2e8f0",
                      marginBottom: 12,
                    }}
                  >
                    {(
                      [
                        {
                          key: null,
                          label: "Todas",
                          icon: "🔄",
                          color: "#64748b",
                          totalTxt: `${historialVentas.length} fact.`,
                        },
                        {
                          key: "efectivo",
                          label: "Efectivo",
                          icon: "💵",
                          color: "#10b981",
                          totalTxt: `L ${fmt(hTotales.efectivo)}`,
                        },
                        {
                          key: "tarjeta",
                          label: "Tarjeta",
                          icon: "💳",
                          color: "#3b82f6",
                          totalTxt: `L ${fmt(hTotales.tarjeta)}`,
                        },
                        {
                          key: "transferencia",
                          label: "Transferencia",
                          icon: "🏦",
                          color: "#8b5cf6",
                          totalTxt: `L ${fmt(hTotales.transferencia)}`,
                        },
                        {
                          key: "dolares",
                          label: "Dólares",
                          icon: "💱",
                          color: "#f59e0b",
                          totalTxt: `L ${fmt(hTotales.dolares_lps)}`,
                        },
                        {
                          key: "delivery",
                          label: "Delivery",
                          icon: "🛵",
                          color: "#f43f5e",
                          totalTxt: `L ${fmt(hTotales.delivery)}`,
                        },
                        {
                          key: "donaciones",
                          label: "Donaciones",
                          icon: "🎁",
                          color: "#7c3aed",
                          totalTxt: `${hTotales.donaciones} fact.`,
                        },
                      ] as const
                    ).map(({ key, label, icon, color, totalTxt }) => {
                      const isActive = historialFiltroTipo === key;
                      return (
                        <button
                          key={String(key)}
                          onClick={() =>
                            setHistorialFiltroTipo(key as string | null)
                          }
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 1,
                            padding: "5px 12px",
                            border: `2px solid ${isActive ? color : "#e2e8f0"}`,
                            borderRadius: 20,
                            background: isActive ? color : "transparent",
                            color: isActive ? "#fff" : color,
                            cursor: "pointer",
                            fontWeight: isActive ? 700 : 500,
                            fontSize: "0.74rem",
                            lineHeight: 1.3,
                            transition: "all 0.18s",
                            minWidth: 80,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span style={{ fontSize: "0.9rem" }}>
                            {icon} {label}
                          </span>
                          <span style={{ fontSize: "0.68rem", opacity: 0.85 }}>
                            {totalTxt}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Tabla */}
                {historialLoading ? (
                  <div style={{ padding: 20, textAlign: "center" }}>
                    Cargando...
                  </div>
                ) : hFiltradas.length === 0 ? (
                  <div
                    style={{ padding: 20, textAlign: "center", color: "#888" }}
                  >
                    Sin resultados para este filtro.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{ width: "100%", borderCollapse: "collapse" }}
                    >
                      <thead>
                        <tr
                          style={{
                            textAlign: "left",
                            borderBottom: "2px solid #e2e8f0",
                            background: "#f8fafc",
                          }}
                        >
                          <th style={{ padding: 8 }}>Hora</th>
                          <th style={{ padding: 8 }}>Documento</th>
                          <th style={{ padding: 8 }}>Cliente</th>
                          <th style={{ padding: 8 }}>Tipo Pago</th>
                          <th style={{ padding: 8 }}>🍖/🥤</th>
                          <th style={{ padding: 8 }}>Monto</th>
                          <th style={{ padding: 8 }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hFiltradas.map((venta) => {
                          const tiposVenta = hPagosPorFacturaMap.get(
                            String(venta.factura || ""),
                          );
                          const esDelivery =
                            (venta.tipo_orden || "").toUpperCase() ===
                            "DELIVERY";
                          const esDonacionRow = venta.es_donacion === true;

                          // Contar platillos y bebidas de esta venta
                          const { platillosRow, bebidasRow } = (() => {
                            let pl = 0;
                            let beb = 0;
                            try {
                              const prods =
                                typeof venta.productos === "string"
                                  ? JSON.parse(venta.productos)
                                  : venta.productos;
                              if (Array.isArray(prods))
                                for (const p of prods) {
                                  const q = parseFloat(p.cantidad || 1);
                                  if (p.tipo === "comida") pl += q;
                                  else if (p.tipo === "bebida") beb += q;
                                }
                            } catch (_) {}
                            return {
                              platillosRow: Math.round(pl),
                              bebidasRow: Math.round(beb),
                            };
                          })();

                          return (
                            <tr
                              key={venta.id}
                              style={{
                                borderBottom: "1px solid #f0f0f0",
                                background: esDonacionRow
                                  ? "#faf5ff"
                                  : undefined,
                              }}
                            >
                              <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                                {new Date(venta.fecha_hora).toLocaleTimeString(
                                  "es-HN",
                                )}
                              </td>
                              <td style={{ padding: 8 }}>
                                {venta.factura}
                                {esDonacionRow && (
                                  <span
                                    style={{
                                      marginLeft: 5,
                                      background: "#7c3aed",
                                      color: "#fff",
                                      borderRadius: 6,
                                      padding: "1px 6px",
                                      fontSize: "0.65rem",
                                      fontWeight: 700,
                                    }}
                                  >
                                    🎁 DON.
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: 8 }}>
                                {venta.cliente || "—"}
                              </td>
                              <td style={{ padding: 8 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 3,
                                  }}
                                >
                                  {esDelivery && (
                                    <span
                                      style={{
                                        background: "#fef2f2",
                                        color: "#f43f5e",
                                        border: "1px solid #fecdd3",
                                        borderRadius: 10,
                                        padding: "1px 7px",
                                        fontSize: "0.68rem",
                                        fontWeight: 600,
                                      }}
                                    >
                                      🛵 Delivery
                                    </span>
                                  )}
                                  {esDonacionRow && (
                                    <span
                                      style={{
                                        background: "#f5f3ff",
                                        color: "#7c3aed",
                                        border: "1px solid #c4b5fd",
                                        borderRadius: 10,
                                        padding: "1px 7px",
                                        fontSize: "0.68rem",
                                        fontWeight: 700,
                                      }}
                                    >
                                      🎁 Donación
                                    </span>
                                  )}
                                  {tiposVenta &&
                                    Array.from(tiposVenta).map((t) => {
                                      const ti = tipoIconos[t];
                                      if (!ti) return null;
                                      const lbl =
                                        t === "transferencia" ||
                                        t === "transferencias"
                                          ? "Transf."
                                          : t === "dolares" || t === "dólares"
                                            ? "Dólares"
                                            : t.charAt(0).toUpperCase() +
                                              t.slice(1);
                                      return (
                                        <span
                                          key={t}
                                          style={{
                                            background: ti.color + "18",
                                            color: ti.color,
                                            border: `1px solid ${ti.color}44`,
                                            borderRadius: 10,
                                            padding: "1px 7px",
                                            fontSize: "0.68rem",
                                            fontWeight: 600,
                                          }}
                                        >
                                          {ti.icon} {lbl}
                                        </span>
                                      );
                                    })}
                                </div>
                              </td>
                              {/* Columna platillos/bebidas */}
                              <td style={{ padding: 8, textAlign: "center" }}>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 4,
                                    justifyContent: "center",
                                  }}
                                >
                                  {platillosRow > 0 && (
                                    <span
                                      style={{
                                        background: "#fef2f2",
                                        color: "#dc2626",
                                        borderRadius: 8,
                                        padding: "1px 7px",
                                        fontSize: "0.72rem",
                                        fontWeight: 700,
                                      }}
                                    >
                                      🍖{platillosRow}
                                    </span>
                                  )}
                                  {bebidasRow > 0 && (
                                    <span
                                      style={{
                                        background: "#f0f9ff",
                                        color: "#0284c7",
                                        borderRadius: 8,
                                        padding: "1px 7px",
                                        fontSize: "0.72rem",
                                        fontWeight: 700,
                                      }}
                                    >
                                      🥤{bebidasRow}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td
                                style={{
                                  padding: 8,
                                  fontWeight: 600,
                                  color: esDonacionRow ? "#7c3aed" : "#16a34a",
                                }}
                              >
                                {esDonacionRow
                                  ? "🎁 L 0.00"
                                  : `L ${Number(venta.total || 0).toFixed(2)}`}
                              </td>
                              <td style={{ padding: 8 }}>
                                <button
                                  onClick={() =>
                                    imprimirFacturaHistorial(venta)
                                  }
                                  style={{
                                    marginRight: 6,
                                    padding: "5px 10px",
                                    borderRadius: 8,
                                    border: "none",
                                    background: "#1976d2",
                                    color: "#fff",
                                    cursor: "pointer",
                                    fontSize: "0.78rem",
                                  }}
                                >
                                  🖨️ Factura
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedVentaForComanda(venta);
                                    setShowTipoOrdenModal(true);
                                  }}
                                  style={{
                                    padding: "5px 10px",
                                    borderRadius: 8,
                                    border: "none",
                                    background: "#6a1b9a",
                                    color: "#fff",
                                    cursor: "pointer",
                                    fontSize: "0.78rem",
                                  }}
                                >
                                  🖨️ Comanda
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Modal Historial de Facturas de Crédito */}
      {showHistorialCreditos && (
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
            zIndex: 140000,
          }}
          onClick={() => setShowHistorialCreditos(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              color: "#111",
              borderRadius: 12,
              padding: 20,
              width: "90%",
              maxWidth: 1000,
              maxHeight: "85vh",
              overflow: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0 }}>📄 Facturas de Crédito (turno)</h3>
              <button
                onClick={() => setShowHistorialCreditos(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
            {historialCreditosLoading ? (
              <div style={{ padding: 20, textAlign: "center" }}>
                Cargando...
              </div>
            ) : historialCreditos.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#888" }}>
                No hay facturas de crédito en este turno.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      textAlign: "left",
                      borderBottom: "2px solid #fb923c",
                      background: "#fff7ed",
                    }}
                  >
                    <th style={{ padding: 8 }}>Hora</th>
                    <th style={{ padding: 8 }}>Factura</th>
                    <th style={{ padding: 8 }}>Cliente</th>
                    <th style={{ padding: 8 }}>🍖/🥤</th>
                    <th style={{ padding: 8 }}>Monto</th>
                    <th style={{ padding: 8 }}>Saldo anterior</th>
                    <th style={{ padding: 8 }}>Nuevo saldo</th>
                    <th style={{ padding: 8 }}>Estado</th>
                    <th style={{ padding: 8 }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {historialCreditos.map((fc) => {
                    // Contar platillos y bebidas de esta factura crédito
                    const { plC, bebC } = (() => {
                      let pl = 0;
                      let beb = 0;
                      try {
                        const prods =
                          typeof fc.productos === "string"
                            ? JSON.parse(fc.productos)
                            : fc.productos;
                        if (Array.isArray(prods))
                          for (const p of prods) {
                            const q = parseFloat(p.cantidad || 1);
                            if (p.tipo === "comida") pl += q;
                            else if (p.tipo === "bebida") beb += q;
                          }
                      } catch (_) {}
                      return { plC: Math.round(pl), bebC: Math.round(beb) };
                    })();
                    return (
                      <tr
                        key={fc.id}
                        style={{ borderBottom: "1px solid #f0f0f0" }}
                      >
                        <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                          {new Date(fc.fecha_hora).toLocaleTimeString("es-HN")}
                        </td>
                        <td style={{ padding: 8 }}>{fc.factura_numero}</td>
                        <td style={{ padding: 8 }}>
                          {fc.clientes_credito?.nombre || "—"}
                        </td>
                        {/* Platillos/bebidas */}
                        <td style={{ padding: 8, textAlign: "center" }}>
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              justifyContent: "center",
                            }}
                          >
                            {plC > 0 && (
                              <span
                                style={{
                                  background: "#fef2f2",
                                  color: "#dc2626",
                                  borderRadius: 8,
                                  padding: "1px 7px",
                                  fontSize: "0.72rem",
                                  fontWeight: 700,
                                }}
                              >
                                🍖{plC}
                              </span>
                            )}
                            {bebC > 0 && (
                              <span
                                style={{
                                  background: "#f0f9ff",
                                  color: "#0284c7",
                                  borderRadius: 8,
                                  padding: "1px 7px",
                                  fontSize: "0.72rem",
                                  fontWeight: 700,
                                }}
                              >
                                🥤{bebC}
                              </span>
                            )}
                            {plC === 0 && bebC === 0 && (
                              <span style={{ color: "#94a3b8", fontSize: 12 }}>
                                —
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: 8,
                            fontWeight: 700,
                            color: "#9a3412",
                          }}
                        >
                          L {Number(fc.total || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: 8, color: "#64748b" }}>
                          L {Number(fc.saldo_anterior || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: 8, fontWeight: 700 }}>
                          L {Number(fc.nuevo_saldo || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: 8 }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 20,
                              fontSize: 12,
                              fontWeight: 700,
                              background:
                                fc.estado === "pagado"
                                  ? "#dcfce7"
                                  : fc.estado === "parcial"
                                    ? "#fef9c3"
                                    : fc.estado === "vencido"
                                      ? "#fee2e2"
                                      : "#fff7ed",
                              color:
                                fc.estado === "pagado"
                                  ? "#166534"
                                  : fc.estado === "parcial"
                                    ? "#713f12"
                                    : fc.estado === "vencido"
                                      ? "#991b1b"
                                      : "#9a3412",
                            }}
                          >
                            {fc.estado || "pendiente"}
                          </span>
                        </td>
                        <td style={{ padding: 8 }}>
                          <button
                            onClick={() => imprimirFacturaCreditoHistorial(fc)}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 8,
                              border: "none",
                              background: "#9a3412",
                              color: "#fff",
                              cursor: "pointer",
                              fontWeight: 600,
                              fontSize: 13,
                            }}
                          >
                            🖨️ Imprimir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr
                    style={{
                      background: "#fff7ed",
                      borderTop: "2px solid #fb923c",
                    }}
                  >
                    <td colSpan={3} style={{ padding: 8, fontWeight: 700 }}>
                      TOTAL DEL TURNO
                    </td>
                    <td style={{ padding: 8 }}></td>
                    <td
                      style={{
                        padding: 8,
                        fontWeight: 800,
                        color: "#9a3412",
                        fontSize: 15,
                      }}
                    >
                      L{" "}
                      {historialCreditos
                        .reduce((s, fc) => s + Number(fc.total || 0), 0)
                        .toFixed(2)}
                    </td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Modal para elegir tipo de comanda (separado del flujo de ventas) */}
      {showTipoOrdenModal && selectedVentaForComanda && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 150000,
          }}
          onClick={() => {
            setShowTipoOrdenModal(false);
            setSelectedVentaForComanda(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              color: "#111",
              borderRadius: 12,
              padding: 20,
              width: "90%",
              maxWidth: 420,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Tipo de comanda</h3>
            <p>Seleccione si la comanda es para llevar o para comer aquí.</p>
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                marginTop: 12,
              }}
            >
              <button
                onClick={() => {
                  imprimirComandaHistorial(
                    selectedVentaForComanda,
                    "PARA LLEVAR",
                  );
                  setShowTipoOrdenModal(false);
                  setSelectedVentaForComanda(null);
                }}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "#1976d2",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                PARA LLEVAR
              </button>
              <button
                onClick={() => {
                  imprimirComandaHistorial(
                    selectedVentaForComanda,
                    "COMER AQUÍ",
                  );
                  setShowTipoOrdenModal(false);
                  setSelectedVentaForComanda(null);
                }}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "#388e3c",
                  color: "#fff",
                  fontWeight: 700,
                }}
              >
                COMER AQUÍ
              </button>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 16,
              }}
            >
              <button
                onClick={() => {
                  setShowTipoOrdenModal(false);
                  setSelectedVentaForComanda(null);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  background: "transparent",
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Botón Cerrar Sesión - fijo abajo a la derecha */}
      <button
        onClick={() => setShowCerrarSesionModal(true)}
        style={{
          position: "fixed",
          bottom: 10,
          right: 18,
          background: "transparent",
          border: "none",
          color: "#d32f2f",
          fontSize: 12,
          textDecoration: "underline",
          cursor: "pointer",
          padding: 0,
          zIndex: 12000,
          fontWeight: 700,
        }}
        title="Cerrar sesión"
      >
        Cerrar Sesión
      </button>

      {/* Modal de confirmación para cerrar sesión */}
      {showCerrarSesionModal && (
        <div
          onClick={() => setShowCerrarSesionModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 32,
              minWidth: 320,
              maxWidth: 400,
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              textAlign: "center",
            }}
          >
            <h3 style={{ margin: "0 0 16px 0", color: "#1976d2" }}>
              ¿Cerrar Sesión?
            </h3>
            <p style={{ margin: "0 0 24px 0", color: "#666" }}>
              ¿Estás seguro de que deseas cerrar sesión?
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={() => setShowCerrarSesionModal(false)}
                style={{
                  padding: "10px 24px",
                  background: "#e0e0e0",
                  color: "#333",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem("usuario");
                  window.location.href = "/login";
                }}
                style={{
                  padding: "10px 24px",
                  background: "#d32f2f",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Modales módulo créditos ───────────────────────────────────────────── */}
      <CreditoClienteModal
        isOpen={showCreditoClienteModal}
        onClose={() => setShowCreditoClienteModal(false)}
        onClienteSeleccionado={async (cliente, saldo) => {
          setShowCreditoClienteModal(false);
          await handleVentaCredito(cliente, saldo);
        }}
        theme={theme}
        totalVenta={seleccionados.reduce(
          (s, p) => s + p.precio * p.cantidad,
          0,
        )}
      />
      <PagoCreditoPOSModal
        isOpen={showPagoCreditoModal}
        onClose={() => setShowPagoCreditoModal(false)}
        cajero={usuarioActual?.nombre ?? ""}
        cajeroId={usuarioActual?.id ?? ""}
        theme={theme}
      />

      {/* ── Modal DATOS DE FACTURACIÓN ────────────────────────────────────────── */}
      {showDatosFactModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200000,
          }}
          onClick={() => setShowDatosFactModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "linear-gradient(160deg, #f0fdf4 0%, #dcfce7 100%)",
              borderRadius: 20,
              padding: "20px 20px 18px",
              minWidth: 300,
              maxWidth: 480,
              width: "92%",
              maxHeight: "80vh",
              overflowY: "auto",
              boxShadow:
                "0 24px 60px rgba(0,0,0,0.2), 0 0 0 1px rgba(74,222,128,0.3)",
              color: "#111827",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 3,
                    color: "#16a34a",
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Configuración Fiscal
                </div>
                <div
                  style={{ fontSize: 20, fontWeight: 900, color: "#14532d" }}
                >
                  🏛️ Datos de Facturación
                </div>
              </div>
              <button
                onClick={() => setShowDatosFactModal(false)}
                style={{
                  background: "rgba(74,222,128,0.15)",
                  border: "1px solid rgba(74,222,128,0.3)",
                  color: "#16a34a",
                  borderRadius: 10,
                  width: 36,
                  height: 36,
                  cursor: "pointer",
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                height: 1,
                background:
                  "linear-gradient(90deg, transparent, rgba(74,222,128,0.4), transparent)",
                marginBottom: 20,
              }}
            />

            {caiFactLoading ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 0",
                  color: "#16a34a",
                  fontSize: 15,
                }}
              >
                Cargando datos CAI...
              </div>
            ) : !caiFactData ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 0",
                  color: "#dc2626",
                  fontSize: 15,
                }}
              >
                ⚠️ No hay CAI activo de tipo FACTURA asignado a este cajero.
                <br />
                <span
                  style={{
                    fontSize: 13,
                    color: "#6b7280",
                    marginTop: 8,
                    display: "block",
                  }}
                >
                  Contacte al administrador para configurar el CAI.
                </span>
              </div>
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                {[
                  { label: "CAI", value: caiFactData.cai, mono: true },
                  {
                    label: "No. Factura Actual",
                    value: caiFactData.factura_actual,
                  },
                  { label: "Rango Desde", value: caiFactData.rango_desde },
                  { label: "Rango Hasta", value: caiFactData.rango_hasta },
                  {
                    label: "Fecha Límite Emisión",
                    value: caiFactData.fecha_limite_emision,
                  },
                  {
                    label: "No. Establecimiento",
                    value: caiFactData.numero_establecimiento,
                  },
                  {
                    label: "Punto de Emisión",
                    value: caiFactData.punto_emision,
                  },
                  {
                    label: "Tipo Documento",
                    value: caiFactData.tipo_documento,
                  },
                  {
                    label: "Tipo Comprobante",
                    value: caiFactData.tipo_comprobante,
                  },
                ]
                  .filter(
                    (f) =>
                      f.value !== undefined &&
                      f.value !== null &&
                      f.value !== "",
                  )
                  .map((field) => (
                    <div
                      key={field.label}
                      style={{
                        background: "rgba(255,255,255,0.7)",
                        borderRadius: 10,
                        padding: "10px 14px",
                        border: "1px solid rgba(74,222,128,0.25)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#16a34a",
                          textTransform: "uppercase",
                          letterSpacing: 1.5,
                          marginBottom: 3,
                        }}
                      >
                        {field.label}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#111827",
                          fontFamily: field.mono ? "monospace" : "inherit",
                          wordBreak: "break-all",
                        }}
                      >
                        {String(field.value)}
                      </div>
                    </div>
                  ))}
                <div
                  style={{
                    background: caiFactData.activo
                      ? "rgba(74,222,128,0.15)"
                      : "rgba(239,68,68,0.12)",
                    borderRadius: 10,
                    padding: "10px 14px",
                    border: `1px solid ${caiFactData.activo ? "rgba(74,222,128,0.4)" : "rgba(239,68,68,0.3)"}`,
                    textAlign: "center",
                    fontWeight: 700,
                    fontSize: 14,
                    color: caiFactData.activo ? "#166534" : "#dc2626",
                  }}
                >
                  {caiFactData.activo ? "✅ CAI ACTIVO" : "❌ CAI INACTIVO"}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
