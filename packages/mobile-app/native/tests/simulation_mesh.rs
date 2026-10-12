use native::protocol::{SafetyPacket, MsgType};
use std::collections::HashMap;

#[test]
fn simulate_mesh_propagation() {
    // Simular 3 nodos: A, B, C
    // A envía mensaje -> B escucha -> B retransmite -> C escucha

    let mut received_log: HashMap<String, Vec<u32>> = HashMap::new();

    // Configurar Nodo A (Emisor)
    let packet_id_1 = 1001;
    let packet_a = SafetyPacket {
        magic: b'G',
        version: 2,
        msg_type: MsgType::Hazard,
        network_id: 0,
        hop_count: 0,
        max_hops: 5,
        temp_id: packet_id_1,
        timestamp: 1600000000,
        lat: 0,
        lon: 0,
        speed_cms: 0,
        heading: 0,
        events: 0,
    };

    // Nodo B recibe de A
    println!("Node B receiving packet {}", packet_a.temp_id);
    received_log.entry("NodeB".to_string()).or_default().push(packet_a.temp_id);

    // Lógica de retransmisión de B (Mock)
    let should_relay = packet_a.msg_type == MsgType::Hazard;
    assert!(should_relay, "Hazard packets should be relayed");

    if should_relay {
        println!("Node B relaying packet {}", packet_a.temp_id);
        // Nodo C recibe de B
        received_log.entry("NodeC".to_string()).or_default().push(packet_a.temp_id);
    }

    // Verificaciones
    assert!(received_log["NodeB"].contains(&1001));
    assert!(received_log["NodeC"].contains(&1001));

    println!("Simulation Success: Message propagated from A -> B -> C");
}
