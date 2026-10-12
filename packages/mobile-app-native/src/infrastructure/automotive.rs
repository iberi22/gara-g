//! OBD-II Protocol Parser for Gara-G Sentinel
//! Decodes standard SAE J1979 PIDs.

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObdPid {
    // Existing
    EngineLoad = 0x04,
    CoolantTemp = 0x05,
    EngineRpm = 0x0C,
    VehicleSpeed = 0x0D,
    IntakeTemp = 0x0F,
    MafFlow = 0x10,
    ThrottlePos = 0x11,
    FuelLevel = 0x2F,
    // NEW PIDs to add:
    MonitorStatus = 0x01,       // DTC count and MIL status
    FuelSystemStatus = 0x03,
    DistanceWithMil = 0x21,     // Distance traveled with MIL on
    DistanceSinceClear = 0x31,  // Distance since codes cleared (ODOMETER PROXY)
    AmbientTemp = 0x46,
    OilTemp = 0x5C,
    FuelRate = 0x5E,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ObdValue {
    Percentage(f32),
    Temperature(i32),
    Rpm(f32),
    SpeedKm(u8),
    FlowRate(f32),
    DistanceKm(u16),      // NEW: for odometer-related PIDs
    FuelRateLph(f32),     // NEW: liters per hour
    MonitorStatus {       // NEW: for PID 0x01
        mil_on: bool,
        dtc_count: u8,
    },
    None,
}

/// Parses standard OBD-II PID response (Mode 01)
pub fn parse_pid(pid_byte: u8, data: &[u8]) -> Result<ObdValue, String> {

    match pid_byte {
        0x01 => { // Monitor Status: A is MIL and DTC count
            if data.is_empty() { return Err("Insufficient data".to_string()); }
            let mil_on = (data[0] & 0x80) != 0;
            let dtc_count = data[0] & 0x7F;
            Ok(ObdValue::MonitorStatus { mil_on, dtc_count })
        },
        0x04 => { // Engine Load: A * 100 / 255
             if data.is_empty() { return Err("Insufficient data".to_string()); }
             let val = data[0] as f32 * 100.0 / 255.0;
             Ok(ObdValue::Percentage(val))
        },
        0x05 => { // Coolant Temp: A - 40
             if data.is_empty() { return Err("Insufficient data".to_string()); }
             Ok(ObdValue::Temperature(data[0] as i32 - 40))
        },
        0x0C => { // RPM: (A*256 + B) / 4
            if data.len() < 2 { return Err("Insufficient data".to_string()); }
            let val = ((data[0] as u16 * 256) + data[1] as u16) as f32 / 4.0;
            Ok(ObdValue::Rpm(val))
        },
        0x0D => { // Speed: A
             if data.is_empty() { return Err("Insufficient data".to_string()); }
             Ok(ObdValue::SpeedKm(data[0]))
        },
        0x0F => { // Intake Temp: A - 40
             if data.is_empty() { return Err("Insufficient data".to_string()); }
             Ok(ObdValue::Temperature(data[0] as i32 - 40))
        },
        0x21 => { // Distance with MIL on: (A*256)+B km
            if data.len() < 2 { return Err("Insufficient data".to_string()); }
            let km = (data[0] as u16 * 256) + data[1] as u16;
            Ok(ObdValue::DistanceKm(km))
        },
        0x2F => { // Fuel Level: A * 100 / 255
             if data.is_empty() { return Err("Insufficient data".to_string()); }
             let val = data[0] as f32 * 100.0 / 255.0;
             Ok(ObdValue::Percentage(val))
        },
        0x31 => { // Distance since codes cleared: (A*256)+B km
            if data.len() < 2 { return Err("Insufficient data".to_string()); }
            let km = (data[0] as u16 * 256) + data[1] as u16;
            Ok(ObdValue::DistanceKm(km))
        },
        0x46 => { // Ambient air temp: A - 40
            if data.is_empty() { return Err("Insufficient data".to_string()); }
            Ok(ObdValue::Temperature(data[0] as i32 - 40))
        },
        0x5C => { // Oil temp: A - 40
            if data.is_empty() { return Err("Insufficient data".to_string()); }
            Ok(ObdValue::Temperature(data[0] as i32 - 40))
        },
        0x5E => { // Fuel rate: ((A*256)+B) / 20 L/h
            if data.len() < 2 { return Err("Insufficient data".to_string()); }
            let rate = ((data[0] as u16 * 256) + data[1] as u16) as f32 / 20.0;
            Ok(ObdValue::FuelRateLph(rate))
        },
        _ => Ok(ObdValue::None)
    }
}

/// Vehicle Identification Number (17 characters)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VehicleVin {
    pub raw: String,
    pub wmi: String,           // World Manufacturer ID (chars 1-3)
    pub vds: String,           // Vehicle Descriptor (chars 4-9)
    pub vis: String,           // Vehicle Identifier (chars 10-17)
    pub year: Option<u16>,     // Decoded year
    pub manufacturer: Option<String>,
}

impl VehicleVin {
    pub fn parse(data: &[u8]) -> Result<Self, String> {
        // Mode 09 PID 02 returns VIN as ASCII
        // First byte is usually message count, skip it
        let start = if data.len() > 17 { 1 } else { 0 };
        let vin_bytes = &data[start..];

        if vin_bytes.len() < 17 {
            return Err(format!("VIN too short: {} bytes", vin_bytes.len()));
        }

        let raw = String::from_utf8_lossy(&vin_bytes[..17]).to_string();

        Ok(Self {
            wmi: raw[0..3].to_string(),
            vds: raw[3..9].to_string(),
            vis: raw[9..17].to_string(),
            year: Self::decode_year(raw.chars().nth(9)),
            manufacturer: Self::decode_wmi(&raw[0..3]),
            raw,
        })
    }

