document.addEventListener("DOMContentLoaded", function () {
  // 检查map和L是否存在
  if (typeof L === "undefined" || typeof map === "undefined") {
    alert("依赖库加载失败，请检查脚本是否正常执行！");
    return;
  }

  // ========== 防抖函数 + 全局缩放锁 ==========
  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  let isMapZooming = false;
  const optimizedFitBounds = debounce(function (bounds, options) {
    if (isMapZooming || !bounds) return;
    isMapZooming = true;
    map.fitBounds(bounds, {
      ...options,
      animate: false,
      duration: 200,
      maxZoom: 18,
    });
    setTimeout(() => {
      isMapZooming = false;
    }, options.duration || 200);
  }, 100);

  // ========== 面板交互逻辑 ==========
  const layerTrigger = document.getElementById("layerTrigger");
  const layerPanel = document.getElementById("layerPanel");
  // 全选复选框DOM引用
  let selectAllCheckbox = null;

  if (layerTrigger && layerPanel) {
    layerTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      layerPanel.classList.toggle("active");
    });
    document.addEventListener("click", (e) => {
      if (
        layerPanel.classList.contains("active") &&
        !layerPanel.contains(e.target) &&
        !layerTrigger.contains(e.target)
      ) {
        layerPanel.classList.remove("active");
      }
    });
    layerPanel.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // ========== 新增：创建全选复选框（放到标题前） ==========
    // 1. 获取原标题元素
    const titleH3 = layerPanel.querySelector("h3");
    if (titleH3) {
      // 2. 重新布局标题容器：复选框 + 标题文字
      const titleContainer = document.createElement("div");
      titleContainer.style.display = "flex";
      titleContainer.style.alignItems = "center";
      titleContainer.style.padding = "0 10px";
      titleContainer.style.margin = "10px 0";

      // 3. 创建全选复选框（无标签文字）
      selectAllCheckbox = document.createElement("input");
      selectAllCheckbox.type = "checkbox";
      selectAllCheckbox.id = "selectAllLayers";
      selectAllCheckbox.style.marginRight = "8px"; // 复选框和文字间距
      selectAllCheckbox.style.cursor = "pointer";

      // 4. 绑定全选复选框事件
      selectAllCheckbox.addEventListener("change", function () {
        if (this.checked) {
          selectAllLayers(); // 勾选：全开
        } else {
          unselectAllLayers(); // 取消：全关
        }
      });

      // 5. 重构标题结构：移除原h3，新建容器包含复选框+文字
      const titleText = document.createTextNode(titleH3.textContent);
      layerPanel.removeChild(titleH3);
      titleContainer.appendChild(selectAllCheckbox);
      titleContainer.appendChild(titleText);
      layerPanel.insertBefore(titleContainer, layerPanel.firstChild);
    }
  }

  // ========== GeoJSON配置项 ==========
  const geoJsonLayers = [
    { name: "全球洋壳GlobalOceanicCrust", file: "1GlobalOceanicCrust.json" },
    { name: "大洋域OceanDomian", file: "2OceanDomian.json" },
    { name: "次大洋域SubOceanDomain", file: "3SubOceanDomain.json" },
    { name: "洋脊域RidgeDomain", file: "4RidgeDomain.json" },
    { name: "大西洋转换断层Atlantic_FZ", file: "Atlantic_FZ.json" },
    { name: "Dupal异常洋DupalOcean", file: "DupalOcean.json" },
    {
      name: "全球陆壳GlobalContinentalCrust",
      file: "global_continental_crust.json",
    },
    { name: "热点hotspots", file: "hotspots.json" },
    { name: "印度洋转换断层Indian_FZ", file: "Indian_FZ.json" },
    { name: "大火成岩省(Johansson)", file: "LIP_Johansson.json" },
    { name: "LLSVP", file: "LLSVP.json" },
    { name: "太平洋转换断层Pacific_FZ", file: "Pacific_FZ.json" },
    { name: "板块转换断层Pb_transformall", file: "Pb_transformall.json" },
    { name: "海沟Pb_trench", file: "Pb_trench.json" },
    { name: "大陆板块plate_cont", file: "plate_cont.json" },
    { name: "大洋板块plate_ocean", file: "plate_ocean.json" },
    { name: "16板块plate16", file: "plate16.json" },
    { name: "洋脊(plgn1_5)", file: "RD_plgn1_5.json" },
    { name: "洋脊(新)ridgenew", file: "ridgenew.json" },
    { name: "火山volcanos", file: "volcanos.json" },
  ];
  const geoJsonBasePath = "./assets/geojson/";
  const layerCache = {};
  const layerColorMap = {};

  /**
   * 固定种子的伪随机数生成器
   */
  function createFixedSeededRandom() {
    const seed = 12230916;
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    let current = seed;
    return function () {
      current = (a * current + c) % m;
      return current / m;
    };
  }

  /**
   * 生成固定的十六进制颜色
   */
  function getFixedColor(index) {
    const random = createFixedSeededRandom();
    for (let i = 0; i < index; i++) {
      random();
    }
    const r = Math.floor(random() * 256);
    const g = Math.floor(random() * 256);
    const b = Math.floor(random() * 256);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  /**
   * 生成自定义复选框样式
   */
  function createCheckboxStyle() {
    const style = document.createElement("style");
    style.textContent = `
      /* 通用复选框样式 */
      .layer-item input[type="checkbox"], #selectAllLayers {
        appearance: none;
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        border: 1px solid #ccc;
        border-radius: 2px;
        cursor: pointer;
        position: relative;
        outline: none;
        background: #fff;
        transition: all 0.2s ease;
      }
      /* 选中状态样式 */
      .layer-item input[type="checkbox"]:checked, #selectAllLayers:checked {
        border-color: transparent;
      }
      /* 选中后对勾 */
      .layer-item input[type="checkbox"]:checked::after, #selectAllLayers:checked::after {
        content: "✓";
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: #fff;
        font-size: 12px;
        font-weight: bold;
      }
      /* 全选框选中背景（绿色） */
      #selectAllLayers:checked {
        background: #99cc99;
      }
      /* 图层复选框选中背景（自定义色） */
      .layer-item input[type="checkbox"]:checked {
        background: var(--layer-color, #4CAF50);
      }
      /* 图层项样式 */
      .layer-item {
        display: flex;
        align-items: center;
        margin: 3px 0;
        padding: 6px 10px;
      }
      .layer-item label {
        cursor: pointer;
        user-select: none;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 生成图层开关DOM
   */
  function generateLayerItems() {
    createCheckboxStyle();
    const container = document.getElementById("layerItemsContainer");
    geoJsonLayers.forEach((layerConfig, index) => {
      const checkboxId = `layer_${index}`;
      const fullPath = `${geoJsonBasePath}${layerConfig.file}`;
      const fixedColor = getFixedColor(index);
      layerColorMap[checkboxId] = fixedColor;

      const layerItem = document.createElement("div");
      layerItem.className = "layer-item";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = checkboxId;
      checkbox.value = fullPath;
      checkbox.dataset.layerName = layerConfig.name;
      checkbox.style.setProperty("--layer-color", fixedColor);
      checkbox.addEventListener("change", function () {
        this.style.background = this.checked ? fixedColor : "#fff";
        // 同步更新全选框状态
        syncSelectAllStatus();
      });

      const label = document.createElement("label");
      label.htmlFor = checkboxId;
      label.textContent = layerConfig.name;

      layerItem.appendChild(checkbox);
      layerItem.appendChild(label);
      container.appendChild(layerItem);
    });
  }

  /**
   * 同步全选框状态：所有图层都勾选则全选框勾选，否则取消
   */
  function syncSelectAllStatus() {
    if (!selectAllCheckbox) return;
    const allCheckboxes = document.querySelectorAll(
      '.layer-item input[type="checkbox"]',
    );
    const allChecked = Array.from(allCheckboxes).every(
      (checkbox) => checkbox.checked,
    );
    selectAllCheckbox.checked = allChecked;
  }

  /**
   * 覆盖所有GeoJSON几何类型的样式
   */
  function getGeoJsonStyle(feature, layerId) {
    const mainColor = layerColorMap[layerId] || "#8B4513";
    const baseStyle = {
      color: mainColor,
      fillColor: mainColor,
      weight: 2,
      opacity: 0.8,
      fillOpacity: 0.3,
      radius: 8,
    };

    const geomType = (feature.geometry?.type || "").toLowerCase();
    switch (geomType) {
      case "point":
      case "multipoint":
        return {
          ...baseStyle,
          weight: 1,
          fillOpacity: 0.8,
        };
      case "linestring":
      case "multilinestring":
        return {
          ...baseStyle,
          fillOpacity: 0,
          weight: 3,
        };
      case "polygon":
      case "multipolygon":
        return baseStyle;
      default:
        return baseStyle;
    }
  }

  /**
   * 绑定要素弹窗和点击事件
   */
  function onEachFeature(feature, layer) {
    if (feature.properties) {
      const popupContent = `
        <div style="font-size:14px; line-height:1.6;">
          <p><strong>OBJECTID：</strong>${feature.properties.OBJECTID || "无"}</p>
          <p><strong>项目编号：</strong>${feature.properties.项目编号 || "无"}</p>
        </div>
      `;
      layer.bindPopup(popupContent);
    }

    layer.on("click", () => {
      optimizedFitBounds(layer.getBounds(), {
        padding: [16, 16],
        animate: true,
      });
    });
  }

  /**
   * 加载GeoJSON图层
   */
  function loadGeoJSONLayer(filePath, checkboxId) {
    if (layerCache[checkboxId]) {
      layerCache[checkboxId].addTo(map);
      optimizedFitBounds(layerCache[checkboxId].getBounds(), {
        padding: [50, 50],
        animate: true,
      });
      return;
    }

    fetch(filePath)
      .then((response) => {
        if (!response.ok) throw new Error(`加载${filePath}失败`);
        return response.json();
      })
      .then((data) => {
        const geoJsonLayer = L.geoJSON(data, {
          style: (feature) => getGeoJsonStyle(feature, checkboxId),
          onEachFeature: onEachFeature,
          pointToLayer: (feature, latlng) => {
            return L.circleMarker(latlng, getGeoJsonStyle(feature, checkboxId));
          },
          onEachGeometry: (geometry, layer) => {
            layer.setStyle(getGeoJsonStyle({ geometry }, checkboxId));
          },
        }).addTo(map);

        geoJsonLayer.eachLayer((layer) => {
          layer.setStyle(getGeoJsonStyle(layer.feature, checkboxId));
        });

        layerCache[checkboxId] = geoJsonLayer;
        optimizedFitBounds(geoJsonLayer.getBounds(), {
          padding: [6, 6],
          animate: true,
        });
      })
      .catch((error) => {
        console.error("GeoJSON加载失败：", error);
        alert(`图层加载失败：${filePath}`);
        const checkbox = document.getElementById(checkboxId);
        checkbox.checked = false;
        checkbox.style.background = "#fff";
        syncSelectAllStatus();
        isMapZooming = false;
      });
  }

  /**
   * 移除GeoJSON图层
   */
  function removeGeoJSONLayer(checkboxId) {
    if (layerCache[checkboxId]) {
      map.removeLayer(layerCache[checkboxId]);
    }
    const checkbox = document.getElementById(checkboxId);
    checkbox.style.background = "#fff";
  }

  // ========== 全开所有图层 ==========
  function selectAllLayers() {
    const checkboxes = document.querySelectorAll(
      '.layer-item input[type="checkbox"]',
    );
    checkboxes.forEach((checkbox) => {
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.style.background = layerColorMap[checkbox.id] || "#fff";
        loadGeoJSONLayer(checkbox.value, checkbox.id);
      }
    });
  }

  // ========== 全关所有图层 ==========
  function unselectAllLayers() {
    const checkboxes = document.querySelectorAll(
      '.layer-item input[type="checkbox"]',
    );
    checkboxes.forEach((checkbox) => {
      if (checkbox.checked) {
        checkbox.checked = false;
        checkbox.style.background = "#fff";
        removeGeoJSONLayer(checkbox.id);
      }
    });
  }

  /**
   * 绑定图层开关事件
   */
  function bindLayerEvents() {
    document
      .querySelectorAll('.layer-item input[type="checkbox"]')
      .forEach((checkbox) => {
        checkbox.addEventListener("change", function () {
          const filePath = this.value;
          const checkboxId = this.id;
          this.checked
            ? loadGeoJSONLayer(filePath, checkboxId)
            : removeGeoJSONLayer(checkboxId);
        });
      });
  }

  // 初始化
  function initGeoJsonLayer() {
    generateLayerItems();
    bindLayerEvents();
  }

  window.addEventListener("load", initGeoJsonLayer);
});
