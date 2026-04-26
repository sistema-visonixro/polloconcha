/**
 * Sistema de sincronización offline usando IndexedDB
 * Almacena facturas y pagos localmente y los sincroniza con Supabase automáticamente
 */

import { supabase } from "../supabaseClient";
import { upsertOne, getAll, deleteById, STORE } from "./localDB";

// Nombre de la base de datos
const DB_NAME = "PuntoVentaOfflineDB";
const DB_VERSION = 8; // v8: cache CAI separado por cajero + tipo_comprobante

// Nombres de las tablas (stores)
const FACTURAS_STORE = "facturas_pendientes";
const PAGOS_STORE = "pagos_pendientes";
const PAGOSF_STORE = "pagosf_pendientes"; // ← pagosf (abonos crédito)
const VENTAS_STORE = "ventas_pendientes"; // ← nueva: fusiona factura + pago
const GASTOS_STORE = "gastos_pendientes";
const ENVIOS_STORE = "envios_pendientes";
const PRODUCTOS_STORE = "productos_cache"; // Cache de productos
const APERTURA_STORE = "apertura_cache"; // Cache de apertura de caja
const CAI_STORE = "cai_cache"; // Cache de información CAI (key = cajero_id + tipo)
const DATOS_NEGOCIO_STORE = "datos_negocio_cache"; // Cache de datos del negocio

// Tipos
export interface FacturaPendiente {
  id?: number;
  /** UUID único por operación — previene duplicados al sincronizar */
  operation_id?: string;
  fecha_hora: string;
  cajero: string;
  cajero_id: string | null;
  caja: string;
  cai: string;
  factura: string;
  cliente: string;
  tipo_orden?: string; // "PARA LLEVAR" | "COMER AQUÍ" | "DELIVERY"
  productos: string; // JSON con complementos y piezas incluidos
  sub_total: string;
  isv_15: string;
  isv_18: string;
  descuento?: number | null;
  total: string;
  /** Estado de sincronización: pending | syncing | synced | error */
  sync_status?: "pending" | "syncing" | "synced" | "error";
  timestamp: number;
  intentos: number;
}

export interface PagoPendiente {
  id?: number;
  /** UUID único por registro de pago — previene pagos duplicados al sincronizar */
  operation_id?: string;
  tipo: string;
  monto: number;
  banco: string | null;
  tarjeta: string | null;
  factura: string | null;
  autorizador: string | null;
  referencia: string | null;
  usd_monto: number | null;
  fecha_hora: string;
  cajero: string;
  cajero_id: string | null;
  cliente: string;
  factura_venta: string;
  recibido: number;
  cambio: number;
  timestamp: number;
  intentos: number;
}

/** Venta completa: combina datos de factura + datos de pago para la tabla ventas. */
export interface VentaPendiente {
  id?: number;
  /** UUID único por operación — previene duplicados al sincronizar */
  operation_id?: string;
  fecha_hora: string;
  cajero: string;
  cajero_id: string | null;
  caja: string;
  cai: string;
  factura: string;
  tipo: string; // CONTADO | CREDITO | DEVOLUCION
  cliente: string;
  tipo_orden?: string;
  productos: string; // JSON
  sub_total: string;
  isv_15: string;
  isv_18: string;
  descuento?: number | null;
  total: string;
  es_donacion?: boolean | null;
  // Campos de pago
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  dolares: number;
  dolares_usd: number;
  delivery: number;
  total_recibido: number;
  cambio: number;
  banco?: string | null;
  tarjeta_num?: string | null;
  autorizacion?: string | null;
  ref_transferencia?: string | null;
  /** Estado de sincronización */
  sync_status?: "pending" | "syncing" | "synced" | "error";
  timestamp: number;
  intentos: number;
}

/** Fila plana de pagos — una sola fila por número de factura.
 * Reemplaza a PagoPendiente para escribir en la tabla pagosf. */
export interface PagoFPendiente {
  id?: number;
  factura: string; // UNIQUE — número de factura de la venta
  efectivo: number;
  tarjeta: number;
  transferencia: number;
  dolares: number; // en Lempiras
  dolares_usd: number; // en USD
  delivery: number; // costo de envío
  total_recibido: number;
  cambio: number;
  banco?: string | null;
  tarjeta_num?: string | null;
  autorizacion?: string | null;
  ref_transferencia?: string | null;
  cajero?: string | null;
  cajero_id?: string | null; // UUID del cajero como texto
  cliente?: string | null;
  facturas_id?: number | null; // ID de la fila en tabla facturas
  fecha_hora: string;
  timestamp: number;
  intentos: number;
}

export interface GastoPendiente {
  id?: number;
  tipo: string;
  monto: number;
  descripcion: string;
  cajero: string;
  cajero_id: string | null;
  caja: string;
  fecha_hora: string;
  timestamp: number;
  intentos: number;
}

export interface EnvioPendiente {
  id?: number;
  cliente: string;
  telefono: string;
  direccion: string;
  productos: any[];
  total: number;
  costo_envio: number;
  tipo_pago: string;
  cajero: string;
  cajero_id: string | null;
  caja: string;
  factura_venta: string | null;
  fecha_hora: string;
  timestamp: number;
  intentos: number;
}

export interface ProductoCache {
  id: string;
  nombre: string;
  precio: number;
  tipo: string;
  complementos?: string;
  piezas?: string;
  subcategoria?: string;
  imagen_url?: string;
  activo: boolean;
  timestamp: number;
}

export interface AperturaCache {
  id: string;
  cajero_id: string;
  cajero?: string; // nombre del cajero (necesario para sync offline)
  caja: string;
  fecha: string;
  estado: string;
  pending_sync?: boolean; // true = creada offline, pendiente de subir a Supabase
  timestamp: number;
}

export type TipoComprobanteFiscal = "FACTURA" | "RECIBO";

export interface CaiCache {
  cache_key: string;
  id: string;
  cajero_id: string;
  tipo_comprobante: TipoComprobanteFiscal;
  caja_asignada: string;
  cai: string;
  factura_desde: string;
  factura_hasta: string;
  factura_actual: string;
  nombre_cajero: string;
  timestamp: number;
}

export interface DatosNegocioCache {
  id: string;
  nombre_negocio: string;
  rtn: string;
  direccion: string;
  celular: string;
  propietario: string;
  logo_url: string | null;
  timestamp: number;
}

// Variable global para la conexión DB
let db: IDBDatabase | null = null;

function buildCaiCacheKey(
  cajeroId: string,
  tipoComprobante: TipoComprobanteFiscal,
): string {
  return `${cajeroId}::${tipoComprobante}`;
}

/**
 * Inicializa la base de datos IndexedDB
 */
