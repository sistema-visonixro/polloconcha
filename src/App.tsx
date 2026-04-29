import { useState, useEffect, useRef } from "react";
import CierresAdminView from "./CierresAdminView";
import Login from "./Login";
import CajaOperadaView from "./CajaOperadaView";
import Landing from "./Landing";
import AdminPanel from "./AdminPanel";
import UsuariosView from "./UsuariosView";
import InventarioView from "./InventarioView";
import MovimientosInventarioView from "./MovimientosInventarioView";
import InventarioMovilView from "./InventarioMovilView";
import PuntoDeVentaView from "./PuntoDeVentaView";
import AperturaView from "./AperturaView";
import { getLocalDayRange } from "./utils/fechas";
import { obtenerCajaCajero } from "./utils/obtenerCajaCajero";
import CaiFacturasView from "./CaiFacturasView";
import GastosView from "./GastosView";
import ResultadosView from "./ResultadosView";
import ResultadosCajaView from "./ResultadosCajaView";
import FacturasEmitidasView from "./FacturasEmitidasView";
import EtiquetasView from "./EtiquetasView";
import ReciboView from "./ReciboView";
import DatosNegocioView from "./DatosNegocioView";
import GananciasNetasView from "./GananciasNetasView";
import CreditosPendientesView from "./CreditosPendientesView";
import ProveedoresCxPView from "./ProveedoresCxPView";
import { useDatosNegocio } from "./useDatosNegocio";
import "./App.css";
import { supabase } from "./supabaseClient";
import {
  inicializarAppOffline,
  procesarColaEscrituras,
  sincronizarTodoDesdeSupabase,
  subirVentasPendientesIDB,
} from "./utils/localDB";
import type { SyncProgress } from "./utils/localDB";

// Asumimos que supabase está disponible globalmente o importado; si no, agrégalo como import
// import { supabase } from './supabase'; // Descomenta y ajusta si es necesario

