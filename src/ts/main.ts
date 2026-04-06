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

import "../style/reset.scss";
import "../style/style.scss";
import "@esri/calcite-components/main.css";
import { defineCustomElements } from "@esri/calcite-components/loader";

defineCustomElements(window);

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

const state = new State();
deviceUtils.init(state);
new ConnectionManager(state);
const sceneElement = new SceneElement(state);

let uiInitialized = false;

const initializeUi = async () => {
  state.displayLoading = true;

  if (!uiInitialized) {
    new MenuPanel(state);
    uiInitialized = true;
  }

  try {
    const maxAttempts = 20;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await trailManager.initTrails(state);
        if ((state.parks?.length || 0) > 0 && (state.trails?.length || 0) > 0) {
          return;
        }
      } catch (error) {
        console.warn(`Trail initialization attempt ${attempt} failed.`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.warn("Trail initialization completed without loaded park/trail data.");
  } finally {
    state.displayLoading = false;
  }
};

void initializeUi();

sceneElement.ready.catch((error) => {
  console.warn("Scene initialization failed, continuing with degraded behavior.", error);
});
