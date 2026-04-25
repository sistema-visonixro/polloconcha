import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { useDatosNegocio } from "./useDatosNegocio";
import { getAll, getPrecioDolarLocal, STORE, upsertOne, encolarEscritura } from "./utils/localDB";

export default function ResultadosCajaView() {
  const { datos: datosNegocio } = useDatosNegocio();
  const [cierres, setCierres] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Mes mostrado (0 = mes actual, -1 = mes anterior, etc.)
  const [monthOffset, setMonthOffset] = useState<number>(0);

  // Obtener usuario actual de localStorage
  const usuarioActual = (() => {
    try {
      const stored = localStorage.getItem("usuario");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  })();

  // Helper: obtener rango ISO para el mes con offset
  const getMonthRange = (offset: number) => {
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth() + offset,
      1,
      0,
      0,
      0,
      0,
    );
    const end = new Date(
      start.getFullYear(),
      start.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return {
      fechaInicio: start.toISOString(),
      fechaFin: end.toISOString(),
      label: start.toLocaleDateString("es-HN", {
        year: "numeric",
        month: "long",
      }),
    };
  };

  useEffect(() => {
    const fetchCierres = async () => {
      setLoading(true);
      try {
        const { fechaInicio, fechaFin } = getMonthRange(monthOffset);
        const tsInicio = new Date(fechaInicio).getTime();
        const tsFin = new Date(fechaFin).getTime();

        // ── IDB primero ────────────────────────────────────────
        let cierresData: any[] = [];
        try {
          const todosIdb = await getAll<any>(STORE.CIERRES);
          cierresData = todosIdb
            .filter((c) => {
              if (c.tipo_registro !== "cierre" && c.estado !== "CIERRE") return false;
              const ts = new Date(c.fecha ?? 0).getTime();
              if (ts < tsInicio || ts > tsFin) return false;
              if (usuarioActual && usuarioActual.rol === "cajero") {
                return c.cajero_id === usuarioActual.id;
              }
              return true;
            })
            .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
        } catch { /* IDB no disponible */ }

        // ── Fallback/complemento Supabase ─────────────────────
        if (navigator.onLine) {
          try {
            let query = supabase
              .from("cierres")
              .select("*")
              .eq("tipo_registro", "cierre")
              .gte("fecha", fechaInicio)
              .lte("fecha", fechaFin)
              .order("fecha", { ascending: false });

            if (usuarioActual && usuarioActual.rol === "cajero") {
              query = query.eq("cajero_id", usuarioActual.id);
            }

            const { data, error } = await query;
            if (!error && data && data.length > 0) {
              // Fusionar: usar Supabase como fuente principal si está disponible
              cierresData = data;
            }
          } catch { /* sin conexión real */ }
        }

        setCierres(cierresData);
      } catch (err) {
        console.error("Error en fetchCierres:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCierres();
    // Depend only on monthOffset and user id (stable primitive) to avoid infinite loops
  }, [monthOffset, usuarioActual?.id]);

  const getColor = (value: number) => {
    if (value > 0) return "#388e3c"; // Verde para positivos
    if (value < 0) return "#d32f2f"; // Rojo para negativos
    return "#1976d2"; // Azul para cero
  };

  const [updatingObservacion, setUpdatingObservacion] = useState(false);
  const [tasaDolar, setTasaDolar] = useState<number>(0);

  // Estados para modal de aclaración
  const [showModalAclaracion, setShowModalAclaracion] = useState(false);
  const [cierreSeleccionado, setCierreSeleccionado] = useState<any>(null);
  const [referenciaAclaracion, setReferenciaAclaracion] = useState("");
  const [passwordAclaracion, setPasswordAclaracion] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const abrirModalAclaracion = (cierre: any) => {
    setCierreSeleccionado(cierre);
    setReferenciaAclaracion("");
    setPasswordAclaracion("");
    setShowModalAclaracion(true);
  };

  const cerrarModalAclaracion = () => {
    setShowModalAclaracion(false);
    setCierreSeleccionado(null);
    setReferenciaAclaracion("");
    setPasswordAclaracion("");
  };

  const solicitarPassword = () => {
    if (!referenciaAclaracion.trim()) {
      setErrorMessage("Debe ingresar una referencia del cierre");
      setShowErrorModal(true);
      return;
    }
    setShowModalAclaracion(false);
    setShowPasswordModal(true);
  };

  const validarPasswordYAclarar = async () => {
    if (!passwordAclaracion.trim()) {
      setErrorMessage("Debe ingresar su contraseña");
      setShowPasswordModal(false);
      setShowErrorModal(true);
      return;
    }

    setUpdatingObservacion(true);
    try {
      // Validar contraseña
      let claveUsuario = "";
      try {
        const usuariosIdb = await getAll<any>(STORE.USUARIOS);
        const user = usuariosIdb.find((u: any) => u.id === usuarioActual.id);
        if (user) claveUsuario = user.clave;
      } catch { /* IDB no disponible */ }

      if (!claveUsuario && navigator.onLine) {
        const { data: userData, error: userError } = await supabase
          .from("usuarios")
          .select("clave")
          .eq("id", usuarioActual.id)
          .single();
        if (!userError && userData) {
          claveUsuario = userData.clave;
        }
      }

      if (!claveUsuario) {
        setErrorMessage("Error al validar usuario (offline o sin datos)");
        setShowPasswordModal(false);
        setShowErrorModal(true);
        return;
      }

      if (claveUsuario !== passwordAclaracion) {
        setErrorMessage("Contraseña incorrecta");
        setShowPasswordModal(false);
        setShowErrorModal(true);
        return;
      }

      // Actualizar cierre en IDB primero
      const cierreActualizado = {
        ...cierreSeleccionado,
        observacion: "aclarado",
        referencia_aclaracion: referenciaAclaracion.trim(),
      };

      try {
        await upsertOne(STORE.CIERRES, cierreActualizado);
      } catch { /* non-critical */ }

      // Actualizar en Supabase o encolar
      let errorSupabase = null;
      if (navigator.onLine) {
        const { error } = await supabase
          .from("cierres")
          .update({
            observacion: "aclarado",
            referencia_aclaracion: referenciaAclaracion.trim(),
          })
          .eq("id", cierreSeleccionado.id);
        errorSupabase = error;
      }

      if (!navigator.onLine || errorSupabase) {
        try {
          await encolarEscritura({
            tabla: "cierres",
            operacion: "update",
            datos: {
              id: cierreSeleccionado.id,
              observacion: "aclarado",
              referencia_aclaracion: referenciaAclaracion.trim(),
            },
          });
        } catch { /* non-critical */ }
      }

      setCierres((prev) =>
        prev.map((c) =>
          c.id === cierreSeleccionado.id
            ? cierreActualizado
            : c,
        ),
      );
      setShowPasswordModal(false);
      setShowSuccessModal(true);
      setReferenciaAclaracion("");
      setPasswordAclaracion("");
      setCierreSeleccionado(null);
    } catch (err) {
      console.error(err);
      setErrorMessage("Error inesperado");
      setShowPasswordModal(false);
      setShowErrorModal(true);
    } finally {
      setUpdatingObservacion(false);
    }
  };

  useEffect(() => {
    (async () => {
      // ── IDB primero ────────────────────────────────────────
      try {
        const tasaIdb = await getPrecioDolarLocal();
        if (tasaIdb > 0) {
          setTasaDolar(tasaIdb);
          return;
        }
      } catch { /* IDB no disponible */ }

      // ── Fallback Supabase ───────────────────────────────────
      try {
        const { data: precioData, error } = await supabase
          .from("precio_dolar")
          .select("valor")
          .eq("id", "singleton")
          .limit(1)
          .single();
        if (!error && precioData && typeof precioData.valor !== "undefined") {
          setTasaDolar(Number(precioData.valor) || 0);
        }
      } catch (e) {
        console.warn("No se pudo obtener tasa de precio_dolar:", e);
      }
    })();
  }, []);

  const printCierreReport = (cierre: any) => {
    const logoUrl = datosNegocio.logo_url || "/favicon.ico";
    const img = new Image();
    img.src = logoUrl;

    const doPrint = () => {
      const printWindow = window.open("", "_blank");
      if (!printWindow) return;

      const diferencia = Number(cierre.diferencia || 0);
      const difSign =
        diferencia > 0 ? "A FAVOR" : diferencia < 0 ? "EN CONTRA" : "CUADRADO";
      const difAbs = Math.abs(diferencia).toFixed(2);

      const totalVentasDia =
        Number(cierre.efectivo_dia || 0) +
        Number(cierre.monto_tarjeta_dia || 0) +
        Number(cierre.transferencias_dia || 0);

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
              <div style="font-size: 13px;">(REIMPRESI&#xd3;N)</div>
            </div>
            <div class="info">
              <div><strong>N&#xba; de Cierre:</strong> ${cierre.id || "N/A"}</div>
              <div><strong>Cajero:</strong> ${cierre.cajero}</div>
              <div><strong>Caja:</strong> ${cierre.caja}</div>
              <div><strong>Cierre:</strong> ${fmtFecha(cierre.fecha)}</div>
            </div>
            <div class="divider"></div>
            <div style="text-align: center; font-weight: bold; margin-bottom: 10px;">SISTEMA</div>
            <div class="row"><span>Fondo Fijo:</span><span>L ${Number(cierre.fondo_fijo || 0).toFixed(2)}</span></div>
            <div class="row"><span>Efectivo (Neto):</span><span>L ${Number(cierre.efectivo_dia || 0).toFixed(2)}</span></div>
            <div class="row"><span>Tarjeta:</span><span>L ${Number(cierre.monto_tarjeta_dia || 0).toFixed(2)}</span></div>
            <div class="row"><span>Transferencia:</span><span>L ${Number(cierre.transferencias_dia || 0).toFixed(2)}</span></div>
            <div class="row"><span>D&#xf3;lares (USD):</span><span>$ ${Number(cierre.dolares_dia || 0).toFixed(2)}</span></div>
            <div class="divider"></div>
            <div class="row" style="font-weight: bold;">
              <span>VENTA DEL D&#xcd;A:</span>
              <span>L ${totalVentasDia.toFixed(2)}</span>
            </div>
            <div class="divider"></div>
            <div style="text-align: center; font-weight: bold; margin-bottom: 10px;">CONTEO (USUARIO)</div>
            <div class="row"><span>Fondo Fijo:</span><span>L ${Number(cierre.fondo_fijo_registrado || 0).toFixed(2)}</span></div>
            <div class="row"><span>Efectivo:</span><span>L ${Number(cierre.efectivo_registrado || 0).toFixed(2)}</span></div>
            <div class="row"><span>Tarjeta:</span><span>L ${Number(cierre.monto_tarjeta_registrado || 0).toFixed(2)}</span></div>
            <div class="row"><span>Transferencia:</span><span>L ${Number(cierre.transferencias_registradas || 0).toFixed(2)}</span></div>
            <div class="row"><span>D&#xf3;lares (USD):</span><span>$ ${Number(cierre.dolares_registrado || 0).toFixed(2)}</span></div>
            <div class="divider"></div>
            <div class="row" style="font-size: 16px;">
              <span>DIFERENCIA:</span>
              <span>L ${difAbs}</span>
            </div>
            <div style="text-align: right; font-size: 15px; font-weight: bold;">${difSign}</div>
            ${cierre.observacion ? `<div class="row" style="font-size:13px"><span>Obs:</span><span>${cierre.observacion}</span></div>` : ""}
            ${cierre.referencia_aclaracion ? `<div class="row" style="font-size:13px"><span>Ref:</span><span>${cierre.referencia_aclaracion}</span></div>` : ""}
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

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background:
          "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)",
        color: "#fff",
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 9999,
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "24px 48px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          background: "rgba(0,0,0,0.2)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {datosNegocio.logo_url ? (
            <img
              src={datosNegocio.logo_url}
              alt="Logo"
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                objectFit: "cover",
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                border: "3px solid rgba(255,255,255,0.2)",
              }}
            />
          ) : (
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #667eea, #764ba2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "2.5rem",
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              }}
            >
              🏪
            </div>
          )}
          <div style={{ flex: 1 }}>
            <h1
              style={{
                margin: 0,
                fontSize: "2.5rem",
                fontWeight: 900,
                letterSpacing: 1,
                background: "linear-gradient(90deg, #fff 0%, #90caf9 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {(() => {
                const lbl = getMonthRange(monthOffset).label;
                return `RESULTADOS DE CAJA — ${lbl.toUpperCase()}`;
              })()}
            </h1>
            {/* Controles de navegación de mes */}
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <button
                onClick={() => setMonthOffset((m) => m - 1)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                }}
                title="Mes anterior"
              >
                ◀ Mes anterior
              </button>
              <button
                onClick={() => setMonthOffset(0)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                }}
                title="Mes actual"
              >
                Mes actual
              </button>
              <button
                onClick={() => setMonthOffset((m) => Math.min(m + 1, 0))}
                disabled={monthOffset === 0}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "none",
                  cursor: monthOffset === 0 ? "not-allowed" : "pointer",
                  opacity: monthOffset === 0 ? 0.5 : 1,
                }}
                title="Mes siguiente"
              >
                Mes siguiente ▶
              </button>
            </div>
            {cierres.length > 0 && (
              <div style={{ marginTop: 8, fontSize: "1.1rem", opacity: 0.9 }}>
                <span style={{ marginRight: 24 }}>
                  <strong>Cajero:</strong> {cierres[0].cajero}
                </span>
                <span style={{ marginRight: 24 }}>
                  <strong>Caja:</strong> {cierres[0].caja}
                </span>
                <span style={{ marginRight: 24 }}>
                  <strong>Cierres del mes:</strong> {cierres.length}
                </span>
                <span>
                  <strong>Último cierre:</strong>{" "}
                  {new Date(cierres[0].fecha).toLocaleDateString("es-HN", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              try {
                localStorage.setItem("vista", "puntoDeVenta");
              } catch {}
              window.location.href = "/punto-de-venta";
            }}
            style={{
              padding: "16px 32px",
              background: "#1976d2",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontWeight: 700,
              fontSize: "1.1rem",
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(25, 118, 210, 0.4)",
              transition: "all 0.3s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#1565c0";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#1976d2";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            ← REGRESAR A PUNTO DE VENTAS
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          padding: "48px",
          display: "flex",
          flexDirection: "column",
          gap: 32,
          maxWidth: 1400,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}>
            <div
              style={{
                width: 64,
                height: 64,
                border: "6px solid rgba(255,255,255,0.2)",
                borderTop: "6px solid #fff",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto 24px",
              }}
            />
            <style>{`@keyframes spin { 0% { transform: rotate(0deg);} 100% { transform: rotate(360deg);} }`}</style>
            <p style={{ fontSize: "1.2rem", opacity: 0.8 }}>
              Cargando resultados...
            </p>
          </div>
        ) : cierres.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: 48,
              background: "rgba(255,255,255,0.05)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <p style={{ fontSize: "1.3rem" }}>
              No hay cierres registrados en las últimas 24 horas.
            </p>
          </div>
        ) : (
          <>
            {/* Sección de Diferencias */}
            <div
              style={{
                background: "rgba(0,0,0,0.3)",
                borderRadius: 20,
                padding: 40,
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              }}
            >
              <h2
                style={{
                  margin: "0 0 32px 0",
                  fontSize: "2rem",
                  fontWeight: 900,
                  textAlign: "center",
                  color: "#ffd54f",
                  textTransform: "uppercase",
                  letterSpacing: 2,
                }}
              >
                TOTAL DE DIFERENCIAS DEL MES
              </h2>

              {cierres.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: 24,
                    marginBottom: 32,
                  }}
                >
                  {(() => {
                    // Calcular la suma total de diferencias de todos los cierres sin aclarar
                    const cierresSinAclarar = cierres.filter(
                      (c) =>
                        !c.observacion ||
                        c.observacion.toLowerCase().trim() !== "aclarado",
                    );

                    const efectivoDiffTotal = cierresSinAclarar.reduce(
                      (sum, cierre) => {
                        return (
                          sum +
                          parseFloat(
                            (
                              (parseFloat(cierre.efectivo_registrado) || 0) -
                              (parseFloat(cierre.efectivo_dia) || 0)
                            ).toFixed(2),
                          )
                        );
                      },
                      0,
                    );

                    const tarjetaDiffTotal = cierresSinAclarar.reduce(
                      (sum, cierre) => {
                        return (
                          sum +
                          parseFloat(
                            (
                              (parseFloat(cierre.monto_tarjeta_registrado) ||
                                0) - (parseFloat(cierre.monto_tarjeta_dia) || 0)
                            ).toFixed(2),
                          )
                        );
                      },
                      0,
                    );

                    const transDiffTotal = cierresSinAclarar.reduce(
                      (sum, cierre) => {
                        return (
                          sum +
                          parseFloat(
                            (
                              (parseFloat(cierre.transferencias_registradas) ||
                                0) -
                              (parseFloat(cierre.transferencias_dia) || 0)
                            ).toFixed(2),
                          )
                        );
                      },
                      0,
                    );

                    const dolaresDiffTotal = cierresSinAclarar.reduce(
                      (sum, cierre) => {
                        return (
                          sum +
                          parseFloat(
                            (
                              (parseFloat(cierre.dolares_registrado) || 0) -
                              (parseFloat(cierre.dolares_dia) || 0)
                            ).toFixed(2),
                          )
                        );
                      },
                      0,
                    );

                    const efectivoDiff = parseFloat(
                      efectivoDiffTotal.toFixed(2),
                    );
                    const tarjetaDiff = parseFloat(tarjetaDiffTotal.toFixed(2));
                    const transDiff = parseFloat(transDiffTotal.toFixed(2));
                    const dolaresDiff = parseFloat(dolaresDiffTotal.toFixed(2));

                    return (
                      <>
                        <div
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            padding: 24,
                            borderRadius: 16,
                            textAlign: "center",
                            border: "1px solid rgba(255,255,255,0.1)",
                            transition: "all 0.3s",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.9rem",
                              fontWeight: 700,
                              color: "#90caf9",
                              marginBottom: 12,
                              textTransform: "uppercase",
                              letterSpacing: 1,
                            }}
                          >
                            EFECTIVO
                          </div>
                          <div
                            style={{
                              fontSize: "2.5rem",
                              fontWeight: 900,
                              color: getColor(efectivoDiff),
                            }}
                          >
                            L {efectivoDiff.toFixed(2)}
                          </div>
                        </div>

                        <div
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            padding: 24,
                            borderRadius: 16,
                            textAlign: "center",
                            border: "1px solid rgba(255,255,255,0.1)",
                            transition: "all 0.3s",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.9rem",
                              fontWeight: 700,
                              color: "#90caf9",
                              marginBottom: 12,
                              textTransform: "uppercase",
                              letterSpacing: 1,
                            }}
                          >
                            TARJETA
                          </div>
                          <div
                            style={{
                              fontSize: "2.5rem",
                              fontWeight: 900,
                              color: getColor(tarjetaDiff),
                            }}
                          >
                            L {tarjetaDiff.toFixed(2)}
                          </div>
                        </div>

                        <div
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            padding: 24,
                            borderRadius: 16,
                            textAlign: "center",
                            border: "1px solid rgba(255,255,255,0.1)",
                            transition: "all 0.3s",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.9rem",
                              fontWeight: 700,
                              color: "#90caf9",
                              marginBottom: 12,
                              textTransform: "uppercase",
                              letterSpacing: 1,
                            }}
                          >
                            TRANSFERENCIA
                          </div>
                          <div
                            style={{
                              fontSize: "2.5rem",
                              fontWeight: 900,
                              color: getColor(transDiff),
                            }}
                          >
                            L {transDiff.toFixed(2)}
                          </div>
                        </div>

                        <div
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            padding: 24,
                            borderRadius: 16,
                            textAlign: "center",
                            border: "1px solid rgba(255,255,255,0.1)",
                            transition: "all 0.3s",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.9rem",
                              fontWeight: 700,
                              color: "#ffd54f",
                              marginBottom: 12,
                              textTransform: "uppercase",
                              letterSpacing: 1,
                            }}
                          >
                            DÓLARES
                          </div>
                          <div
                            style={{
                              fontSize: "2.5rem",
                              fontWeight: 900,
                              color: getColor(dolaresDiff),
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: "2.2rem",
                                  fontWeight: 900,
                                  color: getColor(dolaresDiff),
                                  lineHeight: 1,
                                }}
                              >
                                $ {dolaresDiff.toFixed(2)}
                              </div>
                              {tasaDolar > 0 && (
                                <div
                                  style={{
                                    fontSize: "0.95rem",
                                    fontWeight: 600,
                                    color: "rgba(255,255,255,0.75)",
                                    marginTop: 6,
                                  }}
                                >
                                  {`(L ${Number(
                                    (dolaresDiff * tasaDolar).toFixed(2),
                                  )})`}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Sección de Detalles */}
            {cierres.length > 0 &&
              cierres
                .filter((cierre) => {
                  if (!usuarioActual) return false;
                  // Mostrar solo los cierres sin aclarar del cajero en el mes actual
                  const sinAclarar =
                    !cierre.observacion ||
                    cierre.observacion.toLowerCase().trim() !== "aclarado";
                  return (
                    cierre.cajero_id === usuarioActual.id &&
                    cierre.fecha &&
                    sinAclarar
                  );
                })
                .map((cierre, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "rgba(0,0,0,0.3)",
                      borderRadius: 20,
                      padding: 40,
                      border: "1px solid rgba(255,255,255,0.1)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                    }}
                  >
                    <h2
                      style={{
                        margin: "0 0 16px 0",
                        fontSize: "1.8rem",
                        fontWeight: 900,
                        textAlign: "center",
                        color: "#90caf9",
                        textTransform: "uppercase",
                        letterSpacing: 2,
                      }}
                    >
                      DETALLE DEL CIERRE
                    </h2>

                    {/* Fecha del cierre */}
                    <div
                      style={{
                        textAlign: "center",
                        fontSize: "1.1rem",
                        color: "rgba(255,255,255,0.75)",
                        marginBottom: 24,
                        fontWeight: 600,
                      }}
                    >
                      {new Date(cierre.fecha).toLocaleDateString("es-HN", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>

                    {/* Sección de Diferencias para este cierre */}
                    <div
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        borderRadius: 12,
                        padding: 24,
                        marginBottom: 24,
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <h3
                        style={{
                          margin: "0 0 20px 0",
                          fontSize: "1.3rem",
                          fontWeight: 800,
                          textAlign: "center",
                          color: "#ffd54f",
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        DIFERENCIAS
                      </h3>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(150px, 1fr))",
                          gap: 16,
                        }}
                      >
                        {(() => {
                          const efectivoDiff = parseFloat(
                            (
                              (parseFloat(cierre.efectivo_registrado) || 0) -
                              (parseFloat(cierre.efectivo_dia) || 0)
                            ).toFixed(2),
                          );
                          const tarjetaDiff = parseFloat(
                            (
                              (parseFloat(cierre.monto_tarjeta_registrado) ||
                                0) - (parseFloat(cierre.monto_tarjeta_dia) || 0)
                            ).toFixed(2),
                          );
                          const transDiff = parseFloat(
                            (
                              (parseFloat(cierre.transferencias_registradas) ||
                                0) -
                              (parseFloat(cierre.transferencias_dia) || 0)
                            ).toFixed(2),
                          );
                          const dolaresDiff = parseFloat(
                            (
                              (parseFloat(cierre.dolares_registrado) || 0) -
                              (parseFloat(cierre.dolares_dia) || 0)
                            ).toFixed(2),
                          );

                          return (
                            <>
                              <div
                                style={{
                                  background: "rgba(255,255,255,0.05)",
                                  padding: 16,
                                  borderRadius: 10,
                                  textAlign: "center",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.85rem",
                                    fontWeight: 600,
                                    color: "#90caf9",
                                    marginBottom: 8,
                                    textTransform: "uppercase",
                                  }}
                                >
                                  EFECTIVO
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.4rem",
                                    fontWeight: 900,
                                    color: getColor(efectivoDiff),
                                  }}
                                >
                                  L {efectivoDiff.toFixed(2)}
                                </div>
                              </div>

                              <div
                                style={{
                                  background: "rgba(255,255,255,0.05)",
                                  padding: 16,
                                  borderRadius: 10,
                                  textAlign: "center",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.85rem",
                                    fontWeight: 600,
                                    color: "#90caf9",
                                    marginBottom: 8,
                                    textTransform: "uppercase",
                                  }}
                                >
                                  TARJETA
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.4rem",
                                    fontWeight: 900,
                                    color: getColor(tarjetaDiff),
                                  }}
                                >
                                  L {tarjetaDiff.toFixed(2)}
                                </div>
                              </div>

                              <div
                                style={{
                                  background: "rgba(255,255,255,0.05)",
                                  padding: 16,
                                  borderRadius: 10,
                                  textAlign: "center",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.85rem",
                                    fontWeight: 600,
                                    color: "#90caf9",
                                    marginBottom: 8,
                                    textTransform: "uppercase",
                                  }}
                                >
                                  TRANSFERENCIA
                                </div>
                                <div
                                  style={{
                                    fontSize: "1.4rem",
                                    fontWeight: 900,
                                    color: getColor(transDiff),
                                  }}
                                >
                                  L {transDiff.toFixed(2)}
                                </div>
                              </div>

                              <div
                                style={{
                                  background: "rgba(255,255,255,0.05)",
                                  padding: 16,
                                  borderRadius: 10,
                                  textAlign: "center",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.85rem",
                                    fontWeight: 600,
                                    color: "#ffd54f",
                                    marginBottom: 8,
                                    textTransform: "uppercase",
                                  }}
                                >
                                  DÓLARES
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "1.4rem",
                                      fontWeight: 900,
                                      color: getColor(dolaresDiff),
                                    }}
                                  >
                                    $ {dolaresDiff.toFixed(2)}
                                  </div>
                                  {tasaDolar > 0 && (
                                    <div
                                      style={{
                                        fontSize: "0.8rem",
                                        fontWeight: 600,
                                        color: "rgba(255,255,255,0.65)",
                                        marginTop: 4,
                                      }}
                                    >
                                      (L{" "}
                                      {Number(
                                        (dolaresDiff * tasaDolar).toFixed(2),
                                      )}
                                      )
                                    </div>
                                  )}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(300px, 1fr))",
                        gap: 20,
                        fontSize: "1.1rem",
                      }}
                    >
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>
                          Efectivo Registrado:
                        </span>
                        <span style={{ fontWeight: 700 }}>
                          {cierre.efectivo_registrado}
                        </span>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>Efectivo Día:</span>
                        <span style={{ fontWeight: 700 }}>
                          {cierre.efectivo_dia}
                        </span>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>
                          Monto Tarjeta Registrado:
                        </span>
                        <span style={{ fontWeight: 700 }}>
                          {cierre.monto_tarjeta_registrado}
                        </span>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>Monto Tarjeta Día:</span>
                        <span style={{ fontWeight: 700 }}>
                          {cierre.monto_tarjeta_dia}
                        </span>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>
                          Transferencias Registradas:
                        </span>
                        <span style={{ fontWeight: 700 }}>
                          {cierre.transferencias_registradas}
                        </span>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>
                          Transferencias Día:
                        </span>
                        <span style={{ fontWeight: 700 }}>
                          {cierre.transferencias_dia}
                        </span>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>
                          Dólares Registrado (USD):
                        </span>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                          }}
                        >
                          <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                            {Number(
                              parseFloat(cierre.dolares_registrado || 0),
                            ).toFixed(2)}
                          </span>
                          {tasaDolar > 0 && (
                            <span
                              style={{
                                fontSize: "0.85rem",
                                color: "rgba(255,255,255,0.75)",
                                marginTop: 4,
                              }}
                            >
                              {`(L ${Number(
                                (
                                  parseFloat(cierre.dolares_registrado || 0) *
                                  tasaDolar
                                ).toFixed(2),
                              )})`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>Dólares Día (USD):</span>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-end",
                          }}
                        >
                          <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                            {Number(
                              parseFloat(cierre.dolares_dia || 0),
                            ).toFixed(2)}
                          </span>
                          {tasaDolar > 0 && (
                            <span
                              style={{
                                fontSize: "0.85rem",
                                color: "rgba(255,255,255,0.75)",
                                marginTop: 4,
                              }}
                            >
                              {`(L ${Number(
                                (
                                  parseFloat(cierre.dolares_dia || 0) *
                                  tasaDolar
                                ).toFixed(2),
                              )})`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                          }}
                        >
                          {(() => {
                            const d = parseFloat(cierre.diferencia || 0);
                            const label =
                              d > 0
                                ? "Diferencia a favor"
                                : d < 0
                                  ? "Diferencia en contra"
                                  : "Diferencia";
                            const labelColor =
                              d > 0 ? "#388e3c" : d < 0 ? "#d32f2f" : "#ffffff";
                            return (
                              <span
                                style={{
                                  opacity: 0.95,
                                  color: labelColor,
                                  fontWeight: 700,
                                }}
                              >
                                {label}
                              </span>
                            );
                          })()}
                          <span
                            style={{
                              fontWeight: 900,
                              color: getColor(
                                parseFloat(cierre.diferencia || 0),
                              ),
                              fontSize: "1.05rem",
                            }}
                          >
                            {Number(parseFloat(cierre.diferencia || 0)).toFixed(
                              2,
                            )}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          padding: 16,
                          borderRadius: 12,
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ opacity: 0.8 }}>Observación:</span>
                        <span style={{ fontWeight: 700 }}>
                          {cierre.observacion || "sin aclarar"}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 16,
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={() => printCierreReport(cierre)}
                        style={{
                          padding: "10px 18px",
                          background: "#1565c0",
                          color: "#fff",
                          border: "none",
                          borderRadius: 10,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        🖨️ Reimprimir cierre
                      </button>
                      <button
                        onClick={() => abrirModalAclaracion(cierre)}
                        disabled={
                          updatingObservacion ||
                          (cierre.observacion || "") === "aclarado"
                        }
                        style={{
                          padding: "10px 18px",
                          background:
                            (cierre.observacion || "") === "aclarado"
                              ? "#9e9e9e"
                              : "#388e3c",
                          color: "#fff",
                          border: "none",
                          borderRadius: 10,
                          fontWeight: 700,
                          cursor: updatingObservacion
                            ? "not-allowed"
                            : "pointer",
                        }}
                      >
                        {(cierre.observacion || "") === "aclarado"
                          ? "Aclarado"
                          : "Aclarar cierre"}
                      </button>
                    </div>
                  </div>
                ))}
          </>
        )}
      </div>

      {/* Modal Referencia de Aclaración */}
      {showModalAclaracion && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={cerrarModalAclaracion}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 32,
              minWidth: 400,
              maxWidth: 500,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
          >
            <h2
              style={{
                margin: "0 0 24px 0",
                color: "#1976d2",
                fontSize: "1.5rem",
                fontWeight: 700,
              }}
            >
              Aclarar Cierre
            </h2>
            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  color: "#333",
                  fontWeight: 600,
                }}
              >
                Referencia del Cierre:
              </label>
              <textarea
                value={referenciaAclaracion}
                onChange={(e) => setReferenciaAclaracion(e.target.value)}
                placeholder="Ej: Se facturó producto fuera de sistema"
                style={{
                  width: "100%",
                  padding: 12,
                  border: "2px solid #ddd",
                  borderRadius: 8,
                  fontSize: "1rem",
                  fontFamily: "inherit",
                  minHeight: 100,
                  resize: "vertical",
                }}
              />
            </div>
            <div
              style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}
            >
              <button
                onClick={cerrarModalAclaracion}
                style={{
                  padding: "10px 20px",
                  background: "#9e9e9e",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={solicitarPassword}
                style={{
                  padding: "10px 20px",
                  background: "#1976d2",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Registrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Contraseña */}
      {showPasswordModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10001,
          }}
          onClick={() => {
            setShowPasswordModal(false);
            setPasswordAclaracion("");
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 32,
              minWidth: 350,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
          >
            <h2
              style={{
                margin: "0 0 24px 0",
                color: "#1976d2",
                fontSize: "1.3rem",
                fontWeight: 700,
              }}
            >
              Confirmar Identidad
            </h2>
            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  color: "#333",
                  fontWeight: 600,
                }}
              >
                Ingrese su contraseña:
              </label>
              <input
                type="password"
                value={passwordAclaracion}
                onChange={(e) => setPasswordAclaracion(e.target.value)}
                onKeyPress={(e) =>
                  e.key === "Enter" && validarPasswordYAclarar()
                }
                style={{
                  width: "100%",
                  padding: 12,
                  border: "2px solid #ddd",
                  borderRadius: 8,
                  fontSize: "1rem",
                  fontFamily: "inherit",
                }}
                autoFocus
              />
            </div>
            <div
              style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}
            >
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordAclaracion("");
                }}
                style={{
                  padding: "10px 20px",
                  background: "#9e9e9e",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={validarPasswordYAclarar}
                disabled={updatingObservacion}
                style={{
                  padding: "10px 20px",
                  background: updatingObservacion ? "#ccc" : "#388e3c",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: updatingObservacion ? "not-allowed" : "pointer",
                }}
              >
                {updatingObservacion ? "Procesando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Error */}
      {showErrorModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10002,
          }}
          onClick={() => setShowErrorModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 32,
              minWidth: 300,
              maxWidth: 400,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: 16 }}>⚠️</div>
            <h3
              style={{
                margin: "0 0 16px 0",
                color: "#d32f2f",
                fontSize: "1.3rem",
              }}
            >
              Error
            </h3>
            <p
              style={{ margin: "0 0 24px 0", color: "#666", fontSize: "1rem" }}
            >
              {errorMessage}
            </p>
            <button
              onClick={() => setShowErrorModal(false)}
              style={{
                padding: "10px 24px",
                background: "#d32f2f",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Modal Éxito */}
      {showSuccessModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10002,
          }}
          onClick={() => setShowSuccessModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 32,
              minWidth: 300,
              maxWidth: 400,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: 16 }}>✅</div>
            <h3
              style={{
                margin: "0 0 16px 0",
                color: "#388e3c",
                fontSize: "1.3rem",
              }}
            >
              Éxito
            </h3>
            <p
              style={{ margin: "0 0 24px 0", color: "#666", fontSize: "1rem" }}
            >
              Cierre aclarado exitosamente
            </p>
            <button
              onClick={() => setShowSuccessModal(false)}
              style={{
                padding: "10px 24px",
                background: "#388e3c",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
