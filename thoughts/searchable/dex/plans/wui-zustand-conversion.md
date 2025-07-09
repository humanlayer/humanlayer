# Implementation Plan: WUI Zustand Conversion and Demo Mode

**Date**: 2025-07-02
**Author**: Gemini
**Status**: Proposed (Revised)

## 1. Goal

This document outlines the implementation plan to refactor the WUI to use a centralized Zustand store, **adapting the existing proof-of-concept (`StoreDemo.tsx`)** for application-wide state management. The primary objectives are:

1.  **Decouple Components**: Remove all direct daemon communication from React components.
2.  **Centralize State**: Manage the entire application state within a single, well-structured Zustand store, replacing the legacy `AppStore.ts` and hooks.
3.  **Enable Demo Mode**: Allow the UI to be driven by a mock store, enabling animated, state-driven marketing demos without a live daemon.
4.  **Improve Architecture**: Increase testability and maintainability by rolling out the modern state management patterns from the PoC to the entire application.

This plan has been revised to account for recent backend changes (`getSessionLeaves`, local-only approvals) and the existing Zustand PoC.

## 2. Architecture and Key Patterns

We will follow the patterns established in the `StoreDemo.tsx` proof-of-concept and the `slices.md` document.

### Zustand Slices Pattern

The store will be divided into logical domains:

-   **`sessionSlice`**: Manages the session list (using the new `getSessionLeaves` daemon endpoint), the active session, and the user-interrupt flow.
-   **`approvalsSlice`**: Manages pending approvals based on the new **local-only** approval system.
-   **`uiSlice`**: Manages global UI state (loading, errors, etc.).

These will be combined into a single `useBoundStore` hook.

### Provider and Hook Abstraction

As demonstrated in the PoC, a single `StoreProvider` will instantiate either the **real store** (connected to the daemon) or a **mock store** (for demos) and provide it to the component tree.

## 3. Phased Implementation Plan

### Phase 1: Productionize the Store Architecture (3 days)

**Goal**: Adapt the PoC's patterns to create a production-ready, slice-based Zustand store that reflects the current state of the backend.

**Tasks**:

1.  **Define Store Slices**:
    *   `sessionSlice.ts`: State and actions for sessions. The fetch action **must** call the `daemonClient.getSessionLeaves()` method.
    *   `approvalsSlice.ts`: State and actions for approvals, reflecting the simplified local-only flow.
    *   `uiSlice.ts`: For global UI state.
2.  **Create Bound Store**:
    *   `useBoundStore.ts`: Combine the slices into a single store, as per the `slices.md` pattern.
3.  **Implement `StoreProvider`**:
    *   Create a production `StoreProvider.tsx` that can switch between the real and a demo store based on a prop or URL query.
4.  **Wrap Application**:
    *   In `main.tsx`, wrap the `App` component with the `StoreProvider`.

**Success Criteria**:
-   [ ] The new store slices are defined and correctly reflect the current daemon API (local approvals, `getSessionLeaves`).
-   [ ] `useBoundStore.ts` successfully combines the slices.
-   [ ] The `StoreProvider` wraps the `App` and the application runs without errors. Functionality is unchanged as components are not yet connected.

---

### Phase 2: Component Integration and Refactoring (5 days)

**Goal**: Connect all components to the new store and remove all legacy state management.

**Tasks**:

1.  **Refactor `SessionTable`**:
    *   Replace its connection to `AppStore.ts`/`useSessions` with the `useBoundStore` hook.
2.  **Refactor `ApprovalsPanel`**:
    *   Connect the component to the `approvalsSlice` in the `useBoundStore`.
3.  **Refactor `SessionDetail` (High Priority)**:
    *   This is the most complex task. The component must be refactored to source all its data (active session, conversation) and actions from `useBoundStore`.
    *   **Crucially, the existing keyboard shortcut logic (`A`/`D` for approvals) and the message interrupt flow must be preserved.** This logic will need to be moved from the component's local state/effects into the Zustand store's actions and state.

**Success Criteria**:
-   [ ] All direct daemon calls and all usage of `AppStore.ts` are removed from components.
-   [ ] All components are driven by the `useBoundStore` hook.
-   [ ] The `A`/`D` keyboard shortcuts and the message interrupt functionality work correctly, driven by the central store.
-   [ ] The application is fully functional and behaves identically to the pre-refactor version.

---

### Phase 3: Re-implement Demo Mode (3 days)

**Goal**: Apply the PoC's demo mode pattern to the new, productionized store architecture.

**Tasks**:

1.  **Create `createDemoStore` Factory**:
    *   Implement a `createDemoStore` function that generates a store with the same shape as the real one but with mock data and no-op actions.
    *   The actions in the demo store will advance through a predefined sequence of states to simulate a real user session.
2.  **Define Demo Sequences**:
    *   Create JSON files in `humanlayer-wui/src/stores/demo-sequences/` to define realistic scenarios (e.g., `approval-flow.json`, `session-interrupt.json`).
3.  **Integrate with `StoreProvider`**:
    *   The `StoreProvider` will use this `createDemoStore` factory when in demo mode (e.g., `?demo=true`).

**Success Criteria**:
-   [ ] The `createDemoStore` function can generate a fully functional, non-daemon-connected store that mimics the real store's structure.
-   [ ] The demo store can play back a sequence of states from a JSON file, accurately simulating a user workflow in the UI.

---

### Phase 4: Cleanup and Final Testing (1 day)

**Goal**: Remove obsolete code and ensure the new architecture is robust.

**Tasks**:

1.  **Remove Legacy Code**:
    *   Delete the original `StoreDemo.tsx` PoC file.
    *   Delete the old state management files (`AppStore.ts`, `hooks/useSessions.ts`, etc.).
2.  **End-to-End Testing**:
    *   Manually test the entire application in "real" mode to confirm no regressions.
    *   Test all defined demo sequences in "demo" mode.

**Success Criteria**:
-   [ ] The codebase is clean of old state management patterns.
-   [ ] The application is fully tested and stable in both real and demo modes.
