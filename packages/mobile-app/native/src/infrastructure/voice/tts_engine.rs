// Stubbed out TtsEngine to avoid espeak-ng build issues
pub struct TtsEngine {}

impl TtsEngine {
    pub fn new() -> Self {
        Self {}
    }

    pub fn load_model(&mut self, _model_path: &str) -> Result<(), String> {
        Ok(())
    }

    pub fn synthesize(&mut self, _text: &str) -> Result<(Vec<f32>, u32), String> {
        Ok((vec![], 16000))
    }
}
