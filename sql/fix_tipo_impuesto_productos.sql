-- Normaliza tipo_impuesto (0.15/0.18) y corrige impuesto/sub_total
-- Ejecutar en Supabase SQL Editor

begin;

-- 1) Normalizar tipo_impuesto legacy a formato canónico de tasa
update productos
set tipo_impuesto = case
  when lower(trim(coalesce(tipo_impuesto, ''))) in ('isv', 'venta', '15', '15%', '0.15') then '0.15'
  when lower(trim(coalesce(tipo_impuesto, ''))) in ('alcohol', '18', '18%', '0.18') then '0.18'
  else '0.15'
end;

-- 2) Recalcular impuesto y sub_total según tipo_impuesto normalizado
update productos
set
  impuesto = case
    when tipo_impuesto = '0.15' then round((coalesce(precio, 0)::numeric * 0.15), 2)
    when tipo_impuesto = '0.18' then round((coalesce(precio, 0)::numeric * 0.18), 2)
    else 0
  end,
  sub_total = round(
    coalesce(precio, 0)::numeric +
    case
      when tipo_impuesto = '0.15' then (coalesce(precio, 0)::numeric * 0.15)
      when tipo_impuesto = '0.18' then (coalesce(precio, 0)::numeric * 0.18)
      else 0
    end,
    2
  );

-- 3) Restricción para evitar futuros valores inválidos
alter table productos
  drop constraint if exists productos_tipo_impuesto_check;

alter table productos
  add constraint productos_tipo_impuesto_check
  check (tipo_impuesto in ('0.15', '0.18'));

-- 4) (Opcional) Saneamiento de JSON en ventas.productos para históricos
--    Solo aplica si en tu JSON existe tipo_impuesto legado.
--    Puedes comentar este bloque si no lo necesitas.
update ventas v
set productos = (
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(e) = 'object' then
          e || jsonb_build_object(
            'tipo_impuesto',
            case
              when lower(coalesce(e->>'tipo_impuesto', '')) in ('isv','venta','15','15%','0.15') then '0.15'
              when lower(coalesce(e->>'tipo_impuesto', '')) in ('alcohol','18','18%','0.18') then '0.18'
              when lower(coalesce(e->>'tipo', '')) = 'bebida' then '0.18'
              when lower(coalesce(e->>'tipo', '')) = 'comida' then '0.15'
              else coalesce(e->>'tipo_impuesto', '0')
            end,
            'tasa_impuesto',
            case
              when lower(coalesce(e->>'tipo_impuesto', '')) in ('isv','venta','15','15%','0.15') then 0.15
              when lower(coalesce(e->>'tipo_impuesto', '')) in ('alcohol','18','18%','0.18') then 0.18
              when lower(coalesce(e->>'tipo', '')) = 'bebida' then 0.18
              when lower(coalesce(e->>'tipo', '')) = 'comida' then 0.15
              else 0
            end
          )
        else e
      end
    ),
    '[]'::jsonb
  )::text
  from jsonb_array_elements(
    case
      when v.productos is null or btrim(v.productos) = '' then '[]'::jsonb
      else v.productos::jsonb
    end
  ) e
)
where v.productos is not null;

commit;
