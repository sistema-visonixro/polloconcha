import { useEffect, useState } from "react";
import { supabase } from "../../src/supabaseClient";

// Define the Producto interface
interface Producto {
  id?: string;
  codigo: number;
  nombre: string;
  imagen: string;
  precio: number;
  tipo: string;
  tipo_impuesto: string;
  impuesto: number;
  sub_total: number;
}

interface InventarioViewProps {
  onBack: () => void;
}

// Initialize Supabase client
// use centralized supabase client from src/supabaseClient.ts

function generarCodigo() {
  return Math.floor(100000 + Math.random() * 900000);
}

export default function InventarioView({ onBack }: InventarioViewProps) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Partial<Producto>>({
    tipo: "comida",
    tipo_impuesto: "0.15",
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [imagenFile, setImagenFile] = useState<File | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Fetch products
  useEffect(() => {
    const fetchProductos = async () => {
      try {
        const { data, error } = await supabase.from("productos").select("*");
        if (error) throw error;
        setProductos(data);
        setLoading(false);
      } catch (err) {
        setError("Error al cargar productos");
        setLoading(false);
      }
    };
    fetchProductos();
  }, []);

  // Calculate tax and subtotal
  const calcularImpuesto = (precio: number, tipo_impuesto: string) => {
    const raw = String(tipo_impuesto || "")
      .trim()
      .toLowerCase();
    if (raw === "venta" || raw === "isv" || raw === "15" || raw === "15%") {
      return precio * 0.15;
    }
    if (raw === "alcohol" || raw === "18" || raw === "18%") {
      return precio * 0.18;
    }
    const n = Number(raw.replace("%", ""));
    if (Number.isFinite(n)) {
      if (n >= 1) return precio * (n / 100);
      return precio * n;
    }
    return precio * 0.15;
  };

  const obtenerEtiquetaImpuesto = (tipoImpuesto: string | undefined) => {
    const tipo = String(tipoImpuesto || "")
      .trim()
      .toLowerCase();
    if (
      tipo === "venta" ||
      tipo === "isv" ||
      tipo === "15" ||
      tipo === "15%" ||
      tipo === "0.15"
    )
      return "15%";
    if (
      tipo === "alcohol" ||
      tipo === "18" ||
      tipo === "18%" ||
      tipo === "0.18"
    )
      return "18%";
    return "15%";
  };

  // Handle form submission (create or edit product)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    let imagenUrl = form.imagen || "";
    const precio = form.precio || 0;
    const tipo_impuesto =
      String(form.tipo_impuesto || "").trim() === "0.18" ? "0.18" : "0.15";
    const impuesto = calcularImpuesto(precio, tipo_impuesto);
    const sub_total = precio + impuesto;

    try {
      // Upload image if present
      if (imagenFile) {
        const extension = imagenFile.name.split(".").pop();
        const randomNum = Math.floor(Math.random() * 1000000000);
        const nombreArchivo = `${Date.now()}${randomNum}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("inventario")
          .upload(nombreArchivo, imagenFile, {
            upsert: true,
            contentType: imagenFile.type || "application/octet-stream",
          });
        if (uploadError)
          throw new Error("Error al subir imagen: " + uploadError.message);

        const { data } = supabase.storage
          .from("inventario")
          .getPublicUrl(nombreArchivo);
        imagenUrl = data.publicUrl;
      }

      const body = {
        codigo: form.codigo || generarCodigo(),
        nombre: form.nombre,
        precio,
        tipo: form.tipo,
        tipo_impuesto,
        impuesto,
        sub_total,
        imagen: imagenUrl,
      };

      let result;
      if (editId) {
        // Update product
        const { data, error } = await supabase
          .from("productos")
          .update(body)
          .eq("id", editId)
          .select()
          .single();
        if (error) throw error;
        result = data;
      } else {
        // Create product
        const { data, error } = await supabase
          .from("productos")
          .insert([body])
          .select()
          .single();
        if (error) throw error;
        result = data;
      }

      console.log("Producto guardado:", result);
      setShowModal(false);
      setForm({ tipo: "comida", tipo_impuesto: "0.15" });
      setImagenFile(null);

      // Refresh products
      const { data } = await supabase.from("productos").select("*");
      setProductos(data || []);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || "Error al guardar producto");
      setLoading(false);
      console.error("Error al guardar producto:", err);
    }
  };

  // Delete product
  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar producto?")) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("productos").delete().eq("id", id);
      if (error) throw error;
      setProductos(productos.filter((p) => p.id !== id));
      setLoading(false);
    } catch {
      setError("Error al eliminar producto");
      setLoading(false);
    }
  };

  // Prepare for edit
  const handleEdit = (producto: Producto) => {
    setEditId(producto.id ?? null);
    setForm(producto);
    setShowModal(true);
  };

  // Prepare for new product
  const handleNew = () => {
    setEditId(null);
    setForm({ tipo: "comida", tipo_impuesto: "0.15" });
    setImagenFile(null);
    setShowModal(true);
  };

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: "40px auto",
        background: "rgba(255,255,255,0.95)",
        borderRadius: 16,
        boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
        padding: 32,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <button
          onClick={onBack}
          style={{
            background: "#fff",
            color: "#1976d2",
            border: "2px solid #1976d2",
            borderRadius: 8,
            padding: "8px 20px",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer",
            marginRight: 16,
            boxShadow: "0 2px 8px #1976d222",
            transition: "background 0.2s, color 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#1976d2";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.color = "#1976d2";
          }}
        >
          ← Volver
        </button>
        <h2 style={{ color: "#1976d2", marginBottom: 0 }}>Inventario</h2>
      </div>
      <button
        onClick={handleNew}
        style={{
          marginLeft: 8,
          marginBottom: 16,
          background: "#1976d2",
          color: "#fff",
          borderRadius: 8,
          padding: "10px 20px",
          fontWeight: 600,
          fontSize: 16,
          border: "none",
          cursor: "pointer",
        }}
      >
        Nuevo producto
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {loading ? (
        <p>Cargando...</p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: 24,
          }}
        >
          <thead>
            <tr style={{ background: "#e3f2fd" }}>
              <th style={{ padding: 12 }}>Código</th>
              <th style={{ padding: 12 }}>Nombre</th>
              <th style={{ padding: 12 }}>Imagen</th>
              <th style={{ padding: 12 }}>Precio</th>
              <th style={{ padding: 12 }}>Tipo</th>
              <th style={{ padding: 12 }}>Impuesto</th>
              <th style={{ padding: 12 }}>Sub-total</th>
              <th style={{ padding: 12 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {productos.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 12 }}>{p.codigo}</td>
                <td style={{ padding: 12 }}>{p.nombre}</td>
                <td style={{ padding: 12 }}>
                  {p.imagen ? (
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        overflow: "hidden",
                        boxShadow: "0 2px 8px #1976d222",
                        background: "#f5f5f5",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <img
                        src={p.imagen}
                        alt={p.nombre}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    </div>
                  ) : (
                    <span style={{ color: "#bbb" }}>Sin imagen</span>
                  )}
                </td>
                <td style={{ padding: 12 }}>L {p.precio.toFixed(2)}</td>
                <td style={{ padding: 12 }}>{p.tipo}</td>
                <td style={{ padding: 12 }}>
                  {obtenerEtiquetaImpuesto(p.tipo_impuesto)}
                </td>
                <td style={{ padding: 12 }}>L {p.sub_total.toFixed(2)}</td>
                <td style={{ padding: 12 }}>
                  <button
                    onClick={() => handleEdit(p)}
                    style={{
                      marginRight: 8,
                      background: "#1976d2",
                      color: "#fff",
                      borderRadius: 8,
                      padding: "8px 16px",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(p.id!)}
                    style={{
                      background: "#d32f2f",
                      color: "#fff",
                      borderRadius: 8,
                      padding: "8px 16px",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
              boxShadow: "0 8px 32px rgba(25, 118, 210, 0.18)",
              padding: 32,
              minWidth: 350,
              maxWidth: 420,
              width: "100%",
              position: "relative",
            }}
          >
            <button
              onClick={() => setShowModal(false)}
              style={{
                position: "absolute",
                top: 12,
                right: 16,
                fontSize: 22,
                background: "none",
                border: "none",
                color: "#1976d2",
                cursor: "pointer",
              }}
            >
              ×
            </button>
            <h3 style={{ color: "#1976d2", marginBottom: 18 }}>
              {editId ? "Editar producto" : "Nuevo producto"}
            </h3>
            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <input
                type="text"
                placeholder="Nombre de producto"
                value={form.nombre || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nombre: e.target.value }))
                }
                required
                style={{
                  padding: "10px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 16,
                }}
              />
              <input
                type="number"
                placeholder="Precio"
                value={form.precio || ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, precio: Number(e.target.value) }))
                }
                required
                style={{
                  padding: "10px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 16,
                }}
              />
              <select
                value={form.tipo || "comida"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tipo: e.target.value }))
                }
                style={{
                  padding: "10px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 16,
                }}
              >
                <option value="comida">Comida</option>
                <option value="bebida">Bebida</option>
              </select>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, tipo_impuesto: "0.15" }))
                  }
                  style={{
                    padding: "10px",
                    borderRadius: 8,
                    border:
                      (form.tipo_impuesto || "0.15") === "0.15"
                        ? "2px solid #1976d2"
                        : "1px solid #ccc",
                    background:
                      (form.tipo_impuesto || "0.15") === "0.15"
                        ? "#e3f2fd"
                        : "#fff",
                    color: "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 15,
                  }}
                >
                  15%
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, tipo_impuesto: "0.18" }))
                  }
                  style={{
                    padding: "10px",
                    borderRadius: 8,
                    border:
                      (form.tipo_impuesto || "0.15") === "0.18"
                        ? "2px solid #1976d2"
                        : "1px solid #ccc",
                    background:
                      (form.tipo_impuesto || "0.15") === "0.18"
                        ? "#e3f2fd"
                        : "#fff",
                    color: "#0f172a",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: 15,
                  }}
                >
                  18%
                </button>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImagenFile(e.target.files?.[0] || null)}
                style={{
                  padding: "10px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 16,
                }}
              />
              <button
                type="submit"
                style={{
                  background: "#1976d2",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "10px 0",
                  fontWeight: 600,
                  fontSize: 16,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {editId ? "Guardar cambios" : "Crear producto"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
