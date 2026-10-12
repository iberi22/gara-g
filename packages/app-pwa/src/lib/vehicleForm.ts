/**
 * vehicleForm.ts — Campos del formulario de vehiculo (crear y editar), en un solo sitio.
 *
 * Antes cada pagina tenia su copia y las dos ofrecian tipos que no existen en el catalogo
 * ('camioneta', 'auto', 'bus') y un estado 'inactive' que la API rechaza con 400. Ahora los
 * tipos salen de VEHICLE_TYPE_LABELS (lib/vehicleCatalog.ts) y los estados de
 * VEHICLE_STATUSES (lib/vehicle.ts).
 *
 * Placa y VIN no van como `required` en el HTML: la maquinaria amarilla no tiene placa de
 * carro ni VIN de 17 caracteres. La API los sigue exigiendo para los vehiculos de via
 * (validateVehicleFields) y responde con el motivo exacto.
 */
import { VEHICLE_TYPE_LABELS } from './vehicleCatalog';

export interface SelectOption {
  value: string;
  label: string;
}

const STATUS_LABELS: SelectOption[] = [
  { value: 'active', label: 'Activo' },
  { value: 'maintenance', label: 'En mantenimiento' },
  { value: 'decommissioned', label: 'Dado de baja' },
];

export const VEHICLE_TYPE_OPTIONS: SelectOption[] = VEHICLE_TYPE_LABELS.map((t) => ({
  value: t.value,
  label: t.group === 'Livianos' ? t.label : `${t.label} · ${t.group.toLowerCase()}`,
}));

/** Mismo contrato que `Field` de components/EntityForm.astro. */
export interface FormField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'textarea' | 'date' | 'checkbox' | 'tel';
  required?: boolean;
  options?: SelectOption[];
  placeholder?: string;
  step?: string;
  help?: string;
}

export function vehicleFormFields(fleetOptions: SelectOption[]): FormField[] {
  return [
    { name: 'type', label: 'Tipo', type: 'select', required: true, options: VEHICLE_TYPE_OPTIONS },
    { name: 'plate', label: 'Placa (opcional en maquinaria)', type: 'text', placeholder: 'ABCD-12, ABC123 o MC1234', help: 'Obligatoria en carros, motos y camiones.' },
    { name: 'vin', label: 'VIN (17) o serie de la máquina', type: 'text', placeholder: '1HGCM82633A004352 o CAT0320GKZ1234' },
    { name: 'make', label: 'Marca', type: 'text', required: true, placeholder: 'Toyota, Kenworth, Caterpillar' },
    { name: 'model', label: 'Modelo', type: 'text', required: true, placeholder: 'Hilux, T800 Volqueta, 320' },
    { name: 'year', label: 'Año', type: 'number', required: true, step: '1' },
    { name: 'status', label: 'Estado', type: 'select', required: true, options: STATUS_LABELS },
    { name: 'capacity', label: 'Capacidad', type: 'text', placeholder: '5 Pax / 18 Ton / 1,2 m³' },
    { name: 'mileage', label: 'Kilometraje (km)', type: 'number', step: '1' },
    { name: 'hours', label: 'Horómetro (horas, maquinaria)', type: 'number', step: '1', help: 'La maquinaria se mantiene por horas de motor, no por km.' },
    { name: 'fleetId', label: 'Flota', type: 'select', required: true, options: fleetOptions },
  ];
}
