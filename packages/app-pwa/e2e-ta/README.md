# E2E Tester Army Suite

This suite tests the smoke paths of the GARA-G app using the [`tester-army/e2e`](https://github.com/tester-army/e2e) framework.

## Installation

Ensure dependencies are installed by running:

```bash
pnpm --filter gara-g-app-pwa install
```

## Building the App

Before running the suite locally, make sure to build the app:

```bash
pnpm --filter gara-g-app-pwa build
```

## Running the Tests

To run the deterministic local smoke suite:

```bash
cd packages/app-pwa
pnpm run e2e:ta
```

To run the read-only suite against the live production app (`https://gara-g.swal.network`):

```bash
cd packages/app-pwa
pnpm run e2e:ta:live
```

## Results of the Sandbox Run

| Journey | Local | Live |
|---|---|---|
| landing opens with the main heading | Passed | Passed |
| guest mode opens the fleet area without an account | Passed | Passed |
| PWA manifest and service worker are served | Passed | Passed |
| onboarding /fleet/bienvenida advances through its steps | Passed | Passed |
| a guest can create a vehicle and see it listed | Passed | Passed |
| offline: after the first load the app shell still renders with the network blocked | Passed | Passed |

## Persona Charters for Agentic Bug Bash

- **Guest Operator:** A mechanic casually exploring the app to add a vehicle and check features without an account.
- **Admin Setup:** A fleet manager setting up the app for the first time, tweaking settings like drivers and live tracking.
- **Offline User:** A driver at a remote location trying to navigate the app's fleet sections with no cell reception.
- **PWA Installer:** A mobile user checking installability and service worker capabilities for a native-like experience.
- **Curious Visitor:** A prospect reading the landing page's copy, checking the FAQ, and trying the "Empezar gratis" CTA.
