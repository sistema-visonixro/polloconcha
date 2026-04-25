/**
 * Hook personalizado para detectar el estado de conexión a internet
 * Usa tanto navigator.onLine como verificación real a Supabase
 */

import { useState, useEffect, useRef } from "react";

// Variable global para cachear el estado de conexión real
let ultimaVerificacionReal = {
  timestamp: 0,
  conectado: false,
};

const CACHE_DURATION = 2000; // 2 segundos de cache

/**
 * Verifica conexión real haciendo ping al endpoint de Supabase.
 * Solo se llama cuando navigator.onLine es true (para detectar "WiFi sin internet").
 * Si navigator.onLine es false, retorna false inmediatamente.
 */
async function verificarConexionRealConTimeout(): Promise<boolean> {
  // DevTools Offline o cable desconectado pone esto en false directamente
  if (!navigator.onLine) {
    ultimaVerificacionReal = { timestamp: Date.now(), conectado: false };
    return false;
  }

  // navigator.onLine es true — podría ser "conectado al router pero sin internet"
  // Usar cache reciente para no hacer pings excesivos
  const ahora = Date.now();
  if (ahora - ultimaVerificacionReal.timestamp < CACHE_DURATION) {
    return ultimaVerificacionReal.conectado;
  }

  try {
    const supabaseUrl =
      (import.meta as any).env?.VITE_SUPABASE_URL ||
      "https://qxrdbsgktnyhigduhzcw.supabase.co";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    // Timestamp en URL para evitar cache HTTP del navegador
    await fetch(`${supabaseUrl}/rest/v1/?_ts=${ahora}`, {
      method: "HEAD",
      mode: "no-cors",
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);
    ultimaVerificacionReal = { timestamp: ahora, conectado: true };
    return true;
  } catch (_) {
    // Cualquier error (NetworkError, AbortError/timeout) = sin internet real
    ultimaVerificacionReal = { timestamp: Date.now(), conectado: false };
    return false;
  }
}

export function useConexion() {
  // navigator.onLine es false inmediatamente cuando DevTools Offline está activo
  // o cuando se desconecta el cable/WiFi — es la fuente más rápida y confiable
  const [conectado, setConectado] = useState<boolean>(navigator.onLine);
  const [intentandoReconectar, setIntentandoReconectar] =
    useState<boolean>(false);
  const verificacionIntervalRef = useRef<number | null>(null);
  const conectadoRef = useRef<boolean>(navigator.onLine);

  // Mantener ref sincronizada para usarla en el interval sin stale closure
  useEffect(() => {
    conectadoRef.current = conectado;
  }, [conectado]);

  useEffect(() => {
    // Si navigator.onLine es true al montar, verificar que hay internet real
    // (caso: WiFi conectado pero sin internet). Si ya es false, no hacer ping.
    if (navigator.onLine) {
      verificarConexionRealConTimeout().then((real) => {
        if (!real) {
          setConectado(false);
          conectadoRef.current = false;
        }
      });
    }

    function manejarOnline() {
      // navigator.onLine cambió a true — verificar que hay internet real
      verificarConexionRealConTimeout().then((real) => {
        setConectado(real);
        conectadoRef.current = real;
        setIntentandoReconectar(!real);
      });
    }

    function manejarOffline() {
      // navigator.onLine cambió a false — sin internet, sin ping necesario
      setConectado(false);
      conectadoRef.current = false;
      setIntentandoReconectar(true);
      ultimaVerificacionReal = { timestamp: Date.now(), conectado: false };
    }

    window.addEventListener("online", manejarOnline);
    window.addEventListener("offline", manejarOffline);

    // Ping periódico cada 8s solo cuando creemos estar conectados
    // (para detectar pérdida de internet sin que navigator.onLine cambie)
    verificacionIntervalRef.current = window.setInterval(() => {
      if (!navigator.onLine) {
        if (conectadoRef.current) {
          setConectado(false);
          conectadoRef.current = false;
          setIntentandoReconectar(true);
        }
        return;
      }
      verificarConexionRealConTimeout().then((real) => {
        if (real !== conectadoRef.current) {
          setConectado(real);
          conectadoRef.current = real;
          setIntentandoReconectar(!real);
        }
      });
    }, 8000);

    return () => {
      window.removeEventListener("online", manejarOnline);
      window.removeEventListener("offline", manejarOffline);
      if (verificacionIntervalRef.current) {
        clearInterval(verificacionIntervalRef.current);
      }
    };
  }, []); // Sin dependencias: solo corre una vez al montar

  return { conectado, intentandoReconectar };
}

/**
 * Verifica si hay conexión a internet (función standalone)
 * MEJORADO: Ya no solo verifica navigator.onLine, también hace check real
 */
export async function estaConectadoReal(): Promise<boolean> {
  return await verificarConexionRealConTimeout();
}

/**
 * Verifica conexión rápidamente (solo navigator.onLine)
 * Usar solo cuando no importa la precisión
 */
export function verificarConexion(): boolean {
  return navigator.onLine;
}

/**
 * Intenta hacer un ping a Supabase para verificar conexión real
 */
export async function verificarConexionReal(
  supabaseUrl: string,
): Promise<boolean> {
  if (!navigator.onLine) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    await fetch(supabaseUrl, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    return false;
  }
}
