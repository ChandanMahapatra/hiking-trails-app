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

import Graphic from "@arcgis/core/Graphic";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import config from "../config";
import { DistanceUnit, State, Trail } from "../types";

const ACTIVE_VIEW_ELEMENT_ID = "activeArcgisView";

type RemovableHandle = { remove: () => void };
type GeodeticLengthOperatorModule = typeof import("@arcgis/core/geometry/operators/geodeticLengthOperator.js");
type ElevationProfileElement = HTMLElement & {
  componentOnReady?: () => Promise<unknown>;
  destroy?: () => Promise<void>;
  feature?: Graphic;
  hideSelectButton?: boolean;
  hideStartButton?: boolean;
  hideVisualization?: boolean;
  highlightDisabled?: boolean;
  label?: string;
  profiles?: __esri.CollectionProperties<__esri.ElevationProfileLineGround> | any[];
  referenceElement?: HTMLElement | string;
};

let geodeticLengthOperatorPromise: Promise<GeodeticLengthOperatorModule> | null = null;
let elevationProfileComponentPromise: Promise<unknown> | null = null;

function getGeodeticLengthOperator(): Promise<GeodeticLengthOperatorModule> {
  if (!geodeticLengthOperatorPromise) {
    geodeticLengthOperatorPromise = import(
      "@arcgis/core/geometry/operators/geodeticLengthOperator.js"
    );
  }

  return geodeticLengthOperatorPromise;
}

function ensureElevationProfileComponent(): Promise<unknown> {
  if (!elevationProfileComponentPromise) {
    elevationProfileComponentPromise = import(
      "@arcgis/map-components/components/arcgis-elevation-profile"
    );
  }

  return elevationProfileComponentPromise;
}

export default class DetailPanel {
  state: State;
  container: HTMLElement;
  detailTitle: HTMLElement;
  detailInfograph: HTMLElement;
  detailElevationProfile: HTMLElement;
  detailDescription: HTMLElement;
  elevationProfile: ElevationProfileElement | null;
  private profileRequestId: number;
  private watchHandles: RemovableHandle[];
  private destroyed: boolean;

  constructor(state: State) {
    this.state = state;
    this.container = document.getElementById("detailPanel")!;
    this.detailTitle = document.getElementById("detailTitle")!;
    this.detailInfograph = document.getElementById("detailInfograph")!;
    this.detailDescription = document.getElementById("detailDescription")!;
    this.detailElevationProfile = document.getElementById(
      "detailElevationProfile"
    )!;
    this.elevationProfile = null;
    this.profileRequestId = 0;
    this.watchHandles = [];
    this.destroyed = false;

    this.emptyDetails();

    this.addWatch(reactiveUtils.watch(
      () => ({
        selectedTrailId: state.selectedTrailId,
        view: state.view,
      }),
      () => {
        void this.refreshSelectedTrail();
      }
    ));

    this.addWatch(reactiveUtils.watch(() => state.device, () => {
      if (
        this.state.selectedTrailId === null ||
        this.state.selectedTrailId === undefined
      ) {
        this.displayAppInfo();
      }
    }));
  }

  private addWatch(handle: RemovableHandle) {
    this.watchHandles.push(handle);
  }

  destroy() {
    this.destroyed = true;
    this.profileRequestId += 1;
    this.watchHandles.forEach((handle) => {
      handle.remove();
    });
    this.watchHandles = [];
    this.destroyElevationProfile();
  }

  emptyDetails() {
    if (this.destroyed) {
      return;
    }

    this.detailTitle.textContent = "";
    this.detailDescription.textContent = "";
    this.detailInfograph.innerHTML = "";
    this.detailElevationProfile.textContent = "";

    this.displayAppInfo();
  }

  displayAppInfo() {
    if (this.destroyed) {
      return;
    }

    this.detailInfograph.innerHTML =
      '<p class="detailEmptyState">Select a park and trail to view details and the live elevation profile.</p>';
  }

