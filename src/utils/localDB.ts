/**
 * localDB.ts — Base de datos local completa (offline-first)
 * DB_VERSION = 2 (v2 agrega cola_escrituras)
 */

import { supabase } from "../supabaseClient";

// ─────────────────────────── Configuración DB ──────────────────────────────
const DB_NAME = "CarnitasRoaLocalDB";
const DB_VERSION = 3;

export const STORE = {
  VENTAS: "ventas",
  GASTOS: "gastos",
  CIERRES: "cierres",
  PEDIDOS_ENVIO: "pedidos_envio",
  CAI_FACTURAS: "cai_facturas",
  USUARIOS: "usuarios",
  PRODUCTOS: "productos",
  DATOS_NEGOCIO: "datos_negocio",
  COMPLEMENTOS: "complementos_opciones",
  DESCUENTOS_CONFIG: "descuentos_config",
  PRECIO_DOLAR: "precio_dolar",
  CLAVES_AUTORIZACION: "claves_autorizacion",
  PAGOSF: "pagosf",
  RESUMEN_TURNOS: "resumen_turnos",
  SYNC_META: "sync_meta",
  COLA_ESCRITURAS: "cola_escrituras",
  // Tablas extendidas v3
  CLIENTES_CREDITO: "clientes_credito",
  COSTO_DELIVERY: "costo_delivery",
  CUENTAS_COBRAR: "cuentas_por_cobrar",
  CUENTAS_PAGAR: "cuentas_por_pagar",
  ETIQUETAS_CONFIG: "etiquetas_config",
  FACTURACION_SAR: "facturacion_sar",
  FACTURAS: "facturas",
  FACTURAS_CREDITO: "facturas_credito",
  IMPRESORAS_CONFIG: "impresoras_config",
  INSUMOS: "insumos",
  INVENTARIO_CONFIG: "inventario_config_productos",
  MOVIMIENTOS_INVENTARIO: "movimientos_inventario",
  ORDENES_PRODUCCION: "ordenes_produccion",
  ORDENES_PRODUCCION_DET: "ordenes_produccion_detalle",
  PAGOS: "pagos",
  PAGOS_CREDITO: "pagos_credito",
  PAGOS_PROVEEDORES: "pagos_proveedores",
  PROVEEDORES: "proveedores",
  RECETAS: "recetas",
  RECETAS_DETALLE: "recetas_detalle",
  RECIBO_CONFIG: "recibo_config",
  STOCK_PRODUCTOS: "stock_productos",
} as const;

export interface ResumenTurno {
  apertura_id: number;
  cajero_id: string;
  nombre_cajero: string;
  caja: string;
  fecha_apertura: string;
  fecha_cierre?: string | null;
  efectivo_bruto: number;
  efectivo_neto: number;
  cambio_devuelto: number;
  gastos: number;
  tarjeta: number;
  transferencia: number;
  dolares_usd: number;
  dolares_lps: number;
  total_ventas: number;
  platillos_vendidos: number;
  bebidas_vendidas: number;
  platillos_donados: number;
  bebidas_donadas: number;
  total_platillos: number;
  total_bebidas: number;
}

export interface ColaEscritura {
  id?: number;
  tabla: string;
  operacion: "insert" | "update" | "upsert" | "delete";
  datos: any;
  donde?: any;
  timestamp: number;
  intentos: number;
  ultimo_error?: string;
}

export interface SyncProgress {
  tabla: string;
  filas: number;
  status: "ok" | "error" | "skip";
  error?: string;
}

// ─────────────────────────── Apertura de la DB ─────────────────────────────
let _db: IDBDatabase | null = null;