export async function initIndexedDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Error al abrir IndexedDB:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log("IndexedDB inicializada correctamente");
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Crear store para facturas pendientes
      if (!database.objectStoreNames.contains(FACTURAS_STORE)) {
        const facturasStore = database.createObjectStore(FACTURAS_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        facturasStore.createIndex("timestamp", "timestamp", { unique: false });
        facturasStore.createIndex("factura", "factura", { unique: false });
        console.log("Store de facturas creado");
      }

      // Crear store para pagos pendientes
      if (!database.objectStoreNames.contains(PAGOS_STORE)) {
        const pagosStore = database.createObjectStore(PAGOS_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        pagosStore.createIndex("timestamp", "timestamp", { unique: false });
        pagosStore.createIndex("factura_venta", "factura_venta", {
          unique: false,
        });
        console.log("Store de pagos creado");
      }

      // Crear store para gastos pendientes
      if (!database.objectStoreNames.contains(GASTOS_STORE)) {
        const gastosStore = database.createObjectStore(GASTOS_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        gastosStore.createIndex("timestamp", "timestamp", { unique: false });
        console.log("Store de gastos creado");
      }

      // Crear store para envíos pendientes
      if (!database.objectStoreNames.contains(ENVIOS_STORE)) {
        const enviosStore = database.createObjectStore(ENVIOS_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        enviosStore.createIndex("timestamp", "timestamp", { unique: false });
        console.log("Store de envíos creado");
      }

      // Crear store para cache de productos
      if (!database.objectStoreNames.contains(PRODUCTOS_STORE)) {
        const productosStore = database.createObjectStore(PRODUCTOS_STORE, {
          keyPath: "id",
        });
        productosStore.createIndex("tipo", "tipo", { unique: false });
        productosStore.createIndex("activo", "activo", { unique: false });
        console.log("Store de productos cache creado");
      }

      // Crear store para cache de apertura de caja
      if (!database.objectStoreNames.contains(APERTURA_STORE)) {
        const aperturaStore = database.createObjectStore(APERTURA_STORE, {
          keyPath: "id",
        });
        aperturaStore.createIndex("cajero_id", "cajero_id", { unique: false });
        aperturaStore.createIndex("fecha", "fecha", { unique: false });
        console.log("Store de apertura cache creado");
      }

      // ── Cache de CAI (v8: keyPath = cajero_id + tipo_comprobante)
      // Recrear si existe con un esquema anterior.
      if (database.objectStoreNames.contains(CAI_STORE)) {
        try {
          // Intentar leer la keyPath; si no es cache_key, eliminar y recrear.
          const oldStore = (
            event.target as IDBOpenDBRequest
          ).transaction!.objectStore(CAI_STORE);
          if (oldStore.keyPath !== "cache_key") {
            database.deleteObjectStore(CAI_STORE);
          }
        } catch {
          /* ignorar */
        }
      }
      if (!database.objectStoreNames.contains(CAI_STORE)) {
        const caiStore = database.createObjectStore(CAI_STORE, {
          keyPath: "cache_key",
        });
        caiStore.createIndex("cajero_id", "cajero_id", { unique: false });
        caiStore.createIndex("tipo_comprobante", "tipo_comprobante", {
          unique: false,
        });
        console.log("Store de CAI cache creado (v8, por cajero + tipo)");
      }

      // Crear store para cache de datos del negocio
      if (!database.objectStoreNames.contains(DATOS_NEGOCIO_STORE)) {
        database.createObjectStore(DATOS_NEGOCIO_STORE, {
          keyPath: "id",
        });
        console.log("Store de datos del negocio cache creado");
      }

      // Crear store para pagosf pendientes (abonos de crédito)
      if (!database.objectStoreNames.contains(PAGOSF_STORE)) {
        const pagosfStore = database.createObjectStore(PAGOSF_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        pagosfStore.createIndex("timestamp", "timestamp", { unique: false });
        pagosfStore.createIndex("factura", "factura", { unique: false });
        console.log("Store pagosf_pendientes creado");
      }

      // ── NUEVO: ventas_pendientes (fusión factura + pago para tabla ventas) ──
      if (!database.objectStoreNames.contains(VENTAS_STORE)) {
        const ventasStore = database.createObjectStore(VENTAS_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        ventasStore.createIndex("timestamp", "timestamp", { unique: false });
        ventasStore.createIndex("factura", "factura", { unique: false });
        ventasStore.createIndex("operation_id", "operation_id", {
          unique: false,
        });
        console.log("Store ventas_pendientes creado");
      }
    };
  });
}

/**
 * Guarda una factura en IndexedDB
 */
export async function guardarFacturaLocal(
  factura: Omit<FacturaPendiente, "id" | "timestamp" | "intentos">,
): Promise<number> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FACTURAS_STORE], "readwrite");
    const store = transaction.objectStore(FACTURAS_STORE);

    const facturaConMetadata: Omit<FacturaPendiente, "id"> = {
      ...factura,
      timestamp: Date.now(),
      intentos: 0,
    };

    const request = store.add(facturaConMetadata);

    request.onsuccess = () => {
      console.log("Factura guardada en IndexedDB:", request.result);
      resolve(request.result as number);
    };

    request.onerror = () => {
      console.error("Error guardando factura en IndexedDB:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Actualiza factura_venta en todos los pagos de IndexedDB que coincidan
 * con el número antiguo y el cajero. Se llama cada vez que se auto-corrige
 * un número de factura para mantener consistencia.
 * @returns cantidad de registros actualizados
 */
export async function actualizarFacturaVentaEnPagosLocales(
  oldFactura: string,
  newFactura: string,
  cajeroId: string,
): Promise<number> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([PAGOS_STORE], "readwrite");
    const store = transaction.objectStore(PAGOS_STORE);
    const request = store.getAll();
    let actualizados = 0;

    request.onsuccess = () => {
      const pagos = request.result as PagoPendiente[];
      const pendientes = pagos.filter(
        (p) =>
          p.factura_venta === oldFactura &&
          (p.cajero_id === cajeroId || !cajeroId),
      );

      if (pendientes.length === 0) {
        resolve(0);
        return;
      }

      let procesados = 0;
      for (const pago of pendientes) {
        const pagoActualizado = { ...pago, factura_venta: newFactura };
        const putReq = store.put(pagoActualizado);
        putReq.onsuccess = () => {
          actualizados++;
          procesados++;
          if (procesados === pendientes.length) {
            console.log(
              `[sync] ${actualizados} pagos en IndexedDB actualizados: factura_venta ${oldFactura} → ${newFactura}`,
            );
            resolve(actualizados);
          }
        };
        putReq.onerror = () => {
          procesados++;
          if (procesados === pendientes.length) resolve(actualizados);
        };
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda pagos en IndexedDB
 */
export async function guardarPagosLocal(
  pagos: Omit<PagoPendiente, "id" | "timestamp" | "intentos">[],
): Promise<number[]> {
  const database = await initIndexedDB();
  const ids: number[] = [];

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([PAGOS_STORE], "readwrite");
    const store = transaction.objectStore(PAGOS_STORE);

    let completados = 0;
    const total = pagos.length;

    pagos.forEach((pago) => {
      const pagoConMetadata: Omit<PagoPendiente, "id"> = {
        ...pago,
        timestamp: Date.now(),
        intentos: 0,
      };

      const request = store.add(pagoConMetadata);

      request.onsuccess = () => {
        ids.push(request.result as number);
        completados++;
        if (completados === total) {
          console.log(`${total} pagos guardados en IndexedDB`);
          resolve(ids);
        }
      };

      request.onerror = () => {
        console.error("Error guardando pago en IndexedDB:", request.error);
        reject(request.error);
      };
    });
  });
}

/**
 * Obtiene todas las facturas pendientes de sincronización
 */
export async function obtenerFacturasPendientes(): Promise<FacturaPendiente[]> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FACTURAS_STORE], "readonly");
    const store = transaction.objectStore(FACTURAS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as FacturaPendiente[]);
    };

    request.onerror = () => {
      console.error("Error obteniendo facturas pendientes:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Obtiene todos los pagos pendientes de sincronización
 */
export async function obtenerPagosPendientes(): Promise<PagoPendiente[]> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([PAGOS_STORE], "readonly");
    const store = transaction.objectStore(PAGOS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as PagoPendiente[]);
    };

    request.onerror = () => {
      console.error("Error obteniendo pagos pendientes:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Elimina una factura de IndexedDB después de sincronizarla
 */
export async function eliminarFacturaLocal(id: number): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FACTURAS_STORE], "readwrite");
    const store = transaction.objectStore(FACTURAS_STORE);
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log(`Factura ${id} eliminada de IndexedDB`);
      resolve();
    };

    request.onerror = () => {
      console.error("Error eliminando factura de IndexedDB:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Elimina un pago de IndexedDB después de sincronizarlo
 */
export async function eliminarPagoLocal(id: number): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([PAGOS_STORE], "readwrite");
    const store = transaction.objectStore(PAGOS_STORE);
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log(`Pago ${id} eliminado de IndexedDB`);
      resolve();
    };

    request.onerror = () => {
      console.error("Error eliminando pago de IndexedDB:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Incrementa el contador de intentos de una factura
 */
async function incrementarIntentosFactura(id: number): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([FACTURAS_STORE], "readwrite");
    const store = transaction.objectStore(FACTURAS_STORE);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const factura = getRequest.result as FacturaPendiente;
      if (factura) {
        factura.intentos = (factura.intentos || 0) + 1;
        const updateRequest = store.put(factura);

        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = () => reject(updateRequest.error);
      } else {
        resolve();
      }
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Incrementa el contador de intentos de un pago
 */
async function incrementarIntentosPago(id: number): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([PAGOS_STORE], "readwrite");
    const store = transaction.objectStore(PAGOS_STORE);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const pago = getRequest.result as PagoPendiente;
      if (pago) {
        pago.intentos = (pago.intentos || 0) + 1;
        const updateRequest = store.put(pago);

        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = () => reject(updateRequest.error);
      } else {
        resolve();
      }
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Sincroniza las facturas pendientes con Supabase
 */
export async function sincronizarFacturas(): Promise<{
  exitosas: number;
  fallidas: number;
}> {
  const facturasPendientes = await obtenerFacturasPendientes();

  if (facturasPendientes.length === 0) {
    return { exitosas: 0, fallidas: 0 };
  }

  console.log(
    `Sincronizando ${facturasPendientes.length} facturas pendientes...`,
  );

  let exitosas = 0;
  let fallidas = 0;

  for (const factura of facturasPendientes) {
    try {
      // Preparar datos para insertar (sin campos de IndexedDB)
      const { id, timestamp, intentos, sync_status, ...facturaData } = factura;

      const { error } = await supabase.from("facturas").upsert([facturaData], {
        onConflict: "operation_id",
        ignoreDuplicates: true,
      });

      if (error) {
        if (error.code === "23505") {
          // Verificar si nuestro propio operation_id ya está en Supabase
          const { data: existe } = await supabase
            .from("facturas")
            .select("id")
            .eq("operation_id", factura.operation_id ?? "")
            .maybeSingle();

          if (existe) {
            // Misma operación → ya guardada, borrar de IndexedDB
            console.warn(
              `⚠ [sync] Factura ${factura.factura} ya existe (mismo operation_id). Eliminando de IndexedDB.`,
            );
            await eliminarFacturaLocal(factura.id!);
            exitosas++;
          } else {
            // Número tomado por otra operación → auto-corregir usando el
            // último número real en la tabla facturas.
            try {
              const { data: maxRow } = await supabase
                .from("facturas")
                .select("factura")
                .eq("cajero_id", factura.cajero_id)
                .order("id", { ascending: false })
                .limit(1)
                .maybeSingle();
              const maxNum = maxRow
                ? parseInt(maxRow.factura)
                : parseInt(factura.factura);
              const nuevoNumero = (maxNum + 1).toString();
              const siguienteNum = (maxNum + 2).toString();
              console.warn(
                `⚠ [sync] Número ${factura.factura} tomado. Auto-corrigiendo → ${nuevoNumero}`,
              );
              const facturaCorregida = { ...facturaData, factura: nuevoNumero };
              const { error: retryError } = await supabase
                .from("facturas")
                .upsert([facturaCorregida], {
                  onConflict: "operation_id",
                  ignoreDuplicates: false,
                });
              if (!retryError) {
                // 1. Actualizar contador en Supabase
                await supabase
                  .from("cai_facturas")
                  .update({ factura_actual: siguienteNum })
                  .eq("cajero_id", factura.cajero_id)
                  .eq("tipo_comprobante", "RECIBO");

                // 2. Corregir factura_venta en pagos ya en Supabase
                //    (pueden haberse sincronizado antes que la factura)
                const { data: pagosActualizados } = await supabase
                  .from("pagos")
                  .update({ factura_venta: nuevoNumero })
                  .eq("factura_venta", factura.factura)
                  .eq("cajero_id", factura.cajero_id)
                  .select("id");
                if ((pagosActualizados?.length ?? 0) > 0) {
                  console.log(
                    `[sync] ${pagosActualizados!.length} pagos en Supabase: factura_venta ${factura.factura} → ${nuevoNumero}`,
                  );
                }

                // 3. Corregir factura_venta en pagos aún en IndexedDB
                await actualizarFacturaVentaEnPagosLocales(
                  factura.factura,
                  nuevoNumero,
                  factura.cajero_id || "",
                );

                await eliminarFacturaLocal(factura.id!);
                console.log(
                  `✓ [sync] Factura corregida: ${factura.factura} → ${nuevoNumero}. Próxima: ${siguienteNum}`,
                );
                exitosas++;
              } else {
                console.error(
                  `[sync] Reintento con número corregido también falló:`,
                  retryError,
                );
                await incrementarIntentosFactura(factura.id!);
                fallidas++;
              }
            } catch (corrErr) {
              console.error(
                "[sync] Error al auto-corregir número de factura:",
                corrErr,
              );
              await incrementarIntentosFactura(factura.id!);
              fallidas++;
            }
          }
        } else {
          console.error(
            `Error sincronizando factura ${factura.factura}:`,
            error,
          );
          await incrementarIntentosFactura(factura.id!);
          fallidas++;
          if (intentos >= 5) {
            console.error(
              `Factura ${factura.factura} ha fallado ${intentos} veces`,
            );
          }
        }
      } else {
        console.log(`Factura ${factura.factura} sincronizada exitosamente`);
        await eliminarFacturaLocal(factura.id!);
        exitosas++;
      }
    } catch (error) {
      console.error(`Error sincronizando factura ${factura.factura}:`, error);
      await incrementarIntentosFactura(factura.id!);
      fallidas++;
    }
  }

  return { exitosas, fallidas };
}

/**
 * Sincroniza los pagos pendientes con Supabase
 */
export async function sincronizarPagos(): Promise<{
  exitosos: number;
  fallidos: number;
}> {
  const pagosPendientes = await obtenerPagosPendientes();

  if (pagosPendientes.length === 0) {
    return { exitosos: 0, fallidos: 0 };
  }

  console.log(`Sincronizando ${pagosPendientes.length} pagos pendientes...`);

  let exitosos = 0;
  let fallidos = 0;

  for (const pago of pagosPendientes) {
    try {
      // Preparar datos para insertar (sin campos de IndexedDB)
      const { id, timestamp, intentos, ...pagoData } = pago;

      const { error } = await supabase.from("pagos").upsert([pagoData], {
        onConflict: "operation_id",
        ignoreDuplicates: true,
      });

      if (error) {
        // Código 23505 = violación de UNIQUE: registro duplicado
        if (error.code === "23505") {
          console.warn(
            `⚠ Pago ${id} ya existe en Supabase (duplicate). Eliminando de IndexedDB.`,
          );
          await eliminarPagoLocal(pago.id!);
          exitosos++;
        } else {
          console.error(`Error sincronizando pago ${id}:`, error);
          await incrementarIntentosPago(pago.id!);
          fallidos++;
          if (intentos >= 5) {
            console.error(`Pago ${id} ha fallado ${intentos} veces`);
          }
        }
      } else {
        console.log(`Pago ${id} sincronizado exitosamente`);
        await eliminarPagoLocal(pago.id!);
        exitosos++;
      }
    } catch (error) {
      console.error(`Error sincronizando pago ${pago.id}:`, error);
      await incrementarIntentosPago(pago.id!);
      fallidos++;
    }
  }

  return { exitosos, fallidos };
}

/**
 * Guarda un gasto en IndexedDB
 */
export async function guardarGastoLocal(
  gasto: Omit<GastoPendiente, "id" | "timestamp" | "intentos">,
): Promise<number> {
  const database = await initIndexedDB();

  const localId = await new Promise<number>((resolve, reject) => {
    const transaction = database.transaction([GASTOS_STORE], "readwrite");
    const store = transaction.objectStore(GASTOS_STORE);

    const gastoConMetadata: Omit<GastoPendiente, "id"> = {
      ...gasto,
      timestamp: Date.now(),
      intentos: 0,
    };

    const request = store.add(gastoConMetadata);

    request.onsuccess = () => {
      console.log("Gasto guardado en IndexedDB:", request.result);
      resolve(request.result as number);
    };

    request.onerror = () => {
      console.error("Error guardando gasto en IndexedDB:", request.error);
      reject(request.error);
    };
  });

  // Guardar también en STORE.GASTOS (fuente primaria para resumen/historial offline)
  try {
    const tempId =
      typeof (gasto as any).id === "number"
        ? (gasto as any).id
        : -Math.abs(localId);
    await upsertOne(STORE.GASTOS, { ...gasto, id: tempId });
  } catch (e) {
    console.error("[offlineSync] No se pudo guardar gasto en STORE.GASTOS:", e);
  }

  return localId;
}

/**
 * Obtiene todos los gastos pendientes
 */
export async function obtenerGastosPendientes(): Promise<GastoPendiente[]> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([GASTOS_STORE], "readonly");
    const store = transaction.objectStore(GASTOS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as GastoPendiente[]);
    };

    request.onerror = () => {
      console.error("Error obteniendo gastos pendientes:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Elimina un gasto de IndexedDB
 */
export async function eliminarGastoLocal(id: number): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([GASTOS_STORE], "readwrite");
    const store = transaction.objectStore(GASTOS_STORE);
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log(`Gasto ${id} eliminado de IndexedDB`);
      resolve();
    };

    request.onerror = () => {
      console.error("Error eliminando gasto de IndexedDB:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Incrementa el contador de intentos de un gasto
 */
async function incrementarIntentosGasto(id: number): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([GASTOS_STORE], "readwrite");
    const store = transaction.objectStore(GASTOS_STORE);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const gasto = getRequest.result as GastoPendiente;
      if (gasto) {
        gasto.intentos = (gasto.intentos || 0) + 1;
        const updateRequest = store.put(gasto);

        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = () => reject(updateRequest.error);
      } else {
        resolve();
      }
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Sincroniza los gastos pendientes con Supabase
 */
export async function sincronizarGastos(): Promise<{
  exitosos: number;
  fallidos: number;
}> {
  const gastosPendientes = await obtenerGastosPendientes();

  if (gastosPendientes.length === 0) {
    return { exitosos: 0, fallidos: 0 };
  }

  console.log(`Sincronizando ${gastosPendientes.length} gastos pendientes...`);

  let exitosos = 0;
  let fallidos = 0;

  for (const gasto of gastosPendientes) {
    try {
      const { id, intentos } = gasto;

      // Extraer fecha de fecha_hora para el campo fecha
      const fechaHora = gasto.fecha_hora;
      const fecha = fechaHora
        ? fechaHora.split("T")[0]
        : new Date().toISOString().split("T")[0];

      // Transformar campos de IndexedDB a formato Supabase
      const gastoParaSupabase = {
        fecha: fecha,
        fecha_hora: fechaHora,
        monto: gasto.monto,
        motivo: gasto.tipo || gasto.descripcion || "", // Usar tipo o descripcion como motivo
        cajero_id: gasto.cajero_id,
        caja: gasto.caja,
      };

      console.log(`🔄 Sincronizando gasto ${id}:`, gastoParaSupabase);

      // Verificar si ya existe en Supabase para evitar duplicados
      const { data: existente } = await supabase
        .from("gastos")
        .select("id")
        .eq("fecha_hora", gastoParaSupabase.fecha_hora)
        .eq("monto", gastoParaSupabase.monto)
        .eq("cajero_id", gastoParaSupabase.cajero_id)
        .maybeSingle();

      if (existente) {
        console.log(
          `⚠ Gasto ${id} ya existe en Supabase, eliminando de IndexedDB`,
        );
        await eliminarGastoLocal(gasto.id!);
        exitosos++;
        continue;
      }

      const { error } = await supabase
        .from("gastos")
        .insert([gastoParaSupabase]);

      if (error) {
        console.error(`Error sincronizando gasto ${id}:`, error);
        await incrementarIntentosGasto(gasto.id!);
        fallidos++;

        if (intentos >= 5) {
          console.error(`Gasto ${id} ha fallado ${intentos} veces`);
        }
      } else {
        console.log(`✓ Gasto ${id} sincronizado exitosamente`);
        await eliminarGastoLocal(gasto.id!);
        exitosos++;
      }
    } catch (error) {
      console.error(`Error sincronizando gasto ${gasto.id}:`, error);
      await incrementarIntentosGasto(gasto.id!);
      fallidos++;
    }
  }

  return { exitosos, fallidos };
}

/**
 * Guarda un envío en IndexedDB
 */
export async function guardarEnvioLocal(
  envio: Omit<EnvioPendiente, "id" | "timestamp" | "intentos">,
): Promise<number> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ENVIOS_STORE], "readwrite");
    const store = transaction.objectStore(ENVIOS_STORE);

    const envioConMetadata: Omit<EnvioPendiente, "id"> = {
      ...envio,
      timestamp: Date.now(),
      intentos: 0,
    };

    const request = store.add(envioConMetadata);

    request.onsuccess = () => {
      console.log("Envío guardado en IndexedDB:", request.result);
      resolve(request.result as number);
    };

    request.onerror = () => {
      console.error("Error guardando envío en IndexedDB:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Obtiene todos los envíos pendientes
 */
export async function obtenerEnviosPendientes(): Promise<EnvioPendiente[]> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ENVIOS_STORE], "readonly");
    const store = transaction.objectStore(ENVIOS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as EnvioPendiente[]);
    };

    request.onerror = () => {
      console.error("Error obteniendo envíos pendientes:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Elimina un envío de IndexedDB
 */
export async function eliminarEnvioLocal(id: number): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ENVIOS_STORE], "readwrite");
    const store = transaction.objectStore(ENVIOS_STORE);
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log(`Envío ${id} eliminado de IndexedDB`);
      resolve();
    };

    request.onerror = () => {
      console.error("Error eliminando envío de IndexedDB:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Incrementa el contador de intentos de un envío
 */
async function incrementarIntentosEnvio(id: number): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([ENVIOS_STORE], "readwrite");
    const store = transaction.objectStore(ENVIOS_STORE);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const envio = getRequest.result as EnvioPendiente;
      if (envio) {
        envio.intentos = (envio.intentos || 0) + 1;
        const updateRequest = store.put(envio);

        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = () => reject(updateRequest.error);
      } else {
        resolve();
      }
    };

    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Sincroniza los envíos pendientes con Supabase
 */
export async function sincronizarEnvios(): Promise<{
  exitosos: number;
  fallidos: number;
}> {
  const enviosPendientes = await obtenerEnviosPendientes();

  if (enviosPendientes.length === 0) {
    return { exitosos: 0, fallidos: 0 };
  }

  console.log(`Sincronizando ${enviosPendientes.length} envíos pendientes...`);

  let exitosos = 0;
  let fallidos = 0;

  for (const envio of enviosPendientes) {
    try {
      const { id, intentos } = envio;

      const envioData = {
        productos: envio.productos,
        cajero_id: envio.cajero_id,
        caja: envio.caja,
        fecha: envio.fecha_hora,
        cliente: envio.cliente,
        celular: envio.telefono,
        total: envio.total,
        costo_envio: envio.costo_envio,
        tipo_pago: envio.tipo_pago,
      };

      // Verificar si ya existe en Supabase para evitar duplicados
      const { data: existente } = await supabase
        .from("pedidos_envio")
        .select("id")
        .eq("fecha", envioData.fecha)
        .eq("total", envioData.total)
        .eq("cajero_id", envioData.cajero_id)
        .eq("cliente", envioData.cliente)
        .maybeSingle();

      if (existente) {
        console.log(
          `⚠ Envío ${id} ya existe en Supabase, eliminando de IndexedDB`,
        );
        await eliminarEnvioLocal(envio.id!);
        exitosos++;
        continue;
      }

      const { error } = await supabase
        .from("pedidos_envio")
        .insert([envioData]);

      if (error) {
        console.error(`Error sincronizando envío ${id}:`, error);
        await incrementarIntentosEnvio(envio.id!);
        fallidos++;

        if (intentos >= 5) {
          console.error(`Envío ${id} ha fallado ${intentos} veces`);
        }
      } else {
        console.log(`Envío ${id} sincronizado exitosamente`);
        await eliminarEnvioLocal(envio.id!);
        exitosos++;
      }
    } catch (error) {
      console.error(`Error sincronizando envío ${envio.id}:`, error);
      await incrementarIntentosEnvio(envio.id!);
      fallidos++;
    }
  }

  return { exitosos, fallidos };
}

/**
 * Mutex para evitar sincronizaciones concurrentes que dupliquen registros.
 * Si sincronizarTodo ya está corriendo (ej: evento "online" + setInterval
 * al mismo tiempo), la segunda llamada sale inmediatamente.
 */
let _isSyncing = false;

export async function obtenerCierresPendientesSync(): Promise<any[]> {
  try {
    const cierres = await getAll<any>(STORE.CIERRES);
    return cierres.filter(
      (c) =>
        (c?.estado === "CIERRE" || c?.tipo_registro === "cierre") &&
        c?.pending_sync === true,
    );
  } catch (e) {
    console.error("[cierres] Error obteniendo cierres pendientes:", e);
    return [];
  }
}

export async function obtenerAperturasPendientesSync(): Promise<any[]> {
  try {
    const todos = await getAll<any>(STORE.CIERRES);
    return todos.filter(
      (c) =>
        c?.estado === "APERTURA" &&
        // Es pendiente si tiene la bandera O si su id es negativo (offline no subido)
        (c?.pending_sync === true || (typeof c.id === "number" && c.id < 0)),
    );
  } catch (e) {
    console.error("[aperturas] Error obteniendo aperturas pendientes:", e);
    return [];
  }
}

export async function sincronizarAperturasPendientes(): Promise<{
  exitosos: number;
  fallidos: number;
}> {
  const pendientes = await obtenerAperturasPendientesSync();
  if (pendientes.length === 0) return { exitosos: 0, fallidos: 0 };

  let exitosos = 0;
  let fallidos = 0;

  for (const apertura of pendientes) {
    const payload = {
      tipo_registro: "apertura",
      cajero: apertura.cajero ?? "",
      cajero_id: apertura.cajero_id ?? null,
      caja: apertura.caja ?? "",
      fecha: apertura.fecha,
      fondo_fijo_registrado: Number(apertura.fondo_fijo_registrado ?? 0),
      fondo_fijo: Number(apertura.fondo_fijo ?? 0),
      efectivo_registrado: Number(apertura.efectivo_registrado ?? 0),
      efectivo_dia: Number(apertura.efectivo_dia ?? 0),
      monto_tarjeta_registrado: Number(apertura.monto_tarjeta_registrado ?? 0),
      monto_tarjeta_dia: Number(apertura.monto_tarjeta_dia ?? 0),
      transferencias_registradas: Number(apertura.transferencias_registradas ?? 0),
      transferencias_dia: Number(apertura.transferencias_dia ?? 0),
      dolares_registrado: Number(apertura.dolares_registrado ?? 0),
      dolares_dia: Number(apertura.dolares_dia ?? 0),
      diferencia: Number(apertura.diferencia ?? 0),
      observacion: apertura.observacion ?? "",
      estado: "APERTURA",
    };

    try {
      // Apertura offline → siempre insertar (id negativo o string)
      const { data: insData, error: insErr } = await supabase
        .from("cierres")
        .insert([payload])
        .select("id")
        .single();

      if (insErr) throw insErr;
      const syncedId = insData?.id;
      if (!syncedId) throw new Error("No se obtuvo id de apertura insertada");

      // Borrar el registro temporal con id negativo/string y guardar con id real
      try { await deleteById(STORE.CIERRES, apertura.id); } catch { /* ignore */ }
      await upsertOne(STORE.CIERRES, {
        ...apertura,
        id: syncedId,
        tipo_registro: "apertura",
        estado: "APERTURA",
        pending_sync: false,
      });

      console.log(`[aperturas] Apertura sincronizada OK (id Supabase: ${syncedId})`);
      exitosos++;
    } catch (error) {
      console.error("[aperturas] Error sincronizando apertura pendiente:", error);
      fallidos++;
    }
  }

  return { exitosos, fallidos };
}

export async function sincronizarCierresPendientes(): Promise<{
  exitosos: number;
  fallidos: number;
}> {
  const pendientes = await obtenerCierresPendientesSync();
  if (pendientes.length === 0) return { exitosos: 0, fallidos: 0 };

  let exitosos = 0;
  let fallidos = 0;

  for (const cierre of pendientes) {
    const payload = {
      tipo_registro: "cierre",
      cajero: cierre.cajero ?? "",
      cajero_id: cierre.cajero_id ?? null,
      caja: cierre.caja ?? "",
      fecha: cierre.fecha,
      fondo_fijo_registrado: Number(cierre.fondo_fijo_registrado ?? 0),
      fondo_fijo: Number(cierre.fondo_fijo ?? 0),
      efectivo_registrado: Number(cierre.efectivo_registrado ?? 0),
      efectivo_dia: Number(cierre.efectivo_dia ?? 0),
      monto_tarjeta_registrado: Number(cierre.monto_tarjeta_registrado ?? 0),
      monto_tarjeta_dia: Number(cierre.monto_tarjeta_dia ?? 0),
      transferencias_registradas: Number(cierre.transferencias_registradas ?? 0),
      transferencias_dia: Number(cierre.transferencias_dia ?? 0),
      dolares_registrado: Number(cierre.dolares_registrado ?? 0),
      dolares_dia: Number(cierre.dolares_dia ?? 0),
      diferencia: Number(cierre.diferencia ?? 0),
      observacion: cierre.observacion ?? "",
      estado: "CIERRE",
    };

    try {
      const cierreId = Number(cierre.id);
      let syncedId: number | null = null;

      if (Number.isFinite(cierreId) && cierreId > 0) {
        const { data: updData, error: updErr } = await supabase
          .from("cierres")
          .update(payload)
          .eq("id", cierreId)
          .select("id")
          .maybeSingle();

        if (updErr) throw updErr;
        syncedId = updData?.id ?? null;
      }

      if (!syncedId) {
        const { data: insData, error: insErr } = await supabase
          .from("cierres")
          .insert([payload])
          .select("id")
          .single();

        if (insErr) throw insErr;
        syncedId = insData?.id ?? null;
      }

      if (!syncedId) throw new Error("No se obtuvo id sincronizado de cierre");

      const cierreLimpio = {
        ...cierre,
        id: syncedId,
        tipo_registro: "cierre",
        estado: "CIERRE",
        pending_sync: false,
      };

      if (Number(cierre.id) !== syncedId) {
        try {
          await deleteById(STORE.CIERRES, cierre.id);
        } catch {
          /* ignore */
        }
      }

      await upsertOne(STORE.CIERRES, cierreLimpio);
      exitosos++;
    } catch (error) {
      console.error("[cierres] Error sincronizando cierre pendiente:", error);
      fallidos++;
    }
  }

  return { exitosos, fallidos };
}

/**
 * Sincroniza todos los datos pendientes (facturas, pagos, gastos y envíos)
 */
export async function sincronizarTodo(): Promise<{
  facturas: { exitosas: number; fallidas: number };
  pagos: { exitosos: number; fallidos: number };
  gastos: { exitosos: number; fallidos: number };
  envios: { exitosos: number; fallidos: number };
}> {
  // Guard: si ya hay una sincronización en curso, salir sin hacer nada
  if (_isSyncing) {
    console.log(
      "[sync] Sincronización ya en curso, saltando llamada concurrente.",
    );
    return {
      facturas: { exitosas: 0, fallidas: 0 },
      pagos: { exitosos: 0, fallidos: 0 },
      gastos: { exitosos: 0, fallidos: 0 },
      envios: { exitosos: 0, fallidos: 0 },
    };
  }

  _isSyncing = true;
  console.log("[sync] Iniciando sincronización completa...");

  try {
    const facturas = await sincronizarFacturas(); // legado (facturas antiguas)
    const pagos = await sincronizarPagos(); // legado
    await sincronizarPagosF(); // abonos crédito
    const ventasResult = await sincronizarVentas(); // nueva tabla ventas
    const aperturasResult = await sincronizarAperturasPendientes();
    const cierresResult = await sincronizarCierresPendientes();
    const gastos = await sincronizarGastos();
    const envios = await sincronizarEnvios();

    console.log(
      `[sync] Completa: ${facturas.exitosas} facturas (legado), ${pagos.exitosos} pagos (legado), ` +
        `${ventasResult.exitosas} ventas, ${aperturasResult.exitosos} aperturas, ${cierresResult.exitosos} cierres, ${gastos.exitosos} gastos, ${envios.exitosos} envíos.`,

    );

    return { facturas, pagos, gastos, envios };
  } finally {
    _isSyncing = false;
  }
}

/**
 * Obtiene el conteo de registros pendientes
 */
export async function obtenerContadorPendientes(): Promise<{
  facturas: number;
  pagos: number;
  gastos: number;
  envios: number;
  ventas: number;
  cierres: number;
}> {
  const facturas = await obtenerFacturasPendientes();
  const pagos = await obtenerPagosPendientes();
  const gastos = await obtenerGastosPendientes();
  const envios = await obtenerEnviosPendientes();
  const ventas = await obtenerVentasPendientes();
  const cierres = await obtenerCierresPendientesSync();
  const aperturas = await obtenerAperturasPendientesSync();

  return {
    facturas: facturas.length,
    pagos: pagos.length,
    gastos: gastos.length,
    envios: envios.length,
    ventas: ventas.length,
    cierres: cierres.length + aperturas.length,
  };
}

/**
 * Configura la sincronización automática cuando se detecta conexión
 */
export function configurarSincronizacionAutomatica(): void {
  // Sincronizar cada 30 segundos si hay conexión
  setInterval(async () => {
    if (navigator.onLine) {
      const pendientes = await obtenerContadorPendientes();
      const total =
        pendientes.facturas +
        pendientes.pagos +
        pendientes.gastos +
        pendientes.envios +
        pendientes.ventas +
        pendientes.cierres;
      if (total > 0) {
        console.log("Sincronización automática iniciada...");
        await sincronizarTodo();
      }
    }
  }, 30000); // 30 segundos

  // Sincronizar cuando se recupere la conexión
  window.addEventListener("online", async () => {
    console.log("Conexión restaurada. Sincronizando datos pendientes...");
    const resultado = await sincronizarTodo();

    const totalSincronizados =
      resultado.facturas.exitosas +
      resultado.pagos.exitosos +
      resultado.gastos.exitosos +
      resultado.envios.exitosos;

    if (totalSincronizados > 0) {
      console.log(
        `✓ ${resultado.facturas.exitosas} facturas, ${resultado.pagos.exitosos} pagos, ${resultado.gastos.exitosos} gastos y ${resultado.envios.exitosos} envíos sincronizados exitosamente`,
      );
    }
  });

  // Notificar cuando se pierde la conexión
  window.addEventListener("offline", () => {
    console.warn(
      "⚠ Conexión perdida. Los datos se guardarán localmente y se sincronizarán cuando se restaure la conexión.",
    );
  });
}

/**
 * Guarda productos en cache para uso offline
 */
export async function guardarProductosCache(productos: any[]): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([PRODUCTOS_STORE], "readwrite");
    const store = transaction.objectStore(PRODUCTOS_STORE);

    // Limpiar cache anterior
    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      let completados = 0;
      const total = productos.length;

      if (total === 0) {
        resolve();
        return;
      }

      productos.forEach((producto) => {
        const productoCache: ProductoCache = {
          ...producto,
          timestamp: Date.now(),
        };

        const addRequest = store.add(productoCache);

        addRequest.onsuccess = () => {
          completados++;
          if (completados === total) {
            console.log(`${total} productos guardados en cache`);
            resolve();
          }
        };

        addRequest.onerror = () => {
          console.error("Error guardando producto en cache:", addRequest.error);
          reject(addRequest.error);
        };
      });
    };

    clearRequest.onerror = () => {
      console.error("Error limpiando cache de productos:", clearRequest.error);
      reject(clearRequest.error);
    };
  });
}

