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
import Graphic from "@arcgis/core/Graphic";
import Polyline from "@arcgis/core/geometry/Polyline";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SunLighting from "@arcgis/core/webscene/SunLighting";
import Compass from "@arcgis/core/widgets/Compass";
import Home from "@arcgis/core/widgets/Home";
import NavigationToggle from "@arcgis/core/widgets/NavigationToggle";
import Zoom from "@arcgis/core/widgets/Zoom";
import BasemapGallery from "@arcgis/core/widgets/BasemapGallery";
import Expand from "@arcgis/core/widgets/Expand";
import Viewpoint from "@arcgis/core/Viewpoint";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import config from "../config";
import { getTrailParkField, inferLayersFromMap } from "../data/trailManager";
import { ArcGISView, State, Trail } from "../types";
import "../../style/scene-panel.scss";

const US_HOME_VIEWPOINT = new Viewpoint({
  targetGeometry: {
    type: "point",
    longitude: -98.5795,
    latitude: 39.8283,
    spatialReference: { wkid: 4326 },
  } as any,
  scale: 20000000,
});

export default class SceneElement {
  state: State;
  view: ArcGISView;
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

  constructor(state: State) {
    this.state = state;
    this.isSwitchingView = false;
    this.originalTrailsRenderer = null;
    this.originalTrailsElevationInfo = null;
    this.originalParksRenderer = null;
    this.otherPolygonLayers = [];
    this.originalDefinitionExpressions = new Map();
    this.originalVisibility = new Map();
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

    reactiveUtils.watch(() => state.device, () => {
      this.setViewPadding();
    });

    reactiveUtils.watch(() => state.selectedParkId, () => {
      this.applySelectionFilters();
      this.renderHighlights();
      this.zoomToSelection();
    });

    reactiveUtils.watch(() => state.selectedTrailId, () => {
      this.applySelectionFilters();
      this.renderHighlights();
      this.zoomToSelection();
    });

    reactiveUtils.watch(() => state.viewMode, async (viewMode, oldMode) => {
      if (viewMode !== oldMode) {
        await this.switchView(viewMode);
      }
    });
  }

  private async init() {
    try {
      await this.map.loadAll();
    } catch (error) {
      console.warn("WebMap load failed, continuing with degraded behavior.", error);
    }

    this.ensureGroundElevation();

    this.sanitizeSceneViewLabelPlacement();

    this.resolveLayers();
    this.captureLayerDefaults();
    this.state.trailsLayer = this.trailsLayer;
    this.state.parksLayer = this.parksLayer;
    this.view = this.createView(this.state.viewMode);
    this.state.view = this.view;
    this.registerViewEvents();
    this.addWidgets();
    this.setViewPadding();
    this.applySelectionFilters();
  }

  private ensureGroundElevation() {
    if (!this.map.ground || this.map.ground.layers.length === 0) {
      this.map.ground = "world-elevation" as any;
    }
  }

  private createView(mode: "3d" | "2d", viewpoint?: __esri.Viewpoint) {
    const base = {
      container: "scenePanel",
      map: this.map,
      ui: {
        components: ["attribution"] as string[],
      },
      popupEnabled: false,
      popup: {
        dockEnabled: false,
      },
    };

    if (mode === "2d") {
      return new MapView({
        ...base,
        viewpoint,
      });
    }

    return new SceneView({
      ...base,
      constraints: {
        tilt: {
          max: 80,
          mode: "manual",
        },
      },
      environment: {
        lighting: new SunLighting({
          directShadowsEnabled: true,
        }),
        atmosphereEnabled: true,
        starsEnabled: false,
      },
      viewpoint,
    });
  }

  private async switchView(viewMode: "3d" | "2d") {
    if (this.isSwitchingView) {
      return;
    }

    this.isSwitchingView = true;
    const viewpoint = this.view?.viewpoint?.clone();

    try {
      if (this.view) {
        this.view.container = null;
        this.view.map = null;
        this.view.destroy();
      }

      this.view = this.createView(viewMode, viewpoint);
      this.state.view = this.view;
      this.registerViewEvents();
      this.addWidgets();
      this.setViewPadding();
      await this.view.when();
      this.applySelectionFilters();
      this.renderHighlights();
      this.zoomToSelection();
    } finally {
      this.isSwitchingView = false;
    }
  }

  private registerViewEvents() {
    this.view.on("click", (event) => {
      this.onViewClick(event);
    });
    (window as any).view = this.view;
  }

  private addWidgets() {
    this.view.ui.empty("top-right");
    const zoom = new Zoom({
      view: this.view,
    });
    const compass = new Compass({
      view: this.view,
    });
    const widgets: any[] = [zoom, compass];
    if (this.view.type === "3d") {
      widgets.push(
        new NavigationToggle({
          view: this.view as SceneView,
        })
      );
    }

    const basemapGallery = new BasemapGallery({
      view: this.view,
    });
    const basemapExpand = new Expand({
      view: this.view,
      expanded: false,
      content: basemapGallery,
      expandIcon: "basemap",
      mode: "floating",
    });

    const home = new Home({
      view: this.view,
      viewpoint: US_HOME_VIEWPOINT.clone(),
    });

    this.view.ui.add([home, ...widgets, basemapExpand], "top-right");
  }

  private setViewPadding() {
    if (!this.view) {
      return;
    }
    if (this.state.device === "mobilePortrait") {
      this.view.padding = {
        top: 56,
        left: 0,
      };
    } else {
      this.view.padding = {
        top: 56,
        left: 360,
      };
    }
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
        if (labelClass?.labelPlacement === "always-horizontal") {
          const clone = labelClass.clone();
          clone.labelPlacement = "above-center" as any;
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
      .filter(Boolean)
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
      spatialReference: sourceGeometry.spatialReference,
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
    if (!this.state.online || (!this.trailsLayer && !this.parksLayer)) {
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
    if (!this.view) {
      return;
    }

    if (this.state.selectedTrail?.geometry) {
      const trailGeometry =
        this.createRenderSafeTrailGeometry(this.state.selectedTrail) ||
        this.state.selectedTrail.geometry;

      this.view.goTo(
        {
          target: trailGeometry,
          tilt: this.view.type === "3d" ? 60 : undefined,
        },
        { speedFactor: 0.5 }
      );
      return;
    }

    if (this.state.selectedPark?.geometry) {
      const selectedParkTrailGeometries = this.getSelectedParkTrailGeometries();

      if (this.view.type === "3d" && selectedParkTrailGeometries.length > 0) {
        const selectedParkTrailExtent = this.getCombinedExtent(selectedParkTrailGeometries);

        if (selectedParkTrailExtent?.center) {
          const maxDimension = Math.max(
            selectedParkTrailExtent.width || 0,
            selectedParkTrailExtent.height || 0
          );
          const scale = Math.max(90000, Math.min(maxDimension * 6, 700000));

          this.view.goTo(
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

      this.view.goTo(
        {
          target:
            selectedParkTrailGeometries.length > 0
              ? selectedParkTrailGeometries
              : this.state.selectedPark.geometry,
          tilt: this.view.type === "3d" ? 55 : undefined,
        },
        { speedFactor: 0.7 }
      );
    }
  }
}
