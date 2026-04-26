import { supabase } from "../supabaseClient";
import { STORE, getAll, upsertBulk, upsertOne } from "../utils/localDB";

export type TipoVentaConfig = "ambos" | "solo_recibo" | "solo_factura";

export interface PosConfig {
  id: number;
  credito_habilitado: boolean;
  piezas_habilitado: boolean;
  complementos_habilitado: boolean;
  descuento_habilitado: boolean;
  menu_bloqueado: boolean;
  tipo_venta: TipoVentaConfig;
  updated_at?: string | null;
}

export interface OpcionSimple {
  id: number;
  nombre: string;
  orden: number;
}

export const DEFAULT_POS_CONFIG: PosConfig = {
  id: 1,
  credito_habilitado: true,
  piezas_habilitado: true,
  complementos_habilitado: true,
  descuento_habilitado: true,
  menu_bloqueado: false,
  tipo_venta: "ambos",
};

const PIEZAS_FALLBACK: OpcionSimple[] = [
  { id: 1, nombre: "PIEZAS VARIAS", orden: 1 },
  { id: 2, nombre: "PECHUGA", orden: 2 },
  { id: 3, nombre: "ALA", orden: 3 },
  { id: 4, nombre: "CADERA", orden: 4 },
  { id: 5, nombre: "PIERNA", orden: 5 },
];

const normalizarTipoVenta = (value: any): TipoVentaConfig => {
  if (
    value === "solo_recibo" ||
    value === "solo_factura" ||
    value === "ambos"
  ) {
    return value;
  }
  if (value === "solo recibo") return "solo_recibo";
  if (value === "solo factura") return "solo_factura";
  return "ambos";
};

export const normalizarPosConfig = (raw: any): PosConfig => {
  const data = raw || {};
  return {
    id: Number(data.id || 1),
    credito_habilitado: data.credito_habilitado !== false,
    piezas_habilitado: data.piezas_habilitado !== false,
    complementos_habilitado: data.complementos_habilitado !== false,
    descuento_habilitado: data.descuento_habilitado !== false,
    menu_bloqueado: data.menu_bloqueado === true,
    tipo_venta: normalizarTipoVenta(data.tipo_venta),
    updated_at: data.updated_at ?? null,
  };
};

export async function obtenerPosConfig(): Promise<PosConfig> {
  try {
    const local = await getAll<any>(STORE.POS_CONFIG);
    if (local.length > 0) return normalizarPosConfig(local[0]);
  } catch {
    // ignore
  }

  try {
    const { data } = await supabase
      .from("configuraciones_pos")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (data) {
      const cfg = normalizarPosConfig(data);
      await upsertOne(STORE.POS_CONFIG, cfg);
      return cfg;
    }
  } catch {
    // ignore
  }

  await upsertOne(STORE.POS_CONFIG, DEFAULT_POS_CONFIG);
  return DEFAULT_POS_CONFIG;
}

export async function guardarPosConfig(config: PosConfig): Promise<PosConfig> {
  const payload = normalizarPosConfig(config);

  await upsertOne(STORE.POS_CONFIG, payload);

  try {
    const { data } = await supabase
      .from("configuraciones_pos")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .maybeSingle();

    if (data) {
      const synced = normalizarPosConfig(data);
      await upsertOne(STORE.POS_CONFIG, synced);
      return synced;
    }
  } catch {
    // fallback local-only
  }

  return payload;
}

export async function obtenerPiezasOpciones(): Promise<OpcionSimple[]> {
  try {
    const local = await getAll<OpcionSimple>(STORE.PIEZAS_OPCIONES);
    if (local.length > 0) {
      return [...local].sort((a, b) => (a.orden || 0) - (b.orden || 0));
    }
  } catch {
    // ignore
  }

  try {
    const { data } = await supabase
      .from("piezas_opciones")
      .select("id, nombre, orden")
      .order("orden", { ascending: true });

    if (data && data.length > 0) {
      await upsertBulk(STORE.PIEZAS_OPCIONES, data);
      return data;
    }
  } catch {
    // ignore
  }

  await upsertBulk(STORE.PIEZAS_OPCIONES, PIEZAS_FALLBACK);
  return PIEZAS_FALLBACK;
}