/**
 * Obtiene productos desde el cache
 */
export async function obtenerProductosCache(): Promise<ProductoCache[]> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([PRODUCTOS_STORE], "readonly");
    const store = transaction.objectStore(PRODUCTOS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as ProductoCache[]);
    };

    request.onerror = () => {
      console.error("Error obteniendo productos desde cache:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Verifica si hay productos en cache
 */
export async function hayProductosEnCache(): Promise<boolean> {
  try {
    const productos = await obtenerProductosCache();
    return productos.length > 0;
  } catch (error) {
    console.error("Error verificando cache de productos:", error);
    return false;
  }
}

/**
 * Verifica si la aplicación está conectada a internet
 */
/**
 * Verifica si hay conexión a internet (sincrónico, solo navigator.onLine)
 * Para verificación real, usar estaConectadoReal() del hook useConexion
 */
export function estaConectado(): boolean {
  return navigator.onLine;
}

/**
 * Verifica conexión real a internet (asincrónico, con timeout)
 */
export async function estaConectadoReal(): Promise<boolean> {
  if (!navigator.onLine) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    // Usar Google como endpoint confiable con mode: no-cors
    await fetch("https://www.google.com/favicon.ico", {
      method: "GET",
      mode: "no-cors",
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Actualiza el cache de productos desde Supabase
 */
export async function actualizarCacheProductos(): Promise<{
  exitoso: boolean;
  mensaje: string;
  cantidad: number;
}> {
  if (!estaConectado()) {
    return {
      exitoso: false,
      mensaje: "No hay conexión a internet",
      cantidad: 0,
    };
  }

  try {
    let { data: productos, error } = await supabase
      .from("productos")
      .select("*")
      .eq("activo", true)
      .order("nombre");

    // Compatibilidad: algunos esquemas no tienen columna "activo"
    if (error && (error as any)?.code === "42703") {
      const fallback = await supabase.from("productos").select("*").order("nombre");
      productos = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error("Error cargando productos desde Supabase:", error);
      return {
        exitoso: false,
        mensaje: "Error al cargar productos",
        cantidad: 0,
      };
    }

    await guardarProductosCache(productos || []);

    // Pre-cargar imágenes de productos para que el Service Worker las cachee
    await precargarImagenesProductos(productos || []);

    return {
      exitoso: true,
      mensaje: `${productos?.length || 0} productos actualizados`,
      cantidad: productos?.length || 0,
    };
  } catch (error) {
    console.error("Error actualizando cache de productos:", error);
    return {
      exitoso: false,
      mensaje: "Error al actualizar cache",
      cantidad: 0,
    };
  }
}

/**
 * Pre-carga las imágenes de los productos para que el Service Worker las cachee
 */
export async function precargarImagenesProductos(
  productos: any[],
): Promise<void> {
  console.log("🖼️ Iniciando pre-carga de imágenes de productos...");
  let cargadas = 0;
  let fallidas = 0;

  for (const producto of productos) {
    if (producto.imagen && producto.imagen.trim() !== "") {
      try {
        // Hacer fetch de la imagen para que el Service Worker la cachee
        const response = await fetch(producto.imagen);
        if (response.ok) {
          // Leer el blob para asegurar que se descargue completamente
          await response.blob();
          cargadas++;
        } else {
          fallidas++;
        }
      } catch (error) {
        console.warn(`⚠️ Error pre-cargando imagen ${producto.nombre}:`, error);
        fallidas++;
      }
    }
  }

  console.log(
    `✓ Pre-carga de imágenes completada: ${cargadas} exitosas, ${fallidas} fallidas`,
  );
}

// ─── Helpers de localStorage para apertura (capa rápida, 100% offline) ─────
const LS_APERTURA_KEY = "apertura_activa";

export interface AperturaLocalStorage {
  id: string;
  cajero_id: string;
  cajero?: string; // nombre del cajero
  caja: string;
  fecha: string;
  estado: string;
  pending_sync?: boolean; // true = creada offline, sin subir a Supabase aún
  guardadoEn: number;
}

/** Guarda el flag de apertura activa en localStorage (instantáneo, sin red) */
export function guardarAperturaLocalStorage(
  apertura: Omit<AperturaLocalStorage, "guardadoEn">,
): void {
  try {
    const data: AperturaLocalStorage = { ...apertura, guardadoEn: Date.now() };
    localStorage.setItem(LS_APERTURA_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("No se pudo guardar apertura en localStorage:", e);
  }
}

/** Lee el flag de apertura activa desde localStorage */
export function obtenerAperturaLocalStorage(): AperturaLocalStorage | null {
  try {
    const raw = localStorage.getItem(LS_APERTURA_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AperturaLocalStorage;
  } catch (e) {
    console.warn("Error leyendo apertura de localStorage:", e);
    return null;
  }
}

/** Elimina el flag de apertura activa de localStorage */
export function limpiarAperturaLocalStorage(): void {
  try {
    localStorage.removeItem(LS_APERTURA_KEY);
  } catch (e) {
    console.warn("Error limpiando apertura de localStorage:", e);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guarda información de apertura de caja en cache
 */
export async function guardarAperturaCache(
  apertura: Omit<AperturaCache, "timestamp">,
): Promise<void> {
  // Capa rápida: también guardar en localStorage
  guardarAperturaLocalStorage({
    id: apertura.id,
    cajero_id: apertura.cajero_id,
    caja: apertura.caja,
    fecha: apertura.fecha,
    estado: apertura.estado,
  });

  // Guardar en STORE.CIERRES (fuente primaria de localDB) para que
  // fetchHistorialVentas, fetchResumenCaja y calcularResumenTurno lo encuentren.
  try {
    const numId = parseInt(apertura.id as string);
    const aperturaIDB: Record<string, unknown> = {
      id: Number.isFinite(numId) && numId > 0 ? numId : -Date.now(),
      cajero_id: apertura.cajero_id,
      cajero: (apertura as any).cajero || "",
      caja: apertura.caja,
      fecha: apertura.fecha,
      estado: "APERTURA",
    };
    if ((apertura as any).pending_sync !== undefined) {
      aperturaIDB.pending_sync = (apertura as any).pending_sync;
    }
    await upsertOne(STORE.CIERRES, aperturaIDB);
    console.log(
      `[guardarAperturaCache] Guardado en STORE.CIERRES id=${aperturaIDB.id} pending_sync=${aperturaIDB.pending_sync}`,
    );
  } catch (e) {
    console.warn(
      "[offlineSync] No se pudo guardar apertura en STORE.CIERRES:",
      e,
    );
  }

  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([APERTURA_STORE], "readwrite");
    const store = transaction.objectStore(APERTURA_STORE);

    // Limpiar cache anterior del mismo cajero y fecha
    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      const aperturaConTimestamp: AperturaCache = {
        ...apertura,
        timestamp: Date.now(),
      };

      const addRequest = store.add(aperturaConTimestamp);

      addRequest.onsuccess = () => {
        console.log("Apertura guardada en cache");
        resolve();
      };

      addRequest.onerror = () => {
        console.error("Error guardando apertura en cache:", addRequest.error);
        reject(addRequest.error);
      };
    };

    clearRequest.onerror = () => {
      console.error("Error limpiando cache de apertura:", clearRequest.error);
      reject(clearRequest.error);
    };
  });
}

/**
 * Obtiene información de apertura desde el cache
 */
export async function obtenerAperturaCache(): Promise<AperturaCache | null> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([APERTURA_STORE], "readonly");
    const store = transaction.objectStore(APERTURA_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const aperturas = request.result as AperturaCache[];
      if (aperturas.length > 0) {
        resolve(aperturas[0]); // Devolver la primera (debería ser única)
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      console.error("Error obteniendo apertura desde cache:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Limpia el cache de apertura (IndexedDB + localStorage)
 */
export async function limpiarAperturaCache(): Promise<void> {
  // Limpiar también localStorage
  limpiarAperturaLocalStorage();

  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([APERTURA_STORE], "readwrite");
    const store = transaction.objectStore(APERTURA_STORE);
    const request = store.clear();

    request.onsuccess = () => {
      console.log("Cache de apertura limpiado");
      resolve();
    };

    request.onerror = () => {
      console.error("Error limpiando cache de apertura:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Sincroniza una apertura que fue creada offline (pending_sync=true) con Supabase.
 * Devuelve true si se sincronizó exitosamente o si no había nada pendiente.
 */
export async function sincronizarAperturaPendiente(): Promise<boolean> {
  try {
    const aperturaLS = obtenerAperturaLocalStorage();
    if (!aperturaLS?.pending_sync) return true; // nada pendiente

    console.log("🔄 Sincronizando apertura offline pendiente...", aperturaLS);

    // Verificar primero si ya existe en Supabase (idempotente)
    const { data: existente } = await supabase
      .from("cierres")
      .select("id, cajero_id, caja, fecha, estado")
      .eq("cajero_id", aperturaLS.cajero_id)
      .eq("caja", aperturaLS.caja)
      .eq("estado", "APERTURA")
      .limit(1)
      .maybeSingle();

    if (existente) {
      // Ya existe en Supabase → actualizar cache con el ID real y quitar pending_sync
      console.log("✓ Apertura ya existe en Supabase, actualizando cache local");
      const actualizada: AperturaLocalStorage = {
        ...aperturaLS,
        id: existente.id.toString(),
        pending_sync: false,
        guardadoEn: Date.now(),
      };
      guardarAperturaLocalStorage(actualizada);
      await guardarAperturaCache({
        id: existente.id.toString(),
        cajero_id: existente.cajero_id,
        cajero: aperturaLS.cajero,
        caja: existente.caja,
        fecha: existente.fecha,
        estado: existente.estado,
        pending_sync: false,
      });
      return true;
    }

    // No existe → insertar en Supabase
    const { data: insertada, error } = await supabase
      .from("cierres")
      .insert([
        {
          tipo_registro: "apertura",
          cajero: aperturaLS.cajero ?? "",
          cajero_id: aperturaLS.cajero_id,
          caja: aperturaLS.caja,
          fecha: aperturaLS.fecha,
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
      .select()
      .single();

    if (error) {
      // Si es duplicado (constraint único), manejar igual que existente
      if (error.code === "23505") {
        console.warn("⚠ Constraint único al sincronizar: apertura ya existe");
        const actualizada: AperturaLocalStorage = {
          ...aperturaLS,
          pending_sync: false,
          guardadoEn: Date.now(),
        };
        guardarAperturaLocalStorage(actualizada);
        return true;
      }
      console.error("Error sincronizando apertura offline:", error);
      return false;
    }

    // Éxito → actualizar cache con el ID real de Supabase
    console.log(
      "✓ Apertura offline sincronizada con Supabase, id:",
      insertada.id,
    );
    const actualizada: AperturaLocalStorage = {
      ...aperturaLS,
      id: insertada.id.toString(),
      pending_sync: false,
      guardadoEn: Date.now(),
    };
    guardarAperturaLocalStorage(actualizada);
    await guardarAperturaCache({
      id: insertada.id.toString(),
      cajero_id: insertada.cajero_id,
      cajero: aperturaLS.cajero,
      caja: insertada.caja,
      fecha: insertada.fecha,
      estado: insertada.estado,
      pending_sync: false,
    });
    return true;
  } catch (err) {
    console.error("Excepción sincronizando apertura offline:", err);
    return false;
  }
}

/**
 * Guarda información CAI en cache (escoped por cajero_id — v6)
 * Usa put() con keyPath=cajero_id: cada cajero tiene su propia entrada.
 * Esto evita que dos usuarios en el mismo dispositivo se sobreescriban.
 */
export async function guardarCaiCache(
  cai: Omit<CaiCache, "timestamp" | "cache_key">,
): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([CAI_STORE], "readwrite");
    const store = transaction.objectStore(CAI_STORE);

    const caiConTimestamp: CaiCache = {
      ...cai,
      cache_key: buildCaiCacheKey(cai.cajero_id, cai.tipo_comprobante),
      timestamp: Date.now(),
    };

    // put() upserta: si existe la clave (cajero_id + tipo) la actualiza.
    const request = store.put(caiConTimestamp);

    request.onsuccess = () => {
      console.log(`CAI guardado en cache para cajero ${cai.cajero_id}`);
      resolve();
    };

    request.onerror = () => {
      console.error("Error guardando CAI en cache:", request.error);
      reject(request.error);
    };
  });
}

/**
 * Obtiene información CAI del cache para un cajero específico (v6).
 * Si se proporciona cajeroId, recupera la entrada exacta de ese cajero.
 * Para compatibilidad con código antiguo, si no se pasa cajeroId devuelve el primero.
 */
export async function obtenerCaiCache(
  cajeroId?: string,
  tipoComprobante?: TipoComprobanteFiscal,
): Promise<CaiCache | null> {
  const database = await initIndexedDB();

  const seleccionarCai = (cais: CaiCache[]): CaiCache | null => {
    if (tipoComprobante) {
      return cais.find((c) => c.tipo_comprobante === tipoComprobante) ?? null;
    }

    return cais.find((c) => c.tipo_comprobante === "RECIBO") ?? cais[0] ?? null;
  };

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([CAI_STORE], "readonly");
    const store = transaction.objectStore(CAI_STORE);

    if (cajeroId && tipoComprobante) {
      const request = store.get(buildCaiCacheKey(cajeroId, tipoComprobante));
      request.onsuccess = () => {
        resolve((request.result as CaiCache) ?? null);
      };
      request.onerror = () => reject(request.error);
    } else if (cajeroId) {
      const request = store.index("cajero_id").getAll(cajeroId);
      request.onsuccess = () => {
        resolve(seleccionarCai((request.result as CaiCache[]) ?? []));
      };
      request.onerror = () => reject(request.error);
    } else {
      const request = store.getAll();
      request.onsuccess = () => {
        resolve(seleccionarCai((request.result as CaiCache[]) ?? []));
      };
      request.onerror = () => {
        console.error("Error obteniendo CAI desde cache:", request.error);
        reject(request.error);
      };
    }
  });
}

/**
 * Guarda datos del negocio en cache
 */
export async function guardarDatosNegocioCache(
  datos: Omit<DatosNegocioCache, "timestamp">,
): Promise<void> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [DATOS_NEGOCIO_STORE],
      "readwrite",
    );
    const store = transaction.objectStore(DATOS_NEGOCIO_STORE);

    // Limpiar cache anterior
    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      const datosConTimestamp: DatosNegocioCache = {
        ...datos,
        timestamp: Date.now(),
      };

      const addRequest = store.add(datosConTimestamp);

      addRequest.onsuccess = () => {
        console.log("Datos del negocio guardados en cache");
        resolve();
      };

      addRequest.onerror = () => {
        console.error(
          "Error guardando datos del negocio en cache:",
          addRequest.error,
        );
        reject(addRequest.error);
      };
    };

    clearRequest.onerror = () => {
      console.error(
        "Error limpiando cache de datos del negocio:",
        clearRequest.error,
      );
      reject(clearRequest.error);
    };
  });
}

/**
 * Obtiene datos del negocio desde el cache
 */
export async function obtenerDatosNegocioCache(): Promise<DatosNegocioCache | null> {
  const database = await initIndexedDB();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([DATOS_NEGOCIO_STORE], "readonly");
    const store = transaction.objectStore(DATOS_NEGOCIO_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const datos = request.result as DatosNegocioCache[];
      if (datos.length > 0) {
        resolve(datos[0]);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      console.error(
        "Error obteniendo datos del negocio desde cache:",
        request.error,
      );
      reject(request.error);
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  VENTAS PENDIENTES — Una fila por venta (factura + pago unificados)
//  Escribe en la tabla `ventas` de Supabase.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Guarda una venta en IndexedDB (modo offline o respaldo ante fallo de Supabase).
 * Si ya existe una entrada con el mismo operation_id la reemplaza (put).
 */
export async function guardarVentaLocal(
  venta: Omit<VentaPendiente, "id" | "timestamp" | "intentos">,
): Promise<number> {
  const database = await initIndexedDB();

  const localId = await new Promise<number>((resolve, reject) => {
    const transaction = database.transaction([VENTAS_STORE], "readwrite");
    const store = transaction.objectStore(VENTAS_STORE);

    const ventaConMeta: Omit<VentaPendiente, "id"> = {
      ...venta,
      timestamp: Date.now(),
      intentos: 0,
    };

    const request = store.add(ventaConMeta);

    request.onsuccess = () => {
      console.log(
        `Venta ${venta.factura} guardada en IndexedDB (ventas_pendientes)`,
      );
      resolve(request.result as number);
    };

    request.onerror = () => {
      console.error("Error guardando venta en IndexedDB:", request.error);
      reject(request.error);
    };
  });

  // Guardar también en STORE.VENTAS (fuente primaria para resumen e historial offline)
  try {
    const tempId =
      typeof (venta as any).id === "number"
        ? (venta as any).id
        : -Math.abs(localId);
    await upsertOne(STORE.VENTAS, { ...venta, id: tempId });
  } catch (e) {
    console.error("[offlineSync] No se pudo guardar venta en STORE.VENTAS:", e);
  }

  return localId;
}

/**
 * Obtiene todas las ventas pendientes de sincronización.
 */
export async function obtenerVentasPendientes(): Promise<VentaPendiente[]> {
  const database = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([VENTAS_STORE], "readonly");
    const req = tx.objectStore(VENTAS_STORE).getAll();
    req.onsuccess = () => resolve(req.result as VentaPendiente[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Elimina una venta de IndexedDB después de sincronizarla con Supabase.
 */
export async function eliminarVentaLocal(id: number): Promise<void> {
  const database = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([VENTAS_STORE], "readwrite");
    const req = tx.objectStore(VENTAS_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function inferirTipoComprobanteVenta(venta: VentaPendiente): TipoComprobanteFiscal {
  const tipo = String((venta as any).tipo_documento_fiscal || "").toUpperCase();
  if (tipo === "FACTURA" || tipo === "RECIBO") {
    return tipo as TipoComprobanteFiscal;
  }

  // Fallback defensivo: FACTURA SAR viene formateada 000-000-00-00000000.
  return String(venta.factura || "").includes("-") ? "FACTURA" : "RECIBO";
}

function extraerSecuencialVenta(
  venta: VentaPendiente,
  facturaFinal?: string,
): number | null {
  const tipoComprobante = inferirTipoComprobanteVenta(venta);

  if (tipoComprobante === "FACTURA") {
    const raw = (venta as any).numero_secuencial ?? facturaFinal ?? venta.factura;
    const match = String(raw ?? "").match(/(\d+)$/);
    if (!match) return null;
    const sec = parseInt(match[1], 10);
    return Number.isFinite(sec) ? sec : null;
  }

  const n = parseInt(String(facturaFinal ?? venta.factura ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

async function sincronizarCorrelativosCai(
  correlativos: Map<
    string,
    { cajeroId: string; tipoComprobante: TipoComprobanteFiscal; siguiente: number }
  >,
): Promise<void> {
  if (correlativos.size === 0) return;

  for (const item of correlativos.values()) {
    try {
      const { data: caiRow, error: caiErr } = await supabase
        .from("cai_facturas")
        .select("id, factura_actual")
        .eq("cajero_id", item.cajeroId)
        .eq("tipo_comprobante", item.tipoComprobante)
        .maybeSingle();

      if (caiErr || !caiRow?.id) {
        console.warn(
          `[ventas] No se encontró CAI para sincronizar correlativo (${item.tipoComprobante}) del cajero ${item.cajeroId}`,
        );
        continue;
      }

      const remMatch = String(caiRow.factura_actual ?? "").match(/(\d+)$/);
      const remotoActual = remMatch ? parseInt(remMatch[1], 10) : 0;
      const nuevoActual = Math.max(
        Number.isFinite(remotoActual) ? remotoActual : 0,
        item.siguiente,
      );

      if (!Number.isFinite(nuevoActual) || nuevoActual <= 0) continue;
      if (remotoActual === nuevoActual) continue;

      const { error: updErr } = await supabase
        .from("cai_facturas")
        .update({ factura_actual: String(nuevoActual) })
        .eq("id", caiRow.id);

      if (updErr) {
        console.error(
          `[ventas] Error sincronizando correlativo ${item.tipoComprobante} (${item.cajeroId}):`,
          updErr,
        );
      } else {
        console.log(
          `✓ [ventas] Correlativo ${item.tipoComprobante} actualizado a ${nuevoActual} para cajero ${item.cajeroId}`,
        );
      }
    } catch (err) {
      console.error("[ventas] Error inesperado sincronizando correlativo:", err);
    }
  }
}

/**
 * Sincroniza las ventas pendientes con Supabase.
 * Usa upsert con onConflict="operation_id" para evitar duplicados.
 */
export async function sincronizarVentas(): Promise<{
  exitosas: number;
  fallidas: number;
}> {
  const pendientes = (await obtenerVentasPendientes()).sort(
    (a, b) => (a.timestamp || 0) - (b.timestamp || 0),
  );
  if (pendientes.length === 0) return { exitosas: 0, fallidas: 0 };

  console.log(
    `[ventas] Sincronizando ${pendientes.length} ventas pendientes...`,
  );
  let exitosas = 0;
  let fallidas = 0;
  const correlativosPorSincronizar = new Map<
    string,
    { cajeroId: string; tipoComprobante: TipoComprobanteFiscal; siguiente: number }
  >();

  const registrarCorrelativoSincronizado = (
    ventaSincronizada: VentaPendiente,
    facturaFinal?: string,
  ) => {
    if (!ventaSincronizada.cajero_id) return;

    const secuencial = extraerSecuencialVenta(ventaSincronizada, facturaFinal);
    if (secuencial === null) return;

    const tipoComprobante = inferirTipoComprobanteVenta(ventaSincronizada);
    const siguiente = secuencial + 1;
    const key = `${ventaSincronizada.cajero_id}::${tipoComprobante}`;
    const existente = correlativosPorSincronizar.get(key);

    if (!existente || siguiente > existente.siguiente) {
      correlativosPorSincronizar.set(key, {
        cajeroId: ventaSincronizada.cajero_id,
        tipoComprobante,
        siguiente,
      });
    }
  };

  for (const venta of pendientes) {
    try {
      const { id, timestamp, intentos, sync_status, ...ventaData } = venta;

      const { error } = await supabase.from("ventas").upsert([ventaData], {
        onConflict: "operation_id",
        ignoreDuplicates: false,
      });

      if (error) {
        if (error.code === "23505") {
          // Si existe una fila con mismo factura+cajero, priorizar el registro local (IDB)
          // porque representa la operación pendiente más reciente en este dispositivo.
          const { data: existenteFactura } = await supabase
            .from("ventas")
            .select("id")
            .eq("factura", venta.factura)
            .eq("cajero_id", venta.cajero_id ?? "")
            .maybeSingle();

          if (existenteFactura?.id) {
            const { error: updateErr } = await supabase
              .from("ventas")
              .update(ventaData)
              .eq("id", existenteFactura.id);

            if (!updateErr) {
              await eliminarVentaLocal(venta.id!);
              registrarCorrelativoSincronizado(venta);
              console.log(
                `✓ [ventas] Registro remoto reemplazado con versión local para factura ${venta.factura}`,
              );
              exitosas++;
              continue;
            }
          }

          // Verificar si es nuestro propio operation_id (doble submit)
          const { data: existe } = await supabase
            .from("ventas")
            .select("id")
            .eq("operation_id", venta.operation_id ?? "")
            .maybeSingle();

          if (existe) {
            console.warn(
              `⚠ [ventas] Venta ${venta.factura} ya existe (mismo operation_id). Eliminando.`,
            );
            await eliminarVentaLocal(venta.id!);
            exitosas++;
          } else {
            // Número tomado → buscar siguiente libre con loop robusto
            const cajeroId = venta.cajero_id ?? "";

            // Helper: obtener siguiente número libre para este cajero (su rango de CAI)
            const buscarSiguienteLibre = async (): Promise<string | null> => {
              // 1. Intentar RPC primero
              try {
                const { data: rpcNum, error: rpcErr } = await supabase.rpc(
                  "obtener_siguiente_factura",
                  { p_cajero_id: cajeroId },
                );
                if (!rpcErr && rpcNum && rpcNum !== "LIMITE_ALCANZADO") {
                  // Verificar libre para ESTE cajero.
                  // La constraint uq_ventas_factura_cajero es UNIQUE(factura, cajero_id).
                  const { data: ocup } = await supabase
                    .from("ventas")
                    .select("id")
                    .eq("factura", rpcNum)
                    .eq("cajero_id", cajeroId)
                    .maybeSingle();
                  if (!ocup) return rpcNum as string;
                }
              } catch {
                /* continuar con fallback */
              }
              // 2. Fallback: MAX del cajero — ordenar por id DESC para capturar
              // las facturas más recientes (evita truncado de 1000 filas por defecto)
              try {
                const { data: rows } = await supabase
                  .from("ventas")
                  .select("factura")
                  .eq("cajero_id", cajeroId)
                  .not("factura", "like", "DEV-%")
                  .not("factura", "like", "OFFLINE-%")
                  .order("id", { ascending: false })
                  .limit(500);
                if (rows && rows.length > 0) {
                  const maxNum = rows.reduce((max, r) => {
                    const n = parseInt(r.factura);
                    return Number.isFinite(n) ? Math.max(max, n) : max;
                  }, 0);
                  // Sincronizar el contador
                  await supabase
                    .from("cai_facturas")
                    .update({ factura_actual: (maxNum + 2).toString() })
                    .eq("cajero_id", cajeroId)
                    .eq("tipo_comprobante", "RECIBO");
                  return (maxNum + 1).toString();
                }
              } catch {
                /* ignore */
              }
              return null;
            };

            let sincronizado = false;
            let intentos = 0;
            // Obtener número base una sola vez; luego incrementar en cada conflicto
            const numeroBase = await buscarSiguienteLibre();
            let numeroActual = numeroBase ? parseInt(numeroBase) : null;
            if (numeroActual === null) {
              console.error("[ventas] No se pudo obtener número libre");
              fallidas++;
            } else {
              while (!sincronizado && intentos < 10) {
                intentos++;
                const nuevoNumero = numeroActual.toString();
                console.warn(
                  `⚠ [ventas] Número ${venta.factura} tomado. Auto-corrigiendo → ${nuevoNumero} (intento ${intentos})`,
                );
                const ventaCorregida = { ...ventaData, factura: nuevoNumero };
                const { error: retryError } = await supabase
                  .from("ventas")
                  .insert([ventaCorregida]);
                if (!retryError) {
                  await eliminarVentaLocal(venta.id!);
                  registrarCorrelativoSincronizado(venta, nuevoNumero);
                  console.log(
                    `✓ [ventas] Corregida: ${venta.factura} → ${nuevoNumero}`,
                  );
                  exitosas++;
                  sincronizado = true;
                } else if (
                  retryError.code === "23505" ||
                  (retryError as any).status === 409
                ) {
                  // Número tomado → incrementar y reintentar
                  numeroActual++;
                } else {
                  // Error no recuperable
                  console.error("[ventas] Error no recuperable:", retryError);
                  fallidas++;
                  break;
                }
              }
              if (!sincronizado && intentos >= 10) {
                console.error(
                  `[ventas] Se agotaron los reintentos para ${venta.factura}`,
                );
                fallidas++;
              }
            }
          }
        } else {
          console.error(
            `[ventas] Error sincronizando venta ${venta.factura}:`,
            error,
          );
          // Incrementar intentos
          const database = await initIndexedDB();
          const tx = database.transaction([VENTAS_STORE], "readwrite");
          const store = tx.objectStore(VENTAS_STORE);
          const getReq = store.get(venta.id!);
          getReq.onsuccess = () => {
            const row = getReq.result as VentaPendiente;
            if (row) store.put({ ...row, intentos: (row.intentos || 0) + 1 });
          };
          fallidas++;
        }
      } else {
        await eliminarVentaLocal(venta.id!);
        registrarCorrelativoSincronizado(venta);
        console.log(`✓ [ventas] Venta ${venta.factura} sincronizada`);
        exitosas++;
      }
    } catch (err) {
      console.error(`[ventas] Error crítico:`, err);
      fallidas++;
    }
  }

  await sincronizarCorrelativosCai(correlativosPorSincronizar);

  return { exitosas, fallidas };
}

/**
 * Inicializa el sistema completo de sincronización offline
 */
export async function inicializarSistemaOffline(): Promise<void> {
  try {
    await initIndexedDB();
    configurarSincronizacionAutomatica();

    // Intentar sincronizar datos pendientes al iniciar
    if (navigator.onLine) {
      const pendientes = await obtenerContadorPendientes();
      const total =
        pendientes.facturas +
        pendientes.pagos +
        pendientes.gastos +
        pendientes.envios +
        pendientes.ventas +
        pendientes.cierres;

      if (total > 0) {
        console.log(
          `Hay ${pendientes.facturas} facturas, ${pendientes.pagos} pagos, ${pendientes.gastos} gastos, ${pendientes.envios} envíos, ${pendientes.ventas} ventas y ${pendientes.cierres} cierres pendientes de sincronización`,
        );
        await sincronizarTodo();
      }

      // Cargar productos en cache si no hay ninguno o actualizar
      const hayCache = await hayProductosEnCache();
      if (!hayCache) {
        console.log("Cargando productos en cache por primera vez...");
        const resultado = await actualizarCacheProductos();
        if (resultado.exitoso) {
          console.log(`✓ ${resultado.cantidad} productos cargados en cache`);
        }
      }
    } else {
      console.warn("⚠ Sin conexión. Verificando cache de productos...");
      const hayCache = await hayProductosEnCache();
      if (!hayCache) {
        console.error(
          "❌ No hay productos en cache y no hay conexión a internet",
        );
      } else {
        const productos = await obtenerProductosCache();
        console.log(`✓ ${productos.length} productos disponibles en cache`);
      }
    }

    console.log("✓ Sistema de sincronización offline inicializado");
  } catch (error) {
    console.error("Error inicializando sistema offline:", error);
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  PAGOSF  — Una sola fila por factura. Reemplaza pagos para escritura.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Guarda UN registro plano de pagosf en IndexedDB (modo offline o respaldo).
 * Si ya existe una entrada para la misma factura la reemplaza (put en lugar de add).
 */
export async function guardarPagoFLocal(
  pago: Omit<PagoFPendiente, "id" | "timestamp" | "intentos">,
): Promise<number> {
  const database = await initIndexedDB();

  return new Promise(async (resolve, reject) => {
    const transaction = database.transaction([PAGOSF_STORE], "readwrite");
    const store = transaction.objectStore(PAGOSF_STORE);

    // Verificar si ya existe una entrada para este número de factura
    const facturaIndex = store.index("factura");
    const getReq = facturaIndex.getKey(pago.factura);

    getReq.onsuccess = () => {
      const existingId = getReq.result as number | undefined;
      const pagoConMeta: PagoFPendiente = {
        ...(existingId !== undefined ? { id: existingId } : {}),
        ...pago,
        timestamp: Date.now(),
        intentos: 0,
      };

      // put reemplaza si id existe, add crea si no
      const writeReq =
        existingId !== undefined
          ? store.put(pagoConMeta)
          : store.add(pagoConMeta);

      writeReq.onsuccess = () => {
        resolve(writeReq.result as number);
      };
      writeReq.onerror = () => reject(writeReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Obtiene todos los pagosf pendientes de sincronización.
 */
export async function obtenerPagosFPendientes(): Promise<PagoFPendiente[]> {
  const database = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([PAGOSF_STORE], "readonly");
    const req = tx.objectStore(PAGOSF_STORE).getAll();
    req.onsuccess = () => resolve(req.result as PagoFPendiente[]);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Elimina un pagoF de IndexedDB después de sincronizarlo.
 */
export async function eliminarPagoFLocal(id: number): Promise<void> {
  const database = await initIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([PAGOSF_STORE], "readwrite");
    const req = tx.objectStore(PAGOSF_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Sincroniza los pagosf pendientes con Supabase usando UPSERT.
 * Gracias al UNIQUE en columna factura, nunca genera duplicados.
 */
export async function sincronizarPagosF(): Promise<{
  exitosos: number;
  fallidos: number;
}> {
  const pendientes = await obtenerPagosFPendientes();
  if (pendientes.length === 0) return { exitosos: 0, fallidos: 0 };

  console.log(`[pagosf] Sincronizando ${pendientes.length} registros...`);
  let exitosos = 0;
  let fallidos = 0;

  for (const pago of pendientes) {
    try {
      const { id, timestamp, intentos, ...pagoData } = pago;

      const { error } = await supabase
        .from("pagosf")
        .upsert([pagoData], { onConflict: "factura", ignoreDuplicates: false });

      if (error) {
        console.error(
          `[pagosf] Error sincronizando factura ${pago.factura}:`,
          error,
        );
        // Incrementar intentos
        const database = await initIndexedDB();
        const tx = database.transaction([PAGOSF_STORE], "readwrite");
        const store = tx.objectStore(PAGOSF_STORE);
        const getReq = store.get(pago.id!);
        getReq.onsuccess = () => {
          const row = getReq.result as PagoFPendiente;
          if (row) store.put({ ...row, intentos: (row.intentos || 0) + 1 });
        };
        fallidos++;
      } else {
        await eliminarPagoFLocal(pago.id!);
        console.log(`[pagosf] ✓ factura ${pago.factura} sincronizada`);
        exitosos++;
      }
    } catch (err) {
      console.error(`[pagosf] Error crítico:`, err);
      fallidos++;
    }
  }

  return { exitosos, fallidos };
}
