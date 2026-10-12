//! Integration and Unit Tests for the Copilot Dashcam AI System.

use native::copilot::dashcam::{
    Yolov8Detector, Yolov8Detection, LoopRecord, LoopRecordConfig,
    EventRecorder, NightModeConfig, NightModeProcessor,
    OverlayMetadata, OverlaySystem,
};

#[test]
fn test_yolov8_detector_basic() {
    let detector = Yolov8Detector::new(0.3, 0.45);

    // An empty frame should return no detections
    let empty_detections = detector.detect_objects(&[], 640, 480);
    assert!(empty_detections.is_empty());

    // Create a mock blue-tinted frame (RGB format: each pixel 3 bytes)
    // 640x480 frame = 921,600 bytes
    let width = 640;
    let height = 480;
    let mut blue_frame = vec![0u8; width * height * 3];
    for chunk in blue_frame.chunks_exact_mut(3) {
        chunk[2] = 200; // Boost blue channel
    }

    let detections = detector.detect_objects(&blue_frame, width, height);

    // There should be detections including "car" due to blue-tinted frame logic
    assert!(!detections.is_empty());
    assert!(detections.iter().any(|d| d.class_name == "car"));
}

#[test]
fn test_yolov8_nms_suppression() {
    let detector = Yolov8Detector::new(0.2, 0.4);

    // Two highly overlapping "car" detections
    let d1 = Yolov8Detection {
        class_name: "car".to_string(),
        confidence: 0.9,
        x: 100.0,
        y: 100.0,
        width: 50.0,
        height: 50.0,
    };
    let d2 = Yolov8Detection {
        class_name: "car".to_string(),
        confidence: 0.8,
        x: 110.0,
        y: 110.0,
        width: 50.0,
        height: 50.0,
    };
    let d3 = Yolov8Detection {
        class_name: "car".to_string(),
        confidence: 0.75,
        x: 300.0,
        y: 300.0,
        width: 20.0,
        height: 20.0,
    };

    let input_detections = vec![d1.clone(), d2, d3.clone()];
    let filtered = detector.apply_nms(input_detections);

    // After NMS:
    // - d2 (highly overlapping with d1) should be suppressed
    // - d3 (far away, no overlap) should be kept
    // Total remaining should be 2
    assert_eq!(filtered.len(), 2);
    assert_eq!(filtered[0], d1);
    assert_eq!(filtered[1], d3);
}

