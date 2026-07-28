#!/usr/bin/env python3
"""Derive the three attack lenses of the security page from the login sequence.

    python3 docs/8-auth-attacks.build.py

Same contract as 6-security-topology.build.py / 7-deploy-pipeline.build.py:

    docs/auth-sequence-google-oidc.excalidraw   owns the GEOMETRY
    this script                                 owns the LIGHTING

That file is also what the Auth page renders as-is ("how login works"). The
security page needs the same stage playing a different script ("what is being
stopped"), so nothing is redrawn here — the base scene is ghosted down, the one
message the attacker impersonates is recoloured, and a callout says what the
check buys. Reusing the geometry is the point: a reader who saw the Auth page
recognises the stage instantly and only has to read what changed.

Each lens is also WINDOWED. The full scene is 1520x1440 and the page column is
760px wide, so rendering all of it puts 13px type on screen at 6px while ~90% of
the frame shows steps the lens is not about. Instead every lens crops to the same
760x600 window positioned over its own part of the sequence: the frame never
changes size (so the tab strip has no layout jump) but the camera pans down the
sequence as you move 1 -> 2 -> 3. Panning away from the lane headers would cost
the reader "which column is which", so a compact header strip is redrawn at the
top of every window, the way a long table reprints its column names.

The prose that says what the attack costs lives on the page (SecurityPage's lens
captions), not in the drawing — inside the SVG it would be text scaled by the
crop factor, and it would blow the window wide open.

The three outputs are overwritten every run, so never hand-edit them. Edit the
base scene in Excalidraw and re-run.
"""
import copy
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "auth-sequence-google-oidc.excalidraw")

# ── palette ──────────────────────────────────────────────────────────
# No new colours: attack red is the red the base scene already uses, and the
# callout panel borrows the slate of the ghosted lifelines. Red means "this is
# the attack / this is where it dies" and nothing else.
RED = "#b91c1c"
RED_FILL = "#fecaca"
INK = "#334155"
MUTED = "#94a3b8"
PANEL = "#f8fafc"

GHOST = 15  # opacity for everything the lens is not about

# The crop. Width is the page column (.ha-page is max-width 760px) so the drawing
# lands at roughly 1:1 and 13px type is 13px on screen. Height is whatever lens 1
# needs — it has to hold both halves of the state check, which sit 450px apart
# because the whole Google round trip happens between them. That distance IS the
# point being made about one-time state, so it is not allowed to be compressed;
# the other two lenses spend the surplus on ghosted context instead.
WIN_W, WIN_H = 760, 600
STRIP_H = 44  # the reprinted header band, drawn over the top of the window

# Lifeline id -> (label, x). Only the lanes whose lifeline falls inside a lens's
# window get a label in that lens's strip.
LANES = [
    ("life_user", "End-User", 170),
    ("life_browser", "Browser + SPA", 570),
    ("life_backend", "Django backend", 1010),
    ("life_google", "Google", 1460),
]


def text(eid, x, y, s, size=14, color=INK):
    """Standalone text element, sized the way Excalidraw sizes mono text."""
    lines = s.split("\n")
    return {
        "type": "text",
        "id": eid,
        "x": x,
        "y": y,
        "width": max(len(l) for l in lines) * size * 0.605,
        "height": len(lines) * size * 1.25,
        "text": s,
        "originalText": s,
        "fontSize": size,
        "fontFamily": 3,
        "textAlign": "left",
        "verticalAlign": "top",
        "strokeColor": color,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 0,
        "opacity": 100,
        "angle": 0,
        "seed": abs(hash(eid)) % 900000,
        "version": 1,
        "versionNonce": abs(hash(eid + "n")) % 900000,
        "isDeleted": False,
        "groupIds": [],
        "boundElements": [],
        "link": None,
        "locked": False,
        "containerId": None,
        "lineHeight": 1.25,
        "index": None,  # assigned by reindex()
        "frameId": None,
        "roundness": None,
        "updated": 1784878500000,
        "autoResize": True,
    }


def panel(eid, x, y, w, h):
    """Opaque backing plate — the callouts sit in the actor columns, and the
    ghosted lifelines run the full height of the scene straight through them."""
    return {
        "type": "rectangle",
        "id": eid,
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "strokeColor": MUTED,
        "backgroundColor": PANEL,
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 0,
        "opacity": 100,
        "angle": 0,
        "seed": abs(hash(eid)) % 900000,
        "version": 1,
        "versionNonce": abs(hash(eid + "n")) % 900000,
        "isDeleted": False,
        "groupIds": [],
        "boundElements": [],
        "link": None,
        "locked": False,
        "roundness": {"type": 3},
        "index": None,  # assigned by reindex()
        "frameId": None,
        "updated": 1784878500000,
    }


