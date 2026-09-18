You are a senior product designer, UX/UI designer, creative director, 3D web developer, and frontend engineer.

Your task is to design and build a premium, highly visual, technically credible website for a MOBILE CRANE DIGITAL EXPERIENCE.

This is NOT a generic portfolio website.
This is NOT a generic AI landing page.
This is NOT a SaaS template.
This is NOT a dashboard-heavy website.
This is NOT a basic engineering documentation page.

The website should feel like a premium industrial technology product created by a world-class engineering company.

The central subject of the entire experience is a MOBILE CRANE.

The website should allow a visitor to visually understand:
- What a mobile crane is
- What its major components are
- How those components work
- How the crane operates mechanically
- What sensors/instrumentation are used
- Different types of mobile cranes
- Safety systems
- Industry/market context
- The relationship between the physical machine and the digital representation

The primary objective is:

"Make the visitor FEEL that they are exploring a real machine."

The experience should combine:
- Industrial product design
- Engineering visualization
- Cinematic storytelling
- Interactive 3D
- Technical documentation
- Premium editorial design

==================================================
1. CORE DESIGN PHILOSOPHY
==================================================

The website should communicate:

PRECISION
ENGINEERING
HEAVY MACHINERY
RELIABILITY
TECHNOLOGY
INTELLIGENCE
MECHANICAL COMPLEXITY
REAL-WORLD INDUSTRIAL SCALE

Avoid making it look like an "AI website".

DO NOT use:
- Purple neon gradients
- Blue neon gradients
- Glowing futuristic blobs
- Excessive glassmorphism
- Floating gradient orbs
- Random particles
- Cyberpunk effects
- Excessive rounded cards
- Excessive shadows
- Generic AI illustrations
- Generic SaaS dashboards
- Excessive glowing borders
- "AI-powered" visual clichés
- Stock-looking startup graphics
- Excessive animated numbers
- Random 3D abstract objects

The visual language must come from the MACHINE itself.

The crane's yellow should become part of the brand identity.

==================================================
2. VISUAL STYLE
==================================================

Primary visual direction:

"PREMIUM INDUSTRIAL ENGINEERING × CINEMATIC MACHINERY × TECHNICAL EDITORIAL"

Think of the visual quality of:
- premium heavy machinery manufacturers
- engineering product configurators
- automotive product experiences
- high-end industrial control interfaces
- technical product documentation
- architectural visualization

But DO NOT copy any specific company's website.

The design should feel original.

Use a sophisticated combination of:

DARK GRAPHITE
WARM OFF-WHITE
METALLIC GREYS
CRANE YELLOW

Suggested palette:

Primary dark:
#111211

Dark surface:
#181A18

Secondary surface:
#202220

Border:
#2B2D29

Primary text:
#F1F0E9

Secondary text:
#9A9B95

Crane yellow:
#E4B51C

Warning:
warm amber

Critical:
restrained red

Do not use bright neon colors.

Yellow should be used sparingly:
- active states
- important machine indicators
- selected components
- technical annotations
- CTA highlights
- safety states

The yellow must feel like the actual paint color of the crane, not a digital neon accent.

==================================================
3. COLOR RHYTHM
==================================================

Do NOT make every section dark.

Use alternating visual environments.

DARK SECTIONS:
- Hero
- Interactive anatomy
- Exploded view
- How the crane works
- Crane types gallery
- Safety visualization

LIGHT SECTIONS:
- Crane introduction
- Component catalogue
- Sensor ecosystem
- Technical specifications
- Market / industry

Use a warm technical white rather than pure #FFFFFF.

This alternating rhythm prevents visual fatigue.

==================================================
4. TYPOGRAPHY
==================================================

Use a clean modern technical sans-serif.

Recommended:
- Inter
- Manrope
- Geist
- IBM Plex Sans
- Space Grotesk for limited technical headings

Do NOT use futuristic sci-fi fonts.

Typography hierarchy:

Large cinematic headings:
70–120px desktop where appropriate

Section headings:
48–72px

Subheadings:
24–36px

Body:
16–19px

Technical labels:
10–13px
uppercase
increased letter spacing

Use typography with lots of whitespace.

Avoid giant text everywhere.

==================================================
5. WEBSITE EXPERIENCE
==================================================

The website should feel like one continuous exploration.

Main flow:

01 — HERO / MEET THE MACHINE

02 — WHAT IS A MOBILE CRANE?

03 — INTERACTIVE CRANE ANATOMY

04 — EXPLODED VIEW

