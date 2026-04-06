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

import Accessor from "@arcgis/core/core/Accessor";
import {
  property,
  subclass,
} from "@arcgis/core/core/accessorSupport/decorators";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import { ArcGISView, Device, EntityId, Park, Trail, ViewMode } from "./types";

function idsEqual(
  a: EntityId | null | undefined,
  b: EntityId | null | undefined
): boolean {
  return (
    a !== null &&
    a !== undefined &&
    b !== null &&
    b !== undefined &&
    String(a) === String(b)
  );
}

@subclass()
export default class State extends Accessor {
  @property()
  displayLoading: boolean = true;

  @property()
  selectedTrailId: EntityId | null = null;

  @property()
  selectedTrail: Trail = null;

  setSelectedTrail(id: EntityId | null) {
    this.selectedTrailId = id;
    this.selectedTrail = this.trails?.filter((trail: Trail) => {
      return idsEqual(trail.id, id);
    })[0] || null;
  }

  @property()
  selectedParkId: EntityId | null = null;

  @property()
  selectedPark: Park = null;

  setSelectedPark(id: EntityId | null) {
    this.selectedParkId = id;
    this.selectedPark = this.parks?.filter((park: Park) => {
      return idsEqual(park.id, id);
    })[0] || null;

    if (
      id === null ||
      (this.selectedTrail && !idsEqual(this.selectedTrail.parkId, id))
    ) {
      this.selectedTrail = null;
      this.selectedTrailId = null;
    }
  }

  @property()
  device: Device = null;

  @property()
  viewMode: ViewMode = "3d";

  @property()
  view: ArcGISView = null;

  @property()
  trails: Array<Trail> = null;

  @property()
  parks: Array<Park> = null;

  @property()
  trailsLayer: FeatureLayer = null;

  @property()
  parksLayer: FeatureLayer = null;

  @property()
  online: boolean = true;
}
