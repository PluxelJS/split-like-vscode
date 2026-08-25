import {
  Workbench,
  type WorkbenchEditorGroup,
  type WorkbenchLayout,
  type WorkbenchPart,
  type WorkbenchView,
} from "@worksplit/react";
import {
  Files,
  GitBranch,
  PanelBottomClose,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import "@worksplit/react/style.css";
import "./styles.css";

const files = [
  "src/App.tsx",
  "src/workspace/layout.ts",
  "packages/core/index.ts",
  "packages/react/SplitView.tsx",
  "packages/react/Workbench.tsx",
];

const views: WorkbenchView[] = [
  {
    defaultActive: true,
    icon: Files,
    id: "explorer",
    order: 10,
    part: "primary",
    renderContent: () => (
      <div className="fileTree">
        {files.map((file) => (
          <button className="fileItem" key={file} type="button">
            {file}
          </button>
        ))}
      </div>
    ),
    title: "Explorer",
  },
  {
    icon: Search,
    id: "search",
    order: 20,
    part: "primary",
    renderContent: () => <EmptyTool title="Search" />,
    title: "Search",
  },
  {
    icon: GitBranch,
    id: "source-control",
    order: 30,
    part: "primary",
    renderContent: () => <EmptyTool title="Source Control" />,
    title: "Source Control",
  },
  {
    defaultActive: true,
    icon: Play,
    id: "terminal",
    order: 40,
    part: "panel",
    renderContent: () => (
      <pre className="terminalText">
        pnpm dev{"\n"}Local: http://localhost:5174/{"\n"}packages built in library mode
      </pre>
    ),
    title: "Terminal",
  },
  {
    defaultActive: true,
    icon: Sparkles,
    id: "inspector",
    order: 50,
    part: "secondary",
    renderContent: () => (
      <div className="inspector">
        <section>
          <h2>Workbench model</h2>
          <p>Views are registered by part and restored through a versioned value snapshot.</p>
        </section>
        <section>
          <h2>Interactions</h2>
          <p>Collapse a part, then drag its boundary sash back out to reveal it.</p>
        </section>
      </div>
    ),
    title: "Inspector",
  },
  {
    activityGroup: "footer",
    icon: Settings,
    id: "settings",
    order: 90,
    part: "secondary",
    renderContent: () => <EmptyTool title="Settings" />,
    title: "Settings",
  },
];

const editorGroups: WorkbenchEditorGroup[] = [
  {
    id: "left",
    size: { default: "1fr", min: 280 },
    tabs: [
      {
        id: "workbench",
        renderContent: () => <EditorContent code={sampleCode} />,
        title: "Workbench.tsx",
      },
      {
        id: "split-view",
        renderContent: () => <EditorContent code={splitViewCode} />,
        title: "SplitView.tsx",
      },
    ],
  },
  {
    id: "right",
    size: { default: 360, min: 260 },
    tabs: [
      {
        id: "preview",
        renderContent: ({ actions }) => (
          <div className="previewPane">
            <h2>Editor groups</h2>
            <p>The center area is a persisted recursive grid of independently owned groups.</p>
            <div className="previewActions">
              <button
                onClick={() =>
                  actions.moveEditorGroup({
                    groupId: "bottom",
                    position: "bottom",
                    targetGroupId: "right",
                  })
                }
                type="button"
              >
                Stack terminal below
              </button>
              <button onClick={() => actions.toggleEditorGroupMaximized("right")} type="button">
                Toggle maximize
              </button>
            </div>
          </div>
        ),
        title: "Preview",
      },
    ],
  },
  {
    id: "bottom",
    size: { min: 180 },
    tabs: [
      {
        id: "output",
        renderContent: () => (
          <pre className="terminalText">{"Editor Grid ready.\nLayout persisted."}</pre>
        ),
        title: "Output",
      },
    ],
  },
];

const defaultLayout: WorkbenchLayout = {
  editorLayout: {
    children: [
      { node: { groupId: "left", type: "group" } },
      {
        node: {
          children: [
            { node: { groupId: "right", type: "group" } },
            { node: { groupId: "bottom", type: "group" } },
          ],
          id: "right-stack",
          orientation: "vertical",
          type: "split",
        },
      },
    ],
    id: "root",
    orientation: "horizontal",
    type: "split",
  },
  panelPosition: "bottom",
  value: { version: 1 },
  version: 1,
};

function App() {
  return (
    <Workbench
      className="shell"
      defaultLayout={defaultLayout}
      editorGroups={editorGroups}
      partSizes={{
        panel: { default: 220, max: 360, min: 140 },
        primary: { default: 260, max: 420, min: 180 },
        secondary: { default: 320, max: 460, min: 240 },
      }}
      renderCollapsedPart={({ icon }) => (
        <span className="collapsedMarker" aria-hidden="true">
          {icon}
        </span>
      )}
      renderPartHeader={({ actions, icon, part, view }) => (
        <PanelHeader
          icon={icon}
          onClose={() => actions.hidePart(part)}
          onReset={view.id === "settings" ? actions.resetLayout : undefined}
          onTogglePanelPosition={view.id === "terminal" ? actions.togglePanelPosition : undefined}
          part={part}
          view={view}
        />
      )}
      storageKey="worksplit-demo-layout"
      views={views}
    />
  );
}

function EditorContent(props: { code: string }) {
  return (
    <div className="editorPane">
      <pre className="code">
        <code>{props.code}</code>
      </pre>
    </div>
  );
}

function EmptyTool(props: { title: string }) {
  return (
    <div className="emptyTool">
      <p>{props.title}</p>
    </div>
  );
}

function PanelHeader(props: {
  onClose(): void;
  onReset?: (() => void) | undefined;
  onTogglePanelPosition?: (() => void) | undefined;
  icon: ReactNode;
  part: WorkbenchPart;
  view: WorkbenchView;
}) {
  const CloseIcon = closeIconByPart(props.part);

  return (
    <header className={["panelHeader", props.part === "panel" ? "terminalHeader" : ""].join(" ")}>
      <span>
        {props.icon}
        {props.view.title ?? props.view.id}
      </span>
      <div className="headerActions">
        {props.view.id === "terminal" && <span className="status">vite 8 ready</span>}
        {props.onTogglePanelPosition && (
          <button
            aria-label="Toggle Panel Position"
            className="iconButton"
            onClick={props.onTogglePanelPosition}
            type="button"
          >
            <PanelRightOpen size={16} />
          </button>
        )}
        {props.onReset && (
          <button
            aria-label="Reset Layout"
            className="iconButton"
            onClick={props.onReset}
            type="button"
          >
            <RotateCcw size={16} />
          </button>
        )}
        <button
          aria-label={`Collapse ${props.view.title ?? props.view.id}`}
          className="iconButton"
          onClick={props.onClose}
          type="button"
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </header>
  );
}

function closeIconByPart(part: WorkbenchPart) {
  if (part === "primary") {
    return PanelLeftClose;
  }
  if (part === "secondary") {
    return PanelRightClose;
  }
  return PanelBottomClose;
}

const sampleCode = `const views: WorkbenchView[] = [
  {
    id: "explorer",
    part: "primary",
    title: "Explorer",
    icon: Files,
    renderContent: () => <Explorer />,
  },
  {
    id: "terminal",
    part: "panel",
    title: "Terminal",
    icon: Play,
    renderContent: () => <Terminal />,
  },
];

const editorGroups: WorkbenchEditorGroup[] = [
  {
    id: "left",
    tabs: [
      { id: "workbench", title: "Workbench.tsx", renderContent: () => <WorkbenchFile /> },
      { id: "split-view", title: "SplitView.tsx", renderContent: () => <SplitViewFile /> },
    ],
  },
  {
    id: "right",
    size: { default: 360, min: 260 },
    tabs: [{ id: "preview", title: "Preview", renderContent: () => <Preview /> }],
  },
];

<Workbench
  editorGroups={editorGroups}
  partSizes={{ panel: { default: 220 }, primary: { default: 260 } }}
  storageKey="workspace-layout"
  views={views}
/>;`;

const splitViewCode = `const editorGroups: WorkbenchEditorGroup[] = [
  {
    id: "left",
    tabs: [
      { id: "workbench", title: "Workbench.tsx", renderContent: () => <WorkbenchFile /> },
      { id: "split-view", title: "SplitView.tsx", renderContent: () => <SplitViewFile /> },
    ],
  },
  {
    id: "right",
    size: { default: 360, min: 260 },
    tabs: [{ id: "preview", title: "Preview", renderContent: () => <Preview /> }],
  },
];

<Workbench editorGroups={editorGroups} storageKey="workspace-layout" views={views} />;`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
