---
status: approved
---

# Design brief: HandsOn

<!-- Filled in by plan-lens from the learner's interview. Use the learner's words. Mark any value they didn't choose as (default). -->

## The one spatial moment
I'm sitting on the couch with my wife's legs on my lap. I pinch her calf and it lights up: arrows show which direction to massage, and ghost hands show how my hands should be positioned, looping the stroke along the calf until I pinch the shin or the sole to switch.

## Why it belongs on glasses
- Uses: draws in the world (the guide sits on the leg itself, at real size); leaves your body free (both hands stay on the leg, eyes stay on the leg).
- Why it's better than the phone or laptop version: with a phone video you keep looking away and stopping to copy the stroke. Here the direction and hand position are drawn right on the muscle you're working on, and switching parts is one pinch on that part.

## Product or overlay
- Type: product. A simple, non-expert guide that teaches basic recovery massage strokes on the lower leg (calf, shin, sole). Framed as fitness / sore-legs recovery, clinical wording only.
- What the real version would sense: the real leg's position (so the guide lines up on it) and the user's hand path (to check direction).
- Stand-in for the preview:
  - A life-size virtual lower leg (knee down to foot), plain light grey anatomy-style model, resting across a lap at couch height. The guide plays on this leg. (On real glasses later, the user would grab and drag the guide onto the real leg once to line it up; not built now.)
  - Direction check: the mouse stands in for the hand. Pinch the start of a zone's arrow and drag along the leg; following the arrow's direction turns it green. On glasses this would become real hand tracking.

## Where things live
- Where the user is looking during the main task: down at their lap, at the leg, about 50 cm away and below eye level.
- Leg: lying sideways across the user's lap (left-right in front of them), knee on one side, sole facing out to the other (default: knee left, sole right). About 45 cm in front of the starting eye position and 40 cm below it (default). Real adult size: knee to heel about 45 cm, foot about 25 cm long (default). Resting on a simple low cushion so it doesn't float (default).
- Zones: three regions on the leg, each a big pinch target the size of that body part: **calf** (back of the lower leg), **shin** (front of the lower leg), **sole** (bottom of the foot). Faint outline on each when idle.
- Arrows: drawn on the surface of the lit zone, along the stroke direction, about 3 cm wide (default).
- Ghost hands: semi-transparent light hands placed on the lit zone in the stroke's hand position, life-size, moving along the arrow.
- Technique label: short floating text just above the lit zone, about 8 cm above the leg's surface (default), facing the user, e.g. "Calf knead · medium".
- Start hint: small text just above the leg, "Pinch a zone to start".

## Hands and input
- Pick a zone: pinch directly on the calf, shin or sole. That zone lights up and its guide starts. The other zones fade.
- Switch zones: pinch a different zone directly. No back button, no menu.
- Turn off: pinch the lit zone again. All guides fade, leaving the outlined leg.
- Direction check: pinch and drag (SIK drag) starting on the lit zone's arrow, along the leg. Dragging in the arrow's direction turns the arrow green; dragging the wrong way or off the path leaves it neutral. Releasing resets it to neutral.
- Targets are big and highlight when aimed at.
- Voice: none.

## Zone content (all strokes are (default); easy to swap or extend later)
Keep zones as a simple list in one place, so more zones or strokes can be added later without a rebuild.
- **Calf:** "Calf knead · medium". Both hands wrapped around the calf, thumbs on the back of the leg; glide from ankle toward knee.
- **Shin:** "Shin glide · gentle". Palms flat on either side of the shinbone (not on the bone); glide from ankle toward knee.
- **Sole:** "Sole thumb glide · medium". Both thumbs on the sole; glide from heel toward toes.

Intensity is shown as the label word, and by the ghost hands moving slower and deeper for "firm", lighter for "gentle" (default).

## When things show
- Leg with three faint zone outlines: shows from the start, always.
- Start hint "Pinch a zone to start": shows at start, hides after the first pinch on any zone.
- Arrows, ghost hands, technique label: show only for the lit zone; loop until the user switches or turns the zone off. No timers, no nudges.
- Other zones: fade (dimmer outline) while one zone is lit.
- Green arrow: only while a drag is following the arrow's direction.
- If something needs attention out of view: none (everything is on the leg in front of the user).

## Interaction detail
Feedback is subtle (default), because content sits about 50 cm from the eyes. Sound cues are on, soft and short.
- **Zone states:** idle = faint outline (~20% brightness) · hovered = soft glow (~50%) · lit = full brightness · faded (another zone lit) = ~10%. (default)
- **Pinch on a zone:** zone brightens over 150 ms, soft click sound. (default)
- **Switching zones:** old zone's arrows, ghost hands and label fade out over 300 ms while the new zone fades in over 300 ms; no hard cut. (default)
- **Turning a zone off:** guides fade out over 300 ms, soft lower-pitched click. (default)
- **Start hint:** fades out over 300 ms after the first pinch. (default)
- **Ghost hand loop:** one stroke ≈ 3 s along the arrow with ease-in/ease-out, 0.5 s pause at the end, then the hands fade back to the start and repeat. "Gentle" ≈ 3.5 s and hands hover just above the surface; "firm" ≈ 2.5 s with hands slightly sunk into the surface. (default)
- **Arrows:** a light shimmer travels along the arrow in the stroke direction, in time with the ghost hands. (default)
- **Drag-to-trace:** arrow turns green once the drag has moved ≥ 5 cm in the arrow's direction (within ~30° of it), with a soft chime the first time it goes green in each drag. Wrong direction or off-path: arrow stays neutral, no sound. On release, it fades back to neutral over 300 ms. (default)
- **Colors:** guide visuals in light, cool tones (soft white / pale blue); green only for the direction check. No dark content (additive display). (default)
- **Sounds:** generated locally (build-sfx), short (< 0.3 s), quiet, spatialized at the leg. No music. (default)
- **For CLAD:** use `specs-interaction-recipes` for hover / pinch / drag states and `build-sfx` for the click and chime sounds.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. When the Lens opens, a life-size leg rests across a lap about 50 cm in front, slightly below eye level, with calf, shin and sole faintly outlined and a "Pinch a zone to start" hint above it.
2. Pinching the calf lights it up, the other zones fade, the hint disappears, and arrows plus ghost hands loop the stroke along the calf.
3. Each lit zone shows a short label with technique and intensity (e.g. "Calf knead · medium").
4. Pinching a different zone (shin, sole) switches the guide straight to it, with no back button.
5. Pinching the lit zone again turns it off, leaving just the outlined leg.
6. With a zone lit, pinching the start of its arrow and dragging along it in the right direction turns the arrow green; dragging the wrong way leaves it neutral.

## Out of scope
- Recognizing or lining up on a real leg.
- Real hand tracking, pressure sensing, or grading how well the massage is done.
- Any area above the knee or any other body part.
- Timers, session tracking, memory between sessions.
- Voice.

## Risks and open questions
- Direction check is a mouse-drag stand-in. On real glasses it would need hand tracking while hands are pressed on a leg, where tracking may drop out. Feel unproven.
- Lining the guide up on a real leg on glasses is untested (manual drag-to-align is the planned approach).
- The preview camera may start at standing height; to see the "sitting with a lap" view, move down with Q in Interactive Preview, or place the leg relative to the starting camera as described.
- Keep the content clinical and fitness-framed (plain grey leg, physio-style labels) so it can't read as anything else.
- Strokes are generic defaults, not expert-reviewed massage instruction.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
