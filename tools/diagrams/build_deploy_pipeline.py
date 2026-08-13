#!/usr/bin/env python3
"""Derive the five lens pages of deploy-pipeline.drawio from its master page.

    python3 tools/diagrams/build_deploy_pipeline.py
    python3 tools/diagrams/build_deploy_pipeline.py --export

Same contract as build_security_topology.py:

    docs/diagrams/sources/deploy-pipeline.drawio owns the GEOMETRY
    this script                                  owns the LIGHTING

Edit the master page in draw.io, save, re-run. The derived pages are overwritten
every time, so never hand-edit them. When you add a cell to master, give it a
role in ROLES below — a cell with no role is treated as always-lit and the
script says so on stdout.
"""

import argparse
import copy
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DRAWIO = os.path.join(ROOT, "docs", "diagrams", "sources", "deploy-pipeline.drawio")
SVG_DIR = os.path.join(ROOT, "frontend", "public", "diagrams")

CLI_CANDIDATES = [
    "drawio",
    "draw.io",
    "/Applications/draw.io.app/Contents/MacOS/draw.io",
    r"C:\Program Files\draw.io\draw.io.exe",
]

# ── semantics: which cell plays which part ───────────────────────────
# Finer-grained than the tab strip: five steps light five sets, but the page
# groups the tabs under three headings. Roles are per-step so that a node can
# belong to more than one — "secrets" lights in step 1 (stored) and again in
# step 5 (read back), which is exactly the point being made about it.
ROLES = {
    "dev": "actor",  # the human is where both roads start
    "cloud": "boundary",
    # 1 · the secret is seeded by hand, off the pipeline
    "e_put": "seed",
    "secrets": "store",
    # 2 · the runner trades a token for an identity
    "gha": "ci",
    "e_gitpush": "ci",
    "sts": "identity",
    "cd_role": "identity",
    "e_oidc": "identity",
    "e_assume": "identity",
    "e_creds": "identity",
    # 3 · the image
    "e_ecrpush": "push",
    "ecr": "registry",  # its own role: the target of both push and pull
    # 4 · the state file, and the argument about it
    "tfstate": "state",
    "e_tf": "state",
    # a note box is an argument, not a component — it belongs only to the step
    # that is making that argument.
    "state_props": "state_note",
    # 5 · the machine boots and fetches what it needs
    "e_refresh": "rollout",
    "ec2": "compute",
    "e_pull": "pull",
    "e_get": "fetch",
    "env_note": "runtime_note",
}

# ── lighting: what each step lights, mutes, and hides ────────────────
# The section reads as a timeline, so every step keeps the whole pipeline
# visible and only moves the emphasis. Note boxes are the exception: they are
# hidden outside their own step, or they argue over the step being read.
NOTES = {"state_note", "runtime_note"}
ALL = {
    "actor",
    "boundary",
    "seed",
    "store",
    "ci",
    "identity",
    "push",
    "registry",
    "state",
    "rollout",
    "compute",
    "pull",
    "fetch",
} | NOTES


def step(id, name, svg, lit):
    """Everything not lit is muted, except note boxes, which are hidden."""
    lit = set(lit) | {"actor", "boundary"}
    return dict(
        id=id, name=name, svg=svg, lit=lit, muted=ALL - lit - NOTES, hidden=NOTES - lit
    )


LENSES = [
    # SECRET FLOW
    step("seed", "1 seed (derived)", "sec-pipeline-1-seed.svg", {"seed", "store"}),
    # DEPLOY IDENTITY & STATE PROTECTION
    step(
        "identity",
        "2 identity (derived)",
        "sec-pipeline-2-identity.svg",
        {"ci", "identity"},
    ),
    step(
        "image",
        "3 image (derived)",
        "sec-pipeline-3-image.svg",
        {"ci", "push", "registry"},
    ),
    step(
        "state",
        "4 state (derived)",
        "sec-pipeline-4-state.svg",
        {"ci", "state", "state_note"},
    ),
    # RUNTIME
    step(
        "boot",
        "5 boot (derived)",
        "sec-pipeline-5-boot.svg",
        {"rollout", "compute", "pull", "registry", "fetch", "store", "runtime_note"},
    ),
]

OPACITY = {"muted": 25, "hidden": 0, "dim": 20}


def set_opacity(style, value):
    # mxGraph keeps shape opacity and label opacity on separate keys — set both,
    # or a hidden box still shows its label at full strength.
    style = re.sub(r"(text)?opacity=\d+;?", "", style or "")
    if style and not style.endswith(";"):
        style += ";"
    return style + "opacity=%d;textOpacity=%d;" % (value, value)


def role_of(cell, parents):
    """A cell's own role, else its parent's — an edge's label cell is a child of
    the edge, so it should be lit or hidden along with it. draw.io hands new
    cells numeric ids, so inheritance keeps redrawn edges working without a
    ROLES entry per generated child."""
    seen = set()
    cid = cell.get("id")
    while cid and cid not in seen:
        if cid in ROLES:
            return ROLES[cid]
        seen.add(cid)
        cid = parents.get(cid)
    return None


def light(cell, lens, parents):
    role = role_of(cell, parents)
    if role is None or role in lens["lit"]:
        return
    if role in lens["hidden"]:
        bucket = "hidden"
    elif role in lens["muted"]:
        bucket = "muted"
    else:
        bucket = "dim"
    cell.set("style", set_opacity(cell.get("style"), OPACITY[bucket]))


def find_cli():
    for c in CLI_CANDIDATES:
        try:
            if (
                subprocess.run(
                    [c, "--version"], capture_output=True, timeout=60
                ).returncode
                == 0
            ):
                return c
        except (OSError, subprocess.SubprocessError):
            continue
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", action="store_true", help="also export the SVGs")
    args = ap.parse_args()

    tree = ET.parse(DRAWIO)
    mxfile = tree.getroot()

    master = next(
        (d for d in mxfile.findall("diagram") if d.get("id") == "master"), None
    )
    if master is None:
        sys.exit('no page with id="master" — the master page is the source of truth')

    for d in list(mxfile.findall("diagram")):
        if d is not master:
            mxfile.remove(d)

    unknown = set()
    for lens in LENSES:
        page = copy.deepcopy(master)
        page.set("id", lens["id"])
        page.set("name", lens["name"])
        parents = {c.get("id"): c.get("parent") for c in page.iter("mxCell")}
        for cell in page.iter("mxCell"):
            if cell.get("id") in ("0", "1"):
                continue
            if role_of(cell, parents) is None:
                unknown.add(cell.get("id"))
            light(cell, lens, parents)
        mxfile.append(page)

    ET.indent(tree, space="    ")
    tree.write(DRAWIO, encoding="UTF-8", xml_declaration=True)
    print("rebuilt %d lens pages from master" % len(LENSES))
    if unknown:
        print("  note: no role for %s — always lit" % ", ".join(sorted(unknown)))

    if args.export:
        cli = find_cli()
        if not cli:
            sys.exit("draw.io CLI not found — install it or export by hand")
        for i, lens in enumerate(LENSES, start=2):  # page 1 is master
            out = os.path.join(SVG_DIR, lens["svg"])
            subprocess.run(
                [
                    cli,
                    "-x",
                    "-f",
                    "svg",
                    "-b",
                    "10",
                    "--page-index",
                    str(i),
                    "-o",
                    out,
                    DRAWIO,
                ],
                capture_output=True,
            )
            print("  exported", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