05 — COMPONENT INTELLIGENCE

06 — HOW DOES A MOBILE CRANE WORK?

07 — SENSOR & INSTRUMENTATION

08 — TYPES OF MOBILE CRANES

09 — SAFETY SYSTEMS

10 — MARKET / INDUSTRY OVERVIEW

Do NOT include these sections for now:

- Live Digital Twin Dashboard
- Maintenance & Predictive Maintenance
- Applications
- Digital Twin Architecture
- Future Vision

These are intentionally excluded from the current version.

==================================================
6. NAVIGATION
==================================================

Create a minimal sticky navigation.

Desktop:

LEFT:
MOBILE CRANE
DIGITAL EXPERIENCE

CENTER/RIGHT:
01 MACHINE
02 ANATOMY
03 COMPONENTS
04 MECHANICS
05 SENSORS
06 TYPES
07 SAFETY
08 INDUSTRY

RIGHT:
[EXPLORE]

Navigation should remain subtle.

Do not create a giant navbar.

When scrolling, navigation can become slightly more opaque.

Use thin borders.

==================================================
7. HERO SECTION
==================================================

The hero is the most important visual section.

It should immediately communicate:

"This website is about a real mobile crane."

Use the actual 3D GLB model as the hero object.

File:

mobile-crane.glb

The model should occupy approximately 60–75% of the visual attention.

The crane should be large.

Do not put 10 cards around it.

Background:
dark graphite.

Camera:
cinematic.

Lighting:
realistic industrial lighting.

Environment:
minimal studio-like environment with subtle floor/contact shadow.

The crane should feel physically present.

Hero headline:

"THE MACHINE
BEHIND THE LIFT."

Supporting text:

"Explore the engineering, mechanics and technology behind a mobile crane."

Small technical metadata:

MOBILE CRANE
HEAVY LIFTING SYSTEM
MECHANICAL SYSTEM

CTA:

[ EXPLORE THE MACHINE ]

Secondary:

[ SCROLL TO EXPLORE ]

Add subtle technical annotations around the crane.

Examples:

BOOM LENGTH
MAXIMUM CAPACITY
OUTRIGGER SYSTEM
TELESCOPIC BOOM

Do not overcrowd the hero.

==================================================
8. 3D MODEL REQUIREMENTS
==================================================

Use Three.js.

Load the GLB using GLTFLoader.

The model should support:

- orbit rotation
- zoom
- pan
- smooth camera movement
- auto rotation
- reset camera
- component highlighting
- component selection where mesh structure permits
- exploded view if meshes are separable

Controls should feel premium.

Do NOT make the 3D viewer look like a developer demo.

Hide unnecessary Three.js-style UI.

Create custom controls:

[ROTATE]
[RESET]
[EXPLODE]

Optional:
[FOCUS]

Use smooth easing.

Avoid sudden camera jumps.

==================================================
9. INTERACTIVE CRANE ANATOMY
==================================================

Create a major section titled:

"UNDERSTAND THE MACHINE."

The full 3D crane should be shown again.

This time the user should be able to interact with it.

Hover over a component:

- component becomes highlighted in crane yellow
- subtle glow/outline
- small label appears
- cursor changes

Click:

Open a component information panel.

The panel should contain:

COMPONENT NAME

FUNCTION

ROLE IN CRANE

RELATED SYSTEMS

SENSORS

TECHNICAL DESCRIPTION

Example:

MAIN BOOM

FUNCTION:
Primary structural member responsible for lifting and positioning the load.

RELATED SYSTEMS:
- Boom lift cylinder
- Telescopic sections
- Boom head
- Load line
- Sensors

Do not invent exact engineering specifications unless provided by the user.

Use general engineering descriptions where exact specifications are unknown.

==================================================
10. COMPONENT STRUCTURE
==================================================

Organize the crane into logical groups.

GROUP 01
CHASSIS & BASE

Components:
- Chassis
- Wheels
- Access Ladder

GROUP 02
OUTRIGGER ASSEMBLY

Components:
- Outrigger Beam
- Outrigger Hydraulic Cylinder
- Outrigger Pad

GROUP 03
CABIN & COUNTERWEIGHT

Components:
- Operator Cabin
- Counterweight

GROUP 04
BOOM ASSEMBLY

Components:
- Boom Lift Cylinder
- Main Boom
- Telescopic Boom Sections
- Main Boom Head
- Boom Angle Sensor
- Boom Length Sensor

GROUP 05
RIGGING & HOOK BLOCK

