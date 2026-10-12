use rustpotter::{Rustpotter, RustpotterConfig, RustpotterDetection};

pub struct WakeWordDetector {
    rustpotter: Rustpotter,
}

impl WakeWordDetector {
    pub fn new(sample_rate: usize) -> Self {
        let mut config = RustpotterConfig::default();
        config.fmt.sample_rate = sample_rate;
        let rustpotter = Rustpotter::new(&config).unwrap();

        // In a real app, we would load a trained model here
        // For now, this is a placeholder for the "Hey Gara" detector

        Self { rustpotter }
    }

    pub fn process(&mut self, audio_data: &[f32]) -> Option<RustpotterDetection> {
        self.rustpotter.process_samples(audio_data.to_vec())
    }

    pub fn add_wakeword(&mut self, key: &str, model_path: &str) -> Result<(), String> {
        self.rustpotter.add_wakeword_from_file(key, model_path).map_err(|e| e.to_string())
    }
}
