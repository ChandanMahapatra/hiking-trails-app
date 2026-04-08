# Copilot Instructions

## Product intent
- The app context is U.S. National Parks hiking trails, not the legacy Swiss National Park demo.
- Keep documentation and UI copy aligned with the current product framing: **US Hiking Trails Explorer** with a U.S.-wide parks-and-trails experience.
- Keep the app minimal: top header with app name and controls, plus one left side panel.
- Side panel title must remain **Parks and Trails**.
- Use two searchable Calcite dropdowns in this order: park first, trail second.
- After selections, show trail details and elevation profile below the dropdowns.

## Mapping requirements
- Primary map source is Web Map item `5a94b21ff6e94d10ae61483c392bbf9b`.
- Use the current package-based ArcGIS Maps SDK runtime pinned in `package.json` (`@arcgis/core` / `@arcgis/map-components` 5.x); do not reintroduce the old CDN-based `4.34` bootstrap.
- Keep the top-right map controls on official ArcGIS map components:
	- `arcgis-home`
	- `arcgis-zoom`
	- `arcgis-compass`
	- `arcgis-navigation-toggle`
	- `arcgis-expand`
	- `arcgis-basemap-gallery`
	- `arcgis-legend`
	- Do not reintroduce deprecated `@arcgis/core/widgets/*` controls for this UI.
- Keep basemap switching on official ArcGIS map components and JS API behavior (not custom thumbnails or bespoke basemap pickers).
- Keep the legend on official ArcGIS map components as a top-right `arcgis-expand` that hosts `arcgis-legend`; do not replace it with a custom legend UI.
- Keep 3D as default, with optional 2D route/view switch while preserving user context when practical.

## Data model expectations
- Infer park and trail layers from the web map at runtime.
- Do not hardcode a dependency on the exact `Administrative Boundaries of National Park System Units` layer title.
	- The current NPS boundary layer is preferred because it exposes fields such as `UNIT_CODE` and `UNIT_TYPE`, but the app should continue working with another compatible polygon parks layer when present.
- Infer id/name fields heuristically from layer fields; avoid hard-coding field names.
- If join fields are missing, fall back to spatial association between trail and park.
- Gracefully degrade when park/trail layers are unavailable.
- Keep documentation and code comments accurate to the current implementation:
	- Do not reintroduce legacy README claims about Swiss National Park data, Flickr images, or amCharts elevation profiles.
	- Elevation profiles are rendered through the `arcgis-elevation-profile` map component backed by ArcGIS ElevationProfile behavior.
- Keep trail loading resilient:
	- Do not require `SceneElement.ready` to resolve before building the UI.
	- Retry trail initialization briefly when map/layer readiness lags.
	- If `state.parksLayer` / `state.trailsLayer` are missing, infer them again from `state.view.map.allLayers` in `trailManager` before returning empty data.
	- `trailManager.initTrails()` currently awaits `assignParksToTrails()` before re-publishing `state.trails`; do not regress to a background-only park-assignment path that allows the UI and SceneView filters to race ahead of trail association.
	- ArcGIS 5 removed the old `geometryEngineAsync` module path used in earlier revisions of this repo.
		- Keep the spatial park/trail fallback on geometry operators such as `intersectsOperator.execute()` rather than restoring the removed import.
- Authentication safety:
	- Never hardcode expired ArcGIS tokens or force an API key.
	- Only set `esriConfig.apiKey` when a valid key is explicitly provided.

## UI/UX constraints
- Do not reintroduce tabbed panels, complex filters, or extra pages.
- Do not add custom themes/colors beyond existing design tokens and config colors.
- Keep the current app-shell branding intact:
	- Header app mark uses the Calcite `tour-pin-tear` icon.
	- Browser/app icons come from the public favicon/app-icon assets, not ad hoc `src/...` references.
- Prefer Calcite components already loaded in `index.html`.
- Keep sidebar feedback clear while data is loading:
	- Show an in-panel Calcite loading component while park/trail data is still initializing.
	- While loading, show the loader instead of the comboboxes.
	- Hide the loader when the comboboxes are ready, and use a concise empty-state message if no park/trail data was inferred.
