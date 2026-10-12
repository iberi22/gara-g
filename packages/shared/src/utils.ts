import type { VehicleHistory } from "./types";

export const formatDate = (date: Date): string => {
	return new Intl.DateTimeFormat("es-ES", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(date);
};

export const formatCurrency = (amount: number): string => {
	return new Intl.NumberFormat("es-ES", {
		style: "currency",
		currency: "EUR",
	}).format(amount);
};

export const calculateTotalCost = (history: VehicleHistory[]): number => {
	return history.reduce((total, item) => {
		return total + (item.cost || 0);
	}, 0);
};

export const getVehicleAge = (year: number): number => {
	const currentYear = new Date().getFullYear();
	return currentYear - year;
};

export const generateQRCodeData = (vehicleId: string): string => {
	// En un entorno real, esto generaría un código QR
	// Por ahora, devolvemos una URL que podría usarse para generar el QR
	return `https://gara-g.app/vehicle/${vehicleId}`;
};
