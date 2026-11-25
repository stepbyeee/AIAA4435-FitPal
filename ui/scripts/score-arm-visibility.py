"""Score anatomical-side trail presence against a frozen manual reference."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--reference", type=Path, required=True)
parser.add_argument("--trace", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
reference_bytes = args.reference.read_bytes()
trace_bytes = args.trace.read_bytes()
reference = json.loads(reference_bytes)
trace = json.loads(trace_bytes)
if args.trace.name != reference["clip"] + ".json":
    parser.error("Trace filename does not match the labelled clip")

result = {
    "clip": reference["clip"],
    "referenceSha256": hashlib.sha256(reference_bytes).hexdigest(),
    "traceSha256": hashlib.sha256(trace_bytes).hexdigest(),
    "method": "True iff existing trail has a current visible shoulder/elbow/wrist sample for the labelled anatomical side. Presence does not measure pixel alignment.",
    "byLabel": {},
    "windows": [],
}
for window in reference["windows"]:
    start, end = window["startFrame"], window["endFrame"]
    summary = {"startFrame": start, "endFrame": end}
    for side in ("left", "right"):
        label = window[side]
        tally = result["byLabel"].setdefault(label, {"armFrames": 0, "beforeDrawn": 0, "afterDrawn": 0})
        summary[side] = {"label": label}
        for version in ("before", "after"):
            rows = trace[version][start:end + 1]
            if len(rows) != end - start + 1 or any(
                abs(row["sec"] - i / reference["fps"]) >= 0.001 for i, row in enumerate(rows, start)
            ):
                parser.error("Trace and reference timestamps differ")
            count = sum(side in row["arms"] for row in rows)
            summary[side][version + "Drawn"] = count
            tally[version + "Drawn"] += count
        tally["armFrames"] += end - start + 1
    result["windows"].append(summary)
args.output.write_text(json.dumps(result, indent=2) + "\n")
