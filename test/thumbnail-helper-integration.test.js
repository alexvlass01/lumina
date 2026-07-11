'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { build } = require('../scripts/build-thumbnail-helper');
const { ThumbnailHost } = require('../src/thumbnail-host');

function makeBmp(width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const result = Buffer.alloc(54 + pixelBytes);
  result.write('BM', 0, 'ascii');
  result.writeUInt32LE(result.length, 2);
  result.writeUInt32LE(54, 10);
  result.writeUInt32LE(40, 14);
  result.writeInt32LE(width, 18);
  result.writeInt32LE(height, 22);
  result.writeUInt16LE(1, 26);
  result.writeUInt16LE(24, 28);
  result.writeUInt32LE(pixelBytes, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = 54 + y * rowSize + x * 3;
      result[offset] = x % 2 ? 40 : 210;
      result[offset + 1] = y % 2 ? 180 : 60;
      result[offset + 2] = 230;
    }
  }
  return result;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return chunk;
}

function makePng(width, height, transparent) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4;
      rows[pixel] = 40 + x * 20;
      rows[pixel + 1] = 80 + y * 20;
      rows[pixel + 2] = 210;
      rows[pixel + 3] = transparent && (x + y) % 2 === 0 ? 80 : 255;
    }
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

(async () => {
  if (process.platform !== 'win32') {
    console.log('thumbnail-helper-integration.test.js skipped: Windows only');
    return;
  }

  const executablePath = build();
  const selfTest = spawnSync(executablePath, ['--self-test'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  assert.strictEqual(selfTest.status, 0);
  assert.match(selfTest.stdout, /self-test ok protocol=1/);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-thumbnail-helper-test-'));
  const alphaPath = path.join(tempRoot, 'прозрачная картинка.png');
  const opaquePngPath = path.join(tempRoot, 'opaque image.png');
  const bmpPath = path.join(tempRoot, 'opaque image.bmp');
  const jpegPath = path.join(tempRoot, 'opaque image.jpg');
  const gifPath = path.join(tempRoot, 'first frame.gif');
  const webpPath = path.join(tempRoot, 'provider test.webp');
  const corruptPath = path.join(tempRoot, 'corrupt.png');
  const textPath = path.join(tempRoot, 'not an image.txt');
  fs.writeFileSync(alphaPath, makePng(7, 5, true));
  fs.writeFileSync(opaquePngPath, makePng(7, 5, false));
  fs.writeFileSync(bmpPath, makeBmp(7, 5));
  fs.writeFileSync(gifPath, Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
  fs.writeFileSync(webpPath, Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJQBOgCHwAP7+4AAAAA==', 'base64'));
  fs.writeFileSync(corruptPath, 'not-an-image', 'utf8');
  fs.writeFileSync(textPath, 'plain text', 'utf8');

  const events = [];
  const host = new ThumbnailHost({
    executablePath,
    onEvent: (name, attributes) => events.push({ name, attributes }),
  });

  try {
    const pong = await host.ping();
    assert.strictEqual(pong.pong, true);

    const transparent = await host.thumbnail(alphaPath, 320);
    assert.strictEqual(transparent.mime, 'image/png');
    assert.ok(transparent.width > 0 && transparent.height > 0);
    const png = Buffer.from(transparent.dataBase64, 'base64');
    assert.strictEqual(png.subarray(1, 4).toString('ascii'), 'PNG');

    // The helper must release Shell/HBITMAP/file handles after every response.
    const renamedPath = path.join(tempRoot, 'после ответа.png');
    fs.renameSync(alphaPath, renamedPath);
    fs.renameSync(renamedPath, alphaPath);

    const opaque = await host.thumbnail(bmpPath, 240);
    assert.strictEqual(opaque.mime, 'image/jpeg');
    assert.ok(opaque.width > 0 && opaque.height > 0);
    assert.ok(Math.abs(opaque.width / opaque.height - 7 / 5) < 0.02);
    const jpeg = Buffer.from(opaque.dataBase64, 'base64');
    assert.strictEqual(jpeg[0], 0xff);
    assert.strictEqual(jpeg[1], 0xd8);
    fs.writeFileSync(jpegPath, jpeg);

    const fromJpeg = await host.thumbnail(jpegPath, 200);
    assert.strictEqual(fromJpeg.mime, 'image/jpeg');
    const fromOpaquePng = await host.thumbnail(opaquePngPath, 200);
    assert.strictEqual(fromOpaquePng.mime, 'image/jpeg');
    const fromGif = await host.thumbnail(gifPath, 200);
    assert.ok(['image/jpeg', 'image/png'].includes(fromGif.mime));

    try {
      const fromWebp = await host.thumbnail(webpPath, 200);
      assert.ok(['image/jpeg', 'image/png'].includes(fromWebp.mime));
    } catch (error) {
      assert.ok(error && ['unsupported', 'extract_failed'].includes(error.code));
    }

    await assert.rejects(
      host.thumbnail(path.join(tempRoot, 'missing.png'), 200),
      (error) => error && error.code === 'not_found'
    );
    await assert.rejects(
      host.thumbnail(corruptPath, 200),
      (error) => error && ['extract_failed', 'unsupported'].includes(error.code)
    );
    await assert.rejects(
      host.thumbnail(textPath, 200),
      (error) => error && error.code === 'unsupported'
    );

    assert.strictEqual(events.filter((event) => event.name === 'start').length, 1);
    assert.ok(events.some((event) => event.name === 'ready'));
    assert.ok(events.filter((event) => event.name === 'response' && event.attributes.status === 'ok').length >= 3);
    console.log('thumbnail-helper-integration.test.js ok');
  } finally {
    await host.dispose();
    if (tempRoot.startsWith(os.tmpdir() + path.sep)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
