import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { getDatosNegocioLocal, upsertOne, STORE } from "./utils/localDB";
import {
  guardarDatosNegocioCache,
  obtenerDatosNegocioCache,
} from "./utils/offlineSync";

interface DatosNegocio {
  id?: number;
  nombre_negocio: string;
  rtn: string;
  direccion: string;
  celular: string;
  propietario: string;
  logo_url: string | null;
}

const defaultDatos: DatosNegocio = {
  nombre_negocio: "puntoventa",
  rtn: "",
  direccion: "",
  celular: "",
  propietario: "",
  logo_url: null,
};

let cachedDatos: DatosNegocio | null = null;

export function useDatosNegocio() {
  const [datos, setDatos] = useState<DatosNegocio>(cachedDatos || defaultDatos);
  const [loading, setLoading] = useState(!cachedDatos);

  useEffect(() => {
    if (cachedDatos) return;

    async function cargarDatos() {
      try {
        // 1. Intentar desde IndexedDB primero (offline-first)
        const datosIDB = await getDatosNegocioLocal();
        if (datosIDB) {
          cachedDatos = datosIDB;
          setDatos(datosIDB);
          document.title = datosIDB.nombre_negocio || "puntoventa";
          if (datosIDB.logo_url) updateFavicon(datosIDB.logo_url);
          setLoading(false);
          // Sync silencioso en background si hay conexión
          if (navigator.onLine) {
            (async () => {
              try {
                const { data: d } = await supabase
                  .from("datos_negocio")
                  .select("*")
                  .order("id", { ascending: true })
                  .limit(1)
                  .maybeSingle();
                if (d) {
                  await upsertOne(STORE.DATOS_NEGOCIO, d);
                  cachedDatos = d;
                  setDatos(d);
                  document.title = d.nombre_negocio || "puntoventa";
                  if (d.logo_url) updateFavicon(d.logo_url);
                }
              } catch {
                /* silencioso */
              }
            })();
          }
          return;
        }

        // 2. No hay datos en IDB → intentar desde Supabase
        const { data, error } = await supabase
          .from("datos_negocio")
          .select("*")
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          cachedDatos = data;
          setDatos(data);
          // Guardar en IDB y cache legado
          await upsertOne(STORE.DATOS_NEGOCIO, data);
          await guardarDatosNegocioCache({
            id: data.id?.toString() || "1",
            nombre_negocio: data.nombre_negocio,
            rtn: data.rtn,
            direccion: data.direccion,
            celular: data.celular,
            propietario: data.propietario,
            logo_url: data.logo_url,
          });
          document.title = data.nombre_negocio || "puntoventa";
          if (data.logo_url) updateFavicon(data.logo_url);
        }
      } catch (error) {
        console.error("Error:", error);
        // Fallback a cache legado (localStorage/offlineSync)
        try {
          const datosCache = await obtenerDatosNegocioCache();

          if (datosCache) {
            console.log("✓ Datos del negocio recuperados desde cache");
            const datosRecuperados: DatosNegocio = {
              id: parseInt(datosCache.id),
              nombre_negocio: datosCache.nombre_negocio,
              rtn: datosCache.rtn,
              direccion: datosCache.direccion,
              celular: datosCache.celular,
              propietario: datosCache.propietario,
              logo_url: datosCache.logo_url,
            };

            cachedDatos = datosRecuperados;
            setDatos(datosRecuperados);

            // Actualizar el título de la página
            document.title = datosRecuperados.nombre_negocio || "puntoventa";

            // Actualizar el favicon si hay logo
            if (datosRecuperados.logo_url) {
              updateFavicon(datosRecuperados.logo_url);
            }
          } else {
            console.warn("⚠ No hay datos del negocio en cache");
          }
        } catch (cacheError) {
          console.error(
            "Error cargando datos del negocio desde cache:",
            cacheError,
          );
        }
      } finally {
        setLoading(false);
      }
    }

    cargarDatos();
  }, []);

  return { datos, loading };
}

function updateFavicon(logoUrl: string) {
  // Actualizar favicon
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = logoUrl;

  // Actualizar apple-touch-icon si existe
  let appleLink = document.querySelector(
    "link[rel~='apple-touch-icon']",
  ) as HTMLLinkElement;
  if (!appleLink) {
    appleLink = document.createElement("link");
    appleLink.rel = "apple-touch-icon";
    document.head.appendChild(appleLink);
  }
  appleLink.href = logoUrl;
}

// Función para invalidar el cache (llamar después de actualizar en DatosNegocioView)
export function invalidarCacheDatosNegocio() {
  cachedDatos = null;
}
