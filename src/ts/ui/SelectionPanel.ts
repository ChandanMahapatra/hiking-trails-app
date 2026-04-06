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

import "../../style/selection-panel.scss";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { EntityId, State } from "../types";

export default class SelectionPanel {
  parkSelect: HTMLElement;
  trailSelect: HTMLElement;
  modeSwitch: any;
  state: State;
  private suppressComboboxEvents: boolean;

  constructor(state: State) {
    this.state = state;
    this.suppressComboboxEvents = false;
    this.parkSelect = document.getElementById("parkSelect");
    this.trailSelect = document.getElementById("trailSelect");
    this.modeSwitch = document.getElementById("viewModeToggle");

    const initializeComboboxes = () => {
      if (!this.parkSelect || !this.trailSelect) {
        return;
      }
      this.withSuppressedComboboxEvents(() => {
        this.populateParkOptions();
        this.populateTrailOptions();
      });
    };

    queueMicrotask(initializeComboboxes);
    window.setTimeout(initializeComboboxes, 0);
    window.setTimeout(initializeComboboxes, 500);
    this.whenCalciteReady().then(initializeComboboxes);

    this.parkSelect.addEventListener("calciteComboboxChange", () => {
      if (this.suppressComboboxEvents) return;
      this.state.setSelectedPark(this.readSelectedId(this.parkSelect));
    });

    this.trailSelect.addEventListener("calciteComboboxChange", () => {
      if (this.suppressComboboxEvents) return;
      this.state.setSelectedTrail(this.readSelectedId(this.trailSelect));
    });

    this.modeSwitch?.addEventListener("calciteSwitchChange", () => {
      this.state.viewMode = this.modeSwitch.checked ? "2d" : "3d";
    });

    reactiveUtils.watch(() => state.selectedParkId, () => {
      this.withSuppressedComboboxEvents(() => {
        this.syncSelection(this.parkSelect, this.state.selectedParkId);
        this.populateTrailOptions();
      });
    });

    reactiveUtils.watch(() => state.parks, () => {
      this.withSuppressedComboboxEvents(() => {
        this.populateParkOptions();
        this.populateTrailOptions();
      });
    });

    reactiveUtils.watch(() => state.trails, () => {
      this.withSuppressedComboboxEvents(() => {
        this.populateTrailOptions();
      });
    });

    reactiveUtils.watch(() => state.selectedTrailId, () => {
      this.withSuppressedComboboxEvents(() => {
        this.syncSelection(this.trailSelect, this.state.selectedTrailId);
      });
    });

    reactiveUtils.watch(() => state.viewMode, (viewMode) => {
      if (this.modeSwitch) {
        this.modeSwitch.checked = viewMode === "2d";
      }
    });
  }

  private withSuppressedComboboxEvents(callback: () => void) {
    this.suppressComboboxEvents = true;
    try {
      callback();
    } finally {
      this.suppressComboboxEvents = false;
    }
  }

  /** Defer until calcite-combobox-item custom element is registered. */
  private async whenCalciteReady(): Promise<void> {
    if (!customElements.get("calcite-combobox-item")) {
      await customElements.whenDefined("calcite-combobox-item");
    }
  }

  private populateParkOptions() {
    const parks = this.state.parks || [];
    this.removeAllItems(this.parkSelect);

    parks.forEach((park) => {
      this.parkSelect.appendChild(this.createComboboxItem(park.id, park.name));
    });

    this.syncSelection(this.parkSelect, this.state.selectedParkId);
    this.setDisabled(this.parkSelect, parks.length === 0);
  }

  private populateTrailOptions() {
    const trails = this.state.trails || [];
    const selectedParkId = this.state.selectedParkId;

    // Keep the trail combobox disabled until a park is selected so the
    // component isn't overwhelmed with thousands of items.
    if (selectedParkId === null || selectedParkId === undefined) {
      this.removeAllItems(this.trailSelect);
      this.setDisabled(this.trailSelect, true);
      return;
    }

    const filtered = trails.filter((t) => String(t.parkId) === String(selectedParkId));

    this.removeAllItems(this.trailSelect);

    filtered.forEach((trail) => {
      const trailLabel = String(trail.name || "").trim() || `Trail ${trail.id}`;
      this.trailSelect.appendChild(this.createComboboxItem(trail.id, trailLabel));
    });

    this.setDisabled(this.trailSelect, filtered.length === 0);

    // Deselect an active trail that is no longer in the current list.
    if (
      this.state.selectedTrailId !== null &&
      !filtered.some((t) => String(t.id) === String(this.state.selectedTrailId))
    ) {
      this.state.setSelectedTrail(null);
    }

    this.syncSelection(this.trailSelect, this.state.selectedTrailId);
  }

  /** Use attribute-based disabled so Calcite reflects the state correctly. */
  private setDisabled(combobox: HTMLElement, disabled: boolean) {
    (combobox as any).disabled = disabled;
    if (disabled) {
      combobox.setAttribute("disabled", "");
    } else {
      combobox.removeAttribute("disabled");
    }
  }

  /** Read the currently selected combobox item's value as a string/number or null. */
  private readSelectedId(combobox: HTMLElement): EntityId | null {
    const selected = (combobox as any).selectedItems as any[] | undefined;
    const comboboxValue = (combobox as any).value;

    if (!selected || selected.length === 0) {
      if (comboboxValue === null || comboboxValue === undefined || comboboxValue === "") {
        return null;
      }
      return comboboxValue;
    }

    const raw = selected[0].value ?? selected[0].getAttribute("value") ?? comboboxValue;
    if (!raw && raw !== 0) return null;
    return raw;
  }

  private createComboboxItem(id: EntityId, label: string) {
    const item = document.createElement("calcite-combobox-item") as any;
    const normalizedLabel = String(label).trim() || `Trail ${id}`;

    item.setAttribute("value", String(id));
    item.setAttribute("heading", normalizedLabel);
    item.setAttribute("label", normalizedLabel);
    item.value = String(id);
    item.heading = normalizedLabel;
    item.label = normalizedLabel;

    return item;
  }

  /** Set the `selected` JS property on the matching item; clear all others. */
  private syncSelection(combobox: HTMLElement, selectedId: EntityId | null) {
    const target = selectedId === null ? null : String(selectedId);
    combobox.querySelectorAll("calcite-combobox-item").forEach((item: any) => {
      const itemValue = item.value ?? item.getAttribute("value");
      item.selected = target !== null && String(itemValue) === target;
    });
  }

  /** Remove child items and reset the combobox's internal shadow-DOM state. */
  private removeAllItems(combobox: HTMLElement) {
    const items = Array.from(combobox.querySelectorAll("calcite-combobox-item"));
    items.forEach((item) => combobox.removeChild(item));
    // Clear Calcite's internal value so the previous chip/text is not retained.
    (combobox as any).value = "";
  }
}
