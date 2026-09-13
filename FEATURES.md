# OmniMind Bubbles — Technical Documentation & Architecture Reference

## 1. Overview & Version Identity

- **Application Title:** OmniMind - Free Floating Bubbles
- **Version Tag:** `MM_V6` / `Latest Production` (active documents: `MINDMAP.html` & `index.html`, 7,376+ lines, ~397 KB)
- **Application Type:** Interactive Mind-Mapping, Multi-Project Library, Cloud-Synced, Touch-Optimized & Visual Canvas Single-Page Application (SPA)
- **Deployment Structure:** Standalone single-file HTML bundle containing complete UI layout, Tailwind CSS via CDN, custom CSS styling, and client-side JavaScript engine.
- **Architectural Core:** Fully custom Canvas Graph Engine (Multi-Root Forest) with SVG dynamic cubic bezier connections, an independent 2-tier Background Design Layer, an Intelligent Directional Node Placement Engine, and Multi-Touch Gesture System.

---

## 2. Core Architecture & Layered Viewport Stack

The canvas is an infinite zoomable and pannable coordinate plane managed inside `#pan-zoom-container`:

```
┌────────────────────────────────────────────────────────┐
│ Layer 5: Floating Canvas Design Toolbar (z-index: 30)   │
│         #canvas-design-toolbar (overflow-visible)      │
├────────────────────────────────────────────────────────┤
│ Layer 4: Foreground Design Layer (z-index: 25)         │
│         #canvas-decorations-front                     │
├────────────────────────────────────────────────────────┤
│ Layer 3: Mind Map Bubble Nodes Layer (z-index: 20)     │
│         #nodes-container                              │
├────────────────────────────────────────────────────────┤
│ Layer 2: SVG Dynamic Bezier Edges Layer (z-index: 10)  │
│         #edges-svg (5000px × 5000px coordinate plane) │
├────────────────────────────────────────────────────────┤
│ Layer 1: Background Design Layer (z-index: 5)          │
│         #canvas-decorations-back                      │
├────────────────────────────────────────────────────────┤
│ Viewport Base: Infinite Radial Dot Grid                │
│         #canvas-bg (40px dot grid, touch-action: none)│
└────────────────────────────────────────────────────────┘
```

- **Transformation State:** Managed via `panX`, `panY`, and `zoom` factors applied as a GPU-accelerated CSS transform (`translate(${panX}px, ${panY}px) scale(${zoom})`) to `#pan-zoom-container`.
- **Zoom Scale:** Clamped from `0.2×` to `3.0×` with smooth cursor-centric mouse wheel and two-finger pinch interpolation.
- **Fit View Algorithm (`fitView()`):** Calculates the exact Cartesian bounding box enclosing all bubbles, attachments, and background design elements, centering and scaling the canvas viewport with 80px visual padding.

---

## 3. Intelligent Directional Child & Sibling Placement Engine

OmniMind features an adaptive vector-based placement engine that analyzes parent-to-ancestor edge lines to determine node growth trajectory:

### A. Incoming Vector Line Detection (`getNewChildPosition`)
- **Leftward Branching:** When a parent node is positioned to the left of its ancestor ($\Delta X < -15$), clicking **`+ Child`** (or pressing `Tab`) places the child outward to the **left** ($X = P.x - 240$).
- **Rightward Branching:** When a parent node is positioned to the right ($\Delta X > 15$), children extend to the **right** ($X = P.x + 240$).
- **Angled & Sloped Trajectory:** For diagonal branches, the first child inherits a subtle vertical angle matching the incoming line: $P.y + \text{clamp}(\text{slope} \times 50, -50, 50)$.
- **Vertical Branches:** If a branch is positioned primarily vertically ($|\Delta Y| > 2.2 \times |\Delta X|$ and $|\Delta Y| > 60$), children extend vertically along the Y-axis ($Y = P.y \pm 130$).
- **Radial Root Balancing:** When adding a child directly to a root node (no parent), the engine tallies left vs. right child distribution and automatically places the new branch on the less crowded side.

### B. Same-Column Sibling Alignment (`getNewSiblingPosition`)
- When selecting a node and clicking **`+ Sibling`** (or pressing `Enter`), the new bubble remains aligned in the **exact same horizontal column** ($X = \text{selected}.x$).
- Stacks neatly $55\text{px}$ below the selected node ($Y = \text{selected}.y + 55$) or below the lowest existing sibling in that column.

### C. Collision-Free Stacking (`avoidNodeCollision`)
- A global proximity check ($40\text{px}$ radius) scans all existing nodes across the canvas.
- If a target position collides with an existing bubble, the coordinates step downward ($+55\text{px}$) until an open slot is found, preventing overlapping bubbles.

---

## 4. Android & Mobile Touch Gestures System (PWA)

OmniMind natively supports smartphones and touchscreens while preserving 100% identical desktop behavior:

