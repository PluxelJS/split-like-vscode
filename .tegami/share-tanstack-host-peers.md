---
"@worksplit/react": major
---

# Let the host share TanStack Store and Hotkeys

TanStack React Store and React Hotkeys are required peers alongside Router, FlexLayout and React.
The host installs their compatible versions and supplies native Hotkeys providers and hooks.
The internal core package remains a regular dependency.

Application-owned stores can drive dynamic native shortcut bindings, enabled state and input
policies. Call `executeCommand` from those hooks and omit the command's built-in `hotkey` binding
to keep one registration. Worksplit still captures the command target before asynchronous work;
its coordination state remains read-only through `useWorkbenchState`.

The independently packed consumer verifies shared providers, Store-driven rebinding and native
keyboard execution without another keybinding registry or Store facade.
