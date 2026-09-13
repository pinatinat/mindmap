# OmniMind - Mind Map Documentation

## 1. System Overview

**OmniMind - Free Floating Bubbles** is an interactive, visual mind-mapping single-page application (SPA). It combines a free-floating multi-root canvas graph engine, dynamic SVG cubic bezier edges, a dedicated background design layer, cloud synchronization, and native touch support into a single standalone HTML application.

- **Primary Entry Points:** [`MINDMAP.html`](file:///c:/Users/User/OneDrive/Documents/PROJECT/MindMap/MINDMAP.html) and [`index.html`](file:///c:/Users/User/OneDrive/Documents/PROJECT/MindMap/index.html)
- **Codebase Scale:** ~7,376 lines of self-contained HTML, CSS, and vanilla JavaScript.
- **Key Philosophy:** Zero external build steps, 100% offline capability, zero data loss via multi-tier persistence, and seamless parity between desktop and mobile devices.

---

## 2. Core Functional Systems

### A. Graph & Canvas Engine
1. **Multi-Root Forest Graph:** Supports creating any number of independent root trees (`parentId === null`) on a single continuous canvas.
2. **Dynamic Bezier Edges:** Real-time SVG cubic bezier curves calculated from node center coordinates:
   $$\text{Path: } M(x_p, y_p) \to C\left(x_p + \frac{dx}{2.5}, y_p, x_n - \frac{dx}{2.5}, y_n, x_n, y_n\right)$$
3. **Recursive Subtree Drag Propagation:** Dragging any parent bubble automatically translates its entire branch of children and grandchildren while maintaining relative layout.
4. **Infinite Panning & Smooth Zooming:** GPU-accelerated canvas transforms with smooth cursor-centric scaling from $0.2\times$ to $3.0\times$.

### B. Intelligent Directional Node Placement
1. **Parent Edge Vector Analysis (`getNewChildPosition`):**
   - Automatically determines whether a branch is extending to the left ($\Delta X < -15$), to the right ($\Delta X > 15$), or vertically ($|\Delta Y| > 2.2 \times |\Delta X|$).
   - Newly created children spawn outward along that exact trajectory, preventing cross-line intersections.
2. **Column Sibling Stacking (`getNewSiblingPosition`):**
   - Creates sibling nodes aligned in the exact same vertical column on that side ($X = \text{selected}.x$).
   - Stacks them neatly $55\text{px}$ below the selected node.
3. **Collision-Free Auto-Offset (`avoidNodeCollision`):**
   - Automatically checks for existing nodes within a $40\text{px}$ radius and steps down to ensure bubbles never spawn on top of each other.

### C. Android & Touch Gesture System (PWA)
1. **Multi-Touch Gestures:**
   - 1-finger canvas pan with browser gesture isolation (`touch-action: none`).
   - 2-finger fluid pinch-to-zoom centered on the touch midpoint.
   - 1-finger bubble drag with recursive subtree movement.
   - Double-tap inline editing for mobile virtual keyboards.
2. **Responsive Drawer & Header:**
   - Off-canvas sidebar sliding drawer (`#canvas-sidebar`) with tap-to-close blurred backdrop (`#mobile-sidebar-backdrop`) for narrow viewports ($< 768\text{px}$).
   - Mobile overflow menu (`⋮ More`) consolidating secondary actions.
3. **Progressive Web App (PWA):**
   - Standalone fullscreen mode with home screen installation.

### D. Canvas Design Layer
1. **Visual Elements:**
   - Grouping Zones (`@zone`) with customizable dashed borders and labels.
   - Solid Cards (`@card`) for structured sections.
   - Focal Circles (`@circle`) for radial emphasis.
   - Standalone Text Headings (`@textbox`).
   - Sticky Notes (`@sticky`) with warm note-taking styling.
   - Image Guides (`@image`) for UI mockups, blueprints, or reference photos.
2. **Interactive Dropdowns:**
   - Dropdown buttons (`Shape ▼`, `Text ▼`, `Image Guide ▼`) on the floating toolbar with click/tap toggle and click-outside dismissal.
3. **Layer Z-Indexing:**
   - 2-layer architecture (`behind` nodes at $z = 5$, `front` of nodes at $z = 25$) with granular level reordering.
   - Layer selection lock toggle (`🔓 Selectable` / `🔒 Locked`).

### E. Presentation Image Export Engine
1. **High-Resolution Multi-Format Modal (`openExportImageModal`):**
   - **PNG:** Lossless alpha transparency.
   - **JPEG:** Clean white background photo compression.
   - **SVG:** Scalable vector curves preserving mathematical paths.
2. **Resolution Multipliers:** $1\times$ (Web), $2\times$ (Retina/DPI), $3\times$ (Print/Ultra-HD).
3. **Clean Artifact Suppression:** Automatically hides selection halos, blue bounding rings, resize handles, and editor inputs during capture.

### F. Canvas Background & High-Visibility Mouse Cursor System
1. **Background Themes & Presets (`applyCanvasTheme`):**
   - 6 Quick presets: Slate Default (`#f8fafc`), Pure White (`#ffffff`), Warm Paper (`#faf8f5`), Soft Mint (`#f0fdf4`), Midnight Dark (`#0f172a`), OLED Black (`#000000`).
   - HTML5 custom color picker with live hexadecimal display (`#label-canvas-hex`).
   - **Dynamic Contrast Engine:** Calculates luminance ($L < 0.45$). Dark backgrounds automatically adapt SVG edge strokes to light slate (`#94a3b8`), adjust dotted grid opacity, and switch bottom shortcut instructions to dark slate.
2. **Grid Pattern Toggle:**
   - Dotted Grid ($40\text{px}$ radial gradient) or Plain Solid background.
3. **High-Visibility Dual-Tone Mouse Cursors:**
   - Custom SVG data URI cursors engineered to remain crisp and distinct against any background color or dense bubble clusters:
     - **High-Contrast Hand (`.cursor-mode-high-contrast`):** Bright white interior, dark `#0f172a` boundary stroke, and drop shadow. Enabled by default.
     - **Precision Crosshair (`.cursor-mode-crosshair`):** Dual-ringed reticle with vibrant red center targeting dot.
     - **System Standard:** Default browser grab/grabbing pointer.
4. **Dual Access Points:**
   - Floating design toolbar dropdown (`🎨 Canvas ▼`).
   - Left sidebar Properties panel (`🎨 Canvas & Cursor` section).
5. **Persistence & Export Support:**
   - Theme and cursor settings persist in LocalStorage, IndexedDB, and Firebase Cloud projects.
   - Preserved in raster (PNG/JPEG) and vector (SVG) export options.

### G. Dual Code & DSL Synchronization
1. **List Outline Mode (`#panel-code`):** Clean Markdown list format for quick outlining.
2. **Advanced Code DSL (`#panel-advcode`):** Serializes coordinates, node styling, tags, attachments, and background design directives into plain text.
3. **LLM Generation Friendly:** Formatted for easy prompting with large language models (ChatGPT, Claude, Gemini).

### H. Multi-Tier Persistence & Storage Architecture
1. **Tier 1 (Local Primary - IndexedDB):** `omnimind_db` $\rightarrow$ `mindmap_store` stores full project snapshots, node positions, design elements, and high-res uploaded assets without storage quota limits.
2. **Tier 2 (Local Fallback - LocalStorage):** `omnimind_mindmap_v4_data` mirror with self-healing quota auto-sanitization.
3. **Tier 0 (Cloud - Firebase Firestore):** Optional cloud storage (`users/{uid}/maps/{id}`) with Google authentication, guest sign-in, and live collaboration snapshot synchronization.
4. **Live Auto-Save Indicator:** Header badge (`#save-status`) flashing `✓ Saved (HH:MM:SS)` on every change commit.

---

## 3. Keyboard & Gesture Reference

| Action | Shortcut / Gesture | Target |
| :--- | :--- | :--- |
| **Add Child** | `Tab` | Selected Node |
| **Add Sibling** | `Enter` | Selected Node |
| **Delete Node** | `Delete` / `Backspace` | Selected Node |
| **Inline Edit** | Double-Click / Double-Tap / `F2` | Selected Node |
| **Pan Canvas** | 1-Finger Drag / Left-Click Drag | Background Canvas |
| **Zoom Canvas** | 2-Finger Pinch / Mouse Wheel | Background Canvas |
| **Fit to Screen** | Click `🎯 Fit` button | Canvas Toolbar |
| **Run Code** | `Ctrl + Enter` / `Cmd + Enter` | Code / Adv Code Editor |
| **Close Menu / Modal** | `Escape` / Tap Backdrop | Any open modal or dropdown |

---

## 4. File Maintenance & Deployment Notes

- Both [`MINDMAP.html`](file:///c:/Users/User/OneDrive/Documents/PROJECT/MindMap/MINDMAP.html) and [`index.html`](file:///c:/Users/User/OneDrive/Documents/PROJECT/MindMap/index.html) are maintained identically to enable seamless local execution and direct one-click deployment on platforms like Vercel, Netlify, or GitHub Pages.
