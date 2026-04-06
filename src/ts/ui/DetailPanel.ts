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

import ElevationProfile from "@arcgis/core/widgets/ElevationProfile";
import ElevationProfileLineGround from "@arcgis/core/widgets/ElevationProfile/ElevationProfileLineGround";
import Graphic from "@arcgis/core/Graphic";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import config from "../config";
import { State, Trail } from "../types";

import "../../style/detail-panel.scss";

export default class SelectionPanel {
  state: State;
  container: HTMLElement;
  detailTitle: HTMLElement;
  detailInfograph: HTMLElement;
  detailElevationProfile: HTMLElement;
  detailDescription: HTMLElement;
  elevationProfile: ElevationProfile | null;
  private profileRequestId: number;

  constructor(state: State) {
    this.state = state;
    this.container = document.getElementById("detailPanel");
    this.detailTitle = document.getElementById("detailTitle");
    this.detailInfograph = document.getElementById("detailInfograph");
    this.detailDescription = document.getElementById("detailDescription");
    this.detailElevationProfile = document.getElementById(
      "detailElevationProfile"
    );
    this.profileRequestId = 0;

    this.emptyDetails();

    reactiveUtils.watch(
      () => ({
        selectedTrailId: state.selectedTrailId,
        view: state.view,
      }),
      () => {
        void this.refreshSelectedTrail();
      }
    );

    reactiveUtils.watch(() => state.device, () => {
      if (
        this.state.selectedTrailId === null ||
        this.state.selectedTrailId === undefined
      ) {
        this.displayAppInfo();
      }
    });
  }

  emptyDetails() {
    this.detailTitle.textContent = "";
    this.detailDescription.textContent = "";
    this.detailInfograph.innerHTML = "";
    this.detailElevationProfile.textContent = "";

    this.displayAppInfo();
  }

  displayAppInfo() {
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

  private async refreshSelectedTrail() {
    const requestId = ++this.profileRequestId;
    const trail = this.state.selectedTrail;

    this.emptyDetails();
    this.destroyElevationProfile();

    if (!trail) {
      return;
    }

    this.displayInfo(trail);
    await this.createElevationProfile(trail, requestId);
  }

  displayInfo(trail: Trail): void {
    this.detailTitle.textContent = trail.name;
    this.createInfograph(trail);
    const description = [trail.description, trail.seasonalDescription].find((value) => {
      return this.isMeaningful(value);
    });

    this.detailDescription.textContent = description
      ? String(description).trim()
      : "Trail details are limited for this segment. Use the live elevation profile and map context for additional information.";
  }

  private destroyElevationProfile() {
    if (this.elevationProfile) {
      this.elevationProfile.destroy();
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
    this.detailElevationProfile.textContent = "";
    const view = this.state.view;
    const inputGraphic = this.createProfileInputGraphic(trail);

    if (!view || !inputGraphic) {
      this.detailElevationProfile.textContent =
        "Elevation profile is unavailable for the current trail selection.";
      return;
    }

    try {
      await view.when();
    } catch {
      this.detailElevationProfile.textContent =
        "Elevation profile is still loading. Try the selection again once the map finishes initializing.";
      return;
    }

    if (
      requestId !== this.profileRequestId ||
      trail !== this.state.selectedTrail ||
      view !== this.state.view
    ) {
      return;
    }

    const container = document.createElement("div");
    this.detailElevationProfile.replaceChildren(container);

    try {
      const elevationProfile = new ElevationProfile({
        view,
        input: inputGraphic,
        container,
        profiles: [
          new ElevationProfileLineGround({
            title: "Trail statistics",
            color: config.colors.selectedTrail,
          }),
        ],
        visibleElements: {
          selectButton: false,
          sketchButton: false,
        },
      });

      await elevationProfile.when();

      if (
        requestId !== this.profileRequestId ||
        trail !== this.state.selectedTrail ||
        view !== this.state.view
      ) {
        elevationProfile.destroy();
        return;
      }

      this.elevationProfile = elevationProfile;
    } catch (error) {
      console.warn("Elevation profile could not be created for the selected trail.", error);
      container.remove();
      this.destroyElevationProfile();
      this.detailElevationProfile.textContent =
        "Elevation profile could not be created for this trail.";
    }
  }

  createInfograph(trail) {
    const status = {
      Closed: {
        icon: "fa fa-calendar-times-o",
        text: "Closed",
      },
      Open: {
        icon: "fa fa-calendar-check-o",
        text: "Open",
      },
    };
    const statusInfo = status[trail.status] || null;
    const primaryFacts = [
      trail.ascent
        ? `<span class="infograph"><span class="fa fa-line-chart" aria-hidden="true"></span> ${trail.ascent} m</span>`
        : "",
      this.isMeaningful(trail.difficulty)
        ? `<span class="infograph"><span class="fa fa-wrench" aria-hidden="true"></span> ${trail.difficulty}</span>`
        : "",
      trail.walktime
        ? `<span class="infograph"><span class="fa fa-clock-o" aria-hidden="true"></span> ${trail.walktime} hr</span>`
        : "",
      trail.status && statusInfo
        ? `<span class="infograph"><span class="${statusInfo.icon}" aria-hidden="true"></span> ${statusInfo.text}</span>`
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
