import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import {
  formatToHondurasLocal,
  compareTurnoRecordsByRecency,
} from "./utils/fechas";
import { useDatosNegocio } from "./useDatosNegocio";
import {
  calcularResumenTurno,
  getAperturaActiva,
  upsertOne,
  getAll,
  STORE,
  getPrecioDolarLocal,
  sincronizarDiaActual,
} from "./utils/localDB";
import {
  limpiarAperturaCache,
  limpiarAperturaLocalStorage,
} from "./utils/offlineSync";
interface UsuarioActual {
  nombre: string;
  [key: string]: any;
}

interface RegistroCierreViewProps {
  usuarioActual: UsuarioActual;
  caja: string;
  onCierreGuardado?: () => void;
  onBack?: () => void;
}

export default function RegistroCierreView({
  usuarioActual,
  caja,
  onCierreGuardado,
  onBack,
}: RegistroCierreViewProps) {
  // Cargar datos del negocio
  const { datos: datosNegocio } = useDatosNegocio();

  const [efectivo, setEfectivo] = useState("");
  const [tarjeta, setTarjeta] = useState("");
  const [transferencias, setTransferencias] = useState("");
  const [dolares, setDolares] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Estados para mostrar valores del sistema en el resumen
  const [efectivoSistema, setEfectivoSistema] = useState(0);
  const [tarjetaSistema, setTarjetaSistema] = useState(0);
  const [transferenciasSistema, setTransferenciasSistema] = useState(0);
  const [dolaresSistema, setDolaresSistema] = useState(0);
  const [gastosSistema, setGastosSistema] = useState(0);
  const [totalVentasSistema, setTotalVentasSistema] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimaSync, setUltimaSync] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [fechaAperturaSistema, setFechaAperturaSistema] = useState<string>("");
  const [precioDolarActual, setPrecioDolarActual] = useState(0);

  // Cargar valores del sistema al montar la vista
  useEffect(() => {
    let mounted = true;
    async function cargarResumen() {
      if (!usuarioActual || !usuarioActual.id || !caja) return;
      setLoading(true);
      setSyncError("");
      try {
        // Primero sincronizar ventas y gastos del día desde Supabase
        if (navigator.onLine) {
          setSincronizando(true);
          try {
            await sincronizarDiaActual(usuarioActual.id);
            setUltimaSync(new Date());
          } catch (syncErr) {
            console.warn(
              "[CierreCaja] No se pudo sincronizar con servidor:",
              syncErr,
            );
            setSyncError(
              "No se pudo conectar al servidor. Los datos pueden ser del caché local.",
            );
          } finally {
            setSincronizando(false);
          }
        } else {
          setSyncError("Sin conexión. Mostrando datos del caché local.");
        }
        await obtenerValoresAutomaticos();
        const tasa = await getPrecioDolarLocal();
        setPrecioDolarActual(Number(tasa) || 0);
      } catch (err) {
        console.error("Error cargando resumen:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    cargarResumen();
    return () => {
      mounted = false;
    };
  }, [usuarioActual?.id, caja]);

  // Calcular valores automáticos solo desde IndexedDB
  async function obtenerValoresAutomaticos() {
    // 1. Apertura desde IDB/localStorage cache
    let aperturaActual: any = await getAperturaActiva(usuarioActual?.id ?? "");

    if (!aperturaActual) {
      setEfectivoSistema(0);
      setTarjetaSistema(0);
      setTransferenciasSistema(0);
      setDolaresSistema(0);
      setFechaAperturaSistema("");
      return {
        fondoFijoDia: 0,
        efectivoDia: 0,
        tarjetaDia: 0,
        transferenciasDia: 0,
        dolaresDia: 0,
        gastosDia: 0,
        platillosDia: 0,
        bebidasDia: 0,
      };
    }

    const fondoFijoDia = parseFloat(
      aperturaActual.fondo_fijo_registrado || "0",
    );

    // 2. Calcular resumen desde IDB
    let turnoIDB: any = null;
    try {
      if (aperturaActual.id) {
        turnoIDB = await calcularResumenTurno(
          Number(aperturaActual.id),
          usuarioActual?.id ?? "",
        );
      }
    } catch (e) {
      console.warn("[RegistroCierre] calcularResumenTurno error:", e);
    }

    const efectivoDia = parseFloat(turnoIDB?.efectivo_neto ?? 0);
    const tarjetaDia = parseFloat(turnoIDB?.tarjeta ?? 0);
    const transferenciasDia = parseFloat(
      turnoIDB?.transferencia ?? turnoIDB?.transferencia ?? 0,
    );
    const dolaresDia = parseFloat(turnoIDB?.dolares_usd ?? 0);
    const gastosDia = parseFloat(turnoIDB?.gastos ?? 0);
    const platillosDia = parseFloat(
      turnoIDB?.total_platillos ?? turnoIDB?.platillos_vendidos ?? 0,
    );
    const bebidasDia = parseFloat(
      turnoIDB?.total_bebidas ?? turnoIDB?.bebidas_vendidas ?? 0,
    );
    const totalVentasDia = parseFloat(turnoIDB?.total_ventas ?? 0);

    setEfectivoSistema(efectivoDia);
    setTarjetaSistema(tarjetaDia);
    setTransferenciasSistema(transferenciasDia);
    setDolaresSistema(dolaresDia);
    setGastosSistema(gastosDia);
    setTotalVentasSistema(totalVentasDia ?? 0);
    const fa = aperturaActual.fecha_apertura ?? aperturaActual.fecha ?? "";
    setFechaAperturaSistema(fa);

    return {
      fondoFijoDia,
      efectivoDia,
      tarjetaDia,
      transferenciasDia,
      dolaresDia,
      gastosDia,
      platillosDia,
      bebidasDia,
      totalVentasDia,
      fechaApertura: aperturaActual.fecha_apertura ?? aperturaActual.fecha,
    };
  }

  const printCierreReport = (
    registro: any,
    gastosDia: number,
    platillosDia = 0,
    bebidasDia = 0,
    totalVentasDia = 0,
    fechaApertura = "",
  ) => {
    const logoUrl = datosNegocio.logo_url || "/favicon.ico";
    const img = new Image();
    img.src = logoUrl;

    const doPrint = () => {
      const printWindow = window.open("", "_blank");
      if (!printWindow) return;

      const diferencia = Number(registro.diferencia);
      const difSign =
        diferencia > 0 ? "A FAVOR" : diferencia < 0 ? "EN CONTRA" : "CUADRADO";
      const difAbs = Math.abs(diferencia).toFixed(2);

      const fmtFecha = (d: string) => {
        if (!d) return "—";
        try {
          const dt = new Date(d);
          return (
            dt.toLocaleDateString("es-HN") +
            " " +
            dt.toLocaleTimeString("es-HN")
          );
        } catch {
          return d;
        }
      };

      const html = `
        <html>
          <head>
            <title>Reporte de Cierre</title>
            <style>
              body { font-family: 'Courier New', monospace; padding: 10px; width: 80mm; margin: 0 auto; color: #000; font-weight: 700; font-size: 16px; }
              .header { text-align: center; margin-bottom: 20px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
              .title { font-size: 20px; margin: 10px 0; }
              .info { font-size: 14px; margin-bottom: 15px; line-height: 1.6; }
              .row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 16px; }
              .divider { border-top: 1px dashed #000; margin: 10px 0; }
              .footer { text-align: center; margin-top: 30px; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="header">
              <div style="font-size: 18px;">${datosNegocio.nombre_negocio.toUpperCase()}</div>
              <div class="title">REPORTE DE CIERRE DE CAJA</div>
            </div>

            <div class="info">
              <div><strong>N&#xba; de Cierre:</strong> ${registro.id || "N/A"}</div>
              <div><strong>Cajero:</strong> ${registro.cajero}</div>
              <div><strong>Caja:</strong> ${registro.caja}</div>
              <div><strong>Apertura:</strong> ${fmtFecha(fechaApertura)}</div>
              <div><strong>Cierre:</strong> ${fmtFecha(registro.fecha)}</div>
            </div>

            <div class="divider"></div>
            <div style="text-align: center; font-weight: bold; margin-bottom: 10px;">RESUMEN DE VENTAS</div>
            <div class="row"><span>Platillos:</span><span>${Math.round(platillosDia)}</span></div>
            <div class="row"><span>Bebidas:</span><span>${Math.round(bebidasDia)}</span></div>

            <div class="divider"></div>
            <div style="text-align: center; font-weight: bold; margin-bottom: 10px;">SISTEMA</div>
            <div class="row"><span>Fondo Fijo:</span><span>L ${Number(registro.fondo_fijo).toFixed(2)}</span></div>
            <div class="row"><span>Efectivo (Neto):</span><span>L ${Number(registro.efectivo_dia).toFixed(2)}</span></div>
            <div class="row"><span>Tarjeta:</span><span>L ${Number(registro.monto_tarjeta_dia).toFixed(2)}</span></div>
            <div class="row"><span>Transferencia:</span><span>L ${Number(registro.transferencias_dia).toFixed(2)}</span></div>
            <div class="row"><span>D&#xf3;lares (USD):</span><span>$ ${Number(registro.dolares_dia).toFixed(2)}</span></div>
            <div class="row"><span>Gastos:</span><span>L ${Number(gastosDia).toFixed(2)}</span></div>

            <div class="divider"></div>
            <div class="row" style="font-weight: bold;">
              <span>VENTA DEL D&#xcd;A:</span>
              <span>L ${Number(totalVentasDia).toFixed(2)}</span>
            </div>

            <div class="divider"></div>
            <div style="text-align: center; font-weight: bold; margin-bottom: 10px;">CONTEO (USUARIO)</div>
            <div class="row"><span>Fondo Fijo:</span><span>L ${Number(registro.fondo_fijo_registrado).toFixed(2)}</span></div>
            <div class="row"><span>Efectivo:</span><span>L ${Number(registro.efectivo_registrado).toFixed(2)}</span></div>
            <div class="row"><span>Tarjeta:</span><span>L ${Number(registro.monto_tarjeta_registrado).toFixed(2)}</span></div>
            <div class="row"><span>Transferencia:</span><span>L ${Number(registro.transferencias_registradas).toFixed(2)}</span></div>
            <div class="row"><span>D&#xf3;lares (USD):</span><span>$ ${Number(registro.dolares_registrado).toFixed(2)}</span></div>

            <div class="divider"></div>
            <div class="row" style="font-size: 16px;">
              <span>DIFERENCIA:</span>
              <span>L ${difAbs}</span>
            </div>
            <div style="text-align: right; font-size: 15px; font-weight: bold;">${difSign}</div>

            <div class="footer">
              <p>__________________________</p>
              <p>Firma Cajero</p>
              <br/>
              <p>__________________________</p>
              <p>Firma Supervisor</p>
            </div>
            <script>
              window.onload = function() { setTimeout(function() { window.print(); window.close(); }, 500); };
            </script>
          </body>
        </html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();
    };

    img.onload = doPrint;
    img.onerror = doPrint;
    setTimeout(() => {
      if (!img.complete) doPrint();
    }, 2000);
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError("");

    // Validación: asegurar que todos los campos de cierre estén llenos
    const efectivoFilled = efectivo.trim() !== "";
    const tarjetaFilled = tarjeta.trim() !== "";
    const transferenciasFilled = transferencias.trim() !== "";

    if (!efectivoFilled || !tarjetaFilled || !transferenciasFilled) {
      setGuardando(false);
      setError("Complete todos los campos requeridos antes de guardar.");
      return;
    }

    // No hay más verificaciones de apertura porque ya no se registra desde aquí
    // Calcular valores
    setTimeout(async () => {
      const {
        fondoFijoDia,
        efectivoDia,
        tarjetaDia,
        transferenciasDia,
        dolaresDia,
        gastosDia,
        platillosDia,
        bebidasDia,
        totalVentasDia,
        fechaApertura,
      } = await obtenerValoresAutomaticos();

      // dolares_registrado: el cajero ingresa directamente el valor en USD
      const dolaresRegistrado =
        dolares && parseFloat(dolares) > 0 ? parseFloat(dolares) : 0;

      // Obtener precio del dólar desde IDB (siempre disponible offline)
      const precioDolar = await getPrecioDolarLocal();

      // Calcular diferencia de dólares en Lempiras
      const diferenciaDolaresUSD = dolaresRegistrado - dolaresDia;
      const diferenciaDolaresLps = diferenciaDolaresUSD * precioDolar;

      // Calcular diferencias (todo en Lempiras)
      // Fondo fijo siempre es 0
      const fondoFijoRegistrado = 0;
      const diferencia =
        fondoFijoRegistrado -
        fondoFijoDia +
        (parseFloat(efectivo) - efectivoDia) +
        (parseFloat(tarjeta) - tarjetaDia) +
        (parseFloat(transferencias) - transferenciasDia) +
        diferenciaDolaresLps;
      let observacion = "";
      if (diferencia === 0) {
        observacion = "cuadrado";
      } else {
        observacion = "sin aclarar";
      }
      // Determinar si es apertura o cierre
      type Registro = {
        tipo_registro: string;
        cajero: string;
        cajero_id: string;
        caja: string;
        fecha: string;
        fondo_fijo_registrado: number;
        fondo_fijo: number;
        efectivo_registrado: number;
        efectivo_dia: number;
        monto_tarjeta_registrado: number;
        monto_tarjeta_dia: number;
        transferencias_registradas: number;
        transferencias_dia: number;
        dolares_registrado: number;
        dolares_dia: number;
        diferencia: number;
        observacion: string;
        fecha_apertura?: string;
        fecha_cierre?: string;
      };

      let registro: Registro;
      // Ya no hay apertura, solo CIERRE
      // CIERRE
      registro = {
        tipo_registro: "cierre",
        cajero: usuarioActual?.nombre,
        cajero_id:
          usuarioActual && usuarioActual.id ? usuarioActual.id : "SIN_ID",
        caja,
        // Guardar la fecha/hora en hora local de Honduras
        fecha: formatToHondurasLocal(),
        fondo_fijo_registrado: fondoFijoRegistrado,
        fondo_fijo: fondoFijoDia,
        efectivo_registrado: parseFloat(efectivo),
        efectivo_dia: efectivoDia,
        monto_tarjeta_registrado: parseFloat(tarjeta),
        monto_tarjeta_dia: tarjetaDia,
        transferencias_registradas: parseFloat(transferencias),
        transferencias_dia: transferenciasDia,
        dolares_registrado: dolaresRegistrado,
        dolares_dia: dolaresDia,
        diferencia,
        observacion,
        fecha_apertura: fechaApertura || undefined,
        fecha_cierre: formatToHondurasLocal(),
      };

      // ── GUARDAR CIERRE: IDB primero, Supabase solo si hay conexión ──
      let idbOk = false;
      let registroId: string | number | null = null;

      // 1. Siempre actualizar IDB
      try {
        // getAperturaActiva ya no filtra por fecha, pero por seguridad
        // también buscamos directamente en STORE.CIERRES como fallback
        let aperturaIdb = await getAperturaActiva(usuarioActual?.id ?? "");

        if (!aperturaIdb) {
          // Búsqueda directa sin filtro de fecha (turno de medianoche u otros casos)
          const todosCierres = await getAll(STORE.CIERRES);
          aperturaIdb =
            todosCierres
              .filter(
                (c: any) =>
                  c.cajero_id === usuarioActual?.id && c.estado === "APERTURA",
              )
              .sort((a: any, b: any) =>
                compareTurnoRecordsByRecency(a, b),
              )[0] ?? null;
        }

        if (aperturaIdb) {
          const cierreIdb = {
            ...aperturaIdb,
            tipo_registro: "cierre",
            fecha: registro.fecha,
            fecha_apertura: aperturaIdb.fecha_apertura ?? aperturaIdb.fecha,
            fecha_cierre: registro.fecha_cierre ?? registro.fecha,
            fondo_fijo_registrado: registro.fondo_fijo_registrado,
            fondo_fijo: registro.fondo_fijo,
            efectivo_registrado: registro.efectivo_registrado,
            efectivo_dia: registro.efectivo_dia,
            monto_tarjeta_registrado: registro.monto_tarjeta_registrado,
            monto_tarjeta_dia: registro.monto_tarjeta_dia,
            transferencias_registradas: registro.transferencias_registradas,
            transferencias_dia: registro.transferencias_dia,
            dolares_registrado: registro.dolares_registrado,
            dolares_dia: registro.dolares_dia,
            diferencia: registro.diferencia,
            observacion: registro.observacion,
            estado: "CIERRE",
            pending_sync: true,
          };
          await upsertOne(STORE.CIERRES, cierreIdb);
          registroId = aperturaIdb.id;
        } else {
          // Sin apertura en IDB, crear registro de cierre con id temporal
          const tempId = -Date.now();
          await upsertOne(STORE.CIERRES, {
            ...registro,
            id: tempId,
            estado: "CIERRE",
            pending_sync: true,
          });
          registroId = tempId;
        }
        await limpiarAperturaCache();
        limpiarAperturaLocalStorage();
        idbOk = true;
      } catch (idbErr) {
        console.warn("[RegistroCierre] Error guardando en IDB:", idbErr);
      }

      // 2. Si hay conexión, sincronizar con Supabase
      if (navigator.onLine) {
        try {
          // Buscar apertura activa en Supabase
          const { data: aperturaDelDia, error: errAp } = await supabase
            .from("cierres")
            .select("id, fecha_apertura, fecha")
            .eq("cajero_id", usuarioActual?.id)
            .eq("caja", caja)
            .eq("estado", "APERTURA")
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (errAp) throw errAp; // error de red → catch lo maneja

          if (aperturaDelDia) {
            const { error: updateError } = await supabase
              .from("cierres")
              .update({
                tipo_registro: "cierre",
                fecha: registro.fecha,
                fecha_apertura:
                  aperturaDelDia.fecha_apertura ?? aperturaDelDia.fecha,
                fecha_cierre: registro.fecha_cierre ?? registro.fecha,
                fondo_fijo_registrado: registro.fondo_fijo_registrado,
                fondo_fijo: registro.fondo_fijo,
                efectivo_registrado: registro.efectivo_registrado,
                efectivo_dia: registro.efectivo_dia,
                monto_tarjeta_registrado: registro.monto_tarjeta_registrado,
                monto_tarjeta_dia: registro.monto_tarjeta_dia,
                transferencias_registradas: registro.transferencias_registradas,
                transferencias_dia: registro.transferencias_dia,
                dolares_registrado: registro.dolares_registrado,
                dolares_dia: registro.dolares_dia,
                diferencia: registro.diferencia,
                observacion: registro.observacion,
                estado: "CIERRE",
              })
              .eq("id", aperturaDelDia.id);
            if (updateError) throw updateError;
            registroId = aperturaDelDia.id;

            try {
              await upsertOne(STORE.CIERRES, {
                ...registro,
                id: aperturaDelDia.id,
                fecha_apertura: fechaApertura || registro.fecha_apertura,
                fecha_cierre: registro.fecha_cierre ?? registro.fecha,
                estado: "CIERRE",
                pending_sync: false,
              });
            } catch (e) {
              console.warn(
                "[RegistroCierre] No se pudo limpiar pending_sync local:",
                e,
              );
            }
          } else {
            // No hay apertura en Supabase, insertar cierre directo
            const { data: insertData, error: insertError } = await supabase
              .from("cierres")
              .insert([{ ...registro, estado: "CIERRE" }])
              .select("id")
              .single();
            if (insertError) throw insertError;
            if (insertData?.id) registroId = insertData.id;

            if (insertData?.id) {
              try {
                await upsertOne(STORE.CIERRES, {
                  ...registro,
                  id: insertData.id,
                  fecha_apertura: fechaApertura || registro.fecha_apertura,
                  fecha_cierre: registro.fecha_cierre ?? registro.fecha,
                  estado: "CIERRE",
                  pending_sync: false,
                });
              } catch (e) {
                console.warn(
                  "[RegistroCierre] No se pudo actualizar id/estado de sync en IDB:",
                  e,
                );
              }
            }
          }
        } catch (sbErr: any) {
          console.warn(
            "[RegistroCierre] Supabase offline, cierre guardado solo en IDB:",
            sbErr,
          );
          // Si ya guardamos en IDB, no mostrar error al usuario
        }
      }

      setGuardando(false);
      if (!idbOk) {
        alert("Error al guardar: no se pudo registrar el cierre.");
      } else {
        // Imprimir reporte si es CIERRE
        if (registro.tipo_registro === "cierre") {
          printCierreReport(
            { ...registro, id: registroId },
            gastosDia || 0,
            platillosDia || 0,
            bebidasDia || 0,
            totalVentasDia || 0,
            fechaApertura || "",
          );
        }

        // Enviar datos al script de Google (fire-and-forget)
        try {
          const { GOOGLE_SCRIPT_URL } = await import("./googlescript");
          const gsBase = GOOGLE_SCRIPT_URL;
          const now = new Date();
          const fecha = now.toLocaleDateString();
          const hora = now.toLocaleTimeString();

          // Determinar correo del admin: preferir correo del usuario tipo Admin en la tabla,
          // si no existe usar el email del usuarioActual como fallback.
          let adminEmailToSend = usuarioActual?.email || "";
          try {
            const { data: adminUsers, error: adminErr } = await supabase
              .from("usuarios")
              .select("email")
              .eq("rol", "Admin")
              .limit(1);
            if (!adminErr && adminUsers && adminUsers.length > 0) {
              adminEmailToSend = adminUsers[0].email || adminEmailToSend;
            }
          } catch (e) {
            // ignore and fallback
          }

          const params = new URLSearchParams({
            fecha: fecha,
            hora: hora,
            cajero: registro.cajero || "",
            admin: String(adminEmailToSend || ""),
            efectivo_reg: String(registro.efectivo_registrado || 0),
            tarjeta_reg: String(registro.monto_tarjeta_registrado || 0),
            transf_reg: String(registro.transferencias_registradas || 0),
            dolares_reg: String(registro.dolares_registrado || 0),
            efectivo_ventas: String(registro.efectivo_dia || 0),
            tarjeta_ventas: String(registro.monto_tarjeta_dia || 0),
            transf_ventas: String(registro.transferencias_dia || 0),
            dolares_ventas: String(registro.dolares_dia || 0),
            precio_dolar: String(precioDolar || 0),
            // Enviar también el total de gastos del día y asegurarnos que
            // efectivo_ventas corresponde al efectivo ya neto de esos gastos.
            gasto: String(gastosDia || 0),
          });

          // Añadir timestamp para evitar caching
          params.append("_ts", String(Date.now()));
          const url = gsBase + "?" + params.toString();

          // Método robusto de "fire-and-forget": crear una imagen y asignar src (GET sin CORS)
          try {
            const img = new Image();
            img.src = url;
            // No necesitamos manejar onload/onerror; esto envía la petición GET inmediatamente.
          } catch (e) {
            // fallback a fetch no-cors con keepalive
            try {
              fetch(url, {
                method: "GET",
                mode: "no-cors",
                keepalive: true,
              }).catch(() => {});
            } catch (e2) {
              // último recurso: fetch normal sin await
              fetch(url).catch(() => {});
            }
          }
        } catch (e) {
          // No hacemos nada si falla el envío; es fire-and-forget
          console.warn("No se pudo enviar datos al script de Google:", e);
        }

        // Si la diferencia es distinta de 0, redirigir a resultadosCaja
        if (
          registro.diferencia !== 0 &&
          typeof onCierreGuardado === "function"
        ) {
          onCierreGuardado();
        } else if (typeof onCierreGuardado === "function") {
          onCierreGuardado();
        }
      }
    }, 1000);
  };

  // Validación visual en render: mostrar/ocultar botón y marcar required condicionalmente
  // Fondo fijo siempre será 0, no se solicita al usuario
  const efectivoFilled = efectivo.trim() !== "";
  const tarjetaFilled = tarjeta.trim() !== "";
  const transferenciasFilled = transferencias.trim() !== "";
  const dolaresFilled = dolares.trim() !== "";
  // El cierre requiere los 4 campos: efectivo, tarjeta, transferencias y dólares
  const isCierreReady =
    efectivoFilled && tarjetaFilled && transferenciasFilled && dolaresFilled;
  const showGuardar = isCierreReady;

  const efectivoConteo = Number.parseFloat(efectivo);
  const tarjetaConteo = Number.parseFloat(tarjeta);
  const transferenciasConteo = Number.parseFloat(transferencias);
  const dolaresConteo = Number.parseFloat(dolares);

  const efectivoConteoNum = Number.isFinite(efectivoConteo) ? efectivoConteo : 0;
  const tarjetaConteoNum = Number.isFinite(tarjetaConteo) ? tarjetaConteo : 0;
  const transferenciasConteoNum = Number.isFinite(transferenciasConteo)
    ? transferenciasConteo
    : 0;
  const dolaresConteoNum = Number.isFinite(dolaresConteo) ? dolaresConteo : 0;

  const diferenciaDolaresUSDLive = dolaresConteoNum - dolaresSistema;
  const diferenciaDolaresLpsLive = diferenciaDolaresUSDLive * precioDolarActual;
  const diferenciaLive =
    (efectivoConteoNum - efectivoSistema) +
    (tarjetaConteoNum - tarjetaSistema) +
    (transferenciasConteoNum - transferenciasSistema) +
    diferenciaDolaresLpsLive;

  const difSignLive =
    diferenciaLive > 0
      ? "A FAVOR"
      : diferenciaLive < 0
        ? "EN CONTRA"
        : "CUADRADO";
  const difAbsLive = Math.abs(diferenciaLive).toFixed(2);
  const difColorLive =
    diferenciaLive > 0
      ? "#166534"
      : diferenciaLive < 0
        ? "#b91c1c"
        : "#0f172a";
  const difBgLive =
    diferenciaLive > 0
      ? "#f0fdf4"
      : diferenciaLive < 0
        ? "#fef2f2"
        : "#f8fafc";
  const difBorderLive =
    diferenciaLive > 0
      ? "#86efac"
      : diferenciaLive < 0
        ? "#fca5a5"
        : "#e2e8f0";

  return (
    <div
      style={{
        width: "100vw",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#eef0f4",
        padding: "24px 16px",
      }}
    >
      <style>{`
        @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        .ci-input:focus { border-color: #2563eb !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.13) !important; background: #fff !important; }
        .ci-sync:hover:not(:disabled) { background: #e2e8f0 !important; border-color: #94a3b8 !important; }
        .ci-guardar:hover:not(:disabled) { background: #1d4ed8 !important; transform: translateY(-1px); box-shadow: 0 6px 18px rgba(37,99,235,0.32) !important; }
        .ci-cancelar:hover { border-color: #94a3b8 !important; background: #f1f5f9 !important; color: #334155 !important; }
      `}</style>
      <form
        onSubmit={handleGuardar}
        style={{
          background: "#fff",
          borderRadius: 20,
          boxShadow:
            "0 4px 30px rgba(15,23,42,0.12), 0 1px 4px rgba(15,23,42,0.06)",
          padding: 0,
          width: "100%",
          maxWidth: 1080,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          overflow: "hidden",
        }}
      >
        {/* ═══════ PANEL IZQUIERDO — SISTEMA ═══════ */}
        <div
          style={{
            background: "#f8fafc",
            padding: "36px 30px",
            color: "#1e293b",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minHeight: 580,
            borderRight: "1px solid #e2e8f0",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  color: "#475569",
                  marginBottom: 5,
                  fontWeight: 700,
                }}
              >
                Cierre de Caja
              </div>
              <h2
                style={{
                  margin: 0,
                  fontWeight: 800,
                  fontSize: 19,
                  color: "#0f172a",
                  letterSpacing: 0.2,
                }}
              >
                Resumen del Sistema
              </h2>
              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  marginTop: 4,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    background: "#e2e8f0",
                    color: "#475569",
                    borderRadius: 5,
                    padding: "2px 7px",
                    fontSize: 11,
                  }}
                >
                  {usuarioActual?.nombre}
                </span>
                <span
                  style={{
                    background: "#e2e8f0",
                    color: "#475569",
                    borderRadius: 5,
                    padding: "2px 7px",
                    fontSize: 11,
                  }}
                >
                  {caja}
                </span>
                <span
                  style={{
                    background: "#e2e8f0",
                    color: "#475569",
                    borderRadius: 5,
                    padding: "2px 7px",
                    fontSize: 11,
                  }}
                >
                  {new Date().toLocaleDateString("es-HN")}
                </span>
              </div>
              {fechaAperturaSistema && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 6,
                    padding: "5px 9px",
                    background: "#e0f2fe",
                    borderRadius: 7,
                    border: "1px solid #7dd3fc",
                    width: "fit-content",
                  }}
                >
                  <span style={{ fontSize: 13 }}>🕐</span>
                  <div>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#0369a1",
                        textTransform: "uppercase",
                        letterSpacing: 1,
                      }}
                    >
                      Apertura:
                    </span>{" "}
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#0c4a6e",
                      }}
                    >
                      {new Date(fechaAperturaSistema).toLocaleString("es-HN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                </div>
              )}
            </div>
            {/* Botón sincronizar */}
            <button
              type="button"
              disabled={sincronizando || loading}
              onClick={async () => {
                if (!usuarioActual?.id) return;
                setSincronizando(true);
                setSyncError("");
                setLoading(true);
                try {
                  await sincronizarDiaActual(usuarioActual.id);
                  setUltimaSync(new Date());
                  await obtenerValoresAutomaticos();
                  const tasa = await getPrecioDolarLocal();
                  setPrecioDolarActual(Number(tasa) || 0);
                } catch (e) {
                  setSyncError("Error al sincronizar.");
                } finally {
                  setSincronizando(false);
                  setLoading(false);
                }
              }}
              style={{
                background: sincronizando ? "#e2e8f0" : "#fff",
                border: "1.5px solid #cbd5e1",
                borderRadius: 9,
                color: sincronizando ? "#94a3b8" : "#2563eb",
                padding: "7px 13px",
                fontSize: 12,
                fontWeight: 700,
                cursor: sincronizando ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.2s",
                lineHeight: 1.3,
                boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
                flexShrink: 0,
              }}
            >
              {sincronizando ? (
                <>
                  <span
                    style={{
                      display: "inline-block",
                      animation: "spin 1s linear infinite",
                    }}
                  >
                    ⟳
                  </span>{" "}
                  Sync...
                </>
              ) : (
                <>🔄 Sincronizar</>
              )}
            </button>
          </div>

          {/* Info de última sync */}
          {ultimaSync && !sincronizando && (
            <div
              style={{
                fontSize: 11,
                color: "#16a34a",
                marginTop: -8,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#22c55e",
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              Actualizado · {ultimaSync.toLocaleTimeString("es-HN")}
            </div>
          )}

          {/* Aviso de error/offline */}
          {syncError && (
            <div
              style={{
                background: "#fef3c7",
                border: "1px solid #f59e0b",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
                color: "#92400e",
                display: "flex",
                gap: 6,
                alignItems: "flex-start",
              }}
            >
              ⚠️ {syncError}
            </div>
          )}

          {/* Spinner */}
          {(loading || sincronizando) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  border: "2.5px solid #e2e8f0",
                  borderTop: "2.5px solid #2563eb",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  flexShrink: 0,
                }}
              />
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
              <span style={{ fontSize: 12, color: "#64748b" }}>
                {sincronizando
                  ? "Sincronizando datos con servidor..."
                  : "Calculando resumen..."}
              </span>
            </div>
          )}

          {/* Divisor */}
          <div style={{ height: 1, background: "#e2e8f0", margin: "2px 0" }} />

          {/* Tarjetas de valores */}
          {!loading && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flex: 1,
              }}
            >
              {/* Efectivo Neto */}
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1.5px solid #86efac",
                  borderRadius: 11,
                  padding: "13px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#15803d",
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      fontWeight: 700,
                      marginBottom: 2,
                    }}
                  >
                    Efectivo Neto
                  </div>
                  <div style={{ fontSize: 10, color: "#4ade80" }}>
                    ventas − cambio − gastos
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 23,
                    fontWeight: 800,
                    color: "#15803d",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  L {efectivoSistema.toFixed(2)}
                </div>
              </div>

              {/* Tarjeta */}
              <div
                style={{
                  background: "#eff6ff",
                  border: "1.5px solid #93c5fd",
                  borderRadius: 11,
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#1d4ed8",
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Tarjeta
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#1d4ed8",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  L {tarjetaSistema.toFixed(2)}
                </div>
              </div>

              {/* Transferencias */}
              <div
                style={{
                  background: "#f5f3ff",
                  border: "1.5px solid #c4b5fd",
                  borderRadius: 11,
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#6d28d9",
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Transferencia
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#6d28d9",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  L {transferenciasSistema.toFixed(2)}
                </div>
              </div>

              {/* Dólares */}
              <div
                style={{
                  background: "#fefce8",
                  border: "1.5px solid #fde047",
                  borderRadius: 11,
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#a16207",
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Dólares (USD)
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#a16207",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  $ {dolaresSistema.toFixed(2)}
                </div>
              </div>

              {/* Gastos */}
              <div
                style={{
                  background: "#fff1f2",
                  border: "1.5px solid #fda4af",
                  borderRadius: 11,
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#be123c",
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Gastos del Turno
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#be123c",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  L {gastosSistema.toFixed(2)}
                </div>
              </div>

              {/* Total Ventas */}
              <div
                style={{
                  marginTop: 6,
                  borderTop: "1.5px solid #e2e8f0",
                  paddingTop: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: 1.2,
                  }}
                >
                  Total Ventas Brutas
                </span>
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 900,
                    color: "#0f172a",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  L {totalVentasSistema.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <div
            style={{
              fontSize: 10,
              color: "#94a3b8",
              textAlign: "center",
              marginTop: "auto",
              paddingTop: 8,
            }}
          >
            Datos sincronizados desde el servidor al abrir esta pantalla
          </div>
        </div>

        {/* ═════ PANEL DERECHO — FORMULARIO ═════ */}
        <div
          style={{
            padding: "36px 32px",
            background: "#fff",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Encabezado */}
          <div style={{ marginBottom: 26 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "#94a3b8",
                marginBottom: 4,
                fontWeight: 700,
              }}
            >
              Conteo Físico
            </div>
            <h2
              style={{
                margin: 0,
                fontWeight: 800,
                fontSize: 21,
                color: "#0f172a",
              }}
            >
              Registro de Cierre
            </h2>
            <p
              style={{
                margin: "7px 0 0",
                color: "#64748b",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Ingresa los montos contados físicamente en tu caja.
            </p>
          </div>

          {/* Campos */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              flex: 1,
            }}
          >
            {[
              {
                label: "Efectivo contado",
                badge: "L",
                badgeBg: "#dcfce7",
                badgeColor: "#15803d",
                value: efectivo,
                set: setEfectivo,
                required: true,
              },
              {
                label: "Tarjeta",
                badge: "💳",
                badgeBg: "#dbeafe",
                badgeColor: "#1d4ed8",
                value: tarjeta,
                set: setTarjeta,
                required: true,
              },
              {
                label: "Transferencias",
                badge: "🏦",
                badgeBg: "#ede9fe",
                badgeColor: "#6d28d9",
                value: transferencias,
                set: setTransferencias,
                required: true,
              },
              {
                label: "Dólares (USD)",
                badge: "$",
                badgeBg: "#fef9c3",
                badgeColor: "#a16207",
                value: dolares,
                set: setDolares,
                required: false,
              },
            ].map(
              ({ label, badge, badgeBg, badgeColor, value, set, required }) => (
                <div key={label}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: "#1e293b",
                      fontWeight: 600,
                      fontSize: 13,
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        background: badgeBg,
                        color: badgeColor,
                        borderRadius: 5,
                        padding: "2px 7px",
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      {badge}
                    </span>
                    {label}
                  </label>
                  <input
                    className="ci-input"
                    type="number"
                    step="0.01"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    required={required}
                    placeholder="0.00"
                    style={{
                      padding: "11px 13px",
                      fontSize: 15,
                      border: "1.5px solid #dde1e7",
                      borderRadius: 10,
                      outline: "none",
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#f8fafc",
                      color: "#1e293b",
                      fontWeight: 500,
                      transition:
                        "border 0.2s, box-shadow 0.2s, background 0.2s",
                    }}
                  />
                </div>
              ),
            )}
          </div>

          {/* Resultado en vivo (misma lógica del cierre impreso) */}
          <div
            style={{
              marginTop: 14,
              background: difBgLive,
              border: `1.5px solid ${difBorderLive}`,
              borderRadius: 11,
              padding: "12px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  color: "#64748b",
                }}
              >
                Resultado en vivo
              </div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 900,
                  color: difColorLive,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 2,
                }}
              >
                L {difAbsLive}
              </div>
            </div>

            <div
              style={{
                textAlign: "right",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: difColorLive,
                  letterSpacing: 0.5,
                }}
              >
                {difSignLive}
              </span>
              <span style={{ fontSize: 10, color: "#64748b" }}>
                Tasa $: L {precioDolarActual.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1.5px solid #fca5a5",
                borderRadius: 10,
                padding: "11px 14px",
                color: "#b91c1c",
                fontWeight: 600,
                fontSize: 13,
                marginTop: 14,
              }}
            >
              ⚠ {error}
            </div>
          )}

          {/* Estado campos */}
          {!showGuardar && (
            <div
              style={{
                marginTop: 18,
                padding: "11px 14px",
                textAlign: "center",
                color: "#94a3b8",
                borderRadius: 10,
                border: "1.5px dashed #e2e8f0",
                background: "#f8fafc",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Complete todos los campos para habilitar el cierre
            </div>
          )}

          {/* Botón guardar */}
          {showGuardar && (
            <button
              type="submit"
              className="ci-guardar"
              disabled={guardando}
              style={{
                marginTop: 18,
                padding: "14px 24px",
                background: guardando ? "#cbd5e1" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 11,
                fontWeight: 800,
                fontSize: 14,
                cursor: guardando ? "not-allowed" : "pointer",
                boxShadow: guardando
                  ? "none"
                  : "0 3px 14px rgba(37,99,235,0.25)",
                letterSpacing: 0.7,
                width: "100%",
                transition: "all 0.2s",
                textTransform: "uppercase",
              }}
            >
              {guardando ? "Guardando cierre..." : "✓ Registrar Cierre de Caja"}
            </button>
          )}

          {/* Botón cancelar */}
          <button
            type="button"
            className="ci-cancelar"
            onClick={() => {
              if (onBack && window.confirm("¿Regresar al Punto de Venta?")) {
                onBack();
              }
            }}
            style={{
              marginTop: 20,
              padding: "12px 24px",
              background: "transparent",
              color: "#64748b",
              border: "1.5px solid #e2e8f0",
              borderRadius: 11,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              width: "100%",
              transition: "all 0.2s",
            }}
          >
            ← Regresar a Punto de Venta
          </button>
        </div>
      </form>
    </div>
  );
}
