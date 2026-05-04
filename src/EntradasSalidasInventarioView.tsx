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
  entra: number;
  sale: number;
  stock: number;
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
  const [filas, setFilas] = useState<FilaInventario[]>([]);
  const [masivoOpen, setMasivoOpen] = useState(false);
  const [masivoTipo, setMasivoTipo] = useState<"entrada" | "salida">("entrada");
  const [masivoValores, setMasivoValores] = useState<Record<string, string>>(
    {},
  );
  const [masivoGuardando, setMasivoGuardando] = useState(false);

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

  const cargarDatos = async () => {
    setLoading(true);
    setError("");

    try {
      let movimientosQuery = supabase
        .from("movimientos_inventario")
        .select(
          "item_tipo, tipo, insumo_id, producto_id, cantidad, created_at",
        );

      if (fechaDesde) {
        movimientosQuery = movimientosQuery.gte(
          "created_at",
          `${fechaDesde}T00:00:00`,
        );
      }

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

      const entradasInsumo = new Map<string, number>();
      const salidasInsumo = new Map<string, number>();
      const entradasProducto = new Map<string, number>();
      const salidasProducto = new Map<string, number>();

      movimientos.forEach((mov) => {
        const itemTipo = normalizeText(mov.item_tipo);
        const tipo = normalizeMovType(mov.tipo);
        const cantidad = numberValue(mov.cantidad);
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
          if (isEntrada) {
            entradasInsumo.set(
              id,
              numberValue(entradasInsumo.get(id)) + cantidad,
            );
          }
          if (isSalida) {
            salidasInsumo.set(
              id,
              numberValue(salidasInsumo.get(id)) + cantidad,
            );
          }
        }

        if (itemTipo === "producto" && mov.producto_id) {
          const id = String(mov.producto_id);
          if (isEntrada) {
            entradasProducto.set(
              id,
              numberValue(entradasProducto.get(id)) + cantidad,
            );
          }
          if (isSalida) {
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
          const entra = numberValue(entradasInsumo.get(id));
          const sale = numberValue(salidasInsumo.get(id));
          return {
            id,
            nombre: String(insumo.nombre || ""),
            tipo: "Insumo",
            entra,
            sale,
            stock: entra - sale,
          };
        },
      );

      const filasBebidas: FilaInventario[] = (bebidasRes.data || []).map(
        (producto: any) => {
          if (normalizeText(producto.tipo) !== "bebida") return null;

          const id = String(producto.id);
          const entradas = numberValue(entradasProducto.get(id));
          const salidas = numberValue(salidasProducto.get(id));

          return {
            id,
            nombre: String(producto.nombre || ""),
            tipo: "Bebida",
            entra: entradas,
            sale: salidas,
            stock: entradas - salidas,
          };
        },
      ).filter((fila): fila is FilaInventario => Boolean(fila));

      setFilas(
        [...filasInsumos, ...filasBebidas].sort((a, b) =>
          a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }),
        ),
      );
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

  const filasFiltradas = useMemo(() => {
    const normalizeText = (value: string) =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();

    if (filtroTipo === "insumo") {
      return filas.filter((fila) => fila.tipo === "Insumo");
    }
    if (filtroTipo === "bebida") {
      return filas.filter((fila) => fila.tipo === "Bebida");
    }
    if (filtroTipo === "piezas_pollo") {
      return filas.filter(
        (fila) =>
          fila.tipo === "Insumo" &&
          normalizeText(fila.nombre) === "piezas de pollo",
      );
    }
    return filas;
  }, [filas, filtroTipo]);

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
    // Usar los mismos datos y stock que muestra la tabla principal (Entra - Sale del rango)
    setTomaFilas(
      filasFiltradas.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        tipo: f.tipo,
        stockActual: f.stock,
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
            background: "#e5e7eb",
            color: "#111827",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
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
                background: "#f3f4f6",
                color: "#111827",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                padding: "8px 12px",
                cursor: "pointer",
                fontWeight: 600,
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
              background: "#dbeafe",
              color: "#111827",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
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
              const filasTR = filasFiltradas.map((f) =>
                `<tr><td>${f.nombre}</td><td>${f.tipo}</td><td style="text-align:right">${f.entra.toFixed(2)}</td><td style="text-align:right">${f.sale.toFixed(2)}</td><td style="text-align:right">${f.stock.toFixed(2)}</td></tr>`
              ).join("");
              const html = `<html><head><title>${titulo}</title><style>body{font-family:Arial,sans-serif;font-size:11pt;padding:20px}h2{margin-bottom:8px;font-size:13pt}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:5px 8px}th{background:#f3f4f6;text-align:left}@media print{button{display:none}}</style></head><body><h2>${titulo}</h2><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Entra</th><th>Sale</th><th>Stock</th></tr></thead><tbody>${filasTR}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`;
              const w = window.open("", "_blank");
              if (w) { w.document.write(html); w.document.close(); }
            }}
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
            Imprimir tabla
          </button>

          <button
            onClick={abrirMasivo}
            style={{
              background: "#ede9fe",
              color: "#111827",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            📥📤 Entrada/Salida masiva
          </button>

          <button
            onClick={abrirToma}
            style={{
              background: "#fef3c7",
              color: "#111827",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
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
                  Entra
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: 10,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  Sale
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: 10,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  Stock
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
                    {fila.entra.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fila.sale.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: 10,
                      border: "1px solid #e5e7eb",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fila.stock.toFixed(2)}
                  </td>
                </tr>
              ))}

              {filasFiltradas.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
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