### A. Touch Engine
- **1-Finger Canvas Pan:** Smooth, natural viewport panning. Browser pull-to-refresh and swipe navigation are isolated via `touch-action: none` and `overscroll-behavior: none`.
- **2-Finger Pinch-to-Zoom:** Geometric scaling calculated directly from the dynamic midpoint between two finger contact points.
- **1-Finger Bubble Dragging:** Touch any bubble to drag it freely; child subtrees follow automatically.
- **Double-Tap Inline Edit:** Two rapid taps ($\le 350\text{ms}$) immediately activate the inline `<input>` field and invoke the device's virtual keyboard.
- **Touch Decoration Handles:** Resize and move background cards, zones, and sticky notes via touch.

### B. Responsive Drawer & Navigation
- **Off-Canvas Sidebar Drawer:** On mobile viewports ($< 768\text{px}$), the 320px sidebar collapses into a slide-out drawer (`#canvas-sidebar`) with an animated dark backdrop (`#mobile-sidebar-backdrop`), leaving 100% of the screen for the canvas.
- **Mobile Header Overflow (`⋮ More`):** High-frequency actions (`🌟 Root`, `+ Child`, `🎯 Fit`) remain pinned to the header, while secondary actions collapse into an interactive dropdown menu.

### C. Progressive Web App (PWA)
- Inline Web App Manifest supporting Chrome/Edge/Safari **"Add to Home screen"** / **"Install App"**.
- Launches in standalone fullscreen mode without browser URL bars, operating completely offline.

---

## 5. Floating Canvas Design Toolbar & Dropdown Engine

The floating canvas toolbar (`#canvas-design-toolbar`) provides quick access to visual organization tools:

- **Visible Overflow:** Configured with `overflow-visible` to allow absolute dropdown menus to float freely without boundary clipping.
- **Interactive Click & Tap Dropdowns:**
  - **🔲 Shape ▼:** Grouping Zone (`@zone`), Solid Card (`@card`), Circle Frame (`@circle`).
  - **🏷️ Text ▼:** Free Section Heading (`@textbox`), Sticky Guide Note (`@sticky`).
  - **🖼️ Image Guide ▼:** Enter Image URL (`promptImageGuideUrl`), Upload Local File (`handleImageGuideUpload`).
- **Auto-Close Behaviors:** Dropdowns close automatically on option selection, clicking outside anywhere on the canvas, or pressing the `Escape` key.
- **Layer Selection Lock:** Toggle button (`🔓 Selectable` / `🔒 Locked`) protects background shapes and sticky notes from accidental dragging while organizing bubbles.

---

## 6. Presentation Image & Document Export Engine

A high-resolution export engine capable of generating publication-ready diagram graphics:

- **Modal Dialog (`openExportImageModal()`):** Visual options for format, resolution multiplier, and diagram boundaries.
- **Formats:**
  - **PNG:** Lossless with full alpha transparency support.
  - **JPEG:** High-efficiency compressed photo rendering with clean white background.
  - **SVG:** Vector graphic format preserving native bezier curves and crisp text at any zoom level.
- **Resolution Multipliers:**
  - `1x` Standard Web Display.
  - `2x` Retina / High-DPI Display.
  - `3x` Ultra-HD / Print Resolution.
- **Clean Capture Pipeline:**
  - Temporarily strips selection halos, blue bounding rings, resize handles, and editor inputs.
  - Calculates the tight bounding rectangle enclosing all content.
  - Automatically restores all editor UI states immediately after capture.

---

## 7. Bubble Nodes & Typography System

- **Pill Shape Default:** `rounded-full px-5 py-2.5` with subtle elevation (`shadow-md`).
- **Dynamic Node Morphing:** Switches to vertical card format (`.has-attachment`) when media is attached.
- **Color Styling:** Independent background and foreground color pickers with 8 quick-palette presets and automatic luminance contrast calculation.
- **Typography:** Font size slider ($10\text{px}$ to $36\text{px}$) with Bold (`btn-bold`) and Italic (`btn-italic`) toggles.
- **Inline Editing:** Double-click or `F2` opens inline input (`.bubble-inline-input`). `Enter` commits, `Escape` cancels.
- **Badges & Flags:** One-click assignment of status emoji flags (`🚩`, `⭐`, `🔥`, `💡`, `📌`, `✅`, `⚠️`, `❓`) and custom uppercase tag chips (`[Tag]`).

---

## 8. Rich Media & Attachment Engine

- **Google Photos Resolver:** Extracts high-res `og:image` thumbnails from shared album links via CORS proxies.
- **Google Drive Resolver:** Converts shared file links into direct high-resolution thumbnail endpoints (`sz=w1000`).
- **Client-Side Compression (`compressImageFile`):** Resizes uploaded local images to a maximum dimension of 1920px in WebP/JPEG format to conserve browser storage quota.
- **Inline File Badges:** Non-image attachments (PDFs, docs) render as compact paperclip badges (`📎 filename`).