- Combobox behavior must stay deterministic:
	- For Calcite v5, do not depend on `calcite-combobox-item.textLabel`.
	- Populate dynamic `calcite-combobox-item` entries with supported visible label fields such as `heading`, `label`, `value`, and slotted text content so names are visible in both the list and selected state.
	- Keep park combobox enabled when parks exist.
		- Filter the inferred park set to actual National Parks when designation metadata such as `UNIT_TYPE` is available.
	- Keep trail combobox disabled until a park is selected, then populate only trails associated to that park.
	- Trail option labels must never be blank:
		- Trim candidate trail names from inferred fields.
		- If blank/whitespace, fall back to a non-empty label (for example `Trail <id>`).
	- Do not deduplicate trail records in state solely because names repeat.
		- Duplicate trail names in the combobox may reflect valid source-layer segments or records.
		- When duplicate names exist within the selected park, keep one option per record and disambiguate only the displayed label with a deterministic suffix such as `(1 of N)`.
	- Preserve reactive sync between state and combobox selection (selected IDs ↔ selected items).
		- Trail detail text must not render literal `null`/`Unknown` placeholders; prefer concise fallbacks and keep the ElevationProfile visible when geometry is available.

## Session summary
- Auth must stay conditional so expired ArcGIS credentials do not block the web map.
- UI construction must not wait on `SceneElement.ready`; retry trail initialization briefly when the map is slow.
- Layer inference and blank-label fallback must remain resilient because layer fields vary across web maps.
- The current NPS boundary layer exposes `UNIT_TYPE`; when available, use it to keep the park list scoped to National Parks only.
	- Treat that layer as the preferred park source, not as a hardcoded requirement by exact title.
- ArcGIS component bootstrap is order-sensitive in the current package setup:
	- Configure local asset paths for `@esri/calcite-components`, `@arcgis/common-components`, and `@arcgis/map-components` before importing or registering `arcgis-*` web components.
	- Keep the current Vite asset pipeline intact: serve component assets directly from installed packages during development, and copy them into `dist` during production builds and CI so `map-components` and `common-components` assets remain available without committing generated runtime trees.
	- Keep `index.html` head assets GitHub Pages-safe:
		- Metadata and icon paths used by the app shell must resolve from Vite-emitted assets or the `public/` directory in the built site.
		- Do not point app-shell icons or `msapplication-TileImage` at `src/...` paths that will not exist in `dist`.
	- Do not revert `main.ts` back to eager side-effect imports of `@arcgis/map-components/components/*` before asset-path setup.
	- Keep the current component-host architecture:
		- `SceneElement` mounts a real `arcgis-scene` or `arcgis-map` component around the shared `WebMap`.
		- Read the active host component's `view` back into shared state so existing selection, highlighting, and layer logic can continue using the raw View API.
		- Bind the `arcgis-*` controls to the active view through each element's `view` property.
		- Do not regress back to raw standalone `MapView` / `SceneView` construction or deprecated `@arcgis/core/widgets/*` controls for this UI.
	- Keep the current top-right expand behavior:
		- `arcgis-expand` controls for basemaps and legend should initialize collapsed.
		- The legend stays in its own top-right `arcgis-expand` and uses `arcgis-legend` bound to the active view.
- Vite dev/runtime stability now depends on explicit dedupe:
	- Keep `vite.config.js` `resolve.dedupe` covering ArcGIS packages plus `lit`, `lit-html`, `lit-element`, and `@lit/reactive-element`.
	- Treat reappearance of `Multiple versions of Lit loaded`, `Cannot read from private field`, or `Portal/Basemap is not a subclass of itself` as duplicate-runtime/bootstrap regressions first.
- Selection state must stay string-safe, synchronize between comboboxes and map clicks, and preserve context across 3D/2D switches.
- Repeated trail names are currently treated as source-data truth, not as UI duplication.
	- The combobox rebuilds from scratch on park changes.
	- Duplicate display names should be clarified in the UI, not removed from state.