export function openLocalDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      const ensureStore = (
        name: string,
        options: IDBObjectStoreParameters,
        indexes?: { name: string; keyPath: string; unique?: boolean }[],
      ) => {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, options);
          indexes?.forEach((idx) =>
            store.createIndex(idx.name, idx.keyPath, {
              unique: idx.unique ?? false,
            }),
          );
        }
      };

      if (oldVersion < 1) {
        ensureStore(STORE.VENTAS, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
          { name: "fecha_hora", keyPath: "fecha_hora" },
          { name: "factura", keyPath: "factura" },
        ]);
        ensureStore(STORE.GASTOS, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
          { name: "fecha", keyPath: "fecha" },
        ]);
        ensureStore(STORE.CIERRES, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
          { name: "tipo_registro", keyPath: "tipo_registro" },
        ]);
        ensureStore(STORE.PEDIDOS_ENVIO, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
          { name: "fecha", keyPath: "fecha" },
        ]);
        ensureStore(STORE.CAI_FACTURAS, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
          { name: "activo", keyPath: "activo" },
        ]);
        ensureStore(STORE.USUARIOS, { keyPath: "id" }, [
          { name: "codigo", keyPath: "codigo" },
        ]);
        ensureStore(STORE.PRODUCTOS, { keyPath: "id" }, [
          { name: "tipo", keyPath: "tipo" },
        ]);
        ensureStore(STORE.DATOS_NEGOCIO, { keyPath: "id" });
        ensureStore(STORE.COMPLEMENTOS, { keyPath: "id" });
        ensureStore(STORE.DESCUENTOS_CONFIG, { keyPath: "id" });
        ensureStore(STORE.PRECIO_DOLAR, { keyPath: "id" });
        ensureStore(STORE.CLAVES_AUTORIZACION, { keyPath: "id" });
        ensureStore(STORE.PAGOSF, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
          { name: "factura", keyPath: "factura" },
        ]);
        ensureStore(STORE.RESUMEN_TURNOS, { keyPath: "apertura_id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
        ]);
        ensureStore(STORE.SYNC_META, { keyPath: "table" });
      }

      if (oldVersion < 2) {
        ensureStore(
          STORE.COLA_ESCRITURAS,
          { keyPath: "id", autoIncrement: true },
          [
            { name: "tabla", keyPath: "tabla" },
            { name: "timestamp", keyPath: "timestamp" },
          ],
        );
      }

      if (oldVersion < 3) {
        // Catálogos adicionales
        ensureStore(STORE.CLIENTES_CREDITO, { keyPath: "id" });
        ensureStore(STORE.COSTO_DELIVERY, { keyPath: "id" });
        ensureStore(STORE.CUENTAS_COBRAR, { keyPath: "id" }, [
          { name: "cliente_id", keyPath: "cliente_id" },
        ]);
        ensureStore(STORE.CUENTAS_PAGAR, { keyPath: "id" }, [
          { name: "proveedor_id", keyPath: "proveedor_id" },
        ]);
        ensureStore(STORE.ETIQUETAS_CONFIG, { keyPath: "id" });
        ensureStore(STORE.IMPRESORAS_CONFIG, { keyPath: "id" });
        ensureStore(STORE.RECIBO_CONFIG, { keyPath: "id" });
        ensureStore(STORE.PROVEEDORES, { keyPath: "id" });
        ensureStore(STORE.INSUMOS, { keyPath: "id" });
        ensureStore(STORE.INVENTARIO_CONFIG, { keyPath: "id" });
        ensureStore(STORE.STOCK_PRODUCTOS, { keyPath: "id" }, [
          { name: "producto_id", keyPath: "producto_id" },
        ]);
        ensureStore(STORE.RECETAS, { keyPath: "id" });
        ensureStore(STORE.RECETAS_DETALLE, { keyPath: "id" }, [
          { name: "receta_id", keyPath: "receta_id" },
        ]);
        // Transaccionales adicionales
        ensureStore(STORE.FACTURAS, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
        ]);
        ensureStore(STORE.FACTURAS_CREDITO, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
        ]);
        ensureStore(STORE.FACTURACION_SAR, { keyPath: "id" });
        ensureStore(STORE.PAGOS, { keyPath: "id" }, [
          { name: "cajero_id", keyPath: "cajero_id" },
        ]);
        ensureStore(STORE.PAGOS_CREDITO, { keyPath: "id" });
        ensureStore(STORE.PAGOS_PROVEEDORES, { keyPath: "id" });
        ensureStore(STORE.MOVIMIENTOS_INVENTARIO, { keyPath: "id" });
        ensureStore(STORE.ORDENES_PRODUCCION, { keyPath: "id" });
        ensureStore(STORE.ORDENES_PRODUCCION_DET, { keyPath: "id" }, [
          { name: "orden_id", keyPath: "orden_id" },
        ]);
      }
    };

    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => {
        _db = null;
      };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

