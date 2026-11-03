# Brag Plan: Accessible Navigation

## What is this app?
A pedestrian navigation app that plans walking routes around barriers (steps, kerbs, steep gradients), flags pavement hazards in the camera at 10 Hz, and draws the route onto the ground in AR.

## The angle
Every other map app answers "which way do I turn?". This one answers "what is the pavement like?" The video is a quiet, confident product film built on the README's own claims: "Guidance is geometry, not an overlay", "Width is an admission, not a style", "Colour is never the only signal".

## Hook (0–3s)
Text on dark: "Every map tells you where to turn." Beat. "None tell you about the step."

## Key moments
- Route screening: four mobility profiles (none, wheelchair, cane, walker) switch, and the same route is re-judged. Steps with a handrail are passable with a cane, not in a wheelchair.
- AR chevrons: green chevrons laid on the pavement, grey behind and green ahead, cut where the walker stands.
- Hazard detection: four boxes (pothole #FF3B30, slippery surface #0A84FF, uneven surface #FFD60A, pathway obstruction #FF9F0A) appear one by one over a street frame.

## Outro / punchline
"Accessible Navigation" over the destination pin, then "Know the pavement before you step on it." (framing line, asserts nothing new).

## User flow worth showing
Search a place -> `~416 m · 11 min` suggestion -> pick mobility aid -> route preview with barrier verdict -> AR chevrons -> hazard box -> "Arrived".

## Tone
- Preset: polished
- Creative direction: quiet premium product film
- Interpretation: few scenes, long holds, restraint; the accessibility story carries the weight, no jokes at the user's expense.

## Format: landscape — 1920x1080
## Duration: 20s

## Visual identity (from src/theme/tokens.ts)
- Background: #121212 (dark) with #f9f8f5 light cards
- Accent: #1f6dd8; deep #004296
- Text: #E0E0E0 on dark, #181611 on light
- Guidance green: #30D158
- Display/body font: system (SF Pro on iOS); fallback Inter
- Strongest visual element: the AR chevron run and the four hazard colours

## Share copy (draft)
Most maps tell you where to turn. We built one that tells you what the pavement is like: steps, kerbs, potholes, and AR chevrons on the ground. Final Year Project, Kuala Lumpur.

## Audio direction
- Role: warm bed with sparse professional accents
- Music: bundled "happy-beats-business-moves" track (120 BPM), low, fade out on the last scene
- Music cue guidance: lock the pin reveal to a strong cue; hazard boxes snap to consecutive beats (every other beat as they are not text)
- Audio-reactive: subtle; chevron glow breathes with bass
- SFX: sparse, soft UI ticks on profile switch and hazard boxes
- Restraint: no risers, no sound on text-only hook

## Storyboard
### Scene 1 — Hook — 4s
Two lines, 1.2s hold each. Transition: soft crossfade.
### Scene 2 — Profiles — 5s
Four profile chips switch in sequence; barrier verdict changes. "Steps with a handrail" text. Transition: slide.
### Scene 3 — AR chevrons — 5s
Chevron run draws along a pavement, grey behind and green ahead. "Guidance is geometry, not an overlay." Transition: soft crossfade.
### Scene 4 — Hazards — 4s
Four boxes appear one by one with the four colours. Transition: soft crossfade.
### Scene 5 — Outro — 2s
Pin lands, name, tagline, music fades.
