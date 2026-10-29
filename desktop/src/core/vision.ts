import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { VisionFace } from "./faces";

// Apple Vision, on the Mac only: a second look at every face the ONNX
// detector found. Faces Vision doesn't see (hands, drums, patterns), or
// rates as very poor, are left out. It runs through the scripting bridge
// built into macOS (osascript, JavaScript), so nothing extra is installed.
// Windows uses the ONNX detector and the quality filter alone (faces.ts).

const SCRIPT = `
ObjC.import('Foundation');
ObjC.import('Vision');
function run(argv) {
  var out = [];
  for (var n = 0; n < argv.length; n++) {
    var faces = [];
    try {
      var url = $.NSURL.fileURLWithPath(argv[n]);
      var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
      var req = $.VNDetectFaceCaptureQualityRequest.alloc.init;
      handler.performRequestsError($.NSArray.arrayWithObject(req), null);
      var res = req.results;
      if (res && !res.isNil()) {
        for (var i = 0; i < res.count; i++) {
          var o = res.objectAtIndex(i);
          var b = o.boundingBox;
          var q = o.faceCaptureQuality;
          var quality = (q && !q.isNil()) ? ObjC.unwrap(q) : 0.5;
          faces.push({ x: b.origin.x, y: 1 - b.origin.y - b.size.height, w: b.size.width, h: b.size.height, q: quality });
        }
      }
    } catch (e) {
      faces = null;
    }
    out.push(faces);
  }
  return JSON.stringify(out);
}
`;

let broken = false;

export function visionAvailable() {
  return process.platform === "darwin" && !broken;
}

// One photo (an upright JPEG). Boxes come back as fractions of the photo,
// top-left origin, like the rest of the app. null when Vision couldn't look.
export async function visionFaces(jpeg: Buffer): Promise<VisionFace[] | null> {
  if (!visionAvailable()) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "hub-vision-"));
  try {
    const file = path.join(dir, "photo.jpg");
    const script = path.join(dir, "vision.js");
    await writeFile(file, jpeg);
    await writeFile(script, SCRIPT);
    const text = await new Promise<string>((resolve, reject) =>
      execFile("/usr/bin/osascript", ["-l", "JavaScript", script, file], { timeout: 30_000 }, (e, stdout) => (e ? reject(e) : resolve(stdout))),
    );
    const [faces] = JSON.parse(text.trim()) as ({ x: number; y: number; w: number; h: number; q: number }[] | null)[];
    if (!faces) return null;
    return faces.map((f) => ({ box: [f.x, f.y, f.w, f.h], quality: f.q }));
  } catch {
    // Older macOS, or the bridge refused: carry on without the second look.
    broken = true;
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
