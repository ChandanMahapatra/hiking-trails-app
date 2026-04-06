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

import DetailPanel from "./DetailPanel";
import SelectionPanel from "./SelectionPanel";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { State } from "../types";

import "../../style/menu-panel.scss";

export default class MenuPanel {
  state: State;
  container: HTMLElement;
  loadingContainer: HTMLElement;
  loadingIndicator: HTMLElement;
  loadingMessage: HTMLElement;
  parkField: HTMLElement;
  trailField: HTMLElement;

  constructor(state: State) {
    this.state = state;
    this.container = <HTMLElement>document.querySelector(".menuPanel");
    this.loadingContainer = document.getElementById("selectionLoading");
    this.loadingIndicator = document.getElementById("selectionLoader");
    this.loadingMessage = document.getElementById("selectionLoadingMessage");
    this.parkField = document.getElementById("parkSelectLabel");
    this.trailField = document.getElementById("trailSelectLabel");

    new SelectionPanel(state);
    new DetailPanel(state);

    const syncLoadingState = () => {
      if (!this.loadingContainer || !this.loadingIndicator || !this.loadingMessage) {
        return;
      }

      const hasParks = (this.state.parks?.length || 0) > 0;
      const hasTrails = (this.state.trails?.length || 0) > 0;
      const isLoading = this.state.displayLoading;
      const showLoader = isLoading && !hasParks;
      const showEmptyState = !isLoading && !hasParks && !hasTrails;

      this.loadingContainer.hidden = !(showLoader || showEmptyState);
      this.loadingContainer.classList.toggle("is-empty", showEmptyState);
      this.loadingIndicator.toggleAttribute("hidden", !showLoader);
      this.parkField?.toggleAttribute("hidden", showLoader || showEmptyState);
      this.trailField?.toggleAttribute("hidden", showLoader || showEmptyState);
      this.loadingMessage.textContent = showLoader
        ? "Loading park and trail names..."
        : "Park and trail data is not available yet. Try reloading once the web map finishes loading.";
    };

    syncLoadingState();

    reactiveUtils.watch(
      () => ({
        loading: state.displayLoading,
        parkCount: state.parks?.length || 0,
        trailCount: state.trails?.length || 0,
      }),
      syncLoadingState
    );
  }
}