Components:
- Main Load Line
- Anti-Two-Block Device / Limit Switch
- Main Hook Block
- Hook Latch

Each component should have:
- Name
- Function
- Mechanical role
- Related components
- Relevant sensors
- Visual representation

==================================================
11. EXPLODED VIEW
==================================================

Create a cinematic exploded-view experience.

This must represent:

ENGINEERING DISASSEMBLY

NOT:
- Explosion
- Accident
- Destruction
- Parts flying randomly
- Broken crane

The crane should separate in controlled mechanical directions.

Example:

Main boom moves upward.

Telescopic sections separate along their longitudinal axis.

Cabin moves slightly outward.

Counterweight moves backward.

Outriggers extend laterally.

Hook block moves downward.

Wheels/chassis components separate vertically or laterally where appropriate.

Movement must feel physically intentional.

Use smooth animation.

Add technical labels.

Example:

01 MAIN BOOM
02 BOOM LIFT CYLINDER
03 OPERATOR CABIN
04 COUNTERWEIGHT
05 OUTRIGGER SYSTEM
06 TELESCOPIC SECTIONS
07 HOOK BLOCK
08 LOAD LINE

If the GLB model does not contain separable meshes, do NOT fake a broken animation.

Instead provide:
- cinematic AI-generated exploded-view video
- technical exploded illustration
- or a simplified visual representation

The visual should always remain consistent with the original crane.

==================================================
12. AI-GENERATED VIDEO
==================================================

Include the AI-generated crane disassembly video as a supporting visual.

The video should show:

1. Fully assembled realistic yellow mobile crane
2. Slow cinematic camera rotation
3. Camera gradually pulls back
4. Controlled engineering disassembly begins
5. Major components separate logically
6. Camera continues pulling back
7. Complete exploded assembly is visible

IMPORTANT:

The realistic crane reference must remain the master visual source.

If multiple reference images are supplied:

IMAGE 1:
Master crane appearance.

IMAGE 2:
Component information only.

Do NOT transform the realistic crane into the appearance/style of the component diagram.

Do NOT use the labeled diagram as a visual target.

Do NOT turn the realistic crane into a cartoon or illustration.

The final exploded view must still look like the SAME realistic crane.

If labels are unreliable in AI-generated video, add labels using HTML/CSS overlays.

==================================================
13. COMPONENT INTELLIGENCE SECTION
==================================================

Create a technical catalogue.

Layout:

LEFT:
large component image/render

RIGHT:
technical information

Example:

MAIN BOOM

01 / BOOM ASSEMBLY

PRIMARY FUNCTION

Supports and positions the load.

MECHANICAL ROLE

Transfers lifting forces and provides reach.

CONNECTED SYSTEMS

Hydraulic system
Telescopic mechanism
Rigging system

MONITORED PARAMETERS

Boom angle
Boom length
Load condition

Use diagrams and visual callouts.

Do not make these cards look like generic SaaS cards.

Use:
- thin borders
- technical lines
- whitespace
- typography
- large visuals

==================================================
14. HOW DOES A MOBILE CRANE WORK?
==================================================

Create a visual mechanical storytelling section.

Explain the operating sequence.

Example:

01
POSITIONING

Crane arrives and positions itself.

02
STABILIZATION

Outriggers are deployed.

03
BOOM POSITIONING

Hydraulic cylinders control boom movement.

04
TELESCOPING

Boom sections extend to achieve required reach.

05
LOAD HANDLING

Load line and hook block transfer the lifting force.

06
MONITORING

Sensors provide information about machine condition and operating parameters.

Make this interactive where possible.

When the user scrolls:

- boom moves
- cylinder extends
- outriggers deploy
- hook moves

Use the 3D model if technically possible.

==================================================
15. HYDRAULIC SYSTEM VISUALIZATION
==================================================

Create a simplified engineering diagram.

Show:

HYDRAULIC POWER
        ↓
CONTROL VALVES
        ↓
HYDRAULIC CYLINDER
        ↓
MECHANICAL MOVEMENT

Then connect the cylinder to the boom.

Use animated flow lines.

Do not make it look like a cyberpunk energy system.

The flow should resemble technical fluid-power diagrams.

==================================================
16. SENSOR & INSTRUMENTATION
==================================================

Create a dedicated instrumentation section.

Use realistic sensor images / technical renders.

Important sensors and systems to represent include:

- Boom angle sensor
- Boom length sensor
- Load measurement/load sensor
- Hydraulic pressure sensor
- Engine temperature monitoring
- Wind speed sensor where applicable
- Outrigger position/status sensing
- Anti-two-block device / limit switch

