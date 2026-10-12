use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoraPacket {
    pub msg_type: u8,
    pub device_id: u32,
    pub latitude: f64,
    pub longitude: f64,
}

impl LoraPacket {
    /// Compress into bytes (Mock compression)
    /// Real impl would use bit packing
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.push(self.msg_type);
        bytes.extend_from_slice(&self.device_id.to_be_bytes());
        bytes.extend_from_slice(&self.latitude.to_be_bytes());
        bytes.extend_from_slice(&self.longitude.to_be_bytes());
        bytes
    }

    /// Decompress from bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < 21 {
            return None;
        }

        let msg_type = data[0];

        let dev_id_bytes: [u8; 4] = data[1..5].try_into().ok()?;
        let device_id = u32::from_be_bytes(dev_id_bytes);

        let lat_bytes: [u8; 8] = data[5..13].try_into().ok()?;
        let latitude = f64::from_be_bytes(lat_bytes);

        let lon_bytes: [u8; 8] = data[13..21].try_into().ok()?;
        let longitude = f64::from_be_bytes(lon_bytes);

        Some(LoraPacket {
            msg_type,
            device_id,
            latitude,
            longitude,
        })
    }
}
