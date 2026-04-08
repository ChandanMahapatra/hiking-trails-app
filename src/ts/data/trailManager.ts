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

import Trail from "./Trail";
import * as intersectsOperator from "@arcgis/core/geometry/operators/intersectsOperator";

type DistanceUnit = "mi" | "km";

type InferredLayers = {
  trailsLayer: any;
  parksLayer: any;
  polygonLayers: any[];
};

type TrailFieldInfo = {
  objectIdField: string;
  difficultyField: string | null;
  categoryField: string | null;
  walktimeField: string | null;
  statusField: string | null;
  ascentField: string | null;
  lengthField: string | null;
  descriptionField: string | null;
  surfaceField: string | null;
  trailTypeField: string | null;
  trailClassField: string | null;
  trailUseField: string | null;
  seasonalDescriptionField: string | null;
  idField: string | null;
  nameField: string | null;
  alternateNameFields: string[];
  parkField: string | null;
  queryFields: string[];
};

type ParkFieldInfo = {
  objectIdField: string;
  idField: string | null;
  nameField: string | null;
  unitTypeField: string | null;
  queryFields: string[];
};

const layerFieldNamesCache = new WeakMap<object, string[]>();
const normalizedFieldNamesCache = new WeakMap<object, string[]>();
const trailParkFieldCache = new WeakMap<object, WeakMap<object, string | null>>();

function getLayerFieldNames(layer): string[] {
  if (!layer || typeof layer !== "object") {
    return [];
  }

  const cached = layerFieldNamesCache.get(layer);
  if (cached) {
    return cached;
  }

  const fieldNames = (layer.fields || []).map((field) => String(field.name || ""));
  layerFieldNamesCache.set(layer, fieldNames);
  normalizedFieldNamesCache.set(
    layer,
    fieldNames.map((fieldName) => fieldName.toLowerCase())
  );
  return fieldNames;
}

function getNormalizedFieldNames(layer): string[] {
  if (!layer || typeof layer !== "object") {
    return [];
  }

  const cached = normalizedFieldNamesCache.get(layer);
  if (cached) {
    return cached;
  }

  getLayerFieldNames(layer);
  return normalizedFieldNamesCache.get(layer) || [];
}

function compactFieldNames(fieldNames: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      fieldNames.filter((fieldName): fieldName is string => {
        return Boolean(fieldName && String(fieldName).trim());
      })
    )
  );
}

function getFeatureLayers(source) {
  const allLayers = source?.allLayers || source?.map?.allLayers;
  if (!allLayers) {
    return [];
  }

  return allLayers
    .filter((layer) => layer.type === "feature")
    .toArray();
}

function scoreLayer(layer, geometryType, titlePattern, fieldPattern) {
  if (layer.geometryType !== geometryType) {
    return -1;
  }

  let score = 0;
  const title = String(layer.title || "").toLowerCase();
  const url = String(layer.url || "").toLowerCase();
  const displayField = String(layer.displayField || "").toLowerCase();
  const fieldNames = getNormalizedFieldNames(layer);

  if (titlePattern.test(title)) {
    score += 8;
  }
  if (titlePattern.test(url)) {
    score += 4;
  }
  if (fieldPattern.test(displayField)) {
    score += 2;
  }
  score += Math.min(fieldNames.filter((name) => fieldPattern.test(name)).length, 4);

  if (geometryType === "polygon") {
    const hasUnitCode = fieldNames.some((name) => name === "unit_code");
    const hasUnitType = fieldNames.some((name) => name === "unit_type");
    const isAdministrativeBoundary = /administrative boundaries|nps boundary|boundary/.test(title);
    const isBroadLandsLayer = /federal lands|park service lands|public lands/.test(title);

    if (hasUnitCode) score += 8;
    if (hasUnitType) score += 6;
    if (isAdministrativeBoundary) score += 6;
    if (!hasUnitCode) score -= 4;
    if (isBroadLandsLayer && !hasUnitCode) score -= 6;
  }

  if (geometryType === "polyline") {
    if (fieldNames.some((name) => name === "unitcode")) score += 6;
  }

  return score;
}