Each sensor should have:

NAME

VISUAL

WHAT IT MEASURES

WHERE IT IS USED

WHY IT MATTERS

RELATED SAFETY / MONITORING FUNCTION

Example:

BOOM ANGLE SENSOR

Measures:
Boom inclination/angle.

Location:
Boom assembly.

Purpose:
Provides information about boom position for monitoring and control functions.

Do not claim exact sensor technology unless known.

==================================================
17. SENSOR VISUAL LANGUAGE
==================================================

Do not use generic colorful sensor icons.

Use:

- realistic sensor photography
- industrial component renders
- monochrome technical illustrations
- small technical diagrams

Use yellow only for highlighted sensor points.

On the crane:

● BOOM ANGLE

● BOOM LENGTH

● HYDRAULIC PRESSURE

● LOAD

When selected:

sensor point becomes yellow.

A thin line connects it to an information panel.

==================================================
18. TYPES OF MOBILE CRANES
==================================================

Create a visually rich crane-type gallery.

Types may include:

ALL-TERRAIN CRANE

ROUGH-TERRAIN CRANE

TRUCK-MOUNTED CRANE

CRAWLER CRANE

TELESCOPIC CRANE

Other relevant categories can be included where appropriate.

Each type should have a large, realistic image.

Use a consistent image generation style.

All images should look like they belong to the same visual world.

Each card should explain:

TYPE

MOBILITY

TYPICAL USE

KEY ADVANTAGE

GENERAL CAPACITY RANGE where appropriate

Do not invent exact values.

Use "varies by model" when necessary.

Use cinematic industrial photography rather than generic stock imagery.

==================================================
19. CRANE TYPE VISUAL STYLE
==================================================

AI-generated images should have:

- realistic engineering proportions
- physically plausible machinery
- realistic tires/tracks
- realistic hydraulic cylinders
- realistic boom geometry
- realistic construction environments
- natural lighting
- cinematic photography
- industrial scale

Avoid:
- distorted cranes
- impossible boom geometry
- extra wheels
- malformed hook blocks
- fake labels
- text embedded into AI images
- cartoon appearance

Text must be rendered by HTML, not generated inside images.

==================================================
20. SAFETY SECTION
==================================================

Create a visually serious safety section.

Do not make safety feel like a generic warning card.

Explain:

- Load capacity
- Stability
- Outrigger deployment
- Load moment
- Boom position
- Anti-two-block protection
- Limit systems
- Wind/environmental conditions
- Operator awareness

Use technical diagrams.

Example visual:

CRANE
↓
LOAD
↓
LOAD MOMENT
↓
STABILITY

Create a visual representation of safe vs approaching-limit operating conditions.

Use:

GREEN = normal
AMBER = warning
RED = critical

But use these colors only for status.

==================================================
21. MARKET / INDUSTRY SECTION
==================================================

The market section should look like an industrial research page, not a business pitch deck.

Include where supported:

- Global mobile crane market overview
- Major manufacturers
- Market segmentation
- Regional presence
- Production
- Imports/exports
- Industry trends

Major manufacturers can be represented where relevant.

Use:
- charts
- maps
- statistics
- manufacturer logos where legally/technically appropriate
- clean typography

Do not fabricate market statistics.

If data is not provided, use clearly marked placeholders:

$XX B
XX%
XXXX units

or request/leave data fields for later replacement.

==================================================
22. TECHNICAL SPECIFICATION STYLE
==================================================

Use technical specification blocks.

Example:

MACHINE OVERVIEW

────────────────────

CRANE TYPE
Mobile Crane

MOBILITY
Road / Site

BOOM
Telescopic

STABILIZATION
Hydraulic Outriggers

LOAD HANDLING
Hook Block / Load Line

CONTROL
Hydraulic / Electronic Systems

Do not pretend these are specifications of one exact crane unless the actual crane model has been identified.

Use generic mobile-crane information where appropriate.

==================================================
23. TECHNICAL ANNOTATIONS
==================================================

Use engineering annotations throughout the website.

Examples:

01 / MAIN BOOM

02 / BOOM LIFT CYLINDER

03 / OUTRIGGER

04 / COUNTERWEIGHT

05 / HOOK BLOCK

06 / LOAD LINE

Use thin connecting lines.

Use small uppercase labels.

Add subtle dimension lines:

──────────────
42.6 m

But only use actual dimensions if known.

Otherwise use generic labels such as:

BOOM LENGTH

LOAD PATH