    fn decode_year(char: Option<char>) -> Option<u16> {
        match char? {
            'A' => Some(2010), 'B' => Some(2011), 'C' => Some(2012),
            'D' => Some(2013), 'E' => Some(2014), 'F' => Some(2015),
            'G' => Some(2016), 'H' => Some(2017), 'J' => Some(2018),
            'K' => Some(2019), 'L' => Some(2020), 'M' => Some(2021),
            'N' => Some(2022), 'P' => Some(2023), 'R' => Some(2024),
            'S' => Some(2025), 'T' => Some(2026), 'V' => Some(2027),
            _ => None,
        }
    }

    fn decode_wmi(wmi: &str) -> Option<String> {
        match wmi {
            s if s.starts_with("1G") => Some("General Motors USA".into()),
            s if s.starts_with("1F") => Some("Ford USA".into()),
            s if s.starts_with("1H") => Some("Honda USA".into()),
            s if s.starts_with("2T") => Some("Toyota Canada".into()),
            s if s.starts_with("3V") => Some("Volkswagen Mexico".into()),
            s if s.starts_with("JT") => Some("Toyota Japan".into()),
            s if s.starts_with("WV") => Some("Volkswagen Germany".into()),
            s if s.starts_with("WA") => Some("Audi Germany".into()),
            s if s.starts_with("WB") => Some("BMW Germany".into()),
            _ => None,
        }
    }
}

/// Parse VIN from Mode 09 response
pub fn parse_vin(data: &[u8]) -> Result<VehicleVin, String> {
    VehicleVin::parse(data)
}

/// Diagnostic Trouble Code
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagnosticCode {
    pub code: String,          // e.g., "P0301"
    pub category: DtcCategory,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DtcCategory {
    Powertrain,  // P
    Chassis,     // C
    Body,        // B
    Network,     // U
}

/// Parse DTCs from Mode 03 response
pub fn parse_dtcs(data: &[u8]) -> Vec<DiagnosticCode> {
    let mut codes = Vec::new();

    // Each DTC is 2 bytes
    for chunk in data.chunks(2) {
        if chunk.len() < 2 || (chunk[0] == 0 && chunk[1] == 0) {
            continue;
        }

        let first_char = match (chunk[0] >> 6) & 0x03 {
            0 => 'P',
            1 => 'C',
            2 => 'B',
            3 => 'U',
            _ => 'P',
        };

        let second_digit = (chunk[0] >> 4) & 0x03;
        let third_digit = chunk[0] & 0x0F;
        let fourth_digit = (chunk[1] >> 4) & 0x0F;
        let fifth_digit = chunk[1] & 0x0F;

        let code = format!("{}{}{:X}{:X}{:X}",
            first_char, second_digit, third_digit, fourth_digit, fifth_digit);

        let category = match first_char {
            'P' => DtcCategory::Powertrain,
            'C' => DtcCategory::Chassis,
            'B' => DtcCategory::Body,
            'U' => DtcCategory::Network,
            _ => DtcCategory::Powertrain,
        };

        codes.push(DiagnosticCode {
            code,
            category,
            description: None, // Could add lookup table
        });
    }

    codes
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rpm() {
        // 0x0C => RPM. Data: 0x0B, 0xE0 => (2816 + 224) / 4 = 3040 / 4 = 760
        let data = vec![0x0B, 0xE0];
        let res = parse_pid(0x0C, &data).unwrap();
        assert_eq!(res, ObdValue::Rpm(760.0));
    }

    #[test]
    fn test_parse_speed() {
        // 0x0D => Speed. Data: 0x32 => 50 km/h
        let data = vec![0x32];
        let res = parse_pid(0x0D, &data).unwrap();
        assert_eq!(res, ObdValue::SpeedKm(50));
    }

    #[test]
    fn test_parse_monitor_status_mil_on() {
        let data = vec![0x83]; // MIL on, 3 DTCs
        let res = parse_pid(0x01, &data).unwrap();
        assert_eq!(res, ObdValue::MonitorStatus { mil_on: true, dtc_count: 3 });
    }

    #[test]
    fn test_parse_monitor_status_mil_off() {
        let data = vec![0x02]; // MIL off, 2 DTCs
        let res = parse_pid(0x01, &data).unwrap();
        assert_eq!(res, ObdValue::MonitorStatus { mil_on: false, dtc_count: 2 });
    }

    #[test]
    fn test_parse_distance_since_clear() {
        let data = vec![0x27, 0x10]; // 10000 km
        let res = parse_pid(0x31, &data).unwrap();
        assert_eq!(res, ObdValue::DistanceKm(10000));
    }

    #[test]
    fn test_parse_vin() {
        // Example VIN: JT2BG22K0T0000001 (Toyota)
        let data = b"JT2BG22K0T0000001";
        let vin = parse_vin(data).unwrap();
        assert_eq!(vin.raw, "JT2BG22K0T0000001");
        assert_eq!(vin.wmi, "JT2");
        assert_eq!(vin.manufacturer, Some("Toyota Japan".to_string()));
    }

    #[test]
    fn test_parse_dtcs() {
        // P0301 = 0x03, 0x01
        let data = vec![0x03, 0x01, 0x01, 0x07, 0x00, 0x00];
        let codes = parse_dtcs(&data);
        assert_eq!(codes.len(), 2);
        assert_eq!(codes[0].code, "P0301");
        assert_eq!(codes[1].code, "P0107");
    }

    #[test]
    fn test_parse_fuel_rate() {
        let data = vec![0x00, 0xC8]; // 200/20 = 10 L/h
        let res = parse_pid(0x5E, &data).unwrap();
        assert_eq!(res, ObdValue::FuelRateLph(10.0));
    }
}
