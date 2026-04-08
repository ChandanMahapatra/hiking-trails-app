/* This app can be configured by changing the variables
in this file.

Webscene:
 - copy the webscene that I use: http://www.arcgis.com/home/item.html?id=d0580bb5df3840d384bda44b6ddeb54e
 - remove/add layers with additional data in the Layers group
 - remove/add basemap layers in the Basemap group

Data:
 - replace the trails service url
 - replace the attribute names to the ones in your service
 - remove attributes if they don't make sense for your data
 - Status has hard-coded values Open/Closed (whether the track is open or closed)
 - filterOptions are the attributes that will be used for filtering
    they can be removed in case they are not useful

Colors:
 - change the colors for visualizing the trails
 - keep UI styling aligned with the document-level CSS files in src/style/
*/

export default {
  scene: {
    webmapItemId: "5a94b21ff6e94d10ae61483c392bbf9b"
  },
  view: {
    startupViewpoint: {
      targetGeometry: {
        type: "point",
        longitude: -98.5795,
        latitude: 39.8283,
        spatialReference: { wkid: 4326 }
      },
      scale: 20000000
    },
    basemaps: {
      "3d": {
        defaultId: "topo-3d",
        sourceIds: ["topo-3d", "navigation-3d", "hybrid", "satellite"]
      },
      "2d": {
        defaultId: "topo-vector",
        sourceIds: ["topo-vector", "streets-navigation-vector", "hybrid", "satellite"]
      }
    }
  },
  selection: {
    parkOutlineWidth: 4,
    parkOutlineMutedWidth: 2,
    parkOutlineMutedOpacity: 0.4,
    trailSourceSelectionOffset3d: 14,
    trailSourceSelectionWidth3d: 4,
    trailSourceSelectionWidth2d: 2,
    trailWallWidth: 3,
    trailWallDefaultHeight: 10,
    trailWallMinHeight: 6,
    trailWallMaxHeight: 18,
    trailWallHeightMultiplier: 0.025
  },
  colors: {
    defaultTrail: "#db5353",
    selectedTrail: "#f9a352",
    selectedParkFill: [0, 0, 0, 0],
    selectedParkOutline: "#4da1ff"
  }
};
