// Read metadata and numeric assignments only. Never execute GameMaker code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');

function collectReference(root) {
  root = path.resolve(root);
  const files = [];
  const read = relative => {
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) throw Error('Reference path escapes project');
    const bytes = fs.readFileSync(file);
    files.push({ path: relative.split(path.sep).join('/'), sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    return bytes.toString('utf8');
  };
  const metadata = relative => {
    const parsed = ts.parseConfigFileTextToJson(relative.split(path.sep).join('/'), read(relative));
    if (parsed.error) throw Error(`Invalid resource metadata: ${relative}`);
    return parsed.config;
  };
  const resourceFolders = name => fs.existsSync(path.join(root, name)) ? fs.readdirSync(path.join(root, name), { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => e.name) : [];
  const objects = resourceFolders('objects').flatMap(name => {
    const relative = path.join('objects', name, name + '.yy');
    if (!fs.existsSync(path.join(root, relative))) return [];
    const data = metadata(relative), createFile = path.join('objects', name, 'Create_0.gml');
    const parameters = {};
    if (fs.existsSync(path.join(root, createFile))) {
      const lines = read(createFile).split(/\r?\n/);
      const allowed = new Set(['walkspeed','grv','jumpspeed','min_jump_speed','jumps_left','stage','move_speed','platform_width','platform_height','stretch_height','stretch_duration','stage3_duration','stage4_duration','move_distance','max_health','head_speed','bite_cooldown_max','hunting_range']);
      lines.forEach((line, index) => {
        const match = line.match(/^\s*([a-z_]+)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/i);
        if (match && allowed.has(match[1]) && parameters[match[1]] === undefined) parameters[match[1]] = { value: Number(match[2]), line: index + 1 };
      });
    }
    return [{ id: name, sprite: data.spriteId?.name || null, parent: data.parentObjectId?.name || null, parameters }];
  });
  const sprites = resourceFolders('sprites').flatMap(name => {
    const relative = path.join('sprites', name, name + '.yy');
    if (!fs.existsSync(path.join(root, relative))) return [];
    const data = metadata(relative);
    return [{ id: name, width: data.width, height: data.height, bbox: { left: data.bbox_left, right: data.bbox_right, top: data.bbox_top, bottom: data.bbox_bottom, mode: data.bboxMode }, frameIds: (data.frames || []).map(f => f.name), playbackSpeed: data.sequence?.playbackSpeed, playbackSpeedType: data.sequence?.playbackSpeedType, origin: { x: data.sequence?.xorigin, y: data.sequence?.yorigin } }];
  });
  const tilesets = resourceFolders('tilesets').flatMap(name => {
    const relative=path.join('tilesets',name,name+'.yy');if(!fs.existsSync(path.join(root,relative)))return [];
    const data=metadata(relative);return [{id:name,tileWidth:data.tileWidth,tileHeight:data.tileHeight,sprite:data.spriteId?.name||null}];
  });
  const rooms = resourceFolders('rooms').flatMap(name => {
    const relative = path.join('rooms', name, name + '.yy');
    if (!fs.existsSync(path.join(root, relative))) return [];
    const data = metadata(relative), instances = [], tileLayers = [];
    const walk = layers => { for (const layer of layers || []) {
      for (const item of layer.instances || []) instances.push({ id: item.name, object: item.objectId?.name, x: item.x, y: item.y, scaleX: item.scaleX, scaleY: item.scaleY, rotation: item.rotation, layer: layer.name, creationCode: Boolean(item.hasCreationCode) });
      if (layer.tiles) {const tileset=tilesets.find(t=>t.id===layer.tilesetId?.name);tileLayers.push({ name: layer.name, tileset: layer.tilesetId?.name || null, tileWidth:tileset?.tileWidth,tileHeight:tileset?.tileHeight,visible:layer.visible, x: layer.x, y: layer.y, gridX: layer.gridX, gridY: layer.gridY, data: layer.tiles });}
      walk(layer.layers);
    }};
    walk(data.layers);
    return [{ id: name, width: data.roomSettings?.Width, height: data.roomSettings?.Height, instances, tileLayers }];
  });
  return { format: 'pixel-world-gamemaker-reference-v1', engineImportReady: false, notes: ['Static source reference, not a playable conversion.', 'Room coordinates and compressed tile data are preserved; tile collision decoding and creation-code effects require separate validation.', 'Numeric Create assignments may be overridden at runtime; do not equate initial values with final behaviour. No scripts or credentials are copied.'], objects, sprites, tilesets, rooms, evidence: files };
}

module.exports = { collectReference };
if (require.main === module) {
  const [root, target] = process.argv.slice(2);
  if (!root || !target) { console.error('Usage: node scripts/import-gamemaker-reference.cjs <project-directory> <output.json>'); process.exitCode = 1; }
  else { const result = collectReference(root); fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ objects: result.objects.length, sprites: result.sprites.length, rooms: result.rooms.length, evidenceFiles: result.evidence.length, output: path.resolve(target) })); }
}
