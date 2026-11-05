import { Actions, ContextMenuBuilder, Layout, Model, showPopupMenu } from "flexlayout-react";
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";

import "flexlayout-react/style/dark.css";
import "./browser.css";

const refs = [createRef(), createRef()];
const models = [0, 1].map((index) =>
  Model.fromJson({
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          id: "container-" + index,
          children: [
            {
              type: "tab",
              id: "document-" + index,
              name: "Document " + index,
              component: "editor",
            },
          ],
        },
      ],
    },
  }),
);
const metrics = { starts: 0, ends: 0, events: [] };
const menuModel = Model.fromJson({
  global: { tabSetEnableTabGroups: true },
  layout: {
    type: "row",
    children: [
      {
        type: "tabset",
        children: [{ type: "tab", id: "palette", name: "Palette", component: "editor" }],
      },
    ],
  },
});
menuModel.doAction(Actions.addTabToNewGroup("palette", "Palette"));
const menu = { group: menuModel.getNodeById("palette").getParent(), actions: [], dismissed: 0 };
window.nativeGate = { refs, models, metrics, menu };
function showGroupMenu(event) {
  const hide = showPopupMenu({
    anchor: { x: 80, y: 160 },
    container: refs[0].current.getRootDiv(),
    returnFocusTo: event.currentTarget,
    items: new ContextMenuBuilder(menu.group, {
      onAction: (action) => {
        menu.actions.push(action);
        menuModel.doAction(action);
      },
      closeMenu: () => hide(),
    })
      .addStandard()
      .build(),
    onClose: () => {
      menu.dismissed++;
    },
  });
}
const factory = (node) =>
  createElement("input", {
    "aria-label": node.getName(),
    defaultValue: "Editable " + node.getName(),
  });
createRoot(document.getElementById("root")).render(
  createElement(
    "main",
    null,
    createElement("h1", null, "Native dependency acceptance"),
    createElement(
      "button",
      { id: "native-group-menu", onClick: showGroupMenu },
      "Native group menu",
    ),
    createElement(
      "div",
      { className: "controls" },
      refs.map((ref, index) =>
        createElement(
          "div",
          { key: index },
          createElement(
            "button",
            {
              id: "drag-" + index,
              draggable: true,
              onDragStart: (event) => {
                ++metrics.starts;
                metrics.events.push("start");
                event.dataTransfer.setData("text/plain", "Native document " + index);
                event.dataTransfer.effectAllowed = "copy";
                ref.current.addTabWithDragAndDrop(event, {
                  type: "tab",
                  id: "dropped-" + index,
                  name: "Dropped " + index,
                  component: "editor",
                });
              },
              onDragEnd: () => {
                ++metrics.ends;
                metrics.events.push("end");
                ref.current.endDrag();
              },
            },
            "Drag document " + index,
          ),
          createElement(
            "button",
            { id: "cancel-" + index, onClick: () => ref.current.endDrag() },
            "Cancel drag " + index,
          ),
        ),
      ),
    ),
    createElement(
      "div",
      { className: "layouts" },
      refs.map((ref, index) =>
        createElement(
          "section",
          {
            key: index,
            id: "layout-" + index,
            "aria-label": "Native layout " + index,
            onDragEnter: () => metrics.events.push("enter:" + index),
            onDragLeave: () => metrics.events.push("leave:" + index),
          },
          createElement(Layout, { ref, model: models[index], factory }),
        ),
      ),
    ),
  ),
);