---

## 9. Background Design Layer Elements

1. **Grouping Zones (`@zone`):** Bounded regions with dashed borders and editable titles for grouping related bubbles.
2. **Backdrop Cards (`@card`):** Solid panels with subtle borders for structured cards.
3. **Circle Frames (`@circle`):** Radial focal circles for highlighting central concepts.
4. **Free Headings (`@textbox` / `@text`):** Large standalone text labels.
5. **Sticky Guide Notes (`@sticky`):** Yellow guide notes (`#fef08a`) for instructions and summaries.
6. **Image Guides (`@image`):** UI wireframes, blueprints, or reference photos positioned on the canvas.
- **Z-Index Controls:** Mini-toolbar supports 2-layer switching (`behind` $\leftrightarrow$ `front`) and fine-grained level stepping (`[` / `]`).

---

## 10. Canvas Background & High-Visibility Mouse Cursor System

- **Canvas Background Theme Selector:**
  - 6 Quick presets: Slate Default (`#f8fafc`), Pure White (`#ffffff`), Warm Paper (`#faf8f5`), Soft Mint (`#f0fdf4`), Midnight Dark (`#0f172a`), OLED Black (`#000000`).
  - Native HTML5 color picker with real-time hex code label (`#label-canvas-hex`).
- **Dynamic Luminance & Contrast Engine:**
  - Automatically assesses canvas background brightness:
    $$\text{Luminance } L = \frac{0.299R + 0.587G + 0.114B}{255}$$
  - For dark themes ($L < 0.45$), edge curve strokes automatically switch from `#cbd5e1` to high-contrast light slate (`#94a3b8`), dotted grid opacity increases for crisp definition, and the bottom-left instruction panel adapts to dark mode slate.
- **Grid Pattern Toggle:**
  - **Dots:** $40\text{px} \times 40\text{px}$ radial dot matrix.
  - **Plain:** Solid flat color background without grid markers.
- **High-Visibility Mouse Cursor System:**
  - Dual-tone SVG vectors rendered via inline data URIs with crisp white interior, dark `#0f172a` boundary strokes, and drop-shadows:
    - **High-Contrast Hand (`.cursor-mode-high-contrast`):** High-visibility grab / grabbing hand clearly visible over any dark, white, or colored background. Enabled by default.
    - **Precision Crosshair (`.cursor-mode-crosshair`):** Dual-ringed reticle with vibrant red center targeting dot for high-accuracy placement.
    - **System Standard:** Standard browser pointer.
- **Unified Access & Persistence:**
  - Configurable from both the floating design toolbar (`🎨 Canvas ▼`) and the left sidebar Properties panel (`🎨 Canvas & Cursor`).
  - Auto-saved across LocalStorage, IndexedDB, and Firebase Cloud projects, and synchronized across raster (PNG/JPEG) and vector (SVG) export.

---

## 11. Dual Code Synchronizer & Advanced DSL

Real-time bi-directional code synchronization via left sidebar tabs:

### A. Tab 1: Standard Markdown (`#panel-code`)
Hierarchical outline format for fast brainstorming:
```markdown
# Central Idea [Priority]
  - Sub-concept 1
    - Detail A
  - Sub-concept 2
```

### B. Tab 2: Advanced Code DSL (`#panel-advcode`)
Serializes coordinates, styling attributes, tags, attachments, and design elements:
```markdown
# Project Roadmap @ (700, 400) [Q1] {bg: #0f172a, fg: #ffffff, size: 22, bold}
- Architecture Review @ (460, 400) {bg: #eff6ff, fg: #1d4ed8, bold}
  - Storage Layer @ (220, 400)
  - UI Implementation @ (220, 455)
---
# Design Elements
@zone "Core Modules" @ (150, 320, 400, 260) {layer: behind, z: 1, bg: rgba(239, 246, 255, 0.45), border: dashed #3b82f6}
@sticky "📌 Milestone Goal\n- Deploy by Friday" @ (750, 200, 220, 160) {layer: front, z: 2, bg: #fef08a}
```

- **Debounced Compilation:** Typing in `#advcode_input` automatically compiles to the canvas.
- **Execution Hotkey:** `Ctrl + Enter` (or `Cmd + Enter`) compiles immediately.
- **LLM Compatibility:** Compatible with standard AI generation templates.

---

## 12. Multi-Tier Persistence & Storage Architecture

