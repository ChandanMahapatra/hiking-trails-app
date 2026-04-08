---
name: arcgis-vite-components
description: Use when creating or fixing Vite apps that combine @arcgis/core with @arcgis/map-components, @arcgis/common-components, and @esri/calcite-components. Covers asset-path bootstrap order, dynamic arcgis-* registration, Vite dev/build asset handling, duplicate Lit/runtime fixes, shared view-host patterns, and static deployment.
---

# ArcGIS Vite Components

You are building or repairing a Vite app that uses the package-based ArcGIS 5.x runtime with Calcite 5.

REQUIRED for every task in this space:

1. Keep `@arcgis/core`, `@arcgis/map-components`, and `@arcgis/common-components` on the same version line, and keep TypeScript at `5.9.x` or newer.
2. Call `setAssetPath()` for Calcite, common-components, and map-components before `defineCustomElements(window)` and before importing or registering any `@arcgis/map-components/components/arcgis-*` modules.
3. Register only the specific `arcgis-*` components the app uses via dynamic `import()`. Do not fall back to CDN bootstrap or blanket eager imports.
4. In `vite.config.*`, serve component assets from `node_modules` during dev, copy them into `dist` during build, and keep `resolve.dedupe` for ArcGIS and Lit packages.
5. When using map components for UI controls, keep controls on official `arcgis-*` elements and bind their `view` property to the active view. Do not reintroduce deprecated `@arcgis/core/widgets/*` controls.
6. If the app mixes web components with Core API logic, host the shared map in `arcgis-map` or `arcgis-scene` and read `viewElement.view` back into app state instead of creating a second standalone view.
7. Only set `esriConfig.apiKey` when a real key is explicitly provided.
8. Before finishing, run `npm run type-check` and `npm run build`. No exceptions for “small changes”, “setup-only work”, or “I verified it manually”.

## Failures This Skill Prevents

Generic ArcGIS/Vite drafts tend to miss the exact problems that break real apps:

- They reuse old CDN or `4.34` examples instead of the package-based `5.x` runtime.
- They import `arcgis-*` components before asset paths are configured.
- They forget the Vite dev/build asset pipeline and ship apps with runtime asset 404s.
- They omit `resolve.dedupe`, which brings back `Multiple versions of Lit loaded`, `Cannot read from private field`, or class-identity failures.
- They create duplicate `MapView` or `SceneView` instances instead of letting `arcgis-map` or `arcgis-scene` own the view.

## Bootstrap Order

Use this pattern in `main.ts` or the first browser entrypoint:

```ts
import { defineCustomElements } from "@esri/calcite-components/loader";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components/dist/components";
import { setAssetPath as setCommonComponentsAssetPath } from "@arcgis/common-components";
import { setAssetPath as setMapComponentsAssetPath } from "@arcgis/map-components";

const configureComponentAssets = () => {
  setCalciteAssetPath(new URL("./calcite/", document.baseURI).toString());
  setCommonComponentsAssetPath(
    new URL("./arcgis/common-components/", document.baseURI).toString()
  );
  setMapComponentsAssetPath(
    new URL("./arcgis/map-components/", document.baseURI).toString()
  );
};

const registerMapComponents = async () => {
  await Promise.all([
    import("@arcgis/map-components/components/arcgis-map"),
    import("@arcgis/map-components/components/arcgis-scene"),
    import("@arcgis/map-components/components/arcgis-home"),
    import("@arcgis/map-components/components/arcgis-zoom"),
    import("@arcgis/map-components/components/arcgis-expand")
  ]);
};

configureComponentAssets();
defineCustomElements(window);
await registerMapComponents();
```

**Bad:** eager-import `@arcgis/map-components/components/arcgis-map` at the top of the module, then call `setAssetPath()` later.

**Good:** configure all asset paths first, then register Calcite, then dynamically import only the `arcgis-*` components you need.

## Vite Rules

Keep the Vite setup explicit:

- Set `"type": "module"` in `package.json`.
- Use a dev plugin that serves Calcite, map-components, and common-components assets directly from `node_modules`.
- Use a build plugin that copies those asset folders into `dist`.
- For static hosting, use `base: command === "serve" ? "/" : "./"` unless the app has a stronger deployment requirement.
- Keep `resolve.dedupe` for `@arcgis/core`, `@arcgis/map-components`, `@arcgis/common-components`, `@esri/calcite-components`, `lit`, `lit-html`, `lit-element`, and `@lit/reactive-element`.
- Keep `optimizeDeps.include` for the component packages when Vite needs help prebundling them.

If these are missing, treat asset 404s and duplicate-runtime errors as setup regressions first.

## Reusable App Patterns

Use these patterns when building data-driven map apps similar to this repo:

1. Prefer a shared `WebMap` and switch between `arcgis-scene` and `arcgis-map` hosts instead of creating unrelated map/view pairs.
2. Keep selection state outside the view so 2D/3D switches can reapply the current context.
3. Bind `arcgis-home`, `arcgis-zoom`, `arcgis-compass`, `arcgis-navigation-toggle`, `arcgis-expand`, `arcgis-basemap-gallery`, and `arcgis-legend` through each element's `view` property.
4. Show a loading state while data and layers initialize; retry briefly when web map or layer readiness lags.
5. Infer layers and key fields heuristically when the app depends on a web map with variable schemas; degrade gracefully when a preferred layer is absent.
6. For `arcgis-elevation-profile`, pass a real `Graphic` with a valid polyline geometry. Do not pass raw domain objects.
7. For selected-only map presentation, prefer source-layer filters plus dedicated graphics overlays rather than permanently mutating baseline renderers.

## Red Flags

If you catch yourself thinking any of these, stop and follow the required checklist:

- “The old CDN example is close enough.”
- “The components will find their own assets.”
- “`resolve.dedupe` is optional.”
- “I can just use `@arcgis/core/widgets/*` for the controls.”
- “A plain object is fine for `ElevationProfile.input`.”

## Completion Checklist

Before marking the task complete, you MUST:

1. Confirm the app uses package imports for ArcGIS and Calcite, not CDN bootstrap.
2. Confirm asset-path setup happens before component registration.
3. Confirm the Vite config serves assets in dev and copies them in build.
4. Confirm `resolve.dedupe` covers ArcGIS and Lit packages.
5. Confirm official `arcgis-*` controls are bound to the active view when map components are part of the UI.
6. Confirm any API key usage is conditional.
7. Run `npm run type-check`.
8. Run `npm run build`.

Do not skip any step. A skipped step is an incomplete task.