def header_strip(wx, wy):
    """Reprint the lane names at the top of the window.

    The camera pans away from the real headers at y=110, and a sequence diagram
    without column names is unreadable — the whole grammar is "which lane did
    this arrow come from". An opaque band is used rather than transparent text
    so the ghosted lifelines do not run through the letters."""
    out = [panel("strip", wx, wy, WIN_W, STRIP_H)]
    for i, (_, label, lane_x) in enumerate(LANES):
        if not wx < lane_x < wx + WIN_W:
            continue
        w = len(label) * 12 * 0.605
        out.append(
            text(f"strip_{i}", lane_x - w / 2, wy + 14, label, size=12, color=MUTED)
        )
    return out


def blocked(x, y):
    """The marker on the check that stops the attack — the only red words left
    in the drawing now that the prose has moved to the page."""
    return [text("stop_x", x, y, "\u2715 BLOCKED", size=15, color=RED)]


def spacer(wx, wy):
    """Invisible rectangle pinned to the window. exportToSvg sizes the output
    from the bounding box of the elements, so this is what makes all three
    lenses export at exactly the same size — without it each crop would tighten
    onto its own content and the tab strip would jump."""
    el = panel("win", wx, wy, WIN_W, WIN_H)
    el["strokeColor"] = "transparent"
    el["backgroundColor"] = "transparent"
    el["roundness"] = None
    return el


def reindex(elements):
    """Rewrite every fractional index from the array order.

    Excalidraw requires the elements array to be sorted by a strictly
    increasing, unique "index", and its dev build throws rather than repairing
    one that is not — which is why a bad index shows up as "failed to render"
    under npm run dev while the prod bundle is happy. Cropping reorders and
    drops elements, so the only safe rule is: array order is the z-order, and
    the indices are derived from it here, last, for everything at once."""
    for i, el in enumerate(elements):
        el["index"] = f"a{i:04d}"  # fixed width, so string order == array order
    return elements


def clip(el, wx, wy):
    """Keep / clamp / drop one element against the window.

    Lines (lifelines, phase dividers) are clamped: they are scenery that should
    run to the window edge. Everything else is discrete — a half-drawn arrow or
    a clipped label reads as a rendering bug, so anything not wholly inside is
    dropped. Nothing may stick out, or it would enlarge the exported bbox and
    break the fixed frame."""
    x0, y0, x1, y1 = wx, wy, wx + WIN_W, wy + WIN_H

    if el["type"] == "line":
        ex0, ey0 = el["x"], el["y"]
        ex1, ey1 = ex0 + el["width"], ey0 + el["height"]
        if ex1 < x0 or ex0 > x1 or ey1 < y0 or ey0 > y1:
            return None
        nx0, ny0 = max(ex0, x0), max(ey0, y0)
        nx1, ny1 = min(ex1, x1), min(ey1, y1)
        el["x"], el["y"] = nx0, ny0
        el["width"], el["height"] = nx1 - nx0, ny1 - ny0
        el["points"] = [[0, 0], [nx1 - nx0, ny1 - ny0]]
        return el

    # Arrows store direction in points, so width is unsigned — derive the real
    # span from the points instead of trusting x + width.
    if el["type"] == "arrow":
        xs = [el["x"] + p[0] for p in el["points"]]
        ys = [el["y"] + p[1] for p in el["points"]]
        ex0, ex1, ey0, ey1 = min(xs), max(xs), min(ys), max(ys)
    else:
        ex0, ey0 = el["x"], el["y"]
        ex1, ey1 = ex0 + el["width"], ey0 + el["height"]

    inside = ex0 >= x0 and ex1 <= x1 and ey0 >= y0 and ey1 <= y1
    return el if inside else None