function App() {
  // Cargar datos del negocio para actualizar título y favicon
  useDatosNegocio();

  // ── Inicialización offline-first ──────────────────────────────────────────
  const [idbReady, setIdbReady] = useState(false);
  const [idbStatus, setIdbStatus] = useState<
    "" | "syncing" | "offline_no_data"
  >("syncing");
  // Modal de sincronización en curso (F5 / focus)
  const [syncingModal, setSyncingModal] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTabla, setSyncTabla] = useState("");
  const syncInProgress = useRef(false);
  const [shouldReloadAfterSync, setShouldReloadAfterSync] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const forceFullAppReload = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("sync_reload", String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.href = `${window.location.pathname}?sync_reload=${Date.now()}${window.location.hash || ""}`;
    }
  };

  // Función reutilizable para sincronizar con progreso visual
  const runSync = async (shouldReload = false) => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;
    setShouldReloadAfterSync(false);
    setSyncingModal(true);
    setSyncProgress(0);
    setSyncTabla("");
    const tablasTotal = 20; // aprox total de tablas
    let idx = 0;
    try {
      // Primero subir ventas offline (id negativo) antes del clearStore del sync
      await subirVentasPendientesIDB().catch(() => {});
      await sincronizarTodoDesdeSupabase((p: SyncProgress) => {
        idx++;
        setSyncTabla(p.tabla);
        setSyncProgress(Math.min(99, Math.round((idx / tablasTotal) * 100)));
      });
      await procesarColaEscrituras();
      setSyncProgress(100);
      await new Promise((r) => setTimeout(r, 700));

      // Si se debe recargar (sincronización manual), hacerlo después de mostrar éxito
      if (shouldReload) {
        setShouldReloadAfterSync(true);
        setSyncTabla("Aplicando cambios...");
        await new Promise((r) => setTimeout(r, 1200));
        forceFullAppReload();
        return;
      }
    } catch (_) {
      /* silencioso */
    } finally {
      setSyncingModal(false);
      setSyncProgress(0);
      setSyncTabla("");
      syncInProgress.current = false;
    }
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const forzarSyncTotal = () => {
      if (!navigator.onLine) {
        alert(
          "⚠️ No hay internet. No se puede forzar la sincronización total.",
        );
        return;
      }
      // Sincronizar y luego recargar la app
      runSync(true);
    };

    (window as any).forzarSincronizacionTotal = forzarSyncTotal;
    window.addEventListener(
      "app:force-full-sync",
      forzarSyncTotal as EventListener,
    );

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      delete (window as any).forzarSincronizacionTotal;
      window.removeEventListener(
        "app:force-full-sync",
        forzarSyncTotal as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    inicializarAppOffline((p) => {
      console.log(`[init] ${p.tabla}: ${p.filas} filas (${p.status})`);
    })
      .then((resultado) => {
        if (resultado === "offline_no_data") {
          setIdbStatus("offline_no_data");
        } else {
          setIdbStatus("");
        }
        setIdbReady(true);
      })
      .catch(() => {
        setIdbReady(true);
        setIdbStatus("");
      });

    // Procesar cola cuando la app tiene foco (por si hubo escrituras offline)
    const handleFocus = () => {
      if (navigator.onLine) {
        runSync();
      } else {
        procesarColaEscrituras().catch(() => {});
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  const [user, setUser] = useState<any>(() => {
    const stored = localStorage.getItem("usuario");
    return stored ? JSON.parse(stored) : null;
  });
  const [showLanding, setShowLanding] = useState(false);
  // Restaurar vista almacenada para mantener la pantalla actual después de recargar
  const initialView = (() => {
    try {
      const v = localStorage.getItem("vista");
      return v as
        | "home"
        | "puntoDeVenta"
        | "admin"
        | "usuarios"
        | "inventario"
        | "movimientosInventario"
        | "movimientosMovil"
        | "cai"
        | "resultados"
        | "gastos"
        | "facturasEmitidas"
        | "apertura"
        | "resultadosCaja"
        | "etiquetas"
        | "recibo"
        | "cajaOperada"
        | "cierreadmin"
        | "datosNegocio"
        | "creditosPendientes"
        | "proveedores"
        | "donacionesMensuales"
        | "impresoras"
        | "configuraciones"
        | "facturacionSAR";
    } catch {
      return undefined;
    }
  })();

  const [view, setView] = useState<
    | "home"
    | "puntoDeVenta"
    | "admin"
    | "usuarios"
    | "inventario"
    | "movimientosInventario"
    | "movimientosMovil"
    | "cai"
    | "resultados"
    | "gastos"
    | "facturasEmitidas"
    | "apertura"
    | "resultadosCaja"
    | "etiquetas"
    | "recibo"
    | "cajaOperada"
    | "cierreadmin"
    | "datosNegocio"
    | "gananciasNetas"
    | "creditosPendientes"
    | "proveedores"
    | "donacionesMensuales"
    | "impresoras"
    | "configuraciones"
    | "facturacionSAR"
  >(initialView || "home");
  const [cajaApertura, setCajaApertura] = useState<string | null>(null);

  // Version checker
  const [appVersion, setAppVersion] = useState<string>("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const res = await fetch("/version.json", { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (canceled) return;
        setAppVersion(String(j.version || ""));
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: any) => {
      setCheckingUpdate(false);
      const d = e?.detail || {};
      if (d.updated) {
        setUpdateMessage(`Actualización disponible: ${d.availableVersion}`);
      } else {
        setUpdateMessage("El sistema está actualizado");
        setTimeout(() => setUpdateMessage(null), 3000);
      }
    };
    window.addEventListener(
      "app:check-update-result",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "app:check-update-result",
        handler as EventListener,
      );
  }, []);

  // Verificar id de usuario en localStorage al cargar la app
  useEffect(() => {
    // Solo ejecutar si no estamos ya en /login
    if (window.location.pathname === "/login") return;
    try {
      const stored = localStorage.getItem("usuario");
      const usuario = stored ? JSON.parse(stored) : null;
      if (!usuario || !usuario.id) {
        localStorage.removeItem("usuario");
        localStorage.removeItem("rol");
        localStorage.removeItem("caja");
        localStorage.removeItem("id");
        window.location.href = "/login";
      }
    } catch {
      localStorage.removeItem("usuario");
      localStorage.removeItem("rol");
      localStorage.removeItem("caja");
      localStorage.removeItem("id");
      window.location.href = "/login";
    }
  }, []);

  // Cuando el usuario inicia sesión, ejecutar el flujo del landing.
  // Si existe una vista almacenada la restauramos; si no, ejecutamos
  // automáticamente la verificación (handleLandingFinish) para avanzar
  // a la vista correcta (apertura/puntoDeVenta/etc.).
  useEffect(() => {
    if (user) {
      const stored = localStorage.getItem("vista");
      // Restaurar vista almacenada sin ejecutar verificaciones automáticas
      // Esto permite que el cajero navegue libremente sin ser redirigido
      if (stored) {
        setShowLanding(false);
        // view ya fue inicializado desde localStorage
      } else {
        // Solo en primer login (sin vista guardada) ejecutar landing
        // Ejecutar automáticamente la lógica que normalmente corre al
        // terminar el landing. Esto evita que, al recargar, el cajero
        // quede atrapado en la pantalla de bienvenida.
        (async () => {
          try {
            await handleLandingFinish();
          } catch (e) {
            // En caso de error, mostrar landing para que el usuario pueda
            // interactuar manualmente.
            setShowLanding(true);
            console.error(
              "Error al ejecutar flujo de landing automáticamente:",
              e,
            );
          }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Cuando termina el landing, mostrar la vista según el rol y lógica de caja
  const handleLandingFinish = async () => {
    setShowLanding(false);

    if (!user) return;

    // Obtener caja del cajero
    const caja = await obtenerCajaCajero(user.id);
    setCajaApertura(caja);

    if (user.rol === "cajero") {
      // Lógica para cajeros: verificar cierres con diferencias sin aclarar
      const { start, end } = getLocalDayRange();
      const { data: cierresHoy, error } = await supabase
        .from("cierres")
        .select("diferencia, observacion, estado")
        .eq("cajero_id", user.id)
        .eq("caja", caja)
        .eq("estado", "CIERRE")
        .gte("fecha", start)
        .lte("fecha", end);

      if (error) {
        console.error("Error al verificar cierres:", error);
        setView("puntoDeVenta");
        return;
      }

      // Solo redirigir a resultadosCaja si hay diferencia sin aclarar
      if (cierresHoy && cierresHoy.length > 0) {
        const cierre = cierresHoy[0];
        if (cierre.diferencia !== 0 && cierre.observacion === "sin aclarar") {
          setView("resultadosCaja");
        } else {
          // Si ya hizo cierre (con o sin diferencia aclarada), ir a punto de ventas
          setView("puntoDeVenta");
        }
      } else {
        // No hay cierre, ir a punto de ventas (donde verificará apertura)
        setView("puntoDeVenta");
      }
    } else if (user.rol === "Admin") {
      setView("admin");
    } else if (user.rol === "inventario") {
      // Detectar si es dispositivo móvil
      const isMobile = window.innerWidth < 768 || "ontouchstart" in window;
      if (isMobile) {
        setView("movimientosMovil");
      } else {
        setView("movimientosInventario");
      }
    } else {
      setView("home");
    }
  };

  // Guardar usuario en localStorage al iniciar sesión
  const handleLogin = (usuario: any) => {
    // Al iniciar sesión, limpiar cualquier 'vista' previa almacenada para
    // que el usuario vea el landing y se ejecute la verificación de apertura.
    try {
      localStorage.removeItem("vista");
    } catch {}
    setUser(usuario);
    localStorage.setItem("usuario", JSON.stringify(usuario));
  };

  // Limpiar usuario al cerrar sesión
  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("usuario");
    setView("home");
    // limpiar vista almacenada para la próxima sesión
    localStorage.removeItem("vista");
    window.location.href = "/login"; // Opcional: redirigir explícitamente
  };

  // Persistir la vista actual para restaurarla al recargar
  useEffect(() => {
    try {
      localStorage.setItem("vista", view);
    } catch {}
  }, [view]);

  // Render condicional
  // Pantalla de inicialización (primer arranque con IDB vacío)
  if (!idbReady) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg,#071029 0%,#09243d 50%,#073b5b 100%)",
          color: "#fff",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 48 }}>🥩</div>
        <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          Inicializando sistema...
        </p>
        <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>
          Sincronizando datos locales
        </p>
        <div
          style={{
            width: 40,
            height: 40,
            border: "4px solid #fff3",
            borderTop: "4px solid #fff",
            borderRadius: "50%",
            animation: "spin 0.9s linear infinite",
          }}
        />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (idbStatus === "offline_no_data") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg,#071029 0%,#09243d 50%,#073b5b 100%)",
          color: "#fff",
          gap: 16,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 48 }}>📡</div>
        <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          Sin conexión a internet
        </p>
        <p style={{ fontSize: 14, opacity: 0.75, maxWidth: 320 }}>
          Es la primera vez que abre la app en este dispositivo.
          <br />
          Conéctese a internet para descargar los datos iniciales.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 12,
            padding: "10px 28px",
            borderRadius: 8,
            border: "none",
            background: "#1976d2",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  if (showLanding) {
    return <Landing onFinish={handleLandingFinish} />;
  }

  const handleForzarSincronizacionTotal = () => {
    if (!isOnline) {
      alert("⚠️ No hay internet. No se puede sincronizar toda la base.");
      return;
    }
    runSync(true);
  };

  // Componente de versión para todas las vistas
  const VersionComponent = () => (
    <>
      {appVersion && (
        <div
          style={{
            position: "fixed",
            bottom: 10,
            left: 18,
            color: "#43a047",
            fontSize: 12,
            fontWeight: 700,
            zIndex: 12000,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span>Versión: {appVersion}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={handleForzarSincronizacionTotal}
              disabled={syncingModal || !isOnline}
              style={{
                background: "transparent",
                border: "none",
                color: syncingModal || !isOnline ? "#94a3b8" : "#0284c7",
                fontSize: 12,
                textDecoration: "underline",
                cursor: syncingModal || !isOnline ? "not-allowed" : "pointer",
                padding: 0,
              }}
              title={
                !isOnline
                  ? "Sin internet: no se puede sincronizar"
                  : "Sincronizar toda la base de datos"
              }
            >
              {syncingModal ? "Sincronizando..." : "Sincronizar todo"}
            </button>
            <button
              onClick={() => {
                setCheckingUpdate(true);
                setUpdateMessage(null);
                window.dispatchEvent(new CustomEvent("app:check-update"));
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "#2e7d32",
                fontSize: 12,
                textDecoration: "underline",
                cursor: "pointer",
                padding: 0,
              }}
              title="Buscar actualización ahora"
            >
              Buscar actualización
            </button>
            {checkingUpdate && (
              <div
                style={{
                  width: 14,
                  height: 14,
                  border: "2px solid rgba(46,125,50,0.2)",
                  borderTop: "2px solid #2e7d32",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
            )}
          </div>
          {updateMessage && (
            <span
              style={{
                fontSize: 11,
                color: updateMessage.includes("disponible")
                  ? "#d32f2f"
                  : "#2e7d32",
                fontStyle: "italic",
              }}
            >
              {updateMessage}
            </span>
          )}
        </div>
      )}
    </>
  );

  // Vistas comunes
  if (view === "resultadosCaja") {
    return (
      <>
        <ResultadosCajaView />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "cajaOperada") {
    return (
      <>
        <CajaOperadaView onCerrarSesion={handleLogout} />
        <VersionComponent />
      </>
    );
  }

  if (view === "admin") {
    return (
      <>
        <AdminPanel onSelect={setView} user={user} />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "etiquetas" && user?.rol === "Admin") {
    return (
      <>
        <EtiquetasView onBack={() => setView("admin")} />
        <VersionComponent />
      </>
    );
  }

  if (view === "recibo" && user?.rol === "Admin") {
    return (
      <>
        <ReciboView onBack={() => setView("admin")} />
        <VersionComponent />
      </>
    );
  }

  if (view === "datosNegocio" && user?.rol === "Admin") {
    return (
      <>
        <DatosNegocioView onBack={() => setView("admin")} />
        <VersionComponent />
      </>
    );
  }

  if (view === "usuarios" && user?.rol === "Admin") {
    return (
      <>
        <UsuariosView onBack={() => setView("admin")} />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "inventario" && user?.rol === "Admin") {
    return (
      <>
        <InventarioView onBack={() => setView("admin")} />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (
    view === "movimientosInventario" &&
    (user?.rol === "Admin" || user?.rol === "inventario")
  ) {
    return (
      <>
        <MovimientosInventarioView
          onBack={() => setView(user?.rol === "Admin" ? "admin" : "home")}
          onLogout={user?.rol === "inventario" ? handleLogout : undefined}
        />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "movimientosMovil" && user?.rol === "inventario") {
    return (
      <>
        <InventarioMovilView onLogout={handleLogout} />
        <VersionComponent />
      </>
    );
  }

  if (view === "cai" && user?.rol === "Admin") {
    return (
      <>
        <CaiFacturasView onBack={() => setView("admin")} />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "gastos" && user?.rol === "Admin") {
    return (
      <>
        <GastosView onBack={() => setView("admin")} />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "resultados" && user?.rol === "Admin") {
    return (
      <>
        <ResultadosView
          onBack={() => setView("admin")}
          onVerFacturasEmitidas={() => setView("facturasEmitidas")}
          onVerGastos={() => setView("gastos")}
        />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "facturasEmitidas" && user?.rol === "Admin") {
    return (
      <>
        <FacturasEmitidasView onBack={() => setView("resultados")} />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "apertura" && user?.rol === "cajero") {
    return (
      <>
        <AperturaView
          usuarioActual={user}
          caja={cajaApertura}
          onAperturaGuardada={() => setView("puntoDeVenta")}
        />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "puntoDeVenta" && user?.rol === "cajero") {
    return (
      <>
        <PuntoDeVentaView setView={setView} />
        <VersionComponent />
        <div style={{ textAlign: "center", marginTop: 20 }}></div>
      </>
    );
  }

  if (view === "cierreadmin" && user?.rol === "Admin") {
    return (
      <>
        <CierresAdminView onVolver={() => setView("admin")} />
        <VersionComponent />
      </>
    );
  }

  if (view === "gananciasNetas" && user?.rol === "Admin") {
    return (
      <>
        <GananciasNetasView onBack={() => setView("admin")} />
        <VersionComponent />
      </>
    );
  }

  if (view === "creditosPendientes" && user?.rol === "Admin") {
    return (
      <>
        <CreditosPendientesView onBack={() => setView("admin")} />
        <VersionComponent />
      </>
    );
  }

  if (view === "proveedores" && user?.rol === "Admin") {
    return (
      <>
        <ProveedoresCxPView onBack={() => setView("admin")} />
        <VersionComponent />
      </>
    );
  }

  // Vista por defecto (home) - puedes agregar un componente Home si existe
  return (
    <>
      {/* Modal de sincronización en progreso (F5 / reconexión) */}
      {syncingModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#0d1b2a",
              color: "#fff",
              borderRadius: 16,
              padding: "36px 40px",
              minWidth: 320,
              textAlign: "center",
              boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            }}
          >
            {shouldReloadAfterSync ? (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <p
                  style={{ fontWeight: 700, fontSize: 18, margin: "0 0 12px" }}
                >
                  ¡Actualización completada!
                </p>
                <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 12px" }}>
                  Recargando la aplicación...
                </p>
              </>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🔄</div>
                <p style={{ fontWeight: 700, fontSize: 18, margin: "0 0 6px" }}>
                  Actualizando datos locales
                </p>
                <p
                  style={{
                    fontSize: 12,
                    opacity: 0.6,
                    margin: "0 0 18px",
                    minHeight: 18,
                  }}
                >
                  {syncTabla ? `Tabla: ${syncTabla}` : "Preparando..."}
                </p>
                {/* Barra de progreso */}
                <div
                  style={{
                    background: "#1e3a5f",
                    borderRadius: 8,
                    height: 12,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: 8,
                      background: "linear-gradient(90deg,#1976d2,#42a5f5)",
                      width: `${syncProgress}%`,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <p style={{ marginTop: 10, fontSize: 15, fontWeight: 700 }}>
                  {syncProgress}%
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ textAlign: "center", marginTop: 40 }}>
        <p
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#1976d2",
            marginBottom: 18,
          }}
        >
          Bienvenido, {user?.nombre}.
        </p>
      </div>

      <VersionComponent />
    </>
  );
}

export default App;
