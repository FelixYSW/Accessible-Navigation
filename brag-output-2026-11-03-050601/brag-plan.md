# Brag Plan: Accessible Navigation (full run, new angle)

## What is this app?
A pedestrian navigation app that plans walking routes around barriers, flags pavement hazards in the camera at 10 Hz, and draws the route onto the ground in AR. iOS-first Final Year Project, Kuala Lumpur.

## The angle
The first video (brag-output/) opened on "the step". This one opens on the engineering confession from the README's "Why OpenStreetMap for routing": asked for a 763 m walk, Google returned alternatives of 8.0, 8.5 and 10.0 km. OSM has 14,601 footways in the same area. So the app is built on the right map, then everything the README is proud of follows: barrier verdicts per mobility aid, AR chevrons that are geometry, four hazard classes.

## Hook (0-3s)
"Asked for a 763 m walk," / "Google offered 8.0 km." Then three route pills land: 8.0 km, 8.5 km, 10.0 km.

## Key moments
- OSM footway count rolling up to 14,601, a footpath network drawing in behind it.
- Search suggestion `~416 m · 11 min`, then the mobility chips: Wheelchair -> steps with a handrail: Not passable (x glyph). Cane -> Passable (check glyph). Colour is never the only signal.
- AR chevrons: grey behind, green ahead, destination pin landing at the end of the run. "Guidance is geometry, not an overlay."
- Four hazard boxes (pothole, slippery surface, uneven surface, pathway obstruction) in the exact app colours, each with its own glyph.

## Outro / punchline
Pin lands, "Accessible Navigation", then "Know what the pavement is like." (README: "need to know what the pavement is like, not just which way to turn").

## User flow worth showing
Search -> `~416 m · 11 min` suggestion -> pick mobility aid -> barrier verdict -> AR chevrons -> hazard box.

## Tone
- Preset: deadpan
- Creative direction: dry engineering confession, polished product finish
- Interpretation: long holds, one idea per scene, numbers do the talking; no jokes beyond the 8.0 km deadpan.

## Format: landscape - 1920x1080
## Duration: 25.0s (every text line held to its reading floor; at the 25s cap)

## Visual identity (src/theme/tokens.ts)
- Background #121212, cards #1E1E1E, text #E0E0E0, muted #A6A6A6
- Accent #1F6DD8 (light #6AA5FF for text); guidance green #30D158; red #FF453A
- Hazard colours #FF3B30 / #0A84FF / #FFD60A / #FF9F0A
- Font: system sans (SF Pro in app; Helvetica/Liberation fallback in render)
- Stand-ins: destination name "Pavilion Kuala Lumpur" is a plausible placeholder, not project data.

## Share copy (draft)
See share-copy.txt.

## Audio direction
- Role: warm bed with sparse professional accents
- Music: happy-beats-business-moves-vol-12 (109.96 BPM), volume 0.16, fade-in 0.5s, fade-out last 2s
- Music cue guidance (bundled preset vol-12): strong cues 8.74 (count lands), 13.11 (cane verdict), 17.47 (pin lands), 22.37 (logo). Beat grid for sequential reveals: pills 2.73/3.27/3.82; hazards 19.10/19.66/20.19/20.75.
- Audio-reactive treatment: subtle; bass RMS (<220 Hz) modulates a soft accent glow behind the frame. No waveform visuals.
- SFX posture: sparse, motion-matched, low high-frequency-risk files
- Restraint: no risers, no sound on text-only hook lines

## Storyboard
### Scene 1 - Hook - 5.0s
Two lines (0.3s, 1.6s) then three pills on beats. Sequential text hold: lines ~3s, pills >=1.1s.
Transition: soft crossfade -> 2
### Scene 2 - Footways - 4.8s (5.0-9.83)
"OpenStreetMap" label, count-up to 14,601 locking to the 8.74 cue, "footways in the same area" under it, footpath network drawing in.
Transition: soft crossfade -> 3
### Scene 3 - Flow - 5.5s (9.83-15.29)
Search row `~416 m · 11 min`; four chips; Wheelchair selected on beat 11.46 -> "Steps with a handrail: Not passable"; Cane selected at 13.11 -> "Passable".
Transition: soft crossfade -> 4
### Scene 4 - AR - 3.3s (15.29-18.56)
Chevron run, grey behind green ahead, pin lands on cue 17.47. "Guidance is geometry, not an overlay." / "Grey behind, green ahead."
Transition: soft crossfade -> 5
### Scene 5 - Hazards - 3.3s (18.56-21.84)
Camera frame, four boxes on consecutive beats, caption "Four classes. On-device. 10 Hz."
Transition: soft crossfade -> 6
### Scene 6 - Outro - 3.0s (21.84-25.0)
Pin, "Accessible Navigation" on 22.37, tagline 22.55, fade out 24.7-25.0.

**Music mood:** quiet corporate bed. **Audio summary:** low bed throughout, one soft impact when 14,601 lands, clicks for the two selections, a soft bell on the name.
