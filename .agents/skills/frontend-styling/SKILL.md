---
name: frontend-styling
description: Design the frontend for DriveSense, a quiet file hygiene extension that watches, detects, and surfaces file organization suggestions. The interface should feel calm, trustworthy, and useful — never loud, playful, or overly decorative.
---

# DriveSense Frontend Styling Skill

## 1. Product Identity & Design Principles
DriveSense is a silent assistant for file hygiene. It suggests, never acts.
The UI should feel calm, precise, lightweight, and trustworthy.

**Core Rules:**
- **One focus at a time:** One primary focus, one optional action, one graceful exit.
- **Simplicity through hierarchy:** Prefer spacing over borders, typography over color, flat surfaces over depth.

**Anti-Patterns (Avoid at all costs):**
- Red or aggressive warning colors
- Warning, urgent, or imperative language ("Fix now", "Warning")
- Decorative gradients, excessive whitespace, or visual noise
- Flashy interactions, spring physics, bouncing, or long spinners
- Stacked competing actions

---

## 2. Supported Surfaces & Architecture

| Surface | Purpose | Tech Context |
|---|---|---|
| Extension Popup (~360px) | Quick review and lightweight actions | Vite + React + Manifest V3 |
| Content Overlay | Injected inline contextual suggestions | Must use isolated styling (`style.cssText` or shadow DOM) |
| Settings Page (max 640px) | Single-column config and scope management | React + Vite |

---

## 3. Color System
Use CSS variables only. Never use pure white or pure black. Never use red.

```css
/* Light mode */
--bg-base: #F7F5F2;
--bg-surface: #EFECE8;
--bg-hover: #E8E4DE;

--text-primary: #1C1A17;
--text-secondary: #6B6560;
--text-ghost: #A09890;

--accent: #5C7A6E;
--accent-hover: #4A6659;

--signal: #C47B3A;

--border: #DDD9D3;
--border-subtle: #E8E4DE;

/* Dark mode */
--bg-base: #181613;
--bg-surface: #221F1B;
--bg-hover: #2A2720;

--text-primary: #EDE9E3;
--text-secondary: #8C8278;
--text-ghost: #5C5650;

--accent: #7BA394;
--accent-hover: #8FB5A8;

--signal: #D4904A;

--border: #2E2B26;
--border-subtle: #252320;
```

---

## 4. Typography
```css
--font-display: 'Fraunces', serif;
--font-body: 'Plus Jakarta Sans', sans-serif;
--font-mono: 'IBM Plex Mono', monospace;
```

---

## 5. Spacing & Shape
```css
--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
--space-5: 20px; --space-6: 24px; --space-8: 32px;

--radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;
```

---

## 6. Core UI Patterns

**Suggestion Card Anatomy:**
```text
[icon] Title
       One-line explanation

[Primary action]   [Not now]
```
- Only actions are interactive.
- Primary actions should feel invitational (e.g., "Review duplicates?", "Move to archive?").

**Popup Structure:**
1. **Header:** Wordmark, current context, status indicator.
2. **Status strip:** "Watching 3 items", "Nothing to flag right now".
   - Dot pulses sage when clear, static amber when pending items exist.
3. **Suggestion list:** Vertical stack (max ~4 visible).
4. **Footer:** Simple text link to Settings.

---

## 7. Microcopy Guidelines

| Avoid | Prefer |
|---|---|
| Scanning | Watching |
| Warning | Worth reviewing |
| Archive now | Move to archive? |
| Dismiss | Not now |
| Error | Couldn't reach Drive right now |
| No issues found | Nothing to flag right now |

---

## 8. Implementation Notes
- **API Keys:** BYOK keys must stay in local browser storage. Never send to backend.
- **Tokens:** Always use defined CSS variables. Never hardcode hex values.
- **Motion:** Simple fades (`opacity` transitions) only.

*Final Reminder: DriveSense is not productivity theater. The interface succeeds when users stop noticing it and simply trust it.*
