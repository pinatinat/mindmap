# OmniMind AI Prompting Master Reference & Advanced Code Template

> **Purpose:** This file contains the official, comprehensive prompt template and specification for generating mind maps using **External Large Language Models** (e.g., ChatGPT, Claude, Gemini, DeepSeek, LLaMA) for import into **OmniMind Visual Mind Mapping & Workspace**.
>
> Whenever a new feature, attribute, or visual decoration is added to `MINDMAP.html` / `index.html`, this document is updated to reflect the full syntax and coordinate grammar.

---

## Quick Start: How to Generate Mind Maps with External LLMs

1. **Copy the [Master System Prompt](#1-master-system-prompt-for-llms)** below into your LLM chat (or custom instructions / system prompt).
2. **Provide your topic or source text** using the [User Prompt Template](#2-user-prompt-template).
3. **Copy the generated code block** from the LLM.
4. **In OmniMind:**
   - Click the left sidebar editor button (or press `Tab`).
   - Switch to the **Advanced Code** tab.
   - Paste the code into the text area.
   - Press **`Ctrl + Enter`** (or click **`▶ Render Advanced Code`**).
   - Your complete, interactive visual mind map with nodes, coordinates, and design elements will instantly render!

---

## 1. Master System Prompt for LLMs

*Copy and paste the entire block below into your external LLM as a system prompt or master instruction:*

```markdown
You are an expert visual information architect and mind mapping engine for OmniMind (v4.0).
Your task is to take any topic, document, strategy, or concept and convert it into a beautifully organized, spatially balanced visual mind map using OmniMind "Advanced Code" format.

### OUTPUT RULES & FORMAT:
1. Output ONLY the raw OmniMind Advanced Code inside a single ```markdown ... ``` code block.
2. Do not write introductory or concluding conversational text outside the code block.
3. Every node must follow the Advanced Code syntax:
   - Root node (Level 0): `# Topic Title @ (x, y) [OptionalTag] {optional_styles}`
   - Child node (Level 1, indent 2 spaces): `  - Sub-topic @ (x, y) [OptionalTag] {optional_styles}`
   - Sub-child (Level 2, indent 4 spaces): `    - Detail Item @ (x, y) [OptionalTag] {optional_styles}`
   - Sub-sub-child (Level 3, indent 6 spaces): `      - Micro-point @ (x, y) [OptionalTag] {optional_styles}`
4. Supports MULTIPLE independent roots: Start another line with `# Second Root @ (x, y)` to create a multi-tree canvas!
5. Design elements section (optional, placed at bottom):
   Separated by `---` and `# Design Elements`.
   Available elements:
   - `@zone "Title" @ (x, y, width, height) {layer: behind, z: 1, bg: rgba(239, 246, 255, 0.45), border: dashed #3b82f6}`
   - `@card "Title" @ (x, y, width, height) {layer: behind, z: 2, bg: #ffffff, border: solid #e2e8f0}`
   - `@circle "Spotlight" @ (x, y, width, height) {layer: behind, z: 1, bg: rgba(254, 243, 199, 0.35), border: dashed #f59e0b}`
   - `@sticky "📌 Guide Note content..." @ (x, y, width, height) {layer: front, z: 1, bg: #fef08a, color: #78350f}`
   - `@text "Section Title" @ (x, y, width, height) {layer: front, z: 1, size: 22, color: #0f172a, bg: transparent}`

### SPATIAL COORDINATE RULES (PREVENTS OVERLAPPING BUBBLES):
1. **X-Axis Progression (Left-to-Right Horizontal Tree Layout):**
   - Root Node: `X = 200`
   - Level 1 Children: `X = 520` (X + 320px)
   - Level 2 Children: `X = 840` (X + 320px)
   - Level 3 Children: `X = 1160` (X + 320px)
2. **Y-Axis Vertical Distribution:**
   - Sibling nodes MUST be vertically separated by at least `80px` to `100px` (e.g. `Y = 160`, `Y = 250`, `Y = 340`, `Y = 430`, `Y = 520`).
   - Center children vertically around their parent node's Y coordinate.
   - If there are multiple root trees, space each root tree at least `350px` to `500px` apart vertically (e.g. Root 1 at `Y = 250`, Root 2 at `Y = 650`).
3. **Design Element Bounding Boxes:**
   - A `@zone` or `@card` enclosing nodes must encompass their coordinates with ~40px margin:
     `x = minX - 40`, `y = minY - 40`, `width = (maxX - minX) + 80`, `height = (maxY - minY) + 80`.

### NODE STYLING ATTRIBUTES `{...}`:
- `bg`: Hex or rgb color for node bubble (e.g., `{bg: #ede9fe}`, `{bg: #ecfdf5}`, `{bg: #fef2f2}`)
- `fg`: Text color (e.g., `{fg: #4338ca}`, `{fg: #1e293b}`)
- `size`: Font size in px (e.g., `{size: 20}` for root, `{size: 16}` for branch, `{size: 14}` for leaf)
- `bold`: Make text bold (`{bold}`)
- `italic`: Make text italic (`{italic}`)
- `attachment`: URL or path to an image preview attached to the bubble (`{attachment: https://...}`)

### TAGS `[...]` AND EMOJIS:
- Prefix titles with thematic emojis (e.g., 💡, 🚀, ⚙️, 📊, 🎯, ⚖️, ⚠️, ✅, 📌).
- Add contextual tags at the end of the line (e.g., `[Phase 1]`, `[High Priority]`, `[Approved]`, `[Core IP]`, `[Q3 Release]`).
```

---

## 2. User Prompt Template

When prompting the LLM with your topic, use this concise format:

```text
Please build an OmniMind Advanced Code mind map for the following topic:

Topic: [Insert your topic, concept, project, or paste notes/article here]

Requirements:
- Structure: Multi-level hierarchy (Root, Branches, Sub-branches, Action Items)
- Visuals: Provide exact @(x, y) coordinates with balanced vertical and horizontal spacing
- Badges: Add meaningful tags [Like This] to key nodes
- Design: Include at least one background @zone or @card to group related ideas, and one @sticky note summarizing key takeaways or next steps
```

---

## 3. Comprehensive Reference Examples

### Example 1: Full Product Launch & Strategy (Multi-Root + Zones + Sticky Note)

```markdown
# 🚀 Project Titan: Product Launch Vision @ (200, 320) [Strategic] {bg: #ffffff, fg: #1e293b, size: 22, bold}
  - 🎯 Phase 1: Research & Discovery @ (540, 180) [Q1] {bg: #eff6ff, fg: #1e40af, bold}
    - User Interviews & Surveys @ (860, 140) [30+ Cohorts]
    - Competitive Landscape Matrix @ (860, 220) [Deep Dive]
  - ⚙️ Phase 2: MVP Architecture & Core Engine @ (540, 320) [Q2] {bg: #f5f3ff, fg: #5b21b6, bold}
    - Cloud Sync & Realtime Database @ (860, 290) [Firestore]
    - Local-First Offline Cache @ (860, 360) [IndexedDB]
  - 📈 Phase 3: Go-to-Market & Monetization @ (540, 480) [Q3] {bg: #f0fdf4, fg: #166534, bold}
    - Lifetime Pro One-Time Upgrade @ (860, 440) [PayMongo]
    - Product Hunt & Community Launch @ (860, 520) [Viral Loop]

# 🛡️ Governance & Risk Mitigation @ (200, 750) [Safety] {bg: #fffbeb, fg: #92400e, size: 20, bold}
  - 🔒 Data Privacy & Soft-Cap Protection @ (540, 710) [Zero Loss]
    - Automatic Local Backup on Save @ (860, 670)
    - Granular Team Role Permissions @ (860, 750) [View/Edit]
  - ⚡ System Redundancy & Failover @ (540, 830) [99.9% SLA]
    - Multi-Model AI Fallbacks @ (860, 830) [Gemini 2.5]

---
# Design Elements
@zone "Core Engineering & Launch Pipeline" @ (500, 90, 430, 480) {layer: behind, z: 1, bg: rgba(238, 242, 255, 0.5), border: dashed #6366f1, radius: 20}
@card "Governance Boundary" @ (160, 640, 760, 260) {layer: behind, z: 1, bg: rgba(254, 252, 232, 0.5), border: solid #fef08a, radius: 16}
@sticky "📌 Launch Checklist\n• Finalize PayMongo Webhook\n• Verify Soft-Cap Cloud limits\n• Run mobile responsive smoke tests" @ (980, 240, 260, 180) {layer: front, z: 2, bg: #fef08a, color: #713f12}
```

---

### Example 2: Technical Architecture & System Design

```markdown
# 🧠 Cognitive AI Pipeline @ (200, 300) [Architecture] {bg: #ffffff, fg: #0f172a, size: 22, bold}
  - 📥 Ingestion & Preprocessing @ (540, 160) [Stream]
    - PDF & Markdown Chunking @ (860, 120) [1000 Tokens]
    - Multimodal Media Parsing @ (860, 200) [OCR / Audio]
  - ⚡ Vector Store & Retrieval @ (540, 300) [Semantic]
    - Hybrid Dense + Sparse Search @ (860, 260) [BM25 + HNSW]
    - Reranking Engine @ (860, 340) [Cross-Encoder]
  - 🤖 LLM Reasoning & Synthesis @ (540, 440) [Inference]
    - Primary Reasoning Model @ (860, 410) [Gemini 2.5 Pro]
    - Low-Latency Fallback @ (860, 480) [Gemini 2.5 Flash]

---
# Design Elements
@zone "Retrieval-Augmented Generation (RAG)" @ (500, 80, 430, 450) {layer: behind, z: 1, bg: rgba(240, 253, 250, 0.6), border: dashed #14b8a6, radius: 18}
@sticky "💡 Optimization Note:\nReranking reduces context hallucinations by 42% on complex queries." @ (980, 320, 240, 150) {layer: front, z: 2, bg: #dcfce7, color: #14532d}
```

---

### Example 3: Brainstorming & Strategic Decision Matrix

```markdown
# ⚖️ Strategic Decision: SaaS vs Custom Build @ (250, 320) [Executive] {bg: #ffffff, size: 22, bold}
  - 🏢 Option A: Custom In-House Build @ (570, 180) [High IP]
    - Complete UX & brand control @ (880, 140)
    - Full proprietary IP ownership @ (880, 220)
  - ☁️ Option B: Off-the-Shelf SaaS @ (570, 320) [Speed]
    - Instant time-to-market @ (880, 290)
    - Vendor maintenance & updates @ (880, 360)
  - 📊 Decision Criteria @ (570, 480) [Evaluation]
    - Time to MVP: 3 wks vs 6 mos @ (880, 440)
    - 3-Year Total Cost of Ownership @ (880, 520)

---
# Design Elements
@circle "Recommended Path" @ (530, 250, 430, 170) {layer: behind, z: 1, bg: rgba(254, 243, 199, 0.4), border: dashed #f59e0b}
@sticky "🏆 Final Recommendation:\nStart with Option B (SaaS) to validate PMF within 30 days, then migrate critical microservices in-house." @ (960, 220, 270, 180) {layer: front, z: 2, bg: #fef08a, color: #854d0e}
```

---

## 4. Full Syntax & Property Specification Reference

### Node Line Grammar
```text
[Indentation][Prefix] [Emoji] [Title Text] [@ (x, y)] [[Tag]] [{styles}]
```

| Element | Format / Values | Examples |
| :--- | :--- | :--- |
| **Root Node** | Starts with `# ` (0 indent spaces) | `# Project Vision @ (200, 300)` |
| **Level 1 Child** | Starts with `  - ` (2 indent spaces) | `  - Strategy @ (520, 200)` |
| **Level 2 Child** | Starts with `    - ` (4 indent spaces) | `    - Implementation @ (840, 200)` |
| **Level 3 Child** | Starts with `      - ` (6 indent spaces) | `      - Unit Tests @ (1160, 200)` |
| **Coordinates** | `@ (X, Y)` or `@ X, Y` or `(X, Y)` at end | `@ (520, 300)` |
| **Tag Badge** | Enclosed in brackets: `[Tag Text]` | `[In Progress]`, `[Phase 1]`, `[Critical]` |
| **Style Block** | Enclosed in braces: `{key: value, ...}` | `{bg: #eff6ff, fg: #1e3a8a, bold, size: 16}` |

### Supported Node Style Attributes `{...}`
- `bg: <color>` — Background hex, rgb, or named color (e.g., `#ede9fe`, `rgba(240, 253, 244, 0.8)`).
- `fg: <color>` — Font / text color (e.g., `#374151`, `#ffffff`).
- `size: <number>` — Font size in pixels (e.g., `14`, `16`, `18`, `20`, `24`).
- `bold` — Toggles font weight bold.
- `italic` — Toggles font style italic.
- `attachment: <url>` — Attaches an image or document preview banner to the node.

---

### Design Layer Element Directives

All design elements are listed after `---` or `# Design Elements`:

```text
@[kind] "[Title / Content]" @ (x, y, width, height) {attributes}
```

| Directive | Purpose | Default Size | Example Attributes |
| :--- | :--- | :--- | :--- |
| **`@zone`** | Boundary / grouping zone with dashed or solid border | `380 x 250` | `{layer: behind, z: 1, bg: rgba(239, 246, 255, 0.5), border: dashed #3b82f6, radius: 16}` |
| **`@card`** | Solid content container card | `320 x 200` | `{layer: behind, z: 2, bg: #ffffff, border: solid #e2e8f0, radius: 12}` |
| **`@circle`** | Spotlight highlight circle | `260 x 260` | `{layer: behind, z: 1, bg: rgba(254, 243, 199, 0.35), border: dashed #f59e0b}` |
| **`@sticky`** | Tactile yellow/custom guide note with drag grip handle | `220 x 180` | `{layer: front, z: 1, bg: #fef08a, color: #78350f, size: 14}` |
| **`@text`** | Floating standalone heading or section label | `260 x 60` | `{layer: front, z: 1, size: 24, color: #0f172a, bg: transparent}` |
| **`@image`** | Floating reference diagram, wireframe, or sticker | `400 x 300` | `{layer: behind, z: 1, opacity: 0.9, radius: 10}` |

#### Design Element Attribute Options:
- `layer`: `behind` (under the node bubbles and connector lines) or `front` (floating over nodes).
- `z`: Integer z-index within that layer (e.g., `z: 1`, `z: 2`).
- `bg`: Background color fill (e.g., `#ffffff`, `#fef08a`, `rgba(238, 242, 255, 0.5)`).
- `color`: Font color for text in sticky notes or textboxes.
- `border`: `<style> <color>` (e.g., `border: dashed #3b82f6`, `border: solid #cbd5e1`, `border: none`).
- `radius`: Border corner radius in px (e.g., `radius: 16`).
- `opacity`: Number from `0` to `1` (e.g., `opacity: 0.85`).

---

## 5. Alternative JSON Schema (For LLM JSON Mode / Structured Outputs)

If using external APIs with JSON mode (e.g., OpenAI `response_format: { type: "json_object" }` or Gemini `responseMimeType: "application/json"`), the LLM can generate the following JSON payload, which the **Advanced Code** editor will parse and render automatically:

```json
{
  "name": "Project Titan Strategy",
  "nodes": {
    "root": {
      "id": "root",
      "parentId": null,
      "text": "🚀 Project Titan Vision",
      "tag": "Master",
      "x": 200,
      "y": 300,
      "size": 22,
      "weight": "bold",
      "bg": "#ffffff",
      "fg": "#0f172a"
    },
    "c1": {
      "id": "c1",
      "parentId": "root",
      "text": "🎯 Phase 1: Research",
      "tag": "Q1",
      "x": 540,
      "y": 200,
      "weight": "bold",
      "bg": "#eff6ff",
      "fg": "#1e40af"
    },
    "c1_1": {
      "id": "c1_1",
      "parentId": "c1",
      "text": "User Interview Cohorts",
      "x": 860,
      "y": 160
    },
    "c1_2": {
      "id": "c1_2",
      "parentId": "c1",
      "text": "Competitive Benchmark",
      "x": 860,
      "y": 240
    }
  },
  "canvasDecorations": {
    "dec_zone_1": {
      "id": "dec_zone_1",
      "type": "shape",
      "shapeType": "zone",
      "title": "Discovery Zone",
      "x": 500,
      "y": 110,
      "width": 430,
      "height": 200,
      "layer": "behind",
      "zIndex": 1,
      "bg": "rgba(239, 246, 255, 0.45)",
      "borderColor": "#3b82f6",
      "borderStyle": "dashed",
      "borderRadius": 16
    }
  }
}
```

---

## 6. Maintenance & Feature Update Sync Protocol

Whenever changes are made to the visual engine or storage formats in `MINDMAP.html` / `index.html`:
1. Check if new node properties (e.g., custom border styles, icon flags, line connectors) were added to `cleanNodesForStorage` or `syncFromMap`.
2. Check if new design layer elements or directives (e.g., new shape types, freehand annotations) were added to `canvasDecorations`.
3. Update this `aitemplate.md` file so external LLM prompts always produce code taking full advantage of the newest OmniMind features!
