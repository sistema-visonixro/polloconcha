import { useState, useEffect } from "react";
import { useDatosNegocio } from "./useDatosNegocio";
import { loginOffline, upsertBulk, STORE } from "./utils/localDB";

interface LoginProps {
  onLogin: (user: any) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const { datos: datosNegocio } = useDatosNegocio();
  const [codigo, setCodigo] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      // 1. Intentar autenticar desde IndexedDB (offline-first)
      let user = await loginOffline(codigo, clave);

      // 2. Si no está en IDB y hay internet → buscar en Supabase y guardar en IDB
      if (!user && navigator.onLine) {
        const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/usuarios?select=*`;
        const API_KEY = import.meta.env.VITE_SUPABASE_KEY || "";
        try {
          const res = await fetch(API_URL, {
            headers: { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` },
          });
          const users = await res.json();
          if (Array.isArray(users) && users.length > 0) {
            // Guardar todos los usuarios en IDB para próximas sesiones offline
            await upsertBulk(STORE.USUARIOS, users);
            user =
              users.find(
                (u: any) => u.codigo === codigo && u.clave === clave,
              ) ?? null;
          }
        } catch {
          // Sin internet real; continuamos con IDB
        }
      }

      if (user) {
        // Los cajeros ahora van directo a Punto de Ventas, sin verificar apertura/cierre
        setShowSplash(true);
        setTimeout(() => {
          // Guardar id, usuario, rol y caja en localStorage
          localStorage.setItem(
            "usuario",
            JSON.stringify({
              id: user.id,
              usuario: user.nombre,
              nombre: user.nombre,
              email: user.email || "",
              rol: user.rol,
              caja: user.caja,
            }),
          );
          onLogin(user);
          window.location.reload();
        }, 2000);
      } else if (!navigator.onLine) {
        setError(
          "Sin conexión y sin datos locales. Conéctese a internet la primera vez.",
        );
      } else {
        setError("Credenciales incorrectas");
      }
    } catch (err) {
      setError("Error al autenticar");
    }
    setLoading(false);
  };

  // Fondo azul oscuro elegante para la pantalla de login
  const backgroundStyle = `linear-gradient(135deg, #071029 0%, #09243d 50%, #073b5b 100%)`;

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        position: "fixed",
        top: 0,
        left: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: backgroundStyle,
        zIndex: 9999,
      }}
    >
      {showSplash ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: backgroundStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.8)",
              borderRadius: 24,
              padding: 48,
              boxShadow: "0 4px 24px #0002",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
            }}
          >
            {datosNegocio.logo_url ? (
              <img
                src={datosNegocio.logo_url}
                alt="Logo"
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  marginBottom: 16,
                  boxShadow: "0 2px 8px #1976d233",
                  objectFit: "cover",
                }}
              />
            ) : (
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #667eea, #764ba2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "3rem",
                  marginBottom: 16,
                  boxShadow: "0 2px 8px #1976d233",
                }}
              >
                🏪
              </div>
            )}
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "#1976d2",
                marginBottom: 8,
              }}
            >
              Cargando...
            </div>
            <div
              style={{
                width: 60,
                height: 60,
                border: "6px solid #1976d2",
                borderTop: "6px solid #fff",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <form
            onSubmit={handleSubmit}
            style={{
              background: "rgba(255,255,255,0.92)",
              borderRadius: 20,
              boxShadow: "0 8px 32px #1976d244",
              padding: 40,
              minWidth: 320,
              maxWidth: 370,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 18,
              margin: "auto",
              alignItems: "center",
            }}
          >
            <h2
              style={{
                textAlign: "center",
                marginBottom: 16,
                color: "#1976d2",
                fontWeight: 900,
                fontSize: 28,
                letterSpacing: 1,
              }}
            >
              Iniciar sesión
            </h2>
            <input
              type="text"
              placeholder="Código"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
              style={{
                padding: "10px",
                borderRadius: 8,
                border: "1px solid #ccc",
                fontSize: 16,
              }}
            />
            <input
              type="password"
              placeholder="Clave"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              required
              style={{
                padding: "10px",
                borderRadius: 8,
                border: "1px solid #ccc",
                fontSize: 16,
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "14px",
                borderRadius: 8,
                background: "#1976d2",
                color: "#fff",
                fontWeight: "bold",
                fontSize: 18,
                border: "none",
                cursor: "pointer",
                transition: "background 0.2s",
                marginTop: 8,
                textAlign: "center",
                boxShadow: "0 2px 8px #1976d222",
              }}
            >
              {loading ? "Ingresando..." : "Iniciar sesión"}
            </button>
            {error && (
              <p style={{ color: "red", textAlign: "center" }}>{error}</p>
            )}
          </form>
        </div>
      )}

      {/* Componente de versión y actualización */}
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
    </div>
  );
}
