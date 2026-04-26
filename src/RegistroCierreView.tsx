import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { formatToHondurasLocal, compareTurnoRecordsByRecency } from "./utils/fechas";
import { useDatosNegocio } from "./useDatosNegocio";
import {
  calcularResumenTurno,
  getAperturaActiva,
  upsertOne,
  getAll,
  STORE,
  getPrecioDolarLocal,
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
  const [guardando, setGuardando] = useState(false);

  // Cargar valores del sistema al montar la vista
  useEffect(() => {
    let mounted = true;
    async function cargarResumen() {
      if (!usuarioActual || !usuarioActual.id || !caja) return;
      setLoading(true);
      try {
        await obtenerValoresAutomaticos();
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
      fechaApertura: aperturaActual.fecha,
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
              .sort(
                (a: any, b: any) =>
                  compareTurnoRecordsByRecency(a, b),
              )[0] ?? null;
        }

        if (aperturaIdb) {
          const cierreIdb = {
            ...aperturaIdb,
            tipo_registro: "cierre",
            fecha: registro.fecha,
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
            .select("id")
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
                estado: "CIERRE",
                pending_sync: false,
              });
            } catch (e) {
              console.warn("[RegistroCierre] No se pudo limpiar pending_sync local:", e);
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

  return (
    <div
      style={{
        width: "100vw",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: "20px",
      }}
    >
      <form
        onSubmit={handleGuardar}
        style={{
          background: "#fff",
          borderRadius: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          padding: 0,
          width: "100%",
          maxWidth: 1200,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          overflow: "hidden",
        }}
      >
        {/* Columna izquierda - Resumen del Sistema */}
        <div
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            padding: 40,
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontWeight: 800,
              fontSize: 32,
              letterSpacing: 1,
              textShadow: "0 2px 8px rgba(0,0,0,0.2)",
            }}
          >
            Resumen del Sistema
          </h2>

          <div
            style={{
              background: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(10px)",
              borderRadius: 16,
              padding: 20,
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 12 }}>
              <div style={{ marginBottom: 6 }}>
                <strong>Cajero:</strong> {usuarioActual?.nombre}
              </div>
              <div style={{ marginBottom: 6 }}>
                <strong>Caja:</strong> {caja}
              </div>
              <div>
                <strong>Fecha:</strong> {new Date().toLocaleDateString("es-HN")}
              </div>
            </div>
          </div>

          {loading && (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  border: "4px solid rgba(255,255,255,0.3)",
                  borderTop: "4px solid #fff",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                  margin: "0 auto",
                }}
              />
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
              <p style={{ marginTop: 16, opacity: 0.9 }}>
                Calculando valores...
              </p>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              style={{
                background: "rgba(255,255,255,0.2)",
                backdropFilter: "blur(10px)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
                Efectivo en Sistema
              </div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                L {efectivoSistema.toFixed(2)}
              </div>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.2)",
                backdropFilter: "blur(10px)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
                Tarjeta en Sistema
              </div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                L {tarjetaSistema.toFixed(2)}
              </div>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.2)",
                backdropFilter: "blur(10px)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
                Transferencias en Sistema
              </div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                L {transferenciasSistema.toFixed(2)}
              </div>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.2)",
                backdropFilter: "blur(10px)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
                Dólares en Sistema
              </div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>
                $ {dolaresSistema.toFixed(2)}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: "auto",
              fontSize: 12,
              opacity: 0.7,
              textAlign: "center",
            }}
          >
            Los valores del sistema se calculan automáticamente
          </div>
        </div>

        {/* Columna derecha - Formulario de Cierre */}
        <div
          style={{
            padding: 40,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <h2
            style={{
              color: "#1976d2",
              margin: 0,
              fontWeight: 800,
              fontSize: 28,
              letterSpacing: 0.5,
            }}
          >
            Registro de Cierre
          </h2>

          <p
            style={{ margin: 0, color: "#666", fontSize: 15, marginBottom: 28 }}
          >
            Ingresa los valores contados físicamente en tu caja
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label
                style={{
                  color: "#333",
                  fontWeight: 600,
                  fontSize: 15,
                  marginBottom: 8,
                  display: "block",
                }}
              >
                Efectivo Contado (Lempiras)
              </label>
              <input
                type="number"
                step="0.01"
                value={efectivo}
                onChange={(e) => setEfectivo(e.target.value)}
                required
                placeholder="0.00"
                style={{
                  padding: 14,
                  fontSize: 16,
                  border: "2px solid #e0e0e0",
                  borderRadius: 10,
                  outline: "none",
                  transition: "border 0.3s, box-shadow 0.3s",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#667eea";
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(102,126,234,0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#e0e0e0";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            <div>
              <label
                style={{
                  color: "#333",
                  fontWeight: 600,
                  fontSize: 15,
                  marginBottom: 8,
                  display: "block",
                }}
              >
                Tarjeta (Lempiras)
              </label>
              <input
                type="number"
                step="0.01"
                value={tarjeta}
                onChange={(e) => setTarjeta(e.target.value)}
                required
                placeholder="0.00"
                style={{
                  padding: 14,
                  fontSize: 16,
                  border: "2px solid #e0e0e0",
                  borderRadius: 10,
                  outline: "none",
                  transition: "border 0.3s, box-shadow 0.3s",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#667eea";
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(102,126,234,0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#e0e0e0";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            <div>
              <label
                style={{
                  color: "#333",
                  fontWeight: 600,
                  fontSize: 15,
                  marginBottom: 8,
                  display: "block",
                }}
              >
                Transferencias (Lempiras)
              </label>
              <input
                type="number"
                step="0.01"
                value={transferencias}
                onChange={(e) => setTransferencias(e.target.value)}
                required
                placeholder="0.00"
                style={{
                  padding: 14,
                  fontSize: 16,
                  border: "2px solid #e0e0e0",
                  borderRadius: 10,
                  outline: "none",
                  transition: "border 0.3s, box-shadow 0.3s",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#667eea";
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(102,126,234,0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#e0e0e0";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            <div>
              <label
                style={{
                  color: "#333",
                  fontWeight: 600,
                  fontSize: 15,
                  marginBottom: 8,
                  display: "block",
                }}
              >
                Dólares (USD)
              </label>
              <input
                type="number"
                step="0.01"
                value={dolares}
                onChange={(e) => setDolares(e.target.value)}
                placeholder="0.00 "
                style={{
                  padding: 14,
                  fontSize: 16,
                  border: "2px solid #e0e0e0",
                  borderRadius: 10,
                  outline: "none",
                  transition: "border 0.3s, box-shadow 0.3s",
                  width: "100%",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#667eea";
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(102,126,234,0.1)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#e0e0e0";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>
          </div>

          {error && (
            <div
              style={{
                background: "#fee",
                border: "2px solid #f44336",
                borderRadius: 10,
                padding: 16,
                color: "#c62828",
                fontWeight: 600,
                marginTop: 16,
              }}
            >
              {error}
            </div>
          )}

          {!showGuardar && (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                textAlign: "center",
                color: "#999",
                borderRadius: 10,
                border: "1px dashed #e0e0e0",
                background: "#fafafa",
                fontWeight: 600,
              }}
            >
              Rellene los campos requeridos para registrar el cierre
            </div>
          )}

          {showGuardar && (
            <button
              type="submit"
              disabled={guardando}
              style={{
                marginTop: 20,
                padding: 16,
                backgroundColor: guardando ? "#ccc" : "#667eea",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 17,
                cursor: guardando ? "not-allowed" : "pointer",
                transition: "all 0.3s",
                boxShadow: guardando
                  ? "none"
                  : "0 4px 14px rgba(102,126,234,0.4)",
                letterSpacing: 0.5,
                width: "100%",
              }}
              onMouseEnter={(e) => {
                if (!guardando) {
                  e.currentTarget.style.backgroundColor = "#5568d3";
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow =
                    "0 6px 20px rgba(102,126,234,0.5)";
                }
              }}
              onMouseLeave={(e) => {
                if (!guardando) {
                  e.currentTarget.style.backgroundColor = "#667eea";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow =
                    "0 4px 14px rgba(102,126,234,0.4)";
                }
              }}
            >
              {guardando ? "Guardando..." : "REGISTRAR CIERRE DE CAJA"}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (onBack) {
                if (window.confirm("¿Cancelar el registro de cierre?")) {
                  onBack();
                }
              }
            }}
            style={{
              marginTop: 12,
              padding: 14,
              backgroundColor: "transparent",
              color: "#666",
              border: "2px solid #e0e0e0",
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
              transition: "all 0.3s",
              width: "100%",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#999";
              e.currentTarget.style.color = "#333";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#e0e0e0";
              e.currentTarget.style.color = "#666";
            }}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
