// ========== 外部文件处理（支持 GeoJSON / SHP / KML / KMZ / ZIP → 统一走 addUserLayer）==========
(function () {
  // 暂存：geoJSONLoader 尚未就绪时收到的文件（旧 PWA 入口备用）
  var _pendingFiles = [];

  // ========== GZ 解压工具函数（使用浏览器原生 DecompressionStream）==========
  function decompressGz(arrayBuffer) {
    var blob = new Blob([arrayBuffer]);
    var ds = new DecompressionStream("gzip");
    var stream = blob.stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer();
  }

  window.loadFileAsUserLayer = function loadFileAsUserLayer(file, autoShow) {
    var ext = (file.name.split(".").pop() || "").toLowerCase();

    // 单文件
    if (/^(geojson|json|kml)$/i.test(ext)) {
      if (/^kml$/i.test(ext) && typeof toGeoJSON === "undefined") {
        alert("toGeoJSON 库尚未加载，请检查网络连接后刷新页面。");
        return;
      }
      window.showLoading("正在读取文件...");
      var reader = new FileReader();
      reader.onload = function (ev) {
        window.showLoading("正在解析数据...");
        setTimeout(function () {
          try {
            var data;
            if (/^kml$/i.test(ext)) {
              var parser = new DOMParser();
              var xmlDoc = parser.parseFromString(ev.target.result, "text/xml");
              data = toGeoJSON.kml(xmlDoc);
            } else {
              data = JSON.parse(ev.target.result);
            }
            deliverToMap(data, file.name, autoShow);
          } catch (err) {
            window.hideLoading();
            alert(
              ext.toUpperCase() +
                " 解析失败：" +
                file.name +
                "\n" +
                err.message,
            );
          }
        }, 50);
      };
      reader.onerror = function () {
        window.hideLoading();
        alert("文件读取失败：" + (file.name || ""));
      };
      reader.readAsText(file);
    } else if (/^gz$/i.test(ext)) {
      // .gz 文件：解压后根据内部扩展名判断格式
      window.showLoading("正在解压 GZ 文件...");
      var readerGz = new FileReader();
      readerGz.onload = function (ev) {
        window.showLoading("正在解析数据...");
        decompressGz(ev.target.result)
          .then(function (decompressedBuf) {
            var innerName = file.name.replace(/\.gz$/i, "");
            var innerExt = (innerName.split(".").pop() || "").toLowerCase();
            var blob = new Blob([decompressedBuf]);
            if (/^(geojson|json)$/i.test(innerExt)) {
              return blob.text().then(function (text) {
                deliverToMap(JSON.parse(text), innerName, autoShow);
              });
            } else if (/^kml$/i.test(innerExt)) {
              if (typeof toGeoJSON === "undefined") {
                window.hideLoading();
                alert("toGeoJSON 库尚未加载，请检查网络连接后刷新页面。");
                return;
              }
              return blob.text().then(function (text) {
                var parser = new DOMParser();
                var xmlDoc = parser.parseFromString(text, "text/xml");
                deliverToMap(toGeoJSON.kml(xmlDoc), innerName, autoShow);
              });
            } else {
              window.hideLoading();
              alert(
                "GZ 内文件格式不支持：" +
                  innerName +
                  "\n支持：.geojson、.json、.kml",
              );
            }
          })
          .catch(function (err) {
            window.hideLoading();
            alert("GZ 解压失败：" + file.name + "\n" + err.message);
          });
      };
      readerGz.onerror = function () {
        window.hideLoading();
        alert("文件读取失败：" + (file.name || ""));
      };
      readerGz.readAsArrayBuffer(file);
    } else if (/^(zip|kmz)$/i.test(ext)) {
      if (typeof JSZip === "undefined") {
        alert("JSZip 库尚未加载，请检查网络连接后刷新页面。");
        return;
      }
      var isKmz = /^kmz$/i.test(ext);
      window.showLoading("正在读取 " + (isKmz ? "KMZ" : "ZIP") + "...");
      var readerZip = new FileReader();
      readerZip.onload = function (ev) {
        window.showLoading("正在解压...");
        var buffer = ev.target.result;
        setTimeout(function () {
          JSZip.loadAsync(buffer)
            .then(function (zip) {
              var shpFileNames = [];
              var geojsonFiles = [];
              var kmlFiles = [];
              var kmzFiles = [];
              var geojsonGzFiles = [];
              var kmlGzFiles = [];
              zip.forEach(function (relativePath, zipEntry) {
                if (zipEntry.dir) return;
                var name = relativePath.split("/").pop();
                if (!name || name.startsWith(".")) return;
                var e = name.split(".").pop().toLowerCase();
                if (e === "shp") {
                  var baseName = name.replace(/\.shp$/i, "");
                  if (shpFileNames.indexOf(baseName) === -1)
                    shpFileNames.push(baseName);
                } else if (/^(geojson|json)$/i.test(e)) {
                  geojsonFiles.push({ path: relativePath, name: name });
                } else if (/^kml$/i.test(e)) {
                  kmlFiles.push({ path: relativePath, name: name });
                } else if (/^kmz$/i.test(e)) {
                  kmzFiles.push({ path: relativePath, name: name });
                } else if (/^gz$/i.test(e)) {
                  var innerName = name.replace(/\.gz$/i, "");
                  var innerExt = (innerName.split(".").pop() || "").toLowerCase();
                  if (/^(geojson|json)$/i.test(innerExt))
                    geojsonGzFiles.push({
                      path: relativePath,
                      name: innerName,
                    });
                  else if (/^kml$/i.test(innerExt))
                    kmlGzFiles.push({ path: relativePath, name: innerName });
                }
              });
              var tasks = [];
              if (shpFileNames.length > 0 && typeof shp === "function") {
                tasks.push(
                  shp(buffer)
                    .then(function (result) {
                      if (Array.isArray(result)) {
                        var count = Math.min(
                          result.length,
                          shpFileNames.length,
                        );
                        for (var si = 0; si < count; si++)
                          deliverToMap(result[si], shpFileNames[si] + ".shp");
                        for (var sj = count; sj < result.length; sj++)
                          deliverToMap(
                            result[sj],
                            file.name.replace(/\.(zip|kmz)$/i, "") +
                              "_" +
                              sj +
                              ".shp",
                          );
                      } else {
                        deliverToMap(
                          result,
                          (shpFileNames[0] ||
                            file.name.replace(/\.(zip|kmz)$/i, "")) + ".shp",
                        );
                      }
                    })
                    .catch(function (err) {
                      console.warn("shpjs 解析失败:", err);
                    }),
                );
              }
              geojsonFiles.forEach(function (item) {
                tasks.push(
                  zip
                    .file(item.path)
                    .async("text")
                    .then(function (text) {
                      deliverToMap(JSON.parse(text), item.name);
                    })
                    .catch(function (err) {
                      console.warn("GeoJSON 解析失败:", item.name, err);
                    }),
                );
              });
              if (typeof toGeoJSON !== "undefined") {
                kmzFiles.forEach(function (item) {
                  tasks.push(
                    zip
                      .file(item.path)
                      .async("arraybuffer")
                      .then(function (kmzBuf) {
                        return JSZip.loadAsync(kmzBuf).then(
                          function (innerZip) {
                            var innerKml = null;
                            innerZip.forEach(function (rp, entry) {
                              if (
                                !innerKml &&
                                !entry.dir &&
                                /^kml$/i.test(rp.split(".").pop())
                              )
                                innerKml = entry;
                            });
                            if (!innerKml)
                              throw new Error("KMZ 中未找到 KML 文件");
                            return innerKml.async("text");
                          },
                        );
                      })
                      .then(function (kmlText) {
                        var parser = new DOMParser();
                        var xmlDoc = parser.parseFromString(
                          kmlText,
                          "text/xml",
                        );
                        deliverToMap(toGeoJSON.kml(xmlDoc), item.name);
                      })
                      .catch(function (err) {
                        console.warn("嵌套 KMZ 解析失败:", item.name, err);
                      }),
                  );
                });
              }
              if (typeof toGeoJSON !== "undefined") {
                var kmlList = isKmz
                  ? kmlFiles.length > 0
                    ? [kmlFiles[0]]
                    : []
                  : kmlFiles;
                kmlList.forEach(function (item) {
                  var displayName = isKmz ? file.name : item.name;
                  tasks.push(
                    zip
                      .file(item.path)
                      .async("text")
                      .then(function (text) {
                        var parser = new DOMParser();
                        var xmlDoc = parser.parseFromString(text, "text/xml");
                        deliverToMap(toGeoJSON.kml(xmlDoc), displayName);
                      })
                      .catch(function (err) {
                        console.warn("KML 解析失败:", item.name, err);
                      }),
                  );
                });
              }
              // ZIP 内 .geojson.gz / .json.gz 解压
              geojsonGzFiles.forEach(function (item) {
                tasks.push(
                  zip
                    .file(item.path)
                    .async("arraybuffer")
                    .then(function (buf) {
                      return decompressGz(buf);
                    })
                    .then(function (decompressedBuf) {
                      var blob = new Blob([decompressedBuf]);
                      return blob.text();
                    })
                    .then(function (text) {
                      deliverToMap(JSON.parse(text), item.name);
                    })
                    .catch(function (err) {
                      console.warn(
                        "GZ 内 GeoJSON 解析失败:",
                        item.name,
                        err,
                      );
                    }),
                );
              });
              // ZIP 内 .kml.gz 解压
              if (typeof toGeoJSON !== "undefined") {
                kmlGzFiles.forEach(function (item) {
                  tasks.push(
                    zip
                      .file(item.path)
                      .async("arraybuffer")
                      .then(function (buf) {
                        return decompressGz(buf);
                      })
                      .then(function (decompressedBuf) {
                        var blob = new Blob([decompressedBuf]);
                        return blob.text();
                      })
                      .then(function (text) {
                        var parser = new DOMParser();
                        var xmlDoc = parser.parseFromString(text, "text/xml");
                        deliverToMap(toGeoJSON.kml(xmlDoc), item.name);
                      })
                      .catch(function (err) {
                        console.warn("GZ 内 KML 解析失败:", item.name, err);
                      }),
                  );
                });
              }
              if (tasks.length === 0) {
                window.hideLoading();
                alert(
                  "ZIP 中未找到可识别的文件\n支持：.shp、.geojson、.json、.kml、.kml.gz、.geojson.gz",
                );
                return;
              }
              Promise.allSettled(tasks).then(function () {
                window.hideLoading();
              });
            })
            .catch(function (err) {
              window.hideLoading();
              alert("ZIP 解压失败：" + file.name + "\n" + err.message);
            });
        }, 50);
      };
      readerZip.onerror = function () {
        window.hideLoading();
        alert("文件读取失败：" + (file.name || ""));
      };
      readerZip.readAsArrayBuffer(file);
    } else {
      alert(
        "不支持的文件格式：." +
          ext +
          "\n支持格式：GeoJSON、JSON、KML、KMZ、GZ、ZIP",
      );
    }
  };

  function deliverToMap(data, fileName, autoShow) {
    if (typeof window.addUserLayer === "function") {
      window.addUserLayer(data, fileName, autoShow);
      var layerPanel = document.getElementById("layerPanel");
      if (layerPanel) layerPanel.classList.add("active");
    }
    window.hideLoading();
  }

  // PWA 关联打开文件
  if ("launchQueue" in window) {
    launchQueue.setConsumer(function (launchParams) {
      launchParams.files.forEach(function (fileHandle) {
        fileHandle
          .getFile()
          .then(function (file) {
            if (typeof window.addUserLayer === "function") {
              loadFileAsUserLayer(file);
            } else {
              _pendingFiles.push(file);
            }
          })
          .catch(function (err) {
            console.error("读取文件失败：", err);
          });
      });
    });
  }

  // 处理暂存文件
  if (_pendingFiles.length) {
    _pendingFiles.forEach(function (file) {
      loadFileAsUserLayer(file);
    });
    _pendingFiles = [];
  }

  // 拖放支持
  document.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener("drop", function (e) {
    e.preventDefault();
    e.stopPropagation();
    var items = e.dataTransfer.items;
    if (!items || !items.length) return;
    var hasDirectory = false;
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry && entry.isDirectory) {
        hasDirectory = true;
        break;
      }
    }
    if (hasDirectory) {
      var allFiles = [];
      var pendingEntries = [];
      for (var di = 0; di < items.length; di++) {
        var dirEntry =
          items[di].webkitGetAsEntry && items[di].webkitGetAsEntry();
        if (dirEntry) pendingEntries.push(dirEntry);
      }
      function readEntriesRecursive() {
        if (!pendingEntries.length) {
          onAllFilesCollected(allFiles);
          return;
        }
        var current = pendingEntries.shift();
        if (current.isFile) {
          current.file(
            function (file) {
              allFiles.push(file);
              readEntriesRecursive();
            },
            function () {
              readEntriesRecursive();
            },
          );
        } else if (current.isDirectory) {
          var reader = current.createReader();
          reader.readEntries(
            function (entries) {
              for (var ei = 0; ei < entries.length; ei++)
                pendingEntries.push(entries[ei]);
              readEntriesRecursive();
            },
            function () {
              readEntriesRecursive();
            },
          );
        } else {
          readEntriesRecursive();
        }
      }
      function onAllFilesCollected(files) {
        if (!files.length) return;
        window.showLoading("正在扫描文件夹...");
        var fileMap = {};
        files.forEach(function (file) {
          fileMap[file.name.toLowerCase()] = file;
        });
        var nonShpExts = ["kml", "kmz", "json", "geojson", "gz"];
        var nonShpFiles = [];
        files.forEach(function (file) {
          var ext = file.name.split(".").pop().toLowerCase();
          if (nonShpExts.indexOf(ext) !== -1) nonShpFiles.push(file);
        });
        var shpFileNames = [];
        files.forEach(function (file) {
          if (file.name.toLowerCase().endsWith(".shp")) {
            var baseName = file.name.replace(/\.shp$/i, "");
            if (shpFileNames.indexOf(baseName) === -1)
              shpFileNames.push(baseName);
          }
        });
        if (!nonShpFiles.length && !shpFileNames.length) {
          window.hideLoading();
          alert(
            "文件夹中未找到支持的矢量文件\n支持：shp、kml、kmz、json、geojson、gz",
          );
          return;
        }
        var warnings = [];
        var shpTasks = [];
        nonShpFiles.forEach(function (file) {
          loadFileAsUserLayer(file, false);
        });
        if (!shpFileNames.length) {
          window.hideLoading();
          var layerPanel = document.getElementById("layerPanel");
          if (layerPanel) layerPanel.classList.add("active");
          return;
        }
        if (typeof JSZip !== "undefined") {
          shpFileNames.forEach(function (baseName) {
            var companionExts = [".dbf", ".shx", ".prj"];
            var companions = [];
            var missing = [];
            companionExts.forEach(function (ce) {
              var found = null;
              var keyLower = (baseName + ce).toLowerCase();
              for (var fname in fileMap) {
                if (fname === keyLower || fname.endsWith("/" + keyLower)) {
                  found = fileMap[fname];
                  break;
                }
              }
              if (found) companions.push({ name: baseName + ce, file: found });
              else missing.push(ce);
            });
            if (missing.length > 0)
              warnings.push(
                baseName + ".shp 缺少配套文件：" + missing.join("、"),
              );
            var shpFile = null;
            var shpKeyLower = (baseName + ".shp").toLowerCase();
            for (var fn in fileMap) {
              if (fn === shpKeyLower || fn.endsWith("/" + shpKeyLower)) {
                shpFile = fileMap[fn];
                break;
              }
            }
            if (!shpFile) return;
            var allParts = companions.concat([
              { name: baseName + ".shp", file: shpFile },
            ]);
            var readPromises = allParts.map(function (part) {
              return new Promise(function (resolve) {
                var reader = new FileReader();
                reader.onload = function (ev) {
                  resolve({ name: part.name, buffer: ev.target.result });
                };
                reader.onerror = function () {
                  resolve(null);
                };
                reader.readAsArrayBuffer(part.file);
              });
            });
            shpTasks.push(
              Promise.all(readPromises).then(function (results) {
                var zip = new JSZip();
                results.forEach(function (r) {
                  if (r && r.buffer) zip.file(r.name, r.buffer);
                });
                return zip.generateAsync({ type: "arraybuffer" });
              }),
            );
          });
          Promise.allSettled(shpTasks).then(function (results) {
            var shpLoadPromises = [];
            results.forEach(function (result, idx) {
              if (result.status === "fulfilled" && typeof shp === "function") {
                shpLoadPromises.push(
                  shp(result.value)
                    .then(function (geojson) {
                      var name = shpFileNames[idx] + ".shp";
                      if (Array.isArray(geojson)) {
                        geojson.forEach(function (layer, li) {
                          var layerName =
                            geojson.length === 1
                              ? name
                              : name.replace(/\.shp$/i, "") + "_" + li + ".shp";
                          window.addUserLayer(layer, layerName, false);
                        });
                      } else {
                        window.addUserLayer(geojson, name, false);
                      }
                    })
                    .catch(function (err) {
                      warnings.push(
                        shpFileNames[idx] + ".shp 解析失败：" + err.message,
                      );
                    }),
                );
              }
            });
            Promise.allSettled(shpLoadPromises).then(function () {
              window.hideLoading();
              var layerPanel = document.getElementById("layerPanel");
              if (layerPanel) layerPanel.classList.add("active");
              if (warnings.length > 0)
                alert("SHP 加载提示：\n\n" + warnings.join("\n\n"));
            });
          });
        } else {
          window.hideLoading();
          alert(
            "JSZip 库尚未加载，无法解析 SHP 文件\n请检查网络连接后刷新页面。",
          );
        }
      }
      readEntriesRecursive();
    } else {
      Array.from(e.dataTransfer.files).forEach(function (file) {
        if (/\.(geojson|json|zip|kml|kmz|gz)$/i.test(file.name)) {
          loadFileAsUserLayer(file);
          var layerPanel = document.getElementById("layerPanel");
          if (layerPanel) layerPanel.classList.add("active");
        }
      });
    }
  });
})();
