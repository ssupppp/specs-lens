---
status: approved
---

# Design brief: HandsOn

<!-- Filled in by plan-lens from the learner's interview. Use the learner's words. Mark any value they didn't choose as (default). -->

## The one spatial moment
I'm sitting on the couch with my wife's legs on my lap. I lay one palm just above her ankle and the other just below her knee, pinch "Calf" from the little labels that pop up, and the guide appears right on her leg: an arrow from my first palm to my second, and ghost hands looping the stroke along it, until I pinch for another part or turn it off.

## Why it belongs on glasses
- Uses: draws in the world (the guide sits on the leg itself, at real size, between the two spots you marked); leaves your body free (both hands stay on the leg, eyes stay on the leg).
- Why it's better than the phone or laptop version: with a phone video you keep looking away and stopping to copy the stroke. Here the direction and hand position are drawn right on the muscle you're working on, placed by putting your hands where you're about to massage anyway.

## Product or overlay
- Type: product. A simple, non-expert guide that teaches basic recovery massage strokes on the lower leg (calf, shin, sole). Framed as fitness / sore-legs recovery, clinical wording only.
- What the real version would sense: the user's own palms (SPECS hand tracking). The glasses can't see or track another person's leg, so the user places the guide with their hands: first palm = where the stroke starts, second palm = where it ends. The Lens never needs to know the leg's shape. The user tells it which part with a pinch.
- Stand-ins for the preview:
  - **The leg:** a life-size virtual lower leg (knee down to foot), plain light grey anatomy-style model, resting across a lap at couch height in a natural pose. Click-and-drag on the leg turns it, the way she'd turn her leg to show the calf, so you can look at it from any side and settle it where you want.
  - **A palm landing on the leg:** a click on the stand-in leg. Two clicks = two palms. On glasses this becomes a palm laid flat on the leg.
  - **Direction check:** the mouse stands in for the hand. Pinch the start of the arrow and drag along it; following the arrow's direction turns it green. On glasses this would become real hand tracking.

## Where things live
- Where the user is looking during the main task: down at their lap, at the leg, about 50 cm away and below eye level.
- Leg: lying sideways across the user's lap (left-right in front of them), knee on one side, foot on the other (default: knee left, foot right). About 45 cm in front of the starting eye position and 40 cm below it (default). Real adult size: knee to heel about 45 cm, foot about 25 cm long (default), with a foot that reads as a real foot (heel, arch, toes), not a flat paddle. Resting on a simple low cushion so it doesn't float (default). Natural pose: no forced roll; the user turns it by dragging.
- The whole leg is bigger than the SPECS view at lap distance (about 23 x 38 cm at 55 cm). That's fine: what must fit in view is the hint and the active stroke (arrow, ghost hands, label), which sits where the user is looking. When the Lens opens, the middle of the leg and the hint are in view. (default)
- Palm spots: a small soft dot where each palm landed, about 2 cm across (default).
- Part labels: three short text choices, "Calf · Shin · Sole", in a small row floating about 8 cm above the second palm spot, facing the user (default). Big enough to pinch easily.
- Arrow: drawn along the leg's surface from the first palm spot to the second, about 3 cm wide (default).
- Ghost hands: semi-transparent light hands, life-size, in the chosen part's hand position, moving along the arrow.
- Technique label: short floating text about 8 cm above the middle of the arrow (default), facing the user, e.g. "Calf knead · medium".
- Hint: small text about 10 cm above the middle of the leg (default), clear of the foot. Text changes with the step (see below).

