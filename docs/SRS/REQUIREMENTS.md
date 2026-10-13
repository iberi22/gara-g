# Software Requirements Specification (SRS) for GARA-G

## 1. Introduction
This document follows the IEEE 830 style to specify the functional requirements for GARA-G, a local-first fleet management PWA.

## 2. Functional Requirements

### 2.1 Guest Mode
**REQ-001:** The system shall provide a guest mode where users can access the application without an account, with data stored in IndexedDB.
- **Current Behavior:** Validates guest state and handles routing without requiring user authentication.
- **Source:** `packages/app-pwa/src/lib/appMode.ts`

**REQ-002:** The system shall load a demo garage in guest mode that works fully offline without server calls.
- **Current Behavior:** Initializes a 3D demo garage environment for local users.
- **Source:** `packages/app-pwa/src/components/garage/guestGarage.ts`

### 2.2 Fleet Management
**REQ-003:** The system shall allow users to view their fleet as read-only in a specific demo view.
- **Current Behavior:** Renders the demo fleet view specifically configured for Chile.
- **Source:** `packages/app-pwa/src/pages/fleet/garage/flota-demo-chile.astro`

**REQ-004:** The system shall maintain real-time commitments for fleet vehicles.
- **Current Behavior:** Enforces domain logic for vehicle commitments.
- **Source:** `packages/app-pwa/src/garage/domain/commitments.ts`

### 2.3 Maintenance
**REQ-005:** The system shall track the historical maintenance records for vehicles.
- **Current Behavior:** Models and stores historical maintenance records.
- **Source:** `packages/app-pwa/src/garage/domain/history.ts`

**REQ-006:** The system shall allow automated AI-driven analysis of maintenance manuals. [PLANNED]

### 2.4 Motorcycle Health
**REQ-007:** The system shall load a specific set of templates for motorcycle diagnostics and visualization.
- **Current Behavior:** Defines a 3D template configuration for a naked-style motorcycle.
- **Source:** `packages/app-pwa/src/garage/templates/moto/naked.ts`

**REQ-008:** The system shall track and visualize the health of motorcycle parts.
- **Current Behavior:** Validates parts health thresholds and triggers status changes.
- **Source:** `packages/app-pwa/src/garage/domain/partsHealth.ts`

### 2.5 Chile Localization
**REQ-009:** The system shall support localization customized for Chile, including currency (CLP), units (liters), and specific regional documentation definitions (SOAP, RUT).
- **Current Behavior:** Overrides default locale settings specifically for the Chilean market.
- **Source:** `packages/app-pwa/src/lib/market.ts`

**REQ-010:** The system shall format currency automatically to CLP when the Chile localization is active. [PLANNED]

### 2.6 Offline Usage
**REQ-011:** The system shall provide core functionality locally on the user's device without a continuous internet connection.
- **Current Behavior:** Identifies if a path is allowed to be accessed entirely offline in guest mode.
- **Source:** `packages/app-pwa/src/lib/appMode.ts`

**REQ-012:** The system shall cache UI assets for instant loading regardless of network status. [PLANNED]

### 2.7 Sync and Backup
**REQ-013:** The system shall synchronize local modifications to cloud storage using end-to-end encryption.
- **Current Behavior:** Encrypts outgoing backups via AES-256-GCM before transmission.
- **Source:** `packages/app-pwa/src/lib/e2ee/crypto.ts`

**REQ-014:** The system shall handle synchronization lifecycle and conflict resolution using Yjs.
- **Current Behavior:** Implements the synchronization client that pushes local changes to the remote instance.
- **Source:** `packages/app-pwa/src/lib/e2ee/syncClient.ts`