- Selected-park source trails must remain visible in both 2D and 3D.
	- In SceneView, park-only trail browsing now needs terrain-hugging elevation handling during active selection so filtered trails stay draped on the ground instead of floating above terrain.
	- Park-only selection should preserve the original National Park Service Trails symbology on the filtered source layer rather than recoloring that layer just because a park is active.
- Recent implementation direction from the latest commits and follow-up fixes must stay intact:
	- Keep the overlapping-park suppression path, trail-length fallback behavior, and 3D selected-trail wall highlight/detail layout work.
	- Keep the current 3D selection/UI fixes and do not regress back to source-layer-only park-selected trail rendering in SceneView.
	- Treat reports where 2D works but 3D fails as SceneView rendering or camera issues first, not as trail-association failures by default.
	- Keep the current view-mode-aware home behavior:
		- Initial view mount and `arcgis-home` should both use `config.view.startupViewpoints[viewMode]`.
		- In 3D, the home control should return to a continental-US camera instead of a generic shared startup point.
	- Keep the basemap gallery on an explicit view-mode-aware `source`.
		- In `SceneView`, include scene-appropriate basemaps such as `topo-3d`, `navigation-3d`, and imagery options instead of relying on the default gallery source.
		- In `MapView`, keep the gallery limited to 2D-safe basemaps such as `topo-vector`, `streets-navigation-vector`, and imagery options.
	- Keep the basemap expand trigger visually consistent with the rest of the top-right controls.
		- The collapsed `arcgis-expand` trigger for the basemap gallery should remain `32px x 32px`.
		- Size the expanded gallery panel separately with panel-width styling such as `--arcgis-internal-panel-width`; do not stretch `#basemapExpandControl` itself to the gallery width.

## Current implementation context
- Selected-only map presentation currently depends on source-layer filtering plus a separate `highlightLayer` in `SceneElement`:
	- Keep the selected park source renderer visually suppressed so the highlight graphic is the only visible park selection treatment.
	- Do not regress to opacity-only hiding for selected parks; that allowed polygon fill to leak through at close zoom levels in 3D.
	- Keep the selected park source symbol as outline-free `style: "none"` so terrain, contours, and basemap detail remain visible inside the selected park.
	- When a park is selected, temporarily suppress overlapping polygon layers from the WebMap and restore their original visibility or definition state when selection is cleared.
	- Reapply selection filters and highlight graphics after 3D/2D view recreation.
	- Reapply selection zoom after 3D/2D view recreation so the active park or trail context is preserved visually, not just in state.
- Selected-park source-trail presentation now has a view-specific requirement:
	- When a park or trail is actively selected, force the inferred trails layer visible instead of restoring an originally hidden WebMap visibility state.
	- In `SceneView`, when only a park is selected, temporarily set the source trails layer elevation to `on-the-ground` so park-selected trail lines hug the terrain instead of floating above it.
	- When only a park is selected, keep the filtered source trails layer on its original renderer instead of recoloring it just for park browsing.
	- In `SceneView`, park-selected trails no longer rely on the filtered source layer alone:
		- `SceneElement` now uses a dedicated `parkTrailHighlightLayer` `GraphicsLayer` overlay for park-only browsing.
		- Keep park-selected overlay graphics built from render-safe polylines that strip source Z values before drawing.
		- When possible, keep the park-selected overlay visually aligned with the original trail symbology by cloning the original simple-line trail symbol rather than forcing a different park-browsing color.
		- If the original trail renderer cannot be reused directly, limit fallback styling changes to readability adjustments such as width, not a wholesale color swap by default.
		- Keep the filtered source trails layer visible but partially faded during park-only selection in 3D; do not make it the only visible treatment again.
		- Prefer park-selected trail readability through renderer width, opacity, and overlay/source contrast rather than reintroducing a large 3D lift offset by default.
	- Restore the original trails-layer elevation info when selection clears or when the active view is 2D.
	- Park-selection navigation in `SceneView` now has a trail-aware fallback order:
		- Prefer the combined extent center of associated trail geometries with a capped 3D scale.
		- Fall back to the associated trail geometries or the park polygon only when needed.