STABILIZATION ZONE

Do not fabricate numerical measurements.

==================================================
24. SCROLL EXPERIENCE
==================================================

The website should feel cinematic.

Use scroll-driven animation carefully.

Examples:

Hero:
camera slowly rotates around crane.

Scroll:
camera moves closer.

Anatomy:
components become interactive.

Exploded:
parts separate.

Mechanics:
boom/cylinder movement.

Sensors:
sensor points appear.

Crane types:
horizontal/vertical gallery movement.

Safety:
technical diagram builds progressively.

Avoid excessive scroll-jacking.

The user should still feel in control.

==================================================
25. ANIMATION LANGUAGE
==================================================

Animation should communicate physical behavior.

Use:

- slow camera movement
- smooth easing
- mechanical separation
- subtle fades
- technical line drawing
- progressive highlighting
- controlled transitions

Avoid:

- bouncing UI
- elastic buttons
- excessive parallax
- random floating animations
- flashy transitions
- rapid zooms

Animation speed should feel:

HEAVY
CONTROLLED
PRECISION ENGINEERED

Think:

"heavy machinery movement"

not

"social media website."

==================================================
26. 3D LIGHTING
==================================================

The crane must look realistic.

Use:
- soft key light
- subtle rim light
- realistic environment light
- contact shadows
- ground plane
- ambient occlusion where feasible

The yellow paint should show:
- realistic roughness
- metallic components
- shadows
- highlights

Do not make the model look like a glowing game object.

==================================================
27. 3D ENVIRONMENT
==================================================

Keep environment minimal.

Possible environment:

dark industrial studio.

Subtle floor.

Very faint grid.

Soft volumetric atmosphere only if performance allows.

No dramatic sci-fi environment.

The machine is the hero.

==================================================
28. UI DESIGN
==================================================

UI should be minimal and technical.

Use:

thin borders
small labels
large whitespace
precise alignment
technical numbering

Avoid:
- excessive cards
- excessive pills
- excessive rounded rectangles
- giant shadows
- glassmorphism

Cards can have subtle 4–10px radius if necessary.

The overall interface should feel engineered.

==================================================
29. RESPONSIVE DESIGN
==================================================

Desktop:
Designed primarily for 1440px–1920px displays.

Tablet:
Maintain visual hierarchy.

Mobile:
Do not simply shrink desktop.

For mobile:
- stack information
- simplify 3D controls
- reduce annotations
- maintain large crane visual
- use touch-friendly controls
- convert side panels into bottom sheets

The experience must remain usable.

==================================================
30. PERFORMANCE
==================================================

Optimize for browser performance.

Requirements:

- lazy-load videos
- lazy-load images
- compress assets
- use WebP where appropriate
- optimize GLB
- avoid unnecessary animation loops
- dispose unused Three.js resources
- avoid excessive post-processing

The website should remain smooth.

Target:
60 FPS where hardware allows.

==================================================
31. TECHNOLOGY
==================================================

Prefer:

HTML5
CSS3
JavaScript

Three.js for 3D.

GSAP optionally for animation.

Use CDN libraries if necessary.

The first prototype should preferably be easy to run.

Target:

index.html

plus:

assets/

The project should be straightforward to open in Chrome.

If local GLB loading through file:// causes browser restrictions, provide the simplest possible local-server solution, but do not unnecessarily introduce React, Node, Vite, or a complicated build pipeline unless required.

==================================================
32. FILE STRUCTURE
==================================================

Preferred:

mobile-crane-experience/

index.html

assets/
    3d/
        mobile-crane.glb

    videos/
        crane-intro.mp4
        exploded-view.mp4

    components/
        boom.webp
        cabin.webp
        outrigger.webp
        hook-block.webp

    sensors/
        boom-angle.webp
        boom-length.webp
        load-sensor.webp
        hydraulic-pressure.webp
        anti-two-block.webp

    crane-types/
        all-terrain.webp
        rough-terrain.webp
        truck-mounted.webp
        crawler.webp
        telescopic.webp

    diagrams/
        hydraulic-system.svg
        safety-system.svg
        load-path.svg

==================================================
33. ASSET FALLBACK SYSTEM
==================================================

The website must be designed so assets can be replaced easily.

If an asset is unavailable:

Do NOT use a random stock image.

Instead use a clearly defined placeholder:

[3D CRANE MODEL]

[EXPLODED VIEW VIDEO]

[SENSOR IMAGE]

[CRANE TYPE IMAGE]

The layout must not break when the final asset is inserted.

