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

import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { EntityId, State, Trail } from "../types";

type RemovableHandle = { remove: () => void };

type DomListenerRegistration = {
  target: EventTarget;
  type: string;
  listener: EventListener;
};

export default class SelectionPanel {
  parkSelect: HTMLElement;
  trailSelect: HTMLElement;
  modeSwitch: any;
  state: State;
  private suppressComboboxEvents: boolean;
  private watchHandles: RemovableHandle[];
  private domListeners: DomListenerRegistration[];
  private destroyed: boolean;
  private parkOptionsSignature: string;
  private trailOptionsSignature: string;

  constructor(state: State) {
    this.state = state;
    this.suppressComboboxEvents = false;
    this.watchHandles = [];
    this.domListeners = [];
    this.destroyed = false;
    this.parkOptionsSignature = "";
    this.trailOptionsSignature = "";
    this.parkSelect = document.getElementById("parkSelect");
    this.trailSelect = document.getElementById("trailSelect");
    this.modeSwitch = document.getElementById("viewModeToggle");

    void this.initializeComboboxes();

    this.addDomListener(this.parkSelect, "calciteComboboxChange", () => {
      if (this.suppressComboboxEvents) return;
      this.state.setSelectedPark(this.readSelectedId(this.parkSelect));
    });

    this.addDomListener(this.trailSelect, "calciteComboboxChange", () => {
      if (this.suppressComboboxEvents) return;
      this.state.setSelectedTrail(this.readSelectedId(this.trailSelect));
    });

    this.addDomListener(this.modeSwitch, "calciteSwitchChange", () => {
      this.state.viewMode = this.modeSwitch.checked ? "2d" : "3d";
    });

    this.addWatch(reactiveUtils.watch(() => state.selectedParkId, () => {
      this.withSuppressedComboboxEvents(() => {
        this.syncSelection(this.parkSelect, this.state.selectedParkId);
        this.populateTrailOptions();
      });
    }));

    this.addWatch(reactiveUtils.watch(() => state.parks, () => {
      this.withSuppressedComboboxEvents(() => {
        this.populateParkOptions();
        this.populateTrailOptions();
      });
    }));

    this.addWatch(reactiveUtils.watch(() => state.trails, () => {
      this.withSuppressedComboboxEvents(() => {
        this.populateTrailOptions();
      });
    }));

    this.addWatch(reactiveUtils.watch(() => state.selectedTrailId, () => {
      this.withSuppressedComboboxEvents(() => {
        this.syncSelection(this.trailSelect, this.state.selectedTrailId);
      });
    }));

    this.addWatch(reactiveUtils.watch(() => state.viewMode, (viewMode) => {
      if (this.modeSwitch) {
        this.modeSwitch.checked = viewMode === "2d";
      }
    }));
  }

  private addWatch(handle: RemovableHandle) {
    this.watchHandles.push(handle);
  }

  private addDomListener(target: EventTarget | null | undefined, type: string, listener: EventListener) {
    if (!target) {
      return;
    }

    target.addEventListener(type, listener);
    this.domListeners.push({ target, type, listener });
  }

  private async initializeComboboxes(): Promise<void> {
    await this.whenCalciteReady();
    if (this.destroyed || !this.parkSelect || !this.trailSelect) {
      return;
    }

    this.withSuppressedComboboxEvents(() => {
      this.populateParkOptions();
      this.populateTrailOptions();
    });
  }

  destroy() {
    this.destroyed = true;
    this.watchHandles.forEach((handle) => {
      handle.remove();
    });
    this.watchHandles = [];
    this.domListeners.forEach(({ target, type, listener }) => {
      target.removeEventListener(type, listener);
    });
    this.domListeners = [];
  }

  private withSuppressedComboboxEvents(callback: () => void) {
    if (this.destroyed) {
      return;
    }

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
    if (this.destroyed || !this.parkSelect) {
      return;
    }

    const parks = this.state.parks || [];
    const nextSignature = parks
      .map((park) => `${String(park.id)}:${String(park.name).trim()}`)
      .join("|");

    if (nextSignature !== this.parkOptionsSignature) {
      const items = parks.map((park) => {
        return this.createComboboxItem(park.id, park.name);
      });
      this.replaceItems(this.parkSelect, items);
      this.parkOptionsSignature = nextSignature;
    }

    this.syncSelection(this.parkSelect, this.state.selectedParkId);
    this.setDisabled(this.parkSelect, parks.length === 0);
  }

