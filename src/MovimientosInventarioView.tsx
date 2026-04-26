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
  insumo_id: string;
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

type TabKey = "resumen" | "recetas" | "movimientos" | "produccion" | "stock";

type MovementFormState = {
  /** "insumo" o cualquier valor de productos.tipo (excepto "comida") */
  itemType: string;
  itemId: string;
  tipoMovimiento: "entrada" | "salida";
  cantidad: string;
  costoUnitario: string;
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
  costoUnitario: "",
  referenciaTipo: "manual",
  referenciaId: "",
  nota: "",
};

const initialRecipeForm: RecipeFormState = {
  productoId: "",
  modoConsumo: "receta",
  rendimiento: "1",
  descripcion: "",
  detalles: [{ insumo_id: "", cantidad: "", unidad: "" }],
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
  const [insumoSearch, setInsumoSearch] = useState("");
  const [insumoDropdownOpen, setInsumoDropdownOpen] = useState(false);
  const [newInsumoOpen, setNewInsumoOpen] = useState(false);
  const [creatingInsumo, setCreatingInsumo] = useState(false);
  const [newInsumoForm, setNewInsumoForm] = useState({
    nombre: "",
    unidad: "unidad",
    categoria: "general",
    costo_unitario: "",
  });
  const [recipeForm, setRecipeForm] =
    useState<RecipeFormState>(initialRecipeForm);
  const [recipeId, setRecipeId] = useState<string | null>(null);

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

  /** Insumos que tienen al menos un movimiento registrado en movimientos_inventario.
   *  Si aún no hay movimientos, muestra todos los insumos como alternativa */
  const insumosConMovimientos = useMemo(() => {
    const ids = new Set(
      movimientos
        .filter((m) => m.item_tipo === "insumo" && m.insumo_id)
        .map((m) => m.insumo_id as string),
    );
    if (ids.size === 0) return insumos;
    return insumos.filter((i) => ids.has(i.id));
  }, [insumos, movimientos]);

  /** Insumos filtrados por el texto escrito en el combobox del formulario de movimiento */
  const insumosFiltrados = useMemo(() => {
    const q = insumoSearch.trim().toLowerCase();
    if (!q) return insumosConMovimientos;
    return insumosConMovimientos.filter(
      (i) =>
        i.nombre.toLowerCase().includes(q) ||
        (i.categoria || "").toLowerCase().includes(q),
    );
  }, [insumosConMovimientos, insumoSearch]);

  const lowStockCount = useMemo(
    () => resumen.filter((item) => item.alerta_stock_bajo).length,
    [resumen],
  );

  const inventoryValue = useMemo(
    () => resumen.reduce((acc, item) => acc + numberValue(item.valor_total), 0),
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

  const selectedConfig = useMemo(
    () => configs.find((item) => item.producto_id === recipeForm.productoId),
    [configs, recipeForm.productoId],
  );

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
    if (activeTab !== "stock") return;
    if (stockFiltro === "insumos") {
      loadStockInsumos();
    } else {
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
          costo_unitario: numberValue(newInsumoForm.costo_unitario),
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
        setInsumoSearch(data.nombre);
        setMovementForm((prev) => ({ ...prev, itemId: data.id }));
      }

      setNewInsumoOpen(false);
      setNewInsumoForm({
        nombre: "",
        unidad: "unidad",
        categoria: "general",
        costo_unitario: "",
      });
      setMessage(`Insumo "${nombre}" creado y seleccionado.`);
    } catch (err: any) {
      setError(err?.message || "No se pudo crear el insumo.");
    } finally {
      setCreatingInsumo(false);
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
        modoConsumo: config?.modo_consumo || "receta",
        rendimiento: "1",
        descripcion: "",
        detalles: [{ insumo_id: "", cantidad: "", unidad: "" }],
      });
      return;
    }

    const { data: detalles, error: detalleError } = await supabase
      .from("recetas_detalle")
      .select("id, receta_id, insumo_id, cantidad, unidad")
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
      modoConsumo: config?.modo_consumo || "receta",
      rendimiento: String(receta.rendimiento || 1),
      descripcion: receta.descripcion || "",
      detalles: (detalles || []).map((item: any) => ({
        id: item.id,
        receta_id: item.receta_id,
        insumo_id: item.insumo_id,
        cantidad: String(item.cantidad ?? ""),
        unidad: item.unidad || "",
      })) || [{ insumo_id: "", cantidad: "", unidad: "" }],
    });
  };

  const handleMovementSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const cantidad = numberValue(movementForm.cantidad);
      const costoUnitario = numberValue(movementForm.costoUnitario);

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
          p_costo_unitario: costoUnitario,
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
      setInsumoSearch("");
      setNewInsumoOpen(false);
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

      const validDetails = recipeForm.detalles.filter(
        (item) => item.insumo_id && numberValue(item.cantidad) > 0,
      );

      const { error: configError } = await supabase
        .from("inventario_config_productos")
        .upsert(
          {
            producto_id: recipeForm.productoId,
            controla_inventario: recipeForm.modoConsumo !== "sin_control",
            modo_consumo: recipeForm.modoConsumo,
            permite_stock_negativo: false,
          },
          { onConflict: "producto_id" },
        );

      if (configError) {
        throw configError;
      }

      if (recipeForm.modoConsumo === "receta") {
        if (validDetails.length === 0) {
          throw new Error("Agrega al menos un insumo con cantidad válida.");
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
          insumo_id: item.insumo_id,
          cantidad: numberValue(item.cantidad),
          unidad:
            insumos.find((insumo) => insumo.id === item.insumo_id)?.unidad ||
            "unidad",
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
              Valor del inventario
            </div>
            <div
              style={{
                fontSize: "1.9rem",
                fontWeight: 800,
                color: "#0f172a",
                marginTop: 8,
              }}
            >
              {money.format(inventoryValue)}
            </div>
          </div>
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
                          <th>Valor</th>
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
                              {money.format(numberValue(item.valor_total))}
                            </td>
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
              <div className="inventory-grid inventory-main-grid">
                <div style={cardStyle}>
                  <h3 style={{ marginTop: 0, color: "#0f172a" }}>
                    Configurar producto para inventario
                  </h3>
                  <form onSubmit={handleRecipeSubmit}>
                    <div
                      className="inventory-form-grid"
                      style={{ marginBottom: 12 }}
                    >
                      <div>
                        <label>
                          Producto del punto de venta (comida / complemento)
                        </label>
                        <select
                          className="inventory-select"
                          value={recipeForm.productoId}
                          onChange={(event) => {
                            const productId = event.target.value;
                            if (!productId) {
                              setRecipeId(null);
                              setRecipeForm(initialRecipeForm);
                              return;
                            }
                            loadRecipeForProduct(productId);
                          }}
                        >
                          <option value="">Selecciona un producto</option>
                          {productos
                            .filter((p) =>
                              ["comida", "complemento"].includes(p.tipo),
                            )
                            .map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.nombre}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label>Modo de consumo</label>
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
                        >
                          {CONSUMPTION_MODES.map((mode) => (
                            <option key={mode.value} value={mode.value}>
                              {mode.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label>Rendimiento de la receta</label>
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
                          disabled={recipeForm.modoConsumo !== "receta"}
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                      <label>Descripción / notas</label>
                      <textarea
                        className="inventory-textarea"
                        value={recipeForm.descripcion}
                        onChange={(event) =>
                          setRecipeForm((prev) => ({
                            ...prev,
                            descripcion: event.target.value,
                          }))
                        }
                        placeholder="Ejemplo: receta estándar por lote o unidad vendida"
                      />
                    </div>

                    <div
                      style={{
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 14,
                        padding: 14,
                        marginBottom: 14,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          marginBottom: 10,
                        }}
                      >
                        <strong>Ingredientes / insumos</strong>
                        {insumosConMovimientos.length > 0 ? (
                          <span
                            style={{
                              fontSize: 12,
                              color: "#64748b",
                              fontWeight: 400,
                            }}
                          >
                            {insumosConMovimientos.length} insumo
                            {insumosConMovimientos.length !== 1 ? "s" : ""} con
                            movimientos registrados
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 12,
                              color: "#dc2626",
                              fontWeight: 400,
                            }}
                          >
                            Sin insumos registrados — agrega movimientos de
                            entrada primero
                          </span>
                        )}
                        <button
                          type="button"
                          className="inventory-btn secondary"
                          onClick={() =>
                            setRecipeForm((prev) => ({
                              ...prev,
                              detalles: [
                                ...prev.detalles,
                                { insumo_id: "", cantidad: "", unidad: "" },
                              ],
                            }))
                          }
                          disabled={recipeForm.modoConsumo !== "receta"}
                        >
                          + Agregar insumo
                        </button>
                      </div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {recipeForm.detalles.map((detail, index) => (
                          <div
                            key={`${detail.insumo_id}-${index}`}
                            className="inventory-form-grid"
                            style={{ alignItems: "end" }}
                          >
                            <div>
                              <label>Insumo</label>
                              <select
                                className="inventory-select"
                                value={detail.insumo_id}
                                onChange={(event) =>
                                  setRecipeForm((prev) => ({
                                    ...prev,
                                    detalles: prev.detalles.map(
                                      (item, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...item,
                                              insumo_id: event.target.value,
                                              unidad:
                                                insumos.find(
                                                  (insumo) =>
                                                    insumo.id ===
                                                    event.target.value,
                                                )?.unidad || "unidad",
                                            }
                                          : item,
                                    ),
                                  }))
                                }
                                disabled={recipeForm.modoConsumo !== "receta"}
                              >
                                <option value="">Selecciona un insumo</option>
                                {insumosConMovimientos.map((insumo) => (
                                  <option key={insumo.id} value={insumo.id}>
                                    {insumo.nombre} · {insumo.unidad}
                                    {insumo.stock_actual !== undefined
                                      ? ` (disp: ${Number(insumo.stock_actual).toFixed(2)})`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label>Cantidad requerida</label>
                              <input
                                className="inventory-input"
                                type="number"
                                min="0"
                                step="0.0001"
                                value={detail.cantidad}
                                onChange={(event) =>
                                  setRecipeForm((prev) => ({
                                    ...prev,
                                    detalles: prev.detalles.map(
                                      (item, itemIndex) =>
                                        itemIndex === index
                                          ? {
                                              ...item,
                                              cantidad: event.target.value,
                                            }
                                          : item,
                                    ),
                                  }))
                                }
                                disabled={recipeForm.modoConsumo !== "receta"}
                              />
                            </div>
                            <div>
                              <label>Unidad</label>
                              <input
                                className="inventory-input"
                                value={detail.unidad || ""}
                                readOnly
                              />
                            </div>
                            <button
                              type="button"
                              className="inventory-btn secondary"
                              onClick={() =>
                                setRecipeForm((prev) => ({
                                  ...prev,
                                  detalles:
                                    prev.detalles.length === 1
                                      ? [
                                          {
                                            insumo_id: "",
                                            cantidad: "",
                                            unidad: "",
                                          },
                                        ]
                                      : prev.detalles.filter(
                                          (_, itemIndex) => itemIndex !== index,
                                        ),
                                }))
                              }
                              disabled={recipeForm.modoConsumo !== "receta"}
                            >
                              Quitar
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="inventory-btn primary"
                        type="submit"
                        disabled={submitting}
                      >
                        {submitting ? "Guardando..." : "Guardar configuración"}
                      </button>
                      <button
                        type="button"
                        className="inventory-btn secondary"
                        onClick={() => {
                          setRecipeId(null);
                          setRecipeForm(initialRecipeForm);
                        }}
                      >
                        Limpiar formulario
                      </button>
                    </div>
                  </form>
                </div>

                <div style={cardStyle}>
                  <h3 style={{ marginTop: 0, color: "#0f172a" }}>
                    Estado actual del producto
                  </h3>
                  {selectedRecipeProduct ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      <div>
                        <strong>Producto:</strong>{" "}
                        {selectedRecipeProduct.nombre}
                      </div>
                      <div>
                        <strong>Categoría POS:</strong>{" "}
                        {selectedRecipeProduct.tipo}
                      </div>
                      <div>
                        <strong>Modo actual:</strong>{" "}
                        {selectedConfig?.modo_consumo || recipeForm.modoConsumo}
                      </div>
                      <div style={{ color: "#475569", lineHeight: 1.6 }}>
                        {
                          CONSUMPTION_MODES.find(
                            (mode) =>
                              mode.value ===
                              (selectedConfig?.modo_consumo ||
                                recipeForm.modoConsumo),
                          )?.help
                        }
                      </div>
                      {recipeForm.modoConsumo === "receta" && (
                        <div
                          style={{
                            background: "#eff6ff",
                            border: "1px solid #bfdbfe",
                            borderRadius: 12,
                            padding: 12,
                            color: "#1e3a8a",
                          }}
                        >
                          Cada venta de este producto descontará insumos con
                          base en la receta activa.
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{ margin: 0, color: "#64748b" }}>
                      Selecciona un producto para ver o editar su configuración.
                    </p>
                  )}
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
                      setInsumoSearch("");
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
                  {movementForm.itemType === "insumo" ? (
                    <div style={{ position: "relative" }}>
                      <input
                        className="inventory-input"
                        type="text"
                        value={insumoSearch}
                        placeholder="Buscar insumo..."
                        autoComplete="off"
                        onFocus={() => setInsumoDropdownOpen(true)}
                        onBlur={() =>
                          setTimeout(() => setInsumoDropdownOpen(false), 160)
                        }
                        onChange={(event) => {
                          setInsumoSearch(event.target.value);
                          setMovementForm((prev) => ({ ...prev, itemId: "" }));
                          setInsumoDropdownOpen(true);
                        }}
                      />
                      {insumoDropdownOpen && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            zIndex: 300,
                            background: "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 8,
                            maxHeight: 220,
                            overflowY: "auto",
                            boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
                          }}
                        >
                          {insumosFiltrados.length === 0 ? (
                            <div
                              style={{
                                padding: "10px 14px",
                                color: "#94a3b8",
                                fontSize: 13,
                              }}
                            >
                              Sin coincidencias
                            </div>
                          ) : (
                            insumosFiltrados.map((insumo) => (
                              <div
                                key={insumo.id}
                                onMouseDown={() => {
                                  setInsumoSearch(insumo.nombre);
                                  setMovementForm((prev) => ({
                                    ...prev,
                                    itemId: insumo.id,
                                  }));
                                  setInsumoDropdownOpen(false);
                                  setNewInsumoOpen(false);
                                }}
                                style={{
                                  padding: "8px 14px",
                                  cursor: "pointer",
                                  borderBottom: "1px solid #f1f5f9",
                                  fontSize: 13,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  background:
                                    movementForm.itemId === insumo.id
                                      ? "#eff6ff"
                                      : "transparent",
                                }}
                              >
                                <span style={{ fontWeight: 500 }}>
                                  {insumo.nombre}
                                </span>
                                <span
                                  style={{
                                    color: "#64748b",
                                    fontSize: 11,
                                    marginLeft: 8,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {insumo.stock_actual !== undefined
                                    ? `stock: ${Number(insumo.stock_actual).toFixed(2)} ${insumo.unidad || ""}`
                                    : insumo.unidad || ""}
                                </span>
                              </div>
                            ))
                          )}
                          {insumoSearch.trim() &&
                            !insumosConMovimientos.some(
                              (i) =>
                                i.nombre.toLowerCase() ===
                                insumoSearch.trim().toLowerCase(),
                            ) && (
                              <div
                                onMouseDown={() => {
                                  setNewInsumoForm((prev) => ({
                                    ...prev,
                                    nombre: insumoSearch.trim(),
                                  }));
                                  setNewInsumoOpen(true);
                                  setInsumoDropdownOpen(false);
                                }}
                                style={{
                                  padding: "9px 14px",
                                  cursor: "pointer",
                                  fontSize: 13,
                                  color: "#1d4ed8",
                                  fontWeight: 600,
                                  borderTop: "1px solid #e2e8f0",
                                  background: "#f0f9ff",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <span>＋</span>
                                <span>
                                  Crear &ldquo;{insumoSearch.trim()}&rdquo; como
                                  nuevo insumo
                                </span>
                              </div>
                            )}
                        </div>
                      )}
                      {newInsumoOpen && (
                        <div
                          style={{
                            marginTop: 8,
                            background: "#f0f9ff",
                            border: "1px solid #bfdbfe",
                            borderRadius: 10,
                            padding: 14,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: 13,
                              color: "#1e40af",
                              marginBottom: 10,
                            }}
                          >
                            Nuevo insumo
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 8,
                              marginBottom: 8,
                            }}
                          >
                            <div style={{ gridColumn: "1 / -1" }}>
                              <label style={{ fontSize: 12 }}>Nombre</label>
                              <input
                                className="inventory-input"
                                value={newInsumoForm.nombre}
                                onChange={(e) =>
                                  setNewInsumoForm((p) => ({
                                    ...p,
                                    nombre: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 12 }}>Unidad</label>
                              <input
                                className="inventory-input"
                                placeholder="kg, lt, unidad..."
                                value={newInsumoForm.unidad}
                                onChange={(e) =>
                                  setNewInsumoForm((p) => ({
                                    ...p,
                                    unidad: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 12 }}>Categoría</label>
                              <input
                                className="inventory-input"
                                placeholder="general, empaque..."
                                value={newInsumoForm.categoria}
                                onChange={(e) =>
                                  setNewInsumoForm((p) => ({
                                    ...p,
                                    categoria: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <label style={{ fontSize: 12 }}>
                                Costo unitario (L.)
                              </label>
                              <input
                                className="inventory-input"
                                type="number"
                                min="0"
                                step="0.01"
                                value={newInsumoForm.costo_unitario}
                                onChange={(e) =>
                                  setNewInsumoForm((p) => ({
                                    ...p,
                                    costo_unitario: e.target.value,
                                  }))
                                }
                              />
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              className="inventory-btn primary"
                              style={{ fontSize: 12, padding: "6px 14px" }}
                              onClick={handleCreateInsumo}
                              disabled={
                                creatingInsumo || !newInsumoForm.nombre.trim()
                              }
                            >
                              {creatingInsumo ? "Guardando..." : "Crear insumo"}
                            </button>
                            <button
                              type="button"
                              className="inventory-btn secondary"
                              style={{ fontSize: 12, padding: "6px 14px" }}
                              onClick={() => {
                                setNewInsumoOpen(false);
                                setNewInsumoForm({
                                  nombre: "",
                                  unidad: "unidad",
                                  categoria: "general",
                                  costo_unitario: "",
                                });
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                      {movementForm.itemId ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#16a34a",
                            marginTop: 3,
                          }}
                        >
                          ✓ insumo seleccionado
                        </div>
                      ) : insumoSearch.trim() ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#dc2626",
                            marginTop: 3,
                          }}
                        >
                          Selecciona un insumo de la lista
                        </div>
                      ) : null}
                    </div>
                  ) : (
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
                  )}
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
                  <label>Costo unitario</label>
                  <input
                    className="inventory-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={movementForm.costoUnitario}
                    onChange={(event) =>
                      setMovementForm((prev) => ({
                        ...prev,
                        costoUnitario: event.target.value,
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
    </div>
  );
}
