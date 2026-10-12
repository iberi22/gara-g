export const formatDate = (date) => {
	return new Intl.DateTimeFormat("es-ES", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(date);
};
export const formatCurrency = (amount) => {
	return new Intl.NumberFormat("es-ES", {
		style: "currency",
		currency: "EUR",
	}).format(amount);
};
export const calculateTotalCost = (history) => {
	return history.reduce((total, item) => {
		return total + (item.cost || 0);
	}, 0);
};
export const getVehicleAge = (year) => {
	const currentYear = new Date().getFullYear();
	return currentYear - year;
};
export const generateQRCodeData = (vehicleId) => {
	// En un entorno real, esto generaría un código QR
	// Por ahora, devolvemos una URL que podría usarse para generar el QR
	return `https://gara-g.app/vehicle/${vehicleId}`;
};
