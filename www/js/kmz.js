/**
 * kmz.js — fetch NHC KMZ, inflate KML, extract Leaflet-ready geometry
 * Uses browser DecompressionStream (deflate-raw) for ZIP method 8.
 */
(function (global) {
  function u16(view, off) {
    return view.getUint16(off, true);
  }
  function u32(view, off) {
    return view.getUint32(off, true);
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream unsupported');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * Extract first *.kml text from a KMZ (ZIP) ArrayBuffer.
   */
  async function extractKml(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let offset = 0;
    while (offset + 30 < buf.length) {
      const sig = u32(view, offset);
      if (sig !== 0x04034b50) break; // local file header
      const method = u16(view, offset + 8);
      let compSize = u32(view, offset + 18);
      let uncompSize = u32(view, offset + 22);
      const nameLen = u16(view, offset + 26);
      const extraLen = u16(view, offset + 28);
      const nameStart = offset + 30;
      const name = new TextDecoder().decode(buf.subarray(nameStart, nameStart + nameLen));
      let dataStart = nameStart + nameLen + extraLen;
      // Data descriptor (when bit 3 of general purpose flag set) — rare for NHC
      const flags = u16(view, offset + 6);
      let data;
      if (compSize === 0xffffffff || (flags & 0x08)) {
        // Fall back: search next local header / EOCD — skip unsupported
        break;
      }
      data = buf.subarray(dataStart, dataStart + compSize);
      offset = dataStart + compSize;

      if (!/\.kml$/i.test(name)) continue;

      let out;
      if (method === 0) {
        out = data;
      } else if (method === 8) {
        out = await inflateRaw(data);
      } else {
        continue;
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(out);
    }
    throw new Error('No KML in KMZ');
  }

  function parseCoordTuple(str) {
    const parts = str.trim().split(',');
    if (parts.length < 2) return null;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lon)) return null;
    return [lat, lon]; // Leaflet order
  }

  function parseCoordinatesBlock(text) {
    const pts = [];
    const chunks = text.trim().split(/\s+/);
    for (let i = 0; i < chunks.length; i++) {
      if (!chunks[i]) continue;
      const p = parseCoordTuple(chunks[i]);
      if (p) pts.push(p);
    }
    return pts;
  }

  /**
   * @returns {{ lines: number[][][], polygons: number[][][] }}
   * each line/polygon is array of [lat,lon]
   */
  function parseKmlGeometry(kmlText) {
    const lines = [];
    const polygons = [];
    if (!kmlText) return { lines: lines, polygons: polygons };

    // LineString
    const lineRe = /<LineString\b[^>]*>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
    let m;
    while ((m = lineRe.exec(kmlText))) {
      const pts = parseCoordinatesBlock(m[1]);
      if (pts.length >= 2) lines.push(pts);
    }

    // Polygon outer rings
    const polyRe =
      /<Polygon\b[^>]*>[\s\S]*?<outerBoundaryIs\b[^>]*>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
    while ((m = polyRe.exec(kmlText))) {
      const pts = parseCoordinatesBlock(m[1]);
      if (pts.length >= 3) polygons.push(pts);
    }

    return { lines: lines, polygons: polygons };
  }

  async function fetchKmzGeometry(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('KMZ ' + res.status);
    const ab = await res.arrayBuffer();
    const kml = await extractKml(ab);
    return parseKmlGeometry(kml);
  }

  global.PureSkyKmz = {
    extractKml: extractKml,
    parseKmlGeometry: parseKmlGeometry,
    fetchKmzGeometry: fetchKmzGeometry,
  };
})(window);
