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

import { defineCustomElements } from "@esri/calcite-components/loader";
import { setAssetPath as setCommonComponentsAssetPath } from "@arcgis/common-components";
import { setAssetPath as setMapComponentsAssetPath } from "@arcgis/map-components";
import { setAssetPath as setCalciteAssetPath } from "@esri/calcite-components/dist/components";

import esriConfig from "@arcgis/core/config";
import config from "./config";
if ((config as any).apiKey) {
  esriConfig.apiKey = (config as any).apiKey;
}

import trailManager from "./data/trailManager";
import SceneElement from "./scene/SceneElement";
import State from "./State";
import ConnectionManager from "./ui/ConnectionManager";
import deviceUtils from "./ui/deviceUtils";
import MenuPanel from "./ui/MenuPanel";

const componentImporters = {
  "arcgis-basemap-gallery": () => import("@arcgis/map-components/components/arcgis-basemap-gallery"),
  "arcgis-compass": () => import("@arcgis/map-components/components/arcgis-compass"),
  "arcgis-expand": () => import("@arcgis/map-components/components/arcgis-expand"),
  "arcgis-home": () => import("@arcgis/map-components/components/arcgis-home"),
  "arcgis-legend": () => import("@arcgis/map-components/components/arcgis-legend"),
  "arcgis-map": () => import("@arcgis/map-components/components/arcgis-map"),
  "arcgis-navigation-toggle": () => import("@arcgis/map-components/components/arcgis-navigation-toggle"),
  "arcgis-scene": () => import("@arcgis/map-components/components/arcgis-scene"),
  "arcgis-zoom": () => import("@arcgis/map-components/components/arcgis-zoom"),
} as const;

type ArcgisComponentName = keyof typeof componentImporters;

const criticalMapComponents: ArcgisComponentName[] = [
  "arcgis-map",
  "arcgis-scene",
  "arcgis-home",
  "arcgis-zoom",
  "arcgis-compass",
  "arcgis-navigation-toggle",
  "arcgis-expand",
];
const deferredMapComponents: ArcgisComponentName[] = [
  "arcgis-basemap-gallery",
  "arcgis-legend",
];
const componentRegistrationPromises = new Map<ArcgisComponentName, Promise<unknown>>();

const registerMapComponents = async (componentNames: ArcgisComponentName[]) => {
  await Promise.all(
    componentNames.map((componentName) => {
      let registrationPromise = componentRegistrationPromises.get(componentName);
      if (!registrationPromise) {
        registrationPromise = componentImporters[componentName]();
        componentRegistrationPromises.set(componentName, registrationPromise);
      }

      return registrationPromise;
    })
  );
};

const configureComponentAssets = () => {
  setCalciteAssetPath(new URL("./calcite/", document.baseURI).toString());
  setCommonComponentsAssetPath(
    new URL("./arcgis/common-components/", document.baseURI).toString()
  );
  setMapComponentsAssetPath(
    new URL("./arcgis/map-components/", document.baseURI).toString()
  );
};

let destroyApp = () => {};

const sleep = (delayMs: number) => {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
};

const startApp = async () => {
  configureComponentAssets();
  defineCustomElements(window);
  await registerMapComponents(criticalMapComponents);

  const state = new State();
  deviceUtils.init(state);
  const connectionManager = new ConnectionManager(state);
  const sceneElement = new SceneElement(state);

  void registerMapComponents(deferredMapComponents).catch((error) => {
    console.warn("Deferred map component registration failed.", error);
  });

  let uiInitialized = false;
  let isDisposed = false;
  let menuPanel: MenuPanel | null = null;

  const initializeUi = async () => {
    if (isDisposed) {
      return;
    }

    state.displayLoading = true;

    if (!uiInitialized) {
      menuPanel = new MenuPanel(state);
      uiInitialized = true;
    }

    try {
      const maxAttempts = 8;
      let delayMs = 200;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await trailManager.initTrails(state);
          if (isDisposed) {
            return;
          }

          if ((state.parks?.length || 0) > 0 && (state.trails?.length || 0) > 0) {
            return;
          }
        } catch (error) {
          console.warn(`Trail initialization attempt ${attempt} failed.`, error);
        }

        if (attempt === maxAttempts) {
          break;
        }

        await sleep(delayMs);

        if (isDisposed) {
          return;
        }

        delayMs = Math.min(delayMs * 2, 1000);
      }

      console.warn("Trail initialization completed without loaded park/trail data.");
    } finally {
      state.displayLoading = false;
    }
  };

  destroyApp = () => {
    isDisposed = true;
    menuPanel?.destroy();
    menuPanel = null;
    connectionManager.destroy();
    sceneElement.destroy();
    deviceUtils.destroy();
  };

  void initializeUi();

  sceneElement.ready.catch((error) => {
    console.warn("Scene initialization failed, continuing with degraded behavior.", error);
  });
};

void startApp().catch((error) => {
  console.error("Application bootstrap failed.", error);
});

const hot = (import.meta as any).hot;
if (hot) {
  hot.dispose(() => {
    destroyApp();
  });
}
