# Contributing to GARA-G (Southwest AI Labs - SWAL Network)

Thank you for your interest in contributing to GARA-G! We welcome contributions from the global community to help build the future of decentralized physical mobility infrastructure across the Southwest AI Labs (SWAL) ecosystem.

---

## 🏛️ Architecture & Network Mission

GARA-G is an open-source, peer-to-peer (P2P) **Decentralized Physical Infrastructure Network (DePIN)** operating within the **SWAL Network**.

- **Decentralized Execution:** Operates without central backend servers, databases, or API control points. Nodes interact autonomously via cryptography and mesh transport layers.

---

## 🌐 Collaboration Framework (Maloca & GitCore)

All development across SWAL repositories follows a unified collaboration workflow:

### 1. Global Backlog & Tracking (Maloca)
- Issue discovery, global roadmap tracking, and cross-repo coordination are managed through SWAL's global collaboration hub (**Maloca**).
- Check active issues in the repository [Issue Tracker](https://github.com/iberi22/gara-g/issues) before initiating work.

### 2. Issue → PR → Merge Pipeline (GitCore Protocol)
To ensure safety, quality, and traceability, every contribution follows the standard GitCore workflow:
1. **Issue:** Find or create an issue describing the feature or bugfix.
2. **Fork & Branch:** Create a feature or fix branch from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/your-feature-name
   ```
3. **Commit Standards:** Use [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(scope): add new V2V message handler
   fix(copilot): prevent buffer overflow on loop recording
   ```
4. **Testing & Verification:** Run required unit and integration tests prior to submitting.
5. **Pull Request (PR):** Open a PR targeting `main`. Ensure all CI checks and GitCore protocol checks pass.
6. **Code Review & Merge:** Maintainers will review the PR, request any adjustments, and merge once approved.

---

## 📝 Contributor License Agreement (CLA)

All contributors must sign the [Contributor License Agreement (CLA)](CLA.md). By submitting a Pull Request to this repository, you confirm agreement to the terms specified in `CLA.md`.

---

## 🛠️ Code & Technical Standards

- **Formatting:** Use Biome for TypeScript/JSON (`npx @biomejs/biome check . --write`).
- **Rust:** Adhere to standard Rust idioms and format code using `cargo fmt`.
- **Flutter / Dart:** Follow official Flutter style guidelines and conventions.
- **Documentation:** Keep documentation synchronized with codebase changes (update `README.md`, `SRC.md`, and relevant specifications).

---

## 🤝 Code of Conduct & Security

- **Code of Conduct:** Refer to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.
- **Security Vulnerabilities:** Follow the security disclosure procedures in [SECURITY.md](SECURITY.md).

---
*Built with passion by Southwest AI Labs (SWAL) and our global open-source contributors.*
