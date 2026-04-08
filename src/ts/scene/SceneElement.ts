/* Copyright 2019 Esri
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import WebMap from "@arcgis/core/WebMap";
import Basemap from "@arcgis/core/Basemap";
import Graphic from "@arcgis/core/Graphic";
import Polyline from "@arcgis/core/geometry/Polyline";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SunLighting from "@arcgis/core/webscene/SunLighting";
import Viewpoint from "@arcgis/core/Viewpoint";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import config from "../config";
import { getTrailParkField, inferLayersFromMap } from "../data/trailManager";
import { ArcGISView, State, Trail } from "../types";

const ACTIVE_VIEW_ELEMENT_ID = "activeArcgisView";

type RemovableHandle = { remove: () => void };
type ArcGISViewElement = HTMLElement & {
  autoDestroyDisabled?: boolean;
  constraints?: any;
  destroy?: () => Promise<void>;
  environment?: any;
  map?: WebMap | null;
  popupDisabled?: boolean;
  view?: ArcGISView | null;
  viewpoint?: __esri.Viewpoint | null;
  viewOnReady?: () => Promise<void>;
};
type ViewBoundControl = HTMLElement & {
  view?: ArcGISView | null;
  hidden?: boolean;
};
type BasemapGalleryControl = ViewBoundControl & {
  source?: Basemap[] | null;
};
type HomeControl = ViewBoundControl & {
  viewpoint?: __esri.Viewpoint | null;
};
type ExpandControl = ViewBoundControl & {
  expanded?: boolean;
};
type ControlRegistry = {
  container: HTMLElement | null;
  home: HomeControl | null;
  zoom: ViewBoundControl | null;
  compass: ViewBoundControl | null;
  navigationToggle: ViewBoundControl | null;
  basemapGallery: BasemapGalleryControl | null;
  basemapExpand: ExpandControl | null;
  legend: ViewBoundControl | null;
  legendExpand: ExpandControl | null;
  all: ViewBoundControl[];
};

export default class SceneElement {
  state: State;
  view: ArcGISView | null;
  map: WebMap;
  trailsLayer: FeatureLayer | null;
  parksLayer: FeatureLayer | null;
  parkTrailHighlightLayer: GraphicsLayer;
  highlightLayer: GraphicsLayer;
  ready: Promise<void>;
  private isSwitchingView: boolean;
  private originalTrailsRenderer: __esri.Renderer | null;
  private originalTrailsElevationInfo: __esri.ElevationInfo | null;
  private originalParksRenderer: __esri.Renderer | null;
  private otherPolygonLayers: FeatureLayer[];
  private originalDefinitionExpressions: Map<FeatureLayer, string | null>;
  private originalVisibility: Map<FeatureLayer, boolean>;
  private controls: ControlRegistry;
  private viewElement: ArcGISViewElement | null;
  private viewHost: HTMLElement | null;
  private watchHandles: RemovableHandle[];
  private viewHandles: RemovableHandle[];
  private destroyed: boolean;

  constructor(state: State) {
    this.state = state;
    this.view = null;
    this.trailsLayer = null;
    this.parksLayer = null;
    this.isSwitchingView = false;
    this.originalTrailsRenderer = null;
    this.originalTrailsElevationInfo = null;
    this.originalParksRenderer = null;
    this.otherPolygonLayers = [];
    this.originalDefinitionExpressions = new Map();
    this.originalVisibility = new Map();
    this.controls = this.resolveControls();
    this.viewElement = null;
    this.viewHost = document.getElementById("scenePanel");
    this.watchHandles = [];
    this.viewHandles = [];
    this.destroyed = false;
    this.map = new WebMap({
      portalItem: {
        id: config.scene.webmapItemId,
      },
    });
    this.parkTrailHighlightLayer = new GraphicsLayer({
      title: "Selected park trails",
      listMode: "hide",
    });
    this.highlightLayer = new GraphicsLayer({
      title: "Selection highlight",
      listMode: "hide",
    });
    this.map.addMany([this.parkTrailHighlightLayer, this.highlightLayer]);

    this.ready = this.init();

    this.addWatch(reactiveUtils.watch(() => state.device, () => {
      this.setViewPadding();
    }));

    this.addWatch(reactiveUtils.watch(() => state.selectedParkId, () => {
      this.applySelectionFilters();
      this.renderHighlights();
      this.zoomToSelection();
    }));

    this.addWatch(reactiveUtils.watch(() => state.selectedTrailId, () => {
      this.applySelectionFilters();
      this.renderHighlights();
      this.zoomToSelection();
    }));

    this.addWatch(reactiveUtils.watch(() => state.viewMode, async (viewMode, oldMode) => {
      if (viewMode !== oldMode) {
        await this.switchView(viewMode);
      }
    }));
  }

  private addWatch(handle: RemovableHandle) {
    this.watchHandles.push(handle);
  }

  private addViewHandle(handle: RemovableHandle) {
    this.viewHandles.push(handle);
  }

  private resolveControls(): ControlRegistry {
    const home = document.getElementById("homeControl") as HomeControl | null;
    const zoom = document.getElementById("zoomControl") as ViewBoundControl | null;
    const compass = document.getElementById("compassControl") as ViewBoundControl | null;
    const navigationToggle = document.getElementById(
      "navigationToggleControl"
    ) as ViewBoundControl | null;
    const basemapGallery = document.getElementById(
      "basemapGalleryControl"
    ) as BasemapGalleryControl | null;
    const basemapExpand = document.getElementById(
      "basemapExpandControl"
    ) as ExpandControl | null;
    const legend = document.getElementById("legendControl") as ViewBoundControl | null;
    const legendExpand = document.getElementById(
      "legendExpandControl"
    ) as ExpandControl | null;
    const all = [
      home,
      zoom,
      compass,
      navigationToggle,
      basemapGallery,
      basemapExpand,
      legend,
      legendExpand,
    ]
      .filter(Boolean) as ViewBoundControl[];

    if (home) {
      home.viewpoint = this.getConfiguredViewpoint();
    }

    return {
      container: document.getElementById("mapControls"),
      home,
      zoom,
      compass,
      navigationToggle,
      basemapGallery,
      basemapExpand,
      legend,
      legendExpand,
      all,
    };
  }

  private async init() {
    if (this.destroyed) {
      return;
    }

    try {
      await this.map.loadAll();
    } catch (error) {
      console.warn("WebMap load failed, continuing with degraded behavior.", error);
    }

    if (this.destroyed) {
      return;
    }

    this.ensureGroundElevation();

    this.sanitizeSceneViewLabelPlacement();

    this.resolveLayers();
    this.captureLayerDefaults();
    this.state.trailsLayer = this.trailsLayer;
    this.state.parksLayer = this.parksLayer;
    this.normalizeActiveBasemap(this.state.viewMode);
    await this.mountView(this.state.viewMode, this.getConfiguredViewpoint());

    if (!this.view || this.destroyed) {
      return;
    }

    this.registerViewEvents();
    this.syncControlsWithView();
    this.setViewPadding();
    this.applySelectionFilters();
  }

  private ensureGroundElevation() {
    if (!this.map.ground || this.map.ground.layers.length === 0) {
      this.map.ground = "world-elevation" as any;
    }
  }

  private createViewElement(mode: "3d" | "2d", viewpoint?: __esri.Viewpoint) {
    const tagName = mode === "2d" ? "arcgis-map" : "arcgis-scene";
    const viewElement = document.createElement(tagName) as unknown as ArcGISViewElement;

    viewElement.id = ACTIVE_VIEW_ELEMENT_ID;
    viewElement.autoDestroyDisabled = true;
    viewElement.map = this.map;
    viewElement.popupDisabled = true;

    if (viewpoint) {
      viewElement.viewpoint = viewpoint;
    }

    if (mode === "3d") {
      viewElement.constraints = {
        tilt: {
          max: 80,
          mode: "manual",
        },
      };
      viewElement.environment = {
        lighting: new SunLighting({
          directShadowsEnabled: true,
        }),
        atmosphereEnabled: true,
        starsEnabled: false,
      };
    }

    return viewElement;
  }

  private async mountView(mode: "3d" | "2d", viewpoint?: __esri.Viewpoint) {
    if (!this.viewHost) {
      throw new Error("View host element #scenePanel was not found.");
    }

    const viewElement = this.createViewElement(mode, viewpoint);
    this.viewHost.replaceChildren(viewElement);
    this.viewElement = viewElement;

    await viewElement.viewOnReady?.();

    const nextView = viewElement.view ?? null;

    if (
      this.destroyed ||
      this.state.viewMode !== mode ||
      this.viewElement !== viewElement ||
      !nextView
    ) {
      return;
    }

    this.view = nextView;
    this.state.view = nextView;
  }

  private async switchView(viewMode: "3d" | "2d") {
    if (this.isSwitchingView || this.destroyed) {
      return;
    }

    this.isSwitchingView = true;
    const viewpoint = this.view?.viewpoint?.clone();

    try {
      await this.destroyCurrentView();
      await this.mountView(viewMode, viewpoint);

      if (!this.view || this.destroyed || this.viewModeChanged(viewMode)) {
        return;
      }

      this.registerViewEvents();
      this.syncControlsWithView();
      this.setViewPadding();
      await this.view.when();

      if (this.destroyed || this.viewModeChanged(viewMode)) {
        return;
      }

      this.applySelectionFilters();
      this.renderHighlights();
      this.zoomToSelection();
    } finally {
      this.isSwitchingView = false;
    }
  }

  private viewModeChanged(viewMode: "3d" | "2d") {
    return this.state.viewMode !== viewMode || !this.view;
  }

  private registerViewEvents() {
    const view = this.view;
    if (!view) {
      return;
    }

    this.removeViewHandles();
    this.addViewHandle(
      view.on("click", (event) => {
        void this.onViewClick(event);
      })
    );
    (window as any).view = view;
  }

  private syncControlsWithView() {
    const view = this.view;

    this.controls.all.forEach((control) => {
      control.view = view;
    });

    if (this.controls.home) {
      this.controls.home.viewpoint = this.getConfiguredViewpoint();
    }

    if (this.controls.navigationToggle) {
      this.controls.navigationToggle.hidden = view?.type !== "3d";
    }

    this.syncBasemapGallerySource();
    this.collapseExpandControls();
    window.requestAnimationFrame(() => {
      if (!this.destroyed) {
        this.collapseExpandControls();
      }
    });

    this.controls.container?.toggleAttribute("hidden", !view);
  }

  private clearControlViews() {
    this.controls.all.forEach((control) => {
      control.view = null;
    });

    if (this.controls.basemapGallery) {
      this.controls.basemapGallery.source = null;
    }

    if (this.controls.navigationToggle) {
      this.controls.navigationToggle.hidden = true;
    }

    this.collapseExpandControls();

    this.controls.container?.toggleAttribute("hidden", true);
  }

  private collapseExpandControls() {
    [this.controls.basemapExpand, this.controls.legendExpand].forEach((control) => {
      if (!control) {
        return;
      }

      control.expanded = false;
      control.removeAttribute("expanded");
    });
  }

  private removeViewHandles() {
    this.viewHandles.forEach((handle) => {
      handle.remove();
    });
    this.viewHandles = [];
  }

  private async destroyCurrentView() {
    const currentView = this.view;
    const currentElement = this.viewElement;
    if (!currentView && !currentElement) {
      return;
    }

    this.clearControlViews();
    this.removeViewHandles();
    this.clearHighlights();

    if ((window as any).view === currentView) {
      (window as any).view = null;
    }

    if (this.state.view === currentView) {
      this.state.view = null;
    }

    this.view = null;

    if (currentElement) {
      currentElement.map = null;
      currentElement.remove();
      await currentElement.destroy?.();
      if (this.viewElement === currentElement) {
        this.viewElement = null;
      }
      return;
    }

    currentView?.destroy();
  }

  private getBasemapSourceIds(viewType: "2d" | "3d") {
    return config.view.basemaps[viewType].sourceIds;
  }

  private createBasemapSource(viewType: "2d" | "3d") {
    return this.getBasemapSourceIds(viewType).map((basemapId) => {
      return Basemap.fromId(basemapId);
    }).filter((basemap): basemap is Basemap => Boolean(basemap));
  }

  private getAllowedBasemapIds(viewType: "2d" | "3d") {
    return new Set(this.getBasemapSourceIds(viewType));
  }

  private getCurrentBasemapId() {
    return this.map?.basemap?.id || this.map?.basemap?.portalItem?.id || null;
  }

  private normalizeActiveBasemap(viewType: "2d" | "3d") {
    const activeBasemapId = this.getCurrentBasemapId();
    if (activeBasemapId && this.getAllowedBasemapIds(viewType).has(activeBasemapId as any)) {
      return;
    }

    const fallbackId = config.view.basemaps[viewType].defaultId;
    this.map.basemap = Basemap.fromId(fallbackId);
  }

  private getConfiguredViewpoint() {
    return new Viewpoint(config.view.startupViewpoint as any);
  }

  private syncBasemapGallerySource() {
    const basemapGallery = this.controls.basemapGallery;
    const viewType = this.view?.type;

    if (!basemapGallery || !viewType) {
      return;
    }

    basemapGallery.source = this.createBasemapSource(viewType);
    this.normalizeActiveBasemap(viewType);
  }

  destroy() {
    this.destroyed = true;
    this.watchHandles.forEach((handle) => {
      handle.remove();
    });
    this.watchHandles = [];
    void this.destroyCurrentView();
    this.clearControlViews();

    if (this.map) {
      this.map.removeMany([this.parkTrailHighlightLayer, this.highlightLayer]);
      (this.map as any)?.destroy?.();
    }

    this.state.trailsLayer = null;
    this.state.parksLayer = null;
  }

  private setViewPadding() {
    if (!this.view || !this.viewElement || this.destroyed) {
      return;
    }

    const padding =
      this.state.device === "mobilePortrait"
        ? {
            top: 56,
            right: 0,
            bottom: 0,
            left: 0,
          }
        : {
            top: 56,
            right: 0,
            bottom: 0,
            left: 360,
          };

    this.view.padding = padding;
    this.viewElement.style.setProperty(
      "--arcgis-layout-overlay-space-top",
      `${padding.top}px`
    );
    this.viewElement.style.setProperty(
      "--arcgis-layout-overlay-space-right",
      `${padding.right}px`
    );
    this.viewElement.style.setProperty(
      "--arcgis-layout-overlay-space-bottom",
      `${padding.bottom}px`
    );
    this.viewElement.style.setProperty(
      "--arcgis-layout-overlay-space-left",
      `${padding.left}px`
    );
  }

  private sanitizeSceneViewLabelPlacement() {
    const featureLayers = this.map.allLayers
      .filter((layer) => layer.type === "feature")
      .toArray() as FeatureLayer[];

    featureLayers.forEach((layer) => {
      const labelingInfo = layer.labelingInfo;
      if (!labelingInfo?.length) {
        return;
      }

      const nextLabelingInfo = labelingInfo.map((labelClass) => {
        if (layer.geometryType !== "point" && labelClass?.labelPlacement) {
          const clone = labelClass.clone();
          clone.labelPlacement = undefined as any;
          return clone;
        }
        return labelClass;
      });

      layer.labelingInfo = nextLabelingInfo as any;
    });
  }

  private resolveLayers() {
    const inferredLayers = inferLayersFromMap(this.map);
    this.trailsLayer = inferredLayers.trailsLayer;
    this.parksLayer = inferredLayers.parksLayer;
    this.otherPolygonLayers = (inferredLayers.polygonLayers || []).filter((layer) => {
      return layer !== this.parksLayer;
    }) as FeatureLayer[];
  }

  private captureLayerDefaults() {
    if (this.trailsLayer?.renderer) {
      this.originalTrailsRenderer = this.trailsLayer.renderer.clone();
    }

    this.originalTrailsElevationInfo = this.cloneElevationInfo(
      this.trailsLayer?.elevationInfo
    );

    if (this.parksLayer?.renderer) {
      this.originalParksRenderer = this.parksLayer.renderer.clone();
    }

    [this.trailsLayer, this.parksLayer, ...this.otherPolygonLayers]
      .filter((layer): layer is FeatureLayer => Boolean(layer))
      .forEach((layer) => {
        if (!this.originalDefinitionExpressions.has(layer)) {
          this.originalDefinitionExpressions.set(layer, layer.definitionExpression || null);
        }
        if (!this.originalVisibility.has(layer)) {
          this.originalVisibility.set(layer, layer.visible);
        }
      });
  }

  private clearHighlights() {
    this.parkTrailHighlightLayer.removeAll();
    this.highlightLayer.removeAll();
  }

  private createTransparentSelectionRenderer(layer: FeatureLayer) {
    if (layer.geometryType === "polygon") {
      return {
        type: "simple",
        symbol: {
          type: "simple-fill",
          style: "none",
          color: config.colors.selectedParkFill,
          outline: {
            color: [0, 0, 0, 0],
            width: 0,
          },
        },
      } as any;
    }

    if (layer.geometryType === "polyline") {
      return {
        type: "simple",
        symbol: {
          type: "simple-line",
          color: [0, 0, 0, 0],
          width: 2,
        },
      } as any;
    }

    return layer.renderer;
  }

  private createParkHighlightSymbol(hasTrail: boolean) {
    const mutedOutlineWidth = Math.max(
      config.selection.parkOutlineMutedWidth,
      config.selection.parkOutlineWidth - 1
    );
    const mutedOutlineOpacity = Math.max(
      config.selection.parkOutlineMutedOpacity,
      0.75
    );

    return {
      type: "simple-fill",
      style: "none",
      color: config.colors.selectedParkFill,
      outline: {
        color: hasTrail
          ? [77, 161, 255, mutedOutlineOpacity]
          : config.colors.selectedParkOutline,
        width: hasTrail
          ? mutedOutlineWidth
          : config.selection.parkOutlineWidth,
      },
    } as any;
  }

  private getTrailWallHeight(trail: Trail) {
    if (typeof trail?.ascent === "number" && Number.isFinite(trail.ascent)) {
      return Math.max(
        config.selection.trailWallMinHeight,
        Math.min(
          config.selection.trailWallMaxHeight,
          trail.ascent * config.selection.trailWallHeightMultiplier
        )
      );
    }

    return config.selection.trailWallDefaultHeight;
  }

  private createSelectedTrailSymbol(trail: Trail) {
    if (this.view?.type === "3d") {
      return {
        type: "line-3d",
        symbolLayers: [
          {
            type: "path",
            profile: "quad",
            material: {
              color: config.colors.selectedTrail,
            },
            width: config.selection.trailWallWidth,
            height: this.getTrailWallHeight(trail),
            anchor: "bottom",
            cap: "round",
            join: "round",
            profileRotation: "heading",
            castShadows: false,
          },
        ],
      } as any;
    }

    return {
      type: "simple-line",
      color: config.colors.selectedTrail,
      width: 4,
    } as any;
  }

  private createSelectedParkTrailSymbol() {
    return {
      type: "simple-line",
      color: config.colors.defaultTrail,
      width:
        this.view?.type === "3d"
          ? config.selection.trailSourceSelectionWidth3d
          : config.selection.trailSourceSelectionWidth2d,
      cap: "round",
      join: "round",
    } as any;
  }

  private createSelectedParkTrailsRenderer() {
    return {
      type: "simple",
      symbol: this.createSelectedParkTrailSymbol(),
    } as any;
  }

  private createRenderSafeTrailGeometry(trail: Trail | null | undefined) {
    const sourceGeometry = trail?.geometry;
    const paths = sourceGeometry?.paths || [];
    const safePaths = paths
      .map((path) => {
        return path
          .map((vertex) => {
            if (!Array.isArray(vertex) || vertex.length < 2) {
              return null;
            }

            const x = Number(vertex[0]);
            const y = Number(vertex[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
              return null;
            }

            return [x, y];
          })
          .filter(Boolean);
      })
      .filter((path) => path.length >= 2);

    if (!safePaths.length) {
      return null;
    }

    return new Polyline({
      paths: safePaths as number[][][],
      spatialReference: sourceGeometry?.spatialReference,
      hasZ: false,
    });
  }

  private getSelectedParkTrails() {
    if (!this.state.selectedPark) {
      return [];
    }

    return (this.state.trails || []).filter((trail) => {
      return String(trail.parkId) === String(this.state.selectedPark.id);
    });
  }

  private syncParkTrailHighlightElevation() {
    if (!this.parkTrailHighlightLayer) {
      return;
    }

    this.parkTrailHighlightLayer.elevationInfo =
      this.view?.type === "3d"
        ? ({
            mode: "relative-to-ground",
            offset: config.selection.trailSourceSelectionOffset3d,
          } as any)
        : (null as any);
  }

  private getCombinedExtent(geometries: __esri.Polyline[]) {
    const firstExtent = geometries[0]?.extent?.clone();
    if (!firstExtent) {
      return null;
    }

    return geometries.slice(1).reduce((combinedExtent, geometry) => {
      const nextExtent = geometry?.extent;
      if (!nextExtent) {
        return combinedExtent;
      }

      return combinedExtent.union(nextExtent) as __esri.Extent;
    }, firstExtent as __esri.Extent);
  }

  private restoreLayerRenderer(layer: FeatureLayer, renderer: __esri.Renderer | null) {
    if (renderer) {
      const nextRenderer = (renderer as any)?.clone ? (renderer as any).clone() : renderer;
      layer.renderer = nextRenderer as any;
    }
  }

  private cloneElevationInfo(elevationInfo: __esri.ElevationInfo | null | undefined) {
    if (!elevationInfo) {
      return null;
    }

    return (elevationInfo as any)?.clone
      ? (elevationInfo as any).clone()
      : { ...(elevationInfo as any) };
  }

  private restoreLayerExpression(layer: FeatureLayer) {
    layer.definitionExpression = this.originalDefinitionExpressions.get(layer) ?? null;
  }

  private restoreLayerVisibility(layer: FeatureLayer) {
    layer.visible = this.originalVisibility.get(layer) ?? true;
  }

  private restoreTrailsLayerElevationInfo() {
    if (!this.trailsLayer) {
      return;
    }

    this.trailsLayer.elevationInfo = this.cloneElevationInfo(
      this.originalTrailsElevationInfo
    ) as any;
  }

  private buildObjectIdExpression(layer: FeatureLayer, objectId: any) {
    const numericObjectId = Number(objectId);
    if (Number.isFinite(numericObjectId)) {
      return `${layer.objectIdField} = ${numericObjectId}`;
    }
    const escaped = String(objectId).replace(/'/g, "''");
    return `${layer.objectIdField} = '${escaped}'`;
  }

  private buildSqlValue(value: any) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && String(value).trim() !== "") {
      return String(numericValue);
    }

    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private buildFieldValueExpression(fieldName: string, values: any[]) {
    const uniqueValues = Array.from(
      new Set(
        values.filter((value) => {
          return value !== null && value !== undefined && String(value).trim() !== "";
        })
      )
    );

    if (!uniqueValues.length) {
      return null;
    }

    if (uniqueValues.length === 1) {
      return `${fieldName} = ${this.buildSqlValue(uniqueValues[0])}`;
    }

    return `${fieldName} IN (${uniqueValues.map((value) => this.buildSqlValue(value)).join(", ")})`;
  }

  private buildObjectIdSetExpression(layer: FeatureLayer, objectIds: any[]) {
    return this.buildFieldValueExpression(layer.objectIdField, objectIds);
  }

  private getSelectedParkTrailExpression() {
    if (!this.trailsLayer || !this.parksLayer || !this.state.selectedPark) {
      return null;
    }

    const parkField = getTrailParkField(this.trailsLayer, this.parksLayer);
    if (parkField) {
      return this.buildFieldValueExpression(parkField, [this.state.selectedPark.id]);
    }

    const trailObjectIds = (this.state.trails || [])
      .filter((trail) => {
        return String(trail.parkId) === String(this.state.selectedPark.id);
      })
      .map((trail) => trail.objectId);

    return this.buildObjectIdSetExpression(this.trailsLayer, trailObjectIds);
  }

  private getSelectedParkTrailGeometries() {
    return this.getSelectedParkTrails()
      .map((trail) => this.createRenderSafeTrailGeometry(trail))
      .filter(Boolean) as __esri.Polyline[];
  }

  private applySelectionFilters() {
    if (this.destroyed) {
      return;
    }

    const hasSelectedPark =
      this.state.selectedPark?.objectId !== null &&
      this.state.selectedPark?.objectId !== undefined;
    const hasSelectedTrail =
      this.state.selectedTrail?.objectId !== null &&
      this.state.selectedTrail?.objectId !== undefined;
    const hasActiveSelection = hasSelectedPark || hasSelectedTrail;

    if (this.parksLayer) {
      if (hasSelectedPark) {
        this.parksLayer.definitionExpression = this.buildObjectIdExpression(
          this.parksLayer,
          this.state.selectedPark.objectId
        );
        this.parksLayer.renderer = this.createTransparentSelectionRenderer(this.parksLayer);
      } else {
        this.restoreLayerExpression(this.parksLayer);
        this.restoreLayerRenderer(this.parksLayer, this.originalParksRenderer);
      }

      this.restoreLayerVisibility(this.parksLayer);
      this.parksLayer.opacity = 1;
    }

    this.otherPolygonLayers.forEach((layer) => {
      if (hasSelectedPark) {
        layer.visible = false;
      } else {
        this.restoreLayerExpression(layer);
        this.restoreLayerVisibility(layer);
      }

      layer.opacity = 1;
    });

    if (this.trailsLayer) {
      if (hasSelectedTrail) {
        this.trailsLayer.definitionExpression = this.buildObjectIdExpression(
          this.trailsLayer,
          this.state.selectedTrail.objectId
        );
        this.restoreLayerRenderer(this.trailsLayer, this.originalTrailsRenderer);
      } else if (hasSelectedPark) {
        this.trailsLayer.definitionExpression =
          this.getSelectedParkTrailExpression() || "1=0";
        this.trailsLayer.renderer = this.createSelectedParkTrailsRenderer();
      } else {
        this.restoreLayerExpression(this.trailsLayer);
        this.restoreLayerRenderer(this.trailsLayer, this.originalTrailsRenderer);
      }

      if (hasActiveSelection && this.view?.type === "3d") {
        this.trailsLayer.elevationInfo = {
          mode: "relative-to-ground",
          offset: config.selection.trailSourceSelectionOffset3d,
        } as any;
      } else {
        this.restoreTrailsLayerElevationInfo();
      }

      if (hasActiveSelection) {
        this.trailsLayer.visible = true;
      } else {
        this.restoreLayerVisibility(this.trailsLayer);
      }
      this.trailsLayer.opacity =
        hasSelectedPark && !hasSelectedTrail && this.view?.type === "3d"
          ? 0.35
          : 1;
    }
  }

  private async onViewClick(event) {
    if (this.destroyed || !this.view || !this.state.online || (!this.trailsLayer && !this.parksLayer)) {
      return;
    }

    const includeLayers = [this.trailsLayer, this.parksLayer].filter(
      Boolean
    ) as FeatureLayer[];

    // Try hitTest first (works when tiles are rendered).
    const response = await this.view.hitTest(event, { include: includeLayers });

    const trailResult: any = response.results.find((result: any) => {
      return (
        result?.type === "graphic" &&
        result.graphic?.layer === this.trailsLayer
      );
    });

    if (trailResult?.graphic && this.trailsLayer) {
      const objectId = Number(
        trailResult.graphic.attributes[this.trailsLayer.objectIdField]
      );
      const selectedTrail = (this.state.trails || []).find((trail) => {
        return Number(trail.objectId) === objectId;
      });
      if (selectedTrail?.parkId !== null && selectedTrail?.parkId !== undefined) {
        this.state.setSelectedPark(selectedTrail.parkId);
      }
      this.state.setSelectedTrail(selectedTrail?.id ?? null);
      return;
    }

    const parkResult: any = response.results.find((result: any) => {
      return (
        result?.type === "graphic" &&
        result.graphic?.layer === this.parksLayer
      );
    });

    if (parkResult?.graphic && this.parksLayer) {
      const objectId = Number(
        parkResult.graphic.attributes[this.parksLayer.objectIdField]
      );
      const selectedPark = (this.state.parks || []).find((park) => {
        return Number(park.objectId) === objectId;
      });
      this.state.setSelectedPark(selectedPark?.id ?? null);
      this.state.setSelectedTrail(null);
      return;
    }

    // Fallback: hitTest returned nothing (tiles may not be rendered).
    // Use spatial queries against the click location.
    const mapPoint = event.mapPoint;
    if (!mapPoint) {
      this.state.setSelectedTrail(null);
      this.state.setSelectedPark(null);
      return;
    }

    const tolerance = this.view.resolution * 10;

    if (this.trailsLayer) {
      try {
        const trailQueryResult = await this.trailsLayer.queryFeatures({
          geometry: mapPoint,
          distance: tolerance,
          units: "meters",
          spatialRelationship: "intersects",
          outFields: [this.trailsLayer.objectIdField],
          returnGeometry: false,
          num: 1,
        });
        if (trailQueryResult.features.length > 0) {
          const objectId = Number(
            trailQueryResult.features[0].attributes[this.trailsLayer.objectIdField]
          );
          const selectedTrail = (this.state.trails || []).find((trail) => {
            return Number(trail.objectId) === objectId;
          });
          if (selectedTrail) {
            if (selectedTrail.parkId !== null && selectedTrail.parkId !== undefined) {
              this.state.setSelectedPark(selectedTrail.parkId);
            }
            this.state.setSelectedTrail(selectedTrail.id);
            return;
          }
        }
      } catch { /* spatial query failed, continue */ }
    }

    if (this.parksLayer) {
      try {
        const parkQueryResult = await this.parksLayer.queryFeatures({
          geometry: mapPoint,
          spatialRelationship: "intersects",
          outFields: [this.parksLayer.objectIdField],
          returnGeometry: false,
          num: 1,
        });
        if (parkQueryResult.features.length > 0) {
          const objectId = Number(
            parkQueryResult.features[0].attributes[this.parksLayer.objectIdField]
          );
          const selectedPark = (this.state.parks || []).find((park) => {
            return Number(park.objectId) === objectId;
          });
          if (selectedPark) {
            this.state.setSelectedPark(selectedPark.id);
            this.state.setSelectedTrail(null);
            return;
          }
        }
      } catch { /* spatial query failed, continue */ }
    }

    this.state.setSelectedTrail(null);
    this.state.setSelectedPark(null);
  }

  private renderHighlights() {
    if (this.destroyed) {
      return;
    }

    this.clearHighlights();
    this.syncParkTrailHighlightElevation();

    if (this.state.selectedPark) {
      this.highlightLayer.add(
        new Graphic({
          geometry: this.state.selectedPark.geometry,
          symbol: this.createParkHighlightSymbol(!!this.state.selectedTrail),
        })
      );
    }

    if (this.state.selectedPark && !this.state.selectedTrail) {
      const parkTrailGraphics = this.getSelectedParkTrails()
        .map((trail) => {
          const geometry = this.createRenderSafeTrailGeometry(trail);
          if (!geometry) {
            return null;
          }

          return new Graphic({
            geometry,
            symbol: this.createSelectedParkTrailSymbol(),
          });
        })
        .filter(Boolean) as Graphic[];

      if (parkTrailGraphics.length) {
        this.parkTrailHighlightLayer.addMany(parkTrailGraphics);
      }
    }

    if (this.state.selectedTrail) {
      const trailGeometry =
        this.createRenderSafeTrailGeometry(this.state.selectedTrail) ||
        this.state.selectedTrail.geometry;

      this.highlightLayer.add(
        new Graphic({
          geometry: trailGeometry,
          symbol: this.createSelectedTrailSymbol(this.state.selectedTrail),
        })
      );
    }
  }

  private zoomToSelection() {
    if (!this.view || this.destroyed) {
      return;
    }

    const view = this.view;

    if (this.state.selectedTrail?.geometry) {
      const trailGeometry =
        this.createRenderSafeTrailGeometry(this.state.selectedTrail) ||
        this.state.selectedTrail.geometry;

      if (view.type === "3d") {
        view.goTo(
          {
            target: trailGeometry,
            tilt: 60,
          },
          { speedFactor: 0.5 }
        );
      } else {
        view.goTo(trailGeometry, { speedFactor: 0.5 });
      }
      return;
    }

    if (this.state.selectedPark?.geometry) {
      const selectedParkTrailGeometries = this.getSelectedParkTrailGeometries();

      if (view.type === "3d" && selectedParkTrailGeometries.length > 0) {
        const selectedParkTrailExtent = this.getCombinedExtent(selectedParkTrailGeometries);

        if (selectedParkTrailExtent?.center) {
          const maxDimension = Math.max(
            selectedParkTrailExtent.width || 0,
            selectedParkTrailExtent.height || 0
          );
          const scale = Math.max(90000, Math.min(maxDimension * 6, 700000));

          view.goTo(
            {
              target: selectedParkTrailExtent.center,
              scale,
              tilt: 55,
            },
            { speedFactor: 0.7 }
          );
          return;
        }
      }

      const target =
        selectedParkTrailGeometries.length > 0
          ? selectedParkTrailGeometries
          : this.state.selectedPark.geometry;

      if (view.type === "3d") {
        view.goTo(
          {
            target,
            tilt: 55,
          },
          { speedFactor: 0.7 }
        );
      } else {
        view.goTo(target, { speedFactor: 0.7 });
      }
    }
  }
}
