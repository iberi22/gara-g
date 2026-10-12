pub mod marketplace_use_case_tests;
pub mod telemetry_use_case_tests;
pub mod v2v_use_case_tests;
// `access_token_tests.rs` NO va aqui: `src/domain/access_token.rs` lo incluye con
// `#[path = "../../tests/application/access_token_tests.rs"]` porque sus imports son
// `crate::...` (un test unitario de la libreria). Declararlo tambien en este arbol lo
// compilaba como test de integracion, donde `crate` es otro crate y no resuelve: el
// objetivo `tests/mod.rs` no compilaba. Se sigue ejecutando con `cargo test -p gara-g --lib`.
pub mod opt_in_tests;
pub mod copilot_use_case_tests;
