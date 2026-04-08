import Accessor from "@arcgis/core/core/Accessor";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

export type Device = "mobilePortrait" | "desktop";
export type ViewMode = "3d" | "2d";
export type ArcGISView = SceneView | MapView;
export type EntityId = string | number;
export type DistanceUnit = "mi" | "km";

export interface State extends Accessor {
  displayLoading: boolean;
  selectedTrailId: EntityId | null;
  setSelectedTrail: (id: EntityId | null) => void;
  selectedParkId: EntityId | null;
  setSelectedPark: (id: EntityId | null) => void;
  selectedTrail: Trail;
  selectedPark: Park;
  device: Device;
  viewMode: ViewMode;
  view: ArcGISView | null;
  trails: Array<Trail>;
  parks: Array<Park>;
  trailsLayer: FeatureLayer | null;
  parksLayer: FeatureLayer | null;
  online: boolean;
}

export interface Trail {
  geometry: Polyline;
  objectId: EntityId;
  name: string;
  parkId: EntityId | null;
  id: EntityId;
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
}

export interface Park {
  geometry: Polygon;
  objectId: EntityId;
  id: EntityId;
  name: string;
  unitType?: string;
}
