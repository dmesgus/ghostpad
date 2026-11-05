# Frontend setup

Ghostpad uses TypeScript for gesture/network handling and a React island for the Super fill. React, React DOM, Motion, Tailwind CSS v4, esbuild, and the TypeScript types are installed and locked in `package-lock.json`. No framework migration or shadcn initialization is needed to build this checkout.

## Paths

| Purpose | Path |
| --- | --- |
| Reusable React components | `components/ui/` |
| Supplied button and shared fill animation | `components/ui/origin-button.tsx` |
| Button demo | `components/ui/demo.tsx` |
| `cn` helper | `lib/utils.ts` |
| Editable global styles and Tailwind theme | `web/src/style.css` |
| Pad animation integration | `web/src/super-fill.tsx` |
| Gesture controller | `web/src/app.ts` |
| Generated browser assets | `web/style.css`, `web/super-fill.js`, `web/app.js` |

`@/` resolves to the repository root. The new `components/ui` folder matches the requested imports and the `aliases.ui` setting in `components.json`, so reusable controls have a consistent home. This is a project convention, not a React requirement. `components.json` points the shadcn CLI at the source stylesheet and TypeScript aliases.

## Build and run

```bash
npm ci
npm run build:web
npm test
npm run test:browser
cargo build --release --offline
./target/release/ghostpad --verbose
```

Stop an existing receiver before starting the new one, then refresh the phone page. The receiver embeds all browser assets, so changing frontend files requires rebuilding the Rust binary. No CDN, Node server, or runtime asset downloads are used.

The build type-checks both the gesture code and React components, bundles the React island, and compiles Tailwind into `web/style.css`. Tailwind's theme and utilities are enabled without Preflight, preserving the existing touch layout. The Rust page builder includes the animation bundle with an exact CSP hash.

## Component behavior

The supplied `OriginButton` remains available, including its demo, hover/focus behavior, and `cn` utility. Its circle geometry, 0.5-second duration, and `[0.16, 1, 0.3, 1]` easing are shared through `OriginFill`. Touch pointer-up and cancellation also clear hover to avoid a stuck fill.

The pad mounts only the decorative fill. The existing Super button still owns pointer capture and keyboard input. Accepted pad-Super holds send an animation event carrying the touch origin; keyboard activation uses the center of the Super zone. Hover, right-click, regular gestures, and the keyboard sheet's Super control do not fill the pad. Release, cancellation, disconnect, or panel changes clear it. The overlay ignores pointer events, clips to the rounded pad, and recalculates coverage on resize. Reduced motion uses an instant state change.

## Setup references

The manual setup follows [shadcn's installation guide](https://ui.shadcn.com/docs/installation/manual), the [Tailwind CLI guide](https://tailwindcss.com/docs/installation/tailwind-cli), and [Motion's React installation guide](https://motion.dev/docs/react-installation). For a new standalone React project, initialize shadcn with `npx shadcn@latest init`; this embedded Rust application already has its manual configuration. Future components can be added from the repository root with `npx shadcn@latest add <component>`.
