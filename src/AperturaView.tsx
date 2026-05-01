import { useState } from "react";
import FondoImagen from "./FondoImagen";
import { supabase } from "./supabaseClient";
import { getLocalDayRange, formatToHondurasLocal } from "./utils/fechas";
import {
  obtenerAperturaLocalStorage,
  guardarAperturaLocalStorage,
} from "./utils/offlineSync";
import {
  sincronizarAlApertura,
  upsertOne,
  STORE,
  getAperturaActiva,
} from "./utils/localDB";

interface AperturaViewProps {
  usuarioActual: { id: string; nombre: string } | null;
  caja: string | null;
  onAperturaGuardada?: () => void;
}

export default function AperturaView({
  usuarioActual,
  caja,
  onAperturaGuardada,
}: AperturaViewProps) {
  const [showModal, setShowModal] = useState(false);
  const [fondoFijo, setFondoFijo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navegarAlPOS = () => {
    if (onAperturaGuardada) {
      onAperturaGuardada();
    } else {
      window.location.href = "/punto-de-venta";
    }
  };

  const registrarApertura = async () => {
    try {
      setLoading(true);
      setError("");
      if (!caja || caja === "" || caja === null || caja === undefined) {
        setError("No tienes caja asiganda. Contacte al administrador.");
        setLoading(false);
        return;
      }

      // ── Capa 1: localStorage (sin red, instantáneo) ──────────────────────
      const aperturaLS = obtenerAperturaLocalStorage();
      if (aperturaLS && aperturaLS.cajero_id === usuarioActual?.id) {
        console.log("✓ Apertura activa en localStorage → no se duplica");
        navegarAlPOS();
        setLoading(false);
        return;
      }

      // ── Capa 2: IDB (funciona offline) ───────────────────────────────────
      const aperturaIdb = await getAperturaActiva(usuarioActual?.id ?? "");
      if (aperturaIdb) {
        console.log("✓ Apertura activa en IDB → no se duplica");
        guardarAperturaLocalStorage({
          id: aperturaIdb.id?.toString() ?? "",
          cajero_id: aperturaIdb.cajero_id ?? usuarioActual?.id ?? "",
          caja: aperturaIdb.caja ?? caja,
          fecha: aperturaIdb.fecha ?? "",
          fecha_apertura: aperturaIdb.fecha_apertura ?? aperturaIdb.fecha ?? "",
          estado: "APERTURA",
        });
        setLoading(false);
        navegarAlPOS();
        return;
      }

      // ── Datos de la apertura ──────────────────────────────────────────────
      const aperturaData = {
        tipo_registro: "apertura",
        cajero: usuarioActual?.nombre,
        cajero_id: usuarioActual?.id,
        caja,
        fecha: formatToHondurasLocal(),
        fecha_apertura: formatToHondurasLocal(),
        fondo_fijo_registrado: parseFloat(fondoFijo) || 0,
        fondo_fijo: 0,
        efectivo_registrado: 0,
        efectivo_dia: 0,
        monto_tarjeta_registrado: 0,
        monto_tarjeta_dia: 0,
        transferencias_registradas: 0,
        transferencias_dia: 0,
        diferencia: 0,
        estado: "APERTURA",
      };

      // ── Detectar si está online ───────────────────────────────────────────
      const isOnline = navigator.onLine;

      if (!isOnline) {
        // Sin internet: guardar en IDB con id temporal negativo
        const tempId = -Date.now();
        await upsertOne(STORE.CIERRES, { ...aperturaData, id: tempId });
        guardarAperturaLocalStorage({
          id: String(tempId),
          cajero_id: usuarioActual?.id ?? "",
          caja: caja ?? "",
          fecha: aperturaData.fecha,
          fecha_apertura: aperturaData.fecha_apertura,
          estado: "APERTURA",
        });
        console.log("✓ Apertura guardada en IDB (offline)");
        setLoading(false);
        navegarAlPOS();
        return;
      }

      // ── Online: verificar Supabase ────────────────────────────────────────
      const { start, end } = getLocalDayRange();
      const { data: aperturas, error: queryErr } = await supabase
        .from("cierres")
        .select("*")
        .eq("tipo_registro", "apertura")
        .eq("cajero", usuarioActual?.nombre)
        .eq("caja", caja)
        .gte("fecha", start)
        .lte("fecha", end);
      if (queryErr) {
        // Si falla la consulta, guardar offline en IDB igualmente
        console.warn(
          "[Apertura] Supabase query error, guardando offline:",
          queryErr,
        );
        const tempId = -Date.now();
        await upsertOne(STORE.CIERRES, { ...aperturaData, id: tempId });
        guardarAperturaLocalStorage({
          id: String(tempId),
          cajero_id: usuarioActual?.id ?? "",
          caja: caja ?? "",
          fecha: aperturaData.fecha,
          fecha_apertura: aperturaData.fecha_apertura,
          estado: "APERTURA",
        });
        setLoading(false);
        navegarAlPOS();
        return;
      }
      if (aperturas && aperturas.length > 0) {
        // Sincronizar apertura encontrada en Supabase a IDB
        const ap = aperturas[0];
        await upsertOne(STORE.CIERRES, {
          id: ap.id,
          cajero_id: ap.cajero_id ?? usuarioActual?.id,
          caja: ap.caja ?? caja,
          fecha: ap.fecha,
          fecha_apertura: ap.fecha_apertura ?? ap.fecha,
          estado: "APERTURA",
          tipo_registro: "apertura",
        });
        guardarAperturaLocalStorage({
          id: ap.id?.toString() ?? "",
          cajero_id: ap.cajero_id ?? usuarioActual?.id ?? "",
          caja: ap.caja ?? caja,
          fecha: ap.fecha ?? "",
          fecha_apertura: ap.fecha_apertura ?? ap.fecha ?? "",
          estado: "APERTURA",
        });
        setLoading(false);
        navegarAlPOS();
        return;
      }
      // Registrar apertura (incluimos fecha en hora local de Honduras)
      const { data: insertada, error: insertError } = await supabase
        .from("cierres")
        .insert([aperturaData])
        .select();
      setLoading(false);
      if (insertError) {
        console.error("Error insertando apertura:", insertError);
        // Si el error es por constraint único (duplicado en BD), igual redirigir
        if (insertError.code === "23505") {
          console.log(
            "⚠ Constraint único: apertura ya existe en BD → redirigiendo",
          );
          navegarAlPOS();
          return;
        }
        setError(insertError.message || "Error al registrar apertura");
      } else {
        // Guardar en localStorage para prevenir futuros duplicados
        if (insertada && insertada.length > 0) {
          const ap = insertada[0];
          // Guardar en localStorage (acceso rápido síncrono)
          guardarAperturaLocalStorage({
            id: ap.id?.toString() ?? "",
            cajero_id: ap.cajero_id ?? usuarioActual?.id ?? "",
            caja: ap.caja ?? caja,
            fecha: ap.fecha ?? "",
            fecha_apertura: ap.fecha_apertura ?? ap.fecha ?? "",
            estado: ap.estado ?? "APERTURA",
          });
          // Guardar en STORE.CIERRES (IDB — fuente de verdad offline)
          upsertOne(STORE.CIERRES, {
            id: ap.id,
            cajero_id: ap.cajero_id ?? usuarioActual?.id,
            caja: ap.caja ?? caja,
            fecha: ap.fecha,
            fecha_apertura: ap.fecha_apertura ?? ap.fecha,
            estado: "APERTURA",
            tipo_registro: "apertura",
          }).catch((e) => console.warn("[AperturaView] IDB upsert error:", e));
          // Sincronizar toda la BD a IndexedDB en segundo plano
          const cajeroIdSync = ap.cajero_id ?? usuarioActual?.id ?? "";
          const aperturaIdSync = ap.id;
          if (cajeroIdSync && aperturaIdSync) {
            sincronizarAlApertura(cajeroIdSync, aperturaIdSync).catch((err) =>
              console.warn("[AperturaView] sync background error:", err),
            );
          }
        }
        navegarAlPOS();
      }
    } catch (e: any) {
      console.error("Excepción en registrarApertura:", e);
      setError(e?.message || String(e));
      setLoading(false);
    }
  };

  return (
    <FondoImagen>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          width: "100vw",
        }}
      >
        <button
          style={{
            fontSize: 28,
            padding: "24px 48px",
            borderRadius: 16,
            background: "#1976d2",
            color: "#fff",
            fontWeight: 700,
            border: "none",
            boxShadow: "0 2px 12px #1976d222",
            cursor: "pointer",
            marginBottom: 32,
          }}
          onClick={() => setShowModal(true)}
        >
          Registrar Apertura
        </button>
        <button
          style={{
            fontSize: 18,
            padding: "12px 32px",
            borderRadius: 12,
            background: "#c62828",
            color: "#fff",
            fontWeight: 700,
            border: "none",
            boxShadow: "0 2px 8px #c6282822",
            cursor: "pointer",
            marginBottom: 16,
          }}
          onClick={() => {
            localStorage.clear();
            window.location.href = "/login";
          }}
        >
          Cerrar sesión
        </button>
        {showModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              background: "rgba(0,0,0,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 16,
                boxShadow: "0 8px 32px #1976d222",
                padding: 32,
                minWidth: 350,
              }}
            >
              <h2 style={{ color: "#1976d2", marginBottom: 18 }}>
                Fondo Fijo de Caja
              </h2>
              <input
                type="number"
                value={fondoFijo}
                onChange={(e) => setFondoFijo(e.target.value)}
                placeholder="Ingrese fondo fijo"
                style={{
                  padding: "12px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 18,
                  marginBottom: 18,
                  width: "100%",
                }}
              />
              <div
                style={{ display: "flex", gap: 16, justifyContent: "center" }}
              >
                <button
                  onClick={registrarApertura}
                  disabled={loading || !fondoFijo}
                  style={{
                    background: "#1976d2",
                    color: "#fff",
                    borderRadius: 8,
                    border: "none",
                    padding: "10px 32px",
                    fontWeight: 700,
                    fontSize: 18,
                    cursor: "pointer",
                  }}
                >
                  Registrar
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    background: "#d32f2f",
                    color: "#fff",
                    borderRadius: 8,
                    border: "none",
                    padding: "10px 32px",
                    fontWeight: 700,
                    fontSize: 18,
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>
              </div>
              {error && (
                <div style={{ color: "red", marginTop: 12 }}>{error}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </FondoImagen>
  );
}
