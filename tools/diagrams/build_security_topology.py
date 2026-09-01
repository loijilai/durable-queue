#!/usr/bin/env python3
"""Derive the three lens pages of security-topology.drawio from its master page.

    python3 tools/diagrams/build_security_topology.py
    python3 tools/diagrams/build_security_topology.py --export

Division of labour — the whole point of this file:

    docs/diagrams/sources/security-topology.drawio owns the GEOMETRY
    this script                                    owns the LIGHTING

Edit the master page in draw.io (move things, resize, add nodes), save, re-run.
The three derived pages are overwritten every time, so never hand-edit them.

The only upkeep here: when you add a cell to the master page, give it a role in
ROLES below. A cell with no role is treated as always-lit.
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
DRAWIO = os.path.join(ROOT, "docs", "diagrams", "sources", "security-topology.drawio")
SVG_DIR = os.path.join(ROOT, "frontend", "public", "diagrams")

CLI_CANDIDATES = [
    "drawio",
    "draw.io",
    "/Applications/draw.io.app/Contents/MacOS/draw.io",
    r"C:\Program Files\draw.io\draw.io.exe",
]

# ── semantics: which cell plays which part ───────────────────────────
ROLES = {
    # the untrusted edge and the single way in
    "users": "edge_in",
    "e_in": "edge_in",
    # containment: cloud / VPC / subnets
    "cloud": "boundary",
    "vpc": "boundary",
    "public": "boundary",
    "private": "boundary",
    # the one route out. Its own role: the network lens is about placement, and
    # a lone arrow to the NAT reads as a claim that lens is not making.
    "e_egress": "egress",
    # the things that actually run
    "igw": "node",
    "alb": "node",
    "nat": "node",
    "api": "node",
    "worker": "node",
    "rds": "node",
    # the authorization boundaries themselves
    "sg_alb": "sg",
    "sg_api": "sg",
    "sg_worker": "sg",
    "sg_rds": "sg",
    # who may talk to whom, on which port
    "e_alb_api": "edge_chain",
    "e_api_rds": "edge_chain",
    "e_wk_rds": "edge_chain",
    # the TLS termination marker (only ever shown on the tls lens)
    "tls_line": "tls_marker",
    "tls_label": "tls_marker",
}

# ── lighting: what each lens lights, mutes, and hides ────────────────
# hidden  → opacity 0. NOT deletion: an SG box is the parent of its icon, so
#           removing it would strip the child's coordinate system. Invisible
#           box, intact layout.
# muted   → present but recessive; part of the story, not its subject.
# lit     → full strength.
LENSES = [
    dict(id="network", name="network (derived)", svg="sec-topology-network.svg",
         lit={"boundary", "node", "edge_in"},
         muted=set(),
         hidden={"sg", "edge_chain", "tls_marker", "egress"}),
    dict(id="sg", name="sg (derived)", svg="sec-topology-sg.svg",
         lit={"sg", "node", "edge_chain", "edge_in"},
         muted={"boundary", "egress"},
         hidden={"tls_marker"}),
    dict(id="tls", name="tls (derived)", svg="sec-topology-tls.svg",
         lit={"edge_in", "node", "boundary", "tls_marker"},
         muted={"edge_chain", "sg", "egress"},
         hidden=set()),
]

OPACITY = {"muted": 55, "hidden": 0, "dim": 20}


def set_opacity(style, value):
    # mxGraph keeps shape opacity and label opacity on separate keys — set both,
    # or a hidden box still shows its "SG-api" label at full strength.
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
            if subprocess.run([c, "--version"], capture_output=True,
                              timeout=60).returncode == 0:
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

    master = next((d for d in mxfile.findall("diagram") if d.get("id") == "master"), None)
    if master is None:
        sys.exit("no page with id=\"master\" — the master page is the source of truth")

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
        for i, lens in enumerate(LENSES, start=2):   # page 1 is master
            out = os.path.join(SVG_DIR, lens["svg"])
            subprocess.run([cli, "-x", "-f", "svg", "-b", "10",
                            "--page-index", str(i), "-o", out, DRAWIO],
                           capture_output=True)
            print("  exported", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