- Selected trail emphasis currently differs by view type:
	- In `SceneView`, the selected trail uses a volumetric `line-3d` path symbol with a `quad` profile for a wall-like 3D highlight.
	- In `MapView`, the selected trail falls back to a simple flat line highlight.
	- In `SceneView`, selected-trail highlight graphics should use render-safe geometry rather than the raw source polyline when source Z values may be unreliable.
	- Preserve the current distinction between geometry sanitation and wall sizing:
		- First prevent spike artifacts by stripping problematic Z values for the highlight graphic.
		- Then keep wall height bounded through `config.selection` rather than compensating with exaggerated geometry.
- Trail detail layout currently groups selected-trail information into separate fact and attribute sections:
	- Keep compact fact badges for values such as length, ascent or gain, difficulty, duration, and status when available.
	- Keep the primary fact badges text-only; do not reintroduce decorative icons inside `detailFacts`.
	- Keep stacked attribute rows for values such as surface, use, type, and class below the primary facts.
	- The secondary attribute section should stay visually lightweight; do not reintroduce a tinted background block behind it.
- Elevation profile creation currently depends on guarded component setup in `DetailPanel`:
	- Build the profile input from a valid `Graphic`, not from the raw trail model.
	- Validate that selected trail geometry is a polyline with at least one path and at least two vertices before creating the profile.
	- Keep profile visualization enabled; setting `hideVisualization = true` removes the chart-hover scrub marker or orb from the trail path.
	- If profile creation fails or the view is still switching/loading, show a concise in-panel fallback instead of leaving the panel blank.
- Baseline NPS polygon styling and park labeling currently depend on `SceneElement` baseline configuration rather than temporary selection overrides:
	- Keep `Nps tracts` on the configured unique-value palette in live service order; when available, use `layer.types` as the authoritative category order to avoid duplicate legend entries.
	- Keep `USA National Park Service Lands` on its dedicated baseline fill color from config.
	- Do not hide `Nps boundary centroids` with a transparent renderer; keep centroid features visible so park labels still have a visible point source.
	- Park-name labels are view-mode-aware:
		- In `MapView`, the centroid layer uses a readable 2D text label.
		- In `SceneView`, the centroid layer uses a `LabelSymbol3D` with vertical offset and callout so park names remain legible above terrain.
		- Reapply the configured centroid labeling on 2D/3D switches because the shared layer persists across view recreation.
- Layer inference must continue preferring park/trail layers that expose join and designation fields used by the current NPS web map:
	- Prefer park layers with `UNIT_CODE` and `UNIT_TYPE` when scoring polygon candidates.
	- Prefer trail layers with `UNITCODE` when scoring polyline candidates.
	- If the preferred NPS boundary layer is unavailable, continue inferring another compatible polygon parks layer instead of treating park loading as tied to one exact layer name.
- SceneView labeling has a current limitation that must stay reflected in the implementation:
	- Do not remap non-point `labelPlacement` values in SceneView to other guessed placements.
	- For non-point layers, remove unsupported `labelPlacement` overrides instead of forcing values such as `above-center` or `center-center`.
	- Treat runtime warnings like `the requested label placement 'above-center' is currently unsupported for 'polygon' geometries in SceneView` as label-sanitization regressions to fix, not as expected noise.
- Current build-health expectation:
	- `npm run type-check` should pass.
	- `npm run build` should pass.
	- Vite chunk-size warnings from ArcGIS-heavy bundles are currently acceptable as optimization follow-up work; do not treat them as build failures unless the task is specifically bundle reduction.

## Selection-to-map sync
- Park/trail selection from combobox or map click must update map visibility consistently:
	- Selected park: filter park layer to selected object id and render outline-only highlight.
	- Selected trail: filter trail layer to selected object id and render selected trail highlight.
	- When both a park and a trail are active, selected-trail filtering must take precedence over the broader park-selected source-trail filter.
	- Non-selected park/trail features should be hidden while selected feature highlights remain visible.
	- Other polygon layers that overlap the selected park should be temporarily hidden during active park selection so the selected park interior never regains a solid fill in 3D.
	- When a trail is selected, reduce the park outline emphasis so the trail highlight remains visually dominant.
	- In `SceneView`, park-only selection should show both:
		- a filtered, partially faded source trails layer for data continuity, and
		- the dedicated park-trail overlay for visual discoverability.
	- Clearing selection must restore layer filters/opacity defaults.
	- The selected park source polygon must not show a solid fill when zoomed in.

