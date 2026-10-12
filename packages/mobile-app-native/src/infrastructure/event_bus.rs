
use async_trait::async_trait;
use std::any::Any;

#[async_trait]
pub trait EventBus {
    async fn emit(&self, event: &(dyn Any + Send + Sync));
}
