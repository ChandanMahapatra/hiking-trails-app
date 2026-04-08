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

import { State } from "../types";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

type RemovableHandle = { remove: () => void };

export default class ConnectionManager {
  private messageContainer: HTMLElement;
  private watchHandles: RemovableHandle[];
  private onlineStatusListener: () => void;
  private hideMessageTimeoutId: number | null;

  constructor(state: State) {
    this.watchHandles = [];
    this.hideMessageTimeoutId = null;
    this.onlineStatusListener = () => {
      state.online = navigator.onLine;
    };

    window.addEventListener("online", this.onlineStatusListener);
    window.addEventListener("offline", this.onlineStatusListener);
    this.onlineStatusListener();

    this.messageContainer = document.body.appendChild(
      document.createElement("div")
    );

    this.watchHandles.push(reactiveUtils.watch(() => state.online, (value) => {
      if (!value) {
        this.createOfflineMessage();
      } else {
        this.createOnlineMessage();
      }
    }));
  }

  destroy() {
    this.watchHandles.forEach((handle) => {
      handle.remove();
    });
    this.watchHandles = [];
    window.removeEventListener("online", this.onlineStatusListener);
    window.removeEventListener("offline", this.onlineStatusListener);
    if (this.hideMessageTimeoutId !== null) {
      window.clearTimeout(this.hideMessageTimeoutId);
      this.hideMessageTimeoutId = null;
    }
    this.messageContainer.remove();
  }

  createOfflineMessage() {
    this.setMessage(
      "You seem to be offline. This application has limited functionality.",
      false
    );
  }

  createOnlineMessage() {
    this.setMessage("You are back online.", true);
  }

  private setMessage(message: string, online: boolean): void {
    if (this.hideMessageTimeoutId !== null) {
      window.clearTimeout(this.hideMessageTimeoutId);
      this.hideMessageTimeoutId = null;
    }

    // display message
    this.messageContainer.textContent = message;
    this.messageContainer.classList.add("connectionMessage");

    if (online) {
      this.messageContainer.classList.add("online");
      this.messageContainer.classList.remove("offline");

      // message disappears after 3 seconds
      this.hideMessageTimeoutId = window.setTimeout(() => {
        this.messageContainer.textContent = "";
        this.messageContainer.classList.remove("online", "connectionMessage");
        this.hideMessageTimeoutId = null;
      }, 3000);
    } else {
      this.messageContainer.classList.remove("online");
      this.messageContainer.classList.add("offline");
    }
  }
}
