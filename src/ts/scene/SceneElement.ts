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
import { ArcGISView, State } from "../types";
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
  highlightLayer: GraphicsLayer;
  ready: Promise<void>;
  private isSwitchingView: boolean;
  private originalTrailsRenderer: __esri.Renderer | null;
  private originalParksRenderer: __esri.Renderer | null;

  constructor(state: State) {
    this.state = state;
    this.isSwitchingView = false;
    this.originalTrailsRenderer = null;
    this.originalParksRenderer = null;
    this.map = new WebMap({
      portalItem: {
        id: config.scene.webmapItemId,
      },
    });
    this.highlightLayer = new GraphicsLayer({
      title: "Selection highlight",
      listMode: "hide",
    });
    this.map.add(this.highlightLayer);

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
    const featureLayers = this.map.allLayers
      .filter((layer) => layer.type === "feature")
      .toArray() as FeatureLayer[];

    const scoreLayer = (
      layer: FeatureLayer,
      geometryType: "polyline" | "polygon",
      titlePattern: RegExp,
      fieldPattern: RegExp
    ) => {
      if (layer.geometryType !== geometryType) {
        return -1;
      }
      let score = 0;
      const title = (layer.title || "").toLowerCase();
      const url = (layer.url || "").toLowerCase();
      const displayField = (layer.displayField || "").toLowerCase();
      const fieldNames = (layer.fields || []).map((field) => {
        return String(field.name || "").toLowerCase();
      });

      if (titlePattern.test(title)) {
        score += 8;
      }
      if (titlePattern.test(url)) {
        score += 4;
      }
      if (fieldPattern.test(displayField)) {
        score += 2;
      }

      const matchingFields = fieldNames.filter((name) => fieldPattern.test(name));
      score += Math.min(matchingFields.length, 4);

      // Boost layers carrying unit_code / unit_type for reliable joins.
      if (geometryType === "polygon") {
        if (fieldNames.some((n) => n === "unit_code")) score += 3;
        if (fieldNames.some((n) => n === "unit_type")) score += 2;
      }
      if (geometryType === "polyline") {
        if (fieldNames.some((n) => n === "unitcode")) score += 3;
      }

      return score;
    };

    const selectBestLayer = (
      geometryType: "polyline" | "polygon",
      titlePattern: RegExp,
      fieldPattern: RegExp
    ) => {
      const candidates = featureLayers
        .map((layer) => ({
          layer,
          score: scoreLayer(layer, geometryType, titlePattern, fieldPattern),
        }))
        .filter((candidate) => candidate.score >= 0)
        .sort((a, b) => b.score - a.score);

      return candidates[0]?.layer || null;
    };

    this.trailsLayer =
      selectBestLayer(
        "polyline",
        /trail|route|hike/i,
        /trail|route|hike|path|name|id/
      ) || featureLayers.find((layer) => layer.geometryType === "polyline") || null;

    this.parksLayer =
      selectBestLayer(
        "polygon",
        /park|boundary|reserve|national/i,
        /park|boundary|reserve|unit|name|id/
      ) || featureLayers.find((layer) => layer.geometryType === "polygon") || null;
  }

  private captureLayerDefaults() {
    if (this.trailsLayer?.renderer) {
      this.originalTrailsRenderer = this.trailsLayer.renderer.clone();
    }

    if (this.parksLayer?.renderer) {
      this.originalParksRenderer = this.parksLayer.renderer.clone();
    }
  }

  private clearHighlights() {
    this.highlightLayer.removeAll();
  }

  private createTransparentSelectionRenderer(layer: FeatureLayer) {
    if (layer.geometryType === "polygon") {
      return {
        type: "simple",
        symbol: {
          type: "simple-fill",
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

  private restoreLayerRenderer(layer: FeatureLayer, renderer: __esri.Renderer | null) {
    if (renderer) {
      const nextRenderer = (renderer as any)?.clone ? (renderer as any).clone() : renderer;
      layer.renderer = nextRenderer as any;
    }
  }

  private buildObjectIdExpression(layer: FeatureLayer, objectId: any) {
    const numericObjectId = Number(objectId);
    if (Number.isFinite(numericObjectId)) {
      return `${layer.objectIdField} = ${numericObjectId}`;
    }
    const escaped = String(objectId).replace(/'/g, "''");
    return `${layer.objectIdField} = '${escaped}'`;
  }

  private applySelectionFilters() {
    if (this.parksLayer) {
      if (this.state.selectedPark?.objectId !== null && this.state.selectedPark?.objectId !== undefined) {
        this.parksLayer.definitionExpression = this.buildObjectIdExpression(
          this.parksLayer,
          this.state.selectedPark.objectId
        );
        this.parksLayer.renderer = this.createTransparentSelectionRenderer(this.parksLayer);
      } else {
        this.parksLayer.definitionExpression = "1=1";
        this.restoreLayerRenderer(this.parksLayer, this.originalParksRenderer);
      }

      this.parksLayer.opacity = 1;
    }

    if (this.trailsLayer) {
      if (this.state.selectedTrail?.objectId !== null && this.state.selectedTrail?.objectId !== undefined) {
        this.trailsLayer.definitionExpression = this.buildObjectIdExpression(
          this.trailsLayer,
          this.state.selectedTrail.objectId
        );
        this.trailsLayer.renderer = this.createTransparentSelectionRenderer(this.trailsLayer);
      } else {
        this.trailsLayer.definitionExpression = "1=1";
        this.restoreLayerRenderer(this.trailsLayer, this.originalTrailsRenderer);
      }

      this.trailsLayer.opacity = 1;
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

    if (this.state.selectedPark) {
      const hasTrail = !!this.state.selectedTrail;
      const parkOutlineColor = hasTrail
        ? [77, 161, 255, 0.08]
        : config.colors.selectedParkOutline;

      this.highlightLayer.add(
        new Graphic({
          geometry: this.state.selectedPark.geometry,
          symbol: {
            type: "simple-fill",
            color: config.colors.selectedParkFill,
            outline: {
              color: parkOutlineColor,
              width: hasTrail ? 1 : 2,
            },
          } as any,
        })
      );
    }

    if (this.state.selectedTrail) {
      this.highlightLayer.add(
        new Graphic({
          geometry: this.state.selectedTrail.geometry,
          symbol: {
            type: "simple-line",
            color: config.colors.selectedTrail,
            width: 4,
          } as any,
        })
      );
    }
  }

  private zoomToSelection() {
    if (!this.view) {
      return;
    }

    if (this.state.selectedTrail?.geometry) {
      this.view.goTo(
        {
          target: this.state.selectedTrail.geometry,
          tilt: this.view.type === "3d" ? 60 : undefined,
        },
        { speedFactor: 0.5 }
      );
      return;
    }

    if (this.state.selectedPark?.geometry) {
      this.view.goTo(
        {
          target: this.state.selectedPark.geometry,
        },
        { speedFactor: 0.7 }
      );
    }
  }
}