  private isMeaningful(value?: string | number | null): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    const normalized = String(value).trim();
    return Boolean(normalized) && normalized.toLowerCase() !== "unknown";
  }

  private formatDecimal(value: number, maximumFractionDigits = 1): string {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits,
      minimumFractionDigits: value < 10 ? 1 : 0,
    }).format(value);
  }

  private formatDistance(value: number, unit: DistanceUnit): string {
    const maximumFractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${this.formatDecimal(value, maximumFractionDigits)} ${unit}`;
  }

  private async deriveTrailLength(trail: Trail): Promise<string | null> {
    const geometry = trail?.geometry;
    if (geometry?.type !== "polyline") {
      return null;
    }

    try {
      const geodeticLengthOperator = await getGeodeticLengthOperator();
      if (!geodeticLengthOperator.isLoaded()) {
        await geodeticLengthOperator.load();
      }

      const length = geodeticLengthOperator.execute(geometry, { unit: "miles" });
      if (!Number.isFinite(length) || length <= 0) {
        return null;
      }

      return this.formatDistance(length, "mi");
    } catch {
      return null;
    }
  }

  private async buildTrailMetricSummary(trail: Trail) {
    const gainText =
      typeof trail.ascent === "number" && Number.isFinite(trail.ascent) && trail.ascent > 0
        ? `${this.formatDecimal(trail.ascent, 0)} m gain`
        : null;

    if (
      typeof trail.length === "number" &&
      Number.isFinite(trail.length) &&
      trail.length > 0 &&
      trail.lengthUnit
    ) {
      return {
        gainText,
        lengthText: this.formatDistance(trail.length, trail.lengthUnit),
      };
    }

    return {
      gainText,
      lengthText: await this.deriveTrailLength(trail),
    };
  }

  private async refreshSelectedTrail() {
    const requestId = ++this.profileRequestId;
    const trail = this.state.selectedTrail;

    if (this.destroyed) {
      return;
    }

    this.emptyDetails();
    this.destroyElevationProfile();

    if (!trail) {
      return;
    }

    const metricSummary = await this.buildTrailMetricSummary(trail);
    if (
      this.destroyed ||
      requestId !== this.profileRequestId ||
      trail !== this.state.selectedTrail
    ) {
      return;
    }

    this.displayInfo(trail, metricSummary);
    this.detailElevationProfile.textContent = "Loading elevation profile...";
    await this.createElevationProfile(trail, requestId);
  }

  displayInfo(trail: Trail, metricSummary): void {
    if (this.destroyed) {
      return;
    }

    this.detailTitle.textContent = trail.name;
    this.createInfograph(trail, metricSummary);
    const description = [trail.description, trail.seasonalDescription].find((value) => {
      return this.isMeaningful(value);
    });

    this.detailDescription.textContent = description
      ? String(description).trim()
      : "Trail details are limited for this segment. Use the live elevation profile and map context for additional information.";
  }

  private destroyElevationProfile() {
    if (this.elevationProfile) {
      void this.elevationProfile.destroy?.();
      this.elevationProfile.remove();
      this.elevationProfile = null;
    }
  }

  private createProfileInputGraphic(trail: Trail): Graphic | null {
    const geometry = trail?.geometry?.clone ? trail.geometry.clone() : trail?.geometry;
    const paths = geometry?.paths;

    if (geometry?.type !== "polyline" || !Array.isArray(paths)) {
      return null;
    }

    const hasValidPath = paths.some((path) => {
      return Array.isArray(path) && path.length >= 2;
    });

    if (!hasValidPath) {
      return null;
    }

    return new Graphic({ geometry });
  }

  private async createElevationProfile(trail: Trail, requestId: number) {
    this.destroyElevationProfile();
    const view = this.state.view;
    const inputGraphic = this.createProfileInputGraphic(trail);

    if (this.destroyed || !view || !inputGraphic) {
      this.detailElevationProfile.textContent =
        "Elevation profile is unavailable for the current trail selection.";
      return;
    }

    try {
      if (!(view as any).ready) {
        await view.when();
      }
    } catch {
      this.detailElevationProfile.textContent =
        "Elevation profile is still loading. Try the selection again once the map finishes initializing.";
      return;
    }

    if (
      this.destroyed ||
      requestId !== this.profileRequestId ||
      trail !== this.state.selectedTrail ||
      view !== this.state.view
    ) {
      return;
    }

    try {
      await ensureElevationProfileComponent();

      if (
        this.destroyed ||
        requestId !== this.profileRequestId ||
        trail !== this.state.selectedTrail ||
        view !== this.state.view
      ) {
        return;
      }

      const elevationProfile = document.createElement(
        "arcgis-elevation-profile"
      ) as unknown as ElevationProfileElement;
      elevationProfile.label = "Trail elevation profile";
      this.detailElevationProfile.replaceChildren(elevationProfile);
      await elevationProfile.componentOnReady?.();

      if (
        this.destroyed ||
        requestId !== this.profileRequestId ||
        trail !== this.state.selectedTrail ||
        view !== this.state.view
      ) {
        void elevationProfile.destroy?.();
        elevationProfile.remove();
        return;
      }

      elevationProfile.referenceElement = ACTIVE_VIEW_ELEMENT_ID;
      elevationProfile.hideSelectButton = true;
      elevationProfile.hideStartButton = true;
      elevationProfile.highlightDisabled = true;
      elevationProfile.feature = inputGraphic;
      elevationProfile.profiles = [
        {
          type: "ground",
          title: "Trail statistics",
          color: config.colors.selectedTrail,
        },
      ];

      this.elevationProfile = elevationProfile;
    } catch (error) {
      console.warn("Elevation profile could not be created for the selected trail.", error);
      this.destroyElevationProfile();
      this.detailElevationProfile.textContent =
        "Elevation profile could not be created for this trail.";
    }
  }

  createInfograph(trail, metricSummary) {
    const statusLabels = {
      Closed: "Closed",
      Open: "Open",
    };
    const statusText = statusLabels[trail.status] || null;
    const primaryFacts = [
      metricSummary?.lengthText
        ? `<span class="infograph">${metricSummary.lengthText}</span>`
        : "",
      metricSummary?.gainText
        ? `<span class="infograph">${metricSummary.gainText}</span>`
        : "",
      this.isMeaningful(trail.difficulty)
        ? `<span class="infograph">${trail.difficulty}</span>`
        : "",
      trail.walktime
        ? `<span class="infograph">${trail.walktime} hr</span>`
        : "",
      trail.status && statusText
        ? `<span class="infograph">${statusText}</span>`
        : "",
    ].filter(Boolean);

    const attributeRows = [
      this.isMeaningful(trail.surface)
        ? `<div class="detailAttribute"><span class="detailAttributeLabel">Surface</span><span class="detailAttributeValue">${trail.surface}</span></div>`
        : "",
      this.isMeaningful(trail.trailUse)
        ? `<div class="detailAttribute"><span class="detailAttributeLabel">Use</span><span class="detailAttributeValue">${trail.trailUse}</span></div>`
        : "",
      this.isMeaningful(trail.trailType)
        ? `<div class="detailAttribute"><span class="detailAttributeLabel">Type</span><span class="detailAttributeValue">${trail.trailType}</span></div>`
        : "",
      this.isMeaningful(trail.trailClass)
        ? `<div class="detailAttribute"><span class="detailAttributeLabel">Class</span><span class="detailAttributeValue">${trail.trailClass}</span></div>`
        : "",
    ].filter(Boolean);

    const sections = [
      primaryFacts.length
        ? `<div class="detailFacts detailFacts--primary">${primaryFacts.join("")}</div>`
        : "",
      attributeRows.length
        ? `<div class="detailFacts detailFacts--secondary">${attributeRows.join("")}</div>`
        : "",
    ].filter(Boolean);

    this.detailInfograph.innerHTML = sections.join("");
  }
}
