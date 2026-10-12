use native::depin::predictive::{DataValuationPredictor, PriceRecord};

#[test]
fn test_price_prediction_moving_average() {
    let mut predictor = DataValuationPredictor::new(3);
    let hex_id = 12345;

    predictor.record_price(PriceRecord { hex_id, timestamp: 100, price: 10, volume: 100 });
    predictor.record_price(PriceRecord { hex_id, timestamp: 200, price: 20, volume: 100 });
    predictor.record_price(PriceRecord { hex_id, timestamp: 300, price: 30, volume: 100 });

    // (10*100 + 20*100 + 30*100) / 300 = 6000 / 300 = 20
    assert_eq!(predictor.predict_price(hex_id), Some(20));

    predictor.record_price(PriceRecord { hex_id, timestamp: 400, price: 40, volume: 100 });
    // Window size is 3, so: (20*100 + 30*100 + 40*100) / 300 = 9000 / 300 = 30
    assert_eq!(predictor.predict_price(hex_id), Some(30));
}

#[test]
fn test_volume_weighted_price() {
    let mut predictor = DataValuationPredictor::new(2);
    let hex_id = 12345;

    predictor.record_price(PriceRecord { hex_id, timestamp: 100, price: 10, volume: 10 });
    predictor.record_price(PriceRecord { hex_id, timestamp: 200, price: 100, volume: 90 });

    // (10*10 + 100*90) / 100 = (100 + 9000) / 100 = 9100 / 100 = 91
    assert_eq!(predictor.predict_price(hex_id), Some(91));
}

#[test]
fn test_demand_score() {
    let mut predictor = DataValuationPredictor::new(5);
    let hex_id = 12345;

    for i in 1..=5 {
        predictor.record_price(PriceRecord { hex_id, timestamp: i * 100, price: 10, volume: 100 });
    }

    // Avg volume = 100, current volume = 100
    // Score = (100 / 100 * 50) = 50
    assert_eq!(predictor.demand_score(hex_id), 50);

    predictor.record_price(PriceRecord { hex_id, timestamp: 600, price: 10, volume: 200 });
    // Window: [100, 100, 100, 100, 200], Avg = 120, current = 200
    // Score = (200 / 120 * 50) = 1.66 * 50 = 83.33 -> 83
    assert_eq!(predictor.demand_score(hex_id), 83);

    predictor.record_price(PriceRecord { hex_id, timestamp: 700, price: 10, volume: 1000 });
    // Current volume very high compared to average
    assert_eq!(predictor.demand_score(hex_id), 100);
}

#[test]
fn test_volatility() {
    let mut predictor = DataValuationPredictor::new(3);
    let hex_id = 12345;

    predictor.record_price(PriceRecord { hex_id, timestamp: 100, price: 10, volume: 100 });
    predictor.record_price(PriceRecord { hex_id, timestamp: 200, price: 10, volume: 100 });
    predictor.record_price(PriceRecord { hex_id, timestamp: 300, price: 10, volume: 100 });

    assert_eq!(predictor.volatility(hex_id), 0.0);

    predictor.record_price(PriceRecord { hex_id, timestamp: 400, price: 20, volume: 100 });
    // Prices in window: [10, 10, 20]
    // Mean = 40/3 = 13.33
    // Variance = ((10-13.33)^2 + (10-13.33)^2 + (20-13.33)^2) / 3
    // Variance = (11.11 + 11.11 + 44.44) / 3 = 66.66 / 3 = 22.22
    // Volatility = sqrt(22.22) approx 4.71
    let v = predictor.volatility(hex_id);
    assert!(v > 4.7 && v < 4.72);
}
