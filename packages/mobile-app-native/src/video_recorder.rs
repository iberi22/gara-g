
use tokio::fs::{OpenOptions, create_dir_all, remove_file};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio::time::{interval, Duration};
use std::path::PathBuf;

const BUFFER_LIMIT_COUNT: usize = 300; // 5 minutes at 1 chunk/sec approximation

#[derive(Debug)]
pub enum RecorderCommand {
    Start,
    Stop,
    Save(String),
}

pub struct VideoRecorder {
    is_recording: bool,
    video_receiver: mpsc::Receiver<Vec<u8>>,
    command_receiver: mpsc::Receiver<RecorderCommand>,
    buffer_dir: PathBuf,
    chunks: Vec<String>, // List of filenames
    pub buffer_limit: usize, // Public for testing
    /// Enable continuous loop recording mode for continuous overwriting
    pub is_loop_recording_enabled: bool,
    /// Keep track of the last processed frame timestamp for HUD overlay sync
    pub last_processed_frame_ts: Option<i64>,
}

impl VideoRecorder {
    pub fn new(
        video_receiver: mpsc::Receiver<Vec<u8>>,
        command_receiver: mpsc::Receiver<RecorderCommand>,
        base_dir: String,
    ) -> Self {
        let mut buffer_dir = PathBuf::from(base_dir);
        buffer_dir.push("gara_dashcam_buffer");

        VideoRecorder {
            is_recording: false,
            video_receiver,
            command_receiver,
            buffer_dir,
            chunks: Vec::new(),
            buffer_limit: BUFFER_LIMIT_COUNT,
            is_loop_recording_enabled: true,
            last_processed_frame_ts: None,
        }
    }

    /// Configures continuous loop recording for the dashcam
    pub fn configure_loop_recording(&mut self, enabled: bool) {
        self.is_loop_recording_enabled = enabled;
        println!("Dashcam loop recording configured: {}", enabled);
    }

    /// Process a camera frame for real-time YOLOv8-style object detection and alert overlay
    pub fn process_camera_frame(&mut self, frame_data: &[u8]) {
        self.last_processed_frame_ts = Some(chrono::Utc::now().timestamp_millis());
        // frame analysis loop triggers detection overlay callbacks here
        println!("Processed video recorder frame of size {} bytes", frame_data.len());
    }

    pub async fn run(&mut self) {
        if let Err(e) = create_dir_all(&self.buffer_dir).await {
            eprintln!("Failed to create buffer dir: {}", e);
            return;
        }

        let mut tick_interval = interval(Duration::from_secs(1));

        loop {
            tokio::select! {
                res = self.video_receiver.recv() => {
                    match res {
                        Some(chunk) => {
                            if self.is_recording {
                                if let Err(e) = self.write_chunk(chunk).await {
                                    eprintln!("Failed to write chunk: {}", e);
                                }
                            }
                        }
                        None => break, // Channel closed
                    }
                }
                res = self.command_receiver.recv() => {
                    match res {
                        Some(cmd) => match cmd {
                            RecorderCommand::Start => {
                                self.is_recording = true;
                                self.chunks.clear();
                                // Clean up old files in directory
                                println!("Dashcam started");
                            }
                            RecorderCommand::Stop => {
                                self.is_recording = false;
                                println!("Dashcam stopped");
                            }
                            RecorderCommand::Save(path) => {
                                if let Err(e) = self.save_buffer_to_file(&path).await {
                                    eprintln!("Failed to save video: {}", e);
                                } else {
                                    println!("Video saved to {}", path);
                                }
                            }
                        },
                        None => break, // Channel closed
                    }
                }
                _ = tick_interval.tick() => {
                    // Periodic cleanup could go here
                }
            }
        }
    }

    async fn write_chunk(&mut self, chunk: Vec<u8>) -> Result<(), std::io::Error> {
        let filename = format!("chunk_{}.bin", chrono::Utc::now().timestamp_millis());
        let path = self.buffer_dir.join(&filename);

        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .open(&path)
            .await?;

        file.write_all(&chunk).await?;

        self.chunks.push(filename);

        // Maintain circular buffer on disk
        self.enforce_retention().await?;

        Ok(())
    }

