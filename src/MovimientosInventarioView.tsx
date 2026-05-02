import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { supabase } from "./supabaseClient";

interface MovimientosInventarioViewProps {
  onBack: () => void;
  onLogout?: () => void;
}

interface Insumo {
  id: string;
  nombre: string;
  unidad: string;
  categoria?: string;
  stock_actual?: number;
  stock_minimo?: number;
  costo_unitario?: number;
}

interface Producto {
  id: string;
  nombre: string;
  tipo: string;
  precio?: number;
}

interface ResumenInventarioItem {
  id: string;
  tipo_item: "insumo" | "producto";
  nombre: string;
  categoria: string;
  unidad: string;
  stock_actual: number;
  stock_minimo: number;
  costo_unitario: number;
  valor_total: number;
  alerta_stock_bajo: boolean;
}

interface MovimientoInventario {
  id: string;
  item_tipo?: "insumo" | "producto";
  tipo: string;
  referencia_tipo?: string | null;
  referencia_id?: string | null;
  insumo_id?: string | null;
  producto_id?: string | null;
  cantidad: number;
  costo_unitario?: number;
  nota?: string | null;
  cajero?: string | null;
  created_at: string;
  insumos?: { nombre: string } | null;
  productos?: { nombre: string } | null;
}

interface OrdenProduccion {
  id: string;
  numero_orden?: number;
  fecha?: string;
  estado: string;
  producto_id?: string | null;
  cantidad_producida?: number | null;
  notas?: string | null;
  created_at: string;
  productos?: { nombre: string } | null;
}

interface ConfigProducto {
  producto_id: string;
  controla_inventario: boolean;
  modo_consumo: "receta" | "stock_producto" | "sin_control";
  permite_stock_negativo?: boolean;
}

interface RecetaDetalle {
  id?: string;
  receta_id?: string;
  tipo_item: "insumo" | "complemento";
  insumo_id: string;
  complemento_id?: string;
  cantidad: string;
  unidad?: string;
}

/** Fila de movimiento para el reporte de producción/ventas */
interface ReporteMovRow {
  id: string;
  item_tipo: string;
  tipo: string;
  referencia_id: string | null;
  insumo_id: string | null;
  producto_id: string | null;
  cantidad: number;
  costo_unitario: number;
  nota: string | null;
  cajero: string | null;
  created_at: string;
  nombre_item: string;
  unidad: string;
  costo_total: number;
}

/** Fila de stock de bebida (productos tipo='bebida') */
interface StockBebida {
  id: string;
  nombre: string;
  precio: number;
  stock_actual: number;
  stock_minimo: number;
  costo_promedio: number;
  valor_total: number;
  alerta: boolean;
  total_entradas: number;
  total_salidas: number;
}

/** Fila de insumo con su stock calculado desde movimientos */
interface StockInsumoRow {
  id: string;
  nombre: string;
  unidad: string;
  categoria: string;
  stock_actual: number;
  stock_minimo: number;
  costo_unitario: number;
  valor_total: number;
  alerta: boolean;
  total_entradas: number;
  total_salidas: number;
}

type TabKey =
  | "resumen"
  | "recetas"
  | "movimientos"
  | "produccion"
  | "stock"
  | "insumos"
  | "bebidas";

type MovementFormState = {
  /** "insumo" o cualquier valor de productos.tipo (excepto "comida") */
  itemType: string;
  itemId: string;
  tipoMovimiento: "entrada" | "salida";
  cantidad: string;
  referenciaTipo: string;
  referenciaId: string;
  nota: string;
};

type RecipeFormState = {
  productoId: string;
  modoConsumo: "receta" | "stock_producto" | "sin_control";
  rendimiento: string;
  descripcion: string;
  detalles: RecetaDetalle[];
};

const MOVEMENT_TYPES = [
  { value: "entrada", label: "⬆ Entrada" },
  { value: "salida", label: "⬇ Salida" },
] as const;

const CONSUMPTION_MODES = [
  {
    value: "receta",
    label: "Consumir receta al vender",
    help: "Ideal para comidas preparadas que descuentan insumos automáticamente.",
  },
  {
    value: "stock_producto",
    label: "Manejar stock de producto terminado",
    help: "Ideal para bebidas, complementos o productos ya elaborados.",
  },
  {
    value: "sin_control",
    label: "No controlar inventario",
    help: "Solo usar cuando no deseas afectar existencias por venta.",
  },
] as const;

const initialMovementForm: MovementFormState = {
  itemType: "insumo",
  itemId: "",
  tipoMovimiento: "entrada",
  cantidad: "",
  referenciaTipo: "manual",
  referenciaId: "",
  nota: "",
};

const initialRecipeForm: RecipeFormState = {
  productoId: "",
  modoConsumo: "receta",
  rendimiento: "1",
  descripcion: "",
  detalles: [
    {
      tipo_item: "insumo" as const,
      insumo_id: "",
      complemento_id: "",
      cantidad: "",
      unidad: "",
    },
  ],
};

const money = new Intl.NumberFormat("es-HN", {
  style: "currency",
  currency: "HNL",
  minimumFractionDigits: 2,
});

const dateTime = new Intl.DateTimeFormat("es-HN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function getCurrentUser() {
  try {
    const stored = localStorage.getItem("usuario");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function isMissingRelationError(error: any) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("no existe") ||
    message.includes("could not find") ||
    message.includes("schema cache")
  );
}

function numberValue(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  return value || null;
}

function normalizeMovimientoRows(data: any[]): MovimientoInventario[] {
  return data.map((item) => ({
    id: String(item.id),
    item_tipo: item.item_tipo,
    tipo: String(item.tipo),
    referencia_tipo: item.referencia_tipo,
    referencia_id: item.referencia_id,
    insumo_id: item.insumo_id,
    producto_id: item.producto_id,
    cantidad: numberValue(item.cantidad),
    costo_unitario: numberValue(item.costo_unitario),
    nota: item.nota,
    cajero: item.cajero,
    created_at: String(item.created_at),
    insumos: normalizeRelation(item.insumos),
    productos: normalizeRelation(item.productos),
  }));
}

function normalizeOrdenRows(data: any[]): OrdenProduccion[] {
  return data.map((item) => ({
    id: String(item.id),
    numero_orden: item.numero_orden ? Number(item.numero_orden) : undefined,
    fecha: item.fecha || undefined,
    estado: String(item.estado),
    producto_id: item.producto_id,
    cantidad_producida:
      item.cantidad_producida !== null && item.cantidad_producida !== undefined
        ? numberValue(item.cantidad_producida)
        : null,
    notas: item.notas,
    created_at: String(item.created_at),
    productos: normalizeRelation(item.productos),
  }));
}