## Hands and input
- **Turn the stand-in leg:** click-and-drag on the leg (anywhere except the arrow's start). It stays where you let go.
- **Place the stroke:** click a spot on the leg (first palm, stroke start), then a second spot (second palm, stroke end). A dot marks each.
- **Pick the part:** after the second spot, "Calf · Shin · Sole" appear. Pinch one. The labels clear and that part's guide starts between the two spots.
- **Switch or turn off:** pinch the technique label. The choices open again with "Off" added: "Calf · Shin · Sole · Off". Picking a part asks for two new palm spots (a different part is in a different place), then starts that guide. Picking "Off" fades the guide and spots, leaving the plain leg and the start hint. (default for where to pinch: the technique label)
- **Direction check:** pinch and drag starting on the arrow's start, along the arrow. Dragging in the arrow's direction turns it green; the wrong way or off the path leaves it neutral. Releasing resets it.
- A short click (little movement) on the leg = a palm spot; a click that moves = turning the leg; a drag from the arrow's start = direction check. (default)
- Targets are big and highlight when aimed at.
- Voice: none.

## Zone content (all strokes are (default); easy to swap or extend later)
Keep parts as a simple list in one place, so more parts or strokes can be added later without a rebuild.
- **Calf:** "Calf knead · medium". Both hands wrapped around the calf, thumbs on the back of the leg; glide along the arrow (placed ankle → knee).
- **Shin:** "Shin glide · gentle". Palms flat on either side of the shinbone (not on the bone); glide along the arrow (placed ankle → knee).
- **Sole:** "Sole thumb glide · medium". Both thumbs on the sole; glide along the arrow (placed heel → toes).

Intensity is shown as the label word, and by the ghost hands moving slower and deeper for "firm", lighter for "gentle" (default).

## When things show
- Stand-in leg: always.
- Hint: "Place your palm where the stroke starts" at start and after "Off"; "Now where it ends" after the first spot; "Pick the part" while the choices are open; hidden while a guide plays.
- Palm spots: from when they're placed until a part's guide is turned off or replaced.
- Part choices: only after the second spot, or after pinching the technique label. Clear once one is picked.
- Arrow, ghost hands, technique label: only while a part is chosen; loop until the user switches or turns it off. No timers, no nudges.
- Green arrow: only while a drag is following the arrow's direction.
- If something needs attention out of view: none (everything is on the leg in front of the user).

## Interaction detail
Feedback is subtle (default), because content sits about 50 cm from the eyes. Sound cues are on, soft and short.
- **Palm spot placed:** dot fades in over 150 ms, soft click. (default)
- **Part choices:** fade in over 150 ms; hovered choice brightens (~50% → 100%); pinched choice flashes and the row fades out over 300 ms. (default)
- **Guide appears / switches:** fades in over 300 ms; the old guide fades out over 300 ms, no hard cut. (default)
- **Off:** guide and spots fade out over 300 ms, soft lower-pitched click. (default)
- **Hint:** crossfades between texts over 300 ms. (default)
- **Turning the leg:** follows the drag smoothly; no sound. (default)
- **Ghost hand loop:** one stroke ≈ 3 s along the arrow with ease-in/ease-out, 0.5 s pause at the end, then the hands fade back to the start and repeat. "Gentle" ≈ 3.5 s and hands hover just above the surface; "firm" ≈ 2.5 s with hands slightly sunk into the surface. (default)
- **Arrows:** a light shimmer travels along the arrow in the stroke direction, in time with the ghost hands. (default)
- **Drag-to-trace:** arrow turns green once the drag has moved ≥ 4 cm in the arrow's direction (within ~30° of it), with a soft chime the first time it goes green in each drag. Wrong direction or off-path: arrow stays neutral, no sound. On release, it fades back to neutral over 300 ms.
- **Colors:** guide visuals in light, cool tones (soft white / pale blue); green only for the direction check. No dark content (additive display). (default)
- **Sounds:** generated locally (build-sfx), short (< 0.3 s), quiet, spatialized at the leg. No music. (default)
- **For CLAD:** use `specs-interaction-recipes` for hover / pinch / drag states and `build-sfx` for the click and chime sounds.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. When the Lens opens, a life-size leg with a real-looking foot rests across a lap about 50 cm in front, slightly below eye level, with the hint "Place your palm where the stroke starts" above it, clear of the foot.
2. Click-and-dragging the leg turns it to show another side, and it stays where it's released.
3. Clicking a spot on the leg, then a second spot, puts a dot on each, and "Calf · Shin · Sole" appear above the second spot.
4. Pinching "Calf" clears the choices and shows an arrow from the first spot to the second, ghost hands looping the stroke along it, and the label "Calf knead · medium".
5. Pinching the technique label reopens the choices with "Off". Picking "Shin" asks for two new spots and then shows the shin guide with "Shin glide · gentle"; picking "Off" clears the guide and spots, leaving the leg and the start hint.
6. With a guide showing, pinching the start of its arrow and dragging along it in the right direction turns the arrow green; dragging the wrong way leaves it neutral.

## Out of scope
- Recognizing or tracking a real leg, or the guide following the leg when it moves (re-place it with two palms).
- Real palm-pose detection, pressure sensing, or grading how well the massage is done.
- Any area above the knee or any other body part.
- Timers, session tracking, memory between sessions.
- Voice.

## Risks and open questions
- Palm placement on real glasses (detecting a palm laid flat on someone's leg) is a hand-pose gesture the preview can't show; clicks stand in for it. Feel unproven.
- Direction check is a mouse-drag stand-in. On real glasses it would need hand tracking while hands are pressed on a leg, where tracking may drop out. Feel unproven.
- Once placed, the guide stays put in the room. If she moves her leg, the user re-places it. On glasses this is honest (no leg tracking); it may feel fussy if she moves a lot.
- Click vs. drag on the stand-in leg (palm spot vs. turning) relies on a small movement threshold; a shaky click could turn the leg instead.
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
