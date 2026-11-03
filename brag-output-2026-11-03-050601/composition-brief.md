# Hyperframes Composition Brief: Accessible Navigation

## Objective
Short launch-style brag video for Accessible Navigation, deadpan tone, dry engineering confession.

## Output
- Composition: `brag-output-2026-11-03-050601/composition/`
- Render: `brag-output-2026-11-03-050601/brag.mp4`
- Format: landscape 1920x1080, 25.0s, 30fps

## Source Material
- Files read: README.md, src/theme/tokens.ts, package.json, src/ structure
- Product name: Accessible Navigation
- Strongest claims (verbatim from README): "Guidance is geometry, not an overlay."; "~416 m · 11 min"; 763 m walk returning 8.0, 8.5, 10.0 km; 14,601 footways; four hazard classes at 10 Hz; "Grey behind, green ahead."
- Copy that must appear verbatim: "Accessible Navigation"; "~416 m · 11 min"; "14,601"; "Guidance is geometry, not an overlay."

## Creative Direction
Tone deadpan. Hook: "Asked for a 763 m walk, / Google offered 8.0 km." Outro: "Know what the pavement is like."
Avoid generic SaaS language, abstract filler, redesign.

## Visual Identity
bg #121212, text #E0E0E0, accent #1F6DD8, green #30D158, hazards #FF3B30 #0A84FF #FFD60A #FF9F0A; system sans.

## Audio
- Music: happy-beats-business-moves-vol-12, volume 0.16, fade-out at end
- Cue guidance: bundled preset (strong cues 8.74, 13.11, 17.47, 22.37)
- Audio-reactive: subtle bass-RMS glow (precomputed with ffmpeg+numpy into assets/rms.json; the media-use helper is not installed here)
- SFX: low-HF-risk files from sfx-analysis.md copied into assets/sfx/

## Hyperframes Instructions
Native Hyperframes conventions (paused GSAP timeline on window.__timelines, data-start/duration). The hyperframes/media-use skills are not installed in this environment, so conventions come from `npx hyperframes docs`. Gate: `npx hyperframes check`.