#[test]
fn test_loop_recording_limits() {
    let config = LoopRecordConfig {
        max_chunks_limit: 3,
        max_bytes_limit: 1000,
        chunk_duration_ms: 1000,
    };

    let mut recorder = LoopRecord::new(config);
    assert!(recorder.is_looping_active);
    assert_eq!(recorder.chunks.len(), 0);

    // 1. Add chunks within limit
    let evicted_1 = recorder.add_chunk(vec![1, 2, 3, 4]);
    assert_eq!(evicted_1, 0);
    assert_eq!(recorder.chunks.len(), 1);

    let evicted_2 = recorder.add_chunk(vec![5, 6, 7, 8]);
    assert_eq!(evicted_2, 0);
    assert_eq!(recorder.chunks.len(), 2);

    let evicted_3 = recorder.add_chunk(vec![9, 10, 11, 12]);
    assert_eq!(evicted_3, 0);
    assert_eq!(recorder.chunks.len(), 3);
    assert_eq!(recorder.total_bytes, 12);

    // 2. Add 4th chunk (exceeding chunk count limit of 3)
    // Oldest chunk (vec![1, 2, 3, 4]) should be evicted
    let evicted_4 = recorder.add_chunk(vec![13, 14, 15, 16]);
    assert_eq!(evicted_4, 1);
    assert_eq!(recorder.chunks.len(), 3);
    assert_eq!(recorder.chunks[0], vec![5, 6, 7, 8]); // Second chunk is now first
    assert_eq!(recorder.chunks[2], vec![13, 14, 15, 16]); // Newest chunk at end

    // 3. Export concatenated video buffer
    let full_video = recorder.export_full_recording();
    assert_eq!(full_video, vec![5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

    // 4. Test byte size limits
    let byte_limited_config = LoopRecordConfig {
        max_chunks_limit: 10,
        max_bytes_limit: 10, // Max 10 bytes total
        chunk_duration_ms: 1000,
    };
    let mut byte_recorder = LoopRecord::new(byte_limited_config);
    byte_recorder.add_chunk(vec![1, 2, 3, 4]); // 4 bytes
    byte_recorder.add_chunk(vec![5, 6, 7, 8]); // +4 = 8 bytes
    let evicted_byte = byte_recorder.add_chunk(vec![9, 10, 11, 12]); // +4 = 12 bytes -> triggers eviction of first chunk
    assert_eq!(evicted_byte, 1);
    assert_eq!(byte_recorder.chunks.len(), 2);
    assert_eq!(byte_recorder.total_bytes, 8); // 8 + 4 - 4 = 8
}

#[test]
fn test_event_based_impact_recording() {
    let mut event_recorder = EventRecorder::new(2.5, 0.05);

    // 1. Below threshold magnitude
    let event_none = event_recorder.detect_impact(1.0, 1.0, 1.0); // Magnitude = sqrt(3) ~ 1.73
    assert!(event_none.is_none());
    assert_eq!(event_recorder.triggered_events.len(), 0);

    // 2. Above threshold magnitude
    let event_impact = event_recorder.detect_impact(2.0, 2.0, 2.0); // Magnitude = sqrt(12) ~ 3.46
    assert!(event_impact.is_some());
    let triggered = event_impact.unwrap();
    assert_eq!(triggered.event_type, "IMPACT");
    assert_eq!(triggered.severity, "WARNING");
    assert!(triggered.description.contains("G-force threshold exceeded"));
    assert_eq!(event_recorder.triggered_events.len(), 1);
}

#[test]
fn test_event_based_motion_recording() {
    let mut event_recorder = EventRecorder::new(2.5, 0.02);

    // First frame initializes the reference signature (no motion detected yet)
    let frame1 = vec![100u8; 100];
    let m1 = event_recorder.detect_motion(&frame1);
    assert!(m1.is_none());

    // Frame 2 is identical -> no motion
    let frame2 = vec![100u8; 100];
    let m2 = event_recorder.detect_motion(&frame2);
    assert!(m2.is_none());

    // Frame 3 has significant changes -> motion triggered
    let mut frame3 = vec![100u8; 100];
    for i in 0..50 {
        frame3[i] = 250; // Change half the pixels
    }
    let m3 = event_recorder.detect_motion(&frame3);
    assert!(m3.is_some());
    let triggered_motion = m3.unwrap();
    assert_eq!(triggered_motion.event_type, "MOTION");
    assert_eq!(triggered_motion.severity, "INFO");
}

#[test]
fn test_night_mode_ir_enhancement() {
    let processor = NightModeProcessor;
    let config_disabled = NightModeConfig {
        is_enabled: false,
        ir_enhancement_level: 0.8,
        contrast_gain: 1.5,
        brightness_offset: 30,
    };

    let original_frame = vec![50, 60, 70, 80, 90, 100];

    // When disabled, output must equal input
    let out_disabled = processor.enhance_frame(&original_frame, &config_disabled);
    assert_eq!(out_disabled, original_frame);

    let config_enabled = NightModeConfig {
        is_enabled: true,
        ir_enhancement_level: 0.6,
        contrast_gain: 1.2,
        brightness_offset: 15,
    };

    let out_enabled = processor.enhance_frame(&original_frame, &config_enabled);
    assert_eq!(out_enabled.len(), original_frame.len());

    // Frame should be altered/enhanced compared to the original
    assert_ne!(out_enabled, original_frame);
}

#[test]
fn test_metadata_hud_overlay_drawing() {
    let metadata = OverlayMetadata {
        watermark: "GARA-G COPILOT AI".to_string(),
        timestamp_str: "2026-06-12T12:00:00Z".to_string(),
        speed_kmh: 85.5,
        latitude: 40.7128,
        longitude: -74.0060,
        is_night_mode_active: false,
        active_alerts: vec![],
    };

    let overlay = OverlaySystem::new(metadata);
    let width = 100;
    let height = 100;
    let mut frame = vec![128u8; width * height * 3]; // Solid gray background

    // No detections
    overlay.apply_hud_overlay(&mut frame, width, height, &[]);

    // Top border rows (first 4 rows) should be colored green as per HUD top line overlay logic
    // Pixel 0, 1, 2, 3 in row 0:
    assert_eq!(frame[1], 255); // Green channel boosted
    assert_eq!(frame[0], 0);   // Red cleared
    assert_eq!(frame[2], 0);   // Blue cleared

    // Let's test with a detection bounding box
    let detections = vec![Yolov8Detection {
        class_name: "car".to_string(),
        confidence: 0.95,
        x: 0.3,
        y: 0.3,
        width: 0.2,
        height: 0.2,
    }];

    overlay.apply_hud_overlay(&mut frame, width, height, &detections);

    // Box coords on 100x100 are:
    // start_x = 30, start_y = 30
    // box_w = 20, box_h = 20
    // end_x = 50, end_y = 50
    // The pixel at (30, 30) should be colored red (Red channel = 255, G = 0, B = 0)
    let idx = (30 * 100 + 30) * 3;
    assert_eq!(frame[idx], 255);
    assert_eq!(frame[idx + 1], 0);
    assert_eq!(frame[idx + 2], 0);
}
