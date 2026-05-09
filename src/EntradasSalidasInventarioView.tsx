import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

interface EntradasSalidasInventarioViewProps {
  onBack: () => void;
}

function getCurrentUser() {
  try {
    const stored = localStorage.getItem("usuario");
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

type FiltroTipo = "todos" | "insumo" | "bebida" | "piezas_pollo";

interface FilaInventario {
  id: string;
  nombre: string;
  tipo: "Insumo" | "Bebida";
  stockAnterior: number;
  ingresoPeriodo: number;
  salidaPeriodo: number;
  stockActual: number;
}

type SerieDimension = "dia" | "semana" | "mes";

interface PiezasSerieTiempoRow {
  dimension: SerieDimension;
  bucket_key: string;
  etiqueta: string;
  orden: number;
  ventas_piezas: number;
  merma_piezas: number;
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeMovType(value: unknown) {
  return normalizeText(value).replace(/[\s-]+/g, "_");
}

function ymdTegucigalpa(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Tegucigalpa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value || "0000";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function parseYmd(ymd: string) {
  const [y, m, d] = String(ymd || "")
    .split("-")
    .map((v) => Number(v));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function resolverPeriodoVistaPiezas(
  fechaDesde: string,
  fechaHasta: string,
): "dia" | "semana" | "mes" | "anio" | null {
  if (!fechaDesde || !fechaHasta) return null;
  const hoy = parseYmd(ymdTegucigalpa());
  const desde = parseYmd(fechaDesde);
  const hasta = parseYmd(fechaHasta);
  if (!hoy || !desde || !hasta) return null;

  const hoyYmd = formatYmd(hoy);
  if (fechaDesde === hoyYmd && fechaHasta === hoyYmd) return "dia";

  const inicioSemana = new Date(hoy);
  const day = inicioSemana.getDay();
  const delta = day === 0 ? 6 : day - 1;
  inicioSemana.setDate(inicioSemana.getDate() - delta);
  const inicioSemanaYmd = formatYmd(inicioSemana);
  if (fechaDesde === inicioSemanaYmd && fechaHasta === hoyYmd) return "semana";

  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const inicioMesYmd = formatYmd(inicioMes);
  if (fechaDesde === inicioMesYmd && fechaHasta === hoyYmd) return "mes";

  const inicioAnio = new Date(hoy.getFullYear(), 0, 1);
  const inicioAnioYmd = formatYmd(inicioAnio);
  if (fechaDesde === inicioAnioYmd && fechaHasta === hoyYmd) return "anio";

  return null;
}

export default function EntradasSalidasInventarioView({
  onBack,
}: EntradasSalidasInventarioViewProps) {
  const usuarioActual = getCurrentUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("bebida");
  const hoy = new Date().toISOString().split("T")[0];
  const [fechaDesde, setFechaDesde] = useState(hoy);
  const [fechaHasta, setFechaHasta] = useState(hoy);
  const [busqueda, setBusqueda] = useState("");
  const [filas, setFilas] = useState<FilaInventario[]>([]);
  const [masivoOpen, setMasivoOpen] = useState(false);
  const [masivoTipo, setMasivoTipo] = useState<"entrada" | "salida">("entrada");
  const [masivoValores, setMasivoValores] = useState<Record<string, string>>(
    {},
  );
  const [masivoGuardando, setMasivoGuardando] = useState(false);
  const [piezasSeries, setPiezasSeries] = useState<PiezasSerieTiempoRow[]>([]);
  const [piezasSeriesLoading, setPiezasSeriesLoading] = useState(false);
  const [piezasSeriesError, setPiezasSeriesError] = useState("");

  // Toma de inventario
  interface TomaFila {
    id: string;
    nombre: string;
    tipo: "Insumo" | "Bebida";
    stockActual: number;
  }
  const [tomaOpen, setTomaOpen] = useState(false);
  const [tomaFilas, setTomaFilas] = useState<TomaFila[]>([]);
  const [tomaConteos, setTomaConteos] = useState<Record<string, string>>({});
  const [tomaGuardando, setTomaGuardando] = useState(false);
  const [tomaExito, setTomaExito] = useState(false);

  const cargarSeriesPiezas = async () => {
    setPiezasSeriesLoading(true);
    setPiezasSeriesError("");
    try {
      const { data, error: seriesError } = await supabase
        .from("v_piezas_pollo_series_tiempo")
        .select(
          "dimension,bucket_key,etiqueta,orden,ventas_piezas,merma_piezas",
        )
        .order("orden", { ascending: true });

      if (seriesError) throw seriesError;

      const rows: PiezasSerieTiempoRow[] = (data || []).map((row: any) => ({
        dimension: row.dimension,
        bucket_key: String(row.bucket_key || ""),
        etiqueta: String(row.etiqueta || ""),
        orden: numberValue(row.orden),
        ventas_piezas: numberValue(row.ventas_piezas),
        merma_piezas: numberValue(row.merma_piezas),
      }));

      setPiezasSeries(rows);
    } catch (e: any) {
      setPiezasSeries([]);
      setPiezasSeriesError(
        e?.message || "No se pudo cargar la analítica de piezas de pollo.",
      );
    } finally {
      setPiezasSeriesLoading(false);
    }
  };

  const cargarDatos = async () => {
    setLoading(true);
    setError("");

    try {
      const tsDesde = fechaDesde
        ? Date.parse(`${fechaDesde}T00:00:00`)
        : Number.NEGATIVE_INFINITY;
      const tsHasta = fechaHasta
        ? Date.parse(`${fechaHasta}T23:59:59.999`)
        : Number.POSITIVE_INFINITY;

      let movimientosQuery = supabase
        .from("movimientos_inventario")
        .select(
          "item_tipo, tipo, insumo_id, producto_id, cantidad, created_at",
        );

      if (fechaHasta) {
        movimientosQuery = movimientosQuery.lte(
          "created_at",
          `${fechaHasta}T23:59:59.999`,
        );
      }

      const [insumosRes, bebidasRes, movimientosRes] = await Promise.all([
        supabase
          .from("insumos")
          .select("id, nombre")
          .order("nombre", { ascending: true }),
        supabase
          .from("productos")
          .select("id, nombre, tipo")
          .order("nombre", { ascending: true }),
        movimientosQuery,
      ]);

      if (insumosRes.error) throw insumosRes.error;
      if (bebidasRes.error) throw bebidasRes.error;
      if (movimientosRes.error) throw movimientosRes.error;

      const movimientos = movimientosRes.data || [];

      const stockAnteriorInsumo = new Map<string, number>();
      const ingresosInsumo = new Map<string, number>();
      const salidasInsumo = new Map<string, number>();
      const stockAnteriorProducto = new Map<string, number>();
      const ingresosProducto = new Map<string, number>();
      const salidasProducto = new Map<string, number>();

      movimientos.forEach((mov) => {
        const itemTipo = normalizeText(mov.item_tipo);
        const tipo = normalizeMovType(mov.tipo);
        const cantidad = numberValue(mov.cantidad);
        const ts = Date.parse(String(mov.created_at || ""));
        const enRango = Number.isFinite(ts) && ts >= tsDesde && ts <= tsHasta;
        const antesRango = Number.isFinite(ts) && ts < tsDesde;
        const isEntrada = [
          "entrada",
          "ajuste_positivo",
          "produccion_entrada",
        ].includes(tipo);
        const isSalida = [
          "salida",
          "ajuste_negativo",
          "venta",
          "produccion_salida",
        ].includes(tipo);

        if (!isEntrada && !isSalida) return;

        if (itemTipo === "insumo" && mov.insumo_id) {
          const id = String(mov.insumo_id);
          if (antesRango) {
            const delta = isEntrada ? cantidad : -cantidad;
            stockAnteriorInsumo.set(
              id,
              numberValue(stockAnteriorInsumo.get(id)) + delta,
            );
          }
          if (enRango && isEntrada) {
            ingresosInsumo.set(
              id,
              numberValue(ingresosInsumo.get(id)) + cantidad,
            );
          }
          if (enRango && isSalida) {
            salidasInsumo.set(
              id,
              numberValue(salidasInsumo.get(id)) + cantidad,
            );
          }
        }

        if (itemTipo === "producto" && mov.producto_id) {
          const id = String(mov.producto_id);
          if (antesRango) {
            const delta = isEntrada ? cantidad : -cantidad;
            stockAnteriorProducto.set(
              id,
              numberValue(stockAnteriorProducto.get(id)) + delta,
            );
          }
          if (enRango && isEntrada) {
            ingresosProducto.set(
              id,
              numberValue(ingresosProducto.get(id)) + cantidad,
            );
          }
          if (enRango && isSalida) {
            salidasProducto.set(
              id,
              numberValue(salidasProducto.get(id)) + cantidad,
            );
          }
        }
      });

      const filasInsumos: FilaInventario[] = (insumosRes.data || []).map(
        (insumo: any) => {
          const id = String(insumo.id);
          const stockAnterior = numberValue(stockAnteriorInsumo.get(id));
          const ingresoPeriodo = numberValue(ingresosInsumo.get(id));
          const salidaPeriodo = numberValue(salidasInsumo.get(id));
          return {
            id,
            nombre: String(insumo.nombre || ""),
            tipo: "Insumo",
            stockAnterior,
            ingresoPeriodo,
            salidaPeriodo,
            stockActual: stockAnterior + ingresoPeriodo - salidaPeriodo,
          };
        },
      );

      const filasBebidas: FilaInventario[] = (bebidasRes.data || [])
        .map((producto: any) => {
          if (normalizeText(producto.tipo) !== "bebida") return null;

          const id = String(producto.id);
          const stockAnterior = numberValue(stockAnteriorProducto.get(id));
          const ingresoPeriodo = numberValue(ingresosProducto.get(id));
          const salidaPeriodo = numberValue(salidasProducto.get(id));

          return {
            id,
            nombre: String(producto.nombre || ""),
            tipo: "Bebida",
            stockAnterior,
            ingresoPeriodo,
            salidaPeriodo,
            stockActual: stockAnterior + ingresoPeriodo - salidaPeriodo,
          };
        })
        .filter((fila): fila is FilaInventario => Boolean(fila));

      const periodoVista =
        resolverPeriodoVistaPiezas(fechaDesde, fechaHasta) || "dia";
      const { data: piezasStock, error: piezasStockError } = await supabase
        .from("v_piezas_pollo_stock_periodos")
        .select(
          "insumo_id,insumo_nombre,stock_anterior,ingreso_periodo,salida_periodo,stock_actual",
        )
        .eq("periodo", periodoVista)
        .limit(1)
        .maybeSingle();
      if (piezasStockError) throw piezasStockError;

      let filasCombinadas = [...filasInsumos, ...filasBebidas];

      if (piezasStock) {
        const piezaId = String(piezasStock.insumo_id || "");
        const piezaNombre = String(
          piezasStock.insumo_nombre || "Piezas de pollo",
        );
        const filaPiezasVista: FilaInventario = {
          id: piezaId,
          nombre: piezaNombre,
          tipo: "Insumo",
          stockAnterior: numberValue(piezasStock.stock_anterior),
          ingresoPeriodo: numberValue(piezasStock.ingreso_periodo),
          salidaPeriodo: numberValue(piezasStock.salida_periodo),
          stockActual: numberValue(piezasStock.stock_actual),
        };

        const indexPieza = filasCombinadas.findIndex(
          (fila) =>
            fila.tipo === "Insumo" &&
            normalizeText(fila.nombre) === "piezas de pollo",
        );

        if (indexPieza >= 0) {
          filasCombinadas[indexPieza] = filaPiezasVista;
        } else {
          filasCombinadas = [...filasCombinadas, filaPiezasVista];
        }
      }

      setFilas(
        filasCombinadas.sort((a, b) =>
          a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }),
        ),
      );

      if (filtroTipo === "piezas_pollo") {
        await cargarSeriesPiezas();
      }
    } catch (e: any) {
      setError(e?.message || "Error al cargar movimientos de inventario.");
      setFilas([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    if (filtroTipo === "piezas_pollo") {
      cargarSeriesPiezas();
    }
  }, [filtroTipo]);

  const piezasSeriesPorDimension = useMemo(() => {
    return {
      dia: piezasSeries.filter((r) => r.dimension === "dia"),
      semana: piezasSeries.filter((r) => r.dimension === "semana"),
      mes: piezasSeries.filter((r) => r.dimension === "mes"),
    };
  }, [piezasSeries]);

  const renderMiniBars = (
    titulo: string,
    data: PiezasSerieTiempoRow[],
    campo: "ventas_piezas" | "merma_piezas",
    color: string,
  ) => {
    const max = Math.max(1, ...data.map((item) => numberValue(item[campo])));

    return (
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#fff",
        }}
      >
        <h4 style={{ margin: "0 0 10px", color: "#111827", fontSize: 14 }}>
          {titulo}
        </h4>
        {data.length === 0 ? (
          <p style={{ margin: 0, color: "#6b7280", fontSize: 13 }}>
            Sin datos.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {data.map((item) => {
              const valor = numberValue(item[campo]);
              const porcentaje = Math.max(2, (valor / max) * 100);

              return (
                <div key={`${titulo}-${item.bucket_key}`}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 4,
                      fontSize: 12,
                      color: "#4b5563",
                    }}
                  >
                    <span>{item.etiqueta}</span>
                    <strong style={{ color: "#111827" }}>
                      {valor.toFixed(2)}
                    </strong>
                  </div>
                  <div
                    style={{
                      height: 10,
                      borderRadius: 999,
                      background: "#f3f4f6",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${porcentaje}%`,
                        height: "100%",
                        background: color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const filasFiltradas = useMemo(() => {
    const normalizeText = (value: string) =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

    const query = normalizeText(busqueda);

    const base =
      filtroTipo === "insumo"
        ? filas.filter((fila) => fila.tipo === "Insumo")
        : filtroTipo === "bebida"
          ? filas.filter((fila) => fila.tipo === "Bebida")
          : filtroTipo === "piezas_pollo"
            ? filas.filter(
                (fila) =>
                  fila.tipo === "Insumo" &&
                  normalizeText(fila.nombre) === "piezas de pollo",
              )
            : filas;

    if (!query) return base;

    return base.filter((fila) => normalizeText(fila.nombre).includes(query));
  }, [filas, filtroTipo, busqueda]);

  const abrirMasivo = () => {
    if (filtroTipo === "todos") {
      setError("Para movimiento masivo selecciona filtro Insumos o Bebidas.");
      return;
    }
    setError("");
    setMasivoTipo("entrada");
    setMasivoValores({});
    setMasivoOpen(true);
  };

  const guardarMasivo = async () => {
    setMasivoGuardando(true);
    setError("");
    try {
      const seleccionados = filasFiltradas
        .map((fila) => ({
          fila,
          valor: numberValue(masivoValores[fila.id]),
        }))
        .filter((item) => item.valor > 0);

      if (seleccionados.length === 0) {
        throw new Error("Ingresa al menos un valor mayor a 0.");
      }

      for (const item of seleccionados) {
        const { error: rpcError } = await supabase.rpc(
          "registrar_movimiento_inventario",
          {
            p_item_tipo: item.fila.tipo === "Insumo" ? "insumo" : "producto",
            p_item_id: item.fila.id,
            p_tipo_movimiento: masivoTipo,
            p_cantidad: item.valor,
            p_costo_unitario: 0,
            p_referencia_tipo: "manual_masivo",
            p_referencia_id: null,
            p_nota: `Movimiento masivo ${item.fila.tipo.toLowerCase()}`,
            p_cajero: usuarioActual?.nombre || "Administrador",
            p_cajero_id: String(usuarioActual?.id || ""),
            p_modo_estricto: false,
          },
        );
        if (rpcError) throw rpcError;
      }

      setMasivoOpen(false);
      setMasivoValores({});
      await cargarDatos();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar el movimiento masivo.");
    } finally {
      setMasivoGuardando(false);
    }
  };

  const abrirToma = () => {
    if (filtroTipo === "todos") {
      setError("Para toma de inventario selecciona filtro Insumos o Bebidas.");
      return;
    }
    setError("");
    setTomaConteos({});
    setTomaExito(false);
    setTomaGuardando(false);
    // Usar los mismos datos y stock que muestra la tabla principal
    setTomaFilas(
      filasFiltradas.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        tipo: f.tipo,
        stockActual: f.stockActual,
      })),
    );
    setTomaOpen(true);
  };

  const guardarToma = async () => {
    setTomaGuardando(true);
    setError("");
    try {
      const datos = tomaFilas.map((f) => {
        const conteo = Math.floor(Math.abs(numberValue(tomaConteos[f.id])));
        return {
          producto_id: f.tipo === "Bebida" ? f.id : undefined,
          insumo_id: f.tipo === "Insumo" ? f.id : undefined,
          nombre: f.nombre,
          stock_sistema: f.stockActual,
          conteo: conteo,
          conteo_fisico: conteo,
          diferencia: conteo - f.stockActual,
        };
      });
      const totalAjustes = datos.filter((d) => d.diferencia !== 0).length;
      const { error: insertError } = await supabase
        .from("historico_tomas_inventario")
        .insert({
          usuario_id: usuarioActual?.id || null,
          usuario_nombre: usuarioActual?.nombre || "Administrador",
          datos,
          total_productos: datos.length,
          total_ajustes: totalAjustes,
        });
      if (insertError) throw insertError;
      setTomaExito(true);
    } catch (e: any) {
      setError(e?.message || "No se pudo registrar la toma.");
    } finally {
      setTomaGuardando(false);
    }
  };

  return (
    <div style={{ padding: 16, color: "#111827" }}>
      <style>{`
        @media print {
          .inventario-es-no-print {
            display: none !important;
          }
          .inventario-es-table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
        }
        .masivo-input::-webkit-outer-spin-button,
        .masivo-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .masivo-input[type=number] {
          -moz-appearance: textfield;
        }
        @media print {
          .toma-no-print { display: none !important; }
          .toma-print-carta { display: block !important; font-family: Arial, sans-serif; font-size: 11pt; }
          .toma-print-carta table { width: 100%; border-collapse: collapse; }
          .toma-print-carta th, .toma-print-carta td { border: 1px solid #000; padding: 4px 8px; }
          .toma-print-80 { display: none !important; }
        }
        @media screen {
          .toma-print-carta { display: none; }
          .toma-print-80 { display: none; }
        }
      `}</style>

      <div
        className="inventario-es-no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "#f8fafc",
            color: "#111827",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            padding: "8px 12px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          ← Volver
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {/* Accesos rápidos de fecha */}
          {[
            {
              label: "Hoy",
              action: () => {
                const h = new Date().toISOString().split("T")[0];
                setFechaDesde(h);
                setFechaHasta(h);
              },
            },
            {
              label: "Semana",
              action: () => {
                const hoy2 = new Date();
                const lunes = new Date(hoy2);
                lunes.setDate(
                  hoy2.getDate() -
                    hoy2.getDay() +
                    (hoy2.getDay() === 0 ? -6 : 1),
                );
                setFechaDesde(lunes.toISOString().split("T")[0]);
                setFechaHasta(hoy2.toISOString().split("T")[0]);
              },
            },
            {
              label: "Mes",
              action: () => {
                const hoy3 = new Date();
                setFechaDesde(
                  new Date(hoy3.getFullYear(), hoy3.getMonth(), 1)
                    .toISOString()
                    .split("T")[0],
                );
                setFechaHasta(hoy3.toISOString().split("T")[0]);
              },
            },
          ].map(({ label, action }) => (
            <button
              key={label}
              onClick={action}
              style={{
                background: "#f8fafc",
                color: "#111827",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "8px 12px",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {label}
            </button>
          ))}

          <label htmlFor="filtro-tipo" style={{ fontWeight: 600 }}>
            Filtro:
          </label>
          <select
            id="filtro-tipo"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "8px 10px",
              minWidth: 160,
            }}
          >
            <option value="todos">Todos</option>
            <option value="insumo">Insumos</option>
            <option value="bebida">Bebidas</option>
            <option value="piezas_pollo">Piezas de pollo</option>
          </select>

          <label htmlFor="busqueda-nombre" style={{ fontWeight: 600 }}>
            Buscar:
          </label>
          <input
            id="busqueda-nombre"
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre de insumo o bebida"
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "8px 10px",
              color: "#111827",
              background: "#fff",
              minWidth: 220,
            }}
          />

          <label htmlFor="fecha-desde" style={{ fontWeight: 600 }}>
            Desde:
          </label>
          <input
            id="fecha-desde"
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "8px 10px",
              color: "#111827",
              background: "#fff",
            }}
          />

          <label htmlFor="fecha-hasta" style={{ fontWeight: 600 }}>
            Hasta:
          </label>
          <input
            id="fecha-hasta"
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "8px 10px",
              color: "#111827",
              background: "#fff",
            }}
          />

          <button
            onClick={cargarDatos}
            style={{
              background: "#f8fafc",
              color: "#111827",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "8px 12px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Actualizar
          </button>

          <button
            onClick={() => {
              const filtroLabel =
                filtroTipo === "insumo"
                  ? "Insumos"
                  : filtroTipo === "bebida"
                    ? "Bebidas"
                    : filtroTipo === "piezas_pollo"
                      ? "Piezas de pollo"
                      : "Todos";
              const titulo = `Entradas y Salidas — ${filtroLabel} — ${fechaDesde} al ${fechaHasta}`;
              const filasTR = filasFiltradas
                .map(
                  (f) =>
                    `<tr><td>${f.nombre}</td><td>${f.tipo}</td><td style="text-align:right">${f.stockAnterior.toFixed(2)}</td><td style="text-align:right">${f.ingresoPeriodo.toFixed(2)}</td><td style="text-align:right">${f.salidaPeriodo.toFixed(2)}</td><td style="text-align:right">${f.stockActual.toFixed(2)}</td></tr>`,
                )
                .join("");
              const html = `<html><head><title>${titulo}</title><style>body{font-family:Arial,sans-serif;font-size:11pt;padding:20px}h2{margin-bottom:8px;font-size:13pt}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:5px 8px}th{background:#f3f4f6;text-align:left}@media print{button{display:none}}</style></head><body><h2>${titulo}</h2><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Stock anterior</th><th>Ingreso</th><th>Salida</th><th>Stock actual</th></tr></thead><tbody>${filasTR}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`;
              const w = window.open("", "_blank");
              if (w) {
                w.document.write(html);
                w.document.close();
              }
            }}
            style={{
              background: "#f8fafc",
              color: "#111827",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "8px 12px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Imprimir tabla
          </button>

          <button
            onClick={abrirMasivo}
            style={{
              background: "#f8fafc",
              color: "#111827",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "8px 12px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            📥📤 Entrada/Salida masiva
          </button>

          <button
            onClick={abrirToma}
            style={{
              background: "#f8fafc",
              color: "#111827",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: "8px 12px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            📋 Toma de inventario
          </button>
        </div>
      </div>

      <h2 style={{ margin: "0 0 12px", color: "#111827" }}>
        Entradas y salidas de inventario
      </h2>

      {!loading && !error && filtroTipo === "piezas_pollo" && (
        <div
          style={{
            marginBottom: 16,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 14,
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, color: "#111827" }}>
              📊 Analítica de piezas de pollo
            </h3>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Fuente: vistas SQL (ventas y merma)
            </span>
          </div>

          {piezasSeriesLoading ? (
            <p style={{ margin: 0, color: "#475569", fontSize: 13 }}>
              Cargando gráficas...
            </p>
          ) : piezasSeriesError ? (
            <p style={{ margin: 0, color: "#b91c1c", fontSize: 13 }}>
              {piezasSeriesError}
            </p>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                {renderMiniBars(
                  "Ventas por día (últimos 7 días)",
                  piezasSeriesPorDimension.dia,
                  "ventas_piezas",
                  "#16a34a",
                )}
                {renderMiniBars(
                  "Ventas por semana (últimas 4 semanas)",
                  piezasSeriesPorDimension.semana,
                  "ventas_piezas",
                  "#15803d",
                )}
                {renderMiniBars(
                  "Ventas por mes (últimos 6 meses)",
                  piezasSeriesPorDimension.mes,
                  "ventas_piezas",
                  "#166534",
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: 12,
                }}
              >
                {renderMiniBars(
                  "Merma por día (últimos 7 días)",
                  piezasSeriesPorDimension.dia,
                  "merma_piezas",
                  "#dc2626",
                )}
                {renderMiniBars(
                  "Merma por semana (últimas 4 semanas)",
                  piezasSeriesPorDimension.semana,
                  "merma_piezas",
                  "#b91c1c",
                )}
                {renderMiniBars(
                  "Merma por mes (últimos 6 meses)",
                  piezasSeriesPorDimension.mes,
                  "merma_piezas",
                  "#991b1b",
                )}
              </div>
            </>
          )}
        </div>
      )}

      {loading && <p style={{ color: "#374151" }}>Cargando datos...</p>}
      {!loading && error && <p style={{ color: "#b91c1c" }}>{error}</p>}

      {!loading && !error && (
        <div style={{ overflowX: "auto" }}>
          <table
            className="inventario-es-table"
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "#fff",
            }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: 10,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  Nombre
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: 10,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  Tipo
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: 10,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  Stock anterior
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: 10,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  Ingreso
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: 10,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  Salida
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: 10,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  Stock actual
                </th>
              </tr>
            </thead>
            <tbody>
              {filasFiltradas.map((fila) => (
                <tr key={`${fila.tipo}-${fila.id}`}>
                  <td style={{ padding: 10, border: "1px solid #e5e7eb" }}>
                    {fila.nombre}
                  </td>
                  <td style={{ padding: 10, border: "1px solid #e5e7eb" }}>
                    {fila.tipo}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fila.stockAnterior.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fila.ingresoPeriodo.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fila.salidaPeriodo.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fila.stockActual.toFixed(2)}
                  </td>
                </tr>
              ))}

              {filasFiltradas.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: 16,
                      border: "1px solid #e5e7eb",
                      textAlign: "center",
                      color: "#6b7280",
                    }}
                  >
                    No hay datos para mostrar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {masivoOpen && (
        <div
          className="inventario-es-no-print"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(860px, 96vw)",
              maxHeight: "88vh",
              overflow: "auto",
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <div>
                <h3 style={{ margin: 0, color: "#111827" }}>
                  📥📤 Entrada/Salida masiva
                </h3>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  Mostrando{" "}
                  {filtroTipo === "insumo"
                    ? "Insumos"
                    : filtroTipo === "bebida"
                      ? "Bebidas"
                      : "Piezas de pollo"}
                </p>
              </div>
              <button
                onClick={() => setMasivoOpen(false)}
                style={{
                  background: "#e5e7eb",
                  color: "#111827",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => setMasivoTipo("entrada")}
                style={{
                  background: masivoTipo === "entrada" ? "#dbeafe" : "#e5e7eb",
                  color: "#111827",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
                disabled={masivoGuardando}
              >
                Entrada
              </button>
              <button
                onClick={() => setMasivoTipo("salida")}
                style={{
                  background: masivoTipo === "salida" ? "#fee2e2" : "#e5e7eb",
                  color: "#111827",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
                disabled={masivoGuardando}
              >
                Salida
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  background: "#fff",
                }}
              >
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: 10,
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      Nombre
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: 10,
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      Valor a {masivoTipo === "entrada" ? "entrar" : "salir"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filasFiltradas.map((fila) => (
                    <tr key={`masivo-${fila.tipo}-${fila.id}`}>
                      <td style={{ padding: 10, border: "1px solid #e5e7eb" }}>
                        {fila.nombre}
                      </td>
                      <td style={{ padding: 10, border: "1px solid #e5e7eb" }}>
                        <input
                          className="masivo-input"
                          type="number"
                          min="0"
                          step="1"
                          value={masivoValores[fila.id] || ""}
                          onChange={(e) =>
                            setMasivoValores((prev) => ({
                              ...prev,
                              [fila.id]: String(
                                Math.floor(Math.abs(Number(e.target.value))),
                              ),
                            }))
                          }
                          disabled={masivoGuardando}
                          style={{
                            width: "100%",
                            border: "none",
                            borderBottom: "1px solid #d1d5db",
                            borderRadius: 0,
                            padding: "8px 10px",
                            color: "#111827",
                            background: "transparent",
                            textAlign: "right",
                            outline: "none",
                          }}
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                marginTop: 14,
              }}
            >
              <button
                onClick={() => setMasivoOpen(false)}
                disabled={masivoGuardando}
                style={{
                  background: "#e5e7eb",
                  color: "#111827",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={guardarMasivo}
                disabled={masivoGuardando}
                style={{
                  background: "#dbeafe",
                  color: "#111827",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {masivoGuardando
                  ? "Guardando..."
                  : `Guardar ${masivoTipo} masiva`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOMA DE INVENTARIO MODAL ===== */}
      {tomaOpen && (
        <div
          className="toma-no-print"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(900px, 98vw)",
              maxHeight: "92vh",
              background: "#fff",
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h3 style={{ margin: 0, color: "#111827" }}>
                  📋 Toma de inventario
                </h3>
                <p
                  style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}
                >
                  {filtroTipo === "insumo" ? "Insumos" : "Bebidas"} —{" "}
                  {new Date().toLocaleDateString("es-HN", {
                    dateStyle: "long",
                  })}
                </p>
              </div>
              <button
                onClick={() => setTomaOpen(false)}
                style={{
                  background: "#e5e7eb",
                  color: "#111827",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>

            {/* Tabla scrollable */}
            <div style={{ overflowY: "auto", flex: 1, padding: "12px 20px" }}>
              {tomaExito ? (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <p
                    style={{ fontSize: 20, fontWeight: 700, color: "#059669" }}
                  >
                    ✅ Toma registrada correctamente
                  </p>
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 14,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "left",
                          border: "1px solid #e5e7eb",
                          color: "#374151",
                        }}
                      >
                        Nombre
                      </th>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          border: "1px solid #e5e7eb",
                          color: "#374151",
                          width: 100,
                        }}
                      >
                        Stock
                      </th>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          border: "1px solid #e5e7eb",
                          color: "#374151",
                          width: 120,
                        }}
                      >
                        Conteo
                      </th>
                      <th
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          border: "1px solid #e5e7eb",
                          color: "#374151",
                          width: 110,
                        }}
                      >
                        Diferencia
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tomaFilas.map((fila) => {
                      const conteo = Math.floor(
                        Math.abs(numberValue(tomaConteos[fila.id])),
                      );
                      const diff =
                        tomaConteos[fila.id] !== undefined
                          ? conteo - fila.stockActual
                          : null;
                      return (
                        <tr key={fila.id}>
                          <td
                            style={{
                              padding: "8px 12px",
                              border: "1px solid #e5e7eb",
                            }}
                          >
                            {fila.nombre}
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              border: "1px solid #e5e7eb",
                              textAlign: "right",
                            }}
                          >
                            {fila.stockActual}
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              border: "1px solid #e5e7eb",
                            }}
                          >
                            <input
                              className="masivo-input"
                              type="number"
                              min="0"
                              step="1"
                              value={tomaConteos[fila.id] ?? ""}
                              onChange={(e) =>
                                setTomaConteos((prev) => ({
                                  ...prev,
                                  [fila.id]: e.target.value,
                                }))
                              }
                              disabled={tomaGuardando}
                              placeholder="0"
                              style={{
                                width: "100%",
                                border: "none",
                                borderBottom: "1px solid #d1d5db",
                                borderRadius: 0,
                                padding: "6px 8px",
                                color: "#111827",
                                background: "transparent",
                                textAlign: "right",
                                outline: "none",
                              }}
                            />
                          </td>
                          <td
                            style={{
                              padding: "8px 12px",
                              border: "1px solid #e5e7eb",
                              textAlign: "right",
                              fontWeight:
                                diff !== null && diff !== 0 ? 700 : 400,
                              color:
                                diff === null
                                  ? "#9ca3af"
                                  : diff > 0
                                    ? "#059669"
                                    : diff < 0
                                      ? "#dc2626"
                                      : "#111827",
                            }}
                          >
                            {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer botones */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {!tomaExito && (
                <>
                  <button
                    onClick={() => {
                      // imprimir carta
                      const titulo = `Toma de inventario — ${filtroTipo === "insumo" ? "Insumos" : "Bebidas"} — ${new Date().toLocaleDateString("es-HN")}`;
                      const filas = tomaFilas
                        .map((f) => {
                          const conteo =
                            tomaConteos[f.id] !== undefined
                              ? Math.floor(
                                  Math.abs(numberValue(tomaConteos[f.id])),
                                )
                              : "—";
                          const diff =
                            tomaConteos[f.id] !== undefined
                              ? Math.floor(
                                  Math.abs(numberValue(tomaConteos[f.id])),
                                ) - f.stockActual
                              : "—";
                          const diffStr =
                            typeof diff === "number"
                              ? diff > 0
                                ? `+${diff}`
                                : String(diff)
                              : "—";
                          return `<tr><td>${f.nombre}</td><td style="text-align:right">${f.stockActual}</td><td style="text-align:right">${conteo}</td><td style="text-align:right;font-weight:${typeof diff === "number" && diff !== 0 ? "bold" : "normal"};color:${typeof diff === "number" ? (diff > 0 ? "green" : diff < 0 ? "red" : "black") : "gray"}">${diffStr}</td></tr>`;
                        })
                        .join("");
                      const html = `<html><head><title>${titulo}</title><style>body{font-family:Arial,sans-serif;font-size:11pt;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:5px 8px}h2{margin-bottom:8px}@media print{button{display:none}}</style></head><body><h2>${titulo}</h2><table><thead><tr><th>Nombre</th><th>Stock</th><th>Conteo</th><th>Diferencia</th></tr></thead><tbody>${filas}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`;
                      const w = window.open("", "_blank");
                      if (w) {
                        w.document.write(html);
                        w.document.close();
                      }
                    }}
                    style={{
                      background: "#dbeafe",
                      color: "#111827",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 14px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    🖨 Imprimir carta
                  </button>

                  <button
                    onClick={() => {
                      // imprimir 80mm
                      const titulo = `Toma ${filtroTipo === "insumo" ? "Insumos" : "Bebidas"}`;
                      const fecha = new Date().toLocaleDateString("es-HN");
                      const filas = tomaFilas
                        .map((f) => {
                          const conteo =
                            tomaConteos[f.id] !== undefined
                              ? Math.floor(
                                  Math.abs(numberValue(tomaConteos[f.id])),
                                )
                              : "—";
                          const diff =
                            tomaConteos[f.id] !== undefined
                              ? Math.floor(
                                  Math.abs(numberValue(tomaConteos[f.id])),
                                ) - f.stockActual
                              : "—";
                          const diffStr =
                            typeof diff === "number"
                              ? diff > 0
                                ? `+${diff}`
                                : String(diff)
                              : "—";
                          return `<tr><td>${f.nombre}</td><td>${f.stockActual}</td><td>${conteo}</td><td>${diffStr}</td></tr>`;
                        })
                        .join("");
                      const html = `<html><head><title>${titulo}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:monospace;font-size:8pt;width:72mm;padding:4px}h3{font-size:9pt;text-align:center;margin-bottom:2px}p{text-align:center;font-size:7pt;margin-bottom:4px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px dotted #000;padding:2px 3px;font-size:7.5pt}@media print{button{display:none}}</style></head><body><h3>${titulo}</h3><p>${fecha}</p><table><thead><tr><th>Nombre</th><th>Stk</th><th>Cnt</th><th>Dif</th></tr></thead><tbody>${filas}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`;
                      const w = window.open("", "_blank");
                      if (w) {
                        w.document.write(html);
                        w.document.close();
                      }
                    }}
                    style={{
                      background: "#f3f4f6",
                      color: "#111827",
                      border: "1px solid #d1d5db",
                      borderRadius: 8,
                      padding: "8px 14px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    🖨 Imprimir 80mm
                  </button>

                  <button
                    onClick={guardarToma}
                    disabled={tomaGuardando}
                    style={{
                      background: "#d1fae5",
                      color: "#111827",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 14px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    {tomaGuardando ? "Registrando..." : "✅ Registrar toma"}
                  </button>
                </>
              )}
              <button
                onClick={() => setTomaOpen(false)}
                style={{
                  background: "#e5e7eb",
                  color: "#111827",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 14px",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {tomaExito ? "Cerrar" : "Cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
