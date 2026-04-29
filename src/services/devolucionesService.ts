// Servicio para manejar devoluciones con almacenamiento offline
import { supabase } from "../supabaseClient";

export interface Devoluciono {
  id?: number;
  factura_id: number;
  numero_factura: string;
  monto: number;
  motivo: string;
  tipo: "TOTAL" | "PARCIAL";
  fecha_hora: string;
  usuario: string;
  estado?: string;
  notas?: string;
  synced?: boolean;
}

const STORE_NAME = "devolucionse";
const DB_NAME = "offlineDB";

// Obtener todas las devoluciones locales
export async function obtenerDevolucionesLocales(): Promise<Devoluciono[]> {
  return new Promise((resolve, reject) => {
    const db = indexedDB.open(DB_NAME);
    db.onsuccess = () => {
      try {
        const tx = db.result
          .transaction([STORE_NAME], "readonly")
          .objectStore(STORE_NAME);
        const req = tx.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (error) {
        resolve([]); // Si no existe el store, retornar vacío
      }
    };
    db.onerror = () => reject(db.error);
  });
}

// Guardar devolución locally
export async function guardarDevolucionLocal(
  devoluciono: Devoluciono,
): Promise<Devoluciono> {
  return new Promise((resolve, reject) => {
    const db = indexedDB.open(DB_NAME);
    db.onsuccess = () => {
      try {
        // Crear store si no existe
        const tx = db.result
          .transaction([STORE_NAME], "readwrite")
          .objectStore(STORE_NAME);
        const req = tx.add(devoluciono);
        req.onsuccess = () =>
          resolve({ ...devoluciono, id: req.result as number });
        req.onerror = () => {
          // Si falla, intentar actualizar
          const updateReq = tx.put(devoluciono);
          updateReq.onsuccess = () => resolve(devoluciono);
          updateReq.onerror = () => reject(updateReq.error);
        };
      } catch (error) {
        reject(error);
      }
    };
    db.onerror = () => reject(db.error);
  });
}

// Registrar devolución (guardar en local y intentar en Supabase)
export async function registrarDevoluciono(
  devoluciono: Devoluciono,
): Promise<{ success: boolean; message: string; data?: Devoluciono }> {
  try {
    // Guardar en IndexedDB primero (offline-first)
    const savedLocal = await guardarDevolucionLocal(devoluciono);

    // Intentar guardar en Supabase
    try {
      const { data, error } = await supabase
        .from("devolucionse")
        .insert([devoluciono])
        .select();

      if (!error && data) {
        // Actualizar el registro local para marcar como sincronizado
        const synced = { ...devoluciono, synced: true, id: data[0]?.id };
        return {
          success: true,
          message: "Devolución registrada correctamente",
          data: synced,
        };
      }
    } catch (supabaseError) {
      console.error("Error al sincronizar con Supabase:", supabaseError);
      // Continuar igual, se sincronizará cuando vuelva la conexión
    }

    return {
      success: true,
      message:
        "Devolución guardada localmente. Se sincronizará cuando tenga conexión.",
      data: savedLocal,
    };
  } catch (error) {
    console.error("Error al registrar devolución:", error);
    return {
      success: false,
      message: "Error al registrar la devolución",
    };
  }
}

// Sincronizar devoluciones locales con Supabase
export async function sincronizarDevolucionesLocales(): Promise<void> {
  try {
    const devolucionesLocales = await obtenerDevolucionesLocales();
    const noSincronizadas = devolucionesLocales.filter((d: any) => !d.synced);

    for (const devoluciono of noSincronizadas) {
      try {
        const { error } = await supabase
          .from("devolucionse")
          .insert([devoluciono]);

        if (!error) {
          // Marcar como sincronizado
          const db = indexedDB.open(DB_NAME);
          db.onsuccess = () => {
            const tx = db.result
              .transaction([STORE_NAME], "readwrite")
              .objectStore(STORE_NAME);
            const updated = { ...devoluciono, synced: true };
            tx.put(updated);
          };
        }
      } catch (error) {
        console.error(
          `Error sincronizando devolución ${devoluciono.id}:`,
          error,
        );
      }
    }
  } catch (error) {
    console.error("Error al sincronizar devoluciones:", error);
  }
}

// Obtener devoluciones de una factura
export async function obtenerDevolucionesPorFactura(
  facturaId: number,
): Promise<Devoluciono[]> {
  try {
    // Intentar obtener de Supabase
    const { data, error } = await supabase
      .from("devolucionse")
      .select("*")
      .eq("factura_id", facturaId);

    if (!error && data) {
      return data as Devoluciono[];
    }
  } catch (error) {
    console.error("Error al obtener devoluciones de Supabase:", error);
  }

  // Fallback: obtener de IndexedDB
  try {
    const todas = await obtenerDevolucionesLocales();
    return todas.filter((d) => d.factura_id === facturaId);
  } catch (error) {
    console.error("Error al obtener devoluciones de IndexedDB:", error);
    return [];
  }
}
