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

import Polyline from "@arcgis/core/geometry/Polyline";
import State from "../State";
import { DistanceUnit, EntityId } from "../types";

export default class Trail {
  geometry: Polyline;
  state: State;
  objectId: EntityId;
  id: EntityId;
  name: string;
  parkId: EntityId | null;
  difficulty?: string;
  category?: string;
  walktime?: number;
  status?: string;
  ascent?: number;
  length?: number;
  lengthUnit?: DistanceUnit | null;
  description?: string;
  surface?: string;
  trailType?: string;
  trailClass?: string;
  trailUse?: string;
  seasonalDescription?: string;

  constructor(feature, state) {
    this.geometry = feature.geometry;
    this.state = state;
    const normalized = feature.attributes.normalized || {};
    this.objectId = normalized.objectId;
    this.id = normalized.id;
    this.name = normalized.name;
    this.parkId = normalized.parkId;
    this.difficulty = normalized.difficulty;
    this.category = normalized.category;
    this.walktime = normalized.walktime;
    this.status = normalized.status;
    this.ascent = normalized.ascent;
    this.length = normalized.length;
    this.lengthUnit = normalized.lengthUnit;
    this.description = normalized.description;
    this.surface = normalized.surface;
    this.trailType = normalized.trailType;
    this.trailClass = normalized.trailClass;
    this.trailUse = normalized.trailUse;
    this.seasonalDescription = normalized.seasonalDescription;
  }
}
