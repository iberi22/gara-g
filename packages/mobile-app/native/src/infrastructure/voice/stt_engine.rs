use vosk::{Model, Recognizer};

pub struct SttEngine {
    model: Model,
}

impl SttEngine {
    pub fn new(model_path: &str) -> Result<Self, String> {
        let model = Model::new(model_path).ok_or("Failed to load Vosk model")?;
        Ok(Self { model })
    }

    pub fn create_recognizer(&self, sample_rate: f32) -> Option<Recognizer> {
        Recognizer::new(&self.model, sample_rate)
    }

    pub fn transcribe(&self, audio_data: &[i16], sample_rate: f32) -> Result<String, String> {
        let mut recognizer = self.create_recognizer(sample_rate).ok_or("Failed to create recognizer")?;
        recognizer.accept_waveform(audio_data);
        Ok(recognizer.final_result().single().map(|r| r.text.to_string()).unwrap_or_default())
    }
}