## Engineering guidelines
- Keep changes focused and minimal.
- Preserve existing TypeScript style and ArcGIS Accessor state pattern.
- Keep the compiler/runtime compatibility floor aligned with the current ArcGIS stack:
	- ArcGIS 5.x in this repo currently type-checks cleanly with TypeScript 5.9.x.
	- Do not downgrade TypeScript without revalidating ArcGIS declaration compatibility.
- Keep setup and validation instructions aligned with the current README flow:
	- Start the app with `npm run start`.
	- Validate with `npm run type-check` and `npm run build` before handoff.
- Runtime validation expectations after ArcGIS bootstrap work:
	- A clean local startup should not show `Multiple versions of Lit loaded`, `Cannot read from private field`, ArcGIS `Accessor#set` type-mismatch warnings for `Portal`/`Basemap`, or `js.arcgis.com/.../map-components/...` asset 404s.
	- A clean local startup should not show deprecated-control regressions such as the app falling back to legacy `@arcgis/core/widgets/*` top-right controls.
	- A clean local startup should not show the unsupported SceneView polygon label-placement warning described above.
	- Treat browser WebGL warnings, devtools source-map noise, and intermittent remote ArcGIS service CORS/tile failures as secondary unless they remain reproducible after the runtime bootstrap is clean.

## Manual QA checklist

Run these checks after any change to data loading, combobox logic, or selection behavior:

1. Start the app with `npm run start` and open the local URL.
2. Confirm the sidebar shows a loading indicator while park and trail names are initializing.
3. Confirm the loader appears instead of the two comboboxes while data is loading, then disappears once the park list is ready.
4. Confirm the **National Park** combobox is enabled and populated with visible names for National Parks only.
5. Confirm non-park NPS units such as national monuments or historic sites do not appear in the park list.
6. Confirm the **Trail** combobox is disabled before a park is selected.
7. Select a park and confirm:
	- Trail combobox becomes enabled.
	- Trail list contains only trails associated with the selected park.
	- Trail names are visible in the list and selected state.
8. Select a trail and confirm:
	- Trail details and elevation profile render in the panel.
	- Hovering the elevation profile chart shows the trail scrub marker or orb again.
	- When rich trail attributes are unavailable, the panel shows a concise fallback message instead of `null` text.
	- Map shows selected-only behavior:
		- Park layer filtered to selected park object ID.
		- Trail layer filtered to selected trail object ID.
		- Non-selected features are hidden while highlight graphics remain visible.
		- The selected park outline becomes faint when a trail is selected so the trail highlight is visually dominant.
9. Clear selection and confirm layer filters/opacity reset to defaults.
10. In 3D, explicitly test problem parks such as Acadia, Badlands, Biscayne, and Denali and confirm park-selected trails are visible, stay draped on terrain, do not appear to float before selecting an individual trail, and keep the original National Park Service Trails symbology on the filtered source layer.
11. In 3D, select problematic Denali trails such as Eielson Visitor Center Campus Trails and Mountain Vista Area Trails and confirm the selected-trail highlight no longer shows isolated spike or unrealistic height artifacts at individual vertices.
12. Switch between 3D and 2D and confirm selected park/trail context is preserved when possible.
13. Confirm map reset behavior in both views:
	- In 2D, the home control returns to the continental U.S. map framing.
	- In 3D, the home control returns to the configured continental-U.S. camera instead of a generic global or off-center startup view.
14. Open the basemap gallery and legend in both 3D and 2D and confirm:
	- The collapsed basemap trigger matches the other top-right map controls at `32px x 32px`.
	- The legend stays in its own top-right expand control and does not open by default.
	- The expanded gallery panel is wide enough to avoid the previously squashed layout.
	- In 3D, the gallery includes scene-oriented basemap choices instead of only 2D-style defaults.
15. In 3D, confirm National Park names remain readable over the map surface and do not disappear after switching between 2D and 3D.
16. Validate build health:
	- `npm run type-check`
	- `npm run build`
