# React Refactor Plan for HumanLayer WUI

## Overview

This document outlines the refactoring roadmap for the HumanLayer WUI (CodeLayer) to align with the React Coding Standards. The plan prioritizes improvements based on architectural impact, developer experience, and maintainability.

## Priority Rankings

- **P0: Critical** - Must be fixed before merging
- **P1: High** - Core architectural improvements
- **P2: Medium** - Developer experience and maintainability
- **P3: Low** - Nice-to-have optimizations

## Current State Assessment

### ✅ What's Working Well

- Zustand store architecture is solid
- Good use of ShadCN components
- TypeScript integration
- Tauri desktop integration
- Real-time updates via daemon client

### 🔴 Priority Issues to Address

## P0: Critical Issues

### 1. **Barrel Export Elimination** - CRITICAL

**Issue**: Heavy use of barrel exports (index.ts files) violates coding standards
**Files Affected**:

- `src/hooks/index.ts` - exports all hooks
- `src/stores/index.ts` - exports stores
- `src/lib/daemon/index.ts` - exports daemon client

**Impact**: Makes code traversal difficult, can cause circular dependencies
**Solution**: Remove barrel exports, update all imports to be direct file imports
**Estimated Effort**: 4-6 hours

### 2. **Component State Migration to Zustand** - HIGH

**Issue**: Too much component-level state that should be in Zustand
**Files Affected**:

- `SessionDetail.tsx` - local modal state, edit states
- `SessionTable.tsx` - selection state, edit modes
- `CommandPaletteMenu.tsx` - menu navigation state
- `ThemeSelector.tsx` - dropdown state

**Impact**: State not accessible across components, harder to test
**Solution**: Move component state to appropriate Zustand slices
**Estimated Effort**: 8-12 hours

## P1: High Priority

### 3. **Component File Structure Reorganization** - HIGH

**Issue**: Components not properly co-located with tests and styles
**Current**: Flat structure in `components/` directory
**Target**: Co-located structure per coding standards

```
components/
  SessionTable/
    SessionTable.tsx
    SessionTable.test.tsx
    SessionTable.stories.tsx
```

**Estimated Effort**: 3-4 hours

### 4. **Custom Hook Consolidation** - HIGH

**Issue**: Too many small custom hooks that could be inline
**Files to Review**:

- `useKeyboardNavigationProtection.ts` - could be inline
- `useStealHotkeyScope.ts` - very specific use case
- `useAsyncState.ts` - generic utility, keep this one

**Solution**: Consolidate or inline hooks that aren't truly reusable
**Estimated Effort**: 2-3 hours

### 5. **Error Boundary Implementation** - HIGH

**Issue**: Missing granular error boundaries around risky operations
**Solution**: Add error boundaries around:

- API-dependent components (SessionDetail, SessionTable)
- Complex data transformations (conversation rendering)
- Third-party integrations (markdown rendering)
  **Estimated Effort**: 4-5 hours

## P2: Medium Priority

### 6. **Form State Migration** - MEDIUM

**Issue**: Forms should use Zustand instead of component state
**Files Affected**:

- `CommandInput.tsx` - session creation form
- `DenyForm.tsx` - approval denial form
- `ResponseInput.tsx` - session response form

**Solution**: Create form slices in Zustand store
**Estimated Effort**: 6-8 hours

### 7. **Testing Coverage Expansion** - MEDIUM

**Issue**: Missing tests for key interaction paths
**Priority Components**:

- `SessionDetail.tsx` - critical user flows
- `SessionTable.tsx` - selection and navigation
- `SessionLauncher.tsx` - session creation
- Store actions and state changes

**Estimated Effort**: 10-12 hours

### 8. **Storybook Story Creation** - MEDIUM

**Issue**: No Storybook stories for key components
**Components Needing Stories**:

- All UI components in `components/ui/`
- Key layouts: SessionTable, SessionDetail
- Complex interactions: CommandPalette, ThemeSelector

**Estimated Effort**: 8-10 hours

## P3: Low Priority

### 9. **Performance Optimizations** - LOW

**Issue**: Potential rerender issues with timestamp updates
**Solution**: Implement data stabilization patterns for frequently changing data
**Files**: Components consuming session data with timestamps
**Estimated Effort**: 2-3 hours

### 10. **Constants Co-location** - LOW

**Issue**: Some constants could be better co-located with features
**Solution**: Move feature-specific constants closer to usage
**Estimated Effort**: 1-2 hours

## Implementation Plan

### Phase 1: Foundation (P0 items)

1. **Eliminate Barrel Exports**

   - Remove `src/hooks/index.ts`
   - Remove `src/stores/index.ts`
   - Update all imports to direct file imports
   - Test thoroughly to ensure no circular dependencies

2. **Component State Migration**
   - Start with SessionTable selection state
   - Move to SessionDetail modal states
   - Update CommandPalette navigation state

### Phase 2: Architecture (P1 items)

1. **Component Reorganization**

   - Create co-located component directories
   - Move test files alongside components
   - Update import paths

2. **Error Boundaries**
   - Add boundaries around SessionDetail
   - Add boundaries around API calls
   - Add boundaries around markdown rendering

### Phase 3: Enhancement (P2-P3 items)

1. **Testing & Documentation**
   - Add comprehensive tests
   - Create Storybook stories
   - Performance optimizations

## Success Metrics

- [ ] All barrel exports removed
- [ ] Component state moved to Zustand where appropriate
- [ ] Components properly co-located with tests
- [ ] Error boundaries around risky operations
- [ ] Test coverage >80% for critical components
- [ ] Storybook stories for all key components

## Progress Update

### ✅ COMPLETED: P0 Item #1 - Barrel Export Elimination (2024-08-27)

**Status**: Successfully completed
**Time Spent**: ~4 hours
**Files Changed**: 15+ files

#### What Was Done:
1. **Eliminated all barrel export files**:
   - ❌ Removed `src/hooks/index.ts`
   - ❌ Removed `src/stores/index.ts`
   - ❌ Removed `src/lib/daemon/index.ts`

2. **Updated all imports to use direct file paths**:
   - Fixed `SessionTablePage.tsx` and `SessionDetail.tsx` hooks imports
   - Updated 13 files importing from daemon barrel export
   - All imports now use pattern: `from '@/hooks/useSpecificHook'` instead of `from '@/hooks'`

3. **Fixed related TypeScript errors**:
   - Built HLD TypeScript SDK to resolve missing module
   - Fixed implicit 'any' parameter types in `formatToolResult.tsx`
   - Fixed type union issues in `http-client.ts`
   - Added proper type assertions in `useSessionFilter.ts`

#### Verification:
- ✅ **Format check passed**
- ✅ **Lint check passed** 
- ✅ **Type checking passed**
- ✅ All barrel export usage eliminated
- ✅ Direct imports following React coding standards

#### Impact:
- Improved code traversal depth (follows standard principle #1)
- Better tree-shaking and build performance
- More explicit dependencies
- Eliminated potential circular dependency issues

## Next Action
**Start with P0 item #2**: Move component state to Zustand store, beginning with SessionTable selection state