function selectBestLayer(featureLayers, geometryType, titlePattern, fieldPattern) {
  const candidates = featureLayers
    .map((layer) => ({
      layer,
      score: scoreLayer(layer, geometryType, titlePattern, fieldPattern),
    }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.layer || null;
}

export function inferLayersFromMap(source): InferredLayers {
  const featureLayers = getFeatureLayers(source);
  if (!featureLayers.length) {
    return { trailsLayer: null, parksLayer: null, polygonLayers: [] };
  }

  const trailsLayer =
    selectBestLayer(
      featureLayers,
      "polyline",
      /trail|route|hike/i,
      /trail|route|hike|path|name|id/
    ) || featureLayers.find((layer) => layer.geometryType === "polyline") || null;

  const parksLayer =
    selectBestLayer(
      featureLayers,
      "polygon",
      /administrative boundaries|boundary|park|reserve|national/i,
      /park|boundary|reserve|unit|name|id/
    ) || featureLayers.find((layer) => layer.geometryType === "polygon") || null;

  return {
    trailsLayer,
    parksLayer,
    polygonLayers: featureLayers.filter((layer) => layer.geometryType === "polygon"),
  };
}

function getFieldNameByPriority(
  fieldNames: string[],
  priorities: string[],
  normalizedFieldNames?: string[]
) {
  const normalized = normalizedFieldNames || fieldNames.map((fieldName) => fieldName.toLowerCase());
  for (const key of priorities) {
    const index = normalized.findIndex((name) => name.includes(key));
    if (index !== -1) {
      return fieldNames[index];
    }
  }
  return null;
}

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferLengthUnit(fieldName: string | null): DistanceUnit | null {
  if (!fieldName) {
    return null;
  }

  const normalized = fieldName.toLowerCase();
  if (/trlmiles|miles|mile|(^|_)mi($|_)|\bmi\b/.test(normalized)) {
    return "mi";
  }

  if (/kilometers|kilometres|(^|_)km($|_)|\bkms?\b/.test(normalized)) {
    return "km";
  }

  return null;
}

function toEntityId(value: any): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && /^-?\d+(\.\d+)?$/.test(normalized)
    ? parsed
    : normalized;
}

function normalizeLabel(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function isMeaningfulValue(value: any): boolean {
  const normalized = normalizeLabel(value);
  return Boolean(normalized) && normalized.toLowerCase() !== "unknown";
}

function getAlternateTrailNameFields(
  fieldNames: string[],
  normalizedFieldNames: string[],
  primaryNameField: string | null
): string[] {
  const genericLocationNameFields = new Set([
    "unitname",
    "parkname",
    "groupname",
    "regionname",
    "statename",
  ]);
  const alternateFieldPriorities = [
    "maplabel",
    "label",
    "trail",
    "route",
    "path",
    "title",
    "altlangname",
    "altname",
    "name",
  ];

  const alternateNameFields: string[] = [];

  for (const key of alternateFieldPriorities) {
    const fieldName = fieldNames.find((candidate, index) => {
      const normalized = normalizedFieldNames[index];
      if (genericLocationNameFields.has(normalized)) {
        return false;
      }
      return normalized.includes(key);
    });

    if (fieldName && fieldName !== primaryNameField && !alternateNameFields.includes(fieldName)) {
      alternateNameFields.push(fieldName);
    }
  }

  return alternateNameFields;
}

function inferTrailName(
  attributes: Record<string, any>,
  primaryNameField: string | null,
  alternateNameFields: string[],
  objectIdValue: any
): string {
  const primaryLabel = normalizeLabel(
    primaryNameField ? attributes[primaryNameField] : null
  );
  if (primaryLabel) {
    return primaryLabel;
  }

  for (const fieldName of alternateNameFields) {
    const label = normalizeLabel(fieldName ? attributes[fieldName] : null);
    if (label) {
      return label;
    }
  }

  return `Trail ${objectIdValue}`;
}

async function queryAllFeatures(layer, options) {
  const objectIdField = layer.objectIdField;
  const maxRecordCount = Math.max(
    Number(layer?.capabilities?.query?.maxRecordCount) || 1000,
    200
  );

  try {
    const count = await layer.queryFeatureCount({ where: options.where || "1=1" });
    if (!Number.isFinite(count) || count <= maxRecordCount) {
      return layer.queryFeatures(options);
    }

    const queryOptions = {
      ...options,
      start: 0,
      num: maxRecordCount,
      orderByFields: objectIdField ? [`${objectIdField} ASC`] : undefined,
    };

    const allFeatures = [];
    let start = 0;
    while (start < count) {
      const result = await layer.queryFeatures({
        ...queryOptions,
        start,
      });
      if (!result.features.length) {
        break;
      }
      allFeatures.push(...result.features);
      start += result.features.length;
    }

    return {
      ...({} as any),
      features: allFeatures,
    };
  } catch {
    return layer.queryFeatures(options);
  }
}

export function getTrailParkField(layer, parkLayer) {
  if (!layer) {
    return null;
  }

  if (parkLayer && typeof layer === "object" && typeof parkLayer === "object") {
    let parkFieldCache = trailParkFieldCache.get(layer);
    if (!parkFieldCache) {
      parkFieldCache = new WeakMap<object, string | null>();
      trailParkFieldCache.set(layer, parkFieldCache);
    }

    if (parkFieldCache.has(parkLayer)) {
      return parkFieldCache.get(parkLayer) ?? null;
    }

    const resolvedField = resolveTrailParkField(layer, parkLayer);
    parkFieldCache.set(parkLayer, resolvedField);
    return resolvedField;
  }

  return resolveTrailParkField(layer, parkLayer);
}

function resolveTrailParkField(layer, parkLayer) {
  const fieldNames = getLayerFieldNames(layer);
  const parkObjectIdField = String(parkLayer?.objectIdField || "").toLowerCase();
  const parkDisplayField = String(parkLayer?.displayField || "").toLowerCase();

  const preferred = [
    "parkid",
    "park_id",
    "unitcode",
    "unit_code",
    "unitid",
    "unit_id",
    "nps",
    "parkcode",
  ];

  for (const key of preferred) {
    const exact = fieldNames.find((name) => name.toLowerCase() === key);
    if (exact) {
      return exact;
    }
  }

  const contains = fieldNames.find((name) => {
    const normalized = name.toLowerCase();
    if (!/park|unit/.test(normalized)) {
      return false;
    }
    return /id|code/.test(normalized);
  });
  if (contains) {
    return contains;
  }

  const objectIdMatch = fieldNames.find((name) => name.toLowerCase() === parkObjectIdField);
  if (objectIdMatch) {
    return objectIdMatch;
  }

  const displayMatch = fieldNames.find((name) => name.toLowerCase() === parkDisplayField);
  if (displayMatch) {
    return displayMatch;
  }

  return null;
}

function buildTrailFieldInfo(layer, parkLayer): TrailFieldInfo {
  const fieldNames = getLayerFieldNames(layer);
  const normalizedFieldNames = getNormalizedFieldNames(layer);
  const objectIdField = layer.objectIdField;
  const difficultyField = getFieldNameByPriority(fieldNames, ["difficulty"], normalizedFieldNames);
  const categoryField = getFieldNameByPriority(fieldNames, ["category", "type"], normalizedFieldNames);
  const walktimeField = getFieldNameByPriority(fieldNames, ["walktime", "time", "duration"], normalizedFieldNames);
  const statusField = getFieldNameByPriority(fieldNames, ["trlstatus", "status", "access", "open"], normalizedFieldNames);
  const ascentField = getFieldNameByPriority(fieldNames, ["ascent", "gain", "elevation"], normalizedFieldNames);
  const lengthField = getFieldNameByPriority(
    fieldNames,
    ["trlmiles", "miles", "mile", "kilometers", "kilometres", "km", "distance", "length"],
    normalizedFieldNames
  );
  const descriptionField = getFieldNameByPriority(fieldNames, ["description", "desc", "info"], normalizedFieldNames);
  const surfaceField = getFieldNameByPriority(fieldNames, ["trlsurface", "surface"], normalizedFieldNames);
  const trailTypeField = getFieldNameByPriority(fieldNames, ["trltype", "type"], normalizedFieldNames);
  const trailClassField = getFieldNameByPriority(fieldNames, ["trlclass", "class"], normalizedFieldNames);
  const trailUseField = getFieldNameByPriority(fieldNames, ["trluse", "use"], normalizedFieldNames);
  const seasonalDescriptionField = getFieldNameByPriority(fieldNames, ["seasdesc", "season"], normalizedFieldNames);
  const idField =
    getFieldNameByPriority(fieldNames, ["routeid", "trailid", "id"], normalizedFieldNames) ||
    objectIdField;
  const nameField =
    getFieldNameByPriority(fieldNames, ["trail", "name", "route"], normalizedFieldNames) ||
    layer.displayField ||
    fieldNames[0] ||
    null;
  const alternateNameFields = getAlternateTrailNameFields(
    fieldNames,
    normalizedFieldNames,
    nameField
  );
  const parkField = getTrailParkField(layer, parkLayer);

  return {
    objectIdField,
    difficultyField,
    categoryField,
    walktimeField,
    statusField,
    ascentField,
    lengthField,
    descriptionField,
    surfaceField,
    trailTypeField,
    trailClassField,
    trailUseField,
    seasonalDescriptionField,
    idField,
    nameField,
    alternateNameFields,
    parkField,
    queryFields: compactFieldNames([
      objectIdField,
      difficultyField,
      categoryField,
      walktimeField,
      statusField,
      ascentField,
      lengthField,
      descriptionField,
      surfaceField,
      trailTypeField,
      trailClassField,
      trailUseField,
      seasonalDescriptionField,
      idField,
      nameField,
      parkField,
      ...alternateNameFields,
    ]),
  };
}

function inferTrailAttributes(fieldInfo: TrailFieldInfo, attributes) {
  const objectId = attributes[fieldInfo.objectIdField];
  const id = toNumber(attributes[fieldInfo.idField]) ?? objectId;
  const name = inferTrailName(attributes, fieldInfo.nameField, fieldInfo.alternateNameFields, objectId);

  return {
    objectId,
    id: toEntityId(attributes[fieldInfo.idField]) ?? objectId,
    name,
    parkId: toEntityId(fieldInfo.parkField ? attributes[fieldInfo.parkField] : null),
    difficulty: fieldInfo.difficultyField ? attributes[fieldInfo.difficultyField] : null,
    category: fieldInfo.categoryField ? attributes[fieldInfo.categoryField] : null,
    walktime: toNumber(fieldInfo.walktimeField ? attributes[fieldInfo.walktimeField] : null),
    status: fieldInfo.statusField ? attributes[fieldInfo.statusField] : null,
    ascent: toNumber(fieldInfo.ascentField ? attributes[fieldInfo.ascentField] : null),
    length: toNumber(fieldInfo.lengthField ? attributes[fieldInfo.lengthField] : null),
    lengthUnit: inferLengthUnit(fieldInfo.lengthField),
    description: fieldInfo.descriptionField ? attributes[fieldInfo.descriptionField] : null,
    surface: fieldInfo.surfaceField ? attributes[fieldInfo.surfaceField] : null,
    trailType: fieldInfo.trailTypeField ? attributes[fieldInfo.trailTypeField] : null,
    trailClass: fieldInfo.trailClassField ? attributes[fieldInfo.trailClassField] : null,
    trailUse: fieldInfo.trailUseField ? attributes[fieldInfo.trailUseField] : null,
    seasonalDescription: fieldInfo.seasonalDescriptionField
      ? attributes[fieldInfo.seasonalDescriptionField]
      : null,
  };
}

function buildParkFieldInfo(layer): ParkFieldInfo {
  const fieldNames = getLayerFieldNames(layer);
  const normalizedFieldNames = getNormalizedFieldNames(layer);
  const objectIdField = layer.objectIdField;
  const idField =
    getFieldNameByPriority(
      fieldNames,
      ["parkid", "unit_code", "unitcode", "unitid", "parkcode", "code", "id"],
      normalizedFieldNames
    ) || objectIdField;
  const nameField =
    getFieldNameByPriority(fieldNames, ["park", "unit", "name"], normalizedFieldNames) ||
    layer.displayField ||
    fieldNames[0] ||
    null;
  const unitTypeField = getFieldNameByPriority(
    fieldNames,
    ["unit_type", "unittype", "designation", "type"],
    normalizedFieldNames
  );

  return {
    objectIdField,
    idField,
    nameField,
    unitTypeField,
    queryFields: compactFieldNames([objectIdField, idField, nameField, unitTypeField]),
  };
}

function inferParkRecord(fieldInfo: ParkFieldInfo, feature) {
  const attributes = feature.attributes;

  return {
    objectId: attributes[fieldInfo.objectIdField],
    id: toEntityId(attributes[fieldInfo.idField]) ?? attributes[fieldInfo.objectIdField],
    name: String(attributes[fieldInfo.nameField] ?? `Park ${attributes[fieldInfo.objectIdField]}`),
    geometry: feature.geometry,
    unitType: fieldInfo.unitTypeField ? normalizeLabel(attributes[fieldInfo.unitTypeField]) : "",
  };
}

function filterNationalParks(parks) {
  const nationalParks = parks.filter((park) => {
    return normalizeLabel(park.unitType).toLowerCase() === "national parks";
  });

  const source = nationalParks.length > 0 ? nationalParks : parks;
  const uniqueParks = new Map();
  source.forEach((park) => {
    const key = String(park.id ?? park.objectId);
    if (!uniqueParks.has(key)) {
      uniqueParks.set(key, park);
    }
  });

  return Array.from(uniqueParks.values());
}

async function assignParksToTrails(trails, parks) {
  const parkIds = new Set(parks.map((park) => park.id));
  const parkObjectIds = new Set(parks.map((park) => park.objectId));
  const parksByObjectId = new Map<string, any>(
    parks.map((park) => {
      return [String(park.objectId), park];
    })
  );
  const indexedParks = parks.map((park) => {
    return {
      id: park.id,
      geometry: park.geometry,
      extent: park.geometry?.extent,
    };
  });

  trails.forEach((trail) => {
    if (trail.parkId !== null && parkIds.has(trail.parkId)) {
      return;
    }
    if (trail.parkId !== null && parkObjectIds.has(trail.parkId)) {
      const matchedPark = parksByObjectId.get(String(trail.parkId));
      trail.parkId = matchedPark?.id ?? null;
      return;
    }
    trail.parkId = null;
  });

  const unresolvedIndexes = trails
    .map((trail, index) => ({ trail, index }))
    .filter((entry) => {
      return entry.trail.parkId === null || !parkIds.has(entry.trail.parkId);
    })
    .map((entry) => entry.index);

  for (let i = 0; i < unresolvedIndexes.length; i++) {
    if (i > 0 && i % 25 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const trail = trails[unresolvedIndexes[i]];
    const trailExtent = trail.geometry?.extent;
    if (!trailExtent) {
      trail.parkId = null;
      continue;
    }

    const extentCandidates = indexedParks.filter((candidate) => {
      return candidate.extent?.intersects(trailExtent);
    });

    let matchedParkId = null;
    for (const candidate of extentCandidates) {
      try {
        const intersects = intersectsOperator.execute(
          candidate.geometry,
          trail.geometry
        );
        if (intersects) {
          matchedParkId = candidate.id;
          break;
        }
      } catch {
        // continue checking other candidates
      }
    }

    trail.parkId = matchedParkId;
  }
}

const trailManager = {
  initTrails: async (state) => {
    if (!state.trailsLayer || !state.parksLayer) {
      const inferred = inferLayersFromMap(state.view);
      state.trailsLayer = inferred.trailsLayer;
      state.parksLayer = inferred.parksLayer;
    }

    if (!state.trailsLayer || !state.parksLayer) {
      state.trails = [];
      state.parks = [];
      return;
    }

    const outSpatialReference =
      state.view?.spatialReference ||
      state.trailsLayer?.spatialReference ||
      state.parksLayer?.spatialReference;
    const trailFieldInfo = buildTrailFieldInfo(state.trailsLayer, state.parksLayer);
    const parkFieldInfo = buildParkFieldInfo(state.parksLayer);

    return Promise.all([
      queryAllFeatures(state.trailsLayer, {
        outFields: trailFieldInfo.queryFields,
        where: "1=1",
        returnGeometry: true,
        outSpatialReference,
      }),
      queryAllFeatures(state.parksLayer, {
        outFields: parkFieldInfo.queryFields,
        where: "1=1",
        returnGeometry: true,
        outSpatialReference,
      }),
    ])
      .then(async ([trailsResult, parksResult]) => {
        const parks = parksResult.features.map((feature) => {
          return inferParkRecord(parkFieldInfo, feature);
        });

        const trails = trailsResult.features.map((feature) => {
          feature.attributes.normalized = inferTrailAttributes(trailFieldInfo, feature.attributes);
          return new Trail(feature, state);
        });

        const sortedParks = filterNationalParks(parks).sort((a, b) => {
          return a.name.localeCompare(b.name);
        });
        const sortedTrails = trails.sort((a, b) => a.name.localeCompare(b.name));

        state.parks = sortedParks;
        state.trails = sortedTrails;

        await assignParksToTrails(sortedTrails, sortedParks);

        const withPark = sortedTrails.filter((t) => t.parkId !== null).length;
        console.info(
          `[trailManager] ${sortedParks.length} parks, ${sortedTrails.length} trails loaded, ${withPark} trails associated to a park`
        );

        state.trails = [...sortedTrails];
      })
      .catch((err) => {
        console.log(err);
        state.trails = [];
        state.parks = [];
      });
  },
};

export default trailManager;
