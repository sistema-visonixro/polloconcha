-- =============================================================
-- PATCH: Registrar entrada de inventario al procesar devolucion
-- Fecha: 2026-05-07
--
-- Problema:
--   El trigger procesar_salida_inventario_por_venta() siempre registra
--   tipo 'venta' (salida) incluso cuando NEW.tipo = 'DEVOLUCION'.
--   Esto descuenta inventario en lugar de reponerlo.
--
-- Solución:
--   Detectar NEW.tipo = 'DEVOLUCION' y usar tipo 'entrada' con cantidad
--   positiva (ABS), con nota que identifique la devolución.
-- =============================================================

create or replace function public.procesar_salida_inventario_por_venta()
returns trigger
language plpgsql
as $$
declare
  v_items           jsonb;
  v_item            jsonb;
  v_producto_id     uuid;
  v_cantidad        numeric(14,4);
  v_nombre          text;
  v_tipo_pos        text;
  v_config          record;
  v_receta          record;
  v_detalle         record;
  v_consumo         numeric(14,4);
  v_ref_id          text;
  v_es_devolucion   boolean;
  v_tipo_mov        text;
  v_nota_prefix     text;
begin
  -- Referencia: número de factura o id del registro
  v_ref_id := coalesce(new.factura, new.id::text);

  -- Detectar si es una devolución
  v_es_devolucion := coalesce(upper(trim(new.tipo)), '') = 'DEVOLUCION';

  if v_es_devolucion then
    v_tipo_mov    := 'entrada';
    v_nota_prefix := 'Devolución de venta: ';
  else
    v_tipo_mov    := 'venta';
    v_nota_prefix := 'Salida automática por venta: ';
  end if;

  -- Parsear el campo productos (texto JSON → jsonb)
  begin
    v_items := new.productos::jsonb;
  exception when others then
    raise notice 'inventario_venta: no se pudo parsear productos de factura %. Error: %',
                  v_ref_id, sqlerrm;
    return new;
  end;

  if jsonb_typeof(v_items) <> 'array' then
    return new;
  end if;

  -- Procesar cada producto de la factura
  for v_item in select * from jsonb_array_elements(v_items)
  loop
    begin

      begin
        v_producto_id := coalesce(
          v_item ->> 'id',
          v_item ->> 'producto_id'
        )::uuid;
      exception when others then
        raise notice 'inventario_venta: UUID inválido en factura %, saltando item',
                      v_ref_id;
        continue;
      end;

      -- Cantidad siempre positiva (en devolución los productos vienen con cantidad positiva)
      v_cantidad := abs(coalesce((v_item ->> 'cantidad')::numeric, 1));
      v_nombre   := coalesce(v_item ->> 'nombre', 'Producto');

      select p.tipo into v_tipo_pos
        from public.productos p
       where p.id = v_producto_id;

      select *
        into v_config
        from public.inventario_config_productos cfg
       where cfg.producto_id = v_producto_id;

      if not found then
        begin
          insert into public.inventario_config_productos
               (producto_id, controla_inventario, modo_consumo)
          values (
            v_producto_id,
            case
              when coalesce(v_tipo_pos,'') in ('comida','bebida','complemento')
                then true
              else false
            end,
            case
              when coalesce(v_tipo_pos,'') = 'comida'                    then 'receta'
              when coalesce(v_tipo_pos,'') in ('bebida','complemento')   then 'stock_producto'
              else 'sin_control'
            end
          )
          on conflict (producto_id) do nothing;
        exception when others then
          raise notice 'inventario_venta: no se pudo crear config para % — %',
                        v_producto_id, sqlerrm;
        end;

        select *
          into v_config
          from public.inventario_config_productos cfg
         where cfg.producto_id = v_producto_id;
      end if;

      if coalesce(v_config.controla_inventario, false) = false
         or coalesce(v_config.modo_consumo, 'sin_control') = 'sin_control'
      then
        continue;
      end if;

      -- -------------------------------------------------------
      -- MODO: stock_producto  (bebida, complemento)
      -- -------------------------------------------------------
      if v_config.modo_consumo = 'stock_producto' then
        begin
          perform public.registrar_movimiento_inventario(
            'producto',
            v_producto_id,
            v_tipo_mov,
            v_cantidad,
            0,
            'factura',
            v_ref_id,
            v_nota_prefix || v_nombre,
            new.cajero,
            new.cajero_id::text,
            false
          );
        exception when others then
          raise notice 'inventario_venta: error al mover stock de producto % (factura %): %',
                        v_producto_id, v_ref_id, sqlerrm;
        end;

      -- -------------------------------------------------------
      -- MODO: receta  (comida) — solo aplica a devoluciones si hay receta activa
      -- -------------------------------------------------------
      elsif v_config.modo_consumo = 'receta' then

        select r.id, r.rendimiento
          into v_receta
          from public.recetas r
         where r.producto_id = v_producto_id
           and r.activo = true;

        if not found then
          raise notice 'inventario_venta: producto % sin receta activa — inventario no afectado (factura %)',
                        v_producto_id, v_ref_id;
          continue;
        end if;

        for v_detalle in
          select rd.insumo_id,
                 rd.cantidad,
                 coalesce(i.costo_unitario, 0) as costo_unitario
            from public.recetas_detalle rd
            join public.insumos i on i.id = rd.insumo_id
           where rd.receta_id = v_receta.id
        loop
          v_consumo := (v_detalle.cantidad / greatest(v_receta.rendimiento, 1))
                       * v_cantidad;
          begin
            perform public.registrar_movimiento_inventario(
              'insumo',
              v_detalle.insumo_id,
              v_tipo_mov,
              v_consumo,
              v_detalle.costo_unitario,
              'factura',
              v_ref_id,
              v_nota_prefix || v_nombre,
              new.cajero,
              new.cajero_id::text,
              false
            );
          exception when others then
            raise notice 'inventario_venta: error al mover insumo % (receta %, factura %): %',
                          v_detalle.insumo_id, v_receta.id, v_ref_id, sqlerrm;
          end;
        end loop;

      end if;

    exception when others then
      raise notice 'inventario_venta: error inesperado en factura % para producto %: %',
                    v_ref_id, coalesce(v_producto_id::text,'?'), sqlerrm;
    end;

  end loop;

  return new;
end;
$$;

-- Asegurarse de que el trigger esté activo en ventas
drop trigger if exists trg_ventas_salida_inventario on public.ventas;
create trigger trg_ventas_salida_inventario
  after insert on public.ventas
  for each row execute function public.procesar_salida_inventario_por_venta();

raise notice 'PATCH aplicado: devoluciones ahora registran entrada en inventario.';
