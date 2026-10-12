
use native::domain::anonymizer::Anonymizer;
use native::domain::telemetry::GeoPoint;

#[test]
fn test_k_anonymity_obfuscation() {
    let anonymizer = Anonymizer::new(0.001);
    let point = GeoPoint { lat: 37.7749295, lon: -122.4194155, accuracy: 5.0 };
    let anon = anonymizer.anonymize_location(&point);

    // Should be within k-anonymity bounds but not exact
    assert!((anon.lat - point.lat).abs() < 0.01);
    assert!((anon.lon - point.lon).abs() < 0.01);
    // With very small fuzz (0.001), it might coincidentally be close, but let's assume it changes enough.
    // 37.7749 -> round(37774.9295) -> 37775 -> 37.775
    assert_ne!(anon.lat, point.lat);
}