==================================================
34. CONTENT QUALITY
==================================================

The content should be technically credible but easy to understand.

Avoid:
- overly academic language
- huge paragraphs
- unnecessary jargon

Use:

short explanations
technical labels
diagrams
visual examples
structured information

A visitor with no crane knowledge should understand the basics.

An engineering student should learn something meaningful.

A technical professional should find the information credible.

==================================================
35. INFORMATION DEPTH
==================================================

The website should provide enough information to understand:

WHAT is a mobile crane?

WHY is it used?

WHAT are its major systems?

HOW does it move?

HOW does it lift?

HOW does the boom work?

HOW do outriggers stabilize it?

HOW does the hydraulic system contribute?

WHAT sensors are used?

WHAT safety mechanisms exist?

WHAT different mobile crane types exist?

HOW are they different?

WHO are the major industry players?

The information should always be paired with an appropriate visual.

==================================================
36. IMPORTANT UX PRINCIPLE
==================================================

Do not make the website:

TEXT → IMAGE → TEXT → IMAGE

Instead:

MACHINE → INTERACTION → EXPLANATION → ANIMATION → DATA → UNDERSTANDING

Every major concept should have a visual representation.

==================================================
37. VISUAL CONSISTENCY
==================================================

All assets must feel like they belong to the same product.

Maintain:

consistent lighting
consistent camera quality
consistent industrial realism
consistent color grading
consistent typography
consistent yellow crane identity

AI-generated assets must NOT look obviously AI-generated.

==================================================
38. BRAND PERSONALITY
==================================================

The website should communicate:

"WE UNDERSTAND THE MACHINE."

Not:

"LOOK HOW MANY AI EFFECTS WE CAN ADD."

The design should feel:

confident
technical
precise
premium
serious
modern
industrial

==================================================
39. FINAL EXPERIENCE
==================================================

When someone opens the website, the emotional journey should be:

FIRST:

"Wow, that crane looks real."

THEN:

"I can actually interact with it."

THEN:

"Oh, this is how the crane is constructed."

THEN:

"Now I understand what each component does."

THEN:

"So this is how the crane actually operates."

THEN:

"These are the sensors monitoring it."

THEN:

"There are different types of mobile cranes."

THEN:

"Now I understand the safety systems."

FINALLY:

"This is much more than a normal crane information website."

==================================================
40. FINAL DESIGN TEST
==================================================

Before considering the design complete, check:

[ ] Does the crane immediately dominate the visual experience?

[ ] Does the website look industrial rather than generic AI?

[ ] Is crane yellow used as the identity accent?

[ ] Is the 3D model actually useful rather than decorative?

[ ] Can users understand the crane anatomy visually?

[ ] Does the exploded view feel mechanically realistic?

[ ] Are components logically organized?

[ ] Are sensor visuals realistic?

[ ] Are crane-type images visually consistent?

[ ] Does the hydraulic/mechanical explanation use animation?

[ ] Is safety visually explained?

[ ] Is market information presented cleanly?

[ ] Are there enough visuals?

[ ] Is there too much text?

[ ] Are there unnecessary gradients?

[ ] Are there unnecessary glowing effects?

[ ] Does the website feel premium?

[ ] Does it feel like an industrial engineering product?

[ ] Does it avoid the generic AI aesthetic?

[ ] Does the experience work smoothly on desktop?

==================================================
41. IMPORTANT DEVELOPMENT APPROACH
==================================================

DO NOT immediately generate the entire final website in one giant block.

First establish:

1. Global visual system
2. Navigation
3. Hero
4. 3D crane viewer
5. Anatomy interaction

Then build:

6. Exploded view
7. Components
8. Mechanics
9. Sensors
10. Crane types
11. Safety
12. Industry

After that:

13. Responsive design
14. Animation polish
15. Performance optimization
16. Final visual refinement

At every stage preserve the same visual language.

==================================================
42. MOST IMPORTANT RULE
==================================================

The MOBILE CRANE is the protagonist.

Everything else supports the machine.

The website should never feel like:

"A website with a crane inside it."

It should feel like:

"A digital experience built around a real mobile crane."

The visitor should feel as if they are entering the machine, inspecting its components, understanding its mechanics, and exploring its engineering.

Build the experience with restraint, precision and realism.

NO GENERIC AI DESIGN.

NO VISUAL CLUTTER.

NO UNNECESSARY EFFECTS.

NO FAKE TECHNICAL DATA.

NO RANDOM IMAGERY.

MAKE THE MACHINE THE HERO.