  private populateTrailOptions() {
    if (this.destroyed || !this.trailSelect) {
      return;
    }

    const trails = this.state.trails || [];
    const selectedParkId = this.state.selectedParkId;

    // Keep the trail combobox disabled until a park is selected so the
    // component isn't overwhelmed with thousands of items.
    if (selectedParkId === null || selectedParkId === undefined) {
      if (this.trailOptionsSignature !== "") {
        this.replaceItems(this.trailSelect, []);
        this.trailOptionsSignature = "";
      }
      this.setDisabled(this.trailSelect, true);
      return;
    }

    const filtered = trails
      .filter((t) => String(t.parkId) === String(selectedParkId))
      .slice()
      .sort((a, b) => {
        const nameCompare = this.getBaseTrailLabel(a).localeCompare(this.getBaseTrailLabel(b));
        if (nameCompare !== 0) {
          return nameCompare;
        }
        return this.compareEntityIds(a.objectId ?? a.id, b.objectId ?? b.id);
      });
    const optionLabels = this.buildTrailOptionLabels(filtered);

    const nextSignature = filtered
      .map((trail) => {
        const trailLabel = optionLabels.get(this.getTrailOptionKey(trail)) || this.getBaseTrailLabel(trail);
        return `${String(trail.id)}:${this.getTrailOptionKey(trail)}:${trailLabel}`;
      })
      .join("|");

    if (nextSignature !== this.trailOptionsSignature) {
      const items = filtered.map((trail) => {
        const trailLabel = optionLabels.get(this.getTrailOptionKey(trail)) || this.getBaseTrailLabel(trail);
        return this.createComboboxItem(trail.id, trailLabel);
      });
      this.replaceItems(this.trailSelect, items);
      this.trailOptionsSignature = nextSignature;
    }

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

  private getBaseTrailLabel(trail: Trail) {
    return String(trail.name || "").trim() || `Trail ${trail.id}`;
  }

  private getTrailOptionKey(trail: Trail) {
    return String(trail.objectId ?? trail.id);
  }

  private compareEntityIds(
    left: EntityId | null | undefined,
    right: EntityId | null | undefined
  ) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const leftIsNumber = Number.isFinite(leftNumber) && String(left).trim() !== "";
    const rightIsNumber = Number.isFinite(rightNumber) && String(right).trim() !== "";

    if (leftIsNumber && rightIsNumber) {
      return leftNumber - rightNumber;
    }

    return String(left ?? "").localeCompare(String(right ?? ""));
  }

  private buildTrailOptionLabels(trails: Trail[]) {
    const groupedTrails = new Map<string, Trail[]>();
    const labels = new Map<string, string>();

    trails.forEach((trail) => {
      const labelKey = this.getBaseTrailLabel(trail).toLowerCase();
      const existing = groupedTrails.get(labelKey) || [];
      existing.push(trail);
      groupedTrails.set(labelKey, existing);
    });

    groupedTrails.forEach((group) => {
      if (group.length === 1) {
        const trail = group[0];
        labels.set(this.getTrailOptionKey(trail), this.getBaseTrailLabel(trail));
        return;
      }

      const displayBaseLabel = this.getBaseTrailLabel(group[0]);
      group.forEach((trail, index) => {
        labels.set(
          this.getTrailOptionKey(trail),
          `${displayBaseLabel} (${index + 1} of ${group.length})`
        );
      });
    });

    return labels;
  }

  /** Set the `selected` JS property on the matching item; clear all others. */
  private syncSelection(combobox: HTMLElement, selectedId: EntityId | null) {
    if (this.destroyed || !combobox) {
      return;
    }

    const target = selectedId === null ? null : String(selectedId);
    combobox.querySelectorAll("calcite-combobox-item").forEach((item: any) => {
      const itemValue = item.value ?? item.getAttribute("value");
      item.selected = target !== null && String(itemValue) === target;
    });
  }

  private replaceItems(combobox: HTMLElement, items: HTMLElement[]) {
    if (!combobox) {
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      fragment.appendChild(item);
    });
    combobox.replaceChildren(fragment);

    // Clear Calcite's internal value so the previous chip/text is not retained.
    (combobox as any).value = "";
  }
}