export default function MovimientosInventarioView({
  onBack,
  onLogout,
}: MovimientosInventarioViewProps) {
  const usuarioActual = getCurrentUser();
  const [activeTab, setActiveTab] = useState<TabKey>("resumen");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupNotes, setSetupNotes] = useState<string[]>([]);

  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [resumen, setResumen] = useState<ResumenInventarioItem[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoInventario[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenProduccion[]>([]);
  const [configs, setConfigs] = useState<ConfigProducto[]>([]);

  const [movementForm, setMovementForm] =
    useState<MovementFormState>(initialMovementForm);
  const [newInsumoForm, setNewInsumoForm] = useState({
    nombre: "",
    unidad: "unidad",
    categoria: "general",
  });
  const [recipeForm, setRecipeForm] =
    useState<RecipeFormState>(initialRecipeForm);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);

  // --- Reporte de producción / ventas ---
  const [reportFechaDesde, setReportFechaDesde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [reportFechaHasta, setReportFechaHasta] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reportRows, setReportRows] = useState<ReporteMovRow[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportGenerado, setReportGenerado] = useState(false);

  // --- Tab Stock ---
  const [stockFiltro, setStockFiltro] = useState<"insumos" | "bebidas">(
    "insumos",
  );
  const [stockBebidas, setStockBebidas] = useState<StockBebida[]>([]);
  const [stockInsumos, setStockInsumos] = useState<StockInsumoRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  // --- Modal de configuración de umbrales de stock ---
  const [stockConfigModal, setStockConfigModal] = useState<{
    open: boolean;
    tipo: "insumo" | "bebida";
    id: string;
    nombre: string;
    minimo: string;
    precaucion: string;
  } | null>(null);
  const [savingStockConfig, setSavingStockConfig] = useState(false);

  // --- Tab Insumos: agregar insumo ---
  const [newInsumoTabOpen, setNewInsumoTabOpen] = useState(false);
  const [creatingInsumo, setCreatingInsumo] = useState(false);

  // --- Modal editar insumo ---
  const [editInsumoModal, setEditInsumoModal] = useState<{
    id: string;
    nombre: string;
    unidad: string;
    categoria: string;
    stock_minimo: string;
  } | null>(null);
  const [savingEditInsumo, setSavingEditInsumo] = useState(false);

  // --- Modal "Registrar movimiento" ---
  const [movFormModalOpen, setMovFormModalOpen] = useState(false);

  // --- Modal editar movimiento ---
  const [editMovModal, setEditMovModal] = useState<{
    id: string;
    nombre_item: string;
    tipo: string;
    nota: string;
    referencia_tipo: string;
    referencia_id: string;
  } | null>(null);
  const [savingEditMov, setSavingEditMov] = useState(false);

  // Mapa de stock_precaucion almacenado en localStorage por id de item
  const [stockPrecaucionMap, setStockPrecaucionMap] = useState<
    Record<string, number>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("inv_stock_precaucion") || "{}");
    } catch {
      return {};
    }
  });

  const inventoryItems = useMemo(() => {
    if (movementForm.itemType === "insumo") return insumos;
    return productos.filter((p) => p.tipo === movementForm.itemType);
  }, [insumos, movementForm.itemType, productos]);

  /** Tipos únicos de productos (excluye "comida") para el selector de tipo de item */
  const productTipos = useMemo(() => {
    const set = new Set(
      productos.map((p) => p.tipo).filter((t) => Boolean(t) && t !== "comida"),
    );
    return Array.from(set).sort();
  }, [productos]);

  /** Insumos filtrados por el texto escrito en el combobox del formulario de movimiento */
  const lowStockCount = useMemo(
    () => resumen.filter((item) => item.alerta_stock_bajo).length,
    [resumen],
  );

  const todayMovementCount = useMemo(() => {
    const today = new Date().toDateString();
    return movimientos.filter(
      (item) => new Date(item.created_at).toDateString() === today,
    ).length;
  }, [movimientos]);

  const todayProductionCount = useMemo(() => {
    const today = new Date().toDateString();
    return ordenes.filter(
      (item) => new Date(item.created_at).toDateString() === today,
    ).length;
  }, [ordenes]);

  const selectedRecipeProduct = useMemo(
    () => productos.find((product) => product.id === recipeForm.productoId),
    [productos, recipeForm.productoId],
  );
  const isRecipeProductComplemento =
    selectedRecipeProduct?.tipo === "complemento";

  const loadResumen = async () => {
    const primary = await supabase
      .from("v_inventario_resumen")
      .select("*")
      .order("tipo_item")
      .order("nombre");

    if (!primary.error) {
      return (primary.data || []) as ResumenInventarioItem[];
    }

    const fallback = await supabase
      .from("v_stock_alertas")
      .select("*")
      .order("tipo_item")
      .order("nombre");

    if (fallback.error) {
      throw fallback.error;
    }

    return (fallback.data || []) as ResumenInventarioItem[];
  };

  const loadEverything = async () => {
    setLoading(true);
    setError("");
    setMessage("");

    const notes: string[] = [];
    let needsSetup = false;

    const [
      resumenResult,
      insumosResult,
      productosResult,
      movimientosResult,
      ordenesResult,
      configResult,
    ] = await Promise.allSettled([
      loadResumen(),
      supabase
        .from("insumos")
        .select(
          "id, nombre, unidad, categoria, stock_actual, stock_minimo, costo_unitario",
        )
        .order("nombre"),
      supabase
        .from("productos")
        .select("id, nombre, tipo, precio")
        .order("nombre"),
      supabase
        .from("movimientos_inventario")
        .select(
          "id, item_tipo, tipo, referencia_tipo, referencia_id, insumo_id, producto_id, cantidad, costo_unitario, nota, cajero, created_at, insumos(nombre), productos(nombre)",
        )
        .order("created_at", { ascending: false })
        .limit(120),
      supabase
        .from("ordenes_produccion")
        .select(
          "id, numero_orden, fecha, estado, producto_id, cantidad_producida, notas, created_at, productos(nombre)",
        )
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("inventario_config_productos")
        .select(
          "producto_id, controla_inventario, modo_consumo, permite_stock_negativo",
        ),
    ]);

    if (resumenResult.status === "fulfilled") {
      setResumen(resumenResult.value);
    } else {
      setResumen([]);
      if (isMissingRelationError(resumenResult.reason)) {
        needsSetup = true;
        notes.push("La vista de resumen no existe todavía en Supabase.");
      }
    }

    if (insumosResult.status === "fulfilled") {
      if (insumosResult.value.error) {
        if (isMissingRelationError(insumosResult.value.error)) {
          needsSetup = true;
          notes.push("La tabla de insumos aún no fue creada.");
          setInsumos([]);
        } else {
          throw insumosResult.value.error;
        }
      } else {
        setInsumos((insumosResult.value.data || []) as Insumo[]);
      }
    }

    if (productosResult.status === "fulfilled") {
      if (productosResult.value.error) {
        throw productosResult.value.error;
      }
      setProductos((productosResult.value.data || []) as Producto[]);
    }

    if (movimientosResult.status === "fulfilled") {
      if (movimientosResult.value.error) {
        if (isMissingRelationError(movimientosResult.value.error)) {
          needsSetup = true;
          notes.push(
            "La tabla de movimientos de inventario aún no fue creada.",
          );
          setMovimientos([]);
        } else {
          throw movimientosResult.value.error;
        }
      } else {
        setMovimientos(
          normalizeMovimientoRows(movimientosResult.value.data || []),
        );
      }
    }

    if (ordenesResult.status === "fulfilled") {
      if (ordenesResult.value.error) {
        if (isMissingRelationError(ordenesResult.value.error)) {
          needsSetup = true;
          notes.push("La tabla de producción aún no fue creada.");
          setOrdenes([]);
        } else {
          throw ordenesResult.value.error;
        }
      } else {
        setOrdenes(normalizeOrdenRows(ordenesResult.value.data || []));
      }
    }

    if (configResult.status === "fulfilled") {
      if (configResult.value.error) {
        if (isMissingRelationError(configResult.value.error)) {
          needsSetup = true;
          notes.push("La configuración por producto aún no fue creada.");
          setConfigs([]);
        } else {
          throw configResult.value.error;
        }
      } else {
        setConfigs((configResult.value.data || []) as ConfigProducto[]);
      }
    }

    setSetupRequired(needsSetup);
    setSetupNotes(notes);
    setLoading(false);
  };

  useEffect(() => {
    loadEverything().catch((err) => {
      console.error(err);
      setError(err?.message || "No se pudo cargar el sistema de inventario.");
      setLoading(false);
    });
  }, []);

  // Auto-cargar stock al activar la pestaña o cambiar el sub-filtro
  useEffect(() => {
    if (activeTab === "stock" || activeTab === "insumos") {
      loadStockInsumos();
    } else if (activeTab === "bebidas") {
      loadStockBebidas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, stockFiltro]);

  const handleCreateInsumo = async () => {
    const nombre = newInsumoForm.nombre.trim();
    if (!nombre) return;
    setCreatingInsumo(true);
    setError("");
    try {
      const { data, error: insertError } = await supabase
        .from("insumos")
        .insert({
          nombre,
          unidad: newInsumoForm.unidad.trim() || "unidad",
          categoria: newInsumoForm.categoria.trim() || "general",
          stock_actual: 0,
          stock_minimo: 0,
          activo: true,
        })
        .select(
          "id, nombre, unidad, categoria, stock_actual, stock_minimo, costo_unitario",
        )
        .single();

      if (insertError) throw insertError;

      if (data) {
        setInsumos((prev) => [...prev, data as Insumo]);
        setMovementForm((prev) => ({ ...prev, itemId: data.id }));
      }

      setNewInsumoTabOpen(false);
      setNewInsumoForm({
        nombre: "",
        unidad: "unidad",
        categoria: "general",
      });
      setMessage(`Insumo "${nombre}" creado y seleccionado.`);
      loadStockInsumos();
    } catch (err: any) {
      setError(err?.message || "No se pudo crear el insumo.");
    } finally {
      setCreatingInsumo(false);
    }
  };

  const handleSaveEditInsumo = async () => {
    if (!editInsumoModal) return;
    setSavingEditInsumo(true);
    setError("");
    try {
      const { error: upErr } = await supabase
        .from("insumos")
        .update({
          nombre: editInsumoModal.nombre.trim(),
          unidad: editInsumoModal.unidad.trim(),
          categoria: editInsumoModal.categoria.trim() || "general",
          stock_minimo: parseFloat(editInsumoModal.stock_minimo) || 0,
        })
        .eq("id", editInsumoModal.id);
      if (upErr) throw upErr;
      setEditInsumoModal(null);
      setMessage("Insumo actualizado.");
      loadStockInsumos();
    } catch (err: any) {
      setError(err?.message || "No se pudo actualizar el insumo.");
    } finally {
      setSavingEditInsumo(false);
    }
  };

  const loadRecipeForProduct = async (productoId: string) => {
    setRecipeForm((prev) => ({ ...prev, productoId }));
    setRecipeId(null);

    if (!productoId) {
      setRecipeForm(initialRecipeForm);
      return;
    }

    const config = configs.find((item) => item.producto_id === productoId);
    const producto = productos.find((item) => item.id === productoId);
    const forcedModoConsumo =
      producto?.tipo === "complemento"
        ? "receta"
        : config?.modo_consumo || "receta";

    const { data: receta, error: recetaError } = await supabase
      .from("recetas")
      .select("id, producto_id, rendimiento, descripcion")
      .eq("producto_id", productoId)
      .maybeSingle();

    if (recetaError && !isMissingRelationError(recetaError)) {
      setError(recetaError.message || "No se pudo cargar la receta.");
      return;
    }

    if (!receta) {
      setRecipeForm({
        productoId,
        modoConsumo: forcedModoConsumo,
        rendimiento: "1",
        descripcion: "",
        detalles: [
          {
            tipo_item: "insumo" as const,
            insumo_id: "",
            complemento_id: "",
            cantidad: "",
            unidad: "",
          },
        ],
      });
      return;
    }

    const { data: detalles, error: detalleError } = await supabase
      .from("recetas_detalle")
      .select("id, receta_id, insumo_id, complemento_id, cantidad, unidad")
      .eq("receta_id", receta.id)
      .order("created_at", { ascending: true });

    if (detalleError) {
      setError(
        detalleError.message || "No se pudieron cargar los ingredientes.",
      );
      return;
    }

    setRecipeId(receta.id);
    setRecipeForm({
      productoId,
      modoConsumo: forcedModoConsumo,
      rendimiento: String(receta.rendimiento || 1),
      descripcion: receta.descripcion || "",
      detalles: (detalles || []).map((item: any) => ({
        id: item.id,
        receta_id: item.receta_id,
        tipo_item: (item.complemento_id ? "complemento" : "insumo") as
          | "insumo"
          | "complemento",
        insumo_id: item.insumo_id || "",
        complemento_id: item.complemento_id || "",
        cantidad: String(item.cantidad ?? ""),
        unidad: item.unidad || "",
      })) || [
        {
          tipo_item: "insumo" as const,
          insumo_id: "",
          complemento_id: "",
          cantidad: "",
          unidad: "",
        },
      ],
    });
  };

  const handleMovementSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const cantidad = numberValue(movementForm.cantidad);

      if (!movementForm.itemId) {
        throw new Error("Selecciona un insumo o producto.");
      }
      if (cantidad <= 0) {
        throw new Error("La cantidad debe ser mayor a 0.");
      }

      const { error: rpcError } = await supabase.rpc(
        "registrar_movimiento_inventario",
        {
          p_item_tipo:
            movementForm.itemType === "insumo" ? "insumo" : "producto",
          p_item_id: movementForm.itemId,
          p_tipo_movimiento: movementForm.tipoMovimiento,
          p_cantidad: cantidad,
          p_costo_unitario: 0,
          p_referencia_tipo: movementForm.referenciaTipo || "manual",
          p_referencia_id: movementForm.referenciaId || null,
          p_nota: movementForm.nota || null,
          p_cajero: usuarioActual?.nombre || "Administrador",
          p_cajero_id: String(usuarioActual?.id || ""),
          p_modo_estricto: true,
        },
      );

      if (rpcError) {
        throw rpcError;
      }

      setMovementForm(initialMovementForm);
      setMovFormModalOpen(false);
      setMessage("Movimiento registrado correctamente.");
      await loadEverything();
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message ||
          "No se pudo registrar el movimiento. Verifica que el SQL esté instalado.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecipeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      if (!recipeForm.productoId) {
        throw new Error("Selecciona un producto.");
      }

      const currentRecipeProduct =
        productos.find((product) => product.id === recipeForm.productoId) ||
        null;
      const effectiveModoConsumo =
        currentRecipeProduct?.tipo === "complemento"
          ? "receta"
          : recipeForm.modoConsumo;

      const validDetails = recipeForm.detalles.filter(
        (item) =>
          (item.tipo_item === "insumo" &&
            item.insumo_id &&
            numberValue(item.cantidad) > 0) ||
          (item.tipo_item === "complemento" &&
            item.complemento_id &&
            numberValue(item.cantidad) > 0),
      );

      const { error: configError } = await supabase
        .from("inventario_config_productos")
        .upsert(
          {
            producto_id: recipeForm.productoId,
            controla_inventario: effectiveModoConsumo !== "sin_control",
            modo_consumo: effectiveModoConsumo,
            permite_stock_negativo: false,
          },
          { onConflict: "producto_id" },
        );

      if (configError) {
        throw configError;
      }

      if (effectiveModoConsumo === "receta") {
        if (validDetails.length === 0) {
          throw new Error(
            "Agrega al menos un insumo o complemento con cantidad válida.",
          );
        }

        let currentRecipeId = recipeId;

        if (currentRecipeId) {
          const { error: updateError } = await supabase
            .from("recetas")
            .update({
              rendimiento: numberValue(recipeForm.rendimiento) || 1,
              descripcion: recipeForm.descripcion || null,
            })
            .eq("id", currentRecipeId);

          if (updateError) {
            throw updateError;
          }
        } else {
          const { data: insertedRecipe, error: insertError } = await supabase
            .from("recetas")
            .insert([
              {
                producto_id: recipeForm.productoId,
                nombre: selectedRecipeProduct?.nombre || "Receta",
                rendimiento: numberValue(recipeForm.rendimiento) || 1,
                descripcion: recipeForm.descripcion || null,
              },
            ])
            .select("id")
            .single();

          if (insertError) {
            throw insertError;
          }

          currentRecipeId = insertedRecipe.id;
          setRecipeId(currentRecipeId);
        }

        const { error: deleteError } = await supabase
          .from("recetas_detalle")
          .delete()
          .eq("receta_id", currentRecipeId);

        if (deleteError) {
          throw deleteError;
        }

        const detallePayload = validDetails.map((item) => ({
          receta_id: currentRecipeId,
          insumo_id: item.tipo_item === "insumo" ? item.insumo_id : null,
          complemento_id:
            item.tipo_item === "complemento" ? item.complemento_id : null,
          cantidad: numberValue(item.cantidad),
          unidad:
            item.tipo_item === "insumo"
              ? insumos.find((insumo) => insumo.id === item.insumo_id)
                  ?.unidad || "unidad"
              : "unidad",
        }));

        const { error: insertDetailsError } = await supabase
          .from("recetas_detalle")
          .insert(detallePayload);

        if (insertDetailsError) {
          throw insertDetailsError;
        }
      }

      setMessage("Configuración del producto guardada correctamente.");
      await loadEverything();
      await loadRecipeForProduct(recipeForm.productoId);
    } catch (err: any) {
      console.error(err);
      setError(
        err?.message ||
          "No se pudo guardar la receta. Verifica que el SQL esté instalado.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const printReport = (title: string, body: string) => {
    const popup = window.open("", "_blank", "width=1200,height=800");
    if (!popup) return;

    popup.document.write(`
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin-bottom: 8px; }
            p { color: #475569; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; font-size: 12px; }
            th { background: #e2e8f0; }
            .meta { margin-top: 0; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <p class="meta">Generado: ${dateTime.format(new Date())}</p>
          ${body}
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    setTimeout(() => popup.print(), 300);
  };

  const handlePrintSummary = () => {
    const rows = resumen
      .map(
        (item) => `
          <tr>
            <td>${item.tipo_item}</td>
            <td>${item.nombre}</td>
            <td>${item.categoria || "-"}</td>
            <td>${item.unidad || "-"}</td>
            <td>${numberValue(item.stock_actual).toFixed(3)}</td>
            <td>${numberValue(item.stock_minimo).toFixed(3)}</td>
            <td>${money.format(numberValue(item.valor_total))}</td>
            <td>${item.alerta_stock_bajo ? "Sí" : "No"}</td>
          </tr>`,
      )
      .join("");

    printReport(
      "Reporte general de inventario",
      `<table>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Nombre</th>
            <th>Categoría</th>
            <th>Unidad</th>
            <th>Stock</th>
            <th>Mínimo</th>
            <th>Valor</th>
            <th>Alerta</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`,
    );
  };

  const handlePrintMovements = () => {
    const rows = movimientos
      .map(
        (item) => `
          <tr>
            <td>${dateTime.format(new Date(item.created_at))}</td>
            <td>${item.tipo}</td>
            <td>${item.insumos?.nombre || item.productos?.nombre || "-"}</td>
            <td>${item.item_tipo || (item.insumo_id ? "insumo" : "producto")}</td>
            <td>${numberValue(item.cantidad).toFixed(3)}</td>
            <td>${item.referencia_tipo || "-"}</td>
            <td>${item.referencia_id || "-"}</td>
            <td>${item.nota || "-"}</td>
          </tr>`,
      )
      .join("");

    printReport(
      "Reporte de movimientos de inventario",
      `<table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Movimiento</th>
            <th>Item</th>
            <th>Tipo</th>
            <th>Cantidad</th>
            <th>Ref.</th>
            <th>Documento</th>
            <th>Nota</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`,
    );
  };

  // ─── Reporte de producción/ventas ───────────────────────────────────────────
  const loadReporteProduccion = async () => {
    setReportLoading(true);
    setReportRows([]);
    try {
      const { data, error: qErr } = await supabase
        .from("movimientos_inventario")
        .select(
          "id, item_tipo, tipo, referencia_tipo, referencia_id, insumo_id, producto_id, cantidad, costo_unitario, nota, cajero, created_at, insumos(nombre,unidad), productos(nombre)",
        )
        .eq("tipo", "venta")
        .eq("item_tipo", "insumo")
        .gte("created_at", reportFechaDesde + "T00:00:00")
        .lte("created_at", reportFechaHasta + "T23:59:59")
        .order("created_at");
      if (qErr) throw qErr;
      const rows: ReporteMovRow[] = (data || []).map((r: any) => {
        const insumo = Array.isArray(r.insumos) ? r.insumos[0] : r.insumos;
        const prod = Array.isArray(r.productos) ? r.productos[0] : r.productos;
        const nombre = insumo?.nombre || prod?.nombre || "–";
        const unidad = insumo?.unidad || "";
        const costo_total =
          numberValue(r.costo_unitario) * numberValue(r.cantidad);
        return { ...r, nombre_item: nombre, unidad, costo_total };
      });
      setReportRows(rows);
      setReportGenerado(true);
    } catch (err: any) {
      setError(err?.message || "Error al cargar el reporte de producción.");
    } finally {
      setReportLoading(false);
    }
  };

  // Agrupar filas del reporte por día
  const reportPorDia = useMemo(() => {
    const map: Record<
      string,
      { rows: ReporteMovRow[]; costoTotal: number; cantidadTotal: number }
    > = {};
    for (const r of reportRows) {
      const dia = r.created_at.slice(0, 10);
      if (!map[dia]) map[dia] = { rows: [], costoTotal: 0, cantidadTotal: 0 };
      map[dia].rows.push(r);
      map[dia].costoTotal += r.costo_total;
      map[dia].cantidadTotal += numberValue(r.cantidad);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [reportRows]);

  const reportCostoTotales = useMemo(
    () => reportRows.reduce((s, r) => s + r.costo_total, 0),
    [reportRows],
  );

  const handlePrintReporte = () => {
    const diaSections = reportPorDia
      .map(([dia, { rows, costoTotal }]) => {
        const filas = rows
          .map(
            (r) => `<tr>
              <td>${dateTime.format(new Date(r.created_at))}</td>
              <td>${r.item_tipo}</td>
              <td>${r.nombre_item}</td>
              <td>${r.unidad}</td>
              <td style="text-align:right">${numberValue(r.cantidad).toFixed(3)}</td>
              <td style="text-align:right">${money.format(numberValue(r.costo_unitario))}</td>
              <td style="text-align:right">${money.format(r.costo_total)}</td>
              <td>${r.referencia_id || "–"}</td>
              <td>${r.cajero || "–"}</td>
            </tr>`,
          )
          .join("");
        return `<h3 style="margin:18px 0 4px">${dia}</h3>
          <table>
            <thead><tr><th>Hora</th><th>Tipo ítem</th><th>Ítem</th><th>Unidad</th><th>Cantidad</th><th>Costo unit.</th><th>Costo total</th><th>Factura</th><th>Cajero</th></tr></thead>
            <tbody>${filas}</tbody>
            <tfoot><tr><td colspan="6" style="text-align:right;font-weight:700">Total día</td><td style="font-weight:700">${money.format(costoTotal)}</td><td colspan="2"></td></tr></tfoot>
          </table>`;
      })
      .join("");

    printReport(
      `Reporte de consumos por venta — ${reportFechaDesde} al ${reportFechaHasta}`,
      `<p>Total de movimientos: ${reportRows.length} | Costo total: ${money.format(reportCostoTotales)}</p>` +
        diaSections,
    );
  };

  // ─── Stock: bebidas e insumos ────────────────────────────────────────────────
  const loadStockBebidas = async () => {
    setStockLoading(true);
    try {
      const [{ data: prods }, { data: stocks }, { data: movsBebidas }] =
        await Promise.all([
          supabase
            .from("productos")
            .select("id, nombre, precio")
            .eq("tipo", "bebida")
            .order("nombre"),
          supabase
            .from("stock_productos")
            .select("producto_id, stock_actual, stock_minimo, costo_promedio"),
          supabase
            .from("movimientos_inventario")
            .select("producto_id, tipo, cantidad")
            .eq("item_tipo", "producto"),
        ]);

      const stockMap: Record<
        string,
        { stock_actual: number; stock_minimo: number; costo_promedio: number }
      > = {};
      for (const s of stocks || []) {
        stockMap[s.producto_id] = {
          stock_actual: numberValue(s.stock_actual),
          stock_minimo: numberValue(s.stock_minimo),
          costo_promedio: numberValue(s.costo_promedio),
        };
      }

      const movMap: Record<string, { entradas: number; salidas: number }> = {};
      for (const m of movsBebidas || []) {
        if (!m.producto_id) continue;
        if (!movMap[m.producto_id])
          movMap[m.producto_id] = { entradas: 0, salidas: 0 };
        const q = numberValue(m.cantidad);
        if (["entrada", "compra"].includes(m.tipo))
          movMap[m.producto_id].entradas += q;
        else movMap[m.producto_id].salidas += q;
      }

      const rows: StockBebida[] = (prods || []).map((p: any) => {
        const s = stockMap[p.id] || {
          stock_actual: 0,
          stock_minimo: 0,
          costo_promedio: 0,
        };
        const mv = movMap[p.id] || { entradas: 0, salidas: 0 };
        const stockCalculado = mv.entradas - mv.salidas;
        return {
          id: p.id,
          nombre: p.nombre,
          precio: numberValue(p.precio),
          stock_actual: stockCalculado,
          stock_minimo: s.stock_minimo,
          costo_promedio: s.costo_promedio,
          valor_total: stockCalculado * s.costo_promedio,
          alerta: stockCalculado <= s.stock_minimo,
          total_entradas: mv.entradas,
          total_salidas: mv.salidas,
        };
      });
      setStockBebidas(rows);
    } catch (err: any) {
      setError(err?.message || "Error al cargar stock de bebidas.");
    } finally {
      setStockLoading(false);
    }
  };

  const loadStockInsumos = async () => {
    setStockLoading(true);
    try {
      const [{ data: insumosData }, { data: movsData }] = await Promise.all([
        supabase.from("insumos").select("*").order("nombre"),
        supabase
          .from("movimientos_inventario")
          .select("insumo_id, tipo, cantidad")
          .eq("item_tipo", "insumo"),
      ]);

      const movMap: Record<string, { entradas: number; salidas: number }> = {};
      for (const m of movsData || []) {
        if (!m.insumo_id) continue;
        if (!movMap[m.insumo_id])
          movMap[m.insumo_id] = { entradas: 0, salidas: 0 };
        const q = numberValue(m.cantidad);
        if (["entrada", "compra"].includes(m.tipo))
          movMap[m.insumo_id].entradas += q;
        else movMap[m.insumo_id].salidas += q;
      }

      const rows: StockInsumoRow[] = (insumosData || []).map((ins: any) => {
        const mv = movMap[ins.id] || { entradas: 0, salidas: 0 };
        const sa = mv.entradas - mv.salidas;
        const cu = numberValue(ins.costo_unitario);
        return {
          id: ins.id,
          nombre: ins.nombre,
          unidad: ins.unidad,
          categoria: ins.categoria || "–",
          stock_actual: sa,
          stock_minimo: numberValue(ins.stock_minimo),
          costo_unitario: cu,
          valor_total: sa * cu,
          alerta: sa <= numberValue(ins.stock_minimo),
          total_entradas: mv.entradas,
          total_salidas: mv.salidas,
        };
      });
      setStockInsumos(rows);
    } catch (err: any) {
      setError(err?.message || "Error al cargar stock de insumos.");
    } finally {
      setStockLoading(false);
    }
  };

  const handlePrintTomaFisica = (tipo: "insumos" | "bebidas") => {
    const filas =
      tipo === "insumos"
        ? stockInsumos
            .map(
              (r) =>
                `<tr><td>${r.nombre}</td><td>${r.categoria}</td><td>${r.unidad}</td><td style="text-align:right">${r.stock_actual.toFixed(3)}</td><td style="text-align:right">${r.stock_minimo.toFixed(3)}</td><td></td></tr>`,
            )
            .join("")
        : stockBebidas
            .map(
              (r) =>
                `<tr><td>${r.nombre}</td><td style="text-align:right">${r.stock_actual.toFixed(2)}</td><td style="text-align:right">${r.stock_minimo.toFixed(2)}</td><td></td></tr>`,
            )
            .join("");

    const thead =
      tipo === "insumos"
        ? `<tr><th>Nombre</th><th>Categoría</th><th>Unidad</th><th>Stock sistema</th><th>Mínimo</th><th>Conteo físico</th></tr>`
        : `<tr><th>Nombre</th><th>Stock sistema</th><th>Mínimo</th><th>Conteo físico</th></tr>`;

    printReport(
      `Toma física de ${tipo} — ${new Date().toLocaleDateString()}`,
      `<table><thead>${thead}</thead><tbody>${filas}</tbody></table>`,
    );
  };

  // ─── Guardar umbrales de stock (mínimo en DB, precaución en localStorage) ──
  const handleSaveStockConfig = async () => {
    if (!stockConfigModal) return;
    setSavingStockConfig(true);
    try {
      const minimo = parseFloat(stockConfigModal.minimo) || 0;
      const precaucion = parseFloat(stockConfigModal.precaucion) || 0;
      const { id, tipo } = stockConfigModal;

      // Actualizar stock_minimo en la base de datos
      if (tipo === "insumo") {
        const { error: upErr } = await supabase
          .from("insumos")
          .update({ stock_minimo: minimo })
          .eq("id", id);
        if (upErr) throw upErr;
        setStockInsumos((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, stock_minimo: minimo, alerta: r.stock_actual <= minimo }
              : r,
          ),
        );
      } else {
        const { error: upErr } = await supabase
          .from("stock_productos")
          .update({ stock_minimo: minimo })
          .eq("producto_id", id);
        if (upErr) throw upErr;
        setStockBebidas((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, stock_minimo: minimo, alerta: r.stock_actual <= minimo }
              : r,
          ),
        );
      }

      // Guardar stock_precaucion en localStorage
      const newMap = { ...stockPrecaucionMap, [id]: precaucion };
      setStockPrecaucionMap(newMap);
      localStorage.setItem("inv_stock_precaucion", JSON.stringify(newMap));
      setStockConfigModal(null);
    } catch (err: any) {
      setError(err?.message || "Error al guardar la configuración de stock.");
    } finally {
      setSavingStockConfig(false);
    }
  };

  // ─── Guardar edición de movimiento (solo campos no-stock) ─────────────────
  const handleSaveEditMovimiento = async () => {
    if (!editMovModal) return;
    setSavingEditMov(true);
    try {
      const { error: upErr } = await supabase
        .from("movimientos_inventario")
        .update({
          nota: editMovModal.nota || null,
          referencia_tipo: editMovModal.referencia_tipo || null,
          referencia_id: editMovModal.referencia_id || null,
        })
        .eq("id", editMovModal.id);
      if (upErr) throw upErr;
      setMovimientos((prev) =>
        prev.map((m) =>
          m.id === editMovModal.id
            ? {
                ...m,
                nota: editMovModal.nota || null,
                referencia_tipo: editMovModal.referencia_tipo || null,
                referencia_id: editMovModal.referencia_id || null,
              }
            : m,
        ),
      );
      setEditMovModal(null);
    } catch (err: any) {
      setError(err?.message || "Error al guardar el movimiento.");
    } finally {
      setSavingEditMov(false);
    }
  };

  // Helper para calcular el estado de color de una fila de stock
  const stockRowStyle = (
    id: string,
    stock_actual: number,
    stock_minimo: number,
  ): React.CSSProperties => {
    const prec = stockPrecaucionMap[id] ?? 0;
    if (stock_actual <= stock_minimo) return { background: "#fef2f2" };
    if (prec > 0 && stock_actual <= prec) return { background: "#fefce8" };
    return {};
  };

  const stockAlertaBadge = (
    id: string,
    stock_actual: number,
    stock_minimo: number,
  ) => {
    const prec = stockPrecaucionMap[id] ?? 0;
    if (stock_actual <= stock_minimo)
      return <span style={{ color: "#dc2626", fontWeight: 700 }}>⚠ Bajo</span>;
    if (prec > 0 && stock_actual <= prec)
      return (
        <span style={{ color: "#ca8a04", fontWeight: 700 }}>⚠ Precaución</span>
      );
    return <span style={{ color: "#16a34a" }}>✓ OK</span>;
  };

  const cardStyle: CSSProperties = {
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
    padding: 20,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)",
        padding: 24,
      }}
    >
      <style>{`
        .inventory-grid { display: grid; gap: 16px; }
        .inventory-top-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
        .inventory-main-grid { grid-template-columns: 1.3fr 1fr; align-items: start; }
        .inventory-table { width: 100%; border-collapse: separate; border-spacing: 0; }
        .inventory-table th, .inventory-table td { padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: left; }
        .inventory-table th { background: #f8fafc; color: #0f172a; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.02em; }
        .inventory-table td { color: #334155; font-size: 0.91rem; background: #fff; }
        .inventory-table tr:hover td { background: #f8fafc; }
        .inventory-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .inventory-input, .inventory-select, .inventory-textarea {
          width: 100%; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px;
          font-size: 0.95rem; background: white; color: #0f172a;
        }
        .inventory-input::placeholder, .inventory-textarea::placeholder { color: #94a3b8; }
        .inventory-textarea { min-height: 92px; resize: vertical; }
        label { color: #334155; font-size: 0.85rem; font-weight: 600; display: inline-block; margin-bottom: 6px; }
        .inventory-tab {
          border: 1px solid #cbd5e1; border-radius: 999px; padding: 9px 14px; cursor: pointer;
          font-weight: 700; color: #334155; background: #f8fafc;
        }
        .inventory-tab.active { background: linear-gradient(135deg, #2563eb, #4f46e5); color: white; border-color: transparent; box-shadow: 0 8px 18px rgba(37,99,235,.25); }
        .inventory-btn {
          border: none; border-radius: 10px; padding: 10px 14px; font-weight: 700;
          cursor: pointer; transition: transform .15s ease, box-shadow .15s ease;
        }
        .inventory-btn:hover { transform: translateY(-1px); }
        .inventory-btn.primary { background: linear-gradient(135deg, #2563eb, #4f46e5); color: white; }
        .inventory-btn.success { background: linear-gradient(135deg, #059669, #10b981); color: white; }
        .inventory-btn.secondary { background: #e2e8f0; color: #0f172a; }
        .inventory-badge {
          display: inline-flex; align-items: center; gap: 6px; border-radius: 999px;
          padding: 4px 10px; font-size: 0.78rem; font-weight: 700; background: #dbeafe; color: #1d4ed8;
        }

        .inventory-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15,23,42,0.52);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .inventory-modal {
          width: min(860px, 100%);
          max-height: 90vh;
          overflow: auto;
          background: #ffffff;
          color: #0f172a;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          box-shadow: 0 24px 60px rgba(15,23,42,0.28);
          padding: 24px;
        }
        .inventory-modal h3 { color: #0f172a; }
        .inventory-modal p { color: #64748b; }
        .inventory-modal label { color: #334155 !important; }
        .inventory-modal .inventory-input,
        .inventory-modal .inventory-select,
        .inventory-modal .inventory-textarea {
          color: #0f172a;
          background: #ffffff;
        }
        @media (max-width: 1100px) {
          .inventory-main-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 768px) {
          .inventory-modal { padding: 16px; border-radius: 14px; max-height: 92vh; }
          .inventory-table th, .inventory-table td { padding: 10px; }
        }
      `}</style>

      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <div
          style={{
            ...cardStyle,
            marginBottom: 20,
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            <h1 style={{ margin: "12px 0 6px", color: "#0f172a" }}>
              Movimientos de inventario y producción
            </h1>
            <p style={{ margin: 0, color: "#64748b", maxWidth: 760 }}>
              Controla insumos, recetas, producción, salidas automáticas por
              venta y reportes imprimibles.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="inventory-btn secondary" onClick={onBack}>
              ← Volver
            </button>
            {onLogout && (
              <button
                className="inventory-btn secondary"
                style={{ color: "#dc2626", borderColor: "#fca5a5" }}
                onClick={onLogout}
              >
                🚪 Cerrar sesión
              </button>
            )}
            <button
              className="inventory-btn secondary"
              onClick={() => loadEverything()}
            >
              ⟳ Actualizar
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              ...cardStyle,
              marginBottom: 16,
              borderColor: "#fecaca",
              background: "#fef2f2",
              color: "#b91c1c",
            }}
          >
            {error}
          </div>
        )}

        {message && (
          <div
            style={{
              ...cardStyle,
              marginBottom: 16,
              borderColor: "#bbf7d0",
              background: "#f0fdf4",
              color: "#166534",
            }}
          >
            {message}
          </div>
        )}

        {setupRequired && (
          <div
            style={{
              ...cardStyle,
              marginBottom: 20,
              borderColor: "#fde68a",
              background: "#fffbeb",
            }}
          >
            <h3 style={{ marginTop: 0, color: "#92400e" }}>
              Configuración pendiente en Supabase
            </h3>
            <p style={{ color: "#78350f" }}>
              Esta vista ya está integrada, pero necesitas ejecutar el script
              nuevo del sistema para habilitar movimientos, recetas y
              producción.
            </p>
            {setupNotes.length > 0 && (
              <ul
                style={{ color: "#78350f", paddingLeft: 18, marginBottom: 0 }}
              >
                {setupNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div
          className="inventory-grid inventory-top-grid"
          style={{ marginBottom: 20 }}
        >
          <div style={cardStyle}>
            <div style={{ color: "#64748b", fontWeight: 700 }}>
              Alertas de stock
            </div>
            <div
              style={{
                fontSize: "1.9rem",
                fontWeight: 800,
                color: "#dc2626",
                marginTop: 8,
              }}
            >
              {lowStockCount}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{ color: "#64748b", fontWeight: 700 }}>
              Movimientos hoy
            </div>
            <div
              style={{
                fontSize: "1.9rem",
                fontWeight: 800,
                color: "#1d4ed8",
                marginTop: 8,
              }}
            >
              {todayMovementCount}
            </div>
          </div>
          <div style={cardStyle}>
            <div style={{ color: "#64748b", fontWeight: 700 }}>
              Producciones hoy
            </div>
            <div
              style={{
                fontSize: "1.9rem",
                fontWeight: 800,
                color: "#059669",
                marginTop: 8,
              }}
            >
              {todayProductionCount}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          {[
            ["resumen", "Resumen"],
            ["recetas", "Recetas y configuración"],
            ["movimientos", "Movimientos"],
            ["produccion", "Producción"],
            ["stock", "Stock"],
            ["insumos", "🧂 Insumos"],
            ["bebidas", "🥤 Bebidas"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`inventory-tab ${activeTab === key ? "active" : ""}`}
              onClick={() => setActiveTab(key as TabKey)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={cardStyle}>Cargando información del sistema...</div>
        ) : (
          <>
            {activeTab === "resumen" && (
              <div>
                <div style={cardStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      marginBottom: 14,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0, color: "#0f172a" }}>
                        Existencias consolidadas
                      </h3>
                      <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                        Aquí ves insumos y productos terminados con su alerta
                        mínima.
                      </p>
                    </div>
                    <button
                      className="inventory-btn secondary"
                      onClick={handlePrintSummary}
                    >
                      🖨 Imprimir reporte
                    </button>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="inventory-table">
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Nombre</th>
                          <th>Categoría</th>
                          <th>Unidad</th>
                          <th>Stock</th>
                          <th>Mínimo</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resumen.map((item) => (
                          <tr key={`${item.tipo_item}-${item.id}`}>
                            <td>{item.tipo_item}</td>
                            <td>{item.nombre}</td>
                            <td>{item.categoria || "-"}</td>
                            <td>{item.unidad || "-"}</td>
                            <td>{numberValue(item.stock_actual).toFixed(3)}</td>
                            <td>{numberValue(item.stock_minimo).toFixed(3)}</td>
                            <td>
                              <span
                                className="inventory-badge"
                                style={{
                                  background: item.alerta_stock_bajo
                                    ? "#fee2e2"
                                    : "#dcfce7",
                                  color: item.alerta_stock_bajo
                                    ? "#b91c1c"
                                    : "#166534",
                                }}
                              >
                                {item.alerta_stock_bajo
                                  ? "Stock bajo"
                                  : "Normal"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "recetas" && (
              <div>
                <div style={cardStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 16,
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0, color: "#0f172a" }}>
                        Recetas y configuración
                      </h3>
                      <p style={{ margin: "4px 0 0", color: "#64748b" }}>
                        Toca <strong>Receta</strong> en cualquier producto para
                        configurar cómo afecta el inventario al venderse.
                      </p>
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="inventory-table">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Tipo</th>
                          <th>Modo inventario</th>
                          <th>Estado</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {productos
                          .filter((p) =>
                            ["comida", "complemento"].includes(p.tipo),
                          )
                          .map((producto) => {
                            const cfg = configs.find(
                              (c) => c.producto_id === producto.id,
                            );
                            const modoLabel = cfg
                              ? (CONSUMPTION_MODES.find(
                                  (m) => m.value === cfg.modo_consumo,
                                )?.label ?? cfg.modo_consumo)
                              : "Sin configurar";
                            return (
                              <tr key={producto.id}>
                                <td style={{ fontWeight: 500 }}>
                                  {producto.nombre}
                                </td>
                                <td>
                                  <span
                                    className="inventory-badge"
                                    style={{
                                      background:
                                        producto.tipo === "comida"
                                          ? "#fef3c7"
                                          : "#e0e7ff",
                                      color:
                                        producto.tipo === "comida"
                                          ? "#92400e"
                                          : "#3730a3",
                                    }}
                                  >
                                    {producto.tipo}
                                  </span>
                                </td>
                                <td
                                  style={{
                                    color: cfg ? "#0f172a" : "#94a3b8",
                                    fontSize: "0.88rem",
                                  }}
                                >
                                  {modoLabel}
                                </td>
                                <td>
                                  {cfg ? (
                                    <span
                                      className="inventory-badge"
                                      style={{
                                        background: "#dcfce7",
                                        color: "#166534",
                                      }}
                                    >
                                      ✓ Configurado
                                    </span>
                                  ) : (
                                    <span
                                      className="inventory-badge"
                                      style={{
                                        background: "#f1f5f9",
                                        color: "#64748b",
                                      }}
                                    >
                                      Sin configurar
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="inventory-btn primary"
                                    style={{
                                      padding: "5px 14px",
                                      fontSize: "0.82rem",
                                    }}
                                    onClick={async () => {
                                      await loadRecipeForProduct(producto.id);
                                      setRecipeModalOpen(true);
                                    }}
                                  >
                                    Receta
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {activeTab === "movimientos" && (
              <div>
                <div style={cardStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      marginBottom: 14,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0, color: "#0f172a" }}>
                        Historial de movimientos
                      </h3>
                      <p style={{ margin: "6px 0 0", color: "#64748b" }}>
                        Auditoría completa de entradas, salidas, ajustes,
                        producción y ventas.
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="inventory-btn primary"
                        onClick={() => setMovFormModalOpen(true)}
                      >
                        + Registrar movimiento
                      </button>
                      <button
                        className="inventory-btn secondary"
                        onClick={handlePrintMovements}
                      >
                        🖨 Imprimir historial
                      </button>
                    </div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="inventory-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Tipo</th>
                          <th>Item</th>
                          <th>Cantidad</th>
                          <th>Ref.</th>
                          <th>Documento</th>
                          <th>Usuario</th>
                          <th>Nota</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {movimientos.map((item) => (
                          <tr key={item.id}>
                            <td>
                              {dateTime.format(new Date(item.created_at))}
                            </td>
                            <td>{item.tipo}</td>
                            <td>
                              {item.insumos?.nombre ||
                                item.productos?.nombre ||
                                "-"}
                            </td>
                            <td>{numberValue(item.cantidad).toFixed(3)}</td>
                            <td>{item.referencia_tipo || "-"}</td>
                            <td>{item.referencia_id || "-"}</td>
                            <td>{item.cajero || "-"}</td>
                            <td>{item.nota || "-"}</td>
                            <td>
                              <button
                                className="inventory-btn secondary"
                                style={{
                                  padding: "4px 10px",
                                  fontSize: "0.8rem",
                                }}
                                onClick={() =>
                                  setEditMovModal({
                                    id: item.id,
                                    nombre_item:
                                      item.insumos?.nombre ||
                                      item.productos?.nombre ||
                                      "-",
                                    tipo: item.tipo,
                                    nota: item.nota || "",
                                    referencia_tipo: item.referencia_tipo || "",
                                    referencia_id: item.referencia_id || "",
                                  })
                                }
                              >
                                ✏ Editar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "produccion" && (
              <div style={{ display: "grid", gap: 20 }}>
                {/* ── Reporte de consumos por venta ────────────────────────── */}
                <div style={cardStyle}>
                  <h3 style={{ margin: "0 0 14px", color: "#0f172a" }}>
                    Reporte de consumos por ventas
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                      alignItems: "flex-end",
                      marginBottom: 16,
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 4,
                          color: "#475569",
                          fontSize: "0.85rem",
                        }}
                      >
                        Desde
                      </label>
                      <input
                        className="inventory-input"
                        style={{ width: 160 }}
                        type="date"
                        value={reportFechaDesde}
                        onChange={(e) => {
                          setReportFechaDesde(e.target.value);
                          setReportGenerado(false);
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: "block",
                          marginBottom: 4,
                          color: "#475569",
                          fontSize: "0.85rem",
                        }}
                      >
                        Hasta
                      </label>
                      <input
                        className="inventory-input"
                        style={{ width: 160 }}
                        type="date"
                        value={reportFechaHasta}
                        onChange={(e) => {
                          setReportFechaHasta(e.target.value);
                          setReportGenerado(false);
                        }}
                      />
                    </div>
                    <button
                      className="inventory-btn primary"
                      onClick={loadReporteProduccion}
                      disabled={reportLoading}
                    >
                      {reportLoading ? "Cargando…" : "Generar reporte"}
                    </button>
                    {reportGenerado && reportRows.length > 0 && (
                      <button
                        className="inventory-btn secondary"
                        onClick={handlePrintReporte}
                      >
                        🖨 Imprimir reporte
                      </button>
                    )}
                  </div>

                  {reportGenerado && (
                    <>
                      {/* Resumen en tarjetas */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: 12,
                          marginBottom: 20,
                        }}
                      >
                        <div
                          style={{
                            background: "#eff6ff",
                            borderRadius: 12,
                            padding: 14,
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "#3b82f6",
                              fontWeight: 700,
                            }}
                          >
                            MOVIMIENTOS TOTALES
                          </div>
                          <div
                            style={{
                              fontSize: "1.6rem",
                              fontWeight: 700,
                              color: "#1e40af",
                            }}
                          >
                            {reportRows.length}
                          </div>
                        </div>
                        <div
                          style={{
                            background: "#fef3c7",
                            borderRadius: 12,
                            padding: 14,
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "#d97706",
                              fontWeight: 700,
                            }}
                          >
                            COSTO TOTAL INSUMOS
                          </div>
                          <div
                            style={{
                              fontSize: "1.6rem",
                              fontWeight: 700,
                              color: "#92400e",
                            }}
                          >
                            {money.format(reportCostoTotales)}
                          </div>
                        </div>
                        <div
                          style={{
                            background: "#f0fdf4",
                            borderRadius: 12,
                            padding: 14,
                          }}
                        >
                          <div
                            style={{
                              fontSize: "0.78rem",
                              color: "#16a34a",
                              fontWeight: 700,
                            }}
                          >
                            DÍAS CON MOVIMIENTO
                          </div>
                          <div
                            style={{
                              fontSize: "1.6rem",
                              fontWeight: 700,
                              color: "#14532d",
                            }}
                          >
                            {reportPorDia.length}
                          </div>
                        </div>
                      </div>

                      {/* Tabla agrupada por día */}
                      {reportPorDia.length === 0 ? (
                        <p
                          style={{
                            color: "#94a3b8",
                            textAlign: "center",
                            padding: 24,
                          }}
                        >
                          Sin movimientos de ventas en ese rango de fechas.
                        </p>
                      ) : (
                        reportPorDia.map(
                          ([dia, { rows: dRows, costoTotal }]) => (
                            <div key={dia} style={{ marginBottom: 24 }}>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  background: "#f1f5f9",
                                  borderRadius: 8,
                                  padding: "8px 14px",
                                  marginBottom: 6,
                                }}
                              >
                                <strong style={{ color: "#0f172a" }}>
                                  {dia}
                                </strong>
                                <span
                                  style={{
                                    color: "#475569",
                                    fontSize: "0.9rem",
                                  }}
                                >
                                  {dRows.length} movimientos · Costo:{" "}
                                  <strong>{money.format(costoTotal)}</strong>
                                </span>
                              </div>
                              <div style={{ overflowX: "auto" }}>
                                <table className="inventory-table">
                                  <thead>
                                    <tr>
                                      <th>Hora</th>
                                      <th>Tipo ítem</th>
                                      <th>Ítem</th>
                                      <th>Unidad</th>
                                      <th style={{ textAlign: "right" }}>
                                        Cantidad
                                      </th>
                                      <th style={{ textAlign: "right" }}>
                                        Costo unit.
                                      </th>
                                      <th style={{ textAlign: "right" }}>
                                        Costo total
                                      </th>
                                      <th>Factura</th>
                                      <th>Cajero</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dRows.map((r) => (
                                      <tr key={r.id}>
                                        <td style={{ whiteSpace: "nowrap" }}>
                                          {new Date(
                                            r.created_at,
                                          ).toLocaleTimeString()}
                                        </td>
                                        <td>{r.item_tipo}</td>
                                        <td>{r.nombre_item}</td>
                                        <td>{r.unidad}</td>
                                        <td style={{ textAlign: "right" }}>
                                          {numberValue(r.cantidad).toFixed(3)}
                                        </td>
                                        <td style={{ textAlign: "right" }}>
                                          {money.format(
                                            numberValue(r.costo_unitario),
                                          )}
                                        </td>
                                        <td style={{ textAlign: "right" }}>
                                          {money.format(r.costo_total)}
                                        </td>
                                        <td>{r.referencia_id || "–"}</td>
                                        <td>{r.cajero || "–"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ),
                        )
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {activeTab === "stock" && (
              <div style={{ display: "grid", gap: 20 }}>
                {/* ── Sub-filtro + botones ───────────────────────────────── */}
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {(["insumos", "bebidas"] as const).map((f) => (
                    <button
                      key={f}
                      className={`inventory-tab ${stockFiltro === f ? "active" : ""}`}
                      onClick={() => setStockFiltro(f)}
                    >
                      {f === "insumos" ? "🧂 Insumos" : "🥤 Bebidas"}
                    </button>
                  ))}
                  {(stockFiltro === "insumos"
                    ? stockInsumos.length > 0
                    : stockBebidas.length > 0) && (
                    <button
                      className="inventory-btn secondary"
                      onClick={() => handlePrintTomaFisica(stockFiltro)}
                    >
                      🖨 Toma física {stockFiltro}
                    </button>
                  )}
                </div>

                {/* ── Tabla insumos ─────────────────────────────────────── */}
                {stockFiltro === "insumos" && (
                  <div style={cardStyle}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 14,
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <div>
                        <h3 style={{ margin: 0, color: "#0f172a" }}>
                          Stock de insumos
                        </h3>
                        <p style={{ margin: "4px 0 0", color: "#64748b" }}>
                          {stockInsumos.length} insumos · Valor total:{" "}
                          <strong>
                            {money.format(
                              stockInsumos.reduce(
                                (s, r) => s + r.valor_total,
                                0,
                              ),
                            )}
                          </strong>
                        </p>
                      </div>
                    </div>
                    {stockLoading ? (
                      <p
                        style={{
                          color: "#94a3b8",
                          textAlign: "center",
                          padding: 32,
                        }}
                      >
                        Calculando stock…
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table className="inventory-table">
                          <thead>
                            <tr>
                              <th>Nombre</th>
                              <th>Categoría</th>
                              <th>Unidad</th>
                              <th style={{ textAlign: "right" }}>
                                Stock actual
                              </th>
                              <th style={{ textAlign: "right" }}>Mínimo</th>
                              <th style={{ textAlign: "right" }}>Precaución</th>
                              <th style={{ textAlign: "right" }}>
                                Costo unit.
                              </th>
                              <th style={{ textAlign: "right" }}>
                                Valor total
                              </th>
                              <th style={{ textAlign: "right" }}>Entradas</th>
                              <th style={{ textAlign: "right" }}>Salidas</th>
                              <th>Alerta</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockInsumos.map((r) => (
                              <tr
                                key={r.id}
                                style={stockRowStyle(
                                  r.id,
                                  r.stock_actual,
                                  r.stock_minimo,
                                )}
                              >
                                <td>{r.nombre}</td>
                                <td>{r.categoria}</td>
                                <td>{r.unidad}</td>
                                <td style={{ textAlign: "right" }}>
                                  {r.stock_actual.toFixed(3)}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {r.stock_minimo.toFixed(3)}
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    color: "#ca8a04",
                                  }}
                                >
                                  {(stockPrecaucionMap[r.id] ?? 0) > 0
                                    ? (stockPrecaucionMap[r.id] ?? 0).toFixed(3)
                                    : "–"}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {money.format(r.costo_unitario)}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {money.format(r.valor_total)}
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    color: "#16a34a",
                                  }}
                                >
                                  {r.total_entradas.toFixed(3)}
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    color: "#dc2626",
                                  }}
                                >
                                  {r.total_salidas.toFixed(3)}
                                </td>
                                <td>
                                  {stockAlertaBadge(
                                    r.id,
                                    r.stock_actual,
                                    r.stock_minimo,
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="inventory-btn secondary"
                                    style={{
                                      padding: "5px 10px",
                                      fontSize: "0.8rem",
                                    }}
                                    onClick={() =>
                                      setStockConfigModal({
                                        open: true,
                                        tipo: "insumo",
                                        id: r.id,
                                        nombre: r.nombre,
                                        minimo: r.stock_minimo.toFixed(3),
                                        precaucion: (
                                          (stockPrecaucionMap[r.id] ?? 0) ||
                                          ""
                                        ).toString(),
                                      })
                                    }
                                  >
                                    ⚙ Umbrales
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Tabla bebidas ─────────────────────────────────────── */}
                {stockFiltro === "bebidas" && (
                  <div style={cardStyle}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 14,
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <div>
                        <h3 style={{ margin: 0, color: "#0f172a" }}>
                          Stock de bebidas
                        </h3>
                        <p style={{ margin: "4px 0 0", color: "#64748b" }}>
                          {stockBebidas.length} productos · Valor total:{" "}
                          <strong>
                            {money.format(
                              stockBebidas.reduce(
                                (s, r) => s + r.valor_total,
                                0,
                              ),
                            )}
                          </strong>
                        </p>
                      </div>
                    </div>
                    {stockLoading ? (
                      <p
                        style={{
                          color: "#94a3b8",
                          textAlign: "center",
                          padding: 32,
                        }}
                      >
                        Calculando stock…
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table className="inventory-table">
                          <thead>
                            <tr>
                              <th>Nombre</th>
                              <th style={{ textAlign: "right" }}>
                                Precio venta
                              </th>
                              <th style={{ textAlign: "right" }}>
                                Stock actual
                              </th>
                              <th style={{ textAlign: "right" }}>Mínimo</th>
                              <th style={{ textAlign: "right" }}>Precaución</th>
                              <th style={{ textAlign: "right" }}>
                                Costo prom.
                              </th>
                              <th style={{ textAlign: "right" }}>
                                Valor total
                              </th>
                              <th style={{ textAlign: "right" }}>Entradas</th>
                              <th style={{ textAlign: "right" }}>Salidas</th>
                              <th>Alerta</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockBebidas.map((r) => (
                              <tr
                                key={r.id}
                                style={stockRowStyle(
                                  r.id,
                                  r.stock_actual,
                                  r.stock_minimo,
                                )}
                              >
                                <td>{r.nombre}</td>
                                <td style={{ textAlign: "right" }}>
                                  {money.format(r.precio)}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {r.stock_actual.toFixed(2)}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {r.stock_minimo.toFixed(2)}
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    color: "#ca8a04",
                                  }}
                                >
                                  {(stockPrecaucionMap[r.id] ?? 0) > 0
                                    ? (stockPrecaucionMap[r.id] ?? 0).toFixed(2)
                                    : "–"}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {money.format(r.costo_promedio)}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {money.format(r.valor_total)}
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    color: "#16a34a",
                                  }}
                                >
                                  {r.total_entradas.toFixed(2)}
                                </td>
                                <td
                                  style={{
                                    textAlign: "right",
                                    color: "#dc2626",
                                  }}
                                >
                                  {r.total_salidas.toFixed(2)}
                                </td>
                                <td>
                                  {stockAlertaBadge(
                                    r.id,
                                    r.stock_actual,
                                    r.stock_minimo,
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="inventory-btn secondary"
                                    style={{
                                      padding: "5px 10px",
                                      fontSize: "0.8rem",
                                    }}
                                    onClick={() =>
                                      setStockConfigModal({
                                        open: true,
                                        tipo: "bebida",
                                        id: r.id,
                                        nombre: r.nombre,
                                        minimo: r.stock_minimo.toFixed(2),
                                        precaucion: (
                                          (stockPrecaucionMap[r.id] ?? 0) ||
                                          ""
                                        ).toString(),
                                      })
                                    }
                                  >
                                    ⚙ Umbrales
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Insumos ──────────────────────────────────────────── */}
            {activeTab === "insumos" && (
              <div style={{ display: "grid", gap: 20 }}>
                <div style={cardStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 14,
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0, color: "#0f172a" }}>
                        🧂 Insumos
                      </h3>
                      <p style={{ margin: "4px 0 0", color: "#64748b" }}>
                        {stockInsumos.length} insumos registrados
                      </p>
                    </div>
                    <button
                      className="inventory-btn primary"
                      onClick={() => setNewInsumoTabOpen(true)}
                    >
                      + Agregar insumo
                    </button>
                  </div>

                  {stockLoading ? (
                    <p
                      style={{
                        color: "#94a3b8",
                        textAlign: "center",
                        padding: 32,
                      }}
                    >
                      Cargando…
                    </p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="inventory-table">
                        <thead>
                          <tr>
                            <th>Nombre</th>
                            <th>Categoría</th>
                            <th>Unidad</th>
                            <th style={{ textAlign: "right" }}>Stock actual</th>
                            <th style={{ textAlign: "right" }}>Mínimo</th>
                            <th>Alerta</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockInsumos.map((r) => (
                            <tr
                              key={r.id}
                              style={stockRowStyle(
                                r.id,
                                r.stock_actual,
                                r.stock_minimo,
                              )}
                            >
                              <td>{r.nombre}</td>
                              <td>{r.categoria}</td>
                              <td>{r.unidad}</td>
                              <td style={{ textAlign: "right" }}>
                                {r.stock_actual.toFixed(3)}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                {r.stock_minimo.toFixed(3)}
                              </td>
                              <td>
                                {stockAlertaBadge(
                                  r.id,
                                  r.stock_actual,
                                  r.stock_minimo,
                                )}
                              </td>
                              <td>
                                <button
                                  className="inventory-btn secondary"
                                  style={{
                                    padding: "4px 10px",
                                    fontSize: "0.8rem",
                                  }}
                                  onClick={() =>
                                    setEditInsumoModal({
                                      id: r.id,
                                      nombre: r.nombre,
                                      unidad: r.unidad,
                                      categoria: r.categoria,
                                      stock_minimo: r.stock_minimo.toFixed(3),
                                    })
                                  }
                                >
                                  ✏ Editar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab: Bebidas ──────────────────────────────────────────── */}
            {activeTab === "bebidas" && (
              <div style={{ display: "grid", gap: 20 }}>
                <div style={cardStyle}>
                  <div style={{ marginBottom: 14 }}>
                    <h3 style={{ margin: 0, color: "#0f172a" }}>🥤 Bebidas</h3>
                    <p style={{ margin: "4px 0 0", color: "#64748b" }}>
                      {stockBebidas.length} productos en stock
                    </p>
                  </div>
                  {stockLoading ? (
                    <p
                      style={{
                        color: "#94a3b8",
                        textAlign: "center",
                        padding: 32,
                      }}
                    >
                      Cargando…
                    </p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="inventory-table">
                        <thead>
                          <tr>
                            <th>Nombre</th>
                            <th style={{ textAlign: "right" }}>Stock actual</th>
                            <th style={{ textAlign: "right" }}>Mínimo</th>
                            <th style={{ textAlign: "right" }}>Entradas</th>
                            <th style={{ textAlign: "right" }}>Salidas</th>
                            <th>Alerta</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockBebidas.map((r) => (
                            <tr
                              key={r.id}
                              style={stockRowStyle(
                                r.id,
                                r.stock_actual,
                                r.stock_minimo,
                              )}
                            >
                              <td>{r.nombre}</td>
                              <td style={{ textAlign: "right" }}>
                                {r.stock_actual.toFixed(2)}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                {r.stock_minimo.toFixed(2)}
                              </td>
                              <td
                                style={{ textAlign: "right", color: "#16a34a" }}
                              >
                                {r.total_entradas.toFixed(2)}
                              </td>
                              <td
                                style={{ textAlign: "right", color: "#dc2626" }}
                              >
                                {r.total_salidas.toFixed(2)}
                              </td>
                              <td>
                                {stockAlertaBadge(
                                  r.id,
                                  r.stock_actual,
                                  r.stock_minimo,
                                )}
                              </td>
                              <td>
                                <button
                                  className="inventory-btn"
                                  style={{
                                    padding: "4px 12px",
                                    fontSize: "0.8rem",
                                    background: "#f0fdf4",
                                    color: "#15803d",
                                    border: "1px solid #86efac",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  onClick={async () => {
                                    await loadRecipeForProduct(r.id);
                                    setRecipeModalOpen(true);
                                  }}
                                >
                                  🧂 Insumos
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Modal configuración umbrales de stock ────────────────────── */}
      {stockConfigModal?.open && (
        <div
          className="inventory-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setStockConfigModal(null);
          }}
        >
          <div className="inventory-modal" style={{ maxWidth: 520 }}>
            <h3 style={{ margin: "0 0 6px", color: "#0f172a" }}>
              ⚙ Umbrales de stock
            </h3>
            <p
              style={{
                margin: "0 0 20px",
                color: "#64748b",
                fontSize: "0.9rem",
              }}
            >
              {stockConfigModal.nombre}
            </p>

            <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontWeight: 600,
                    color: "#0f172a",
                  }}
                >
                  🔴 Stock mínimo (alerta)
                </label>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: "0.82rem",
                    color: "#64748b",
                  }}
                >
                  Cuando el stock llegue a este valor o menos, la fila se
                  marcará en rojo.
                </p>
                <input
                  className="inventory-input"
                  type="number"
                  min="0"
                  step="0.001"
                  value={stockConfigModal.minimo}
                  onChange={(e) =>
                    setStockConfigModal((prev) =>
                      prev ? { ...prev, minimo: e.target.value } : prev,
                    )
                  }
                />
              </div>
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: 6,
                    fontWeight: 600,
                    color: "#0f172a",
                  }}
                >
                  🟡 Stock de precaución (advertencia)
                </label>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: "0.82rem",
                    color: "#64748b",
                  }}
                >
                  Cuando el stock esté entre el mínimo y este valor, la fila se
                  mostrará en amarillo. Deja en 0 para no usar.
                </p>
                <input
                  className="inventory-input"
                  type="number"
                  min="0"
                  step="0.001"
                  value={stockConfigModal.precaucion}
                  onChange={(e) =>
                    setStockConfigModal((prev) =>
                      prev ? { ...prev, precaucion: e.target.value } : prev,
                    )
                  }
                />
              </div>
            </div>

            <div
              style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
            >
              <button
                className="inventory-btn secondary"
                onClick={() => setStockConfigModal(null)}
                disabled={savingStockConfig}
              >
                Cancelar
              </button>
              <button
                className="inventory-btn primary"
                onClick={handleSaveStockConfig}
                disabled={savingStockConfig}
              >
                {savingStockConfig ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Registrar movimiento manual ─────────────────────────── */}
      {movFormModalOpen && (
        <div
          className="inventory-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMovFormModalOpen(false);
          }}
        >
          <div className="inventory-modal" style={{ maxWidth: 760 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h3 style={{ margin: 0, color: "#0f172a" }}>
                Registrar movimiento manual
              </h3>
              <button
                className="inventory-btn secondary"
                style={{ padding: "4px 12px" }}
                onClick={() => setMovFormModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleMovementSubmit}>
              <div className="inventory-form-grid" style={{ marginBottom: 12 }}>
                <div>
                  <label>Tipo de item</label>
                  <select
                    className="inventory-select"
                    value={movementForm.itemType}
                    onChange={(event) => {
                      setMovementForm((prev) => ({
                        ...prev,
                        itemType: event.target.value,
                        itemId: "",
                      }));
                    }}
                  >
                    <option value="insumo">Insumo</option>
                    {productTipos.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {tipo.charAt(0).toUpperCase() + tipo.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Item</label>
                  <select
                    className="inventory-select"
                    value={movementForm.itemId}
                    onChange={(event) =>
                      setMovementForm((prev) => ({
                        ...prev,
                        itemId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Selecciona</option>
                    {inventoryItems.map((item: any) => (
                      <option key={item.id} value={item.id}>
                        {item.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Movimiento</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {MOVEMENT_TYPES.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={`inventory-btn ${movementForm.tipoMovimiento === item.value ? "primary" : "secondary"}`}
                        style={{
                          flex: 1,
                          fontWeight:
                            movementForm.tipoMovimiento === item.value
                              ? 700
                              : 400,
                        }}
                        onClick={() =>
                          setMovementForm((prev) => ({
                            ...prev,
                            tipoMovimiento:
                              item.value as MovementFormState["tipoMovimiento"],
                          }))
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label>Cantidad</label>
                  <input
                    className="inventory-input"
                    type="number"
                    min="0"
                    step="0.0001"
                    value={movementForm.cantidad}
                    onChange={(event) =>
                      setMovementForm((prev) => ({
                        ...prev,
                        cantidad: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label>Referencia</label>
                  <input
                    className="inventory-input"
                    value={movementForm.referenciaTipo}
                    onChange={(event) =>
                      setMovementForm((prev) => ({
                        ...prev,
                        referenciaTipo: event.target.value,
                      }))
                    }
                    placeholder="compra, ajuste, desperdicio..."
                  />
                </div>
                <div>
                  <label>ID documento</label>
                  <input
                    className="inventory-input"
                    value={movementForm.referenciaId}
                    onChange={(event) =>
                      setMovementForm((prev) => ({
                        ...prev,
                        referenciaId: event.target.value,
                      }))
                    }
                    placeholder="factura, orden, compra..."
                  />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label>Nota</label>
                <textarea
                  className="inventory-textarea"
                  value={movementForm.nota}
                  onChange={(event) =>
                    setMovementForm((prev) => ({
                      ...prev,
                      nota: event.target.value,
                    }))
                  }
                />
              </div>
              <div
                style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
              >
                <button
                  type="button"
                  className="inventory-btn secondary"
                  onClick={() => setMovFormModalOpen(false)}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  className="inventory-btn primary"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? "Guardando..." : "Registrar movimiento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Editar movimiento ─────────────────────────────────────── */}
      {editMovModal && (
        <div
          className="inventory-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditMovModal(null);
          }}
        >
          <div className="inventory-modal" style={{ maxWidth: 540 }}>
            <h3 style={{ margin: "0 0 4px", color: "#0f172a" }}>
              ✏ Editar movimiento
            </h3>
            <p
              style={{
                margin: "0 0 4px",
                color: "#64748b",
                fontSize: "0.85rem",
              }}
            >
              <strong>{editMovModal.nombre_item}</strong> — {editMovModal.tipo}
            </p>
            <p
              style={{
                margin: "0 0 18px",
                fontSize: "0.78rem",
                color: "#94a3b8",
              }}
            >
              Solo se pueden editar la nota y la referencia (la cantidad y el
              costo afectan el stock y requieren ajuste manual).
            </p>
            <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ fontWeight: 600, color: "#0f172a" }}>
                  Referencia
                </label>
                <input
                  className="inventory-input"
                  value={editMovModal.referencia_tipo}
                  onChange={(e) =>
                    setEditMovModal((prev) =>
                      prev
                        ? { ...prev, referencia_tipo: e.target.value }
                        : prev,
                    )
                  }
                  placeholder="compra, ajuste, venta..."
                />
              </div>
              <div>
                <label style={{ fontWeight: 600, color: "#0f172a" }}>
                  ID documento
                </label>
                <input
                  className="inventory-input"
                  value={editMovModal.referencia_id}
                  onChange={(e) =>
                    setEditMovModal((prev) =>
                      prev ? { ...prev, referencia_id: e.target.value } : prev,
                    )
                  }
                  placeholder="número de factura, orden..."
                />
              </div>
              <div>
                <label style={{ fontWeight: 600, color: "#0f172a" }}>
                  Nota
                </label>
                <textarea
                  className="inventory-textarea"
                  value={editMovModal.nota}
                  onChange={(e) =>
                    setEditMovModal((prev) =>
                      prev ? { ...prev, nota: e.target.value } : prev,
                    )
                  }
                />
              </div>
            </div>
            <div
              style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
            >
              <button
                className="inventory-btn secondary"
                onClick={() => setEditMovModal(null)}
                disabled={savingEditMov}
              >
                Cancelar
              </button>
              <button
                className="inventory-btn primary"
                onClick={handleSaveEditMovimiento}
                disabled={savingEditMov}
              >
                {savingEditMov ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Configurar receta ─────────────────────────────────── */}
      {recipeModalOpen && (
        <div
          className="inventory-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRecipeModalOpen(false);
          }}
        >
          <div className="inventory-modal" style={{ maxWidth: 680 }}>
            {/* Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 18,
              }}
            >
              <div>
                <h3 style={{ margin: 0, color: "#0f172a" }}>
                  🍽 Configurar producto
                </h3>
                {selectedRecipeProduct && (
                  <div
                    style={{
                      marginTop: 4,
                      color: "#475569",
                      fontSize: "0.9rem",
                    }}
                  >
                    <strong>{selectedRecipeProduct.nombre}</strong>
                    {" · "}
                    <span
                      style={{
                        background:
                          selectedRecipeProduct.tipo === "comida"
                            ? "#fef3c7"
                            : "#e0e7ff",
                        color:
                          selectedRecipeProduct.tipo === "comida"
                            ? "#92400e"
                            : "#3730a3",
                        padding: "1px 8px",
                        borderRadius: 6,
                        fontSize: "0.82rem",
                        fontWeight: 600,
                      }}
                    >
                      {selectedRecipeProduct.tipo}
                    </span>
                  </div>
                )}
              </div>
              <button
                className="inventory-btn secondary"
                style={{ padding: "4px 12px", flexShrink: 0 }}
                onClick={() => setRecipeModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecipeSubmit}>
              {/* ── Configuración básica ───────────────────────────────── */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 16,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
                  <label>Modo de consumo de inventario</label>
                  <select
                    className="inventory-select"
                    value={recipeForm.modoConsumo}
                    onChange={(event) =>
                      setRecipeForm((prev) => ({
                        ...prev,
                        modoConsumo: event.target
                          .value as RecipeFormState["modoConsumo"],
                      }))
                    }
                    disabled={isRecipeProductComplemento}
                  >
                    {(isRecipeProductComplemento
                      ? CONSUMPTION_MODES.filter(
                          (mode) => mode.value === "receta",
                        )
                      : CONSUMPTION_MODES
                    ).map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                    {isRecipeProductComplemento
                      ? "Los complementos usan receta para descontar sus insumos al vender."
                      : CONSUMPTION_MODES.find(
                          (m) => m.value === recipeForm.modoConsumo,
                        )?.help}
                  </div>
                </div>
                <div>
                  <label>Rendimiento por venta</label>
                  <input
                    className="inventory-input"
                    type="number"
                    min="1"
                    step="0.01"
                    value={recipeForm.rendimiento}
                    onChange={(event) =>
                      setRecipeForm((prev) => ({
                        ...prev,
                        rendimiento: event.target.value,
                      }))
                    }
                    disabled={
                      recipeForm.modoConsumo !== "receta" &&
                      !isRecipeProductComplemento
                    }
                  />
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                    Unidades producidas por ejecución de receta
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Descripción / notas</label>
                  <textarea
                    className="inventory-textarea"
                    style={{ minHeight: 52 }}
                    value={recipeForm.descripcion}
                    onChange={(event) =>
                      setRecipeForm((prev) => ({
                        ...prev,
                        descripcion: event.target.value,
                      }))
                    }
                    placeholder="Receta estándar, observaciones, etc."
                  />
                </div>
              </div>

              {/* ── Ingredientes ───────────────────────────────────────── */}
              {(recipeForm.modoConsumo === "receta" ||
                isRecipeProductComplemento) && (
                <div
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    overflow: "hidden",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      background: "#f8fafc",
                      padding: "10px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: "1px solid #e2e8f0",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <strong style={{ color: "#0f172a" }}>
                      Ingredientes de la receta
                    </strong>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="inventory-btn secondary"
                        style={{ fontSize: "0.8rem", padding: "4px 12px" }}
                        onClick={() =>
                          setRecipeForm((prev) => ({
                            ...prev,
                            detalles: [
                              ...prev.detalles,
                              {
                                tipo_item: "insumo",
                                insumo_id: "",
                                complemento_id: "",
                                cantidad: "",
                                unidad: "",
                              },
                            ],
                          }))
                        }
                      >
                        🧂 + Insumo
                      </button>
                      <button
                        type="button"
                        className="inventory-btn secondary"
                        style={{
                          fontSize: "0.8rem",
                          padding: "4px 12px",
                          background: "#ede9fe",
                          color: "#5b21b6",
                        }}
                        onClick={() =>
                          setRecipeForm((prev) => ({
                            ...prev,
                            detalles: [
                              ...prev.detalles,
                              {
                                tipo_item: "complemento",
                                insumo_id: "",
                                complemento_id: "",
                                cantidad: "",
                                unidad: "unidad",
                              },
                            ],
                          }))
                        }
                      >
                        🛒 + Complemento
                      </button>
                    </div>
                  </div>

                  <div style={{ padding: 12, display: "grid", gap: 8 }}>
                    {recipeForm.detalles.map((detail, index) => {
                      const isInsumo = detail.tipo_item === "insumo";
                      return (
                        <div
                          key={index}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr 130px 80px auto",
                            gap: 8,
                            alignItems: "end",
                            background: isInsumo ? "#f0fdf4" : "#f5f3ff",
                            borderRadius: 8,
                            padding: "10px 12px",
                            borderLeft: `3px solid ${isInsumo ? "#16a34a" : "#7c3aed"}`,
                          }}
                        >
                          {/* tipo toggle */}
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                marginBottom: 4,
                              }}
                            >
                              Tipo
                            </div>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                type="button"
                                onClick={() =>
                                  setRecipeForm((prev) => ({
                                    ...prev,
                                    detalles: prev.detalles.map((d, i) =>
                                      i === index
                                        ? {
                                            ...d,
                                            tipo_item: "insumo",
                                            complemento_id: "",
                                            unidad:
                                              insumos.find(
                                                (ins) => ins.id === d.insumo_id,
                                              )?.unidad || "",
                                          }
                                        : d,
                                    ),
                                  }))
                                }
                                style={{
                                  padding: "3px 8px",
                                  fontSize: 11,
                                  fontWeight: isInsumo ? 700 : 400,
                                  background: isInsumo ? "#16a34a" : "#e2e8f0",
                                  color: isInsumo ? "#fff" : "#475569",
                                  border: "none",
                                  borderRadius: 5,
                                  cursor: "pointer",
                                }}
                              >
                                🧂
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setRecipeForm((prev) => ({
                                    ...prev,
                                    detalles: prev.detalles.map((d, i) =>
                                      i === index
                                        ? {
                                            ...d,
                                            tipo_item: "complemento",
                                            insumo_id: "",
                                            unidad: "unidad",
                                          }
                                        : d,
                                    ),
                                  }))
                                }
                                style={{
                                  padding: "3px 8px",
                                  fontSize: 11,
                                  fontWeight: !isInsumo ? 700 : 400,
                                  background: !isInsumo ? "#7c3aed" : "#e2e8f0",
                                  color: !isInsumo ? "#fff" : "#475569",
                                  border: "none",
                                  borderRadius: 5,
                                  cursor: "pointer",
                                }}
                              >
                                🛒
                              </button>
                            </div>
                          </div>

                          {/* item selector */}
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                marginBottom: 4,
                              }}
                            >
                              {isInsumo ? "Insumo" : "Complemento"}
                            </div>
                            {isInsumo ? (
                              <select
                                className="inventory-select"
                                value={detail.insumo_id}
                                onChange={(e) =>
                                  setRecipeForm((prev) => ({
                                    ...prev,
                                    detalles: prev.detalles.map((d, i) =>
                                      i === index
                                        ? {
                                            ...d,
                                            insumo_id: e.target.value,
                                            unidad:
                                              insumos.find(
                                                (ins) =>
                                                  ins.id === e.target.value,
                                              )?.unidad || "unidad",
                                          }
                                        : d,
                                    ),
                                  }))
                                }
                              >
                                <option value="">Seleccionar insumo</option>
                                {insumos.map((ins) => (
                                  <option key={ins.id} value={ins.id}>
                                    {ins.nombre}
                                    {ins.stock_actual !== undefined
                                      ? ` (${Number(ins.stock_actual).toFixed(2)} ${ins.unidad})`
                                      : ` · ${ins.unidad}`}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <select
                                className="inventory-select"
                                value={detail.complemento_id || ""}
                                onChange={(e) =>
                                  setRecipeForm((prev) => ({
                                    ...prev,
                                    detalles: prev.detalles.map((d, i) =>
                                      i === index
                                        ? {
                                            ...d,
                                            complemento_id: e.target.value,
                                          }
                                        : d,
                                    ),
                                  }))
                                }
                              >
                                <option value="">
                                  Seleccionar complemento
                                </option>
                                {productos
                                  .filter((p) => p.tipo === "complemento")
                                  .map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.nombre}
                                    </option>
                                  ))}
                              </select>
                            )}
                          </div>

                          {/* cantidad */}
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                marginBottom: 4,
                              }}
                            >
                              Cantidad
                            </div>
                            <input
                              className="inventory-input"
                              type="number"
                              min="0"
                              step="0.0001"
                              value={detail.cantidad}
                              onChange={(e) =>
                                setRecipeForm((prev) => ({
                                  ...prev,
                                  detalles: prev.detalles.map((d, i) =>
                                    i === index
                                      ? { ...d, cantidad: e.target.value }
                                      : d,
                                  ),
                                }))
                              }
                            />
                          </div>

                          {/* unidad */}
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                marginBottom: 4,
                              }}
                            >
                              Unidad
                            </div>
                            <input
                              className="inventory-input"
                              value={
                                detail.unidad || (isInsumo ? "" : "unidad")
                              }
                              readOnly
                              style={{
                                background: "#f1f5f9",
                                color: "#64748b",
                              }}
                            />
                          </div>

                          {/* quitar */}
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "transparent",
                                marginBottom: 4,
                              }}
                            >
                              &nbsp;
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setRecipeForm((prev) => ({
                                  ...prev,
                                  detalles:
                                    prev.detalles.length === 1
                                      ? [
                                          {
                                            tipo_item: "insumo",
                                            insumo_id: "",
                                            complemento_id: "",
                                            cantidad: "",
                                            unidad: "",
                                          },
                                        ]
                                      : prev.detalles.filter(
                                          (_, i) => i !== index,
                                        ),
                                }))
                              }
                              style={{
                                background: "#fee2e2",
                                color: "#b91c1c",
                                border: "none",
                                borderRadius: 6,
                                padding: "5px 10px",
                                cursor: "pointer",
                                fontWeight: 600,
                                fontSize: 13,
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {recipeForm.detalles.length === 0 && (
                      <p
                        style={{
                          color: "#94a3b8",
                          textAlign: "center",
                          padding: 20,
                          margin: 0,
                        }}
                      >
                        Agrega ingredientes con los botones de arriba
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Footer ─────────────────────────────────────────────── */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="inventory-btn secondary"
                  onClick={() => {
                    setRecipeId(null);
                    setRecipeForm(initialRecipeForm);
                  }}
                  disabled={submitting}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  className="inventory-btn secondary"
                  onClick={() => setRecipeModalOpen(false)}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="inventory-btn primary"
                  disabled={submitting}
                >
                  {submitting ? "Guardando..." : "Guardar configuración"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Editar insumo ──────────────────────────────────────── */}
      {editInsumoModal && (
        <div
          className="inventory-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditInsumoModal(null);
          }}
        >
          <div className="inventory-modal" style={{ maxWidth: 480 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h3 style={{ margin: 0, color: "#0f172a" }}>✏ Editar insumo</h3>
              <button
                className="inventory-btn secondary"
                style={{ padding: "4px 12px" }}
                onClick={() => setEditInsumoModal(null)}
              >
                ✕
              </button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label>Nombre</label>
                <input
                  className="inventory-input"
                  value={editInsumoModal.nombre}
                  onChange={(e) =>
                    setEditInsumoModal(
                      (p) => p && { ...p, nombre: e.target.value },
                    )
                  }
                  autoFocus
                />
              </div>
              <div>
                <label>Unidad de medida</label>
                <select
                  className="inventory-select"
                  value={editInsumoModal.unidad}
                  onChange={(e) =>
                    setEditInsumoModal(
                      (p) => p && { ...p, unidad: e.target.value },
                    )
                  }
                >
                  <option value="unidad">Unidad</option>
                  <option value="lb">Libra (lb)</option>
                  <option value="oz">Onza (oz)</option>
                  <option value="kg">Kilogramo (kg)</option>
                  <option value="g">Gramo (g)</option>
                  <option value="lt">Litro (lt)</option>
                  <option value="ml">Mililitro (ml)</option>
                  <option value="galon">Galón</option>
                  <option value="docena">Docena</option>
                  <option value="bolsa">Bolsa</option>
                  <option value="caja">Caja</option>
                  <option value="paquete">Paquete</option>
                  <option value="rollo">Rollo</option>
                </select>
              </div>
              <div>
                <label>Categoría</label>
                <input
                  className="inventory-input"
                  placeholder="general, empaque, bebidas..."
                  value={editInsumoModal.categoria}
                  onChange={(e) =>
                    setEditInsumoModal(
                      (p) => p && { ...p, categoria: e.target.value },
                    )
                  }
                />
              </div>
              <div>
                <label>Stock mínimo</label>
                <input
                  className="inventory-input"
                  type="number"
                  min="0"
                  step="0.001"
                  value={editInsumoModal.stock_minimo}
                  onChange={(e) =>
                    setEditInsumoModal(
                      (p) => p && { ...p, stock_minimo: e.target.value },
                    )
                  }
                />
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                marginTop: 22,
              }}
            >
              <button
                type="button"
                className="inventory-btn secondary"
                onClick={() => setEditInsumoModal(null)}
                disabled={savingEditInsumo}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="inventory-btn primary"
                onClick={handleSaveEditInsumo}
                disabled={savingEditInsumo || !editInsumoModal.nombre.trim()}
              >
                {savingEditInsumo ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Agregar insumo (tab Insumos) ───────────────────────── */}
      {newInsumoTabOpen && (
        <div
          className="inventory-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setNewInsumoTabOpen(false);
              setNewInsumoForm({
                nombre: "",
                unidad: "unidad",
                categoria: "general",
              });
            }
          }}
        >
          <div className="inventory-modal" style={{ maxWidth: 480 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h3 style={{ margin: 0, color: "#0f172a" }}>🧂 Nuevo insumo</h3>
              <button
                className="inventory-btn secondary"
                style={{ padding: "4px 12px" }}
                onClick={() => {
                  setNewInsumoTabOpen(false);
                  setNewInsumoForm({
                    nombre: "",
                    unidad: "unidad",
                    categoria: "general",
                  });
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label>Nombre</label>
                <input
                  className="inventory-input"
                  placeholder="Ej: Carne de cerdo, Aceite..."
                  value={newInsumoForm.nombre}
                  onChange={(e) =>
                    setNewInsumoForm((p) => ({ ...p, nombre: e.target.value }))
                  }
                  autoFocus
                />
              </div>
              <div>
                <label>Unidad de medida</label>
                <select
                  className="inventory-select"
                  value={newInsumoForm.unidad}
                  onChange={(e) =>
                    setNewInsumoForm((p) => ({ ...p, unidad: e.target.value }))
                  }
                >
                  <option value="unidad">Unidad</option>
                  <option value="lb">Libra (lb)</option>
                  <option value="oz">Onza (oz)</option>
                  <option value="kg">Kilogramo (kg)</option>
                  <option value="g">Gramo (g)</option>
                  <option value="lt">Litro (lt)</option>
                  <option value="ml">Mililitro (ml)</option>
                  <option value="galon">Galón</option>
                  <option value="docena">Docena</option>
                  <option value="bolsa">Bolsa</option>
                  <option value="caja">Caja</option>
                  <option value="paquete">Paquete</option>
                  <option value="rollo">Rollo</option>
                </select>
              </div>
              <div>
                <label>Categoría</label>
                <input
                  className="inventory-input"
                  placeholder="general, empaque, bebidas..."
                  value={newInsumoForm.categoria}
                  onChange={(e) =>
                    setNewInsumoForm((p) => ({
                      ...p,
                      categoria: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                marginTop: 22,
              }}
            >
              <button
                type="button"
                className="inventory-btn secondary"
                onClick={() => {
                  setNewInsumoTabOpen(false);
                  setNewInsumoForm({
                    nombre: "",
                    unidad: "unidad",
                    categoria: "general",
                  });
                }}
                disabled={creatingInsumo}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="inventory-btn primary"
                onClick={handleCreateInsumo}
                disabled={creatingInsumo || !newInsumoForm.nombre.trim()}
              >
                {creatingInsumo ? "Guardando..." : "Crear insumo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
