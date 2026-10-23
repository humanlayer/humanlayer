# Effect Atom

`effect-atom` evolves quickly. Do not invent atom, runtime, result, mutation, query, or React-hook patterns from memory.
Inspect the current project dependency and the matching upstream source/documentation first.

## Required research order

1. Identify the installed package and exact version (`@effect-atom/atom`, `@effect-atom/atom-react`, or related
   packages) in the relevant workspace manifest and lockfile.
2. Inspect its installed declarations and exports under `node_modules/@effect-atom/*`. Type declarations are the
   authority for the code being edited.
3. Inspect current upstream source and examples at <https://github.com/tim-smart/effect-atom> (and version/tag matching
   the installation when available).
4. Check existing local usages for project conventions.
5. Only then write code. Typecheck it against the installed API.

Do not assume a remembered API such as `Atom.runtime`, `runtime.atom`, `runtime.fn`, `Atom.family`, `Result.builder`,
`AtomRpc`, or React hooks still has the same signature. Do not create wrapper abstractions merely to make a guessed API
compile.

## Integration principles

- Keep domain and external I/O in Effect services. Atoms adapt those services to reactive UI state; they should not
  become a second business-logic or persistence layer.
- Build atom runtimes from application layers according to the installed API. Keep production dependency assembly at
  a clear composition root.
- Model queries, mutations, invalidation/reactivity keys, cancellation, and result rendering with the library's current
  primitives rather than hand-rolled promise state.
- Use atom families/current keyed facilities when identity must be stable by input; verify equality and lifetime
  semantics in the installed implementation.
- Respect atom scope and finalization. Effectful atoms may be scoped and rebuilt; verify cleanup/keep-alive behavior
  rather than assuming React mount semantics.
- Preserve typed Effect errors until the UI boundary. Render or match current `Result`/`Cause` values using supported
  helpers; do not branch manually on private tags.
- Mutations should call deep service operations with named input objects. They should not receive raw clients,
  credentials, layers, or database rows.

## React guidance

Use the hooks exported by the installed React package and obey their current setter/result modes. Keep atoms stable
outside render or through the library's current family/factory mechanism. Do not add `useEffect` to mirror atom state
into React state; derive during render or use the atom's reactive facilities. Verify subscription cleanup and suspense
behavior from current docs/types.

## Testing

Test domain services independently using Effect layers. Test atom integration with the library's current test/runtime
facilities, deterministic Effect test services, and explicit result/end-state assertions. Test-only services and
`Layer.mock` remain confined to test code. Avoid module mocks and timing sleeps.

If upstream `main` disagrees with the installed declarations, the installed version wins for implementation. Record a
version upgrade separately rather than silently coding against unreleased APIs.
