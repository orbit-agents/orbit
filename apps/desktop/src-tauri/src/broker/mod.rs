//! Inter-agent message broker.
//!
//! Every message between agents flows through this module. The broker is the
//! single point of transparency, auditability, rate-limiting, and replay for
//! agent-to-agent traffic. No code elsewhere in Orbit should route messages
//! between agents directly.
//!
//! Phase 4 implements this.