// ─────────────────────── CRUD genérico ─────────────────────────────────────

export async function upsertBulk(
  storeName: string,
  rows: any[],
): Promise<void> {
  if (!rows || rows.length === 0) return;
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    rows.forEach((row) => store.put(row));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function upsertOne(storeName: string, row: any): Promise<void> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAll<T = any>(storeName: string): Promise<T[]> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getById<T = any>(
  storeName: string,
  id: any,
): Promise<T | undefined> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(id);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function getByIndex<T = any>(
  storeName: string,
  indexName: string,
  value: any,
): Promise<T[]> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function clearStore(storeName: string): Promise<void> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteById(storeName: string, id: any): Promise<void> {
  const db = await openLocalDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ──────────────────── Ventas pendientes (id negativo = offline) ─────────────
/**
 * Sube a Supabase las ventas que se guardaron offline (id temporal negativo).
 * Debe llamarse ANTES de sincronizarTodoDesdeSupabase para que el clearStore
 * no las borre sin haberlas respaldado.
 */
export async function subirVentasPendientesIDB(): Promise<number> {
  const todas = await getAll<any>(STORE.VENTAS);
  const pendientes = todas.filter((v) => typeof v.id === "number" && v.id < 0);
  if (pendientes.length === 0) return 0;

  let subidas = 0;
  for (const venta of pendientes) {
    const { id: _tempId, ...ventaSinId } = venta;
    try {
      const { data: insertada, error } = await supabase
        .from("ventas")
        .insert([ventaSinId])
        .select("id")
        .single();
      if (error) {
        // Conflicto de factura u otro error no crítico: marcar para no reintentar infinitamente
        if (error.code === "23505" || (error as any).status === 409) {
          // La factura ya existe: eliminar la copia local duplicada
          await deleteById(STORE.VENTAS, _tempId);
        }
        // Otros errores: dejar para el próximo intento
        continue;
      }
      if (insertada?.id) {
        await deleteById(STORE.VENTAS, _tempId);
        await upsertOne(STORE.VENTAS, { ...ventaSinId, id: insertada.id });
        subidas++;
      }
    } catch (_) {
      // Sin conexión u otro error: se reintentará en el próximo sync
    }
  }
  return subidas;
}

// ─────────────────────── Cola de escrituras pendientes ─────────────────────

export async function encolarEscritura(
  entry: Omit<ColaEscritura, "id" | "timestamp" | "intentos">,
): Promise<void> {
  await upsertOne(STORE.COLA_ESCRITURAS, {
    ...entry,
    timestamp: Date.now(),
    intentos: 0,
  });
}

export async function procesarColaEscrituras(): Promise<number> {
  const cola = await getAll<ColaEscritura>(STORE.COLA_ESCRITURAS);
  if (cola.length === 0) return 0;

  let exitos = 0;
  for (const item of cola) {
    if ((item.intentos ?? 0) >= 10) {
      await deleteById(STORE.COLA_ESCRITURAS, item.id!);
      continue;
    }

    try {
      let error: any = null;

      if (item.operacion === "insert") {
        ({ error } = await supabase.from(item.tabla).insert(item.datos));
      } else if (item.operacion === "upsert") {
        ({ error } = await supabase.from(item.tabla).upsert(item.datos));
      } else if (item.operacion === "update" && item.donde) {
        let q = supabase.from(item.tabla).update(item.datos);
        for (const [campo, valor] of Object.entries(item.donde)) {
          q = (q as any).eq(campo, valor);
        }
        ({ error } = await q);
      } else if (item.operacion === "delete" && item.donde) {
        let q = supabase.from(item.tabla).delete();
        for (const [campo, valor] of Object.entries(item.donde)) {
          q = (q as any).eq(campo, valor);
        }
        ({ error } = await q);
      }

      if (error) {
        if (error.code === "23505" || error.status === 409) {
          await deleteById(STORE.COLA_ESCRITURAS, item.id!);
          exitos++;
        } else {
          await upsertOne(STORE.COLA_ESCRITURAS, {
            ...item,
            intentos: (item.intentos ?? 0) + 1,
            ultimo_error: error.message,
          });
        }
      } else {
        await deleteById(STORE.COLA_ESCRITURAS, item.id!);
        exitos++;
      }
    } catch (err: any) {
      await upsertOne(STORE.COLA_ESCRITURAS, {
        ...item,
        intentos: (item.intentos ?? 0) + 1,
        ultimo_error: err?.message ?? String(err),
      });
    }
  }

  return exitos;
}

export async function contarColaEscrituras(): Promise<number> {
  const cola = await getAll(STORE.COLA_ESCRITURAS);
  return cola.length;
}

// ─────────────────────── Verificar si IDB está vacío ──────────────────────

export async function necesitaSyncInicial(): Promise<boolean> {
  try {
    const usuarios = await getAll(STORE.USUARIOS);
    return usuarios.length === 0;
  } catch {
    return true;
  }
}

// ─────────────────────── Sincronización TOTAL desde Supabase ───────────────

export async function sincronizarTodoDesdeSupabase(
  onProgress?: (p: SyncProgress) => void,
): Promise<void> {
  const report = (
    tabla: string,
    filas: number,
    status: "ok" | "error" | "skip",
    error?: string,
  ) => {
    onProgress?.({ tabla, filas, status, error });
    if (status === "error")
      console.warn(`[localDB] sync "${tabla}" error:`, error);
    else console.log(`[localDB] sync "${tabla}": ${filas} filas`);
  };

  const tablasCatalogo = [
    { tabla: "usuarios", store: STORE.USUARIOS },
    { tabla: "productos", store: STORE.PRODUCTOS },
    { tabla: "datos_negocio", store: STORE.DATOS_NEGOCIO },
    { tabla: "complementos_opciones", store: STORE.COMPLEMENTOS },
    { tabla: "descuentos_config", store: STORE.DESCUENTOS_CONFIG },
    { tabla: "precio_dolar", store: STORE.PRECIO_DOLAR },
    { tabla: "claves_autorizacion", store: STORE.CLAVES_AUTORIZACION },
    { tabla: "cai_facturas", store: STORE.CAI_FACTURAS },
    // Catálogos v3
    { tabla: "clientes_credito", store: STORE.CLIENTES_CREDITO },
    { tabla: "costo_delivery", store: STORE.COSTO_DELIVERY },
    { tabla: "etiquetas_config", store: STORE.ETIQUETAS_CONFIG },
    { tabla: "impresoras_config", store: STORE.IMPRESORAS_CONFIG },
    { tabla: "recibo_config", store: STORE.RECIBO_CONFIG },
    { tabla: "proveedores", store: STORE.PROVEEDORES },
    { tabla: "insumos", store: STORE.INSUMOS },
    { tabla: "inventario_config_productos", store: STORE.INVENTARIO_CONFIG },
    { tabla: "stock_productos", store: STORE.STOCK_PRODUCTOS },
    { tabla: "recetas", store: STORE.RECETAS },
    { tabla: "recetas_detalle", store: STORE.RECETAS_DETALLE },
    { tabla: "facturacion_sar", store: STORE.FACTURACION_SAR },
    // Tablas de saldo/resumen sin campo de fecha
    { tabla: "cuentas_por_cobrar", store: STORE.CUENTAS_COBRAR },
    { tabla: "cuentas_por_pagar", store: STORE.CUENTAS_PAGAR },
  ];

  for (const { tabla, store } of tablasCatalogo) {
    try {
      const { data, error } = await supabase.from(tabla).select("*");
      if (error) throw error;
      await clearStore(store);
      await upsertBulk(store, data ?? []);
      report(tabla, (data ?? []).length, "ok");
    } catch (e: any) {
      report(tabla, 0, "error", e?.message);
    }
  }

  const hace7dias = new Date(Date.now() - 7 * 86400000).toISOString();
  const tablasTransaccionales = [
    { tabla: "ventas", store: STORE.VENTAS, campoFecha: "fecha_hora" },
    { tabla: "gastos", store: STORE.GASTOS, campoFecha: "fecha_hora" },
    { tabla: "cierres", store: STORE.CIERRES, campoFecha: "fecha" },
    {
      tabla: "pedidos_envio",
      store: STORE.PEDIDOS_ENVIO,
      campoFecha: "created_at",
    },
    { tabla: "pagosf", store: STORE.PAGOSF, campoFecha: "fecha_hora" },
    // Transaccionales v3
    { tabla: "facturas", store: STORE.FACTURAS, campoFecha: "fecha_hora" },
    {
      tabla: "facturas_credito",
      store: STORE.FACTURAS_CREDITO,
      campoFecha: "fecha_hora",
    },
    { tabla: "pagos", store: STORE.PAGOS, campoFecha: "fecha_hora" },
    {
      tabla: "pagos_credito",
      store: STORE.PAGOS_CREDITO,
      campoFecha: "fecha_hora",
    },
    {
      tabla: "pagos_proveedores",
      store: STORE.PAGOS_PROVEEDORES,
      campoFecha: "fecha_hora",
    },
    {
      tabla: "movimientos_inventario",
      store: STORE.MOVIMIENTOS_INVENTARIO,
      campoFecha: "created_at",
    },
    {
      tabla: "ordenes_produccion",
      store: STORE.ORDENES_PRODUCCION,
      campoFecha: "created_at",
    },
    {
      tabla: "ordenes_produccion_detalle",
      store: STORE.ORDENES_PRODUCCION_DET,
      campoFecha: "created_at",
    },
  ];

  for (const { tabla, store, campoFecha } of tablasTransaccionales) {
    try {
      const { data, error } = await supabase
        .from(tabla)
        .select("*")
        .gte(campoFecha, hace7dias)
        .order("id", { ascending: false })
        .limit(5000);
      if (error) throw error;
      // Preservar registros con id negativo (pendientes offline, aún no subidos a Supabase)
      const existentes = await getAll<any>(store);
      const pendientesOffline = existentes.filter(
        (r) => typeof r.id === "number" && r.id < 0,
      );
      await clearStore(store);
      await upsertBulk(store, data ?? []);
      // Reinsertar los pendientes offline que aún no llegaron a Supabase
      for (const p of pendientesOffline) {
        await upsertOne(store, p);
      }
      report(tabla, (data ?? []).length, "ok");
    } catch (e: any) {
      report(tabla, 0, "error", e?.message);
    }
  }

  await upsertOne(STORE.SYNC_META, {
    table: "_full_sync",
    last_sync: Date.now(),
    total_rows: 0,
  });

  console.log("[localDB] sincronizarTodoDesdeSupabase ✓");
}

// alias usado en AperturaView.tsx
export async function sincronizarAlApertura(
  cajeroId: string,
  _aperturaId?: number,
): Promise<void> {
  await sincronizarTodoDesdeSupabase();
  await sincronizarDiaActual(cajeroId);
}

export async function sincronizarDiaActual(cajeroId?: string): Promise<void> {
  const hoy = new Date().toISOString().slice(0, 10);
  if (!cajeroId) return;
  try {
    const { data } = await supabase
      .from("ventas")
      .select("*")
      .eq("cajero_id", cajeroId)
      .gte("fecha_hora", hoy)
      .order("id", { ascending: false })
      .limit(500);
    if (data && data.length > 0) await upsertBulk(STORE.VENTAS, data);
  } catch {
    /* silencioso */
  }
  try {
    const { data } = await supabase
      .from("gastos")
      .select("*")
      .eq("cajero_id", cajeroId)
      .gte("fecha_hora", hoy);
    if (data && data.length > 0) await upsertBulk(STORE.GASTOS, data);
  } catch {
    /* silencioso */
  }
}

// ─────────────────── Login offline ────────────────────────────────────────

export async function loginOffline(
  codigo: string,
  clave: string,
): Promise<any | null> {
  try {
    const usuarios = await getAll(STORE.USUARIOS);
    return (
      usuarios.find((u) => u.codigo === codigo && u.clave === clave) ?? null
    );
  } catch {
    return null;
  }
}

// ─────────────────── Helpers por dominio ──────────────────────────────────

export async function getDatosNegocioLocal(): Promise<any | null> {
  try {
    const rows = await getAll(STORE.DATOS_NEGOCIO);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function getProductosLocal(): Promise<any[]> {
  const prods = await getAll(STORE.PRODUCTOS);
  return prods.sort((a, b) => (a.codigo ?? 0) - (b.codigo ?? 0));
}

// alias
export async function getProductos(): Promise<any[]> {
  return getProductosLocal();
}

export async function getCaiActivo(cajeroId: string): Promise<any | undefined> {
  const cais = await getByIndex(STORE.CAI_FACTURAS, "cajero_id", cajeroId);
  return cais.find((c) => c.activo === true);
}

// alias
export async function getCaiActuivo(
  cajeroId: string,
): Promise<any | undefined> {
  return getCaiActivo(cajeroId);
}

export async function getAperturaActiva(
  cajeroId: string,
): Promise<any | undefined> {
  const cierres = await getByIndex(STORE.CIERRES, "cajero_id", cajeroId);

  // Buscar la apertura más reciente sin filtro de fecha
  // (los turnos de medianoche abren ayer y cierran hoy)
  const aperturasIDB = cierres
    .filter((c) => c.estado === "APERTURA")
    .sort(
      (a, b) =>
        new Date(b.fecha ?? 0).getTime() - new Date(a.fecha ?? 0).getTime(),
    );
  if (aperturasIDB[0]) return aperturasIDB[0];

  // Fallback: LocalStorage (por si IDB está vacío tras F5 sin internet)
  try {
    const rawLS = localStorage.getItem("apertura_cajero");
    if (rawLS) {
      const lsAp = JSON.parse(rawLS);
      if (lsAp?.cajero_id === cajeroId) {
        const numId =
          parseInt(lsAp.id as string) > 0
            ? parseInt(lsAp.id as string)
            : -Date.now();
        const aperturaObj = { ...lsAp, id: numId, estado: "APERTURA" };
        // Solo guardar en IDB si NO hay un CIERRE activo (no pisar el cierre)
        const hayCierre = cierres.some((c) => c.estado === "CIERRE");
        if (!hayCierre) {
          await upsertOne(STORE.CIERRES, aperturaObj);
          console.log(
            "[getAperturaActiva] Apertura rescatada de localStorage → STORE.CIERRES",
          );
        }
        return aperturaObj;
      }
    }
  } catch {
    /* localStorage no disponible */
  }
  return undefined;
}

export async function getVentasPorCajero(cajeroId: string): Promise<any[]> {
  return getByIndex(STORE.VENTAS, "cajero_id", cajeroId);
}

export async function getGastosPorCajero(cajeroId: string): Promise<any[]> {
  return getByIndex(STORE.GASTOS, "cajero_id", cajeroId);
}

export async function getPrecioDolarLocal(): Promise<number> {
  const rows = await getAll(STORE.PRECIO_DOLAR);
  return rows[0]?.valor ?? 0;
}

// alias
export async function getPrecioDolar(): Promise<number> {
  return getPrecioDolarLocal();
}

export async function getDescuentosConfigLocal(): Promise<any[]> {
  return getAll(STORE.DESCUENTOS_CONFIG);
}

export async function getComplementosLocal(): Promise<any[]> {
  return getAll(STORE.COMPLEMENTOS);
}

export async function getUsuariosLocal(): Promise<any[]> {
  return getAll(STORE.USUARIOS);
}

// ─────────────────── Resumen Turno local ─────────────────────────────────

export async function calcularResumenTurno(
  aperturaId: number,
  cajeroId: string,
): Promise<ResumenTurno | null> {
  try {
    const apertura = await getById(STORE.CIERRES, aperturaId);
    if (!apertura) return null;

    // Determinar rango de tiempo del turno
    const fechaAperturaStr = apertura.fecha ?? new Date().toISOString();
    const tsApertura = new Date(fechaAperturaStr).getTime();

    // Buscar el cierre posterior del mismo cajero/caja
    const todosLosCierres = await getByIndex<any>(
      STORE.CIERRES,
      "cajero_id",
      cajeroId,
    );
    const cierrePost = todosLosCierres
      .filter(
        (c) =>
          (c.estado === "CIERRE" || c.tipo_registro === "cierre") &&
          c.caja === apertura.caja &&
          new Date(c.fecha ?? 0).getTime() > tsApertura,
      )
      .sort(
        (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
      )[0];
    const tsCierre = cierrePost
      ? new Date(cierrePost.fecha).getTime()
      : Date.now();

    const todasLasVentas = await getByIndex<any>(
      STORE.VENTAS,
      "cajero_id",
      cajeroId,
    );

    // Filtrar por rango de tiempo del turno, igual que la vista SQL
    const ventasTurno = todasLasVentas.filter((v) => {
      const ts = new Date(v.fecha_hora ?? 0).getTime();
      return ts >= tsApertura && ts < tsCierre && v.tipo !== "CREDITO";
    });
    const ventasNormales = ventasTurno.filter((v) => v.es_donacion !== true);
    const donaciones = ventasTurno.filter((v) => v.es_donacion === true);

    const todosLosGastos = await getByIndex<any>(
      STORE.GASTOS,
      "cajero_id",
      cajeroId,
    );
    const gastosDia = todosLosGastos
      .filter((g) => {
        const ts = new Date(g.fecha_hora ?? g.fecha ?? 0).getTime();
        return (
          ts >= tsApertura &&
          ts < tsCierre &&
          (g.caja === apertura.caja || !g.caja)
        );
      })
      .reduce((acc, g) => acc + parseFloat(g.monto ?? 0), 0);

    const sumar = (arr: any[], campo: string) =>
      arr.reduce((acc, v) => acc + parseFloat(v[campo] ?? 0), 0);

    // Tipo real en BD es 'comida' (no 'platillo')
    // factor: -1 para devoluciones (restan), +1 para ventas normales
    const contarTipo = (arr: any[], tipo: string) => {
      let count = 0;
      arr.forEach((v) => {
        const factor = v.tipo === "DEVOLUCION" ? -1 : 1;
        try {
          const prods: any[] =
            typeof v.productos === "string"
              ? JSON.parse(v.productos)
              : (v.productos ?? []);
          prods.forEach((p) => {
            if ((p.tipo ?? "").toLowerCase() === tipo.toLowerCase()) {
              count += factor * parseInt(p.cantidad ?? p.qty ?? 1);
            }
          });
        } catch {
          /* ignorar */
        }
      });
      return count;
    };

    const platillosVendidos = contarTipo(ventasNormales, "comida");
    const bebidasVendidas = contarTipo(ventasNormales, "bebida");
    const platillosDonados = contarTipo(donaciones, "comida");
    const bebidasDonadas = contarTipo(donaciones, "bebida");
    const gastosSum = gastosDia;

    // Calcular como en la vista SQL v_resumen_turnos:
    // efectivo_bruto = SUM(efectivo)
    // cambio_devuelto = SUM(cambio)
    // efectivo_neto = efectivo_bruto - cambio_devuelto - total_gastos
    const efectivoBruto = sumar(ventasNormales, "efectivo");
    const cambioTotal = sumar(ventasNormales, "cambio");
    const efectivoNeto = efectivoBruto - cambioTotal - gastosSum;

    const resumen: ResumenTurno = {
      apertura_id: aperturaId,
      cajero_id: cajeroId,
      nombre_cajero: apertura.cajero ?? "",
      caja: apertura.caja ?? "",
      fecha_apertura: apertura.fecha ?? "",
      fecha_cierre: null,
      efectivo_bruto: efectivoBruto,
      efectivo_neto: efectivoNeto,
      cambio_devuelto: cambioTotal,
      gastos: gastosSum,
      tarjeta: sumar(ventasNormales, "tarjeta"),
      transferencia: sumar(ventasNormales, "transferencia"),
      dolares_usd: sumar(ventasNormales, "dolares_usd"),
      dolares_lps: sumar(ventasNormales, "dolares"),
      total_ventas: sumar(ventasNormales, "total"),
      platillos_vendidos: platillosVendidos,
      bebidas_vendidas: bebidasVendidas,
      platillos_donados: platillosDonados,
      bebidas_donadas: bebidasDonadas,
      total_platillos: platillosVendidos + platillosDonados,
      total_bebidas: bebidasVendidas + bebidasDonadas,
    };

    await upsertOne(STORE.RESUMEN_TURNOS, resumen);
    return resumen;
  } catch (err) {
    console.error("[localDB] calcularResumenTurno:", err);
    return null;
  }
}

export async function getResumenTurno(
  aperturaId: number,
  cajeroId: string,
  forzarRecalculo = false,
): Promise<ResumenTurno | null> {
  if (!forzarRecalculo) {
    const cached = await getById<ResumenTurno>(
      STORE.RESUMEN_TURNOS,
      aperturaId,
    );
    if (cached) return cached;
  }
  return calcularResumenTurno(aperturaId, cajeroId);
}

// ─────────────────── Escritura dual (IDB + cola Supabase) ─────────────────

export async function guardarVentaLocal(
  venta: any,
  aperturaId?: number | null,
): Promise<void> {
  // Si la venta no tiene id (viene del flujo Supabase que lo asigna), usar id temporal negativo
  const ventaConId = venta.id != null ? venta : { ...venta, id: -Date.now() };
  await upsertOne(STORE.VENTAS, ventaConId);
  await encolarEscritura({
    tabla: "ventas",
    operacion: "insert",
    datos: ventaConId,
  });
  if (aperturaId && ventaConId.cajero_id) {
    calcularResumenTurno(aperturaId, ventaConId.cajero_id).catch(() => {});
  }
}

export async function guardarGastoLocal(
  gasto: any,
  aperturaId?: number | null,
): Promise<void> {
  await upsertOne(STORE.GASTOS, gasto);
  await encolarEscritura({
    tabla: "gastos",
    operacion: "insert",
    datos: gasto,
  });
  if (aperturaId && gasto.cajero_id) {
    calcularResumenTurno(aperturaId, gasto.cajero_id).catch(() => {});
  }
}

export async function guardarAperturaLocal(cierre: any): Promise<void> {
  await upsertOne(STORE.CIERRES, cierre);
  await encolarEscritura({
    tabla: "cierres",
    operacion: "insert",
    datos: cierre,
  });
}

export async function guardarCierreLocal(cierre: any): Promise<void> {
  await upsertOne(STORE.CIERRES, cierre);
  await encolarEscritura({
    tabla: "cierres",
    operacion: "upsert",
    datos: cierre,
  });
}

export async function guardarPedidoLocal(pedido: any): Promise<void> {
  await upsertOne(STORE.PEDIDOS_ENVIO, pedido);
  await encolarEscritura({
    tabla: "pedidos_envio",
    operacion: "insert",
    datos: pedido,
  });
}

// ─────────────────── Inicialización de la app ─────────────────────────────

export async function inicializarAppOffline(
  onProgress?: (p: SyncProgress) => void,
): Promise<"synced" | "already_has_data" | "offline_no_data" | "error"> {
  try {
    await openLocalDB();
    const vacio = await necesitaSyncInicial();

    if (!vacio) {
      if (navigator.onLine) {
        sincronizarTodoDesdeSupabase().catch(() => {});
        procesarColaEscrituras().catch(() => {});
      }
      return "already_has_data";
    }

    if (!navigator.onLine) {
      console.warn("[localDB] App sin internet y sin datos locales");
      return "offline_no_data";
    }

    await sincronizarTodoDesdeSupabase(onProgress);
    return "synced";
  } catch (err) {
    console.error("[localDB] inicializarAppOffline error:", err);
    return "error";
  }
}

// Escuchar reconexión
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("[localDB] Conexión restaurada → procesando cola...");
    procesarColaEscrituras()
      .then(
        (n) => n > 0 && console.log(`[localDB] ${n} escrituras sincronizadas`),
      )
      .catch((e) => console.warn("[localDB] error cola:", e));
    sincronizarTodoDesdeSupabase().catch(() => {});
  });
}