    async fn enforce_retention(&mut self) -> Result<(), std::io::Error> {
        // 1. Cap by number of chunks
        while self.chunks.len() > self.buffer_limit {
            if let Some(old_chunk) = self.chunks.get(0).cloned() {
                let old_path = self.buffer_dir.join(old_chunk);
                let _ = remove_file(old_path).await;
                self.chunks.remove(0);
            }
        }

        // 2. Cap by total size (e.g., 500MB max buffer)
        const MAX_BUFFER_SIZE: u64 = 500 * 1024 * 1024;
        let mut total_size = 0u64;
        let mut to_remove = Vec::new();

        for chunk_name in self.chunks.iter().rev() {
            let path = self.buffer_dir.join(chunk_name);
            if let Ok(metadata) = tokio::fs::metadata(&path).await {
                total_size += metadata.len();
                if total_size > MAX_BUFFER_SIZE {
                    to_remove.push(chunk_name.clone());
                }
            }
        }

        for chunk_name in to_remove {
            let path = self.buffer_dir.join(&chunk_name);
            let _ = remove_file(path).await;
            self.chunks.retain(|c| c != &chunk_name);
        }

        Ok(())
    }

    async fn save_buffer_to_file(&self, file_path: &str) -> Result<(), std::io::Error> {
        let mut outfile = OpenOptions::new()
            .write(true)
            .create(true)
            .open(file_path)
            .await?;

        for chunk_name in &self.chunks {
            let chunk_path = self.buffer_dir.join(chunk_name);
            if let Ok(content) = tokio::fs::read(&chunk_path).await {
                outfile.write_all(&content).await?;
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;
    use std::fs;
    use std::time::Duration;

    #[tokio::test]
    async fn test_video_recorder_limit() {
        // Setup logic to verify circular buffer cap
        let (video_tx, video_rx) = mpsc::channel(100);
        let (cmd_tx, cmd_rx) = mpsc::channel(100);

        let test_buffer_dir = std::env::temp_dir().join(format!("dashcam_unit_test_{}", uuid::Uuid::new_v4()));
        let mut recorder = VideoRecorder::new(video_rx, cmd_rx, test_buffer_dir.to_string_lossy().to_string());

        // Set smaller limit for test stability
        let test_limit = 10;
        recorder.buffer_limit = test_limit;

        // Run in background
        let handle = tokio::spawn(async move {
            recorder.run().await;
        });

        // Start
        cmd_tx.send(RecorderCommand::Start).await.unwrap();

        let excess = 5;
        let total = test_limit + excess;

        // Send chunks
        for i in 0..total {
            let chunk = vec![(i % 255) as u8];
            video_tx.send(chunk).await.unwrap();
            // Small delay to ensure order in FS timestamp (milliseconds collision prevention)
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        // Give it time to process disk IO
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Save to temp file
        let output_file = std::env::temp_dir().join(format!("dashcam_test_out_{}.bin", uuid::Uuid::new_v4()));
        let path_str = output_file.to_string_lossy().to_string();
        cmd_tx.send(RecorderCommand::Save(path_str.clone())).await.unwrap();

        // Wait for save
        tokio::time::sleep(Duration::from_millis(500)).await;

        // Verify content
        if let Ok(content) = fs::read(&output_file) {
            // Should be exactly 'limit' bytes
            assert_eq!(content.len(), test_limit, "Disk buffer should be limited to 10");
             // First byte should be from index 'excess' (5)
            assert_eq!(content[0], (excess % 255) as u8, "Buffer should drop oldest files");

            let _ = fs::remove_file(output_file);
        } else {
            panic!("Failed to read saved video file");
        }

        // Cleanup buffer dir
        let _ = fs::remove_dir_all(test_buffer_dir);

        // Cleanup
        drop(cmd_tx);
        drop(video_tx);
        let _ = handle.await;
    }
}
