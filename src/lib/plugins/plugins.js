import { NodeVM } from "vm2";
import fs from "fs";
import glob from "glob";
import Path from "path";
import chokidar from "chokidar";
import EventEmitter from "events";
import { ipcRenderer } from "electron";

const babel = require("@babel/standalone");
const importExportPlugin = require("@babel/plugin-transform-modules-commonjs");
const jsxPlugin = require("@babel/plugin-transform-react-jsx");

const urlParams = new URLSearchParams(window.location.search);
const projectPath = urlParams.get("path");
const projectRoot = projectPath && Path.dirname(projectPath);

const pluginEventHandlerPaths = projectRoot
  ? glob.sync(`${projectRoot}/plugins/**/events/event*.js`)
  : [];
const pluginMenuHandlerPaths = projectRoot
  ? glob.sync(`${projectRoot}/plugins/**/menu/menu*.js`)
  : [];

const pluginEmitter = new EventEmitter();

const compiler = code =>
  babel.transform(code, {
    plugins: [importExportPlugin, jsxPlugin]
  }).code;

const vm = new NodeVM({
  timeout: 1000,
  sandbox: {},
  compiler
});

const loadPlugin = path => {
  const pluginCode = fs.readFileSync(path, "utf8");
  const plugin = vm.run(pluginCode);
  if (!plugin.id) {
    throw new Error(`Event plugin ${path} is missing id`);
  }
  plugin.plugin = Path.relative(`${projectRoot}/plugins`, path).split(
    Path.sep
  )[0];
  return plugin;
};

const pluginEventFilepaths = {};
const pluginMenuFilepaths = {};

const plugins = {
  events: pluginEventHandlerPaths.reduce((memo, path) => {
    const plugin = loadPlugin(path);
    pluginEventFilepaths[path] = plugin.id;
    return {
      ...memo,
      [plugin.id]: plugin
    };
  }, {}),
  menu: pluginMenuHandlerPaths.reduce((memo, path) => {
    const plugin = loadPlugin(path);
    pluginMenuFilepaths[path] = plugin.id;
    return {
      ...memo,
      [plugin.id]: plugin
    };
  }, {})
};

ipcRenderer.send("set-menu-plugins", plugins.menu);

chokidar
  .watch(`${projectRoot}/plugins/*/events/event*.js`, {
    ignoreInitial: true,
    persistent: true
  })
  .on("add", path => {
    const plugin = loadPlugin(path);
    plugins.events[plugin.id] = plugin;
    pluginEmitter.emit("add-event", plugin);
  })
  .on("change", path => {
    const plugin = loadPlugin(path);
    const oldPluginId = pluginEventFilepaths[path];
    if (oldPluginId !== plugin.id) {
      pluginEventFilepaths[path] = oldPluginId;
      pluginEmitter.emit("remove-event", { id: oldPluginId });
    }
    plugins.events[plugin.id] = plugin;
    pluginEmitter.emit("update-event", plugin);
  })
  .on("unlink", path => {
    const pluginId = pluginEventFilepaths[path];
    delete plugins.events[pluginId];
    delete pluginEventFilepaths[path];
    pluginEmitter.emit("remove-event", { id: pluginId });
  });

chokidar
  .watch(`${projectRoot}/plugins/*/menu/menu*.js`, {
    ignoreInitial: true,
    persistent: true
  })
  .on("add", path => {
    const plugin = loadPlugin(path);
    plugins.menu[plugin.id] = plugin;
    pluginEmitter.emit("add-menu", plugin);
    ipcRenderer.send("set-menu-plugins", plugins.menu);
  })
  .on("change", path => {
    const plugin = loadPlugin(path);
    const oldPluginId = pluginMenuFilepaths[path];
    if (oldPluginId !== plugin.id) {
      pluginMenuFilepaths[path] = oldPluginId;
      pluginEmitter.emit("remove-menu", { id: oldPluginId });
    }
    plugins.menu[plugin.id] = plugin;
    pluginEmitter.emit("update-menu", plugin);
    ipcRenderer.send("set-menu-plugins", plugins.menu);
  })
  .on("unlink", path => {
    const pluginId = pluginMenuFilepaths[path];
    delete plugins.menu[pluginId];
    delete pluginMenuFilepaths[path];
    pluginEmitter.emit("remove-menu", { id: pluginId });
    ipcRenderer.send("set-menu-plugins", plugins.menu);
  });

export default plugins;
export { pluginEmitter };
