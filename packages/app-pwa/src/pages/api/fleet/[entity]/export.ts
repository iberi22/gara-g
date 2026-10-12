/**
 * /api/fleet/[entity]/export.ts — Endpoint de exportación CSV server-side por entidad.
 *
 * GET /api/fleet/[entity]/export?instanceId=…&format=csv
 * Valida la entidad, aplica RBAC (read) y retorna el CSV con headers RFC4180 y UTF-8 BOM.
 */
import type { APIRoute } from 'astro';
import { listEntities } from '../../../../lib/domain';
import { validateEntity, resolveInstanceId, bad } from '../../../../lib/fleetApi';
import { can } from '../../../../lib/rbac';
import { getAuthUser, unauthorized, forbidden } from '../../fleetApi/auth';
import { toCSV, type CSVColumn } from '../../../../lib/csvExport';

export const prerender = false;

const ENTITY_COLUMNS: Record<string, CSVColumn<any>[]> = {
  vehicle: [
    { key: 'id', label: 'ID' },
    { key: 'plate', label: 'Placa' },
    { key: 'make', label: 'Marca' },
    { key: 'model', label: 'Modelo' },
    { key: 'year', label: 'Año' },
    { key: 'status', label: 'Estado' },
    { key: 'type', label: 'Tipo' },
    { key: 'capacity', label: 'Capacidad' },
    { key: 'mileage', label: 'Kilometraje' },
  ],
  driver: [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Nombre' },
    { key: 'cedula', label: 'Cédula' },
    { key: 'licenseCategory', label: 'Categoría Licencia' },
    { key: 'licenseExpiry', label: 'Vencimiento Licencia' },
    { key: 'phone', label: 'Teléfono' },
    { key: 'status', label: 'Estado' },
  ],
  maintenance: [
    { key: 'id', label: 'ID' },
    { key: 'vehicleId', label: 'ID Vehículo' },
    { key: 'type', label: 'Tipo' },
    { key: 'date', label: 'Fecha' },
    { key: 'km', label: 'Kilometraje' },
    { key: 'cost', label: 'Costo' },
    { key: 'workshop', label: 'Taller' },
    { key: 'status', label: 'Estado' },
  ],
  fuelLog: [
    { key: 'id', label: 'ID' },
    { key: 'vehicleId', label: 'ID Vehículo' },
    { key: 'driverId', label: 'ID Conductor' },
    { key: 'date', label: 'Fecha' },
    { key: 'gallons', label: 'Galones' },
    { key: 'cost', label: 'Costo' },
    { key: 'station', label: 'Estación' },
    { key: 'kmPerGallon', label: 'Km/Galón' },
  ],
  alert: [
    { key: 'id', label: 'ID' },
    { key: 'severity', label: 'Severidad' },
    { key: 'kind', label: 'Tipo' },
    { key: 'message', label: 'Mensaje' },
    { key: 'vehicleId', label: 'ID Vehículo' },
    { key: 'triggeredAt', label: 'Fecha' },
  ],
  document: [
    { key: 'id', label: 'ID' },
    { key: 'vehicleId', label: 'ID Vehículo' },
    { key: 'kind', label: 'Tipo' },
    { key: 'r2Key', label: 'Clave R2' },
    { key: 'expiry', label: 'Vencimiento' },
    { key: 'status', label: 'Estado' },
  ],
};

export const GET: APIRoute = async ({ params, request, locals }) => {
  const entity = params.entity as string;
  if (!validateEntity(entity)) return bad(`Entidad inválida: ${entity}`);

  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (!can(user.role, entity, 'read')) {
    return forbidden(`Rol ${user.role} no tiene permiso para exportar ${entity}`);
  }

  const instanceId = resolveInstanceId(request, (locals as any)?.tenant?.instanceId);
  const rows = await listEntities(entity, instanceId);

  // Seleccionar columnas según entidad o fallback dinámico a las llaves del primer registro
  const columns: CSVColumn<any>[] = ENTITY_COLUMNS[entity] ?? (
    rows.length > 0
      ? Object.keys(rows[0]).map((key) => ({ key, label: key }))
      : [{ key: 'id', label: 'ID' }]
  );

  const csvBody = toCSV(rows, columns, { delimiter: ';', includeBOM: true });
  const filename = `${entity}s_${instanceId}.csv`;

  return new Response(csvBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache',
    },
  });
};