# ── the three lenses ─────────────────────────────────────────────────
# Each is: where the camera sits, what stays lit, and which legit message the
# attack wears as a costume. The window moves down the sequence 1 -> 2 -> 3, so
# the tab strip doubles as a scrub through the login.
#
# "window" is the top-left of the crop. Rules for choosing it: the header strip
# covers the first 44px, so nothing that matters may start there; and the
# surplus below the lit region should land on ghosted neighbours rather than on
# blank paper, which is what keeps the crop feeling like a view of a bigger
# drawing instead of three unrelated pictures.
LENSES = [
    {
        "out": "8-auth-attack-1-state.excalidraw",
        # Both halves of the check are in frame: state is minted at y=360 and
        # compared at y=810. Everything between them is the Google round trip,
        # ghosted — that gap is the reason a replayed callback is worth stopping.
        "window": (437, 310),
        "lit": [
            "life_browser", "life_backend",
            "sb_state", "sb_state_t",
            "sb_valstate", "sb_valstate_t",
            "m8_lbl", "m8_arrow",
        ],
        "attack": ["m8_lbl", "m8_arrow"],
        "relabel": {
            "m8_lbl": "\u26a0 forged callback \u2014 attacker's code, attacker's state\n"
                      "GET /api/auth/google/callback/ ?code &state",
        },
        # the relabelled callback message grows from one line to two, so it has
        # to start higher or its second line lands on the arrow at y=782
        "nudge": {"m8_lbl": -20},
        "blocked_at": (880, 872),
    },
    {
        "out": "8-auth-attack-2-token.excalidraw",
        # Backend <-> Google only: this attack is about what an id_token proves.
        "window": (835, 830),
        "lit": [
            "life_backend", "life_google",
            "m11_lbl", "m11_arrow",
            "sb_verify", "sb_verify_t",
        ],
        "attack": ["m11_lbl", "m11_arrow"],
        "relabel": {
            "m11_lbl": "\u26a0 id_token \u2014 real Google signature, aud = another app's client_id",
        },
        "blocked_at": (865, 1102),
    },
    {
        "out": "8-auth-attack-3-linking.excalidraw",
        # Entirely inside the backend: the attack is a decision, not a message,
        # so it is annotated onto the claims rather than coloured onto an arrow.
        # sb_mint stays in frame but ghosted — it is the step that never happens.
        "window": (745, 980),
        "lit": [
            "life_backend",
            "sb_verify", "sb_verify_t",
            "sb_resolve", "sb_resolve_t",
        ],
        "attack": [],
        "relabel": {},
        "annotate": (1175, 1044,
                     "\u26a0 claims arrive as:\n"
                     "  sub   = the attacker's\n"
                     "  email = victim@example.com"),
        "blocked_at": (1165, 1157),
    },
]


def build():
    with open(BASE, encoding="utf-8") as f:
        base = json.load(f)

    known = {e["id"] for e in base["elements"]}

    for lens in LENSES:
        for eid in lens["lit"] + lens["attack"] + list(lens["relabel"]):
            if eid not in known:
                raise SystemExit(f"{lens['out']}: no element {eid!r} in the base scene")

        wx, wy = lens["window"]
        lit, attack, relabel = set(lens["lit"]), set(lens["attack"]), lens["relabel"]

        kept, dropped_lit = [], []
        for el in copy.deepcopy(base["elements"]):
            eid = el["id"]
            if eid not in lit:
                el["opacity"] = GHOST
            else:
                if eid in attack:
                    el["strokeColor"] = RED
                    if el["type"] == "rectangle":
                        el["backgroundColor"] = RED_FILL
                if eid in relabel:
                    # Excalidraw stores a text element's box; it does not
                    # re-wrap on load. Rewriting the string without resizing
                    # leaves a stale box, which both lies to the clip check
                    # and lets a longer label render straight through the
                    # arrow underneath it.
                    el["text"] = el["originalText"] = relabel[eid]
                    lines = relabel[eid].split("\n")
                    el["width"] = max(len(l) for l in lines) * el["fontSize"] * 0.605
                    el["height"] = len(lines) * el["fontSize"] * 1.25
                if eid in lens.get("nudge", {}):
                    el["y"] += lens["nudge"][eid]

            if clip(el, wx, wy) is not None:
                kept.append(el)
            elif eid in lit:
                dropped_lit.append(eid)

        # A lit element falling outside the crop is always a bug in the window,
        # never something to shrug at — it means the lens is arguing from
        # something the reader cannot see.
        if dropped_lit:
            raise SystemExit(
                f"{lens['out']}: window {lens['window']} cuts off lit elements: "
                + ", ".join(dropped_lit)
            )

        scene = copy.deepcopy(base)
        scene["elements"] = [spacer(wx, wy)] + kept + header_strip(wx, wy)
        if "annotate" in lens:
            ax, ay, txt = lens["annotate"]
            scene["elements"].append(
                text("annot", ax, ay, txt, size=13, color=RED)
            )
        scene["elements"] += blocked(*lens["blocked_at"])

        reindex(scene["elements"])

        out = os.path.join(HERE, lens["out"])
        with open(out, "w", encoding="utf-8") as f:
            json.dump(scene, f, indent=2, ensure_ascii=False)
        print(f"wrote {lens['out']}  window=({wx},{wy}) {WIN_W}x{WIN_H}  "
              f"{len(lit)} lit, {len(kept)} of {len(base['elements'])} base elements in frame")


if __name__ == "__main__":
    build()
