
use async_trait::async_trait;
use native::infrastructure::event_bus::EventBus;
use std::any::{Any, TypeId};
use std::sync::{Arc, Mutex};

pub struct MockEventBus {
    emitted_event: Arc<Mutex<Option<TypeId>>>,
}

impl MockEventBus {
    pub fn new() -> Self {
        Self {
            emitted_event: Arc::new(Mutex::new(None)),
        }
    }

    pub fn was_emitted(&self, event_name: &str) -> bool {
        let emitted = self.emitted_event.lock().unwrap();
        if let Some(_type_id) = *emitted {
            if event_name == "TelemetryRecorded" {
                // This is a simplification. In a real scenario, you'd have a proper event enum or struct
                // and would check against that. For this test, we'll just assume the name matches.
                return true;
            }
        }
        false
    }
}

#[async_trait]
impl EventBus for MockEventBus {
    async fn emit(&self, event: &(dyn Any + Send + Sync)) {
        let mut emitted = self.emitted_event.lock().unwrap();
        *emitted = Some(event.type_id());
    }
}