### A. Storage Tiers
| Tier | Technology | Storage Key / Store | Purpose |
| :--- | :--- | :--- | :--- |
| **Tier 0 (Cloud)** | **Firebase Cloud Firestore** | `users/{uid}/maps/{id}` | Cross-device synchronization and real-time collaboration. |
| **Tier 1 (Local Primary)** | **IndexedDB** | `omnimind_db` $\rightarrow$ `mindmap_store` | Unlimited local storage for high-res images, node coordinates, and design elements. |
| **Tier 2 (Local Fallback)** | **LocalStorage** | `omnimind_mindmap_v4_data` | Fast synchronous mirror with automatic quota self-healing. |

### B. Physical Location on Windows
In Chromium browsers (Microsoft Edge & Google Chrome), local data is stored in LevelDB binary format:
- **Edge:** `C:\Users\<User>\AppData\Local\Microsoft\Edge\User Data\Default\IndexedDB\`
- **Chrome:** `C:\Users\<User>\AppData\Local\Google\Chrome\User Data\Default\IndexedDB\`

### C. Live Auto-Save Status Badge
Header badge (`#save-status`) displays real-time status:
- 🟢 **`✓ Saved (HH:MM:SS)`**: Successfully saved to local IndexedDB and LocalStorage at that timestamp.
- 🟡 **`💾 Saving...`**: Active write in progress.
- 🔴 **`⚠️ Storage full`**: Quota warning alert.

---

## 13. Workspace Homepage & Starter Templates

- **Dashboard View (`#app-homepage-view`):** Full-screen project hub displaying all local and cloud mind maps with search filtering.
- **Starter Templates:**
  1. *Ideation & Brainstorm*
  2. *Project Roadmap*
  3. *Decision Matrix*
  4. *Concept Study*
- **Cloud Quota Meter:** Visual meter tracking free cloud slots ($X / 3$ used).

---

## 14. Team Collaboration & Access Control

- **Live Collaboration:** Shareable links (`?share=[ownerUid]:[mapId]`) with real-time Firestore synchronization.
- **Access Modes:** `restricted`, `view` (read-only with interaction guards), and `edit` (live multi-user editing).
- **Owner Copy Protection:** Option to disallow copying/exporting for sensitive proprietary diagrams.

---

## 15. Interaction & Shortcut Reference

### Mouse & Touch
| Gesture / Action | Target | Effect |
| :--- | :--- | :--- |
| **1-Finger Drag / Left Click Drag** | Canvas Background | Pan viewport |
| **2-Finger Pinch / Mouse Wheel** | Canvas Background | Smooth zoom centered on cursor/pinch |
| **1-Finger Drag / Left Click Drag** | Bubble Node | Move bubble + entire child subtree |
| **Double Tap / Double Click** | Bubble Node | Start inline text editing |
| **1-Finger Drag / Left Click Drag** | Resize Handle | Resize background shape/card/sticky |
| **Click / Tap** | Dropdown Buttons (`Shape`, `Text`, `Image`, `Canvas`) | Toggle interactive dropdown menu |

### Keyboard Shortcuts
| Shortcut | Context | Effect |
| :--- | :--- | :--- |
| `Tab` | Node selected | Create child node along parent line direction |
| `Enter` | Node selected | Create sibling node in the same column |
| `Delete` / `Backspace` | Node selected | Delete node and entire child subtree |
| `F2` | Node selected | Start inline text editing |
| `Delete` / `Backspace` | Decoration selected | Delete background design element |
| `[` / `PageDown` | Decoration selected | Send decoration 1 level backward |
| `]` / `PageUp` | Decoration selected | Bring decoration 1 level forward |
| `Escape` | Dropdown open / Modal open / Inline edit | Close menu, dismiss modal, or cancel edit |
| `Ctrl + Enter` | Code / Adv Code tab | Run and compile code immediately |

---

## 16. Data Schema Reference

### Mind Map Node Object
```javascript
{
  id: "n_1710000000_1",
  parentId: "root",          // null for independent root trees
  text: "Component Architecture",
  x: 460,
  y: 400,
  size: 18,
  weight: "bold",            // "normal" | "bold"
  style: "normal",           // "normal" | "italic"
  bg: "#3b82f6",
  fg: "#ffffff",
  flag: "🔥",                // Emoji flag
  tag: "Core",               // Uppercase chip badge
  attachment: "https://...", // Image URL, data URL, or doc link
  attachmentName: "spec.png"
}
```

### Canvas Decoration Object
```javascript
{
  id: "dec_1710000000_1",
  type: "shape",             // "shape" | "textbox" | "image"
  shapeType: "zone",         // "zone" | "card" | "circle"
  title: "Frontend Layer",
  text: "",
  x: 120,
  y: 80,
  width: 480,
  height: 320,
  bg: "rgba(239, 246, 255, 0.45)",
  borderColor: "#3b82f6",
  borderStyle: "dashed",     // "none" | "dashed" | "solid" | "dotted"
  borderWidth: 2,
  borderRadius: 16,
  opacity: 1,
  layer: "behind",           // "behind" | "front"
  zIndex: 1
}
```
